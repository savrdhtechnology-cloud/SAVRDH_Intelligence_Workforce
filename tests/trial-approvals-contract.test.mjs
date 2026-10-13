import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql=readFileSync(new URL("../supabase/migrations/20261013170000_trial_run_approvals.sql",import.meta.url),"utf8");
const ui=readFileSync(new URL("../app/admin/TrialApprovals.tsx",import.meta.url),"utf8");
const page=readFileSync(new URL("../app/admin/page.tsx",import.meta.url),"utf8");

test("trial runs need owner/admin approval before they execute",()=>{
  assert.match(sql,/status text not null default 'pending'/);
  assert.match(sql,/me\.role not in \('owner','admin'\)[\s\S]*Only an owner or admin can approve trial runs/);
  assert.match(sql,/if r\.status<>'pending' then raise exception/);
  // the autopilot evaluator runs only inside the approve branch, after the reject branch has returned
  const review=sql.slice(sql.indexOf("function public.sav_ai_crm_review_trial_run"));
  assert.ok(review.indexOf("p_decision='reject'")<review.indexOf("evaluate_akbs_autopilot"));
});

test("trial approval functions are not callable with the public key",()=>{
  assert.match(sql,/from public, anon;\s*grant execute on function public\.sav_ai_crm_request_trial_run/);
  assert.match(sql,/revoke all on function sav_ai_crm\.request_trial_run_system\(uuid,text,integer,text\) from public, anon, authenticated/);
  assert.match(sql,/revoke all on sav_ai_crm\.trial_run_requests from public, anon, authenticated/);
});

test("admin Human Approvals shows the trial approval desk with a preview",()=>{
  assert.match(page,/import TrialApprovals from "\.\/TrialApprovals"/);
  assert.match(page,/current==="approvals"&&<><TrialApprovals\/>/);
  for(const rpc of ["sav_ai_crm_trial_run_requests","sav_ai_crm_request_trial_run","sav_ai_crm_review_trial_run"]) assert.match(ui,new RegExp('rpc\\("'+rpc+'"'));
  assert.match(ui,/emails_to_send/);
  assert.match(ui,/window\.confirm/);
});
