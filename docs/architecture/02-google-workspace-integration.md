# Google Workspace Integration Hub

## Outcome

Wodana can connect multiple Google Workspace domains to one Wodana workspace. A typical
configuration can therefore use `palmlivingae.com` for client and operations calendars and
`odginteriors.com` for production calendars, while the Wodana owner still signs in with one
application account such as `operations@palmlivingae.com`.

Each Google connection belongs to one Wodana workspace and one legal entity. Users explicitly
select the calendars Wodana may use. Availability can be queried across as many as ten connections
in one request, so scheduling can find a time that works across both sister companies.

## Service boundary

- Business Core owns connection status, legal-entity ownership, selected calendars, permissions,
  optimistic versions, audit history, and outbox events.
- Intelligence & Automation owns OAuth, encrypted provider credentials, Google API calls, token
  refresh, provider error normalization, and availability merging.
- The browser never receives a Google refresh token, the encrypted credential, or its storage
  reference.
- The Python service cannot write Business Core tables. Its internal commands use a dedicated,
  timing-safe service credential.

## Connection flow

1. An owner creates a `google_workspace` connection with its legal entity and exact domain.
2. The UI requests OAuth using the connection's current version and desired access mode.
3. Business Core checks `integrations.manage`, locks the connection, and moves it to `pending`.
4. Intelligence issues a one-time Redis-backed OAuth state and PKCE verifier, then returns the
   Google authorization URL with offline access and the configured hosted-domain hint.
5. The callback atomically consumes the state, exchanges the code, verifies the Google email, and
   enforces an exact domain match. The hosted-domain hint is only a UX hint; the verified email is
   the security boundary.
6. Accessible calendars are discovered. The primary calendar is selected by default; all others
   require an explicit user choice.
7. Refresh and access tokens are encrypted before storage. Business Core receives only an opaque
   secret reference and non-secret connection metadata.
8. OAuth failure marks the connection `degraded` with a safe error code. A new connect attempt uses
   a new version and one-time state.

Available access modes:

| Mode | Purpose | Calendar event access |
| --- | --- | --- |
| `availability` | Scheduling across teams | Free/busy only |
| `read` | Availability plus event context | Read-only |
| `manage` | Wodana-created visits, reviews, and production bookings | Create, update, cancel |

## Calendar behavior

- Calendar discovery handles Google pagination and preserves existing user selections.
- Removed Google calendars are retained for history but marked unavailable and disabled.
- Availability supports one to ten connections, a maximum 31-day window, IANA timezones, Google
  request chunks of 50 calendars, per-calendar error reporting, and merged overlapping busy time.
- Event creation requires a selected writable calendar and `manage` consent. A deterministic Google
  event ID makes retries idempotent; reuse of the same idempotency key with different content is a
  conflict.
- Update and cancel require the last Google ETag. Concurrent Google edits return a conflict rather
  than silently overwriting another person's change.
- Create, update, cancel, connection, and calendar-selection actions enter the Wodana audit/outbox
  trail. Credential-shaped metadata is rejected from audit activity.
- Revocation updates Business Core first, attempts provider revocation, and always removes the local
  encrypted credential.

## Public APIs

Business Core (`/api/v1`):

| Method | Route | Use |
| --- | --- | --- |
| `GET/POST` | `/workspaces/:workspaceId/integration-connections` | List or register connections |
| `PATCH` | `/workspaces/:workspaceId/integration-connections/:connectionId` | Edit safe connection settings |
| `GET` | `/workspaces/:workspaceId/integration-connections/:connectionId` | Read one safe connection |
| `GET/PATCH` | `/workspaces/:workspaceId/integration-connections/:connectionId/resources` | Read or select calendars |

Intelligence & Automation (`/api/v1/integrations/google`):

| Method | Route | Use |
| --- | --- | --- |
| `POST` | `/oauth/start` | Start domain-bound Google consent |
| `GET` | `/oauth/callback` | Google callback; redirects to Integration Hub |
| `GET` | `/workspaces/:workspaceId/connections/:connectionId/calendars` | Refresh calendar discovery |
| `POST` | `/availability` | Merge free/busy across selected domains |
| `POST` | `/events` | Create an idempotent Wodana-owned event |
| `PATCH` | `/events/:eventId` | Update with ETag concurrency protection |
| `POST` | `/events/:eventId/cancel` | Cancel with ETag concurrency protection |
| `DELETE` | `/workspaces/:workspaceId/connections/:connectionId?version=N` | Revoke connection and credentials |

Internal Business Core routes live under `/api/v1/internal/integrations`. They require
`x-wodana-internal-token` and are not browser APIs.

## Production configuration

Enable Google Calendar API in a Google Cloud project and configure an OAuth web client. Register the
exact callback URL used by `GOOGLE_REDIRECT_URI`. Configure the consent screen and request the minimum
access mode needed by the workspace. Google apps left in Testing mode can issue refresh tokens that
expire quickly, so production consent-screen verification and publishing must be completed before
customer rollout.

Required secrets and origins:

```dotenv
ENVIRONMENT=production
WEB_ORIGIN=https://app.wodana.ai
BUSINESS_CORE_URL=https://business-api.wodana.ai/api/v1
BUSINESS_CORE_INTERNAL_TOKEN=<at-least-32-random-characters>
INTEGRATIONS_ENCRYPTION_KEY=<managed-random-secret-at-least-32-characters>
GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
GOOGLE_REDIRECT_URI=https://intelligence-api.wodana.ai/api/v1/integrations/google/oauth/callback
REDIS_URL=<tls-enabled-managed-redis-url>
```

Production startup rejects development secrets, missing Google credentials, non-HTTPS browser
origins, and non-HTTPS OAuth callbacks. Redis persistence is enabled in local Compose. Production
should use managed Redis with encryption, backups, and private networking; a cloud secret manager is
the planned replacement behind the credential-vault interface.

## Organization branding boundary

Logo upload belongs to Workspace & Organization, not to Google OAuth. It must be implemented as a
workspace brand profile with optional legal-entity overrides, so sister companies can share a Wodana
workspace while issuing correctly branded BOQs, invoices, approval links, portals, and emails.

The implementation should store only object keys and image metadata in PostgreSQL. The browser will
upload through short-lived signed object-storage URLs; the server will verify ownership, MIME type,
dimensions, byte size, and upload completion before activating a logo. Original, dark/light, square,
and document-safe variants should be generated asynchronously. No image binary or public bucket URL
belongs in a workspace row. Until that upload pipeline is implemented, generated business documents
must not pretend a placeholder is an organization's real logo.

## Verification

```bash
npm run typecheck --workspace @wodana/business-core
npm test --workspace @wodana/business-core
npm run build --workspace @wodana/business-core
BUSINESS_CORE_URL=http://127.0.0.1:8010/api/v1 npm run test:smoke --workspace @wodana/business-core
BUSINESS_CORE_URL=http://127.0.0.1:8010/api/v1 \
  BUSINESS_CORE_INTERNAL_TOKEN=local-test-internal-token \
  npm run test:smoke:google --workspace @wodana/business-core

.venv/bin/ruff check services/intelligence-automation/src services/intelligence-automation/tests
.venv/bin/mypy services/intelligence-automation/src
.venv/bin/pytest services/intelligence-automation/tests -q
```

Automated tests use mocked Google responses. A real provider smoke test additionally requires the
Google OAuth client, a consent-screen test user, and one account in each domain to be connected.
