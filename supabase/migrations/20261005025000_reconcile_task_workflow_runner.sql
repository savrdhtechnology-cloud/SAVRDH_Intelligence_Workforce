-- Reconcile the deployed task runner added upstream; preserve route mappings.
create table if not exists sav_ai_crm.task_workflow_routes(work_type text primary key,workflow_id uuid references sav_ai_crm.workflows(id),is_active boolean not null default true,updated_at timestamptz not null default now());
alter table sav_ai_crm.task_workflow_routes enable row level security;
CREATE OR REPLACE FUNCTION public.sav_ai_crm_run_task_workflow(p_task_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'sav_ai_crm'
AS $function$
declare
  me sav_ai_crm.members;
  t sav_ai_crm.tasks;
  a sav_ai_crm.ai_agents;
  v_work_type text;
  v_workflow_id uuid;
  v_execution_id uuid;
  v_run_result jsonb;
begin
  me:=sav_ai_crm.agent_current_member();
  if me.id is null or me.role='viewer' then raise exception 'CRM membership required'; end if;

  select * into t
  from sav_ai_crm.tasks
  where id=p_task_id
    and workspace_id=me.workspace_id
    and archived_at is null for update;

  if t.id is null then raise exception 'Task not found'; end if;
  if t.status in ('completed','cancelled') then raise exception 'Task is completed or cancelled';end if;
  if t.assigned_agent_id is null then raise exception 'Task is not assigned to an AI agent'; end if;
  if t.lead_id is null then raise exception 'Task is not linked to a lead'; end if;

  select * into a
  from sav_ai_crm.ai_agents
  where id=t.assigned_agent_id and workspace_id=me.workspace_id;

  if a.id is null then raise exception 'Assigned AI agent not found'; end if;
  if a.status<>'active' then
    return jsonb_build_object('ok',false,'error','AGENT_NOT_ACTIVE','message','Assigned agent is paused or disabled.');
  end if;

  if not public.sav_ai_crm_agent_target_allowed(a.id,t.lead_id) then
    return jsonb_build_object('ok',false,'error','TEST_SCOPE_BLOCKED','message','Lead is outside current testing scope.');
  end if;

  v_work_type:=lower(coalesce(t.followup_type,''));
  if v_work_type not in ('sales','followup','credit','document','finance','manager_review') then
    v_work_type:=case
      when a.slug='sav-sales' then 'sales'
      when a.slug='sav-credit' then 'credit'
      when a.slug='sav-document' then 'document'
      when a.slug='sav-finance' then 'finance'
      when a.slug='sav-followup' then 'followup'
      when a.slug='sav-sales-manager' then 'manager_review'
      else null
    end;
  end if;

  if v_work_type is null then
    return jsonb_build_object('ok',false,'error','NO_WORKFLOW_ROUTE','message','No workflow is configured for this agent/task.');
  end if;

  select r.workflow_id into v_workflow_id
  from sav_ai_crm.task_workflow_routes r
  join sav_ai_crm.workflows w on w.id=r.workflow_id
  where r.work_type=v_work_type
    and r.is_active=true
    and w.workspace_id=me.workspace_id
    and w.status='active'
    and w.archived_at is null
  limit 1;

  if v_workflow_id is null then
    return jsonb_build_object('ok',false,'error','NO_WORKFLOW_ROUTE','message','No active workflow is configured for this task type.');
  end if;

  v_execution_id:=public.sav_ai_crm_start_workflow(
    v_workflow_id,
    jsonb_build_object(
      'task',jsonb_build_object(
        'id',t.id,
        'title',t.title,
        'status',t.status,
        'priority',t.priority,
        'followup_type',t.followup_type
      ),
      'lead',jsonb_build_object('id',t.lead_id),
      'agent',jsonb_build_object('id',a.id,'slug',a.slug)
    ),
    'MANUAL_TRIGGER',
    'task:'||t.id::text
  );

  v_run_result:=public.sav_ai_crm_run_workflow_execution(v_execution_id);

  return jsonb_build_object(
    'ok',coalesce(v_run_result->>'status','') not in ('failed','cancelled'),
    'workflow_id',v_workflow_id,
    'execution_id',v_execution_id,
    'work_type',v_work_type,
    'result',v_run_result
  );
end $function$
;
revoke all on function public.sav_ai_crm_run_task_workflow(uuid) from public,anon;
grant execute on function public.sav_ai_crm_run_task_workflow(uuid) to authenticated;

