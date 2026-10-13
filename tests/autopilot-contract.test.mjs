import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const baseline=readFileSync(new URL("../supabase/migrations/20261013150000_autopilot_live_baseline.sql",import.meta.url),"utf8");
const lockdown=readFileSync(new URL("../supabase/migrations/20261013151000_autopilot_lockdown.sql",import.meta.url),"utf8");

test("live autopilot is version-controlled",()=>{
  for(const fn of [
    "sav_ai_crm.derive_akbs_autopilot_stage","sav_ai_crm.evaluate_akbs_autopilot","sav_ai_crm.apply_akbs_fee_gate",
    "sav_ai_crm.send_autopilot_email","sav_ai_crm.register_akbs_lead_agents","sav_ai_crm.autonomous_task_dispatch",
    "public.sav_ai_crm_run_autopilot_cycle","public.sav_ai_crm_process_autonomous_queue","public.sav_ai_crm_run_task_workflow",
    "public.sav_ai_crm_agent_target_allowed","public.sav_ai_crm_run_agent_autonomous","public.sav_ai_crm_route_work",
    "public.sav_ai_crm_claim_agent_plan"
  ]) assert.match(baseline,new RegExp("CREATE OR REPLACE FUNCTION "+fn.replace(".","\\.")+"\\("));
  for(const table of ["agent_autonomous_profiles","agent_test_targets","agent_work_routing","task_workflow_routes","lead_autopilot_state","lead_autopilot_events","akbs_fee_followup_state"])
    assert.match(baseline,new RegExp("create table if not exists sav_ai_crm\\."+table+" \\("));
  assert.match(baseline,/cron\.schedule\('sav-ai-akbs-autopilot-hourly','7 \* \* \* \*'/);
});

test("autopilot internals are not callable with the public key",()=>{
  assert.match(lockdown,/revoke execute on function public\.sav_ai_crm_run_autopilot_cycle\(integer\) from public, anon, authenticated/);
  for(const fn of ["send_autopilot_email","evaluate_akbs_autopilot","apply_akbs_fee_gate","derive_akbs_autopilot_stage","register_akbs_lead_agents","autonomous_task_dispatch"])
    assert.match(lockdown,new RegExp("revoke execute on function sav_ai_crm\\."+fn+"\\([^)]*\\) from public, anon, authenticated"));
  assert.doesNotMatch(lockdown,/grant execute[^;]*\b(anon|authenticated)\b/);
});
