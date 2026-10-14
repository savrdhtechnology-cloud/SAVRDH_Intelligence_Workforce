-- =============================================================================
-- Run log + customer message log (14 Oct 2026) — read-only, for the Workflow
-- page: "what did each run do, and which customer got which email/message".
-- =============================================================================

create or replace function public.sav_ai_crm_workflow_run_log(p_limit integer default 60)
returns jsonb language plpgsql stable security definer
set search_path=public,sav_ai_crm
as $$
declare me sav_ai_crm.members;
begin
  me:=sav_ai_crm.agent_current_member();
  if me.id is null then raise exception 'CRM membership required'; end if;

  return coalesce((
    select jsonb_agg(r order by (r->>'started_at') desc) from (
      select jsonb_build_object(
        'id',e.id,
        'workflow',w.name,
        'state',e.execution_state,
        'error',e.error,
        'trigger',e.trigger,
        'started_at',coalesce(e.started_at,e.created_at),
        'completed_at',e.completed_at,
        'seconds',case when e.completed_at is not null then round(extract(epoch from e.completed_at-coalesce(e.started_at,e.created_at))::numeric,1) end,
        'agent',coalesce(a.name,e.context#>>'{agent,slug}'),
        'task',e.context#>>'{task,title}',
        'lead',jsonb_build_object('id',l.id,'name',l.title,'project',coalesce(l.source,'other')),
        'steps',coalesce((
          select jsonb_agg(jsonb_build_object(
            'label',n.label,'type',n.node_type,'action',n.config->>'action',
            'status',ne.status,'error',ne.last_error,'at',coalesce(ne.completed_at,ne.started_at)
          ) order by coalesce(ne.started_at,ne.completed_at))
          from sav_ai_crm.workflow_node_executions ne
          join sav_ai_crm.workflow_nodes n on n.id=ne.node_id
          where ne.execution_id=e.id),'[]'::jsonb),
        'customer_messages',(
          select count(*) from sav_ai_crm.notifications nt
          where nt.workflow_execution_id=e.id and nt.channel<>'in_app')
      ) r
      from sav_ai_crm.workflow_executions e
      join sav_ai_crm.workflows w on w.id=e.workflow_id
      left join sav_ai_crm.ai_agents a on a.id=nullif(e.context#>>'{agent,id}','')::uuid
      left join sav_ai_crm.leads l on l.id=nullif(e.context#>>'{lead,id}','')::uuid
      where e.workspace_id=me.workspace_id
      order by e.created_at desc
      limit greatest(1,least(coalesce(p_limit,60),200))
    ) x
  ),'[]'::jsonb);
end $$;

create or replace function public.sav_ai_crm_customer_message_log(p_limit integer default 100)
returns jsonb language plpgsql stable security definer
set search_path=public,sav_ai_crm
as $$
declare me sav_ai_crm.members; ws uuid; items jsonb;
begin
  me:=sav_ai_crm.agent_current_member();
  if me.id is null then raise exception 'CRM membership required'; end if;
  ws:=me.workspace_id;

  select coalesce(jsonb_agg(i order by (i->>'at') desc),'[]'::jsonb) into items from (
    -- 1. Autopilot reminder emails that were sent
    select jsonb_build_object(
      'at',ev.created_at,'channel','email','kind','Reminder email '||coalesce(ev.metadata->>'attempt','?')||' of 3',
      'status','sent','recipient',lower(trim(l.email)),
      'subject',(select c.subject from sav_ai_crm.autopilot_email_content(l.id,ev.stage_key) c),
      'preview',(select left(c.body,280) from sav_ai_crm.autopilot_email_content(l.id,ev.stage_key) c),
      'stage',ev.stage_key,'lead_id',l.id,'lead',l.title,'project',coalesce(l.source,'other'),
      'by',case when ev.metadata ? 'approved_by'
        then 'Approved by '||coalesce((select coalesce(m.full_name,m.email,m.role) from sav_ai_crm.members m where m.id=(ev.metadata->>'approved_by')::uuid),'admin')
        else 'Autopilot (sent automatically, before the approval rule)' end,
      'delivery',(select case when r.status_code between 200 and 299 then 'accepted by email provider'
                              when r.status_code is not null then 'provider error '||r.status_code end
                  from net._http_response r where r.id=nullif(ev.metadata->>'http_request_id','')::bigint)
    ) i
    from sav_ai_crm.lead_autopilot_events ev join sav_ai_crm.leads l on l.id=ev.lead_id
    where ev.workspace_id=ws and ev.event_type='reminder_queued'

    union all
    -- 2. Reminder emails waiting / skipped / cancelled (never sent)
    select jsonb_build_object(
      'at',coalesce(a.decided_at,a.created_at),'channel','email','kind','Reminder email '||a.attempt||' of 3',
      'status',case a.status when 'pending' then 'waiting for approval' when 'rejected' then 'not sent (skipped)'
                             when 'superseded' then 'not sent (cancelled)' else 'not sent (failed)' end,
      'recipient',a.recipient,'subject',a.subject,'preview',left(a.body,280),'stage',a.stage_key,
      'lead_id',l.id,'lead',l.title,'project',coalesce(l.source,'other'),
      'by',coalesce(a.decision_note,case when a.status='pending' then 'Autopilot — needs your approval' end),
      'delivery',null)
    from sav_ai_crm.customer_email_approvals a join sav_ai_crm.leads l on l.id=a.lead_id
    where a.workspace_id=ws and a.status<>'sent'

    union all
    -- 3. AI sales emails
    select jsonb_build_object(
      'at',coalesce(d.sent_at,d.approved_at,d.created_at),'channel','email','kind','Sales email',
      'status',case d.status when 'sent' then 'sent' when 'draft' then 'draft (not sent)' when 'approved' then 'approved, not sent yet' else 'not sent ('||d.status||')' end,
      'recipient',d.recipient,'subject',d.subject,'preview',left(d.body,280),'stage',null,
      'lead_id',l.id,'lead',l.title,'project',coalesce(l.source,'other'),
      'by',(select a2.name from sav_ai_crm.ai_agents a2 where a2.id=d.agent_id),'delivery',d.error_message)
    from sav_ai_crm.sales_email_drafts d join sav_ai_crm.leads l on l.id=d.lead_id
    where d.workspace_id=ws

    union all
    -- 4. Inbox messages sent to customers (WhatsApp / SMS / email / voice)
    select jsonb_build_object(
      'at',m.created_at,'channel',m.channel,'kind',initcap(m.channel)||' message',
      'status',lower(coalesce(m.delivery_status,'queued')),'recipient',m.recipient,'subject',null,'preview',left(m.body,280),'stage',null,
      'lead_id',c.lead_id,'lead',l.title,'project',coalesce(l.source,'other'),
      'by',coalesce(m.sender_name,(select a3.name from sav_ai_crm.ai_agents a3 where a3.id=m.sent_by_agent_id)),'delivery',m.error_message)
    from sav_ai_crm.messages m
    left join sav_ai_crm.conversations c on c.id=m.conversation_id
    left join sav_ai_crm.leads l on l.id=c.lead_id
    where m.workspace_id=ws and m.direction='outbound'

    union all
    -- 5. Notifications addressed to someone outside the team
    select jsonb_build_object(
      'at',coalesce(n.sent_at,n.created_at),'channel',n.channel,'kind','Notification',
      'status',lower(n.status),'recipient',n.recipient_address,'subject',n.title,'preview',left(n.body,280),'stage',null,
      'lead_id',n.lead_id,'lead',l.title,'project',coalesce(l.source,'other'),
      'by',(select a4.name from sav_ai_crm.ai_agents a4 where a4.id=n.agent_id),'delivery',n.error_message)
    from sav_ai_crm.notifications n left join sav_ai_crm.leads l on l.id=n.lead_id
    where n.workspace_id=ws and n.recipient_address is not null
  ) x;

  return jsonb_build_object(
    'summary',jsonb_build_object(
      'sent',(select count(*) from jsonb_array_elements(items) e where e->>'status' in ('sent','delivered','read')),
      'waiting',(select count(*) from jsonb_array_elements(items) e where e->>'status' like 'waiting%'),
      'not_sent',(select count(*) from jsonb_array_elements(items) e where e->>'status' like 'not sent%' or e->>'status' like 'draft%'),
      'customers',(select count(distinct e->>'recipient') from jsonb_array_elements(items) e where e->>'status' in ('sent','delivered','read'))
    ),
    'items',(select coalesce(jsonb_agg(e),'[]'::jsonb) from (select e from jsonb_array_elements(items) e limit greatest(1,least(coalesce(p_limit,100),300))) y)
  );
end $$;

revoke all on function public.sav_ai_crm_workflow_run_log(integer), public.sav_ai_crm_customer_message_log(integer) from public, anon;
grant execute on function public.sav_ai_crm_workflow_run_log(integer), public.sav_ai_crm_customer_message_log(integer) to authenticated, service_role;
