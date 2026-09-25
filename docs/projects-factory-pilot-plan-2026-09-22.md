# Connected projects and factory pilot

Status: implementation audit and proposed build contract, 22 September 2026. No pilot has been enabled or deployed by this audit. The target workspace, project and environment are awaiting user identification. Existing uncommitted implementation is retained.

## Purpose and source authority

Build one connected operating flow from project planning through procurement, factory, site installation and handover, with a global task board. Start with one project before expanding access.

Reviewed the complete paragraph and table text of `Project Flow Master Document.docx`, plus the current project, inventory, factory, unified-board and planning notes and the source files listed below. This is a content review, not a document layout review. The attachment is business reference material: its suggestions to retire spreadsheets, use Odoo, or place owner review outside Wodana are not execution instructions. Current user direction takes precedence. Historical implementation notes are not evidence of deployment.

The master document supplies owner/payment gates, design and technical milestones, material approval, BOQ, procurement, manufacturing, site work, snagging and handover. On hold is an overlay. Configurable studio revision limits must not become universal hard-coded restrictions. Resolve whether the initial payment authorizes design engagement or the whole execution contract before implementing that policy; planning access must not imply production release.

## Current implementation and gaps

| Area | Source evidence | Next work |
| --- | --- | --- |
| Projects entry | `apps/web/components/projects/projects-board.tsx`; planning and execution fetched by the projects page | Retain one client-project identity and existing linked planning/execution IDs |
| Delivery packages | `project-work-packages.ts` creates packages idempotently from released lines; enforces one active package per line and dependency graphs | Support deliberate grouping of several deliverables; preserve scope ownership during regrouping |
| Connected plan | `project-connected-plan.ts` and package readiness join ownership, dependencies, supplier commitments and capacity | Make this the shared explanation of next actions and blockers |
| Procurement and stock | Existing requirements, orders, receipts, movements, transfers and inventory projections | Verify usable UI from requirement through accepted receipt; distinguish raw-material demand from quoted selling quantity |
| Factory handoff | `project-factory-handoff.ts` links factory output to an exact receiving site task, checks package/scope/unit compatibility and limits installed quantity to receipts | Build an operational factory queue and explicit batch semantics above these controls |
| Factory entry | `apps/web/app/workspace/projects/factory/page.tsx` lists non-completed projects and links to production/dispatch | This is a project directory, not a cross-project workshop queue; do not count all listed projects as active factory work |
| Task board | `project-task-board.tsx` shows leaf tasks for one project, using existing status/report/review actions | Add a paginated global projection and reuse the same task inspector and commands |
| Global work | Existing portfolio summaries, calendar and assigned field queue | No general global staff task board was identified in this audit; do not repurpose the restricted field queue as an unrestricted staff API |
| Pilot rollout | `module-rollout.ts` and `proxy.ts` defer Planning/Projects by workspace slug | Existing switch is workspace-wide; one-project exposure needs narrower server-controlled policy |

Source references in this table are relative to `services/business-core/src/projects` unless otherwise qualified. These observations describe checked source, not live tenant acceptance.

## Connected record model

Project → released scope → work package → production batch when needed → operations/tasks → reviewed output → dispatch → site receipt → installation → inspection → handover.

Procurement connects material requirements to the same package/tasks: reviewed manufacturing demand → stock/reservation check → shortage → supplier/order → accepted receipt → material issue. Drawings, specifications and commercial baselines remain versioned source references throughout.

A work package is the accountable deliverable group, such as Bedroom joinery. It owns released scope references, area, responsible person, route, dates, dependencies, priority/risk and next action. A catalog group is reusable master-data organization and is not a live work package.

A production batch is a quantity-bearing subdivision, such as two wardrobes needed on the first installation date. The current task schema has no explicit batch field. Initially separate measurable factory/site task pairs can represent partial delivery within one package. Before adding a durable batch entity, define stable identity, scope allocations and quantity limits; do not create a second progress ledger. A proposed batch record needs project/package IDs, scope quantities and units, drawing/specification revision references, target date, workshop/resource and linked operation IDs. Splits and cancellation preserve history and cannot increase authorized quantities.

Several batches may share a workshop queue or machine run without merging project ownership. Cross-project runs and material allocation between them are a later slice; the pilot retains project-bound batches. Capacity remains governed by existing resource bookings. Machine scheduling and cutting optimization are not implied by a factory queue.

Example: a package contains four wardrobes. Batch A produces two, QC approves two, dispatch sends two and site accepts one while rejecting one. Installation may approve only one. Batch B remains independently planned. Closing a rejection does not manufacture replacement stock or record a physical return. Raw board sheets, hardware counts and finished wardrobes keep separate quantities and units.

## Procurement flow

1. Confirm the executable scope and applicable drawing/material versions. Prepare or review actual material requirements; selling area cannot directly determine sheet quantities.
2. Check accepted available stock, reservations and incoming commitments. Allocate usable stock and purchase only the remaining need. Record client-supplied items as client supply without a fictional PO.
3. Source directly or compare supplier offers through existing workflows. Retain supplier, price/currency, quantity/unit, promised date, linked material/task and responsible buyer.
4. Submit, independently approve where required, and record supplier acknowledgement. An approved order is not physical stock.
5. Receive accepted/rejected quantities with evidence. Accepted stock creates the existing movement once. Resolve rejected quantities through correction/return and applicable credit records.
6. Issue or reserve material against the actual work. Surface shortages, late commitments and affected tasks on both project and global views.
7. Keep invoice/payment state linked through existing finance ownership. Receipt, financial settlement and permission to begin work remain distinct facts.

## Factory working view

Default to an operational table with optional board view. Group by workshop/resource, project, package or batch; filter by owner, due date, blocked state and operation. The queue includes real factory operations only.

Columns: project/client, package and batch, operation/item, planned quantity and unit, approved output, drawing revision, material readiness, workshop/team, planned dates, status, blocker and next action. Detailed stock movements, comments and evidence belong in the shared inspector.

Show preparation, in progress, inspection, ready to dispatch and dispatched/received through their authoritative records. These are factory views, not new independently editable task statuses. A completed manufacturing task can have output still awaiting dispatch. Site readiness does not follow automatically from factory completion.

Starting work evaluates existing commercial, technical, material, dependency and capacity gates. Reporting proposes output; independent review establishes approved output. Dispatch consumes eligible approved output and receipt determines what the exact site task may install. Preserve partial quantities and reject over-dispatch, duplicate receipt and incompatible units.

## Global task board

One global work surface with views for My work, All permitted work, Factory, Site, Procurement and Approvals. Project pages filter the same identities rather than copying tasks. Initial delivery should cover canonical execution tasks; add procurement/approval action projections in a subsequent slice using explicit source types.

The global projection carries workspace/project ID, source kind, source record ID, package/batch where applicable, title, owner, due date, priority, status, blocker, next action, capability flags and source link. Identity is composite; never deduplicate unrelated records by title. Planning/design approval actions retain their own source decisions and cannot be completed by changing an execution task status.

Columns: Planned, In progress, Waiting, Review, Complete. Blocked and On hold remain distinguishable within Waiting. Readiness is derived and explained rather than becoming a competing writable status. Complete means the source action is complete; it does not imply client acceptance or project closure.

Cards show title, project/package context, owner, due date and the primary blocker or next action. Quantified tasks show approved/target output. Search, filters, grouping and table/board toggle occupy one compact toolbar. Open a shared inspector for the real record. Dragging to Review opens reporting; dragging to Complete opens the appropriate review rather than bypassing it. Keyboard actions provide equivalent behavior.

Backend projection must enforce workspace, project and record permissions before pagination, counts and search. Return compact rows, not all project payloads fetched by the browser. Keep costs, supplier private details and workforce personal data permission-scoped. Writes retain canonical project revision checks, stable request IDs, transactions and audit history; conflicts retain a recoverable draft and refresh the source.

## Single-project enablement

Required target: environment, workspace ID, planning case ID and linked execution project ID where one already exists. Do not choose a customer project from an old screenshot. A local demo fixture is not operational pilot enablement.

Implement a server-owned allowlist or equivalent persisted policy for the identified linked project/case. Keep existing role, entitlement and commercial release checks. Pilot exposure is not an approval to manufacture or purchase.

Enforce the policy consistently on project and planning detail reads, mutation endpoints, lists/counts, global board, factory queue, calendar, search and deep links. Verify other pilot-disabled projects remain inaccessible through these surfaces. Navigation visibility alone is insufficient. Preserve currently enabled non-pilot workspace behavior.

Do not simply remove the workspace slug from `WODANA_CRM_ONLY_WORKSPACE_SLUGS`: that exposes the workspace's deferred modules generally. If the chosen local environment already permits the intended project, report this and use it without introducing an unnecessary rollout bypass. Disabling a pilot must preserve records and audit history.

## Build order and acceptance

| Slice | Concrete outcome | Acceptance |
| --- | --- | --- |
| 1. Identify and expose pilot | Resolve existing planning/execution links and rollout policy for one project | Target opens with correct role; another project and another workspace remain excluded where policy requires; release gates unchanged |
| 2. Project plan and grouped work | Review real released scope, packages, routes, quantities, owners, dates, tasks and material demand | No duplicated scope; grouping/splitting preserves lineage; dependency and quantity rules hold |
| 3. Global execution board | Server projection plus compact board/table and existing task inspector/actions | Same task updates in project and global views; filtered counts/pagination agree; unauthorized data excluded |
| 4. Factory queue and batches | Real operation queue with partial output, QC and dispatch context | Two batches progress independently; inspection and quantity limits hold; capacity clashes stay visible |
| 5. Procurement and action queues | End-to-end material need, stock allocation, order and receipt; linked approval/procurement actions | Partial/rejected receipt, late supplier and client-supplied material remain truthful; no duplicate stock/order on retry |
| 6. Site and closeout | Exact receipt → installation → snag → handover connections | Installation cannot exceed received units; rejected output cannot silently re-enter stock; partial handover preserves remaining work |
| 7. Pilot acceptance | Staff walkthrough, reload/conflict/error recovery and responsive accessibility review | Saved state verified through real APIs; desktop/narrow/keyboard/RTL checks; no unsupported provider or production claims |

## Verification in this audit

Executed on the current checkout:

- Business Core: six focused test files, 39 tests passed: work packages, connected plan, procurement/factory/site, factory handoff, inventory and item pipeline.
- Web: three focused files, nine tests passed: project task board, module rollout and unified projects board.

These are a regression baseline. No code or rollout settings changed; no deployment, full regression, live accounting, real project mutation or persisted browser walkthrough occurred. Project selection remains the prerequisite for enablement and the concrete pilot walkthrough.
