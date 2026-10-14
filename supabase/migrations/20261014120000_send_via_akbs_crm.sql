-- =============================================================================
-- Send AKBS customer emails through AKBS CRM (14 Oct 2026)
--
-- Founder: agents working on AKBS must use the AKBS CRM's own email, so the
-- email goes from AKBS's verified sender and shows on the AKBS lead timeline.
-- Before: the Workforce called Resend itself from updates@akbspoultry.com
-- (not AKBS's configured sender; only 1 of 15 sends left a provider receipt).
-- Now: an approved reminder calls the AKBS CRM edge function
-- akbs-workforce-reminder (project ldffgetuzoeupuhoaubn), which uses AKBS email
-- settings + template + 60-minute cooldown and writes
-- REGISTRATION/FEE_REMINDER_EMAILED "AI Workforce · <agent>" on the lead.
-- The founder's approval rule is unchanged: nothing is sent without approval.
-- =============================================================================

alter table sav_ai_crm.customer_email_approvals
  add column if not exists delivery_result jsonb,
  add column if not exists delivery_checked_at timestamptz;

-- Preview text = what AKBS CRM sends (plain-text version of its HTML template).
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
    body:='Dear '||l.title||','||E'\n\n'||
      'Your Initial Project Assessment & Registration Fee is pending for application '||coalesce(nullif(l.metadata->>'application_id',''),'(your application)')||'.'||E'\n'||
      '[Amount due and the official AKBS company payment account are filled in by AKBS CRM]'||E'\n\n'||
      'After payment, submit the UTR / transaction reference and payment proof in your Customer Portal.'||E'\n'||
      '[Button: Open Customer Portal → https://crm.akbspoultry.com/customer-registration]'||E'\n\n'||
      'www.akbspoultry.com · support@akbspoultry.com'||E'\n'||
      '— Sent by AKBS CRM from its own email (AKBS Poultry Farming)';
    return next;
  elsif p_stage_key in ('NEW','CONTACTED') then
    subject:='AKBS Customer Registration Reminder';
    body:='Dear '||l.title||','||E'\n\n'||
      'Thank you for contacting AKBS Poultry Farming Pvt. Ltd. Please complete and submit your customer registration to start your application.'||E'\n'||
      'Your saved registration details will be available after signing in with your registered email.'||E'\n'||
      'कृपया अपना ग्राहक रजिस्ट्रेशन पूरा करके आवेदन जमा करें।'||E'\n'||
      '[Button: Complete Registration → https://crm.akbspoultry.com/customer-registration]'||E'\n\n'||
      'www.akbspoultry.com · support@akbspoultry.com'||E'\n'||
      '— Sent by AKBS CRM from its own email (AKBS Poultry Farming)';
    return next;
  end if;
end $$;
revoke all on function sav_ai_crm.autopilot_email_content(uuid,text) from public, anon, authenticated;

-- Sender: hand the email to AKBS CRM instead of calling the email provider directly.
create or replace function sav_ai_crm.send_autopilot_email(p_lead_id uuid, p_stage_key text, p_attempt integer)
returns bigint language plpgsql security definer
set search_path to 'public', 'sav_ai_crm', 'vault', 'net'
as $$
declare
  l sav_ai_crm.leads;
  v_token text;
  v_purpose text;
  v_agent text;
  v_request_id bigint;
begin
  select * into l from sav_ai_crm.leads where id=p_lead_id for update;
  if l.id is null or l.source<>'akbs' or nullif(trim(coalesce(l.email,'')),'') is null then return null; end if;
  if lower(coalesce(l.status,'')) in ('won','lost','closed') then return null; end if;

  v_purpose:=case when p_stage_key='FEE_PENDING' then 'payment' when p_stage_key in ('NEW','CONTACTED') then 'registration' end;
  if v_purpose is null then return null; end if;
  v_agent:=case when p_stage_key='CONTACTED' then 'SAV-Followup' when p_stage_key='FEE_PENDING' then 'SAV-Followup' else 'SAV-Sales' end;

  select decrypted_secret into v_token from vault.decrypted_secrets where name='akbs_workforce_function_token' limit 1;
  if coalesce(v_token,'')='' then raise exception 'AKBS CRM connection token missing'; end if;

  select net.http_post(
    url:='https://ldffgetuzoeupuhoaubn.supabase.co/functions/v1/akbs-workforce-reminder',
    body:=jsonb_build_object(
      'email',lower(trim(l.email)),
      'purpose',v_purpose,
      'agent',v_agent,
      'request_id','wf-'||l.id::text||'-'||p_stage_key||'-'||p_attempt::text
    ),
    headers:=jsonb_build_object('Content-Type','application/json','x-workforce-token',v_token),
    timeout_milliseconds:=20000
  ) into v_request_id;
  return v_request_id;
end $$;
revoke execute on function sav_ai_crm.send_autopilot_email(uuid,text,integer) from public, anon, authenticated;
grant execute on function sav_ai_crm.send_autopilot_email(uuid,text,integer) to service_role;

-- Keep AKBS's answer before net._http_response is purged (it keeps ~6 hours).
create or replace function sav_ai_crm.reconcile_akbs_email_results()
returns integer language plpgsql security definer
set search_path to 'public', 'sav_ai_crm', 'net'
as $$
declare r record; n int:=0; body jsonb;
begin
  for r in
    select a.id, a.lead_id, a.stage_key, a.attempt, a.workspace_id, h.status_code, h.content, h.error_msg
    from sav_ai_crm.customer_email_approvals a
    join net._http_response h on h.id=a.http_request_id
    where a.status='sent' and a.delivery_checked_at is null
  loop
    begin body:=r.content::jsonb; exception when others then body:=jsonb_build_object('raw',left(coalesce(r.content,''),300)); end;
    update sav_ai_crm.customer_email_approvals
      set delivery_checked_at=now(),
          delivery_result=jsonb_build_object('http_status',r.status_code,'response',body,'error',r.error_msg),
          status=case when r.status_code between 200 and 299 and coalesce((body->>'ok')::boolean,false) then 'sent' else 'failed' end,
          error=case when r.status_code between 200 and 299 and coalesce((body->>'ok')::boolean,false) then null
                     else 'AKBS CRM did not send: '||coalesce(body->>'error',r.error_msg,'HTTP '||r.status_code) end
      where id=r.id;
    if not (r.status_code between 200 and 299 and coalesce((body->>'ok')::boolean,false)) then
      insert into sav_ai_crm.activities(workspace_id,lead_id,activity_type,title,description,channel,metadata)
      values(r.workspace_id,r.lead_id,'autopilot_reminder_failed','Reminder not sent by AKBS CRM',
        coalesce(body->>'error',r.error_msg,'HTTP '||r.status_code),'email',jsonb_build_object('approval_id',r.id,'attempt',r.attempt));
    end if;
    n:=n+1;
  end loop;
  return n;
end $$;
revoke all on function sav_ai_crm.reconcile_akbs_email_results() from public, anon, authenticated;
grant execute on function sav_ai_crm.reconcile_akbs_email_results() to service_role;

-- Hourly cycle: same as before, plus recording AKBS's answers.
create or replace function public.sav_ai_crm_run_autopilot_cycle(p_limit integer default 100)
returns jsonb language plpgsql security definer
set search_path to 'public', 'sav_ai_crm'
as $function$
declare
  rec record;
  v_result jsonb;
  v_processed integer:=0;
  v_errors integer:=0;
  v_details jsonb:='[]'::jsonb;
  v_reconciled integer:=0;
begin
  begin v_reconciled:=sav_ai_crm.reconcile_akbs_email_results(); exception when others then v_reconciled:=-1; end;
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

  return jsonb_build_object('ok',v_errors=0,'processed',v_processed,'errors',v_errors,'akbs_results_recorded',v_reconciled,'details',v_details);
end $function$;
revoke execute on function public.sav_ai_crm_run_autopilot_cycle(integer) from public, anon, authenticated;
grant execute on function public.sav_ai_crm_run_autopilot_cycle(integer) to service_role;

-- Message log: show AKBS CRM's answer for each approved reminder.
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
      'status',case when exists(select 1 from net._http_response r where r.id=nullif(ev.metadata->>'http_request_id','')::bigint and r.status_code between 200 and 299) then 'sent' else 'not confirmed (old sender)' end,'recipient',lower(trim(l.email)),
      'subject','(old direct email — exact text not stored)',
      'preview','This email was sent by the Workforce directly from updates@akbspoultry.com before it was connected to AKBS CRM. It is not on the AKBS lead timeline and delivery was not confirmed.',
      'stage',ev.stage_key,'lead_id',l.id,'lead',l.title,'project',coalesce(l.source,'other'),
      'by',case when ev.metadata ? 'approved_by'
        then 'Approved by '||coalesce((select coalesce(m.full_name,m.email,m.role) from sav_ai_crm.members m where m.id=(ev.metadata->>'approved_by')::uuid),'admin')
        else 'Old direct sender (updates@akbspoultry.com, before 13 Oct) — not through AKBS CRM' end,
      'delivery',(select case when r.status_code between 200 and 299 then 'accepted by email provider'
                              when r.status_code is not null then 'provider error '||r.status_code end
                  from net._http_response r where r.id=nullif(ev.metadata->>'http_request_id','')::bigint)
    ) i
    from sav_ai_crm.lead_autopilot_events ev join sav_ai_crm.leads l on l.id=ev.lead_id
    where ev.workspace_id=ws and ev.event_type='reminder_queued' and not (ev.metadata ? 'approval_id')

    union all
    -- 2. Reminders through the approval desk (sent via AKBS CRM, waiting, skipped, cancelled, failed)
    select jsonb_build_object(
      'at',coalesce(a.decided_at,a.created_at),'channel','email','kind','Reminder email '||a.attempt||' of 3 (via AKBS CRM)',
      'status',case a.status
        when 'pending' then 'waiting for approval'
        when 'rejected' then 'not sent (skipped)'
        when 'superseded' then 'not sent (cancelled)'
        when 'failed' then 'not sent (AKBS CRM refused)'
        when 'sent' then case when a.delivery_checked_at is null then 'sending via AKBS CRM' else 'sent' end
        else a.status end,
      'recipient',a.recipient,'subject',a.subject,'preview',left(a.body,280),'stage',a.stage_key,
      'lead_id',l.id,'lead',l.title,'project',coalesce(l.source,'other'),
      'by',case when a.status in ('sent','failed') then 'Approved by '||coalesce((select coalesce(m.full_name,m.email,m.role) from sav_ai_crm.members m where m.id=a.decided_by_member),'admin')
                else coalesce(a.decision_note,case when a.status='pending' then 'Autopilot — needs your approval' end) end,
      'delivery',case
        when a.status='failed' then a.error
        when a.status='sent' and a.delivery_checked_at is not null then 'Sent by AKBS CRM · email id '||coalesce(a.delivery_result#>>'{response,email_id}','?')||' · shows on the AKBS lead timeline'
        when a.status='sent' then coalesce((select case when h.status_code between 200 and 299 then 'Sent by AKBS CRM · email id '||coalesce((h.content::jsonb)->>'email_id','?')
                                                         else 'AKBS CRM did not send: '||coalesce((h.content::jsonb)->>'error','HTTP '||h.status_code) end
                                             from net._http_response h where h.id=a.http_request_id),'Handed to AKBS CRM — waiting for its answer')
        end)
    from sav_ai_crm.customer_email_approvals a join sav_ai_crm.leads l on l.id=a.lead_id
    where a.workspace_id=ws

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

revoke all on function public.sav_ai_crm_customer_message_log(integer) from public, anon;
grant execute on function public.sav_ai_crm_customer_message_log(integer) to authenticated, service_role;
