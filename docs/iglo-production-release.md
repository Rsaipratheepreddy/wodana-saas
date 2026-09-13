# Iglo production release — 7 September 2026

The current application went live at **06:48 UTC** on the existing server, including the landing page,
workspace, quotation builder, client portal and project delivery module. Public HTTPS responses identify
release `20260907-material-builder` after the quotation materials update. The original database, uploads, services and proxy configuration remain available
for rollback.

The quotation cover was updated in the [first quotation UI release](quotation-ui-release-20260907.md).
The current [material builder release](quotation-material-builder-20260907.md) adds linked catalog selections,
compact inputs and the Preparation material-identity handoff. It contains current routing and rollback details.

## Verified links

| Purpose | URL |
| --- | --- |
| Landing | https://wodana.ai/ |
| Iglo sign-in | https://iglo.wodana.ai/login |
| Iglo workspace | https://iglo.wodana.ai/workspace |
| Client portal | https://client.wodana.ai/portal/iglo-architects |
| Shared sign-in domain | https://admin.wodana.ai/login |
| Core readiness | https://api.wodana.ai/api/v1/health/ready |

The previous `admin.aristospace.com` and `iglo.aristospace.com` domains now have valid HTTPS
certificates and redirect to their corresponding current Wodana domains.

The shared sign-in domain does not grant platform administration. No legacy user had platform-admin
status, and none was promoted to platform administrator during this release.

## Preserved access and connected data

- All **26 original user IDs, email addresses, password hashes, active states and memberships** were
  preserved and fingerprint-compared before commit. The existing owner retains workspace ownership;
  other staff receive their mapped operational roles. Client accounts have no internal staff permissions.
- The original Iglo tenant ID is retained. Regional configuration is **Dubai / AED / en-AE / Asia/Dubai**.
- Two current catalogs were migrated: **9,226 records and 37,517 links**. Room, work, material, finish and
  unit selections return records from the production API. Source product specifications remain reference
  data; imported foreign prices are not treated as confirmed Dubai rate cards.
- Four coherent demonstration scenarios replace the old business dataset in the new isolated database:
  Jumeirah villa execution, DIFC office quotation revision, Palm Jumeirah penthouse handover, and a café
  discovery lead. These are sales scenarios, not represented as actual customer transactions.
- Quotation versions, catalog-linked room scope, payment milestones, agreements and project releases
  connect to execution tasks, team bookings, materials, order receipts, site/factory reports, inspections,
  snags and handover areas. Historical approval/receipt examples are explicitly recorded as demonstration
  imports. No live invoice, payment, contract acceptance or customer notification was fabricated.
- The user's supplied mobile retains viewer access to the villa client portal. Access settings remain a
  separate tab. Production uses randomly generated WhatsApp OTPs; fixed `123456` mode is disabled.

## Provider results and limits

| Provider | Production verification | Remaining boundary |
| --- | --- | --- |
| Google | Migrated token; two calendars returned successfully | Public OAuth redirect registration must be checked before future reconnects |
| WhatsApp | Existing sender verified; approved authentication template; webhook moved from temporary tunnel to production and verified active | A real recipient must enter the received OTP to complete the login check |
| QuickBooks | Migrated connection; 31 invoice records read successfully | Existing company is a **US sandbox**, not live Dubai accounting |
| Zoho Books | Migrated connection; invoice list read successfully | Existing organization is **Wodana Technology / INR**, not the client's AED organization |
| Gemini | Supplied key accepted by Google; configured model `gemini-2.5-flash` | No claim of exhaustive extraction accuracy |
| Mailgun | Existing domain checked active; recovery delivery configured | No unsolicited test email was sent |

OAuth callbacks use the existing certified `api.wodana.ai` domain. Future live QuickBooks/Zoho account
connections require the correct company/organization authorization. Existing tokens were re-encrypted
with a new production vault key and stored in persistent Redis. No credentials belong in this document.

The WhatsApp webhook is
`https://api.wodana.ai/api/v1/integrations/providers/webhooks/whatsapp`.
The approved template is `wodana_portal_login`, `en_US`, with five-minute code expiry.

## Deployment and recovery

- Release directory: `/opt/wodana/releases/20260907`.
- Native PostgreSQL and native nginx remain in use. New database: `wodana_release`, with separate
  migration-owner and restricted application roles; the original `igolo` database is unchanged.
- New services bind only to loopback: current web 13020, current public core 18010, retained previous web 13010/13000,
  previous/internal core 18000, integration API 18001, Redis 16379.
  Images were built for the server's linux/amd64 architecture off-host. All services restart automatically.
- File storage is the local Docker volume `wodana-release-objects`. Redis uses the persistent
  `wodana-release-redis` volume, AOF and `noeviction`.
- Native-host deployment profile: `infra/hostinger/compose.native-host.yaml`. Do not use the standalone
  nginx/Postgres profile to update this existing installation.
- Original backup: `/var/backups/wodana/pre-rewrite-20260907`. Database restoration into an isolated
  check database succeeded with all 26 users. Code/upload archives and checksums were verified.
- Current backup: `/var/backups/wodana/current/release-20260907T065759Z`. Includes database,
  PostgreSQL globals, encrypted provider Redis state, objects, private runtime configuration and proxy.
  `infra/hostinger/backup.native-host.sh` is the matching backup procedure.
- Immediate traffic rollback: run `/opt/wodana/releases/20260907/rollback.sh` as root. This reloads the
  preserved nginx configuration and leaves the new database intact. If the new service has received
  user writes, reconcile them before any later return to the new release.
- The background worker was enabled after confirming all 63 seeded notifications were already
  delivered **in-app**, with no external notification jobs and no enabled automations. It drained 172
  events with zero pending entries and zero lag. Old background workers were stopped to avoid
  processing the superseded dataset. The rollback script restores them and stops the new worker.
- `wodana-release-backup.timer` backs up the current database, provider vault and files every six hours.
  The existing certificate renewal service remains enabled.

## Validation

- Before deployment: 246 backend unit checks, 2 image/storage checks, 4 recovery UI checks, backend/web
  type checks, clean container builds and connected commercial/project smoke checks passed. Production
  legacy-bcrypt compatibility, refresh rotation, tenant isolation and invalid-token rejection were tested.
- Migration: identity fingerprints matched, all new migrations applied, restricted database role booted,
  provider reads succeeded and the legacy backup was restored independently.
- Public deployment: landing, Iglo sign-in, shared sign-in, client portal and core readiness returned 200.
- Browser checks: desktop and mobile quotation lists, BOQ, payments, plan, integration settings, project
  overview, production and daily reports rendered without JavaScript errors or horizontal page overflow.
  The correct Leads route is `/workspace/crm/leads`; `/workspace/leads` is not an application route.
- The document builder was opened from a single quotation. Material search and room catalogs were
  exercised against the public API and visible dropdowns (77 room choices; material search returned 100
  matches). Public provider reads passed again; anonymous portal data and invalid OTP challenges were
  rejected with 401. Daily reports opened as readable reports with quantities, author,
  workforce, safety, issues and next steps. Existing reports contain no fabricated site photographs.
- Public checks do not establish real bank settlement, live AED books authorization, OTP receipt and
  entry, or provider-console redirect allowlisting. Those boundaries remain explicit above.
