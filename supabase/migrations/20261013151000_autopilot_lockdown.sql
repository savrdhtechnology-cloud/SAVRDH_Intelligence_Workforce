-- =============================================================================
-- Autopilot lockdown (13 Oct 2026)
--
-- Problem: the autopilot internals were executable by `anon` (the public key that
-- ships in the browser) and `authenticated`. Anyone could:
--   * call public.sav_ai_crm_run_autopilot_cycle() and read back AKBS lead ids;
--   * call sav_ai_crm.send_autopilot_email(lead, stage, n) with changing n to send
--     repeated emails to AKBS customers from updates@akbspoultry.com;
--   * call evaluate_akbs_autopilot / apply_akbs_fee_gate to pause tasks and cancel
--     workflow executions.
--
-- Fix: only the database owner (pg_cron runs the hourly job as postgres) and
-- service_role may run them. All internal callers are SECURITY DEFINER functions
-- owned by postgres, so nested calls keep working.
-- =============================================================================

revoke execute on function public.sav_ai_crm_run_autopilot_cycle(integer) from public, anon, authenticated;
grant execute on function public.sav_ai_crm_run_autopilot_cycle(integer) to service_role;

revoke execute on function sav_ai_crm.send_autopilot_email(uuid,text,integer) from public, anon, authenticated;
revoke execute on function sav_ai_crm.evaluate_akbs_autopilot(uuid) from public, anon, authenticated;
revoke execute on function sav_ai_crm.apply_akbs_fee_gate(uuid) from public, anon, authenticated;
revoke execute on function sav_ai_crm.derive_akbs_autopilot_stage(uuid) from public, anon, authenticated;
revoke execute on function sav_ai_crm.register_akbs_lead_agents() from public, anon, authenticated;
revoke execute on function sav_ai_crm.autonomous_task_dispatch() from public, anon, authenticated;

grant execute on function sav_ai_crm.send_autopilot_email(uuid,text,integer),
  sav_ai_crm.evaluate_akbs_autopilot(uuid),
  sav_ai_crm.apply_akbs_fee_gate(uuid),
  sav_ai_crm.derive_akbs_autopilot_stage(uuid) to service_role;
