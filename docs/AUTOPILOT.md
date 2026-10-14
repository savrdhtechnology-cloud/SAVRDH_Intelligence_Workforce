# Autopilot — how the agents work without anyone pressing a button

The autopilot is a set of fixed rules inside the database. **It uses no AI model.** AI is only needed later, inside a task, when something must be read or written in natural language.

Source: `supabase/migrations/20261013150000_autopilot_live_baseline.sql` (exported from the live database on 13 Oct 2026; previously it existed only there).

## Every hour (pg_cron, minute 7)

`sav_ai_crm_run_autopilot_cycle(250)` looks at each AKBS lead, works out its stage, and acts once per stage:

| Stage (how it is detected) | What happens |
|---|---|
| **NEW** (default) | Task for **SAV-Sales**: qualify the lead. Email reminder after 24 h. |
| **CONTACTED** (status or `akbs_stage`) | Task for **SAV-Followup**. Email reminder after 24 h. |
| **FEE_PENDING** (`fee_required` and fee not verified) | Fee gate: credit/document/finance/manager work is paused. Fee reminder email after 24 h. |
| **FEE_REVIEW** (proof submitted) | Everything paused, reminders stopped while staff verify. |
| **DOCUMENTS** (`application_id` present) | Task for **SAV-Document**. |
| **QUALIFIED** | Task for **SAV-Credit** (never makes a lending decision). |
| **PROPOSAL / NEGOTIATION** | Task for **SAV-Sales-Manager**. |
| **CLOSED** (won/lost/closed) | Autopilot stops for this lead. |

**Customer emails need approval (since 13 Oct):** a due reminder is not sent; it waits in Admin → Human Approvals → Email approvals with the full text. Only an owner or admin can send it; if the lead changes first, it is cancelled and nothing is sent.

Reminders: at most 3 per stage — after 24 hours, then 3 days, then 7 days — then the lead is marked escalated. Every action is logged in `lead_autopilot_events` and the lead's activity timeline.

Then `sav_ai_crm_process_autonomous_queue(100)` runs every pending agent task through the workflow mapped to its work type (`task_workflow_routes`), e.g. sales → "Sales Task Execution".

## Instantly (triggers)

- A new AKBS lead is registered for the six agents (`trg_register_akbs_lead_agents`).
- A pending task assigned to an enabled agent starts its workflow right away (`trg_autonomous_task_dispatch`).

## Limits today

- Only `leads.source = 'akbs'`. EngageX and other sources are not on autopilot yet.
- Background runs act as the first owner/admin of the workspace (impersonation via `request.jwt.claim.sub`). This should become a dedicated system actor.
- Reminder emails are AKBS-branded and sent through Resend from the database.

## Security

`20261013151000_autopilot_lockdown.sql` removes the public key's ability to run the cycle, send reminder emails or apply the fee gate. Only the hourly job (postgres) and server code with the service-role key can run them.

## Trial runs need approval

A manual trial of the autopilot never runs straight away. It is filed as a request and waits in **Admin → Human Approvals → Trial run approvals** (`supabase/migrations/20261013170000_trial_run_approvals.sql`).

1. Anyone with CRM write access (or server automation via `sav_ai_crm.request_trial_run_system`) files a request with a reason and a lead limit.
2. The card shows a live preview: AKBS leads, new agent tasks it would create, **customer emails it would send**, and agent tasks waiting to run.
3. An owner or admin presses **Approve & run** (it runs immediately and the result is saved) or **Reject**. Requests expire after 72 hours. Every step is written to `audit_logs`.

This gate covers manual trials only; the hourly autopilot keeps running unchanged.

## Emails go through AKBS CRM (since 14 Oct)

An approved reminder is no longer sent by the Workforce itself. It is handed to the AKBS CRM edge function `akbs-workforce-reminder` (AKBS Supabase project `ldffgetuzoeupuhoaubn`), which:

- matches the AKBS lead by email (refuses if none or more than one),
- applies AKBS's own checks (registration only before the application is submitted; fee reminder only while the fee is PENDING) and its 60-minute cooldown,
- sends with AKBS's email settings and HTML template (sender `website@akbspoultry.com`),
- writes `REGISTRATION_REMINDER_EMAILED` / `FEE_REMINDER_EMAILED` on the AKBS lead timeline as "AI Workforce · <agent>".

Authentication: a random token kept only in the Workforce vault (`akbs_workforce_function_token`); AKBS stores only its SHA-256 (`akbs_crm.workforce_access`). AKBS's answer is recorded on the approval by `sav_ai_crm.reconcile_akbs_email_results()` at the start of every hourly cycle and is shown in Workflows → Customer messages.

The 15 emails sent on 7–13 Oct went directly from `updates@akbspoultry.com`, not through AKBS CRM; they are not on the AKBS timeline and delivery is unconfirmed.
