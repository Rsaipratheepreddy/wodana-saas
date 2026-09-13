# CRM Backend

Current frontend/provider readiness is tracked in [CRM readiness](../crm-readiness.md). The backend
capabilities below must not be read as a claim that all frontend and live provider flows are complete.

## Outcome

The CRM backend is an independent product module covering customer intake through a won-opportunity
handoff. It is global and industry-neutral: no customer name, country, currency, service taxonomy,
or Palm Living-specific workflow is hardcoded.

Business Core is the only writer of CRM state. PostgreSQL stores operational truth and an atomic
outbox. Redis Streams distributes at-least-once domain events. The Python worker coordinates timers,
automation graphs, and delivery adapters by calling protected Business Core commands; it never gets
a PostgreSQL credential.

This module stops at the Projects boundary. A won opportunity can emit an idempotent project-handoff
request or link a future project ID, but Projects, BOQ, procurement, production, and Finance records
are not implemented by CRM.

## Delivered slices

1. **Customer graph** — people, organizations, households, editable profiles, relationships, contact
   points, addresses, consent, typed custom fields, normalized search, export, archive, privacy
   erasure, reversible merges, and audit history.
2. **Intake and identity** — immutable intake events, external/idempotency identities, enquiries,
   attribution, exact matching, fuzzy review candidates, duplicate decisions, and failure state.
3. **Leads, assignment, and SLA** — qualification, queues, capacity, availability, rule simulation,
   relationship-owner preservation, deterministic load ranking, durable round robin, fallback queues,
   manual overrides, warnings, and breaches.
4. **Work and communications** — activities, appointments, one active next action, conversations,
   inbound/outbound messages, delivery receipts, customer-reply handling, and Today prioritization.
5. **Opportunities** — editable pipelines/stages, entry requirements, stakeholders, opportunity
   teams, permission-redacted sensitive values, ISO currencies, reporting-currency snapshots,
   forecast state, stage history, win/loss/reopen, and the Projects handoff contract.
6. **Automation and notifications** — immutable published versions, validation, dry runs, bounded
   iteration, waits, approvals, repeat-safe execution, sequences, notification policies, templates,
   preferences, quiet hours, frequency limits, delivery attempts, retry, suppression, and exceptions.
7. **Reporting** — funnel, SLA, source, assignment, pipeline, and forecast queries backed by immutable
   history/snapshots where later configuration changes must not rewrite the past.

New workspaces receive six disabled automation templates: new-enquiry assignment, customer-reply
follow-up, SLA escalation, appointment reminder, won-opportunity handoff, and consent-withdrawal
protection. Migration `0013` backfills them for existing workspaces. They cannot execute until an
authorized user validates, configures, and publishes them.

## Core invariants

- Every tenant-owned table carries `workspace_id`; all 57 CRM/automation/notification tables have
  PostgreSQL RLS enabled and cross-workspace references are rejected.
- People, organizations, and households are parties. One party can own several enquiries and
  opportunities without copying customer data.
- Intake state, lead status, opportunity stage, and customer lifecycle are independent concepts.
- Exact verified identifiers may match automatically. Fuzzy matches only create review candidates.
- Merges redirect history to a survivor and remain reversible; archive and privacy erasure are
  separate operations.
- Mutable commands expose optimistic versions and reject stale updates.
- Money always has an ISO 4217 currency. Forecast conversions persist the rate, rate date, source,
  and reporting currency used at snapshot time.
- Active leads and opportunities require ownership, a next action, an active sequence, or a recorded
  paused reason; Today ranks work deterministically so records are not silently forgotten.
- Outbound communication requires an approved template when the channel requires one, the latest
  applicable consent, recipient preference, policy limits, a valid destination, and a deliverable
  local-time window. Consent is checked again when a queued job is claimed.
- Published automation versions are immutable. Cycles require an explicit bounded iterator, actions
  are idempotent, and Business Core validates every business mutation.

## Public API

Browser APIs are under `/api/v1/workspaces/:workspaceId/crm` and require workspace permissions.
Current OpenAPI exposes 89 CRM paths and 106 operations with validated request schemas.

| Area | Routes |
| --- | --- |
| Customers | `/parties`, `/parties/:id`, contacts, addresses, consent, relationships, export, archive, privacy erasure, merge/reverse |
| Intake | `/intake-events`, `/intake-inbox`, `/enquiries`, duplicate review |
| Leads | `/leads`, qualification, status, assign/auto-assign, assignment simulation |
| Policies | editable `/queues`, `/assignment-policies`, and `/sla-policies` |
| Work | `/activities`, completion, appointments, `/today` |
| Conversations | `/conversations`, messages, read state, editable sequences and enrollments |
| Sales | editable `/pipelines` and stages, `/opportunities`, transitions, stakeholders, team, project links |
| Automation | `/automations`, validate, dry-run, publish, pause, runs, approvals |
| Delivery | notification templates, policies, preferences, inbox, and read state |
| Configuration | editable taxonomies, custom fields, qualification forms, saved views, archive |
| Reporting | `/reports/funnel`, `/sla`, `/sources`, `/assignment`, `/pipeline`, `/forecast` |

List endpoints use validated filters, explicit ordering, bounded limits, and opaque keyset cursors.
The generated contract is available at `/docs` and `/docs-json`.

Internal routes live under `/api/v1/internal/crm` and require the timing-safe
`x-wodana-internal-token`. They cover provider intake, message receipts, due SLA/sequence/wait work,
automation matching and commands, notification enqueue/claim/result, and safe run context.

## Event and worker behavior

Business transactions append audit and outbox records atomically. The NestJS publisher claims rows
with leases and `FOR UPDATE SKIP LOCKED`, publishes to `wodana:domain-events`, and marks completion
only after Redis accepts the event. Python consumer groups acknowledge only after Business Core
accepts the resulting command.

Every writer stores the same versioned domain-event envelope defined in `packages/contracts`.
The publisher upgrades pending pre-CRM payloads while publishing, and the worker can also consume
legacy entries that were already present in Redis during a rolling deployment. This compatibility
path preserves the business data, processes each old entry once, and keeps new entries strict.

Delivery is deliberately at least once. Database identities, command idempotency keys, unique step
attempts, sequence row locks, and run-once-per-aggregate locks prevent duplicate business effects.
Stale outbox leases and automation wait claims are recoverable. Notification retries are bounded and
numbered independently from record versions; notification claims abandoned by a crashed worker are
reclaimed after five minutes. Permanent delivery failures remain visible, while malformed event
envelopes are persisted to the bounded `wodana:domain-events:dead-letter` stream before the source
message is acknowledged. Shutdown stops new claims, finishes bounded in-flight work, and leaves
unacknowledged Redis messages recoverable.

Supported automation nodes are trigger, filter, lookup, branch, delay, SLA timer, assign, create
task, update record, enroll/stop sequence, send approved template, request approval, emit webhook,
create project handoff, bounded iteration, and end. Sequence steps support email, WhatsApp, task,
and delay. A customer reply exits active outreach immediately; consent withdrawal or opt-out also
prevents later delivery.

## Permissions

Twenty-four granular `crm.*` permissions cover customer viewing/editing/export/merge, consent,
leads and assignment, opportunities and sensitive values, activities, communication, settings,
automation management/publishing, notification management, reporting, audit, and privacy erasure.
Owners and administrators receive all registered permissions. Standard members receive operational
permissions; viewers remain read-only according to workspace role configuration.

## Migrations

CRM uses sequential migrations `0006–0015`; migrations `0000–0005` are unchanged.

- `0006` creates the CRM, automation, notification, history, and reporting schema.
- `0007` installs RLS, tenant guards, search indexes, invariants, and permissions.
- `0008–0012` add recoverable outbox leases, precise due-work discovery, delivery guards, and due
  sequence discovery.
- `0013` installs disabled generic automation templates for old workspaces.
- `0014` safely corrects only untouched draft reminder/consent templates; customized or published
  versions are never overwritten.
- `0015` adds recoverable notification claims and precise delivery-attempt numbering.

Migrations run with the database owner. The application should use a separate non-owner role so RLS
cannot be bypassed.

## Verification

```bash
npm run typecheck
npm run test
npm run build
npm run lint

DATABASE_URL=<owner-migration-url> npm run db:migrate --workspace @wodana/business-core
BUSINESS_CORE_URL=http://127.0.0.1:8000/api/v1 \
  BUSINESS_CORE_INTERNAL_TOKEN=<local-token> \
  npm run test:smoke:crm --workspace @wodana/business-core

cd services/intelligence-automation
../../.venv/bin/ruff check .
../../.venv/bin/mypy src --strict
../../.venv/bin/pytest -q
```

The CRM smoke covers Arabic/mixed-direction customer data, AED/INR/USD, manual intake and replay,
enquiries, assignment, SLA, activities, conversations, a real due sequence step, qualification,
customer/contact/address/relationship editing, JSON/CSV export, archive, privacy erasure, opportunity
teams, pipeline/stage administration, opportunity win, Projects handoff, reversible merge,
automation replay, notification delivery, frequency limits, consent withdrawal, all six reports,
Today, and cross-workspace isolation. It also verifies sensitive opportunity values are gated by
their dedicated permission.

## Iglo demonstration data

The repeatable API-level seed targets the `iglo-architects` workspace and refuses production unless
explicitly authorized. It creates realistic UAE architecture and interior-design customers,
organizations, enquiries, leads, AED opportunities, activities, conversations, a sales pipeline,
routing/SLA configuration, CRM taxonomies, custom fields, a qualification form, approved templates,
and a draft follow-up sequence. Running it again reconciles by deterministic codes and intake
idempotency keys instead of duplicating records.

```bash
BUSINESS_CORE_URL=http://127.0.0.1:8000/api/v1 \
  npm run seed:crm:iglo --workspace @wodana/business-core
```

To target another non-production workspace, set `CRM_SEED_WORKSPACE_SLUG`. For an authenticated
deployment, set `CRM_SEED_TOKEN`; development mode uses the documented local actor headers.

## Deliberately deferred

- Real email, WhatsApp, mobile-push, and webhook provider credentials/clients. Typed adapters and
  deterministic/unconfigured test adapters are present, so credentials do not block backend tests.
- Autonomous AI qualification or scoring. Woddy now provides live Gemini advisory chat and review;
  deterministic assignment, consent, stage validation, and money remain non-AI rules.
- Projects, commercial documents, BOQ, procurement, production, Finance, and their portals.
- Remaining frontend and provider integration gaps are listed in the readiness audit. The new
  frontend now uses these APIs; the legacy application is outside this implementation.

These are product boundaries, not hidden partial implementations. A provider reports unconfigured
until its secret-backed adapter is installed; CRM never claims a real delivery succeeded when it did
not.
