import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync,readdirSync,statSync } from "node:fs";
import { join,relative } from "node:path";
import { fileURLToPath } from "node:url";

const root=fileURLToPath(new URL("..",import.meta.url));
const migrationFiles=[
 "supabase/migrations/20261002095012_sav_ai_crm_isolated_foundation.sql",
 "supabase/migrations/20261002095133_sav_ai_crm_public_rpc_facade.sql",
 "supabase/migrations/20261002095224_sav_ai_crm_operational_reads.sql",
 "supabase/migrations/20261002_tasks_followup_module.sql",
 "supabase/migrations/20261002_zz_ai_agents_phase2.sql",
 "supabase/migrations/20261002_zzz_workflow_engine_phase3.sql",
 "supabase/migrations/20261002_aaaa_inbox_channels_phase4.sql",
 "supabase/migrations/20261002_bbbb_notifications_phase5.sql"
];

function walk(dir){
 const out=[];
 for(const name of readdirSync(dir)){
   const p=join(dir,name),st=statSync(p);
   if(st.isDirectory()) out.push(...walk(p));
   else if(/\.(ts|tsx)$/.test(name)) out.push(p);
 }
 return out;
}

function functionDefs(sql){
 return [...sql.matchAll(/create\s+or\s+replace\s+function\s+([a-zA-Z0-9_."]+)\s*\(([\s\S]*?)\)\s*(?:returns|language)/gi)]
   .map(m=>({name:m[1].replaceAll('"',"").split(".").pop(),args:m[2].replace(/\s+/g," ").trim()}));
}

const additionalMigrationFiles=[
 "supabase/migrations/20261004_sav_sales_agent_engine_phase1.sql",
 "supabase/migrations/20261004_engagex_sales_workflow_phase2.sql"
];
const allMigrations=readdirSync(join(root,"supabase/migrations")).filter(p=>p.endsWith(".sql")).map(p=>"supabase/migrations/"+p);
const migrationSql=[...migrationFiles,...additionalMigrationFiles,...allMigrations.filter(p=>![...migrationFiles,...additionalMigrationFiles].includes(p))].map(p=>readFileSync(join(root,p),"utf8"));
const definitions=migrationSql.flatMap(functionDefs);
const definitionNames=new Set(definitions.map(x=>x.name));

test("all literal application RPC calls exist in version-controlled migration source",()=>{
 const sources=[...walk(join(root,"app")),...walk(join(root,"lib"))];
 const missing=[];
 for(const p of sources){
   const c=readFileSync(p,"utf8");
   for(const m of c.matchAll(/\.rpc\(\s*["'`]([^"'`]+)["'`]/g)){
     if(!definitionNames.has(m[1])) missing.push(relative(root,p)+": "+m[1]);
   }
 }
 assert.deepEqual(missing,[]);
});

test("Phase 2 execution RPC signatures exactly match the API contract",()=>{
 const phase2=migrationSql[4];
 assert.match(phase2,/create or replace function public\.sav_ai_crm_create_agent_execution\(p_agent_id uuid,p_command text,p_input jsonb default '\{\}'::jsonb\)/);
 assert.match(phase2,/create or replace function public\.sav_ai_crm_complete_agent_execution\(\s*p_execution_id uuid,p_planned_action jsonb,p_output jsonb default null,p_approval_status text default 'not_required'/);
 assert.match(phase2,/create or replace function public\.sav_ai_crm_fail_agent_execution\(p_execution_id uuid,p_error text,p_output jsonb default null\)/);
 assert.match(phase2,/create or replace function public\.sav_ai_crm_agent_executions\(p_agent_id uuid\)/);
});

test("Phase 2 migration is one clean transaction with no duplicate public function signatures",()=>{
 const phase2=migrationSql[4];
 assert.equal((phase2.match(/\bcommit;/gi)||[]).length,1);
 assert.match(phase2,/^begin;/m);
 assert.equal(phase2.slice(phase2.lastIndexOf("commit;")+7).trim(),"");
 const defs=functionDefs(phase2).filter(x=>x.name?.startsWith("sav_ai_crm_"));
 const sigs=defs.map(x=>x.name+"("+x.args.replace(/\s+default\s+[^,]+/gi,"").replace(/\s+/g," ")+")");
 const dup=[...new Set(sigs.filter((x,i,a)=>a.indexOf(x)!==i))];
 assert.deepEqual(dup,[]);
});

test("critical Phase 2 tables and execution audit lifecycle are present",()=>{
 const phase2=migrationSql[4];
 for(const table of ["ai_agent_capabilities","ai_agent_executions","ai_agent_actions","ai_agent_approvals","ai_agent_escalations"]){
   assert.match(phase2,new RegExp("create table if not exists sav_ai_crm\\."+table));
 }
 for(const event of ["agent.execution.created","agent.execution.completed","agent.execution.failed","agent_execution_completed","agent_execution_failed"]){
   assert.match(phase2,new RegExp(event.replaceAll(".","\\.")));
 }
 assert.match(phase2,/auth\.jwt\(\)->'app_metadata'->>'sav_ai_agent_id'/);
 assert.doesNotMatch(phase2,/user_metadata[^\n]*sav_ai_agent_id/i);
});

test("cross-phase workflow overrides retain identical public signatures",()=>{
 const phase3=migrationSql[5],phase4=migrationSql[6],phase5=migrationSql[7];
 for(const sig of [
   "sav_ai_crm_create_workflow",
   "sav_ai_crm_update_workflow",
   "sav_ai_crm_dispatch_workflow_event"
 ]){
   assert.ok(functionDefs(phase3).some(x=>x.name===sig));
   assert.ok(functionDefs(phase4).some(x=>x.name===sig));
 }
 assert.ok(functionDefs(phase3).some(x=>x.name==="sav_ai_crm_run_workflow_execution"));
 assert.ok(functionDefs(phase5).some(x=>x.name==="sav_ai_crm_run_workflow_execution"));
});

test("staging gate documents explicit dependency order and production hard stop",()=>{
 const doc=readFileSync(join(root,"supabase/STAGING_PHASE1_5_VERIFICATION.md"),"utf8");
 let cursor=-1;
 for(const p of migrationFiles){
   const next=doc.indexOf(p);
   assert.ok(next>cursor,"missing or out-of-order migration in staging guide: "+p);
   cursor=next;
 }
 assert.match(doc,/gsudlmrmrefqqodpdeug/);
 assert.match(doc,/Do not use a blanket `supabase db push`/);
 assert.match(doc,/DATABASE_NOT_READY/);
 assert.match(doc,/AI_PROVIDER_NOT_CONFIGURED/);
 assert.match(doc,/AI_PROVIDER_ERROR/);
});
