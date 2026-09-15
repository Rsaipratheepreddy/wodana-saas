# Client-facing backend contracts — 13 September 2026

These contracts are the stable backend inputs for the later frontend cleanup. They are additive;
existing project, quotation, and execution routes remain available.

## Multi-factor authentication

Password sign-in now returns either a normal session or a five-minute MFA challenge. The challenge
accepts a six-digit authenticator code or one recovery code and can be consumed only once. Confirmed
TOTP secrets are encrypted with AES-256-GCM; recovery codes are returned once and stored only as
keyed hashes.

Customer accounts require MFA for owners and administrators by default, with a seven-day enrollment
grace period. Existing active administrator sessions receive the same deadline during migration.
After the deadline, ordinary application routes are denied while MFA status, setup and confirmation
remain reachable. Enabling or disabling MFA increments the user's security version, invalidating old
access tokens. Refresh rotation preserves the verified methods and MFA time.

The web application can connect these stable routes:

- `POST /api/v1/auth/mfa/verify`
- `GET /api/v1/security/mfa/status?workspaceId=<UUID>`
- `POST /api/v1/security/mfa/totp/setup`
- `POST /api/v1/security/mfa/totp/confirm`
- `POST /api/v1/security/mfa/step-up`
- `POST /api/v1/security/mfa/recovery-codes/regenerate`
- `POST /api/v1/security/mfa/disable`

Recovery-code replacement and optional MFA disablement require a recently MFA-verified token.
Mandatory account policy prevents an administrator from disabling the factor.

## Customer accounts and independent organizations

Every existing or newly provisioned workspace is the default organization of one customer account.
An account may group additional organizations, but each organization remains an independent
workspace with its own members, roles, subscription, configuration, CRM, files, commercial data,
projects and row-level tenant boundary.

`GET /api/v1/workspaces/:workspaceId/account` returns the account limit and only the organizations
where the current user has an active workspace membership. It never grants membership to another
organization. `/me` and the workspace list include additive account identity and default-org fields
so the later switcher can group the organizations the user can actually enter.

Account owners and administrators with workspace organization-management permission can submit,
list and cancel additional-organization requests under
`/api/v1/workspaces/:workspaceId/account/organization-requests`. Creation requires an idempotency
key. Wodana's internal control plane can review requests, change the approved organization limit,
and atomically provision an approved organization. Users do not self-provision beyond that limit.

The schema enforces one default organization, one customer account per workspace, approved limits,
source/approved workspace ownership and request uniqueness. Existing active workspace members are
backfilled as account members for discovery only; future active members are synchronized by the
database. Cross-account and cross-workspace business access remain denied.

## Tenant terminology

`GET /api/v1/workspaces/:workspaceId/terminology` returns every allowlisted key with its current
default, resolved singular/plural visible name, override state, and optimistic-lock version. When a
tenant has no override, the current product terminology is returned with `version: 0`.

`PUT /api/v1/workspaces/:workspaceId/terminology/:key` creates or updates one override. First writes
use version `0`; later writes use the returned version. `DELETE` on the same path with an expected
`version` query restores the current default.

Workspace organization responses include the resolved terminology map. Business-unit and calendar
department responses add `visibleName` while retaining `name`; calendar departments also expose
their stable `code`. Terminology changes never modify routes, permissions, audit codes, integration
fields, or historical documents.

## Project portfolio

`GET /api/v1/workspaces/:workspaceId/projects/portfolio`

Each existing project row now also contains:

- `progress`: approved weighted completion percentage.
- `taskSummary`: total leaf tasks and counts for planned, in-progress, inspection, blocked,
  on-hold, completed, cancelled, and overdue work.
- `schedule`: earliest/latest baseline and current dates, or `null` when no dated tasks exist.
- `milestoneSummary`: total, accepted count, and next unaccepted milestone with its progress.
- `fileCount`: number of delivery-project attachments.

Access remains tenant-scoped. A member without `projects.manage` only receives assigned projects.
Incomplete historical execution JSON is treated as empty summary data instead of breaking the list.

## Accepted commercial handoff

Starting execution recomputes the accepted quotation hash and requires it to match both the approved
Owner Review and active Deal File. A changed selling price, specification, material breakdown,
catalog selection, or other frozen quotation field is rejected before a delivery project is created.

The first successful release stores a client-safe immutable execution baseline with the quotation,
Deal File and release identities; preparation scope and specification versions; catalog snapshots;
materials; quantities; selling rates; and rounded line totals. Internal unit cost and quotation
photos are deliberately excluded. A safe retry reuses the existing project without rewriting its
baseline. Accepted variations use the same line-snapshot shape and hash-drift protection. Existing
project JSON remains valid because all new provenance fields are additive.

## Full department calendar

`GET /api/v1/workspaces/:workspaceId/projects/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD`

The inclusive range is limited to 93 days. Optional filters cover department, resource, project,
member, confirmed/tentative/active booking status, and text search. The response contains:

- `range`: requested dates and the workspace timezone.
- `departments`: active department IDs, names, and configurable colors.
- `events`: one event per matching booking slot, with project, deal reference, client, task,
  department, resource, members, date/time, status, units, display title, department `overlapIds`,
  and hard `conflictIds`.
- `items`: milestones, promised procurement dates, deliveries, inspections, snags, site visits,
  next actions, handover, and target completion.
- `overlapCount` and `conflictCount`: department concurrency and real resource/member/capacity
  conflicts are reported separately.

The backend title is assembled as
`Deal reference — Client — Department — Resource — Assigned people`; the frontend can append
localized booking wording without reconstructing business data.

`GET /api/v1/workspaces/:workspaceId/projects/schedule/availability` exposes per-resource segments
and department gap/capacity summaries. Booking preview, save, cancel, and complete routes live under
`/projects/:projectId/bookings`. They support draft/tentative/confirmed/completed/cancelled
lifecycle, exclusive and pooled capacity, working calendars, approved leave, timezone snapshots,
project holds, authorized documented exceptions, idempotency, optimistic locking, immutable history,
notifications, and serialized cross-project conflict checks.

Project resources accept optional department/team, capacity, and timezone settings. The database
validates same-workspace references. People and crews remain exclusive; factories and vendors may
use pooled capacity. Unassigned resources remain visible under neutral `#64748B`.

## Project file index

`GET /api/v1/workspaces/:workspaceId/projects/:projectId/files`

The response contains `items`, `folders`, and `truncated`. It combines:

- delivery evidence from tasks, daily reports, procurement, documents, snags, handover,
  dispatches, commissioning, technical queries, transmittals, retentions, and supplier returns;
- pre-execution designs, site survey evidence, requirement evidence, and uncategorized uploads.

Every item identifies its source, folder, linked record context, file metadata, uploader, and upload
time. Pre-execution results are capped at 2,000 and report `truncated: true` if more exist.

`GET /api/v1/workspaces/:workspaceId/projects/:projectId/files/:fileId` downloads either a delivery
attachment or a pre-execution asset through the same protected route.

## Quotation templates

The existing tenant-scoped backend remains the source of truth:

- `GET /api/v1/workspaces/:workspaceId/commercial/quotation-templates`
- `GET /api/v1/workspaces/:workspaceId/commercial/quotation-templates/:templateId`
- `PUT /api/v1/workspaces/:workspaceId/commercial/quotation-templates`

Saved templates are workspace-isolated. Preparing a quotation from a template strips client,
approval, and source-record identifiers so reusable commercial structure cannot accidentally retain
another client's transaction state.

## Verification

Run `npm run verify:backend` from the repository root. For an isolated HTTP/database exercise of the
new project overview contract, run the documented disposable environment followed by
`npm --workspace @wodana/business-core run test:smoke:portfolio-calendar`.

Run `npm run test:smoke:funnel` for the complete disposable funnel proof. It creates a temporary
local database and API, creates every business record through authenticated endpoints, and removes
the database and local files after the run.
