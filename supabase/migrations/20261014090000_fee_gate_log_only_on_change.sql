-- =============================================================================
-- Fee gate: stop writing the same timeline note every hour (14 Oct 2026)
--
-- apply_akbs_fee_gate runs on every hourly autopilot cycle for FEE_PENDING leads
-- and inserted "Fee pending — processing on hold" each time (197 copies on one
-- lead by 14 Oct). Behaviour is unchanged; the note is now written only when the
-- gate actually pauses/releases something or the gate state changes.
-- Applied to the live project as migration `fee_gate_log_only_on_change`.
-- =============================================================================

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
  v_title text;
  v_changed int:=0;
  v_n int;
  v_last_title text;
begin
  select * into l from sav_ai_crm.leads where id=p_lead_id for update;
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
  on conflict(lead_id) do update set fee_status=excluded.fee_status,updated_at=now();

  if v_fee_status='VERIFIED' then
    update sav_ai_crm.tasks set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now()
    where workspace_id=l.workspace_id and lead_id=l.id and archived_at is null
      and notes like '%fee-gate:auto%' and status not in ('completed','cancelled');
    get diagnostics v_n=row_count; v_changed:=v_changed+v_n;

    update sav_ai_crm.tasks t set status='pending',completed_at=null,updated_at=now()
    where t.workspace_id=l.workspace_id and t.lead_id=l.id and t.archived_at is null and t.status='paused'
      and exists(select 1 from sav_ai_crm.ai_agents a where a.id=t.assigned_agent_id and a.slug='sav-document' and a.status='active');
    get diagnostics v_n=row_count; v_changed:=v_changed+v_n;

    v_title:='Fee verified — document stage released';
    select title into v_last_title from sav_ai_crm.activities
    where lead_id=l.id and activity_type in ('akbs_fee_gate_released','akbs_fee_gate_applied') order by created_at desc limit 1;
    if v_changed>0 or v_last_title is distinct from v_title then
      insert into sav_ai_crm.activities(workspace_id,lead_id,contact_id,activity_type,title,description,channel,metadata)
      values(l.workspace_id,l.id,l.contact_id,'akbs_fee_gate_released',v_title,
        'Registration fee is verified. Document processing may continue. Other downstream stages remain stage-controlled by autopilot.',
        'system',jsonb_build_object('fee_status',v_fee_status));
    end if;
    return jsonb_build_object('ok',true,'gate','released','next_stage','DOCUMENTS');
  end if;

  update sav_ai_crm.workflow_executions e
  set execution_state='cancelled',completed_at=now(),updated_at=now(),error='FEE_GATE_HOLD'
  where e.workspace_id=l.workspace_id and e.execution_state in ('queued','running','waiting','waiting_approval')
    and e.context #>> '{lead,id}'=l.id::text
    and e.context #>> '{agent,slug}' in ('sav-credit','sav-document','sav-finance','sav-sales-manager');
  get diagnostics v_n=row_count; v_changed:=v_changed+v_n;

  update sav_ai_crm.tasks t set status='paused',completed_at=null,updated_at=now()
  where t.workspace_id=l.workspace_id and t.lead_id=l.id and t.archived_at is null and t.status in ('pending','in_progress')
    and exists(select 1 from sav_ai_crm.ai_agents a where a.id=t.assigned_agent_id
      and a.slug in ('sav-credit','sav-document','sav-finance','sav-sales-manager'));
  get diagnostics v_n=row_count; v_changed:=v_changed+v_n;

  v_title:=case when v_fee_status in ('PROOF_SUBMITTED','PENDING_VERIFICATION','UNDER_REVIEW')
    then 'Fee proof under review — reminders suppressed' else 'Fee pending — processing on hold' end;
  select title into v_last_title from sav_ai_crm.activities
  where lead_id=l.id and activity_type in ('akbs_fee_gate_released','akbs_fee_gate_applied') order by created_at desc limit 1;
  if v_changed>0 or v_last_title is distinct from v_title then
    insert into sav_ai_crm.activities(workspace_id,lead_id,contact_id,activity_type,title,description,channel,metadata)
    values(l.workspace_id,l.id,l.contact_id,'akbs_fee_gate_applied',v_title,
      case when v_fee_status in ('PROOF_SUBMITTED','PENDING_VERIFICATION','UNDER_REVIEW')
        then 'Payment proof is under review. Customer reminders are suppressed and downstream processing remains paused.'
        else 'Credit, document, finance and manager processing remain paused until fee verification.' end,
      'system',jsonb_build_object('fee_status',coalesce(nullif(v_fee_status,''),'PENDING'),'items_paused',v_changed));
  end if;

  return jsonb_build_object('ok',true,'gate','hold','changed',v_changed,
    'reminder',case when v_fee_status in ('PROOF_SUBMITTED','PENDING_VERIFICATION','UNDER_REVIEW')
      then 'suppressed_pending_verification' else 'managed_by_autopilot_scheduler' end);
end $function$;
revoke execute on function sav_ai_crm.apply_akbs_fee_gate(uuid) from public, anon, authenticated;
grant execute on function sav_ai_crm.apply_akbs_fee_gate(uuid) to service_role;
