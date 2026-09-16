# Wodana delivery memory

Last audited: 16 September 2026. This is the working source of truth for the current delivery. It records verified code state, not aspirational roadmap claims.

## Product direction

- Wodana is the generic multi-tenant SaaS product. Palm Living is a tenant configuration, never a tenant-specific fork.
- Tenants retain their own terminology, brand colour/logo, catalogue, teams, departments, workflow labels and organisation data. Default terminology appears when no tenant override exists.
- A customer account may contain one organisation by default. Additional organisations are separate data boundaries under the same account and require a tenant request plus Wodana approval; they are not mixed workspaces.
- The immediate release objective is a local/UAT-ready journey through quotation. Do not claim production deployment, backup/DR, live accounting/WhatsApp, migration or AI import completion unless separately verified and approved.

## Working order

1. Remove legacy/demo/broken paths and make each client-facing flow use the live, tenant-scoped source of truth.
2. Finish backend behaviour and tests for one module before polishing that module's UI.
3. Then connect and polish UI end-to-end from authentication through quotation. Do not add features merely because an old demo screen suggests them.
4. Production infrastructure, backups, operational migration and AI-assisted import follow UAT, unless the user explicitly reprioritises them.

## Clean-reset record

- On 16 September 2026, the local `wodana` PostgreSQL database was confirmed to be on a local socket and reset with explicit user approval. It held 29 non-client workspaces (28 automated smoke workspaces and one disposable Iglo workspace).
- The local database now has zero workspaces and zero user accounts. The cleaned migration history was reapplied successfully (72 migrations). No hosting or production system was accessed or changed.
- Removed from source: automatic demo tenant seeding, demo-only Iglo/project seed and cutover scripts, legacy project-import endpoint/table/UI, obsolete Palm-specific legacy CRM taxonomy migrations, and the separate browser-only project demo route.
- The application now has one project route family only: tenant-scoped live projects. A fresh UAT tenant must be provisioned deliberately before browser testing resumes.

## Verified foundations

- Auth/onboarding: tenant-scoped login, MFA support, device limit handling, branded tenant onboarding and user-facing configuration fields exist. The internal Wodana portal is platform-admin-only.
- CRM: intake, identity resolution evidence, SLA/assignment, qualification and controlled conversion are implemented.
- Pre-execution: case/brief, rooms, requirements, site evidence, designs, specifications, readiness and immutable client-confirmed definition baselines are implemented.
- Catalogue/commercial: catalogue adoption, vendors/offers, selling-price links, quotation templates, definition-bound proposal composition and release lineage are implemented.
- Tenant/project backend: planning projects, released scope lineage, workflow templates/history/gates, resources, cross-project capacity checks, bookings, portfolio calendar and execution command foundations exist. Released quote lines now materialise authoritative work packages; accepted additions create new packages and deductions block affected packages rather than erase history.

## Project module: actual status

### Real/live path that exists

- `/workspace/projects` now uses the live `ProjectPortfolio` data source.
- A planning project can be created from an active Pre-execution; it is linked to that case.
- A live project detail route reads `GET /workspaces/:workspaceId/projects/:projectId/execution` and sends state-changing commands to the same tenant-scoped backend.
- The detail workspace has live sections for Overview, Schedules, Material planning, Procurement, Production, Execution, Daily progress, Snagging, Handover, Scope & Design, Budget and BOQ.
- The project backend tests passed on 16 September 2026: 60 focused tests across workflow, release, work packages, execution pulse, schedule capacity, portfolio calendar and execution domain. Root typechecking, the project component tests and a production web build also passed after this work.

### Not release-complete / must be treated as work remaining

- The live project workspace must be audited tab-by-tab against the project baseline. Existing APIs and widgets do not equal a coherent Palm Living delivery workflow.
- Current project detail needs an end-to-end tenant UAT pass from released quotation to work package/task, materials, procurement, factory/site execution, progress, quality, handover and warranty. Empty states, permissions, errors and mobile usage must be checked.
- The full departmental/resource overview needs a client-ready UI using the live portfolio calendar/capacity API. It must show cross-project overlaps by department; Design red, Production purple and Procurement grey are tenant-configurable defaults, not hard-coded Palm Living logic.
- Product workflow now starts with released-scope work packages → tasks → subtasks. A task with released scope derives its package link from that scope; it cannot claim another package's source line, and a subtask cannot move across its parent's package.
- Project state now includes a deterministic execution pulse for future UI: it ranks blocked packages/tasks, overdue work, inspection queues, supplier acknowledgements and genuinely start-ready work. It does not mutate data or pretend to be AI.
- Live daily progress must remain review-derived and auditable. Browser-local storage is permitted only for an unsent local draft; it must never be represented as server-saved progress.

## Project module implementation order

### Slice 1 — Project initiation (backend completed 16 September 2026)

- Release now creates an immutable commercial initiation snapshot: accepted quote/version, Deal File, agreement reference, currency/value and payment milestones.
- A project manager confirms the operational charter only after commercial release: accountable owner, role holders, initial team access, project-owned sites, client contact/access notes, objective, promise and dates.
- The confirmed baseline seeds the live project forecast but remains separate from it. It cannot be silently replaced: a justified revision is retained in history and is blocked once detailed delivery planning starts.
- Site IDs are verified against active sites belonging to the project; role holders and the initial team receive real project assignments in the same command transaction.
- Focused initiation/release/work-package tests, full business-core tests (597 passed, 10 skipped) and root typechecking passed. No project UI claim has been made.

### Slice 2 — Controlled commercial changes (backend completed 16 September 2026)

- A formal Change Case now controls additions, removals, replacements, clarification/schedule amendments and price corrections. It retains the existing client-request history rather than creating a disconnected change record.
- Before client documents can be prepared, the case captures the affected work packages, tasks, purchase orders, materials, confirmed bookings and reported/completed-work warning. Each visible impact requires an explicit, auditable disposition.
- A replacement produces paired removal and addition variations. Neither money records nor project work are released until every linked document is accepted; a partial client acceptance stays pending safely.
- Accepted deductions remain conservative: affected tasks and work packages are blocked for replanning rather than silently deleting or auto-segmenting live work. Supplier commitments and reported work still block release for reconciliation.
- Project execution records the released Change Case reference alongside its variations. If the client rejects a complete, unaccepted package, it can be withdrawn and restarted from a fresh impact assessment; after any acceptance, a corrective Change Case is required.
- Focused change-control, variation and work-package tests passed, as did business-core typechecking. Full-suite and UAT validation remain required before any delivery claim.

### Slice 3 — Design-to-delivery control (backend completed 16 September 2026)

- Delivery now captures the exact approved Pre-execution design revision(s) for every released, scoped quotation item. It rejects archived, changed, unapproved or blocking-thread design evidence before project release.
- Those revisions become approved, traceable project documents linked to their released scope. The original project files remain available from the pre-execution file location; delivery does not copy or mutate them.
- A site or factory task with design-controlled scope must point to the captured approved design document. A generic, stale or superseded drawing cannot start that task; office-only design work remains intentionally unblocked.
- Accepted variation scope uses the same design capture and cannot enter delivery planning without its corresponding approved design evidence. The baseline keeps earlier accepted evidence while adding new variation evidence.
- The execution pulse now surfaces missing design evidence as an actionable item before it offers a task as start-ready. Focused tests, the full business-core suite (605 passed, 10 skipped) and root typechecking passed. No project UI or UAT-complete claim has been made.

### Next locked slice — Project command centre

1. Define the one live project operating view from the initiation baseline, execution pulse, scope packages, approvals and commercial readiness.
2. Make its `Now`, `Next`, risk, decision and client-promise states deterministic; it must not become another task list or duplicate financial truth.
3. Add the minimum state/command contracts and tests first. UI follows only after the backend flow is proven.

## Do not lose these client requirements

- Reintroduce usable quotation templates and a visible project file/document location.
- Provide project-level views and a full cross-project department calendar. Event titles need deal reference, client name, department/team, assigned person and booked time.
- Keep project overview/progress visible to the client, while protecting internal margin, vendor negotiation, private notes and unapproved forecasts.
- Keep catalogue creation/import simple. Spreadsheet import is planned; AI-assisted raw-data migration is a later onboarding feature, not silently active now.
- Platform primary colour must be configurable per tenant, with accessible derived states and a Wodana-powered attribution where appropriate.

## Guardrails

- Do not state that a module is done merely because backend code or tests exist. A module is ready only when its live tenant route, permissions, error/empty states, mobile behaviour and handoffs have passed UAT validation.
- Do not connect to hosting/production or deploy without explicit user approval.
- Do not expose passwords, MFA secrets, internal tokens or client personal data in logs or responses.
- Treat repository planning documents as background. Check current source and tests before reporting implementation status.
