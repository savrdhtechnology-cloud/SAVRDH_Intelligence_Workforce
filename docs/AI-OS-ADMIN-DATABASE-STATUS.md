# SAVRDH AI OS Admin database implementation

Supabase project: gsudlmrmrefqqodpdeug (staging).
Database migration: ai_os_admin_foundation_additive. Eight private RLS-enabled tables created; no legacy tables deleted.

## Implemented in this branch
- Authenticated and membership-checked /api/admin/products GET/POST.
- Authenticated and membership-checked /api/admin/assignments GET/POST.
- Assignment creates DRAFT only after checking matching agent and product workspace.
- UI in Admin > Product Integrations reads/saves registry through the API.
- Request helpers use the deployed site base path.

## Security blockers before activation
- The sav_ai_admin schema is private and not exposed to PostgREST by default. Verify the server-only access strategy in staging before using these APIs. Do not expose private tables directly to anon/authenticated clients merely to make the UI work.
- Server-only Supabase admin credentials are required by the current handlers. Never place service-role credentials in NEXT_PUBLIC variables, browser storage, screenshots or Git.
- Add enforced admin RPC boundary or a supported direct-Postgres backend where private-schema access is unavailable.
- Audit inserts need transactional enforcement rather than best-effort logging.
- Add API tests for forged tokens, role restrictions, cross-workspace access and duplicate key handling.
- Verify preview builds, migrations, browser flows and rollback plan before merge.
- Agent models, knowledge grants, test-run storage and approvals still need dedicated authenticated APIs.
