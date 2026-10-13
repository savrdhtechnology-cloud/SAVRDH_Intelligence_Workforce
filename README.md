# SAV-AI-WorkforceTeam

Central AI workforce platform for Savrdh applications.

## Scope
Standalone AI workforce. CRM integrations are intentionally not connected yet.

## AI workforce
- SAV-Sales — Sales & Telecalling Executive
- SAV-BDE — Business Development Executive
- SAV-Sales-Manager — Sales Management
- SAV-Finance — Finance Manager
- SAV-Credit — Credit & Risk Executive
- SAV-Document — Documentation Executive
- SAV-Followup — Customer Follow-up Executive
- SAV-Support — Customer Support Executive

## Channels
Voice inbound/outbound, WhatsApp, Email, SMS.

## Core
AI orchestration, workflow engine, lead engine, knowledge base, conversation memory, escalation, analytics, integrations, API, admin.

## Principles
- CRM integrations are adapters and can be enabled/disabled independently.
- Agents use permissioned tools, not unrestricted database access.
- Critical approvals remain human-controlled.
- Agent actions are auditable.
- Company-specific workflows and knowledge are configurable.

## Planned integrations
- EngageX
- Savrdh Technology CRM
- AKBS Poultry CRM

Integration will be decided and implemented later.
## AI brain
Agents run on a self-hosted open model by default (Ollama on a Mac for development, vLLM on a GPU server for production) — no paid AI API. OpenAI remains an optional fallback. Setup: `docs/SELF-HOSTED-AI.md`, then `npm run ai:check`.
