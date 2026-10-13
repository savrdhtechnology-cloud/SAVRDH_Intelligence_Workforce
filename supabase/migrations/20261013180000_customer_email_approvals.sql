-- =============================================================================
-- Customer email approvals (13 Oct 2026)
--
-- Founder rule: no email may reach an AKBS customer without the founder seeing
-- and approving it first. Until now the hourly autopilot sent reminder emails on
-- its own (send_autopilot_email via Resend).
--
-- Now, when a reminder becomes due, the autopilot only files a PENDING approval
-- (recipient, subject, full text) and pauses that lead's reminder schedule. An
-- owner/admin approves it in Admin → Human Approvals (then it is sent) or skips
-- it. If the lead's stage, status or email changes before the decision, the
-- request is superseded and nothing is sent. Agent tasks are created as before.
-- =============================================================================

create table if not exists sav_ai_crm.customer_email_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references sav_ai_crm.workspaces(id) on delete cascade,
  lead_id uuid not null references sav_ai_crm.leads(id) on delete cascade,
  stage_key text not null,
  attempt integer not null check (attempt between 1 and 3),
  recipient text not null,
  subject text not null,
  body text not null,
  status text not null default 'pending'
    check (status in ('pending','sent','rejected','superseded','failed')),
  decided_by_member uuid references sav_ai_crm.members(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  http_request_id bigint,
  error text,
  created_at timestamptz not null default now()
);
create unique index if not exists customer_email_approvals_one_pending
  on sav_ai_crm.customer_email_approvals(lead_id) where status='pending';
create index if not exists customer_email_approvals_ws_idx
  on sav_ai_crm.customer_email_approvals(workspace_id, created_at desc);

alter table sav_ai_crm.customer_email_approvals enable row level security;
revoke all on sav_ai_crm.customer_email_approvals from public, anon, authenticated;
grant select, insert, update, delete on sav_ai_crm.customer_email_approvals to service_role;

-- Email text in one place (used for the approval preview and for sending) ------
create or replace function sav_ai_crm.autopilot_email_content(p_lead_id uuid, p_stage_key text)
returns table(subject text, body text) language plpgsql stable security definer
set search_path=public,sav_ai_crm
as $$
declare l sav_ai_crm.leads;
begin
  select * into l from sav_ai_crm.leads where id=p_lead_id;
  if l.id is null then return; end if;
  if p_stage_key='FEE_PENDING' then
    subject:='AKBS Fee Payment Reminder'||case when nullif(l.metadata->>'application_id','') is not null then ' - '||(l.metadata->>'application_id') else '' end;
    body:='Namaste '||l.title||' ji,'||E'\n\n'||
      'Aapki AKBS application ki registration/application fee abhi pending hai.'||E'\n'||
      'Kripya payment complete karke UTR / transaction reference aur payment proof Customer Portal me submit karein.'||E'\n'||
      'Payment verify hone ke baad next processing automatically continue hogi.'||E'\n\n'||
      'Customer Portal: https://crm.akbspoultry.com/customer-registration'||E'\n\n'||
      'Regards,'||E'\nAKBS Poultry Farming Private Limited';
    return next;
  elsif p_stage_key in ('NEW','CONTACTED') then
    subject:='AKBS Application Follow-up';
    body:='Namaste '||l.title||' ji,'||E'\n\n'||
      'AKBS Poultry Farming Private Limited ki taraf se aapki enquiry/application ke sambandh me follow-up hai.'||E'\n'||
      'Agar aapki taraf se koi information ya next step pending hai, kripya Customer Portal me process complete karein ya AKBS team se sampark karein.'||E'\n\n'||
      'Customer Portal: https://crm.akbspoultry.com/customer-registration'||E'\n\n'||
      'Regards,'||E'\nAKBS Poultry Farming Private Limited';
    return next;
  end if;
end $$;
revoke all on function sav_ai_crm.autopilot_email_content(uuid,text) from public, anon, authenticated;

-- Sender now reads the shared text (behaviour unchanged) -----------------------
create or replace function sav_ai_crm.send_autopilot_email(p_lead_id uuid, p_stage_key text, p_attempt integer)
returns bigint language plpgsql security definer
set search_path to 'public', 'sav_ai_crm', 'vault', 'net'
as $$
declare
  l sav_ai_crm.leads;
  v_key text;
  v_subject text;
  v_body text;
  v_request_id bigint;
begin
  select * into l from sav_ai_crm.leads where id=p_lead_id for update;
  if l.id is null or l.source<>'akbs' or nullif(trim(coalesce(l.email,'')),'') is null then
    return null;
  end if;

  if lower(coalesce(l.status,'')) in ('won','lost','closed') then return null; end if;

  select c.subject,c.body into v_subject,v_body from sav_ai_crm.autopilot_email_content(l.id,p_stage_key) c;
  if v_subject is null then return null; end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name='akbs_workforce_resend_key'
  limit 1;

  if coalesce(v_key,'')='' then raise exception 'AKBS autopilot sender secret missing'; end if;

  select net.http_post(
    url:='https://api.resend.com/emails',
    body:=jsonb_build_object(
      'from','AKBS Poultry Farming Private Limited <updates@akbspoultry.com>',
      'to',jsonb_build_array(lower(trim(l.email))),
      'subject',v_subject,
      'text',v_body
    ),
    headers:=jsonb_build_object(
      'Authorization','Bearer '||v_key,
      'Content-Type','application/json',
      'Idempotency-Key','akbs-autopilot-'||l.id::text||'-'||p_stage_key||'-'||p_attempt::text
    ),
    timeout_milliseconds:=10000
  ) into v_request_id;

  return v_request_id;
end $$;
revoke execute on function sav_ai_crm.send_autopilot_email(uuid,text,integer) from public, anon, authenticated;
grant execute on function sav_ai_crm.send_autopilot_email(uuid,text,integer) to service_role;

-- Autopilot evaluator: identical to the live version except reminders --------
-- (a due reminder now files an approval instead of sending) and stage changes
-- supersede any pending approval for that lead.
create or replace function sav_ai_crm.evaluate_akbs_autopilot(p_lead_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'public', 'sav_ai_crm'
as $$
declare
  l sav_ai_crm.leads;
  s sav_ai_crm.lead_autopilot_state;
  v_stage text;
  v_agent_id uuid;
  v_task_id uuid;
  v_created boolean:=false;
  v_awaiting boolean:=false;
  v_subject text;
  v_body text;
  v_approval_id uuid;
begin
  select * into l from sav_ai_crm.leads where id=p_lead_id for update;
  if l.id is null or l.source<>'akbs' then
    return jsonb_build_object('ok',true,'skipped',true,'reason','OUT_OF_SCOPE');
  end if;

  v_stage:=sav_ai_crm.derive_akbs_autopilot_stage(l.id);

  select * into s from sav_ai_crm.lead_autopilot_state where lead_id=l.id for update;

  if s.lead_id is null then
    insert into sav_ai_crm.lead_autopilot_state(
      lead_id,workspace_id,stage_key,stage_started_at,reminder_count,next_reminder_at,is_suppressed,updated_at
    ) values(
      l.id,l.workspace_id,v_stage,now(),0,
      case when v_stage in ('NEW','CONTACTED','FEE_PENDING') then now()+interval '24 hours' else null end,
      v_stage in ('CLOSED','FEE_REVIEW'),
      now()
    )
    returning * into s;
  elsif s.stage_key<>v_stage then
    update sav_ai_crm.customer_email_approvals
    set status='superseded',decided_at=now(),decision_note='Lead moved from '||s.stage_key||' to '||v_stage||' before a decision'
    where lead_id=l.id and status='pending';

    update sav_ai_crm.lead_autopilot_state
    set stage_key=v_stage,
        stage_started_at=now(),
        reminder_count=0,
        last_reminder_at=null,
        next_reminder_at=case when v_stage in ('NEW','CONTACTED','FEE_PENDING') then now()+interval '24 hours' else null end,
        last_action_at=null,
        escalated_at=null,
        is_suppressed=v_stage in ('CLOSED','FEE_REVIEW'),
        suppression_reason=case when v_stage='CLOSED' then 'lead_closed' when v_stage='FEE_REVIEW' then 'payment_under_review' else null end,
        updated_at=now()
    where lead_id=l.id
    returning * into s;

    insert into sav_ai_crm.lead_autopilot_events(
      lead_id,workspace_id,stage_key,event_type,metadata
    ) values(
      l.id,l.workspace_id,v_stage,'stage_changed',
      jsonb_build_object('lead_status',l.status,'akbs_stage',l.metadata->>'akbs_stage','fee_status',l.metadata->>'fee_status')
    );
  end if;

  if v_stage='CLOSED' then
    update sav_ai_crm.customer_email_approvals
    set status='superseded',decided_at=now(),decision_note='Lead closed before a decision'
    where lead_id=l.id and status='pending';
    update sav_ai_crm.lead_autopilot_state
    set is_suppressed=true,suppression_reason='lead_closed',next_reminder_at=null,updated_at=now()
    where lead_id=l.id;
    return jsonb_build_object('ok',true,'stage',v_stage,'suppressed',true);
  end if;

  if v_stage='FEE_REVIEW' then
    update sav_ai_crm.customer_email_approvals
    set status='superseded',decided_at=now(),decision_note='Payment proof under review before a decision'
    where lead_id=l.id and status='pending';
    perform sav_ai_crm.apply_akbs_fee_gate(l.id);
    update sav_ai_crm.lead_autopilot_state
    set is_suppressed=true,suppression_reason='payment_under_review',next_reminder_at=null,updated_at=now()
    where lead_id=l.id;
    return jsonb_build_object('ok',true,'stage',v_stage,'suppressed',true);
  end if;

  if v_stage='FEE_PENDING' then
    perform sav_ai_crm.apply_akbs_fee_gate(l.id);
  end if;

  if s.last_action_at is null then
    if v_stage='NEW' then
      select id into v_agent_id from sav_ai_crm.ai_agents
      where workspace_id=l.workspace_id and slug='sav-sales' and status='active' limit 1;
      if v_agent_id is not null then
        insert into sav_ai_crm.tasks(
          workspace_id,lead_id,contact_id,title,description,task_type,status,priority,
          assigned_agent_id,followup_type,notes
        ) values(
          l.workspace_id,l.id,l.contact_id,
          'Autopilot: New lead qualification — '||l.title,
          'Automatically review and qualify this new AKBS lead, record the next valid action, and do not invent missing information.',
          'followup','pending','high',v_agent_id,'sales',
          'autopilot:stage=NEW'
        ) returning id into v_task_id;
        v_created:=true;
      end if;
    elsif v_stage='CONTACTED' then
      select id into v_agent_id from sav_ai_crm.ai_agents
      where workspace_id=l.workspace_id and slug='sav-followup' and status='active' limit 1;
      if v_agent_id is not null then
        insert into sav_ai_crm.tasks(
          workspace_id,lead_id,contact_id,title,description,task_type,status,priority,
          assigned_agent_id,followup_type,notes
        ) values(
          l.workspace_id,l.id,l.contact_id,
          'Autopilot: Customer follow-up — '||l.title,
          'Review the contacted lead for the next pending customer action. External reminders are controlled separately by the anti-spam scheduler.',
          'followup','pending','medium',v_agent_id,'followup',
          'autopilot:stage=CONTACTED'
        ) returning id into v_task_id;
        v_created:=true;
      end if;
    elsif v_stage='DOCUMENTS' then
      select id into v_agent_id from sav_ai_crm.ai_agents
      where workspace_id=l.workspace_id and slug='sav-document' and status='active' limit 1;
      if v_agent_id is not null then
        insert into sav_ai_crm.tasks(
          workspace_id,lead_id,contact_id,title,description,task_type,status,priority,
          assigned_agent_id,followup_type,notes
        ) values(
          l.workspace_id,l.id,l.contact_id,
          'Autopilot: Document review — '||l.title,
          'Review available application/document context and identify the next document action. Do not request documents already present.',
          'followup','pending','medium',v_agent_id,'document',
          'autopilot:stage=DOCUMENTS'
        ) returning id into v_task_id;
        v_created:=true;
      end if;
    elsif v_stage='QUALIFIED' then
      select id into v_agent_id from sav_ai_crm.ai_agents
      where workspace_id=l.workspace_id and slug='sav-credit' and status='active' limit 1;
      if v_agent_id is not null then
        insert into sav_ai_crm.tasks(
          workspace_id,lead_id,contact_id,title,description,task_type,status,priority,
          assigned_agent_id,followup_type,notes
        ) values(
          l.workspace_id,l.id,l.contact_id,
          'Autopilot: Credit review — '||l.title,
          'Review verified lead/application data and prepare the next credit-review action. Do not make a lending decision.',
          'followup','pending','high',v_agent_id,'credit',
          'autopilot:stage=QUALIFIED'
        ) returning id into v_task_id;
        v_created:=true;
      end if;
    elsif v_stage in ('PROPOSAL','NEGOTIATION') then
      select id into v_agent_id from sav_ai_crm.ai_agents
      where workspace_id=l.workspace_id and slug='sav-sales-manager' and status='active' limit 1;
      if v_agent_id is not null then
        insert into sav_ai_crm.tasks(
          workspace_id,lead_id,contact_id,title,description,task_type,status,priority,
          assigned_agent_id,followup_type,notes
        ) values(
          l.workspace_id,l.id,l.contact_id,
          'Autopilot: Manager review — '||l.title,
          'Review the current sales stage, pending actions, and escalation needs.',
          'followup','pending','high',v_agent_id,'manager_review',
          'autopilot:stage='||v_stage
        ) returning id into v_task_id;
        v_created:=true;
      end if;
    end if;

    update sav_ai_crm.lead_autopilot_state
    set last_action_at=now(),updated_at=now()
    where lead_id=l.id;

    if v_task_id is not null then
      insert into sav_ai_crm.lead_autopilot_events(
        lead_id,workspace_id,stage_key,event_type,task_id,metadata
      ) values(
        l.id,l.workspace_id,v_stage,'agent_task_created',v_task_id,
        jsonb_build_object('agent_id',v_agent_id)
      );
    end if;
  end if;

  select * into s from sav_ai_crm.lead_autopilot_state where lead_id=l.id for update;

  if not s.is_suppressed
     and s.next_reminder_at is not null
     and s.next_reminder_at<=now()
     and s.reminder_count<3
     and v_stage in ('NEW','CONTACTED','FEE_PENDING')
     and nullif(trim(coalesce(l.email,'')),'') is not null then

    select c.subject,c.body into v_subject,v_body from sav_ai_crm.autopilot_email_content(l.id,v_stage) c;
    if v_subject is not null then
      insert into sav_ai_crm.customer_email_approvals(workspace_id,lead_id,stage_key,attempt,recipient,subject,body)
      values(l.workspace_id,l.id,v_stage,s.reminder_count+1,lower(trim(l.email)),v_subject,v_body)
      on conflict do nothing
      returning id into v_approval_id;

      -- Pause this lead's reminder schedule until the founder decides.
      update sav_ai_crm.lead_autopilot_state set next_reminder_at=null,updated_at=now() where lead_id=l.id;

      if v_approval_id is not null then
        v_awaiting:=true;
        insert into sav_ai_crm.lead_autopilot_events(
          lead_id,workspace_id,stage_key,event_type,channel,metadata
        ) values(
          l.id,l.workspace_id,v_stage,'reminder_awaiting_approval','email',
          jsonb_build_object('attempt',s.reminder_count+1,'approval_id',v_approval_id)
        );
        insert into sav_ai_crm.activities(
          workspace_id,lead_id,contact_id,activity_type,title,description,channel,metadata
        ) values(
          l.workspace_id,l.id,l.contact_id,'autopilot_reminder_awaiting_approval',
          'Reminder waiting for approval',
          'Reminder '||(s.reminder_count+1)::text||' of 3 for stage '||v_stage||' is waiting for approval before it is sent.',
          'email',
          jsonb_build_object('stage',v_stage,'attempt',s.reminder_count+1,'approval_id',v_approval_id)
        );
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok',true,
    'lead_id',l.id,
    'stage',v_stage,
    'task_created',v_created,
    'task_id',v_task_id,
    'reminder_queued',false,
    'reminder_awaiting_approval',v_awaiting
  );
end $$;
revoke execute on function sav_ai_crm.evaluate_akbs_autopilot(uuid) from public, anon, authenticated;
grant execute on function sav_ai_crm.evaluate_akbs_autopilot(uuid) to service_role;

-- Members: list email approvals ------------------------------------------------
create or replace function public.sav_ai_crm_customer_email_approvals()
returns jsonb language plpgsql security definer
set search_path=public,sav_ai_crm
as $$
declare me sav_ai_crm.members;
begin
  me:=sav_ai_crm.agent_current_member();
  if me.id is null then raise exception 'CRM membership required'; end if;
  return jsonb_build_object(
    'can_approve',me.role in ('owner','admin'),
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'status',a.status,'stage',a.stage_key,'attempt',a.attempt,
        'recipient',a.recipient,'subject',a.subject,'body',a.body,
        'lead_id',a.lead_id,'lead_title',l.title,'lead_status',l.status,
        'created_at',a.created_at,'decided_at',a.decided_at,'decision_note',a.decision_note,'error',a.error,
        'decided_by',(select coalesce(m.full_name,m.email,m.role) from sav_ai_crm.members m where m.id=a.decided_by_member)
      ) order by (a.status='pending') desc, a.created_at desc)
      from (select * from sav_ai_crm.customer_email_approvals
            where workspace_id=me.workspace_id order by (status='pending') desc, created_at desc limit 50) a
      left join sav_ai_crm.leads l on l.id=a.lead_id
    ),'[]'::jsonb)
  );
end $$;

-- Owner/admin: approve (send now) or skip -------------------------------------
create or replace function public.sav_ai_crm_review_customer_email(p_approval_id uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer
set search_path=public,sav_ai_crm
as $$
declare
  me sav_ai_crm.members; a sav_ai_crm.customer_email_approvals; l sav_ai_crm.leads;
  v_stage text; v_request_id bigint; v_next timestamptz; v_reason text;
begin
  me:=sav_ai_crm.agent_current_member();
  if me.id is null or me.role not in ('owner','admin') then
    raise exception 'Only an owner or admin can approve customer emails';
  end if;
  if p_decision not in ('approve','reject') then raise exception 'Decision must be approve or reject'; end if;

  select * into a from sav_ai_crm.customer_email_approvals
  where id=p_approval_id and workspace_id=me.workspace_id for update;
  if a.id is null then raise exception 'Email approval not found'; end if;
  if a.status<>'pending' then raise exception 'This email is already %', a.status; end if;

  select * into l from sav_ai_crm.leads where id=a.lead_id for update;
  v_stage:=case when l.id is null then 'MISSING' else sav_ai_crm.derive_akbs_autopilot_stage(l.id) end;

  -- Never send on stale information.
  if l.id is null then v_reason:='Lead no longer exists';
  elsif v_stage<>a.stage_key then v_reason:='Lead is now in stage '||v_stage;
  elsif lower(trim(coalesce(l.email,'')))<>a.recipient then v_reason:='Lead email address changed';
  end if;
  if v_reason is not null then
    update sav_ai_crm.customer_email_approvals
    set status='superseded',decided_by_member=me.id,decided_at=now(),decision_note=v_reason||'. Nothing was sent.'
    where id=a.id;
    if l.id is not null and v_stage=a.stage_key then
      -- same stage but new address: let the next hourly run file a fresh request
      update sav_ai_crm.lead_autopilot_state set next_reminder_at=now(),updated_at=now() where lead_id=l.id;
    end if;
    return jsonb_build_object('ok',false,'status','superseded','error',v_reason||'. Nothing was sent.');
  end if;

  v_next:=case a.attempt when 1 then now()+interval '3 days' when 2 then now()+interval '7 days' else null end;

  if p_decision='approve' then
    v_request_id:=sav_ai_crm.send_autopilot_email(l.id,a.stage_key,a.attempt);
    if v_request_id is null then
      update sav_ai_crm.customer_email_approvals
      set status='failed',decided_by_member=me.id,decided_at=now(),error='Email could not be queued (lead closed or no email)'
      where id=a.id;
      return jsonb_build_object('ok',false,'status','failed','error','Email could not be queued (lead closed or no email)');
    end if;
    update sav_ai_crm.customer_email_approvals
    set status='sent',decided_by_member=me.id,decided_at=now(),decision_note=nullif(trim(coalesce(p_note,'')),''),http_request_id=v_request_id
    where id=a.id;
    update sav_ai_crm.lead_autopilot_state
    set reminder_count=greatest(reminder_count,a.attempt),last_reminder_at=now(),next_reminder_at=v_next,
        escalated_at=case when a.attempt>=3 then now() else escalated_at end,updated_at=now()
    where lead_id=l.id;
    insert into sav_ai_crm.lead_autopilot_events(lead_id,workspace_id,stage_key,event_type,channel,metadata)
    values(l.id,l.workspace_id,a.stage_key,'reminder_queued','email',
      jsonb_build_object('attempt',a.attempt,'http_request_id',v_request_id,'approval_id',a.id,'approved_by',me.id));
    insert into sav_ai_crm.activities(workspace_id,lead_id,contact_id,actor_member_id,activity_type,title,description,channel,metadata)
    values(l.workspace_id,l.id,l.contact_id,me.id,'autopilot_reminder_queued','Autopilot reminder approved and queued',
      'Reminder '||a.attempt::text||' of 3 for stage '||a.stage_key||' approved and queued.','email',
      jsonb_build_object('stage',a.stage_key,'attempt',a.attempt,'http_request_id',v_request_id,'approval_id',a.id));
  else
    update sav_ai_crm.customer_email_approvals
    set status='rejected',decided_by_member=me.id,decided_at=now(),decision_note=nullif(trim(coalesce(p_note,'')),'')
    where id=a.id;
    update sav_ai_crm.lead_autopilot_state
    set reminder_count=greatest(reminder_count,a.attempt),next_reminder_at=v_next,
        escalated_at=case when a.attempt>=3 then now() else escalated_at end,updated_at=now()
    where lead_id=l.id;
    insert into sav_ai_crm.lead_autopilot_events(lead_id,workspace_id,stage_key,event_type,channel,metadata)
    values(l.id,l.workspace_id,a.stage_key,'reminder_rejected','email',
      jsonb_build_object('attempt',a.attempt,'approval_id',a.id,'rejected_by',me.id));
    insert into sav_ai_crm.activities(workspace_id,lead_id,contact_id,actor_member_id,activity_type,title,description,channel,metadata)
    values(l.workspace_id,l.id,l.contact_id,me.id,'autopilot_reminder_rejected','Autopilot reminder skipped',
      'Reminder '||a.attempt::text||' of 3 for stage '||a.stage_key||' was not sent (skipped by approver).','email',
      jsonb_build_object('stage',a.stage_key,'attempt',a.attempt,'approval_id',a.id));
  end if;

  insert into sav_ai_crm.audit_logs(workspace_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(me.workspace_id,auth.uid(),case when p_decision='approve' then 'customer_email.approved' else 'customer_email.rejected' end,
    'customer_email_approval',a.id,jsonb_build_object('lead_id',l.id,'stage',a.stage_key,'attempt',a.attempt,'note',p_note));

  return jsonb_build_object('ok',true,'status',case when p_decision='approve' then 'sent' else 'rejected' end);
end $$;

revoke all on function public.sav_ai_crm_customer_email_approvals(),
  public.sav_ai_crm_review_customer_email(uuid,text,text) from public, anon;
grant execute on function public.sav_ai_crm_customer_email_approvals(),
  public.sav_ai_crm_review_customer_email(uuid,text,text) to authenticated, service_role;

-- Trial runs: count reminders that went to approval (reminders are no longer sent directly).
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
        if coalesce((v_one->>'reminder_awaiting_approval')::boolean,false) then v_emails:=v_emails+1; end if;
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
