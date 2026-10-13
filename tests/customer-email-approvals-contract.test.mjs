import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql=readFileSync(new URL("../supabase/migrations/20261013180000_customer_email_approvals.sql",import.meta.url),"utf8");
const ui=readFileSync(new URL("../app/admin/CustomerEmailApprovals.tsx",import.meta.url),"utf8");
const page=readFileSync(new URL("../app/admin/page.tsx",import.meta.url),"utf8");

test("autopilot never sends a customer email by itself",()=>{
  const evaluator=sql.slice(sql.indexOf("create or replace function sav_ai_crm.evaluate_akbs_autopilot"),sql.indexOf("create or replace function public.sav_ai_crm_customer_email_approvals"));
  assert.doesNotMatch(evaluator,/send_autopilot_email\(/);
  assert.match(evaluator,/insert into sav_ai_crm\.customer_email_approvals/);
});

test("only owner/admin approval sends, and stale requests send nothing",()=>{
  const review=sql.slice(sql.indexOf("create or replace function public.sav_ai_crm_review_customer_email"));
  assert.match(review,/me\.role not in \('owner','admin'\)/);
  assert.ok(review.indexOf("v_reason is not null")<review.indexOf("send_autopilot_email("));
  assert.match(review,/Nothing was sent/);
  assert.match(sql,/revoke all on sav_ai_crm\.customer_email_approvals from public, anon, authenticated/);
});

test("admin shows customer email approvals with full text",()=>{
  assert.match(page,/<CustomerEmailApprovals\/><TrialApprovals\/>/);
  assert.match(ui,/rpc\("sav_ai_crm_customer_email_approvals"/);
  assert.match(ui,/rpc\("sav_ai_crm_review_customer_email"/);
  assert.match(ui,/<pre>\{item\.body\}<\/pre>/);
});
