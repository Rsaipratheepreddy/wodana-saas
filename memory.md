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
- Tenant/project backend: planning projects, released scope lineage, workflow templates/history/gates, resources, cross-project capacity checks, bookings, portfolio calendar and execution command foundations exist.

## Project module: actual status

### Real/live path that exists

- `/workspace/projects` now uses the live `ProjectPortfolio` data source.
- A planning project can be created from an active Pre-execution; it is linked to that case.
- A live project detail route reads `GET /workspaces/:workspaceId/projects/:projectId/execution` and sends state-changing commands to the same tenant-scoped backend.
- The detail workspace has live sections for Overview, Schedules, Material planning, Procurement, Production, Execution, Daily progress, Snagging, Handover, Scope & Design, Budget and BOQ.
- The project backend tests passed on 16 September 2026: 57 tests across workflow, release, schedule capacity, portfolio calendar, execution domain and execution controls.

### Not release-complete / must be treated as work remaining

- The live project workspace must be audited tab-by-tab against the project baseline. Existing APIs and widgets do not equal a coherent Palm Living delivery workflow.
- Current project detail needs an end-to-end tenant UAT pass from released quotation to work package/task, materials, procurement, factory/site execution, progress, quality, handover and warranty. Empty states, permissions, errors and mobile usage must be checked.
- The full departmental/resource overview needs a client-ready UI using the live portfolio calendar/capacity API. It must show cross-project overlaps by department; Design red, Production purple and Procurement grey are tenant-configurable defaults, not hard-coded Palm Living logic.
- Product workflow must use work packages → tasks → subtasks. Avoid old demo wording that incorrectly treats tasks as work packages.
- Live daily progress must remain review-derived and auditable. Browser-local storage is permitted only for an unsent local draft; it must never be represented as server-saved progress.

## Next project slice (locked)

**Project foundation consolidation — no new breadth.**

1. Provision one clean UAT tenant deliberately; it must become the sole test workspace rather than another seed/demo account.
2. Compare the live project state/commands and UI sections against the project baseline: scope release, work package/task hierarchy, assignment vs booking, calendar conflicts, material responsibility, procurement/factory/site gates, daily-report review, snags, handover and financial separation.
3. Turn identified gaps into a small ordered implementation backlog. Fix the first broken handoff before moving to a new module.
4. Prove the clean tenant path with automated API checks and a focused browser/mobile validation before calling the module ready.

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
