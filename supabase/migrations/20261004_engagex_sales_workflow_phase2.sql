-- EngageX -> SAVRDH AI controlled sales workflow.
-- Extends the existing CRM; does not replace agent/task/activity architecture.

alter table sav_ai_crm.leads
  add column if not exists job_title text,
  add column if not exists industry text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists country text,
  add column if not exists website text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists email_opt_in boolean,
  add column if not exists whatsapp_opt_in boolean,
  add column if not exists engagex_record_id text,
  add column if not exists engagex_record_kind text,
  add column if not exists engagex_workspace_id text,
  add column if not exists ai_qualification text,
  add column if not exists ai_confidence numeric(5,4),
  add column if not exists ai_reasoning text,
  add column if not exists ai_recommended_product_id uuid;

create unique index if not exists sav_ai_crm_leads_engagex_record_uidx
  on sav_ai_crm.leads(workspace_id,engagex_record_id)
  where engagex_record_id is not null;
create index if not exists sav_ai_crm_leads_email_lower_idx
  on sav_ai_crm.leads(workspace_id,lower(email)) where email is not null;
create index if not exists sav_ai_crm_leads_phone_idx
  on sav_ai_crm.leads(workspace_id,phone) where phone is not null;

create table if not exists sav_ai_crm.product_catalog(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references sav_ai_crm.workspaces(id) on delete cascade,
  name text not null,
  description text,
  target_customer text,
  industry_use_case text,
  key_benefits text,
  sales_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,name)
);

create table if not exists sav_ai_crm.sales_email_drafts(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references sav_ai_crm.workspaces(id) on delete cascade,
  lead_id uuid not null references sav_ai_crm.leads(id) on delete cascade,
  agent_id uuid references sav_ai_crm.ai_agents(id) on delete set null,
  product_id uuid references sav_ai_crm.product_catalog(id) on delete set null,
  recipient text not null,
  subject text not null,
  body text not null,
  personalization_summary text,
  confidence numeric(5,4),
  status text not null default 'draft' check(status in ('draft','approved','sent','failed','blocked')),
  message_fingerprint text not null,
  provider text not null default 'engagex',
  provider_message_id text,
  approved_by uuid references sav_ai_crm.members(id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sav_ai_crm_sales_email_lead_idx
  on sav_ai_crm.sales_email_drafts(workspace_id,lead_id,created_at desc);
create index if not exists sav_ai_crm_sales_email_fingerprint_idx
  on sav_ai_crm.sales_email_drafts(workspace_id,message_fingerprint,created_at desc);

alter table sav_ai_crm.product_catalog enable row level security;
alter table sav_ai_crm.sales_email_drafts enable row level security;

do $$ begin
  create policy "workspace read product_catalog" on sav_ai_crm.product_catalog
    for select to authenticated using (sav_ai_crm.is_workspace_member(workspace_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "workspace write product_catalog" on sav_ai_crm.product_catalog
    for all to authenticated using (sav_ai_crm.is_workspace_member(workspace_id))
    with check (sav_ai_crm.is_workspace_member(workspace_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "workspace read sales_email_drafts" on sav_ai_crm.sales_email_drafts
    for select to authenticated using (sav_ai_crm.is_workspace_member(workspace_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "workspace write sales_email_drafts" on sav_ai_crm.sales_email_drafts
    for all to authenticated using (sav_ai_crm.is_workspace_member(workspace_id))
    with check (sav_ai_crm.is_workspace_member(workspace_id));
exception when duplicate_object then null; end $$;

grant select,insert,update,delete on sav_ai_crm.product_catalog to authenticated;
grant select,insert,update,delete on sav_ai_crm.sales_email_drafts to authenticated;

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
  if w_id is null then select workspace_id into w_id from sav_ai_crm.members where is_active=true order by created_at limit 1; end if;
  if w_id is null then raise exception 'SAVRDH AI workspace not found'; end if;
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

create or replace function public.sav_ai_crm_active_products()
returns jsonb language plpgsql stable security definer set search_path=public,sav_ai_crm as $$
declare me sav_ai_crm.members;
begin
  me:=sav_ai_crm.agent_current_member();
  if me.id is null then raise exception 'CRM membership required'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from (
    select id,name,description,target_customer,industry_use_case,key_benefits,sales_url
    from sav_ai_crm.product_catalog where workspace_id=me.workspace_id and is_active=true order by name
  ) x),'[]'::jsonb);
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

create or replace function public.sav_ai_crm_approve_sales_email_draft(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path=public,sav_ai_crm as $$
declare me sav_ai_crm.members; d sav_ai_crm.sales_email_drafts;
begin
  me:=sav_ai_crm.agent_current_member();
  if me.id is null or me.role='viewer' then raise exception 'Approval permission required'; end if;
  select * into d from sav_ai_crm.sales_email_drafts where id=p_draft_id and workspace_id=me.workspace_id for update;
  if d.id is null then raise exception 'Email draft not found'; end if;
  if d.status='sent' then return jsonb_build_object('ok',false,'error','DUPLICATE_EMAIL','message','Duplicate email prevented.'); end if;
  update sav_ai_crm.sales_email_drafts set status='approved',approved_by=me.id,approved_at=coalesce(approved_at,now()),updated_at=now() where id=d.id;
  insert into sav_ai_crm.activities(workspace_id,lead_id,actor_member_id,activity_type,title,description,channel,metadata)
  values(me.workspace_id,d.lead_id,me.id,'sales_email_approved','Sales email approved','Approved for provider delivery.','email',jsonb_build_object('draft_id',d.id));
  return jsonb_build_object('ok',true,'draft_id',d.id,'status','approved');
end $$;

create or replace function public.sav_ai_crm_lead_sales_detail(p_lead_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,sav_ai_crm as $$
declare me sav_ai_crm.members;
begin
  me:=sav_ai_crm.agent_current_member();
  if me.id is null then raise exception 'CRM membership required'; end if;
  if not exists(select 1 from sav_ai_crm.leads where id=p_lead_id and workspace_id=me.workspace_id) then raise exception 'Lead not found'; end if;
  return jsonb_build_object(
    'lead',(select to_jsonb(l) from sav_ai_crm.leads l where l.id=p_lead_id),
    'emails',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from sav_ai_crm.sales_email_drafts e where e.lead_id=p_lead_id),'[]'::jsonb),
    'activities',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from (select id,activity_type,title,description,channel,metadata,created_at from sav_ai_crm.activities where lead_id=p_lead_id order by created_at desc limit 100) a),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc) from (select id,title,description,status,priority,due_at,assigned_agent_id,created_at from sav_ai_crm.tasks where lead_id=p_lead_id order by created_at desc limit 100) t),'[]'::jsonb)
  );
end $$;

create or replace function public.sav_ai_crm_save_lead_ai_analysis(
  p_lead_id uuid,p_qualification text,p_confidence numeric,p_reasoning text,p_product_id uuid default null
) returns void language plpgsql security definer set search_path=public,sav_ai_crm as $$
declare me sav_ai_crm.members;
begin
  me:=sav_ai_crm.agent_current_member();
  if me.id is null or me.role='viewer' then raise exception 'CRM write permission required'; end if;
  if p_qualification not in ('hot','warm','cold','unqualified') then raise exception 'Invalid qualification'; end if;
  if p_product_id is not null and not exists(select 1 from sav_ai_crm.product_catalog where id=p_product_id and workspace_id=me.workspace_id and is_active=true) then raise exception 'Product is unavailable'; end if;
  update sav_ai_crm.leads set ai_qualification=p_qualification,ai_confidence=greatest(0,least(1,p_confidence)),ai_reasoning=left(coalesce(p_reasoning,''),2000),ai_recommended_product_id=p_product_id,updated_at=now()
  where id=p_lead_id and workspace_id=me.workspace_id;
  if not found then raise exception 'Lead not found'; end if;
end $$;


create or replace function public.sav_ai_crm_mark_sales_email_sent(
  p_draft_id uuid,p_provider_message_id text
) returns jsonb language plpgsql security definer set search_path=public,sav_ai_crm as $$
declare me sav_ai_crm.members; d sav_ai_crm.sales_email_drafts; updated_tasks int:=0;
begin
  me:=sav_ai_crm.agent_current_member();
  if me.id is null or me.role='viewer' then raise exception 'CRM write permission required'; end if;

  select * into d
  from sav_ai_crm.sales_email_drafts
  where id=p_draft_id and workspace_id=me.workspace_id
  for update;

  if d.id is null then raise exception 'Email draft not found'; end if;
  if nullif(trim(coalesce(p_provider_message_id,'')),'') is null then raise exception 'Provider message id required'; end if;

  update sav_ai_crm.sales_email_drafts
  set status='sent',
      provider_message_id=p_provider_message_id,
      sent_at=coalesce(sent_at,now()),
      error_code=null,
      error_message=null,
      updated_at=now()
  where id=d.id;

  update sav_ai_crm.leads
  set status=case when status='new' then 'contacted' else status end,
      updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'last_email_sent_id',p_provider_message_id,
        'last_email_sent_at',now()
      )
  where id=d.lead_id and workspace_id=me.workspace_id;

  update sav_ai_crm.tasks
  set status='completed',
      completed_at=coalesce(completed_at,now()),
      updated_at=now()
  where workspace_id=me.workspace_id
    and lead_id=d.lead_id
    and assigned_agent_id=d.agent_id
    and status in ('pending','in_progress')
    and (
      lower(coalesce(followup_type,''))='email'
      or lower(title) like '%email%'
    );
  get diagnostics updated_tasks = row_count;

  insert into sav_ai_crm.activities(
    workspace_id,lead_id,actor_member_id,activity_type,title,description,channel,metadata
  ) values(
    me.workspace_id,d.lead_id,me.id,'sales_email_sent','Customer email sent',
    'Provider confirmed email delivery request; lead moved to contacted and matching email task completed.',
    'email',
    jsonb_build_object('draft_id',d.id,'provider_message_id',p_provider_message_id,'completed_tasks',updated_tasks)
  );

  return jsonb_build_object(
    'ok',true,
    'draft_id',d.id,
    'lead_id',d.lead_id,
    'status','sent',
    'lead_status','contacted',
    'completed_tasks',updated_tasks
  );
end $$;

revoke all on function public.sav_ai_crm_ingest_engagex_lead(jsonb) from public,anon,authenticated;
grant execute on function public.sav_ai_crm_ingest_engagex_lead(jsonb) to service_role;
revoke all on function public.sav_ai_crm_active_products() from public,anon;
revoke all on function public.sav_ai_crm_save_sales_email_draft(uuid,uuid,uuid,text,text,text,text,numeric) from public,anon;
revoke all on function public.sav_ai_crm_approve_sales_email_draft(uuid) from public,anon;
revoke all on function public.sav_ai_crm_lead_sales_detail(uuid) from public,anon;
revoke all on function public.sav_ai_crm_save_lead_ai_analysis(uuid,text,numeric,text,uuid) from public,anon;
revoke all on function public.sav_ai_crm_mark_sales_email_sent(uuid,text) from public,anon;
grant execute on function public.sav_ai_crm_active_products() to authenticated;
grant execute on function public.sav_ai_crm_save_sales_email_draft(uuid,uuid,uuid,text,text,text,text,numeric) to authenticated;
grant execute on function public.sav_ai_crm_approve_sales_email_draft(uuid) to authenticated;
grant execute on function public.sav_ai_crm_lead_sales_detail(uuid) to authenticated;
grant execute on function public.sav_ai_crm_save_lead_ai_analysis(uuid,text,numeric,text,uuid) to authenticated;
grant execute on function public.sav_ai_crm_mark_sales_email_sent(uuid,text) to authenticated;

insert into sav_ai_crm.integrations(workspace_id,provider,display_name,status,config)
select w.id,'engagex','EngageX','connected',jsonb_build_object('mode','webhook','secrets','server-side-only')
from sav_ai_crm.workspaces w where w.slug='savrdh-technology-main'
on conflict(workspace_id,provider) do update set display_name='EngageX',status='connected',updated_at=now();
