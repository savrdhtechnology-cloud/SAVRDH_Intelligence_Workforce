begin;
-- An authenticated caller cannot assert provider delivery by passing an invented message ID.
revoke execute on function public.sav_ai_crm_mark_sales_email_sent(uuid,text) from public,anon,authenticated;

create or replace function public.sav_ai_crm_claim_sales_email(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path=public,sav_ai_crm as $$
declare me sav_ai_crm.members; d sav_ai_crm.sales_email_drafts; l sav_ai_crm.leads;
begin
 me:=sav_ai_crm.agent_current_member();
 if me.id is null or me.role not in ('owner','admin','manager') then raise exception 'Email approval requires owner, admin or manager';end if;
 select * into d from sav_ai_crm.sales_email_drafts where id=p_draft_id and workspace_id=me.workspace_id for update;
 if d.id is null then raise exception 'Draft not found';end if;
 if d.status='sent' or d.error_code in ('SENDING','EMAIL_ACCEPTANCE_UNKNOWN') then raise exception 'Already sent or acceptance unresolved. Review provider history';end if;
 if d.approved_at<now()-interval '23 hours' then raise exception 'Retry window expired. Reconcile provider history';end if;
 select * into l from sav_ai_crm.leads where id=d.lead_id and workspace_id=me.workspace_id;
 if l.email_opt_in is distinct from true or lower(trim(l.email)) is distinct from lower(trim(d.recipient)) then raise exception 'Consent or recipient changed; regenerate draft';end if;
 if not exists(select 1 from sav_ai_crm.ai_agents where id=d.agent_id and workspace_id=me.workspace_id and status='active' and 'email'=any(channels)) then raise exception 'Agent is inactive or email channel is disabled';end if;
 if not public.sav_ai_crm_agent_target_allowed(d.agent_id,d.lead_id) then raise exception 'Lead outside current agent testing scope';end if;
 if not exists(select 1 from sav_ai_crm.product_catalog where id=d.product_id and workspace_id=me.workspace_id and is_active) then raise exception 'Approved product unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended(me.workspace_id::text||d.message_fingerprint,0));
 if exists(select 1 from sav_ai_crm.sales_email_drafts where workspace_id=me.workspace_id and id<>d.id and message_fingerprint=d.message_fingerprint and (status='sent' or error_code in ('SENDING','EMAIL_ACCEPTANCE_UNKNOWN'))) then raise exception 'Duplicate email prevented';end if;
 update sav_ai_crm.sales_email_drafts set status='approved',approved_by=me.id,approved_at=coalesce(approved_at,now()),error_code='SENDING',error_message=null,updated_at=now() where id=d.id;
 insert into sav_ai_crm.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata)
 values(me.workspace_id,auth.uid(),'sales_email.approved','sales_email_draft',d.id,jsonb_build_object('agent_id',d.agent_id,'recipient',d.recipient,'subject',d.subject));
 return to_jsonb(d);
end $$;

create or replace function public.sav_ai_crm_record_sales_email_result(p_draft_id uuid,p_ok boolean,p_provider_id text,p_error text,p_message text)
returns void language plpgsql security definer set search_path=public,sav_ai_crm as $$
declare d sav_ai_crm.sales_email_drafts;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Provider result requires server identity';end if;
 select * into d from sav_ai_crm.sales_email_drafts where id=p_draft_id for update;
 if d.id is null or d.error_code is distinct from 'SENDING' then raise exception 'Email has no active send claim';end if;
 if p_ok and nullif(trim(p_provider_id),'') is null then raise exception 'Provider message ID required';end if;
 update sav_ai_crm.sales_email_drafts set status=case when p_ok then 'sent' else 'failed' end,
 provider='resend',provider_message_id=case when p_ok then p_provider_id else null end,sent_at=case when p_ok then now() else null end,
 error_code=case when p_ok then null else p_error end,error_message=case when p_ok then null else left(p_message,500) end,updated_at=now() where id=d.id;
 insert into sav_ai_crm.activities(workspace_id,lead_id,actor_member_id,activity_type,title,description,channel,metadata)
 values(d.workspace_id,d.lead_id,d.approved_by,case when p_ok then 'sales_email_sent' else 'sales_email_failed' end,
 case when p_ok then 'Email accepted by provider' else 'Email was not confirmed' end,case when p_ok then d.subject else left(p_message,500) end,'email',
 jsonb_build_object('draft_id',d.id,'agent_id',d.agent_id,'recipient',d.recipient,'subject',d.subject,'provider','resend','provider_message_id',p_provider_id,'accepted',p_ok));
 insert into sav_ai_crm.audit_logs(workspace_id,action,entity_type,entity_id,metadata)
 values(d.workspace_id,case when p_ok then 'sales_email.accepted' else 'sales_email.failed' end,'sales_email_draft',d.id,jsonb_build_object('agent_id',d.agent_id,'provider_message_id',p_provider_id));
 if p_ok then
 update sav_ai_crm.leads set status=case when status='new' then 'contacted' else status end,updated_at=now() where id=d.lead_id;
 -- Only this email's explicit follow-up is created; unrelated email tasks are not marked completed.
 insert into sav_ai_crm.tasks(workspace_id,lead_id,title,description,status,priority,task_type,followup_type,due_at,assigned_agent_id,created_by)
 values(d.workspace_id,d.lead_id,'Follow up on accepted sales email','Email draft '||d.id::text,'pending','medium','followup','email',now()+interval '2 days',d.agent_id,d.approved_by);
 end if;
end $$;
revoke all on function public.sav_ai_crm_claim_sales_email(uuid) from public,anon;
grant execute on function public.sav_ai_crm_claim_sales_email(uuid) to authenticated;
revoke all on function public.sav_ai_crm_record_sales_email_result(uuid,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.sav_ai_crm_record_sales_email_result(uuid,boolean,text,text,text) to service_role;
create or replace function public.sav_ai_crm_ingest_engagex_lead(p_payload jsonb)
returns uuid language plpgsql security definer set search_path=public,sav_ai_crm as $$
declare
  w_id uuid; owner_member uuid; existing sav_ai_crm.leads; lid uuid; cid uuid;
  record_id text:=nullif(trim(coalesce(p_payload->>'record_id','')),'');
  record_kind text:=nullif(trim(coalesce(p_payload->>'record_kind','')),'');
  full_name text:=nullif(trim(coalesce(p_payload->>'name','')),'');
  email_value text:=lower(nullif(trim(coalesce(p_payload->>'email','')),''));
  phone_value text:=nullif(regexp_replace(coalesce(p_payload->>'phone',''),'[^0-9+]','','g'),'');
  company_value text:=nullif(trim(coalesce(p_payload->>'company','')),'');
  tags_value text[]:=array[]::text[];
  meta jsonb;
begin
  if record_kind not in ('contact','prospect') or record_id is null or full_name is null then raise exception 'Invalid EngageX payload'; end if;
  select id into w_id from sav_ai_crm.workspaces where slug='savrdh-technology-main' order by created_at limit 1;

  if w_id is null then raise exception 'SAVRDH AI workspace not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(w_id::text||':engagex-ingest',0));
  select id into owner_member from sav_ai_crm.members where workspace_id=w_id and is_active=true order by case role when 'owner' then 0 when 'admin' then 1 else 2 end,created_at limit 1;
  if owner_member is null then raise exception 'SAVRDH AI member not found'; end if;

  select coalesce(array_agg(distinct trim(v)) filter(where trim(v)<>''),array[]::text[])
    into tags_value from jsonb_array_elements_text(coalesce(p_payload->'tags','[]'::jsonb)) t(v);

  select * into existing from sav_ai_crm.leads
  where workspace_id=w_id and (
    engagex_record_id=record_id
    or (email_value is not null and lower(coalesce(email,''))=email_value)
    or (phone_value is not null and regexp_replace(coalesce(phone,''),'[^0-9+]','','g')=phone_value)
  )
  order by case when engagex_record_id=record_id then 0 when email_value is not null and lower(coalesce(email,''))=email_value then 1 else 2 end,created_at
  limit 1 for update;

  meta:=jsonb_strip_nulls(jsonb_build_object(
    'import_source','engagex','original_source_metadata',p_payload->'source_metadata',
    'engagex',jsonb_build_object('record_id',record_id,'record_kind',record_kind,'workspace_id',p_payload->>'workspace_id','synced_at',now())
  ));

  if existing.id is not null then
    update sav_ai_crm.leads set
      title=full_name,company=coalesce(company_value,company),email=coalesce(email_value,email),phone=coalesce(phone_value,phone),
      job_title=coalesce(nullif(trim(coalesce(p_payload->>'job_title',p_payload->>'designation','')),''),job_title),
      industry=coalesce(nullif(trim(coalesce(p_payload->>'industry','')),''),industry),
      city=coalesce(nullif(trim(coalesce(p_payload->>'city','')),''),city),
      state=coalesce(nullif(trim(coalesce(p_payload->>'state','')),''),state),
      country=coalesce(nullif(trim(coalesce(p_payload->>'country','')),''),country),
      website=coalesce(nullif(trim(coalesce(p_payload->>'website','')),''),website),
      tags=(select array(select distinct x from unnest(coalesce(tags,'{}')||tags_value||array['engagex']) x)),
      email_opt_in=case when p_payload ? 'email_opt_in' then (p_payload->>'email_opt_in')::boolean else email_opt_in end,
      whatsapp_opt_in=case when p_payload ? 'whatsapp_opt_in' then (p_payload->>'whatsapp_opt_in')::boolean else whatsapp_opt_in end,
      score=coalesce(nullif(p_payload->>'lead_score','')::integer,score),
      source='engagex',engagex_record_id=record_id,engagex_record_kind=record_kind,
      engagex_workspace_id=nullif(trim(coalesce(p_payload->>'workspace_id','')),''),
      notes=coalesce(nullif(trim(coalesce(p_payload->>'notes','')),''),notes),metadata=coalesce(metadata,'{}')||meta,updated_at=now()
    where id=existing.id returning id into lid;
    insert into sav_ai_crm.activities(workspace_id,lead_id,activity_type,title,description,channel,metadata)
    values(w_id,lid,'engagex_lead_synced','EngageX lead synced','Existing lead updated from EngageX.','system',jsonb_build_object('record_id',record_id,'record_kind',record_kind));
    return lid;
  end if;

  insert into sav_ai_crm.contacts(workspace_id,first_name,email,phone,company,designation,source,tags,owner_id)
  values(w_id,full_name,email_value,phone_value,company_value,nullif(trim(coalesce(p_payload->>'job_title',p_payload->>'designation','')),''),'engagex',tags_value||array['engagex'],owner_member)
  returning id into cid;

  insert into sav_ai_crm.leads(
    workspace_id,contact_id,title,company,email,phone,source,status,priority,score,value,owner_id,notes,metadata,
    job_title,industry,city,state,country,website,tags,email_opt_in,whatsapp_opt_in,engagex_record_id,engagex_record_kind,engagex_workspace_id
  ) values(
    w_id,cid,full_name,company_value,email_value,phone_value,'engagex','new','medium',coalesce(nullif(p_payload->>'lead_score','')::integer,0),0,owner_member,
    nullif(trim(coalesce(p_payload->>'notes','')),''),meta,
    nullif(trim(coalesce(p_payload->>'job_title',p_payload->>'designation','')),''),nullif(trim(coalesce(p_payload->>'industry','')),''),
    nullif(trim(coalesce(p_payload->>'city','')),''),nullif(trim(coalesce(p_payload->>'state','')),''),nullif(trim(coalesce(p_payload->>'country','')),''),
    nullif(trim(coalesce(p_payload->>'website','')),''),tags_value||array['engagex'],
    case when p_payload ? 'email_opt_in' then (p_payload->>'email_opt_in')::boolean else null end,
    case when p_payload ? 'whatsapp_opt_in' then (p_payload->>'whatsapp_opt_in')::boolean else null end,
    record_id,record_kind,nullif(trim(coalesce(p_payload->>'workspace_id','')),'')
  ) returning id into lid;

  insert into sav_ai_crm.activities(workspace_id,lead_id,contact_id,activity_type,title,description,channel,metadata)
  values(w_id,lid,cid,'engagex_lead_received','Lead received from EngageX','Lead created from a verified EngageX handoff.','system',jsonb_build_object('record_id',record_id,'record_kind',record_kind));
  return lid;
end $$;


create or replace function public.sav_ai_crm_save_sales_email_draft(
  p_lead_id uuid,p_agent_id uuid,p_product_id uuid,p_recipient text,p_subject text,p_body text,
  p_personalization_summary text default null,p_confidence numeric default null
) returns jsonb language plpgsql security definer set search_path=public,sav_ai_crm as $$
declare me sav_ai_crm.members; l sav_ai_crm.leads; draft_id uuid; fp text;
begin
  me:=sav_ai_crm.agent_current_member();
  if me.id is null or me.role='viewer' then raise exception 'CRM write permission required'; end if;
  select * into l from sav_ai_crm.leads where id=p_lead_id and workspace_id=me.workspace_id;
  if l.id is null then raise exception 'Lead not found'; end if;
  if l.email is null or lower(trim(l.email))<>lower(trim(coalesce(p_recipient,''))) then raise exception 'Recipient does not match lead email'; end if;
  if l.email_opt_in is distinct from true then raise exception 'Email consent missing'; end if;
  if p_product_id is null or not exists(select 1 from sav_ai_crm.product_catalog where id=p_product_id and workspace_id=me.workspace_id and is_active=true) then raise exception 'Active product fit required'; end if;
  if nullif(trim(p_subject),'') is null or nullif(trim(p_body),'') is null or p_subject ~ E'[\\r\\n]' then raise exception 'Valid subject and body required';end if;
  if not exists(select 1 from sav_ai_crm.ai_agents where id=p_agent_id and workspace_id=me.workspace_id and status='active') then raise exception 'Agent is not active';end if;
  if not public.sav_ai_crm_agent_target_allowed(p_agent_id,p_lead_id) then raise exception 'Lead outside current testing scope';end if;
  perform pg_advisory_xact_lock(hashtextextended(me.workspace_id::text||l.id::text,0));
  fp:=md5(l.id::text||'|'||lower(trim(p_recipient))||'|'||trim(p_subject)||'|'||trim(p_body));
  if exists(select 1 from sav_ai_crm.sales_email_drafts where workspace_id=me.workspace_id and message_fingerprint=fp and created_at>now()-interval '24 hours') then
    return jsonb_build_object('ok',false,'error','DUPLICATE_EMAIL','message','Duplicate email prevented.');
  end if;
  insert into sav_ai_crm.sales_email_drafts(workspace_id,lead_id,agent_id,product_id,recipient,subject,body,personalization_summary,confidence,message_fingerprint)
  values(me.workspace_id,l.id,p_agent_id,p_product_id,lower(trim(p_recipient)),left(trim(p_subject),500),trim(p_body),p_personalization_summary,p_confidence,fp)
  returning id into draft_id;
  insert into sav_ai_crm.activities(workspace_id,lead_id,activity_type,title,description,channel,metadata)
  values(me.workspace_id,l.id,'sales_email_generated','AI sales email generated','Email draft created for human approval.','email',jsonb_build_object('draft_id',draft_id,'agent_id',p_agent_id));
  return jsonb_build_object('ok',true,'draft_id',draft_id,'status','draft');
end $$;


commit;
