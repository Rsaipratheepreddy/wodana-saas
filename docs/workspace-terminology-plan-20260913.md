# Workspace terminology plan — 13 September 2026

Status: N1 and N2 implemented and verified on 13 September 2026.

## Decision

Use immutable internal keys and tenant-configurable visible names. A label change must never rename a
route, permission, database identifier, event type, integration field, or historical record.

There are two distinct kinds of names:

1. **Entity terminology** — what a tenant calls a type of thing. For example, the stable key
   `business_unit` may be shown as “Department”, “Division”, or “Studio”.
2. **Record names** — the actual tenant-created item. For example, the business unit with stable code
   `DESIGN` may have the visible name “Interior Design”. Business-unit `name` is already editable;
   the API will add `visibleName` as a backward-compatible alias and retain `name` for old clients.

## Initial terminology keys

The first release is deliberately allowlisted rather than accepting arbitrary UI strings:

| Stable key | Default visible name | Default plural |
| --- | --- | --- |
| `workspace` | Workspace | Workspaces |
| `crm` | CRM | CRM |
| `lead` | Lead | Leads |
| `opportunity` | Deal | Deals |
| `client` | Client | Clients |
| `pre_execution` | Pre-execution | Pre-execution |
| `quotation` | Quotation | Quotations |
| `project` | Project | Projects |
| `business_unit` | Business unit | Business units |
| `team` | Team | Teams |
| `resource` | Resource | Resources |
| `schedule` | Schedule | Schedules |
| `file` | File | Files |

New keys can be added later without a schema migration. The backend owns the allowlist and defaults.

## Backend contract

Add tenant-isolated `workspace_terminology` rows with:

- `workspace_id`
- immutable `key`
- `visible_name`
- `visible_name_plural`
- optimistic-lock `version`
- `updated_by` and `updated_at`

Only overrides are stored; missing rows resolve to product defaults. The table receives the same
workspace RLS policy and audit treatment as other workspace settings.

Endpoints:

- `GET /api/v1/workspaces/:workspaceId/terminology` returns all resolved values, defaults,
  override state, and versions.
- `PUT /api/v1/workspaces/:workspaceId/terminology/:key` changes one allowlisted term using its
  expected version.
- `DELETE /api/v1/workspaces/:workspaceId/terminology/:key?version=<expected>` restores the product default.

Writes require `workspace.settings.manage` or `module.organization.edit`. Values are trimmed plain
text, 1–60 characters, with control characters rejected. Singular and plural are explicit so the UI
does not create grammatically incorrect plurals.

## Calendar and project payloads

- Business-unit responses add `visibleName` while retaining `name`.
- Calendar `department` objects add stable `code` and `visibleName`; existing `name` remains during
  compatibility rollout.
- Calendar event titles use the business unit's record `visibleName`, not the entity-type label.
- A resolved terminology map is returned from the workspace bootstrap/settings response so the
  frontend can label filters and headings without extra per-screen requests.

## Frontend rule for the later phase

Navigation and page definitions will reference `labelKey` plus a compiled fallback. The application
must not search-and-replace text at runtime. User-entered content, document snapshots, quotation
history, audit action codes, URLs, permissions, and external integration payloads remain unchanged.

## Small implementation sequence

### N1 — Terminology foundation

Add the migration, schema, resolver, permission-protected API, audit events, validation, optimistic
locking, defaults, and tenant-isolation tests. Do not change UI labels yet.

Completed. All members can read resolved terminology; writes require workspace settings authority.

### N2 — Safe backend adoption

Add `visibleName` aliases to business units and department calendar payloads. Add a terminology map
to workspace bootstrap/settings. Run clean migration, historical migration, two-tenant HTTP smoke,
and the full backend gate.

Completed. No frontend label was changed.

### N3 — Connections

After N1/N2 are locked, complete the backend connection-health and calendar-synchronization slice.
Provider failures must be visible as connection state and must not block internal CRM/project work.

### N4 — Portability and backend freeze

Add the complete tenant export contract and original-file manifest, close remaining backend defects,
then freeze backend response shapes. Only after that freeze does the frontend terminology and UI
cleanup begin.

## Acceptance checks

- Two tenants can use different visible names for the same stable key.
- Updating one term cannot affect another tenant.
- Invalid/unknown keys, blank names, stale versions, and unauthorized writes are rejected.
- Removing an override restores the default immediately.
- Existing clients that read `name` continue to work.
- Calendar titles use tenant-owned business-unit names and retain overlap behavior.
- Clean and historical migrations, backend tests, and isolated HTTP/database smoke all pass.
