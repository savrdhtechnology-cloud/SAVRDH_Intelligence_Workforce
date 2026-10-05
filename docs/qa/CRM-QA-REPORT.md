# CRM QA and functionality audit — 5 October 2026

**Release status: draft, not production certified.** Fixes are published on `fix/full-crm-qa`, PR #3. Local tests and build pass; staging database tests pass. Authenticated end-to-end browser verification and external integration sending remain blocked. No production app merge or deployment was performed by this audit.

## Requested final report

| Item | Evidence and result |
|---|---|
| 1. Total buttons/actions audited | 237 unique source controls in the initial snapshot; 270 in the current inventory after targeted additions and merging 15 newer main commits. Includes form inputs/selects, navigation and repeated-control source definitions, not every rendered row. |
| 2. Working actions | Critical operations listed below pass runtime or staging SQL tests. No reliable total of fully working UI actions can be certified until authenticated browser verification is complete. |
| 3. Broken actions found | 26 defect groups are tracked below. These are not interchangeable with button counts: one backend defect affects many controls. |
| 4. Fixed actions | Fixes with passing evidence are listed below. Source changes that lack end-to-end UI evidence are explicitly not called fully verified UI fixes. |
| 5. OpenAI-dependent actions | Free-form reasoning, intent classification, extraction, summaries and generated prose require a configured provider. Failure returns safe structured diagnostics. |
| 6. OpenAI-independent actions | Lead/task/opportunity CRUD, assignment, status, notes/activity, settings, notification operations, workflows, explicit deterministic agent plans/actions, saved-product template drafts, transport-based email sending and EngageX ingestion. Sender/sync credentials and policy gates are still required. |
| 7. EngageX status | Normalization, external-ID/email duplicate prevention, consent and provenance tested against staging with rollback. Manual sync/webhook end-to-end blocked by missing supported integration credentials. Existing AKBS bridge restrictions preserved. |
| 8. Email status | Draft/consent/approval/claim/result persistence tested in staging; provider acceptance, rejection, timeout and idempotency tested with mocked transport. No real message sent. Sales sender, workspace identity and trusted result-recording credentials are not configured. Existing bridge is AKBS transactional only. |
| 9. Agent execution | Analyze returns a persisted plan and performs no business action. Execute uses the matching stored plan, capability/role/target checks and a single-use claim. Partial failures remain failed. Deterministic task creation and replay prevention verified. Hours/limits enforcement proposal remains unapplied. |
| 10. Database/API issues | Missing deployed RPC definitions, client plan trust/replay, broad write paths, viewer denial gaps, spoofable delivery reporting, duplicate import/send risk, absent error boundaries, truncated lead visibility and reversed task runner arguments addressed as detailed below. Broad remaining privilege hardening is pending approval. |
| 11. Files changed | 103 code/config/test/inventory files in the published implementation commit, plus final reporting artifacts. Full file list below. |
| 12. Tests executed | `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `git diff --check`, two staging SQL test suites, Preview build/page checks and unauthenticated API probes. |
| 13. Test results | 125/125 automated tests pass: 109 contract/configuration checks and 16 executable runtime tests. Two database integration suites pass with transaction rollback. These counts do not represent 125 browser tests. |
| 14. Build result | Local optimized production build passes. External API probes hit Vercel protection (401); authorized connector follow-up also reported authentication required after redirect. These do not verify application authentication. Vercel Preview commit `4ce1f6dfa28488bf0630c8de273d6e803224b0df` is READY; CRM sign-in page renders. |
| 15. Remaining blockers | Authenticated browser session; supported sales sender and approved catalog; EngageX sync credentials; configured external channel adapters; reviewed enforcement of agent hours/limits and remaining permission hardening. |

## Defects and verification

| # | Finding and change | Evidence / limitation |
|---|---|---|
| 1 | Undefined agent busy state prevented compilation; added independent mutation state | Typecheck/build pass |
| 2 | Basic planning depended on OpenAI; added deterministic and disabled provider modes | Runtime tests pass |
| 3 | Explicit task/follow-up/status commands unnecessarily called OpenAI | Runtime test confirms deterministic planning with no provider calls |
| 4 | Provider failure crashed/blocked planning; safe fallback and diagnostics | Runtime failure/redaction tests pass |
| 5 | Analyze wrote business analysis fields; removed business mutations | Runtime RPC spy and SQL plan-isolation tests pass |
| 6 | Execute trusted client-supplied decisions | Matching stored plan now required; SQL ownership/claim tests pass |
| 7 | Repeated Execute could duplicate actions | Locked single-use plan claim and action replay tests pass |
| 8 | Partial tool failures could be reported completed | Failure status and safe errors implemented; runtime tests pass |
| 9 | Missing live tool-log RPC and UPDATE_LEAD implementation | Reconciled in migration; staging deterministic action/audit tests pass |
| 10 | Lead editing, archive, notes and assignment lacked operational surface | Checked form/RPC implemented; SQL persistence passes; UI flow awaiting sign-in |
| 11 | Archived leads remained visible as active | List exposes archive metadata; active/archive filters implemented; SQL list assertion passes |
| 12 | Search could lose newer results; lead list silently capped at 250 | Local consistent filtering; list truncation removed; UI smoke pending |
| 13 | Pipeline displayed lead stages while statistics used opportunities | Real opportunity create/edit/stage/value/assignment UI; SQL create/edit passes |
| 14 | Workspace settings were a placeholder | Checked save/reset form and role-protected RPC; SQL save/viewer denial passes |
| 15 | Main refresh/status/create errors were ignored | Errors surfaced; loading/duplicate guards; compile and source audit pass; browser pending |
| 16 | API methods could leak unhandled transport/config failures | Shared safe error boundary on API handlers; runtime failure tests pass |
| 17 | Notification template/schedule/create saves and Bell actions had unhandled failures | Loading/catch states added; notification persistence tests pass; browser pending |
| 18 | Notification detail lacked mark-unread control | Read/unread action implemented; SQL read/unread passes; browser pending |
| 19 | Invalid agent JSON could silently save old values | Invalid state blocks Save; typecheck/lint pass; browser pending |
| 20 | Sales draft selection depended on stale AI recommendation | Explicit selection from active approved catalog; template runtime tests pass; catalog currently empty |
| 21 | Sales send was a placeholder and delivery reporting could be fabricated | Consent/approval/locked claim, scoped sender, server-only result persistence, provider-ID confirmation and stable idempotency; SQL/mocked provider tests pass; live send blocked |
| 22 | EngageX imports had race/duplicate and workspace-selection risk | Serialized normalization/upsert, strict workspace binding; SQL duplicate/provenance tests pass |
| 23 | Direct membership/CRM writes allowed bypasses | Self-role update and direct lead/deal/draft writes restricted; role denial tests pass; additional broad privilege cleanup unapplied |
| 24 | New main task runner existed only in live DB and reversed trigger/idempotency arguments | Versioned definitions; corrected argument order, stable task key and viewer denial; staging runner/replay test passes |
| 25 | Lint required interactive setup; baseline suite failed migration gate | Reproducible ESLint configuration, lockfile and corrected migration contract; all four requested commands pass |
| 26 | Existing hours/daily-limit settings were stored but not enforced | Proposed implementation prepared, **not applied or verified**: automatic approval review rejected broad privilege/trigger changes due access-regression/outage risk |

## Staging database verification

`supabase/tests/full_crm_qa.sql`: lead create/edit/status/archive/list visibility, normalized duplicate denial, invalid status, opportunity create/edit, task create/status/archive/delete, agent pause/enable, analyze isolation, stored-plan claim/replay, deterministic task action/replay, audit log, workspace save, viewer and anonymous denial.

`supabase/tests/workflow_inbox_email_qa.sql`: EngageX upsert/dedup/provenance/consent, inbox creation/assignment/note/close/reopen/unsent queue, notification read/unread/cancel, workflow create/enable/test/execute/disable, mapped task runner/replay/viewer denial, email consent/draft/duplicate claim/server-only reporting/failure persistence.

Both suites wrap all fixtures in transactions and roll back. No external email or customer communication was triggered. Tests use the named SAVRDH staging project. Its URL is configured for both current Vercel production and Preview targets; these are not separate database environments. Production rollout needs a separate migration review and environment separation.

Applied migration files:
- `20261004132408_full_crm_qa.sql`
- `20261004133459_crm_email_and_sync_guards.sql`
- `20261005024000_crm_lead_archive_visibility.sql`
- `20261005025000_reconcile_task_workflow_runner.sql`
- `20261005025100_fix_task_workflow_argument_order.sql`

`docs/qa/proposed-policy-hardening.sql` is a review proposal, deliberately outside the migration directory. It was not applied. The automatic reviewer rejected the original combined change because database-wide RPC privilege changes and an execution-blocking trigger could cause outages/access regressions. A materially smaller lead-list visibility migration was applied successfully. Approval of the broader policy change remains required.

## Integration blockers and configuration

- No active approved product catalog entries were found. No product features, prices, fit or company facts were invented. Unknown fit produces a qualification plan; explicit Execute is required to create its task.
- No connected CRM channel account was found. Existing email/WhatsApp/voice channel records were disconnected. Connect/reconnect/test cannot be certified without supported adapter/account credentials; a status label is not proof of connectivity.
- `EMAIL_PROVIDER=resend`, `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_WORKSPACE_SLUG`, and trusted `SUPABASE_SERVICE_ROLE_KEY` are required for the implemented scoped sales transport and result recording. These variables were not populated with invented or borrowed credentials.
- `ENGAGEX_PROJECT_URL`, `ENGAGEX_SERVICE_ROLE_KEY`, `ENGAGEX_WEBHOOK_SECRET`, and the server CRM credential are required for the supported import path. Existing transactional bridge keys were neither repurposed nor exposed.
- Existing EngageX `workforce-send-email` accepts only the AKBS application-update flow, uses an AKBS sender, and has its own ledger/idempotency rules. It is not a Savrdh sales sender. Authentication/consent controls were preserved.
- WhatsApp, SMS, voice, push and generic webhook provider adapters remain unavailable. Their failure responses are truthful; no success is fabricated.
- Working-hour/daily-limit settings, knowledge/capability provisioning and broader agent policy enforcement are not certified. Several knowledge/capability/workflow tabs are existing read-only views.
- No authenticated CRM browser session was available. A secure sign-in is needed to complete every page → action → API → persisted state → UI smoke test.

## UI inventory

`action-inventory-baseline.json` preserves the initial 237 controls. `action-inventory.json` records 270 current source controls with file, line, handler, link target, disabled expression and explicit verification state. Static inventory does **not** certify business completion. Repeated table buttons count once per source control.

| Component | Controls |
|---|---:|
| `app/crm/Operations.tsx` | 18 |
| `app/crm/agents/AgentsModule.tsx` | 23 |
| `app/crm/agents/AgentsRouteShell.tsx` | 2 |
| `app/crm/inbox/InboxModule.tsx` | 54 |
| `app/crm/inbox/InboxRouteShell.tsx` | 2 |
| `app/crm/leads/[id]/page.tsx` | 5 |
| `app/crm/notifications/NotificationBell.tsx` | 4 |
| `app/crm/notifications/NotificationDetailView.tsx` | 6 |
| `app/crm/notifications/NotificationsModule.tsx` | 49 |
| `app/crm/notifications/NotificationsRouteShell.tsx` | 2 |
| `app/crm/page.tsx` | 22 |
| `app/crm/tasks/TasksView.tsx` | 43 |
| `app/crm/workflows/ExecutionDetail.tsx` | 3 |
| `app/crm/workflows/ExecutionList.tsx` | 2 |
| `app/crm/workflows/WorkflowsModule.tsx` | 33 |
| `app/crm/workflows/WorkflowsRouteShell.tsx` | 2 |

## Changed files

- `.env.example`
- `.gitignore`
- `app/api/agent-actions/[id]/approve/route.ts`
- `app/api/agent-actions/[id]/reject/route.ts`
- `app/api/agent-actions/route.ts`
- `app/api/agents/[id]/disable/route.ts`
- `app/api/agents/[id]/enable/route.ts`
- `app/api/agents/[id]/execute/route.ts`
- `app/api/agents/[id]/executions/route.ts`
- `app/api/agents/[id]/pause/route.ts`
- `app/api/agents/[id]/route.ts`
- `app/api/agents/route.ts`
- `app/api/inbox/channels/route.ts`
- `app/api/inbox/conversations/[id]/assign/route.ts`
- `app/api/inbox/conversations/[id]/close/route.ts`
- `app/api/inbox/conversations/[id]/escalate/route.ts`
- `app/api/inbox/conversations/[id]/reopen/route.ts`
- `app/api/inbox/conversations/[id]/route.ts`
- `app/api/inbox/conversations/route.ts`
- `app/api/inbox/followups/route.ts`
- `app/api/inbox/messages/[id]/draft/route.ts`
- `app/api/inbox/messages/[id]/read/route.ts`
- `app/api/inbox/messages/[id]/retry/route.ts`
- `app/api/inbox/messages/route.ts`
- `app/api/inbox/tasks/route.ts`
- `app/api/inbox/webhooks/[channel]/delivery/route.ts`
- `app/api/inbox/webhooks/[channel]/route.ts`
- `app/api/integrations/engagex/sync/route.ts`
- `app/api/integrations/engagex/webhook/route.ts`
- `app/api/notifications/[id]/cancel/route.ts`
- `app/api/notifications/[id]/read/route.ts`
- `app/api/notifications/[id]/retry/route.ts`
- `app/api/notifications/[id]/route.ts`
- `app/api/notifications/[id]/unread/route.ts`
- `app/api/notifications/channels/[id]/route.ts`
- `app/api/notifications/channels/route.ts`
- `app/api/notifications/preferences/route.ts`
- `app/api/notifications/read-all/route.ts`
- `app/api/notifications/route.ts`
- `app/api/notifications/schedules/[id]/route.ts`
- `app/api/notifications/schedules/route.ts`
- `app/api/notifications/task-reminders/route.ts`
- `app/api/notifications/templates/[id]/route.ts`
- `app/api/notifications/templates/route.ts`
- `app/api/notifications/worker/route.ts`
- `app/api/sales/email-drafts/[id]/approve-send/route.ts`
- `app/api/sales/email-drafts/route.ts`
- `app/api/workflow-approvals/[id]/approve/route.ts`
- `app/api/workflow-approvals/[id]/reject/route.ts`
- `app/api/workflow-executions/[id]/route.ts`
- `app/api/workflows/[id]/disable/route.ts`
- `app/api/workflows/[id]/duplicate/route.ts`
- `app/api/workflows/[id]/enable/route.ts`
- `app/api/workflows/[id]/execute/route.ts`
- `app/api/workflows/[id]/executions/route.ts`
- `app/api/workflows/[id]/pause/route.ts`
- `app/api/workflows/[id]/route.ts`
- `app/api/workflows/[id]/test/route.ts`
- `app/api/workflows/route.ts`
- `app/crm/Operations.tsx`
- `app/crm/agents/AgentsModule.tsx`
- `app/crm/agents/agent-service.ts`
- `app/crm/inbox/inbox-service.ts`
- `app/crm/integrations/page.tsx`
- `app/crm/leads/[id]/page.tsx`
- `app/crm/leads/page.tsx`
- `app/crm/notifications/NotificationBell.tsx`
- `app/crm/notifications/NotificationDetailView.tsx`
- `app/crm/notifications/NotificationsModule.tsx`
- `app/crm/notifications/notification-service.ts`
- `app/crm/page.tsx`
- `app/crm/pipeline/page.tsx`
- `app/crm/request.ts`
- `app/crm/settings/page.tsx`
- `app/crm/tasks/TasksView.tsx`
- `app/crm/tasks/page.tsx`
- `app/crm/workflows/WorkflowsModule.tsx`
- `app/crm/workflows/workflow-service.ts`
- `docs/qa/action-inventory-baseline.json`
- `docs/qa/action-inventory.json`
- `docs/qa/proposed-policy-hardening.sql`
- `eslint.config.mjs`
- `lib/ai/agent-engine.ts`
- `lib/ai/api-errors.ts`
- `lib/ai/crm-agent-tools.ts`
- `lib/ai/deterministic.ts`
- `lib/ai/provider.ts`
- `lib/email/send.ts`
- `next-env.d.ts`
- `package-lock.json`
- `package.json`
- `scripts/audit-actions.mjs`
- `supabase/migrations/20261004132408_full_crm_qa.sql`
- `supabase/migrations/20261004133459_crm_email_and_sync_guards.sql`
- `supabase/migrations/20261004_engagex_sales_workflow_phase2.sql`
- `supabase/migrations/20261005024000_crm_lead_archive_visibility.sql`
- `supabase/migrations/20261005025000_reconcile_task_workflow_runner.sql`
- `supabase/migrations/20261005025100_fix_task_workflow_argument_order.sql`
- `supabase/tests/full_crm_qa.sql`
- `supabase/tests/workflow_inbox_email_qa.sql`
- `tests/agents-contract.test.mjs`
- `tests/migration-gate-contract.test.mjs`
- `tests/runtime-qa.test.mjs`
