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
