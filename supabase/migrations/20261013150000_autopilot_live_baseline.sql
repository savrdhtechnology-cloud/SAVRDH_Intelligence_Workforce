-- =============================================================================
-- Autopilot — live baseline (exported 13 Oct 2026 from project gsudlmrmrefqqodpdeug)
--
-- WHY: the rule-based autopilot below was built directly in the live database and
-- was never committed. This file puts it under version control exactly as it runs
-- today. Every function body is byte-identical to the live definition (verified by
-- md5 of pg_get_functiondef). Applying it to the live project is a no-op.
--
-- WHAT IT DOES (no AI involved — fixed rules):
--   pg_cron "sav-ai-akbs-autopilot-hourly" (minute 7, every hour)
--     -> public.sav_ai_crm_run_autopilot_cycle(250)
--        -> sav_ai_crm.evaluate_akbs_autopilot(lead) for each AKBS lead
--             stage = derive_akbs_autopilot_stage(lead):
--               NEW -> sav-sales task · CONTACTED -> sav-followup task
--               FEE_PENDING / FEE_REVIEW -> apply_akbs_fee_gate (pause downstream work)
--               DOCUMENTS -> sav-document · QUALIFIED -> sav-credit
--               PROPOSAL / NEGOTIATION -> sav-sales-manager · CLOSED -> stop
--             up to 3 email reminders (24h, +3d, +7d) via send_autopilot_email (Resend)
--        -> public.sav_ai_crm_process_autonomous_queue(100)
--             runs each pending agent task through its workflow
--             (task_workflow_routes -> sav_ai_crm_run_task_workflow)
--   trigger trg_register_akbs_lead_agents: AKBS lead -> enable 6 agents for it
--   trigger trg_autonomous_task_dispatch: pending agent task -> run its workflow now
--
-- KNOWN ISSUES (fixed in the follow-up lockdown migration, not here):
--   * run_autopilot_cycle / send_autopilot_email / evaluate / fee gate are executable
--     by anon and authenticated.
--   * Background runs impersonate the first owner/admin via request.jwt.claim.sub.
-- Scope is AKBS only (leads.source='akbs').
-- =============================================================================

-- Tables ----------------------------------------------------------------------
create table if not exists sav_ai_crm.agent_autonomous_profiles (
  agent_slug text not null,
  work_type text not null,
  task_title text not null,
  task_description text not null,
  default_priority text not null default 'medium'::text,
  is_enabled boolean not null default true,
  updated_at timestamp with time zone not null default now(),
  constraint agent_autonomous_profiles_pkey PRIMARY KEY (agent_slug)
);

create table if not exists sav_ai_crm.agent_test_targets (
  agent_id uuid not null,
  lead_id uuid not null,
  enabled boolean not null default true,
  created_at timestamp with time zone not null default now(),
  constraint agent_test_targets_pkey PRIMARY KEY (agent_id, lead_id),
  constraint agent_test_targets_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES sav_ai_crm.ai_agents(id) ON DELETE CASCADE,
  constraint agent_test_targets_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES sav_ai_crm.leads(id) ON DELETE CASCADE
);

create table if not exists sav_ai_crm.agent_work_routing (
  work_type text not null,
  agent_slug text not null,
  task_type text not null default 'followup'::text,
  default_priority text not null default 'medium'::text,
  description text,
  is_active boolean not null default true,
  updated_at timestamp with time zone not null default now(),
  constraint agent_work_routing_pkey PRIMARY KEY (work_type)
);

create table if not exists sav_ai_crm.task_workflow_routes (
  work_type text not null,
  workflow_id uuid,
  is_active boolean not null default true,
  updated_at timestamp with time zone not null default now(),
  constraint task_workflow_routes_pkey PRIMARY KEY (work_type),
  constraint task_workflow_routes_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES sav_ai_crm.workflows(id) ON DELETE SET NULL
);

create table if not exists sav_ai_crm.akbs_fee_followup_state (
  lead_id uuid not null,
  fee_status text not null default 'PENDING'::text,
  reminder_count integer not null default 0,
  last_reminder_at timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  constraint akbs_fee_followup_state_pkey PRIMARY KEY (lead_id),
  constraint akbs_fee_followup_state_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES sav_ai_crm.leads(id) ON DELETE CASCADE
);

create table if not exists sav_ai_crm.lead_autopilot_state (
  lead_id uuid not null,
  workspace_id uuid not null,
  stage_key text not null,
  stage_started_at timestamp with time zone not null default now(),
  reminder_count integer not null default 0,
  last_reminder_at timestamp with time zone,
  next_reminder_at timestamp with time zone,
  last_action_at timestamp with time zone,
  escalated_at timestamp with time zone,
  is_suppressed boolean not null default false,
  suppression_reason text,
  updated_at timestamp with time zone not null default now(),
  constraint lead_autopilot_state_pkey PRIMARY KEY (lead_id),
  constraint lead_autopilot_state_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES sav_ai_crm.leads(id) ON DELETE CASCADE
);
create index if not exists lead_autopilot_due_idx on sav_ai_crm.lead_autopilot_state using btree (next_reminder_at) where (is_suppressed = false);

create table if not exists sav_ai_crm.lead_autopilot_events (
  id uuid not null default gen_random_uuid(),
  lead_id uuid not null,
  workspace_id uuid not null,
  stage_key text not null,
  event_type text not null,
  channel text,
  provider_message_id text,
  task_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  constraint lead_autopilot_events_pkey PRIMARY KEY (id),
  constraint lead_autopilot_events_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES sav_ai_crm.leads(id) ON DELETE CASCADE,
  constraint lead_autopilot_events_task_id_fkey FOREIGN KEY (task_id) REFERENCES sav_ai_crm.tasks(id) ON DELETE SET NULL
);
create index if not exists lead_autopilot_events_lead_idx on sav_ai_crm.lead_autopilot_events using btree (lead_id, created_at desc);

-- Live RLS / grants (as found). The three state/event tables have RLS off but no API grants.
alter table sav_ai_crm.agent_autonomous_profiles enable row level security;
alter table sav_ai_crm.agent_test_targets enable row level security;
alter table sav_ai_crm.agent_work_routing enable row level security;
alter table sav_ai_crm.task_workflow_routes enable row level security;
revoke all on sav_ai_crm.agent_autonomous_profiles, sav_ai_crm.agent_test_targets, sav_ai_crm.agent_work_routing,
  sav_ai_crm.task_workflow_routes, sav_ai_crm.akbs_fee_followup_state, sav_ai_crm.lead_autopilot_state,
  sav_ai_crm.lead_autopilot_events from anon, authenticated;
grant select, insert, update, delete on sav_ai_crm.agent_autonomous_profiles, sav_ai_crm.agent_test_targets,
  sav_ai_crm.agent_work_routing, sav_ai_crm.task_workflow_routes to service_role;

-- Seed rows (as live) ---------------------------------------------------------
insert into sav_ai_crm.agent_work_routing(work_type,agent_slug,task_type,default_priority,description,is_active) values
 ('sales','sav-sales','followup','high','Lead qualification, contact planning and sales actions.',true),
 ('credit','sav-credit','followup','high','Credit, loan eligibility and risk review.',true),
 ('document','sav-document','followup','medium','Document checklist, DPR/documentation and missing-document review.',true),
 ('finance','sav-finance','followup','high','Finance/payment verification. Financial actions remain approval controlled.',true),
 ('followup','sav-followup','followup','medium','Customer follow-up, reminders and pending-action tracking.',true),
 ('manager_review','sav-sales-manager','followup','high','Manager review, escalation and approval-oriented sales supervision.',true)
on conflict (work_type) do nothing;

insert into sav_ai_crm.agent_autonomous_profiles(agent_slug,work_type,task_title,task_description,default_priority,is_enabled) values
 ('sav-sales','sales','Autonomous sales lead review','Qualify the lead from verified CRM data, identify the next sales action, and create/follow the approved sales workflow. Do not invent information or send external communication without approval.','high',true),
 ('sav-credit','credit','Autonomous credit review','Review available credit/loan context, identify missing eligibility inputs, and prepare the next credit-review action. Do not make a lending decision.','high',true),
 ('sav-document','document','Autonomous document review','Review available application/document context, identify missing documents or DPR/documentation work, and prepare the next document action.','medium',true),
 ('sav-finance','finance','Autonomous finance verification','Review available finance/payment context and identify the next verification action. Do not mark payment/disbursement verified without permitted evidence and approval.','high',true),
 ('sav-followup','followup','Autonomous customer follow-up','Review pending customer actions and create the next approved follow-up/reminder. Do not send external communication without approval.','medium',true),
 ('sav-sales-manager','manager_review','Autonomous manager review','Review sales progress, pending tasks and escalations, and prepare manager review actions where needed.','high',true)
on conflict (agent_slug) do nothing;

-- task_workflow_routes points each work_type at a workspace's workflow and is not
-- portable between databases. Live mapping (by workflow name):
--   sales -> "Sales Task Execution"           followup -> "Customer Follow-up Execution"
--   credit -> "Credit Review Execution"       document -> "Document Review Execution"
--   finance -> "Finance Verification Execution"  manager_review -> "Manager Review Execution"

-- Functions (verbatim from live) ----------------------------------------------
CREATE OR REPLACE FUNCTION sav_ai_crm.derive_akbs_autopilot_stage(p_lead_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'sav_ai_crm'
AS $function$
declare
  l sav_ai_crm.leads;
  v_fee text;
  v_stage text;
begin
  select * into l from sav_ai_crm.leads where id=p_lead_id;
  if l.id is null or l.source<>'akbs' then return 'OUT_OF_SCOPE'; end if;

  v_fee:=upper(coalesce(l.metadata->>'fee_status',''));
  v_stage:=upper(coalesce(l.metadata->>'akbs_stage',''));

  if lower(coalesce(l.status,'')) in ('won','lost','closed')
     or v_stage in ('CONVERTED','WON','LOST','CLOSED','COMPLETED') then
    return 'CLOSED';
  end if;

  if coalesce((l.metadata->>'fee_required')::boolean,false) then
    if v_fee in ('PROOF_SUBMITTED','PENDING_VERIFICATION','UNDER_REVIEW') then
      return 'FEE_REVIEW';
    elsif v_fee <> 'VERIFIED' then
      return 'FEE_PENDING';
    end if;
  end if;

  if nullif(l.metadata->>'application_id','') is not null then
    return 'DOCUMENTS';
  end if;

  if lower(coalesce(l.status,''))='contacted' or v_stage='CONTACTED' then
    return 'CONTACTED';
  end if;

  if lower(coalesce(l.status,'')) in ('qualified','proposal','negotiation') then
    return upper(l.status);
  end if;

  return 'NEW';
end $function$
;

CREATE OR REPLACE FUNCTION sav_ai_crm.apply_akbs_fee_gate(p_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'sav_ai_crm'
AS $function$
declare
  l sav_ai_crm.leads;
  v_fee_status text;
  v_fee_required boolean;
begin
  select * into l
  from sav_ai_crm.leads
  where id=p_lead_id
  for update;

  if l.id is null then raise exception 'Lead not found'; end if;
  if l.source<>'akbs' then
    return jsonb_build_object('ok',true,'skipped',true,'reason','not_akbs');
  end if;

  v_fee_status:=upper(coalesce(l.metadata->>'fee_status',''));
  v_fee_required:=coalesce((l.metadata->>'fee_required')::boolean,false);

  if not v_fee_required then
    return jsonb_build_object('ok',true,'skipped',true,'reason','fee_not_required');
  end if;

  insert into sav_ai_crm.akbs_fee_followup_state(lead_id,fee_status,updated_at)
  values(l.id,coalesce(nullif(v_fee_status,''),'PENDING'),now())
  on conflict(lead_id) do update
    set fee_status=excluded.fee_status,updated_at=now();

  if v_fee_status='VERIFIED' then
    update sav_ai_crm.tasks
    set status='completed',
        completed_at=coalesce(completed_at,now()),
        updated_at=now()
    where workspace_id=l.workspace_id
      and lead_id=l.id
      and archived_at is null
      and notes like '%fee-gate:auto%'
      and status not in ('completed','cancelled');

    update sav_ai_crm.tasks t
    set status='pending',
        completed_at=null,
        updated_at=now()
    where t.workspace_id=l.workspace_id
      and t.lead_id=l.id
      and t.archived_at is null
      and t.status='paused'
      and exists(
        select 1
        from sav_ai_crm.ai_agents a
        where a.id=t.assigned_agent_id
          and a.slug='sav-document'
          and a.status='active'
      );

    insert into sav_ai_crm.activities(
      workspace_id,lead_id,contact_id,activity_type,title,description,channel,metadata
    ) values(
      l.workspace_id,l.id,l.contact_id,'akbs_fee_gate_released',
      'Fee verified — document stage released',
      'Registration fee is verified. Document processing may continue. Other downstream stages remain stage-controlled by autopilot.',
      'system',
      jsonb_build_object('fee_status',v_fee_status)
    );

    return jsonb_build_object('ok',true,'gate','released','next_stage','DOCUMENTS');
  end if;

  update sav_ai_crm.workflow_executions e
  set execution_state='cancelled',
      completed_at=now(),
      updated_at=now(),
      error='FEE_GATE_HOLD'
  where e.workspace_id=l.workspace_id
    and e.execution_state in ('queued','running','waiting','waiting_approval')
    and e.context #>> '{lead,id}'=l.id::text
    and e.context #>> '{agent,slug}' in ('sav-credit','sav-document','sav-finance','sav-sales-manager');

  update sav_ai_crm.tasks t
  set status='paused',
      completed_at=null,
      updated_at=now()
  where t.workspace_id=l.workspace_id
    and t.lead_id=l.id
    and t.archived_at is null
    and t.status in ('pending','in_progress')
    and exists(
      select 1
      from sav_ai_crm.ai_agents a
      where a.id=t.assigned_agent_id
        and a.slug in ('sav-credit','sav-document','sav-finance','sav-sales-manager')
    );

  insert into sav_ai_crm.activities(
    workspace_id,lead_id,contact_id,activity_type,title,description,channel,metadata
  ) values(
    l.workspace_id,l.id,l.contact_id,'akbs_fee_gate_applied',
    case
      when v_fee_status in ('PROOF_SUBMITTED','PENDING_VERIFICATION','UNDER_REVIEW')
        then 'Fee proof under review — reminders suppressed'
      else 'Fee pending — processing on hold'
    end,
    case
      when v_fee_status in ('PROOF_SUBMITTED','PENDING_VERIFICATION','UNDER_REVIEW')
        then 'Payment proof is under review. Customer reminders are suppressed and downstream processing remains paused.'
      else 'Credit, document, finance and manager processing remain paused until fee verification.'
    end,
    'system',
    jsonb_build_object('fee_status',coalesce(nullif(v_fee_status,''),'PENDING'))
  );

  return jsonb_build_object(
    'ok',true,
    'gate','hold',
    'reminder',case
      when v_fee_status in ('PROOF_SUBMITTED','PENDING_VERIFICATION','UNDER_REVIEW')
        then 'suppressed_pending_verification'
      else 'managed_by_autopilot_scheduler'
    end
  );
end $function$
;

CREATE OR REPLACE FUNCTION sav_ai_crm.send_autopilot_email(p_lead_id uuid, p_stage_key text, p_attempt integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'sav_ai_crm', 'vault', 'net'
AS $function$
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

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name='akbs_workforce_resend_key'
  limit 1;

  if coalesce(v_key,'')='' then raise exception 'AKBS autopilot sender secret missing'; end if;

  if p_stage_key='FEE_PENDING' then
    v_subject:='AKBS Fee Payment Reminder'||case when nullif(l.metadata->>'application_id','') is not null then ' - '||(l.metadata->>'application_id') else '' end;
    v_body:='Namaste '||l.title||' ji,'||E'\n\n'||
      'Aapki AKBS application ki registration/application fee abhi pending hai.'||E'\n'||
      'Kripya payment complete karke UTR / transaction reference aur payment proof Customer Portal me submit karein.'||E'\n'||
      'Payment verify hone ke baad next processing automatically continue hogi.'||E'\n\n'||
      'Customer Portal: https://crm.akbspoultry.com/customer-registration'||E'\n\n'||
      'Regards,'||E'\nAKBS Poultry Farming Private Limited';
  elsif p_stage_key in ('NEW','CONTACTED') then
    v_subject:='AKBS Application Follow-up';
    v_body:='Namaste '||l.title||' ji,'||E'\n\n'||
      'AKBS Poultry Farming Private Limited ki taraf se aapki enquiry/application ke sambandh me follow-up hai.'||E'\n'||
      'Agar aapki taraf se koi information ya next step pending hai, kripya Customer Portal me process complete karein ya AKBS team se sampark karein.'||E'\n\n'||
      'Customer Portal: https://crm.akbspoultry.com/customer-registration'||E'\n\n'||
      'Regards,'||E'\nAKBS Poultry Farming Private Limited';
  else
    return null;
  end if;

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
end $function$
;

CREATE OR REPLACE FUNCTION sav_ai_crm.evaluate_akbs_autopilot(p_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'sav_ai_crm'
AS $function$
declare
  l sav_ai_crm.leads;
  s sav_ai_crm.lead_autopilot_state;
  v_stage text;
  v_agent_id uuid;
  v_task_id uuid;
  v_request_id bigint;
  v_next timestamptz;
  v_created boolean:=false;
  v_reminded boolean:=false;
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
    update sav_ai_crm.lead_autopilot_state
    set is_suppressed=true,suppression_reason='lead_closed',next_reminder_at=null,updated_at=now()
    where lead_id=l.id;
    return jsonb_build_object('ok',true,'stage',v_stage,'suppressed',true);
  end if;

  if v_stage='FEE_REVIEW' then
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

    v_request_id:=sav_ai_crm.send_autopilot_email(l.id,v_stage,s.reminder_count+1);
    if v_request_id is not null then
      v_reminded:=true;
      v_next:=case s.reminder_count+1
        when 1 then now()+interval '3 days'
        when 2 then now()+interval '7 days'
        else null
      end;

      update sav_ai_crm.lead_autopilot_state
      set reminder_count=reminder_count+1,
          last_reminder_at=now(),
          next_reminder_at=v_next,
          escalated_at=case when reminder_count+1>=3 then now() else escalated_at end,
          updated_at=now()
      where lead_id=l.id;

      insert into sav_ai_crm.lead_autopilot_events(
        lead_id,workspace_id,stage_key,event_type,channel,metadata
      ) values(
        l.id,l.workspace_id,v_stage,'reminder_queued','email',
        jsonb_build_object('attempt',s.reminder_count+1,'http_request_id',v_request_id)
      );

      insert into sav_ai_crm.activities(
        workspace_id,lead_id,contact_id,activity_type,title,description,channel,metadata
      ) values(
        l.workspace_id,l.id,l.contact_id,'autopilot_reminder_queued',
        'Autopilot reminder queued',
        'Reminder '||(s.reminder_count+1)::text||' of 3 queued for stage '||v_stage||'.',
        'email',
        jsonb_build_object('stage',v_stage,'attempt',s.reminder_count+1,'http_request_id',v_request_id)
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok',true,
    'lead_id',l.id,
    'stage',v_stage,
    'task_created',v_created,
    'task_id',v_task_id,
    'reminder_queued',v_reminded
  );
end $function$
;

CREATE OR REPLACE FUNCTION sav_ai_crm.register_akbs_lead_agents()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'sav_ai_crm'
AS $function$
begin
  if new.source='akbs' then
    insert into sav_ai_crm.agent_test_targets(agent_id,lead_id,enabled)
    select a.id,new.id,true
    from sav_ai_crm.ai_agents a
    where a.workspace_id=new.workspace_id
      and a.slug in ('sav-sales','sav-followup','sav-credit','sav-document','sav-finance','sav-sales-manager')
    on conflict(agent_id,lead_id) do update set enabled=true;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.sav_ai_crm_agent_target_allowed(p_agent_id uuid, p_lead_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'sav_ai_crm'
AS $function$
 select exists(select 1 from sav_ai_crm.agent_test_targets t
 join sav_ai_crm.ai_agents a on a.id=t.agent_id join sav_ai_crm.leads l on l.id=t.lead_id
 where t.agent_id=p_agent_id and t.lead_id=p_lead_id and t.enabled
 and a.workspace_id=l.workspace_id and sav_ai_crm.is_workspace_member(a.workspace_id));
$function$
;

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
  v_idempotency text;
  v_status text;
begin
  me:=sav_ai_crm.agent_current_member();
  if me.id is null or me.role='viewer' then raise exception 'CRM membership required'; end if;

  select * into t
  from sav_ai_crm.tasks
  where id=p_task_id
    and workspace_id=me.workspace_id
    and archived_at is null
  for update;

  if t.id is null then raise exception 'Task not found'; end if;
  if t.status in ('completed','cancelled') then
    return jsonb_build_object('ok',false,'error','TASK_CLOSED','message','Task is completed or cancelled.');
  end if;
  if t.assigned_agent_id is null then
    return jsonb_build_object('ok',false,'error','NO_AGENT','message','Task is not assigned to an AI agent.');
  end if;
  if t.lead_id is null then
    return jsonb_build_object('ok',false,'error','NO_LEAD','message','Task is not linked to a lead.');
  end if;

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
    return jsonb_build_object('ok',false,'error','NO_ACTIVE_WORKFLOW','message','No active workflow is configured for this task type.');
  end if;

  if exists(
    select 1 from sav_ai_crm.workflow_executions e
    where e.context #>> '{task,id}'=t.id::text
      and e.execution_state in ('queued','running','waiting','waiting_approval')
  ) then
    return jsonb_build_object('ok',true,'skipped',true,'message','Task already has an active workflow execution.');
  end if;

  v_idempotency:='task:'||t.id::text||':'||floor(extract(epoch from clock_timestamp())*1000)::bigint::text;

  v_execution_id:=public.sav_ai_crm_start_workflow(
    v_workflow_id,
    jsonb_build_object(
      'task',jsonb_build_object(
        'id',t.id,'title',t.title,'status',t.status,'priority',t.priority,'followup_type',t.followup_type
      ),
      'lead',jsonb_build_object('id',t.lead_id),
      'agent',jsonb_build_object('id',a.id,'slug',a.slug)
    ),
    v_idempotency,
    'AUTONOMOUS_TASK'
  );

  v_run_result:=public.sav_ai_crm_run_workflow_execution(v_execution_id);
  v_status:=coalesce(v_run_result->>'status',v_run_result->>'execution_state','');
  v_run_result:=v_run_result||jsonb_build_object('status',v_status);

  if v_status='completed' then
    update sav_ai_crm.tasks
    set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now()
    where id=t.id;

    insert into sav_ai_crm.activities(
      workspace_id,lead_id,contact_id,task_id,actor_member_id,activity_type,title,description,channel,metadata
    ) values(
      me.workspace_id,t.lead_id,t.contact_id,t.id,me.id,'task_completed',
      'Task completed by workflow',
      'Workflow execution completed successfully.',
      'system',
      jsonb_build_object('workflow_id',v_workflow_id,'execution_id',v_execution_id,'agent_slug',a.slug)
    );
  elsif v_status in ('waiting','waiting_approval','queued','running') then
    update sav_ai_crm.tasks
    set status='in_progress',completed_at=null,updated_at=now()
    where id=t.id;
  end if;

  return jsonb_build_object(
    'ok',v_status in ('completed','waiting','waiting_approval','queued','running'),
    'workflow_id',v_workflow_id,
    'execution_id',v_execution_id,
    'work_type',v_work_type,
    'result',v_run_result
  );
end $function$
;

CREATE OR REPLACE FUNCTION sav_ai_crm.autonomous_task_dispatch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'sav_ai_crm'
AS $function$
declare
  sys_user uuid;
  run_result jsonb;
begin
  if new.status<>'pending' or new.archived_at is not null or new.assigned_agent_id is null or new.lead_id is null then
    return new;
  end if;

  if lower(coalesce(new.followup_type,''))='email' then
    return new;
  end if;

  if not exists(
    select 1
    from sav_ai_crm.ai_agents a
    join sav_ai_crm.agent_test_targets tt on tt.agent_id=a.id and tt.lead_id=new.lead_id and tt.enabled=true
    join sav_ai_crm.agent_autonomous_profiles p on p.agent_slug=a.slug and p.is_enabled=true
    where a.id=new.assigned_agent_id
      and a.workspace_id=new.workspace_id
      and a.status='active'
  ) then
    return new;
  end if;

  select m.user_id into sys_user
  from sav_ai_crm.members m
  where m.workspace_id=new.workspace_id
    and m.is_active=true
    and m.role in ('owner','admin')
  order by case when m.role='owner' then 0 else 1 end,m.created_at
  limit 1;

  if sys_user is null then return new; end if;

  begin
    perform set_config('request.jwt.claim.sub',sys_user::text,true);
    select public.sav_ai_crm_run_task_workflow(new.id) into run_result;
  exception when others then
    insert into sav_ai_crm.activities(
      workspace_id,lead_id,task_id,activity_type,title,description,channel,metadata
    ) values(
      new.workspace_id,new.lead_id,new.id,'autonomous_dispatch_failed',
      'Autonomous task dispatch failed',sqlerrm,'system',
      jsonb_build_object('task_id',new.id,'assigned_agent_id',new.assigned_agent_id)
    );
  end;

  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.sav_ai_crm_process_autonomous_queue(p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'sav_ai_crm'
AS $function$
declare
  sys_user uuid;
  rec record;
  result jsonb;
  processed integer:=0;
  succeeded integer:=0;
  failed integer:=0;
  details jsonb:='[]'::jsonb;
begin
  select m.user_id into sys_user
  from sav_ai_crm.members m
  where m.is_active=true and m.role in ('owner','admin')
  order by case when m.role='owner' then 0 else 1 end,m.created_at
  limit 1;

  if sys_user is null then raise exception 'No active owner/admin member available for autonomous processing'; end if;
  perform set_config('request.jwt.claim.sub',sys_user::text,true);

  for rec in
    select t.id as task_id,t.lead_id,t.assigned_agent_id,t.title,a.slug as agent_slug
    from sav_ai_crm.tasks t
    join sav_ai_crm.ai_agents a
      on a.id=t.assigned_agent_id
     and a.workspace_id=t.workspace_id
     and a.status='active'
    join sav_ai_crm.agent_test_targets tt
      on tt.agent_id=a.id
     and tt.lead_id=t.lead_id
     and tt.enabled=true
    join sav_ai_crm.agent_autonomous_profiles p
      on p.agent_slug=a.slug
     and p.is_enabled=true
    where t.archived_at is null
      and t.status='pending'
      and t.lead_id is not null
      and t.assigned_agent_id is not null
      and lower(coalesce(t.followup_type,''))<>'email'
      and not exists(
        select 1 from sav_ai_crm.workflow_executions e
        where e.context #>> '{task,id}'=t.id::text
          and e.execution_state in ('queued','running','waiting','waiting_approval')
      )
    order by t.priority desc,t.created_at
    limit greatest(1,least(coalesce(p_limit,25),100))
  loop
    processed:=processed+1;
    begin
      select public.sav_ai_crm_run_task_workflow(rec.task_id) into result;
      if coalesce((result->>'ok')::boolean,false) then succeeded:=succeeded+1; else failed:=failed+1; end if;
      details:=details||jsonb_build_array(jsonb_build_object(
        'task_id',rec.task_id,'lead_id',rec.lead_id,'agent_slug',rec.agent_slug,'result',result
      ));
    exception when others then
      failed:=failed+1;
      details:=details||jsonb_build_array(jsonb_build_object(
        'task_id',rec.task_id,'lead_id',rec.lead_id,'agent_slug',rec.agent_slug,'error',sqlerrm
      ));
    end;
  end loop;

  return jsonb_build_object('ok',failed=0,'processed',processed,'succeeded',succeeded,'failed',failed,'details',details);
end $function$
;

CREATE OR REPLACE FUNCTION public.sav_ai_crm_run_autopilot_cycle(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'sav_ai_crm'
AS $function$
declare
  rec record;
  v_result jsonb;
  v_processed integer:=0;
  v_errors integer:=0;
  v_details jsonb:='[]'::jsonb;
begin
  for rec in
    select id from sav_ai_crm.leads
    where source='akbs'
    order by updated_at desc
    limit greatest(1,least(coalesce(p_limit,100),500))
  loop
    v_processed:=v_processed+1;
    begin
      v_result:=sav_ai_crm.evaluate_akbs_autopilot(rec.id);
      v_details:=v_details||jsonb_build_array(v_result);
    exception when others then
      v_errors:=v_errors+1;
      v_details:=v_details||jsonb_build_array(jsonb_build_object('lead_id',rec.id,'error',sqlerrm));
    end;
  end loop;

  perform public.sav_ai_crm_process_autonomous_queue(100);

  return jsonb_build_object(
    'ok',v_errors=0,
    'processed',v_processed,
    'errors',v_errors,
    'details',v_details
  );
end $function$
;

CREATE OR REPLACE FUNCTION public.sav_ai_crm_run_agent_autonomous(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'sav_ai_crm'
AS $function$
declare
  me sav_ai_crm.members;
  a sav_ai_crm.ai_agents;
  profile sav_ai_crm.agent_autonomous_profiles;
  target record;
  existing_task uuid;
  new_task uuid;
  created_count int:=0;
  reused_count int:=0;
begin
  me:=sav_ai_crm.agent_current_member();
  if me.id is null or not sav_ai_crm.agent_can_manage(me.role) then
    raise exception 'Agent management not permitted';
  end if;

  select * into a
  from sav_ai_crm.ai_agents
  where id=p_agent_id and workspace_id=me.workspace_id;

  if a.id is null then raise exception 'Agent not found'; end if;
  if a.status<>'active' then
    return jsonb_build_object('ok',false,'error','AGENT_NOT_ACTIVE','created',0,'reused',0);
  end if;

  select * into profile
  from sav_ai_crm.agent_autonomous_profiles
  where agent_slug=a.slug and is_enabled=true;

  if profile.agent_slug is null then
    return jsonb_build_object('ok',true,'skipped',true,'reason','NO_AUTONOMOUS_PROFILE','created',0,'reused',0);
  end if;

  for target in
    select l.id,l.title,l.status,l.source
    from sav_ai_crm.agent_test_targets tt
    join sav_ai_crm.leads l on l.id=tt.lead_id
    where tt.agent_id=a.id
      and tt.enabled=true
      and l.workspace_id=me.workspace_id
  loop
    select t.id into existing_task
    from sav_ai_crm.tasks t
    where t.workspace_id=me.workspace_id
      and t.lead_id=target.id
      and t.assigned_agent_id=a.id
      and t.title=profile.task_title
      and t.status in ('pending','in_progress')
      and t.archived_at is null
    order by t.created_at desc
    limit 1;

    if existing_task is not null then
      reused_count:=reused_count+1;
      continue;
    end if;

    insert into sav_ai_crm.tasks(
      workspace_id,lead_id,title,description,task_type,status,priority,
      assigned_agent_id,followup_type,created_by,notes
    ) values(
      me.workspace_id,
      target.id,
      profile.task_title,
      profile.task_description,
      'followup',
      'pending',
      profile.default_priority,
      a.id,
      profile.work_type,
      me.id,
      'Automatically created because '||a.name||' is Active. No manual command required.'
    )
    returning id into new_task;

    insert into sav_ai_crm.activities(
      workspace_id,lead_id,actor_member_id,activity_type,title,description,channel,metadata
    ) values(
      me.workspace_id,
      target.id,
      me.id,
      'agent_autonomous_work_created',
      a.name||' autonomous work created',
      profile.task_title,
      'system',
      jsonb_build_object(
        'task_id',new_task,
        'agent_id',a.id,
        'agent_slug',a.slug,
        'work_type',profile.work_type,
        'trigger','agent_active'
      )
    );

    created_count:=created_count+1;
  end loop;

  return jsonb_build_object(
    'ok',true,
    'agent_id',a.id,
    'agent_slug',a.slug,
    'created',created_count,
    'reused',reused_count
  );
end $function$
;

CREATE OR REPLACE FUNCTION public.sav_ai_crm_route_work(p_lead_id uuid, p_work_type text, p_title text DEFAULT NULL::text, p_description text DEFAULT NULL::text, p_priority text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'sav_ai_crm'
AS $function$
declare
  me sav_ai_crm.members;
  route sav_ai_crm.agent_work_routing;
  agent sav_ai_crm.ai_agents;
  existing_task uuid;
  new_task uuid;
  final_title text;
  final_description text;
  final_priority text;
begin
  me:=sav_ai_crm.agent_current_member();
  if me.id is null then raise exception 'CRM membership required'; end if;

  if not exists(select 1 from sav_ai_crm.leads where id=p_lead_id and workspace_id=me.workspace_id) then
    raise exception 'Lead not found';
  end if;

  select * into route
  from sav_ai_crm.agent_work_routing
  where work_type=lower(trim(p_work_type)) and is_active=true;

  if route.work_type is null then raise exception 'Unsupported work type'; end if;

  select * into agent
  from sav_ai_crm.ai_agents
  where workspace_id=me.workspace_id
    and slug=route.agent_slug
    and status='active'
  order by created_at
  limit 1;

  if agent.id is null then
    return jsonb_build_object(
      'ok',false,
      'error','AGENT_NOT_ACTIVE',
      'message','The assigned agent is paused or disabled.'
    );
  end if;

  if not public.sav_ai_crm_agent_target_allowed(agent.id,p_lead_id) then
    return jsonb_build_object(
      'ok',false,
      'error','TEST_SCOPE_BLOCKED',
      'message','This lead is outside the current testing scope.'
    );
  end if;

  final_title:=coalesce(nullif(trim(p_title),''),
    case route.work_type
      when 'sales' then 'Sales lead review'
      when 'credit' then 'Credit and loan eligibility review'
      when 'document' then 'Document and DPR review'
      when 'finance' then 'Finance verification review'
      when 'followup' then 'Customer follow-up'
      when 'manager_review' then 'Manager review'
      else initcap(route.work_type)||' work'
    end
  );
  final_description:=coalesce(nullif(trim(p_description),''),route.description);
  final_priority:=coalesce(nullif(trim(p_priority),''),route.default_priority);

  select id into existing_task
  from sav_ai_crm.tasks
  where workspace_id=me.workspace_id
    and lead_id=p_lead_id
    and assigned_agent_id=agent.id
    and title=final_title
    and status in ('pending','in_progress')
    and archived_at is null
  order by created_at desc
  limit 1;

  if existing_task is not null then
    return jsonb_build_object(
      'ok',true,'reused',true,'task_id',existing_task,
      'agent_id',agent.id,'agent_slug',agent.slug,'work_type',route.work_type
    );
  end if;

  insert into sav_ai_crm.tasks(
    workspace_id,lead_id,title,description,task_type,status,priority,
    assigned_agent_id,followup_type,created_by,notes
  ) values(
    me.workspace_id,p_lead_id,final_title,final_description,route.task_type,
    'pending',final_priority,agent.id,route.work_type,me.id,
    'Auto-routed by role-based AI workflow. Only active agents receive work.'
  ) returning id into new_task;

  insert into sav_ai_crm.activities(
    workspace_id,lead_id,actor_member_id,activity_type,title,description,channel,metadata
  ) values(
    me.workspace_id,p_lead_id,me.id,'agent_work_routed',
    'Work routed to '||agent.name,final_title,'system',
    jsonb_build_object('task_id',new_task,'agent_id',agent.id,'agent_slug',agent.slug,'work_type',route.work_type)
  );

  return jsonb_build_object(
    'ok',true,'task_id',new_task,'agent_id',agent.id,'agent_slug',agent.slug,'work_type',route.work_type
  );
end $function$
;

CREATE OR REPLACE FUNCTION public.sav_ai_crm_claim_agent_plan(p_source_id uuid, p_agent_id uuid, p_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'sav_ai_crm'
AS $function$
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
end $function$
;

-- Live function privileges (as found; tightened in the lockdown migration)
revoke all on function sav_ai_crm.autonomous_task_dispatch() from public;
revoke all on function public.sav_ai_crm_process_autonomous_queue(integer) from public, anon, authenticated;
grant execute on function public.sav_ai_crm_process_autonomous_queue(integer) to service_role;
revoke all on function public.sav_ai_crm_agent_target_allowed(uuid,uuid), public.sav_ai_crm_claim_agent_plan(uuid,uuid,uuid),
  public.sav_ai_crm_route_work(uuid,text,text,text,text), public.sav_ai_crm_run_agent_autonomous(uuid),
  public.sav_ai_crm_run_task_workflow(uuid) from public, anon;
grant execute on function public.sav_ai_crm_agent_target_allowed(uuid,uuid), public.sav_ai_crm_claim_agent_plan(uuid,uuid,uuid),
  public.sav_ai_crm_route_work(uuid,text,text,text,text), public.sav_ai_crm_run_agent_autonomous(uuid),
  public.sav_ai_crm_run_task_workflow(uuid) to authenticated, service_role;

-- Triggers --------------------------------------------------------------------
drop trigger if exists trg_register_akbs_lead_agents on sav_ai_crm.leads;
CREATE TRIGGER trg_register_akbs_lead_agents AFTER INSERT OR UPDATE OF source ON sav_ai_crm.leads FOR EACH ROW EXECUTE FUNCTION sav_ai_crm.register_akbs_lead_agents();
drop trigger if exists trg_autonomous_task_dispatch on sav_ai_crm.tasks;
CREATE TRIGGER trg_autonomous_task_dispatch AFTER INSERT OR UPDATE OF status, assigned_agent_id, lead_id ON sav_ai_crm.tasks FOR EACH ROW WHEN ((new.status = 'pending'::text)) EXECUTE FUNCTION sav_ai_crm.autonomous_task_dispatch();

-- Schedule (pg_cron; cron.schedule with an existing name updates it) ----------
select cron.schedule('sav-ai-akbs-autopilot-hourly','7 * * * *','select public.sav_ai_crm_run_autopilot_cycle(250);');
