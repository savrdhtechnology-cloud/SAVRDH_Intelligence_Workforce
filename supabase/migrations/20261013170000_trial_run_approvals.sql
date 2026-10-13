-- =============================================================================
-- Trial-run approvals (13 Oct 2026)
--
-- Founder rule: no autopilot trial runs without the founder's approval in the
-- admin. A trial is first filed as a PENDING request with a preview of what it
-- would do (leads, tasks it would create, reminder emails it would send). Only an
-- owner/admin pressing "Approve & run" in Admin → Human Approvals executes it.
--
-- The hourly pg_cron autopilot is NOT affected (founder chose to keep it running).
-- =============================================================================

create table if not exists sav_ai_crm.trial_run_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references sav_ai_crm.workspaces(id) on delete cascade,
  scope text not null default 'akbs' check (scope in ('akbs')),
  lead_limit integer not null default 250 check (lead_limit between 1 and 500),
  reason text not null check (length(trim(reason)) between 3 and 1000),
  requested_by_member uuid references sav_ai_crm.members(id) on delete set null,
  requested_by_label text not null,
  preview jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','rejected','running','completed','failed','expired')),
  decided_by_member uuid references sav_ai_crm.members(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null default now()+interval '72 hours'
);
create index if not exists trial_run_requests_ws_idx on sav_ai_crm.trial_run_requests(workspace_id, created_at desc);
create unique index if not exists trial_run_requests_one_running on sav_ai_crm.trial_run_requests(workspace_id) where status='running';

alter table sav_ai_crm.trial_run_requests enable row level security;
revoke all on sav_ai_crm.trial_run_requests from public, anon, authenticated;
grant select, insert, update, delete on sav_ai_crm.trial_run_requests to service_role;

-- What a trial would do right now (read-only) ---------------------------------
create or replace function sav_ai_crm.trial_run_preview(p_workspace_id uuid, p_lead_limit integer)
returns jsonb language plpgsql stable security definer
set search_path=public,sav_ai_crm
as $$
declare
  rec record; s sav_ai_crm.lead_autopilot_state; v_stage text;
  v_leads int:=0; v_tasks int:=0; v_emails int:=0; v_by_stage jsonb:='{}'::jsonb; v_queue int;
begin
  for rec in
    select l.id,l.email from sav_ai_crm.leads l
    where l.workspace_id=p_workspace_id and l.source='akbs'
    order by l.updated_at desc
    limit greatest(1,least(coalesce(p_lead_limit,250),500))
  loop
    v_leads:=v_leads+1;
    v_stage:=sav_ai_crm.derive_akbs_autopilot_stage(rec.id);
    v_by_stage:=jsonb_set(v_by_stage,array[v_stage],to_jsonb(coalesce((v_by_stage->>v_stage)::int,0)+1));
    select * into s from sav_ai_crm.lead_autopilot_state where lead_id=rec.id;

    -- New agent task: first time a lead is seen in a stage that has an agent.
    if v_stage in ('NEW','CONTACTED','DOCUMENTS','QUALIFIED','PROPOSAL','NEGOTIATION')
       and (s.lead_id is null or s.stage_key<>v_stage or s.last_action_at is null) then
      v_tasks:=v_tasks+1;
    end if;

    -- Reminder email: only when the lead stays in the same stage and its reminder is due
    -- (a new or changed stage schedules the first reminder 24 hours later).
    if s.lead_id is not null and s.stage_key=v_stage and not s.is_suppressed
       and s.next_reminder_at is not null and s.next_reminder_at<=now() and s.reminder_count<3
       and v_stage in ('NEW','CONTACTED','FEE_PENDING')
       and nullif(trim(coalesce(rec.email,'')),'') is not null then
      v_emails:=v_emails+1;
    end if;
  end loop;

  select count(*) into v_queue
  from sav_ai_crm.tasks t
  join sav_ai_crm.ai_agents a on a.id=t.assigned_agent_id and a.status='active'
  join sav_ai_crm.agent_test_targets tt on tt.agent_id=a.id and tt.lead_id=t.lead_id and tt.enabled
  join sav_ai_crm.agent_autonomous_profiles p on p.agent_slug=a.slug and p.is_enabled
  where t.workspace_id=p_workspace_id and t.archived_at is null and t.status='pending'
    and lower(coalesce(t.followup_type,''))<>'email';

  return jsonb_build_object(
    'leads',v_leads,'by_stage',v_by_stage,
    'tasks_to_create',v_tasks,'emails_to_send',v_emails,'queued_agent_tasks',v_queue,
    'computed_at',now()
  );
end $$;
revoke all on function sav_ai_crm.trial_run_preview(uuid,integer) from public, anon, authenticated;

-- Shared insert (used by members and by server-side automation) -----------------
create or replace function sav_ai_crm.trial_run_insert(
  p_workspace_id uuid, p_member_id uuid, p_label text, p_reason text, p_lead_limit integer
) returns jsonb language plpgsql security definer
set search_path=public,sav_ai_crm
as $$
declare r sav_ai_crm.trial_run_requests; v_limit int;
begin
  if coalesce(length(trim(p_reason)),0)<3 then raise exception 'Please give a reason for the trial run'; end if;
  v_limit:=greatest(1,least(coalesce(p_lead_limit,250),500));
  insert into sav_ai_crm.trial_run_requests(workspace_id,lead_limit,reason,requested_by_member,requested_by_label,preview)
  values(p_workspace_id,v_limit,trim(p_reason),p_member_id,coalesce(nullif(trim(p_label),''),'system'),
         sav_ai_crm.trial_run_preview(p_workspace_id,v_limit))
  returning * into r;
  insert into sav_ai_crm.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(p_workspace_id,auth.uid(),'trial_run.requested','trial_run_request',r.id,
         jsonb_build_object('reason',r.reason,'lead_limit',r.lead_limit,'requested_by',r.requested_by_label,'preview',r.preview));
  return to_jsonb(r);
end $$;
revoke all on function sav_ai_crm.trial_run_insert(uuid,uuid,text,text,integer) from public, anon, authenticated;

-- Server / automation: file a request for the founder to approve (service role only).
create or replace function sav_ai_crm.request_trial_run_system(
  p_workspace_id uuid, p_reason text, p_lead_limit integer default 250, p_label text default 'Claude (automation)'
) returns jsonb language sql security definer
set search_path=public,sav_ai_crm
as $$ select sav_ai_crm.trial_run_insert(p_workspace_id,null,p_label,p_reason,p_lead_limit); $$;
revoke all on function sav_ai_crm.request_trial_run_system(uuid,text,integer,text) from public, anon, authenticated;
grant execute on function sav_ai_crm.request_trial_run_system(uuid,text,integer,text) to service_role;

-- Members: file a request --------------------------------------------------------
create or replace function public.sav_ai_crm_request_trial_run(p_reason text, p_lead_limit integer default 250)
returns jsonb language plpgsql security definer
set search_path=public,sav_ai_crm
as $$
declare me sav_ai_crm.members;
begin
  me:=sav_ai_crm.agent_current_member();
  if me.id is null or me.role='viewer' then raise exception 'CRM write permission required'; end if;
  return sav_ai_crm.trial_run_insert(me.workspace_id,me.id,coalesce(me.full_name,me.email,me.role),p_reason,p_lead_limit);
end $$;

-- Members: list requests (pending ones carry a fresh preview) ---------------------
create or replace function public.sav_ai_crm_trial_run_requests()
returns jsonb language plpgsql security definer
set search_path=public,sav_ai_crm
as $$
declare me sav_ai_crm.members;
begin
  me:=sav_ai_crm.agent_current_member();
  if me.id is null then raise exception 'CRM membership required'; end if;

  update sav_ai_crm.trial_run_requests set status='expired'
  where workspace_id=me.workspace_id and status='pending' and expires_at<now();

  return jsonb_build_object(
    'can_approve',me.role in ('owner','admin'),
    'requests',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',r.id,'status',r.status,'reason',r.reason,'lead_limit',r.lead_limit,
        'requested_by',r.requested_by_label,'created_at',r.created_at,'expires_at',r.expires_at,
        'preview',case when r.status='pending' then sav_ai_crm.trial_run_preview(r.workspace_id,r.lead_limit) else r.preview end,
        'decided_by',(select coalesce(m.full_name,m.email,m.role) from sav_ai_crm.members m where m.id=r.decided_by_member),
        'decided_at',r.decided_at,'decision_note',r.decision_note,
        'result',r.result,'error',r.error,'completed_at',r.completed_at
      ) order by r.created_at desc)
      from (select * from sav_ai_crm.trial_run_requests
            where workspace_id=me.workspace_id order by created_at desc limit 50) r
    ),'[]'::jsonb)
  );
end $$;

-- Owner/admin: approve (runs the trial now) or reject ----------------------------
create or replace function public.sav_ai_crm_review_trial_run(p_request_id uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer
set search_path=public,sav_ai_crm
as $$
declare
  me sav_ai_crm.members; r sav_ai_crm.trial_run_requests; rec record; v_one jsonb;
  v_details jsonb:='[]'::jsonb; v_errors int:=0; v_processed int:=0; v_tasks int:=0; v_emails int:=0;
  v_queue jsonb; v_result jsonb;
begin
  me:=sav_ai_crm.agent_current_member();
  if me.id is null or me.role not in ('owner','admin') then
    raise exception 'Only an owner or admin can approve trial runs';
  end if;
  if p_decision not in ('approve','reject') then raise exception 'Decision must be approve or reject'; end if;

  select * into r from sav_ai_crm.trial_run_requests
  where id=p_request_id and workspace_id=me.workspace_id for update;
  if r.id is null then raise exception 'Trial request not found'; end if;
  if r.status<>'pending' then raise exception 'This request is already %', r.status; end if;
  if r.expires_at<now() then
    update sav_ai_crm.trial_run_requests set status='expired' where id=r.id;
    return jsonb_build_object('ok',false,'status','expired','error','This request has expired; please file a new one');
  end if;

  if p_decision='reject' then
    update sav_ai_crm.trial_run_requests
    set status='rejected',decided_by_member=me.id,decided_at=now(),decision_note=nullif(trim(coalesce(p_note,'')),'')
    where id=r.id;
    insert into sav_ai_crm.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata)
    values(me.workspace_id,auth.uid(),'trial_run.rejected','trial_run_request',r.id,jsonb_build_object('note',p_note));
    return jsonb_build_object('ok',true,'status','rejected');
  end if;

  update sav_ai_crm.trial_run_requests
  set status='running',decided_by_member=me.id,decided_at=now(),decision_note=nullif(trim(coalesce(p_note,'')),''),
      started_at=now(),preview=sav_ai_crm.trial_run_preview(r.workspace_id,r.lead_limit)
  where id=r.id;
  insert into sav_ai_crm.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(me.workspace_id,auth.uid(),'trial_run.approved','trial_run_request',r.id,jsonb_build_object('note',p_note));

  begin
    for rec in
      select l.id from sav_ai_crm.leads l
      where l.workspace_id=r.workspace_id and l.source='akbs'
      order by l.updated_at desc
      limit r.lead_limit
    loop
      v_processed:=v_processed+1;
      begin
        v_one:=sav_ai_crm.evaluate_akbs_autopilot(rec.id);
        if coalesce((v_one->>'task_created')::boolean,false) then v_tasks:=v_tasks+1; end if;
        if coalesce((v_one->>'reminder_queued')::boolean,false) then v_emails:=v_emails+1; end if;
        v_details:=v_details||jsonb_build_array(v_one);
      exception when others then
        v_errors:=v_errors+1;
        v_details:=v_details||jsonb_build_array(jsonb_build_object('lead_id',rec.id,'error',sqlerrm));
      end;
    end loop;

    v_queue:=public.sav_ai_crm_process_autonomous_queue(100);

    v_result:=jsonb_build_object(
      'ok',v_errors=0,'processed',v_processed,'errors',v_errors,
      'tasks_created',v_tasks,'emails_queued',v_emails,
      'queue',jsonb_build_object('processed',v_queue->'processed','succeeded',v_queue->'succeeded','failed',v_queue->'failed'),
      'details',v_details
    );
    update sav_ai_crm.trial_run_requests
    set status=case when v_errors=0 then 'completed' else 'failed' end,
        result=v_result,completed_at=now(),
        error=case when v_errors=0 then null else v_errors::text||' lead(s) failed' end
    where id=r.id;
  exception when others then
    v_result:=jsonb_build_object('ok',false,'error',sqlerrm);
    update sav_ai_crm.trial_run_requests set status='failed',error=sqlerrm,result=v_result,completed_at=now() where id=r.id;
  end;

  insert into sav_ai_crm.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(me.workspace_id,auth.uid(),'trial_run.finished','trial_run_request',r.id,v_result-'details');
  return v_result;
end $$;

revoke all on function public.sav_ai_crm_request_trial_run(text,integer),
  public.sav_ai_crm_trial_run_requests(),
  public.sav_ai_crm_review_trial_run(uuid,text,text) from public, anon;
grant execute on function public.sav_ai_crm_request_trial_run(text,integer),
  public.sav_ai_crm_trial_run_requests(),
  public.sav_ai_crm_review_trial_run(uuid,text,text) to authenticated, service_role;
