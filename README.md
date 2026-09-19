# Wodana SaaS

Clean, multi-tenant foundation for the Wodana interior-design operations platform.

This directory is the **only active Wodana product source**. The previous FastAPI backend and
adjacent frontend are legacy migration references and must not receive new features. See
[the source-of-truth contract](docs/architecture/00-source-of-truth.md) and
[the consolidation register](docs/consolidation-register.md).

For the end-to-end product direction and ordered backend, web and mobile delivery work, read the
[product blueprint](docs/WODANA_PRODUCT_BLUEPRINT.md) and [delivery board](docs/WODANA_TASKS.md).
They describe target behavior; the board's evidence gates determine what is actually complete.
The [internal control-plane plan](docs/WODANA_CONTROL_PLANE.md) covers tenant accounts, onboarding,
domains, access, module entitlements, seats, billing, audit and their web/mobile effects.

## Services

- `apps/web` — Next.js and React frontend.
- `apps/mobile` — React Native / Expo application with CRM, HRMS and pre-project field capture in progress. See [mobile setup](apps/mobile/README.md) and the delivery board for remaining native work.
- `services/business-core` — NestJS system of record for clients, projects, approvals, BOQs, purchasing, production, finance, portals, and permissions.
- `services/intelligence-automation` — Python/FastAPI service for AI, document processing, Google Workspace, QuickBooks, WhatsApp, Zoho Books, webhooks, scheduled automations, and background jobs.
- PostgreSQL — authoritative relational data.
- Redis — queues, locks, idempotency, caching, and short-lived coordination.

The intelligence service never writes business tables directly. It submits authenticated, idempotent commands to Business Core so every important change uses the same permissions, validation, and audit trail.

## Run everything

```bash
cp .env.example .env
npm install
docker compose up --build
```

Open:

- Web: `http://localhost:3000`
- Business API: `http://localhost:8000/api/v1`
- Business OpenAPI: `http://localhost:8000/docs`
- Intelligence API: `http://localhost:8001/api/v1`
- Intelligence OpenAPI: `http://localhost:8001/docs`

The default non-production stack seeds an `Iglo Architects` tenant for the complete login flow:

- Tenant: `iglo-architects`
- Email: `admin@igloarchitects.com`
- Password: `IgloDemo#2026`

The seed is rejected when `NODE_ENV=production`; production remains OIDC-only.

Workspace invitation links are delivered through Mailgun when `MAILGUN_API_KEY` and
`MAILGUN_DOMAIN` are configured. Set `MAILGUN_FROM` to a verified sender and use
`MAILGUN_BASE_URL=https://api.eu.mailgun.net` for an EU Mailgun domain. When the provider is not
configured or rejects a message, the one-time copy link remains available to the administrator.

## Run services without Docker

```bash
npm install
npm run dev:web
npm run dev:business

python3.12 -m venv .venv
source .venv/bin/activate
pip install -e 'services/intelligence-automation[dev]'
uvicorn wodana_intelligence.main:app --reload --port 8001
```

Python 3.12 or newer is required and Python 3.12 is used in the container image.

## Architecture boundaries

1. The web app calls Business Core for all operational reads and writes.
2. Long-running AI and integration work is queued through Redis.
3. Intelligence workers process jobs and submit results back as commands.
4. Provider OAuth tokens are encrypted and scoped to a Wodana workspace; one workspace can connect multiple Google domains and selected calendars.
5. All commands will carry tenant, actor, idempotency, and correlation identifiers.

## Implemented modules

The Workspace and Organization foundation is implemented in Business Core. It includes identity resolution, internal idempotent tenant provisioning, first-owner invitations, authenticated bootstrap routing, resumable onboarding, tenant membership, multiple legal entities, business units, currencies and regional defaults, RBAC, integration connection records, audit events, an outbox, idempotency storage, webhook intake storage, PostgreSQL row-level security, and cross-tenant reference guards.

See [the workspace foundation architecture](docs/architecture/01-workspace-foundation.md) for the schema boundary, API routes, security invariants, and verification commands.

The Google Workspace Integration Hub backend is also implemented. It supports multiple domains per
workspace, scoped OAuth with PKCE and one-time state, encrypted offline credentials, selected
calendars, unified free/busy, idempotent event creation, ETag-protected edits, revoke, audit, and
cross-service health checks. See [the Google Workspace integration architecture](docs/architecture/02-google-workspace-integration.md).

The Integration Hub also includes QuickBooks and Zoho Books invoice/record tools, tenant-owned
WhatsApp Embedded Signup and template messaging, and optional Gmail/Drive actions. Provider app
credentials and live account tests are still required. See [the integration setup, module use cases,
and client demo guide](docs/integrations-guide.md) for exact capabilities and remaining module bindings.

Organization logo upload is intentionally modeled as a Workspace & Organization capability rather
than provider configuration. Its object-storage and legal-entity override contract is recorded in the
integration architecture so portals and generated documents share one authoritative brand profile.

The CRM backend is implemented module-by-module from customer graph and intake through leads,
assignment, SLA, work, communications, opportunities, automation, notifications, reporting, and a
stable Projects handoff boundary. See [the CRM backend architecture](docs/architecture/03-crm-backend.md)
for its invariants, routes, worker behavior, migration path, verification, and explicitly deferred
provider/frontend work.

Database migrations run with the PostgreSQL owner role. The application runs with the separate `wodana_app` role so row-level security cannot be bypassed. In production, set `NODE_ENV=production`, `AUTH_MODE=oidc`, and the three `OIDC_*` settings; development-header authentication is deliberately rejected in production.

## Production infrastructure

The Hostinger/VPS setup covers TLS proxying, automatic migration gating, health checks, persistent
PostgreSQL/Redis/object data, workers, backups, certificate renewal, tenant-domain certificates,
resource limits, and CI validation. Provider callbacks and signed webhooks use a separate integration
hostname so they cannot conflict with web or Business Core routes.

No deployment is performed by this setup. See [the production host runbook](infra/hostinger/README.md)
and validate a completed, untracked `.env.production` with `./infra/hostinger/validate.sh`.
