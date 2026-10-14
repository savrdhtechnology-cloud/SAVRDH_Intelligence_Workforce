-- =============================================================================
-- Agent activity overview (14 Oct 2026) — read-only data for the admin
-- Command Dashboard live flow map: which agent works on which project, what it
-- did recently, autopilot health and pending approvals. No writes.
-- =============================================================================

create or replace function public.sav_ai_crm_agent_activity_overview()
returns jsonb language plpgsql stable security definer
set search_path=public,sav_ai_crm
as $$
declare me sav_ai_crm.members; ws uuid;
begin
  me:=sav_ai_crm.agent_current_member();
  if me.id is null then raise exception 'CRM membership required'; end if;
  ws:=me.workspace_id;

  return jsonb_build_object(
    'generated_at',now(),
    'autopilot',(
      select jsonb_build_object(
        'last_run_at',max(d.start_time),
        'last_status',(array_agg(d.status order by d.start_time desc))[1],
        'runs_24h',count(*) filter (where d.start_time>now()-interval '24 hours'),
        'failed_24h',count(*) filter (where d.start_time>now()-interval '24 hours' and d.status<>'succeeded'),
        'schedule','every hour at minute 7'
      )
      from cron.job_run_details d join cron.job j on j.jobid=d.jobid
      where j.jobname='sav-ai-akbs-autopilot-hourly' and d.start_time>now()-interval '7 days'
    ),
    'approvals',jsonb_build_object(
      'emails',(select count(*) from sav_ai_crm.customer_email_approvals where workspace_id=ws and status='pending'),
      'trials',(select count(*) from sav_ai_crm.trial_run_requests where workspace_id=ws and status='pending'),
      'agent_actions',(select count(*) from sav_ai_crm.ai_agent_approvals where workspace_id=ws and status='pending')
    ),
    'projects',coalesce((
      select jsonb_agg(jsonb_build_object(
        'key',p.source,
        'name',case p.source when 'akbs' then 'AKBS Poultry' when 'engagex' then 'EngageX' else initcap(p.source) end,
        'autopilot',p.source='akbs',
        'leads',p.leads,
        'by_stage',coalesce((
          select jsonb_object_agg(stage,c) from (
            select coalesce(s.stage_key,upper(coalesce(l.status,'new'))) stage,count(*) c
            from sav_ai_crm.leads l left join sav_ai_crm.lead_autopilot_state s on s.lead_id=l.id
            where l.workspace_id=ws and coalesce(l.source,'other')=p.source
            group by 1) x),'{}'::jsonb)
      ) order by p.leads desc)
      from (select coalesce(source,'other') source,count(*) leads from sav_ai_crm.leads
            where workspace_id=ws group by 1) p
    ),'[]'::jsonb),
    'agents',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'slug',a.slug,'name',a.name,'role',a.role_name,'status',a.status,
        'completed',(select count(*) from sav_ai_crm.tasks t where t.assigned_agent_id=a.id and t.archived_at is null and t.status='completed'),
        'open',(select count(*) from sav_ai_crm.tasks t where t.assigned_agent_id=a.id and t.archived_at is null and t.status in ('pending','in_progress')),
        'paused',(select count(*) from sav_ai_crm.tasks t where t.assigned_agent_id=a.id and t.archived_at is null and t.status='paused'),
        'completed_24h',(select count(*) from sav_ai_crm.tasks t where t.assigned_agent_id=a.id and t.status='completed' and t.completed_at>now()-interval '24 hours'),
        'last_activity_at',(select max(greatest(t.updated_at,coalesce(t.completed_at,t.updated_at))) from sav_ai_crm.tasks t where t.assigned_agent_id=a.id),
        'projects',coalesce((
          select jsonb_object_agg(src,jsonb_build_object('completed',done,'open',open,'paused',paused)) from (
            select coalesce(l.source,'other') src,
              count(*) filter (where t.status='completed') done,
              count(*) filter (where t.status in ('pending','in_progress')) open,
              count(*) filter (where t.status='paused') paused
            from sav_ai_crm.tasks t join sav_ai_crm.leads l on l.id=t.lead_id
            where t.assigned_agent_id=a.id and t.archived_at is null group by 1) x),'{}'::jsonb)
      ) order by a.name)
      from sav_ai_crm.ai_agents a where a.workspace_id=ws
    ),'[]'::jsonb),
    'feed',coalesce((
      select jsonb_agg(f order by (f->>'at') desc) from (
        select jsonb_build_object(
          'at',ac.created_at,
          'type',ac.activity_type,
          'title',ac.title,
          'lead',l.title,
          'project',coalesce(l.source,'other'),
          'agent',coalesce(a.slug,ac.metadata->>'agent_slug',
            case when ac.activity_type like 'akbs_fee_gate%' or ac.activity_type like 'autopilot_%' then 'autopilot' end)
        ) f
        from sav_ai_crm.activities ac
        left join sav_ai_crm.leads l on l.id=ac.lead_id
        left join sav_ai_crm.tasks t on t.id=ac.task_id
        left join sav_ai_crm.ai_agents a on a.id=coalesce(t.assigned_agent_id,nullif(ac.metadata->>'agent_id','')::uuid)
        where ac.workspace_id=ws
          and ac.activity_type in ('task_completed','workflow_task_updated','workflow_task_created','workflow_followup_created',
            'agent_task_created','agent_work_routed','agent_autonomous_work_created','akbs_fee_gate_applied','akbs_fee_gate_released',
            'autopilot_reminder_queued','autopilot_reminder_awaiting_approval','autopilot_reminder_rejected','autonomous_dispatch_failed')
        order by ac.created_at desc limit 30) x
    ),'[]'::jsonb)
  );
end $$;

revoke all on function public.sav_ai_crm_agent_activity_overview() from public, anon;
grant execute on function public.sav_ai_crm_agent_activity_overview() to authenticated, service_role;
