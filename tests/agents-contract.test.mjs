import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration=readFileSync(new URL("../supabase/migrations/20261002_zz_ai_agents_phase2.sql",import.meta.url),"utf8");
const types=readFileSync(new URL("../app/crm/agents/agent-types.ts",import.meta.url),"utf8");
const provider=readFileSync(new URL("../lib/ai/provider.ts",import.meta.url),"utf8");
const moduleUi=readFileSync(new URL("../app/crm/agents/AgentsModule.tsx",import.meta.url),"utf8");
const actionApi=readFileSync(new URL("../app/api/agent-actions/route.ts",import.meta.url),"utf8");
const executeApi=readFileSync(new URL("../app/api/agents/[id]/execute/route.ts",import.meta.url),"utf8");
const agentService=readFileSync(new URL("../app/crm/agents/agent-service.ts",import.meta.url),"utf8");
const serverSupabase=readFileSync(new URL("../lib/ai/server-supabase.ts",import.meta.url),"utf8");
const browserSupabase=readFileSync(new URL("../app/crm/supabase-client.ts",import.meta.url),"utf8");

test("canonical eight agents are seeded",()=>{
  for(const slug of ["sav-sales","sav-bde","sav-sales-manager","sav-finance","sav-credit","sav-document","sav-followup","sav-support"]){
    assert.match(migration,new RegExp("'"+slug+"'"));
  }
});

test("registry persists required management fields",()=>{
  for(const field of [
    "display_name","avatar_icon","allowed_actions","knowledge_scopes","workflow_access",
    "task_permissions","escalation_rules","working_hours","daily_limits","confidence_threshold"
  ]) assert.match(migration,new RegExp(field));
});

test("agent lifecycle states include required operational states",()=>{
  for(const state of ["active","paused","disabled","error"]) assert.match(migration,new RegExp("'"+state+"'"));
});

test("risk classification is explicit and sensitive actions are critical/high",()=>{
  assert.match(types,/FINANCIAL_ACTION:"critical"/);
  assert.match(types,/CHANGE_PERMISSION:"critical"/);
  assert.match(types,/PERMANENT_DELETE_TASK:"critical"/);
  assert.match(types,/SEND_BULK_MESSAGE:"high"/);
  assert.match(types,/risk === "high" \|\| risk === "critical"/);
});

test("provider fails closed and uses the real OpenAI Responses adapter",()=>{
  assert.match(provider,/AI_PROVIDER_NOT_CONFIGURED/);
  assert.match(provider,/AI_PROVIDER_ERROR/);
  assert.match(provider,/from "openai"/);
  assert.match(provider,/responses\.create/);
  assert.match(provider,/AI_PROVIDER/);
  assert.match(provider,/AI_API_KEY/);
  assert.match(provider,/AI_MODEL/);
  assert.match(provider,/sav_sales_agent_decision/);
  assert.match(provider,/external_action_performed:false/);
  assert.doesNotMatch(provider,/mock|fake response|dummy/i);
});

test("anonymous access is explicitly revoked from agent RPCs",()=>{
  for(const fn of [
    "sav_ai_crm_agent_registry","sav_ai_crm_agent_detail","sav_ai_crm_agent_metrics",
    "sav_ai_crm_create_agent","sav_ai_crm_update_agent","sav_ai_crm_set_agent_status",
    "sav_ai_crm_request_agent_action","sav_ai_crm_review_agent_action",
    "sav_ai_crm_execute_agent_action","sav_ai_crm_create_agent_execution"
  ]) assert.match(migration,new RegExp("revoke all on function public\\."+fn+"[\\s\\S]*from public,anon"));
});

test("agent identity never uses user-editable user_metadata",()=>{
  assert.doesNotMatch(migration,/user_metadata[^\n]*agent/i);
  assert.match(migration,/auth\.uid\(\)/);
});

test("capability authorization and approval boundaries are server side",()=>{
  assert.match(migration,/Agent capability denied/);
  assert.match(migration,/cap\.risk_level in \('high','critical'\)/);
  assert.match(migration,/Human approval required/);
  assert.match(migration,/Approval review not permitted/);
});

test("sensitive actions have no automatic execution adapter",()=>{
  assert.match(migration,/ACTION_ADAPTER_NOT_IMPLEMENTED/);
  assert.doesNotMatch(migration,/elsif a\.action='FINANCIAL_ACTION'/);
  assert.doesNotMatch(migration,/elsif a\.action='CHANGE_PERMISSION'/);
  assert.doesNotMatch(migration,/elsif a\.action='PERMANENT_DELETE_TASK'/);
});

test("AI-created tasks are attributed to the agent and use task permission boundary",()=>{
  assert.match(migration,/Created by: '\|\|agent\.display_name/);
  assert.match(migration,/assigned_agent_id/);
  assert.match(migration,/agent_task_created/);
  assert.match(migration,/agent_followup_created/);
});

test("lead modification and escalation actions are audited",()=>{
  assert.match(migration,/agent_note_created/);
  assert.match(migration,/ai_agent_escalations/);
  assert.match(migration,/agent\.action\.completed/);
  assert.match(migration,/agent\.action\.request/);
});

test("agent UI has required detail states and real test console",()=>{
  for(const label of ["Overview","Role & Instructions","Capabilities","Tasks","Channels","Knowledge","Workflows","Working Hours","Limits","Escalation","Activity","Audit"]){
    assert.match(moduleUi,new RegExp(label.replace(/[&]/g,"&")));
  }
  assert.match(moduleUi,/Agent Test Console/);
  assert.match(moduleUi,/AgentApiError/);
  assert.doesNotMatch(moduleUi,/catch\(e\)\{setTestResult\(\{error:"AI_PROVIDER_NOT_CONFIGURED"/);
  assert.match(moduleUi,/Loading AI agents/);
});

test("action API executes only after server request boundary",()=>{
  assert.match(actionApi,/sav_ai_crm_request_agent_action/);
  assert.match(actionApi,/approval_required/);
  assert.match(actionApi,/sav_ai_crm_execute_agent_action/);
});


test("execution API distinguishes database readiness from provider failures",()=>{
  assert.match(executeApi,/DATABASE_NOT_READY/);
  assert.match(executeApi,/PGRST202/);
  assert.match(executeApi,/Could not find the function/);
  assert.match(executeApi,/analyzeSalesLead/);
  assert.match(executeApi,/executeSalesDecision/);
  assert.match(provider,/AI_PROVIDER_NOT_CONFIGURED/);
  assert.match(provider,/AI_PROVIDER_ERROR/);
  assert.match(agentService,/AgentApiError/);
});


test("Phase 2 migration is syntactically normalized for staging application",()=>{
  assert.equal((migration.match(/^begin;$/gmi)||[]).length,1);
  assert.equal((migration.match(/^commit;$/gmi)||[]).length,1);
  assert.doesNotMatch(migration,/end \$;/);
  assert.equal(migration.slice(migration.lastIndexOf("commit;")+7).trim(),"");
});

test("Phase 2 creates execution and control tables with RLS enabled",()=>{
  for(const table of [
    "ai_agent_capabilities","ai_agent_knowledge","ai_agent_workflows","ai_agent_executions",
    "ai_agent_actions","ai_agent_approvals","ai_agent_escalations"
  ]){
    assert.match(migration,new RegExp("create table if not exists sav_ai_crm\\."+table));
    assert.match(migration,new RegExp("alter table sav_ai_crm\\."+table+" enable row level security"));
  }
});

test("execution RPCs enforce human RBAC workspace lead isolation and execution ownership",()=>{
  assert.match(migration,/me\.id is null or me\.role='viewer'.*Agent execution permission required/s);
  assert.match(migration,/Lead is outside this workspace/);
  assert.match(migration,/Execution completion not permitted/);
  assert.match(migration,/Execution failure update not permitted/);
  assert.match(migration,/where id=p_execution_id and workspace_id=me\.workspace_id for update/);
});

test("execution RPC grants are authenticated-only and anonymous is explicitly revoked",()=>{
  for(const signature of [
    "sav_ai_crm_create_agent_execution\\(uuid,text,jsonb\\)",
    "sav_ai_crm_complete_agent_execution\\(uuid,jsonb,jsonb,text\\)",
    "sav_ai_crm_fail_agent_execution\\(uuid,text,jsonb\\)",
    "sav_ai_crm_agent_executions\\(uuid\\)"
  ]){
    assert.match(migration,new RegExp("revoke all on function public\\."+signature+" from public,anon"));
    assert.match(migration,new RegExp("grant execute on function public\\."+signature+" to authenticated"));
  }
});

test("runtime AI identity uses app_metadata and never user_metadata",()=>{
  assert.match(migration,/auth\.jwt\(\)->'app_metadata'->>'sav_ai_agent_id'/);
  assert.doesNotMatch(migration,/user_metadata[^\n]*sav_ai_agent_id/i);
  assert.match(migration,/Agent identity mismatch/);
});

test("staging Supabase configuration never falls back to production",()=>{
  assert.doesNotMatch(serverSupabase,/https?:\/\/|missing-supabase-anon-key/);
  assert.doesNotMatch(browserSupabase,/https?:\/\/|missing-supabase-anon-key/);
  assert.match(serverSupabase,/supabaseConfigured/);
  assert.match(serverSupabase,/throw new Error\("Supabase environment is not configured"\)/);
  assert.match(browserSupabase,/throw new Error\("Supabase environment is not configured"\)/);
  assert.match(executeApi,/Supabase environment is not configured/);
  assert.match(executeApi,/DATABASE_NOT_READY/);
});

test("provider boundary remains fail-closed and does not fabricate planning output",()=>{
  assert.match(provider,/AI_PROVIDER_NOT_CONFIGURED/);
  assert.match(provider,/AI_PROVIDER_ERROR/);
  assert.match(provider,/configuredProvider/);
  assert.match(provider,/OpenAIProvider/);
  assert.match(provider,/responses\.create/);
  assert.doesNotMatch(provider,/mock|fake response|dummy/i);
  assert.match(executeApi,/analyzeSalesLead/);
  assert.match(executeApi,/executeSalesDecision/);
  assert.match(readFileSync(new URL("../lib/ai/agent-engine.ts",import.meta.url),"utf8"),/getAIProvider\(\)\.planAction/);
});
