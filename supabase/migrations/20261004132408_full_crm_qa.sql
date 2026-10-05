-- Targeted CRM QA corrections. Existing data and test-target allowlist are retained.
begin;
-- Reconcile previously live-only test scope; an empty allowlist fails closed.
create table if not exists sav_ai_crm.agent_test_targets (
 agent_id uuid not null references sav_ai_crm.ai_agents(id) on delete cascade,
 lead_id uuid not null references sav_ai_crm.leads(id) on delete cascade,
 enabled boolean not null default true, created_at timestamptz not null default now(),
 primary key(agent_id,lead_id)
);
alter table sav_ai_crm.agent_test_targets enable row level security;
create or replace function public.sav_ai_crm_agent_target_allowed(p_agent_id uuid,p_lead_id uuid)
returns boolean language sql stable security definer set search_path=public,sav_ai_crm as $$
 select exists(select 1 from sav_ai_crm.agent_test_targets t
 join sav_ai_crm.ai_agents a on a.id=t.agent_id join sav_ai_crm.leads l on l.id=t.lead_id
 where t.agent_id=p_agent_id and t.lead_id=p_lead_id and t.enabled
 and a.workspace_id=l.workspace_id and sav_ai_crm.is_workspace_member(a.workspace_id));
$$;
revoke all on function public.sav_ai_crm_agent_target_allowed(uuid,uuid) from public,anon;
grant execute on function public.sav_ai_crm_agent_target_allowed(uuid,uuid) to authenticated;

-- All business writes use audited RPC boundaries. A self-profile grant must never allow role escalation.
revoke update on sav_ai_crm.members from authenticated;
grant update(full_name) on sav_ai_crm.members to authenticated;
revoke insert,update,delete on sav_ai_crm.leads,sav_ai_crm.deals,sav_ai_crm.sales_email_drafts from authenticated;

create or replace function public.sav_ai_crm_update_lead_status(p_lead_id uuid,p_status text)
returns boolean language plpgsql security definer set search_path=public,sav_ai_crm as $$
declare me sav_ai_crm.members;
begin
 me:=sav_ai_crm.agent_current_member();
 if me.id is null or me.role='viewer' then raise exception 'CRM write permission required';end if;
 if p_status is null or p_status not in ('new','contacted','qualified','proposal','negotiation','won','lost','nurture') then raise exception 'Invalid lead status';end if;
 if p_status='won' and me.role not in ('owner','admin','manager') then raise exception 'Manager approval required for conversion';end if;
 update sav_ai_crm.leads set status=p_status,updated_at=now() where id=p_lead_id and workspace_id=me.workspace_id;
 if not found then raise exception 'Lead not found in workspace';end if;
 insert into sav_ai_crm.activities(workspace_id,lead_id,actor_member_id,activity_type,title,description,channel)
 values(me.workspace_id,p_lead_id,me.id,'lead_status_changed','Lead status updated',p_status,'crm');
 insert into sav_ai_crm.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata)
 values(me.workspace_id,auth.uid(),'lead.status','lead',p_lead_id,jsonb_build_object('status',p_status));return true;
end $$;

create or replace function public.sav_ai_crm_create_lead(p_title text,p_company text default null,p_email text default null,p_phone text default null,p_source text default 'manual',p_priority text default 'medium',p_value numeric default 0)
returns uuid language plpgsql security definer set search_path=public,sav_ai_crm as $$
declare me sav_ai_crm.members; lid uuid; email_value text:=lower(nullif(trim(p_email),''));
begin
 me:=sav_ai_crm.agent_current_member();
 if me.id is null or me.role='viewer' then raise exception 'CRM write permission required';end if;
 if nullif(trim(p_title),'') is null then raise exception 'Lead title required';end if;
 if p_value<0 or p_priority not in ('low','medium','high','urgent') then raise exception 'Invalid lead value or priority';end if;
 if email_value is not null then
  if email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email';end if;
  perform pg_advisory_xact_lock(hashtextextended(me.workspace_id::text||email_value,0));
  if exists(select 1 from sav_ai_crm.leads where workspace_id=me.workspace_id and lower(trim(email))=email_value) then raise exception 'A lead with this email already exists';end if;
 end if;
 insert into sav_ai_crm.leads(workspace_id,title,company,email,phone,source,priority,value,owner_id)
 values(me.workspace_id,trim(p_title),nullif(trim(p_company),''),email_value,nullif(trim(p_phone),''),coalesce(nullif(trim(p_source),''),'manual'),p_priority,coalesce(p_value,0),me.id) returning id into lid;
 insert into sav_ai_crm.activities(workspace_id,lead_id,actor_member_id,activity_type,title,description,channel)
 values(me.workspace_id,lid,me.id,'lead_created','New lead created',trim(p_title),'crm');
 insert into sav_ai_crm.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id)
 values(me.workspace_id,auth.uid(),'lead.create','lead',lid);return lid;
end $$;

create or replace function public.sav_ai_crm_edit_lead(p_lead_id uuid,p_patch jsonb)
returns void language plpgsql security definer set search_path=public,sav_ai_crm as $$
declare me sav_ai_crm.members; l sav_ai_crm.leads; owner_value uuid;
begin
 me:=sav_ai_crm.agent_current_member();
 if me.id is null or me.role='viewer' then raise exception 'CRM write permission required';end if;
 select * into l from sav_ai_crm.leads where id=p_lead_id and workspace_id=me.workspace_id for update;
 if l.id is null then raise exception 'Lead not found';end if;
 if jsonb_typeof(p_patch)<>'object' then raise exception 'Invalid lead fields';end if;
 if p_patch ? 'title' and nullif(trim(p_patch->>'title'),'') is null then raise exception 'Lead title required';end if;
 if p_patch ? 'owner_id' then
  if me.role not in ('owner','admin','manager') then raise exception 'Lead assignment requires manager permission';end if;
  owner_value:=nullif(p_patch->>'owner_id','')::uuid;
  if owner_value is not null and not exists(select 1 from sav_ai_crm.members where id=owner_value and workspace_id=me.workspace_id and is_active) then raise exception 'Invalid assignee';end if;
 else owner_value:=l.owner_id;end if;
 if p_patch ? 'email' and nullif(trim(p_patch->>'email'),'') is not null then
  if p_patch->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email';end if;
  perform pg_advisory_xact_lock(hashtextextended(me.workspace_id::text||lower(trim(p_patch->>'email')),0));
  if exists(select 1 from sav_ai_crm.leads where workspace_id=me.workspace_id and id<>l.id and lower(trim(email))=lower(trim(p_patch->>'email'))) then raise exception 'A lead with this email already exists';end if;
 end if;
 if coalesce((p_patch->>'value')::numeric,l.value)<0 then raise exception 'Value must not be negative';end if;
 update sav_ai_crm.leads set title=coalesce(trim(p_patch->>'title'),title),company=case when p_patch?'company' then nullif(trim(p_patch->>'company'),'') else company end,
 email=case when p_patch?'email' then lower(nullif(trim(p_patch->>'email'),'')) else email end,
 phone=case when p_patch?'phone' then nullif(trim(p_patch->>'phone'),'') else phone end,
 priority=coalesce(p_patch->>'priority',priority),score=coalesce((p_patch->>'score')::int,score),value=coalesce((p_patch->>'value')::numeric,value),
 notes=case when p_patch?'notes' then p_patch->>'notes' else notes end,owner_id=owner_value,
 metadata=case when p_patch?'archived' then metadata||jsonb_build_object('archived', (p_patch->>'archived')::boolean) else metadata end,
 updated_at=now() where id=l.id;
 insert into sav_ai_crm.activities(workspace_id,lead_id,actor_member_id,activity_type,title,description,channel)
 values(me.workspace_id,l.id,me.id,'lead_updated','Lead details updated',case when p_patch?'archived' then 'Archive state changed' else 'Contact, assignment or notes updated' end,'crm');
 insert into sav_ai_crm.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata)
 values(me.workspace_id,auth.uid(),'lead.update','lead',l.id,jsonb_build_object('fields',(select jsonb_agg(key) from jsonb_object_keys(p_patch) key)));
end $$;

create or replace function public.sav_ai_crm_deals()
returns jsonb language plpgsql stable security definer set search_path=public,sav_ai_crm as $$
declare me sav_ai_crm.members;
begin me:=sav_ai_crm.agent_current_member();if me.id is null then raise exception 'CRM membership required';end if;
 return coalesce((select jsonb_agg(to_jsonb(d) order by d.updated_at desc) from sav_ai_crm.deals d where workspace_id=me.workspace_id),'[]');end $$;

create or replace function public.sav_ai_crm_save_deal(p_id uuid,p_data jsonb)
returns uuid language plpgsql security definer set search_path=public,sav_ai_crm as $$
declare me sav_ai_crm.members; did uuid; lid uuid:=nullif(p_data->>'lead_id','')::uuid; oid uuid:=nullif(p_data->>'owner_id','')::uuid;
begin
 me:=sav_ai_crm.agent_current_member();if me.id is null or me.role='viewer' then raise exception 'CRM write permission required';end if;
 if nullif(trim(p_data->>'name'),'') is null or coalesce((p_data->>'amount')::numeric,0)<0 then raise exception 'Opportunity name and nonnegative value required';end if;
 if p_data->>'stage'='won' and me.role not in ('owner','admin','manager') then raise exception 'Manager approval required for conversion';end if;
 if lid is not null and not exists(select 1 from sav_ai_crm.leads where id=lid and workspace_id=me.workspace_id) then raise exception 'Lead not found';end if;
 if oid is not null and not exists(select 1 from sav_ai_crm.members where id=oid and workspace_id=me.workspace_id and is_active) then raise exception 'Invalid assignee';end if;
 if p_id is null then
 insert into sav_ai_crm.deals(workspace_id,lead_id,name,stage,amount,probability,owner_id,expected_close_date)
 values(me.workspace_id,lid,trim(p_data->>'name'),coalesce(p_data->>'stage','discovery'),coalesce((p_data->>'amount')::numeric,0),coalesce((p_data->>'probability')::int,20),oid,nullif(p_data->>'expected_close_date','')::date) returning id into did;
 else
 update sav_ai_crm.deals set lead_id=lid,name=trim(p_data->>'name'),stage=p_data->>'stage',amount=(p_data->>'amount')::numeric,probability=(p_data->>'probability')::int,owner_id=oid,expected_close_date=nullif(p_data->>'expected_close_date','')::date,updated_at=now()
 where id=p_id and workspace_id=me.workspace_id returning id into did;
 if did is null then raise exception 'Opportunity not found';end if;end if;
 insert into sav_ai_crm.activities(workspace_id,lead_id,actor_member_id,activity_type,title,description,channel,metadata)
 values(me.workspace_id,lid,me.id,'opportunity_saved','Opportunity saved',p_data->>'name','crm',jsonb_build_object('deal_id',did));
 insert into sav_ai_crm.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id)
 values(me.workspace_id,auth.uid(),'deal.save','deal',did);return did;
end $$;

create or replace function public.sav_ai_crm_save_workspace(p_company_name text,p_website text)
returns void language plpgsql security definer set search_path=public,sav_ai_crm as $$
declare me sav_ai_crm.members;
begin me:=sav_ai_crm.agent_current_member();if me.id is null or me.role not in ('owner','admin') then raise exception 'Workspace settings require owner or admin';end if;
 if nullif(trim(p_company_name),'') is null then raise exception 'Company name required';end if;
 if nullif(trim(p_website),'') is not null and p_website !~ '^https?://' then raise exception 'Website must start with https:// or http://';end if;
 update sav_ai_crm.workspaces set company_name=trim(p_company_name),website=nullif(trim(p_website),''),updated_at=now() where id=me.workspace_id;
 insert into sav_ai_crm.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id) values(me.workspace_id,auth.uid(),'workspace.update','workspace',me.workspace_id);end $$;

-- Claim a stored analysis exactly once; never trust a client-supplied executable decision.
create or replace function public.sav_ai_crm_claim_agent_plan(p_source_id uuid,p_agent_id uuid,p_lead_id uuid)
returns jsonb language plpgsql security definer set search_path=public,sav_ai_crm as $$
declare me sav_ai_crm.members; src sav_ai_crm.ai_agent_executions; eid uuid;
begin
 me:=sav_ai_crm.agent_current_member();if me.id is null or me.role='viewer' then raise exception 'CRM write permission required';end if;
 select * into src from sav_ai_crm.ai_agent_executions where id=p_source_id and workspace_id=me.workspace_id for update;
 if src.id is null or src.agent_id<>p_agent_id or src.input->>'lead_id' is distinct from p_lead_id::text or src.input->>'mode' is distinct from 'analyze' or src.execution_status<>'completed' then raise exception 'A completed matching analysis is required';end if;
 if src.requested_by<>me.id and me.role not in ('owner','admin','manager') then raise exception 'Plan belongs to another user';end if;
 if src.created_at<now()-interval '24 hours' then raise exception 'Plan expired; analyze again';end if;
 if src.output ? 'claimed_execution_id' then raise exception 'Plan already executed or claimed. Review its results before creating another plan';end if;
 if not public.sav_ai_crm_agent_target_allowed(p_agent_id,p_lead_id) then raise exception 'Lead outside current agent testing scope';end if;
 eid:=public.sav_ai_crm_create_agent_execution(p_agent_id,'Execute stored CRM plan',jsonb_build_object('mode','execute','lead_id',p_lead_id,'source_execution_id',p_source_id));
 update sav_ai_crm.ai_agent_executions set output=coalesce(output,'{}')||jsonb_build_object('claimed_execution_id',eid) where id=src.id;
 return jsonb_build_object('execution_id',eid,'decision',src.planned_action->'decision');
end $$;

-- Public write functions remain authenticated-only; membership and roles checked inside each.
revoke all on function public.sav_ai_crm_edit_lead(uuid,jsonb),public.sav_ai_crm_deals(),public.sav_ai_crm_save_deal(uuid,jsonb),public.sav_ai_crm_save_workspace(text,text),public.sav_ai_crm_claim_agent_plan(uuid,uuid,uuid) from public,anon;
grant execute on function public.sav_ai_crm_edit_lead(uuid,jsonb),public.sav_ai_crm_deals(),public.sav_ai_crm_save_deal(uuid,jsonb),public.sav_ai_crm_save_workspace(text,text),public.sav_ai_crm_claim_agent_plan(uuid,uuid,uuid) to authenticated;
-- SAV-Sales controlled tool engine reconciliation.
-- Extends existing Phase 2 action boundary; no new business tables.

create or replace function public.sav_ai_crm_log_agent_tool(
 p_agent_id uuid,
 p_tool text,
 p_success boolean,
 p_target_type text default null,
 p_target_id uuid default null,
 p_error text default null,
 p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path=public,sav_ai_crm
as $$
declare me sav_ai_crm.members; agent sav_ai_crm.ai_agents;
begin
 me:=sav_ai_crm.agent_current_member();
 if me.id is null then raise exception 'CRM membership required'; end if;
 select * into agent from sav_ai_crm.ai_agents where id=p_agent_id and workspace_id=me.workspace_id;
 if agent.id is null then raise exception 'Agent not found'; end if;
 if nullif(trim(coalesce(p_tool,'')),'') is null then raise exception 'Tool name required'; end if;

 insert into sav_ai_crm.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata)
 values(
   me.workspace_id,auth.uid(),
   case when p_success then 'agent.tool.succeeded' else 'agent.tool.failed' end,
   'ai_agent',agent.id,
   jsonb_build_object(
     'tool',left(trim(p_tool),100),
     'target_type',nullif(trim(coalesce(p_target_type,'')),''),
     'target_id',p_target_id,
     'error',case when p_success then null else left(coalesce(p_error,'TOOL_FAILED'),500) end,
     'metadata',coalesce(p_metadata,'{}'::jsonb)
   )
 );
end $$;

revoke all on function public.sav_ai_crm_log_agent_tool(uuid,text,boolean,text,uuid,text,jsonb) from public,anon;
grant execute on function public.sav_ai_crm_log_agent_tool(uuid,text,boolean,text,uuid,text,jsonb) to authenticated;

create or replace function public.sav_ai_crm_execute_agent_action(p_action_id uuid)
returns jsonb language plpgsql security definer
set search_path=public,sav_ai_crm
as $$
declare
 me sav_ai_crm.members;
 a sav_ai_crm.ai_agent_actions;
 agent sav_ai_crm.ai_agents;
 task_id uuid;
 lead_rec sav_ai_crm.leads;
 runtime_agent_id uuid;
 effective_workspace uuid;
 next_status text;
 result_payload jsonb := '{}'::jsonb;
begin
 me:=sav_ai_crm.agent_current_member();
 runtime_agent_id:=sav_ai_crm.agent_runtime_id();

 if runtime_agent_id is null and (me.id is null or me.role='viewer') then raise exception 'CRM write permission required'; end if;

 select * into a from sav_ai_crm.ai_agent_actions where id=p_action_id for update;
 if a.id is null then raise exception 'Action not found'; end if;

 if runtime_agent_id is not null then
   if a.agent_id<>runtime_agent_id then raise exception 'Agent identity mismatch'; end if;
   effective_workspace:=a.workspace_id;
 else
   effective_workspace:=me.workspace_id;
   if a.workspace_id<>effective_workspace then raise exception 'Action is outside this workspace'; end if;
 end if;

 if a.approval_required and a.status<>'approved' then raise exception 'Human approval required'; end if;
 if a.status not in ('approved','pending') then raise exception 'Action is not executable'; end if;

 select * into agent from sav_ai_crm.ai_agents where id=a.agent_id and workspace_id=effective_workspace;
 if agent.id is null or agent.status<>'active' then raise exception 'Agent is not active'; end if;

 if a.target_type='lead' and not public.sav_ai_crm_agent_target_allowed(a.agent_id,a.target_id) then raise exception 'Lead outside current testing scope';end if;
 if not exists(select 1 from sav_ai_crm.ai_agent_capabilities where agent_id=a.agent_id and capability=a.action and is_enabled) then raise exception 'Agent capability denied';end if;
 update sav_ai_crm.ai_agent_actions set status='executing',updated_at=now() where id=a.id;

 if a.action in ('CREATE_TASK','CREATE_FOLLOWUP') then
   if a.target_type<>'lead' or a.target_id is null then raise exception 'Task creation requires a lead target'; end if;
   select * into lead_rec from sav_ai_crm.leads where id=a.target_id and workspace_id=effective_workspace;
   if lead_rec.id is null then raise exception 'Lead not found'; end if;

   insert into sav_ai_crm.tasks(
     workspace_id,lead_id,title,description,task_type,followup_type,status,priority,due_at,reminder_at,
     assigned_agent_id,notes
   ) values(
     effective_workspace,lead_rec.id,
     coalesce(nullif(a.payload->>'title',''),agent.display_name||' follow-up'),
     nullif(a.payload->>'description',''),'followup',
     case when a.action='CREATE_FOLLOWUP' then coalesce(nullif(a.payload->>'followup_type',''),'general') else 'general' end,
     'pending',
     case when a.payload->>'priority' in ('low','medium','high','urgent') then a.payload->>'priority' else 'medium' end,
     nullif(a.payload->>'due_at','')::timestamptz,
     nullif(a.payload->>'reminder_at','')::timestamptz,
     agent.id,
     'Created by: '||agent.display_name
   ) returning id into task_id;

   insert into sav_ai_crm.activities(workspace_id,lead_id,task_id,activity_type,title,description,metadata)
   values(
     effective_workspace,lead_rec.id,task_id,
     case when a.action='CREATE_FOLLOWUP' then 'agent_followup_created' else 'agent_task_created' end,
     agent.display_name||' created task',
     coalesce(a.payload->>'title','Follow-up task'),
     jsonb_build_object('agent_id',agent.id,'agent_name',agent.display_name,'action_id',a.id)
   );
   result_payload:=jsonb_build_object('task_id',task_id);

 elsif a.action='UPDATE_LEAD' then
   if a.target_type<>'lead' or a.target_id is null then raise exception 'Lead update requires a lead target'; end if;
   next_status:=nullif(trim(coalesce(a.payload->>'status','')),'');
   if next_status is null then raise exception 'Lead status is required'; end if;
   if next_status not in ('new','contacted','qualified','proposal','negotiation','nurture') then
     raise exception 'Lead status is not permitted for autonomous agent update';
   end if;

   update sav_ai_crm.leads
   set status=next_status,updated_at=now()
   where id=a.target_id and workspace_id=effective_workspace;
   if not found then raise exception 'Lead not found'; end if;

   insert into sav_ai_crm.activities(workspace_id,lead_id,activity_type,title,description,channel,metadata)
   values(
     effective_workspace,a.target_id,'agent_lead_status_updated',
     agent.display_name||' updated lead status',next_status,'crm',
     jsonb_build_object('agent_id',agent.id,'action_id',a.id,'status',next_status)
   );
   result_payload:=jsonb_build_object('lead_id',a.target_id,'status',next_status);

 elsif a.action='CREATE_NOTE' then
   if a.target_type<>'lead' or a.target_id is null then raise exception 'Note requires a lead target'; end if;
   update sav_ai_crm.leads
   set notes=concat_ws(E'\n',notes,'['||agent.display_name||'] '||coalesce(a.payload->>'note','')),
       updated_at=now()
   where id=a.target_id and workspace_id=effective_workspace;
   if not found then raise exception 'Lead not found'; end if;
   insert into sav_ai_crm.activities(workspace_id,lead_id,activity_type,title,description,metadata)
   values(
     effective_workspace,a.target_id,'agent_note_created',
     agent.display_name||' added note',a.payload->>'note',
     jsonb_build_object('agent_id',agent.id,'action_id',a.id)
   );
   result_payload:=jsonb_build_object('lead_id',a.target_id);

 elsif a.action='CREATE_ESCALATION' then
   insert into sav_ai_crm.ai_agent_escalations(workspace_id,agent_id,lead_id,conversation_id,task_id,reason,details)
   values(
     effective_workspace,agent.id,
     case when a.target_type='lead' then a.target_id else null end,
     case when a.target_type='conversation' then a.target_id else null end,
     case when a.target_type='task' then a.target_id else null end,
     coalesce(nullif(a.payload->>'reason',''),'FAILED_ACTION'),
     a.payload->>'details'
   );
   result_payload:=jsonb_build_object('escalation_created',true);

 else
   update sav_ai_crm.ai_agent_actions
   set status='failed',error='ACTION_ADAPTER_NOT_IMPLEMENTED',updated_at=now(),completed_at=now()
   where id=a.id;
   raise exception 'Action adapter not implemented';
 end if;

 update sav_ai_crm.ai_agent_actions
 set status='completed',result=result_payload,updated_at=now(),completed_at=now()
 where id=a.id;

 insert into sav_ai_crm.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata)
 values(
   effective_workspace,auth.uid(),'agent.action.completed','ai_agent_action',a.id,
   jsonb_build_object('agent_id',agent.id,'capability',a.action,'result',result_payload)
 );

 return jsonb_build_object('action_id',a.id,'status','completed')||result_payload;
end $$;

revoke all on function public.sav_ai_crm_execute_agent_action(uuid) from public,anon;
grant execute on function public.sav_ai_crm_execute_agent_action(uuid) to authenticated;

commit;
