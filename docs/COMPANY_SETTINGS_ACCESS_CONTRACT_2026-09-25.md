# Company Settings: access and UI contract

Status: implementation contract, not production acceptance. Scope: internal workspace roles and the current Wodana visual language. Client portal users are separate from staff membership.

## User journey and source of truth

An authorized member opens Company Settings → Roles & permissions, selects a role, reviews capabilities by area and makes only the mutations their role permits. The business-core `roles`, `role_permissions` and `effective_member_roles` records are authoritative. `GET /me` supplies effective permission codes after tenant entitlements; the page reads `GET /workspaces/:workspaceId/roles`, `GET /reference/permissions` and `GET /workspaces/:workspaceId/members`. Changes use the role create/update/delete endpoints through web API routes. The backend checks every mutation and records it in the audit log. The UI must not imply that hiding a button is authorization.

The permission table shows capability, product area and access. Save is explicit; Reset discards unsaved switches. System roles cannot be edited. A scoped editor may only manage roles whose current and proposed grants are inside their own effective access; Owner/Admin and a holder of `workspace.roles.manage` can delegate across the catalogue. Empty, loading, denied and failed-save states must be truthful. A role name/code is not itself a grant, except for explicit business checks such as Palm's Owner/Admin final Deal File approval.

## Role boundaries for the Palm flow

| Actor | Intended responsibility | Current enforceable boundary | Next access work |
| --- | --- | --- | --- |
| Owner / Administrator | Company access; final design/main agreement and payment approval | System roles; Palm Deal File decision additionally checks the active effective role code is `owner` or `administrator` | Verify each approval round against real records and prevent self-approval where required |
| Sales Admin / Account Manager | Enquiries, requirements, quote preparation, client follow-up | CRM and pre-project permissions exist; no approved Palm-specific role preset yet | Define least-privilege preset and test client-send rights |
| Quantity Surveyor | Estimate and approve quotation costing before client issue | `commercial.costs.view` plus `commercial.estimate`; Palm `quantity_surveyor` migration exists | Check QS queue, revisions and denial cases end to end |
| Finance reviewer | Verify payment evidence, not final Owner approval | `commercial.finance.verify`; `finance_reviewer` role exists | Verify first and main payment rounds separately |
| Interior Designer | Scope, design and specifications | `pre_projects.*` capabilities exist | Split draft/review/publish if current broad grants allow the wrong actor |
| Project Manager / delivery team | Plan and execute work, report, review | `projects.manage`, `projects.report`, `projects.review` exist | Specify task, factory, site, snag and handover permissions before adding controls |
| Procurement / stock team | Supplier offers, ordering, receiving and issue | Supplier/vendor/catalog permissions plus broad `projects.buy` | Split ordering, receipt, stock reservation and issue at the backend before offering separate switches |
| Client | Review and approve exact quotation/design/handover revision | External portal/customer-account model, not an internal workspace role | Test client identity and immutable decision evidence per round |

Karen's conditional material-list approval is a future rule, not an always-on permission. No extra gate is to be invented until its policy is defined. On Hold is available through workflow state, not a new role.

## Visual contract

Follow the current Wodana tenant theme and varied module icon colours; use semantic action/status tokens, never a global green wash. Plus Jakarta Sans is the default Latin body font, Noto Sans Arabic for Arabic, with tenant font overrides. Shared compact/standard/large buttons are 28/32/40px. Table rows are 40px standard and 36px under compact density; the separate 32px row token is for explicitly compact grids. Use the four-pixel spacing grid and shared Button, SelectField, Switch and DataGrid components. Glass blur is restricted to floating/transient layers; form fields and data surfaces stay opaque. Focus, keyboard, RTL, reduced motion and narrow viewport behavior are release checks. Company Settings must not override shared button geometry with arbitrary local sizes.

## Delivery gate

This first slice aligns the permission catalogue, labels, groups and Company Settings control sizes, and exposes effective signed-in permission codes so create/edit/delete controls can be separated. It does **not** certify full role isolation. Before a live role migration: compare the permission catalogue with migrations, run API denial tests for QS/Finance/Owner and cross-tenant access, verify effective team-derived roles, then test the web page with a non-owner administrator and a restricted role. Production data remains untouched until those checks pass.

## Verification log, 25 September 2026

- Focused roles/access/token tests: 14 web and 6 backend tests passed; both typechecks and targeted web lint passed.
- Full business-core suite: 1,232 passed, 10 skipped.
- Full web suite: 1,159 passed, 14 failed in six files. The catalogue-table test and pre-project route test also fail when isolated. The remaining failures include calendar, leads, lead-form builder and quotation workbench tests; they require separate triage before release.
- Browser inspection of `/workspace/roles` redirected to sign-in because the local session had expired. A separate `.next-roles-e2e` build directory allowed desktop/mobile Playwright journeys to pass without stopping the user's server: both viewport checks, visible mobile switches, keyboard toggle/reset, RTL overflow and browser-console checks passed (2 tests). A real authenticated, API-backed role journey remains unverified; no deployment was performed.

### Follow-up verification

- The role editor now preserves unsaved permission switches when its name or description is saved. The role list reports direct members, assigned teams and pending invitations, and suppresses deletion while any assignment exists. The backend remains the authority for deletion conflicts.
- Focused web tests: 17 passed. Backend role-access tests: 3 passed. Both typechecks and targeted web lint passed.
- Full web suite: 1,190 passed. Full business-core suite: 1,233 passed, 10 skipped.
- Desktop/mobile Playwright role journeys: 2 passed, including compact dialog field height, keyboard toggle/reset, RTL overflow and browser errors. The browser journey used a local auth fixture, not a real signed-in role.
- An isolated API-backed workspace smoke passed role create/update/delete, pending-invite and direct-member counts, in-use delete conflicts, RBAC and optimistic-locking checks. The isolated Palm fixture smoke passed its funnel checks. Neither run changed production data.
- A new signed-in, isolated browser smoke passed: Owner created a role and saved its permission, and the web fixture permission codes exactly matched the migrated backend catalogue. A restricted member read the page without mutation controls and received HTTP 403 on a direct create request; a non-owner Administrator retained role creation access. The restricted member then received the role only through a team; their direct roles were removed, their role-read access remained, and an in-use delete was rejected. The restricted mobile view had no page overflow and all three actors had no browser errors. The full cross-module permission matrix and production migration review remain open before rollout.
- People delegation is now scoped at the backend: a custom inviter/editor cannot assign a named Owner/Administrator role, cannot grant permissions outside their own effective set, cannot edit a privileged existing member, and cannot renew or cancel a privileged pending invitation. Owner/Admin retain those operations. Team-inherited assignments are included in the check. The People UI uses signed-in permission codes to expose invite/edit/cancel separately and offers only delegable roles and teams; users with no People grant see an explicit access message and do not get a People navigation link. The isolated signed-in browser smoke passed read-only and scoped People views plus direct API denial cases. Targeted People tests, both typechecks and targeted web lint passed; full business-core suite: 1,236 passed, 10 skipped. An initial full web run had three five-second timeouts in Leads/Quotation Workbench, while both affected files passed in isolation (39 tests). With a 15-second full-load test ceiling, the complete web suite passed: 255 files, 1,199 tests. Production migration review and the wider flow acceptance remain open before rollout.
