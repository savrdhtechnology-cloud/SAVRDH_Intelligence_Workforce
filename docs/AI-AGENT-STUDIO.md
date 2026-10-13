# SAVRDH Visual AI Agent Studio — implementation plan

## Baseline / scope
Repository: `savrdhtechnology-cloud/SAVRDH_Intelligence_Workforce`.
Protect the working `/crm`, `/crm/agents`, `/crm/workflows`, tasks, authentication, Supabase policies, execution and audit history. Preserve existing workflow graph schema and RPC implementations.

## Phase 1 (this branch)
- Add authenticated Studio entry at `/crm/agent-studio` exposing the **existing real** Workflow Engine.
- Link Agent Library, Execution Logs, Workflow Registry.
- Do not duplicate a mock runtime, hard-code agent IDs, create bypass auth, or activate any workflows on navigation.
- Only a new route and documentation are introduced here; existing canvas controls remain as-is.

## Phase 2 — Canvas polish
- Enhance the existing `WorkflowsModule` canvas, not a second graph engine.
- Node palette: trigger, AI_AGENT, ACTION, CONDITION, TASK, FOLLOW_UP, WAIT, HUMAN_APPROVAL, NOTIFICATION, ESCALATION, END.
- Pointer / touch drag, zoom scoped to canvas, fit view, minimap, connect/disconnect handles, typed branches, keyboard delete, undo/redo, auto layout.
- Node editor shows agent registry entries loaded from Supabase; no invented agents. Configured providers display status with secret values masked.
- Dark premium motion with accessible contrast, reduced-motion support and 1024–1920px layouts.

## Phase 3 — Agent test harness
- Dry run validates graph and performs zero external sends or irreversible writes.
- Context fixtures for lead received, task due, customer reply and fee follow-up.
- Inspect inputs/outputs, step timing, provider errors, retry decision and redacted logs.
- Persist test runs separately from live executions and explicitly indicate simulated results.
- Live execution must ask for permission and obey existing server-side role checks, replay protection and idempotency.

## Phase 4 — Cross-system integrations
- Scoped adapters for Savrdh Technology CRM, EngageX, JARVIS and third-party tools.
- Start read-only; each outbound action opt-in and auditable.
- Tenant isolation, least-privilege credentials, credential rotation and delivery confirmation; no client-side service keys.
- Email/SMS/WhatsApp limited by consent, recipient preferences, rate limits and verified provider delivery.
- Human approval before financial decisions, transactions, customer-facing high-risk actions or deployments.

## Required checks
1. Unauthenticated studio route cannot expose workflow data.
2. Agent registry data reflect the current tenant and user role.
3. Create, edit, connect, save, reload and version a graph with nodes/edges preserved.
4. Dry run sends nothing and does not mutate CRM customer records.
5. Test output accurately distinguishes model/provider failures from CRM failures.
6. Pause/disable stops future scheduling; permission denial is enforced server-side.
7. Replay idempotency prevents duplicate sends; approval is audited.
8. All existing CRM, tasks, workflows, agent and login routes still work.
9. `npm run typecheck`, `npm test`, production build plus authenticated browser smoke tests pass.

## Release policy
Do not merge to main, deploy to production, alter migrations, or apply QA/security PR without explicit approval after reviewing preview and rollback.
Rollback: revert feature PR; original routes and database schema remain unchanged.
