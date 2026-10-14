import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root=new URL("..",import.meta.url).pathname;
const read=p=>readFileSync(join(root,p),"utf8");

test("client API calls go through the base path helper",()=>{
  assert.match(read("next.config.ts"),/NEXT_PUBLIC_BASE_PATH: basePath/);
  const walk=d=>readdirSync(d).flatMap(n=>{const p=join(d,n);return statSync(p).isDirectory()?walk(p):[p];});
  const offenders=walk(join(root,"app")).filter(p=>/\.(ts|tsx)$/.test(p)&&!p.includes("/app/api/"))
    .filter(p=>/fetch\(\s*[`"']\/api\//.test(readFileSync(p,"utf8")));
  assert.deepEqual(offenders,[]);
  for(const f of ["app/crm/workflows/workflow-service.ts","app/crm/agents/agent-service.ts","app/crm/inbox/inbox-service.ts","app/crm/notifications/notification-service.ts"])
    assert.match(read(f),/fetch\(apiUrl\(url\)/);
});

test("command dashboard shows live agent activity instead of duplicate module cards",()=>{
  const page=read("app/admin/page.tsx");
  assert.match(page,/<AgentActivityMap onOpen=/);
  assert.doesNotMatch(page,/savos-card-grid/);
  const map=read("app/admin/AgentActivityMap.tsx");
  assert.match(map,/rpc\("sav_ai_crm_agent_activity_overview"\)/);
  assert.match(map,/animateMotion/);
  assert.match(map,/Agent-wise/);
  assert.match(map,/Project-wise/);
});

test("activity overview is read-only and not public",()=>{
  const sql=read("supabase/migrations/20261014100000_agent_activity_overview.sql");
  assert.match(sql,/stable security definer/);
  assert.doesNotMatch(sql,/\b(insert|update|delete)\b\s+(into\s+)?sav_ai_crm\./i);
  assert.match(sql,/revoke all on function public\.sav_ai_crm_agent_activity_overview\(\) from public, anon/);
});

test("workflow page is organised into what-happened, customer messages and builder",()=>{
  const shell=read("app/crm/workflows/WorkflowsRouteShell.tsx");
  for(const t of ["What happened","Customer messages","Workflow builder"]) assert.match(shell,new RegExp(t));
  const act=read("app/crm/workflows/WorkflowActivity.tsx");
  assert.match(act,/rpc\("sav_ai_crm_workflow_run_log"/);
  assert.match(act,/rpc\("sav_ai_crm_customer_message_log"/);
  const sql=read("supabase/migrations/20261014110000_run_and_message_log.sql");
  assert.match(sql,/from public, anon;/);
  assert.doesNotMatch(sql,/\b(insert into|update|delete from)\s+sav_ai_crm\./i);
});
