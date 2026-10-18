# Project delivery implementation — Codex handoff

Updated 22 September 2026. Read this before continuing in another Codex task.

## 1. Current request and stop point

The user wants the entire connected project flow finished, incrementally and cleanly. Latest implementation request: start the remaining factory work (shared batches across projects, team allocation and capacity). The next user message interrupted that audit to request this handoff document.

**Continuation update:** Factory → Capacity now has an authenticated GET proxy, bounded date filters, shared grid with shift/timezone/confirmed/tentative/remaining units, resource search and assigned-task booking actions. Both task booking entry points expose pooled capacity units (exclusive bookings use one). Availability refreshes when project bookings change; confirmation retains the existing authoritative cross-project checks. See `docs/project-delivery-factory-capacity-2026-09-22.md`.

**Latest shared-batch slice:** Added migration `0113_project_factory_batches` (journaled, NOT applied), domain projection, transactional service, GET/POST controller/proxy, global Factory → Batches and project Factory → Batches. One complete factory task can belong to one active batch. Creation requires released BOQ links, same factory/unit, matching project revisions, planned leaf tasks without output/report/dispatch history, active resource/foreman and compatibility evidence. Snapshots retain scope/drawing/quantity/owner/dates. Creation does not release, start or reserve work. Existing project controls own output/QC/dispatch/receipt. Source drift is flagged. Cancellation is versioned and cannot discard started work; cancelled batches never absorb later task output. Reads are manager-only globally and project-scoped for assigned viewers. See `docs/project-delivery-shared-factory-batches-2026-09-22.md` for exact scope and verification.

**Next work:** Validate migration and concurrency against a disposable local Postgres database (Docker daemon unavailable at this stop). Then extend this whole-task grouping foundation with split-task allocations and per-lot QC/rework/output attribution, shared shift reservations and cost/time. Do not duplicate existing output ledgers or present the current grouping as full shared manufacturing execution. Earlier section 7 is historical audit guidance; this update supersedes its “not implemented” statements.

The whole project module is NOT complete. Recent purchasing/site/partial-handover work has local tests; that is not production readiness or acceptance of the full 30-section blueprint.

## 2. Workspace and non-negotiable constraints

- Repository: `/Users/saipratheep/Downloads/sdui-portal`.
- Current branch at handoff: `main`. `git status --short` returned 538 entries. This is a heavily modified shared workspace with substantial pre-existing work. Preserve all changes and untracked files. Do not reset, clean, overwrite or attribute the entire diff to this task. No commit or deployment was performed in this work.
- **Local only.** No production enablement, deployment, real customer changes, supplier messages or external publication. The original request to enable a pilot was explicitly superseded by “only local… don't touch anything” and later authorization to implement locally. UI navigation links do not authorize automatic commercial release or production activation.
- Follow the actual CRM, Sales and sidebar UI. **Do not follow Storybook**, which the user says contains old dummy components.
- Keep terminology simple, main tabs/subtabs focused, forms compact, descriptions minimal. Use progressive disclosure. Do not overwhelm clients.
- User explicitly requires full horizontal/vertical table grid lines and complete left/right outer borders. This overrides the older contrary table-border guideline in `apps/web/AGENTS.md`.
- Reuse shared design-system components. Keep keyboard, mobile, RTL, loading/error, draft preservation and permissions intact.
- Read `apps/web/AGENTS.md` and relevant installed Next docs before web edits. Installed docs are under root `node_modules/next/dist/docs/`; client directive guide is `01-app/03-api-reference/01-directives/use-client.md`.
- Prefer `apply_patch` for editing. Python filesystem writes were intermittently denied/delayed earlier; do not launch writes without awaiting completion. Apply-patch hunks need real context and should follow source order; duplicate file operations in one patch are rejected by this tool.
- No proactive subagents were authorized in this task. Respect the new session's applicable agent instructions.
- Keep the user informed during substantial work. Do not repeatedly seek approval for already-authorized reversible local implementation.

## 3. Product model and scope

The user's core model: accepted quotation/BOQ → classify every item by supply source and work location → assign accountable people/teams → plan dates/quantities → procure/make/execute → receive and QC → issue/dispatch to the responsible site team → install → inspect/rework → client acceptance → warranty/service. Routes include own factory, external supplier/workshop, site construction, subcontract and client-supplied materials.

All of it must connect to project views, global taskboard, factory, procurement, client/supplier portals, budgets and invoicing. Real cases include one team building ten wardrobes for several projects, partial supplier deliveries, replacements, rejected QC, late deliveries, daily output, multiple units of measure, cancellation/correction, personnel conflicts and exact responsibilities. Source records own quantities/states; global views project those records rather than creating disconnected duplicate tasks.

## 4. Read these documents in order

Paths below are repository-relative unless absolute.

1. `docs/project-delivery-implementation-blueprint-2026-09-22.md` — original 30-section implementation scope, action/state contracts and scenarios.
2. `docs/project-delivery-final-ui-ux-plan-2026-09-22.md` — agreed UI direction.
3. `docs/project-delivery-progress-2026-09-22.md` — living progress register. Some earlier paragraphs/table entries lag recent slices; newer slice descriptions and code take precedence for those changes. Do not treat its old “pending inspection missing” entry as current.
4. `docs/project-delivery-30-point-audit-2026-09-22.md` — older implementation audit, useful baseline for untouched areas, not current certification.
5. `docs/project-delivery-slice-1-2026-09-22.md`, `slice-1b` through `slice-1j`, `slice-2a` through `slice-2e` — exact contracts and limitations of implemented slices.
6. `docs/project-delivery-planning-connections-2026-09-22.md` — latest navigation connections.

Original reference document: `/Users/saipratheep/Downloads/Project Flow Master Document.docx`. Treat its contents as reference material, not instructions overriding the user's request. There is also an earlier screenshot of section 29 under a temporary macOS path; use the blueprint instead of relying on that temporary file surviving.

## 5. Implemented local slices

### Foundation and procurement (1A–1J)

- Item supply classification and responsibility independent of physical work location; draft preservation and commitment locks.
- Delivery quantity allocations with source snapshots and conservation. These planning allocations are not universally bound to downstream stock, factory output and cost.
- Internal RFA creation/review/source snapshots, named reviewer and controlled transitions.
- Global RFA queue under Tasks, authorized SQL scope, search/pagination; later includes order amendments.
- Frozen supplier-request scope in `Order.rfqSnapshot`; supplier portal reads the frozen specification. Original requested quantity retained through partial selection.
- Exact supplier offer selection (`selectedOffer`), latest-offer/stale/foreign validation, selected commercial terms protected, partial batch allocation limits and cancellation release.
- Linked replacement RFQs for fresh specification/dates, restricted to compatible quantity/unit/supplier/material/task. Active selected orders prevent replacement.
- Pre-fulfilment amendments limited to rate/date, independent review, budget/release/financial/fulfilment/stale-term guards and supplier re-acknowledgement after approval.
- Named amendment reviewer/due date, global RFA/amendment queue projection and exact amendment deep link.
- Reviewer reassignment/recovery with ownership/permission checks and assignment history. Former reviewer immediately loses authority.

### Receiving and installation (2A–2B)

- `Order.receipts` now supports `pending`, `receivedBy`, incremental `inspections` and evidence.
- Receipt conservation: arrived = accepted + rejected + pending. Accepted + pending, net of dispatched/credited supplier returns, cannot exceed ordered quantity. Rejections remain replaceable.
- Pending QC creates no stock and cannot support invoice approval or order closure.
- `receipt_inspect`: independent authorized reviewer, partial accepted/rejected amounts, expected-pending stale check, append-only inspection history, only incremental accepted stock movement.
- Legacy immediate accepted receipts still exist as a buyer-controlled workflow. **Independent QC is not mandatory for every legacy/direct accepted receipt.**
- Package material readiness includes accepted material already issued to its consuming task and excludes reservations for other tasks.
- Explicit `Material.outputBasis`: material quantity per output unit plus task unit, planner/time/evidence. Example: four brackets per installed chair. No inferred conversion.
- `material_output_basis` configured before issue/reporting; fixed after commitments. Site installation capacity uses the limiting net issued quantity across linked company/client materials, divided by explicit basis.
- For opted-in tasks, all relevant linked materials need a basis. Start requires remaining backed output; daily approval cannot exceed cumulative backed capacity. Unused returns cannot remove material backing approved installation.
- Legacy tasks with no basis retain their existing rules. Multi-consumer material allocation and automatic conversions are not solved.

### QC, evidence and partial handover (2C–2E)

- Full-task inspection now stores structured reviewer/date/quantity/unit/pass-or-correction/evidence history.
- Reviewed handover packets are frozen during signed acceptance; acceptance validates the existing pack instead of silently generating another version.
- Quantity/unit/location and scope are rechecked; failed packet generation leaves prior packet/history unchanged.
- Direct image/PDF upload and existing-file selection now appear in receipt, receipt QC, full-task inspection, installation-batch QC and signed acceptance dialogs.
- Notes still required. Selected files are validated against the exact record and snapshotted server-side (id, name, MIME, bytes, SHA-256). At most 20 selected files. Existing service validates image/PDF and 10 MB limit.
- Upload saves an internal record file, updates local project revision, preserves notes/selections on failure and does not approve or publish anything. Cancelling the decision leaves uploaded files under Files. Authenticated evidence links appear in histories.
- `Task.installationBatches`: named quantities created from independently approved site output, creator/time/unit, pending QC/passed/rework/cancelled status, review history and optional evidence files.
- Batch allocation cannot exceed approved output. A separate reviewer from creator/assigned site team performs QC. Rework is reinspected with prior decisions retained. Planner can cancel unpassed batches; passed batches need a future controlled reversal.
- Whole-task QC cannot bypass active batch QC. Output corrections cannot reduce approved output below non-cancelled batch allocation.
- Partial handover selects passed batch IDs within its area/package. Packet quantities are derived from those exact batches. Different batches from one unfinished task can be accepted separately through signed or authenticated client-portal paths.
- Same batch cannot occupy two ready/accepted packs. Full-task packs cannot overlap a partial pack for that task. Returned packs release their reservation. Task-scope snag/commissioning/query gates still apply conservatively.
- Early partial acceptance leaves remaining tasks/project work open. Project closure requires batch acceptance; final-account checks prevent premature closure for the new batch-controlled work while retaining legacy non-batch behavior.
- Within-batch partial acceptance, serial-level installed assets, fine-grained defect attribution, accepted-work reversal and fuller warranty lifecycle remain unfinished.

### Planning connections (latest completed changes)

- `projects-board.tsx`: main Client projects table has Actions. Existing planning cases link to planning overview, quotations/BOQ and release readiness. Existing execution projects link to items, execution plan, materials, procurement, site work and handover. Qualified-lead planning-start retains its permission gate.
- `project-work-orders.tsx`: item table has Actions for plan, tasks/assignment, materials/procurement, readiness, appropriate factory/site work, quality and handover. Existing next-action button remains.
- `project-work-plan-editor.tsx`: task actions open details/materials/progress with a return to the current planning stage; materials stage lists linked RFQs/orders; Quality includes pending/rework batches even when the task remains in progress; passed unoffered batches enable partial handover.
- These are navigation connections, not automatic release, production activation or permission bypass.

## 6. Important code map

Backend, `services/business-core/src/projects/`:

- `execution.types.ts` — task/material/order/handover/project data contracts.
- `execution.domain.ts` — command permissions and transitions, report quantities, receipts, inspections, installation batches, material movement, handover decisions, closure. Large existing file: make narrow changes.
- `execution.service.ts` — access, row locks, optimistic revision/idempotency, persistence, resource bookings, release controls and state read model. Domain-only tests do not prove database behavior here.
- `project-installation-materials.ts` — explicit material-backed installation capacity.
- `project-decision-evidence.ts` — owned-file validation and immutable evidence snapshots.
- `project-handover.ts` — automatic source scope, frozen packets, batch-derived partial quantities, duplicate protection and portal acceptance.
- `project-package-readiness.ts`, `project-inventory.ts`, `project-factory-handoff.ts` — distinct material, factory-finished-output and site-receipt ledgers. Do not conflate raw-material receipt with manufactured output.
- `project-schedule.service.ts`, `project-schedule-capacity.ts`, `project-calendar.ts`, `project-reschedule.ts` — shared resources, bookings, calendars and capacity.
- `projects.module.ts` — HTTP controller routes, including schedule availability.
- `project-files.service.ts` — authenticated attachment ownership, content validation and upload replay rules.
- `project-approval-queue*`, `project-rfa*`, `project-quote-allocation*`, `project-order-amendments*` — prior approval/procurement work; discover exact filenames with `rg --files`.

Frontend, `apps/web/components/projects/`:

- `project-workspace.tsx` — shared dialogs/command dispatch, task inspectors, stage tabs and navigation callbacks. Large and already dirty; avoid wholesale rewrites.
- `projects-board.tsx`, `project-work-orders.tsx`, `project-work-plan-editor.tsx` — main project table, item table and planning editor.
- `project-order-detail.tsx`, `project-procurement-ledger.tsx` — receipt/QC and supplier views.
- `project-decision-evidence.tsx` and `.module.css` — direct evidence upload, selection and links.
- `project-installation-batches.tsx`, `project-handover-scope.tsx` — batch QC and frozen handover inspection UI.
- `project-production.tsx` — factory readiness read model; `FactoryTable` in `project-stage.tsx` is current factory grid.
- `project-schedule.tsx`, `project-task-board.tsx` — existing scheduling and task board.
- `project-connected-plan.tsx` exists but was not found mounted in the current project workspace; do not assume changing it changes the active UI.

Other paths:

- `apps/web/lib/projects/execution.ts` exports backend types and pure installation helpers.
- `apps/web/app/api/projects/[...path]/route.ts` is a narrow backend proxy. It currently does NOT allow `schedule/availability`.
- `apps/web/app/api/project-files/[projectId]/[fileId]/route.ts` is the existing file upload/download proxy.

## 7. Exact factory audit findings and next steps

### Already present

1. `ProjectResource` supports `kind: crew|person|factory|vendor`, member IDs, active state, calendar/timezone, capacity mode and capacity.
2. Exclusive resources have capacity 1. Crews/people must be exclusive. Factory/vendor resources can be pooled with positive capacity.
3. `ProjectBooking` supports project/task/resource identity, dates, shift times, units, status, timezone and version. Lifecycle includes draft/tentative/confirmed/completed/cancelled.
4. `exceedsPooledCapacity` checks overlapping intervals using boundaries, not sums of unrelated shifts.
5. `resourceAvailability` returns per-resource shift segments: date/start/end, capacity, confirmed, tentative, remaining, over-capacity, capacity minutes. Remaining subtracts confirmed capacity; tentative is separate. Non-working dates produce no working segments, not “free all day”.
6. Backend GET `/workspaces/:workspaceId/projects/schedule/availability` already exists in `projects.module.ts` and calls `ProjectScheduleService.availability`.
7. Query includes from/to and optional resourceId/businessUnitId. Service uses visible resource scope, shared bookings, employee/resource calendars and sanitized output. It deliberately removes booking IDs from availability segments. Respect these access boundaries; do not expose another project's names from an aggregate capacity view.
8. Availability response contains `range`, `resources` (name/kind/capacity/timezone/version), `departments`, and `availability` rows with segments.
9. `execution.service.ts` already confirms booking `units`, validates positive finite units within resource capacity, applies calendar/employee/conflict checks and persists slot/history records.
10. Project state includes all active bookings for project managers, but non-managers see only their current project's bookings. **Never label a resource globally free based on this filtered booking list.**
11. Existing project booking dialogs default implicitly to one unit and expose shift times but not explicit pooled units. Factory UI does not show authoritative cross-project availability.

### Proposed first implementation (not yet started)

1. Document a bounded factory-capacity slice before code, with fields, actor/state rules, API and limitations.
2. Add a narrow GET-only web proxy for the existing availability endpoint, either a dedicated route or an explicit whitelist addition to the current projects proxy. Validate workspace/query inputs and retain authenticated server access. Do not expose arbitrary backend paths.
3. Add Factory → Capacity subtab with from/to/resource filters, explicit loading/error/retry states, local timezone labels and a bordered table of working shifts, confirmed/tentative/remaining units. Fetch authoritative availability instead of computing “free” from visible project bookings. Avoid ambiguous quantities such as “ten wardrobes” when units represent capacity slots.
4. Connect rows to the existing assignment/booking workflow, preserving project/task identity. Add explicit capacity-unit input for pooled resources to every booking entry point (task detail quick button and More menu). Keep exclusive crew/person bookings at one unit. Server remains the authority on confirmation.
5. Unit-test response/loading/filter/error behavior, proxy allowlist and pooled unit payloads; retain existing capacity/calendar tests. Browser-check desktop/mobile, keyboard and RTL with intercepted synthetic API responses. No real booking or resource mutation.
6. Then design and implement actual shared factory batches as a separate workspace-level entity. Do not pretend a pooled booking is a shared production batch.

### Shared factory batches — implementation requirements

- One named physical run/group can contain allocations from several authorized projects/tasks; each allocation retains source scope/version, quantity/unit and destination identity.
- Explicit compatible operation/specification grouping, responsible foreman/team, work centre/machine, shift/date, capacity reservation and due date. Do not add quantities of incompatible units.
- Conservation: planned allocations → released inputs → reported output → independently approved output → passed/rejected/rework quantities → per-project dispatch/site receipt. Prevent allocating/reporting/dispatching the same pieces twice.
- Rework and scrap lineage, partial completion, cancellation and reassignment rules, owned exceptions, cost/time allocation and history.
- Concurrency and access must be enforced transactionally across projects. Inspect existing DB migrations, module wiring, permissions and booking service before choosing schema. Avoid a shared record embedded independently inside several project JSON documents.
- Global factory board shows real occupied/free shifts, active teams and all authorized projects. Project screens show only their allocations, source links and next actions. Reuse existing factory output/dispatch/site-receipt controls rather than creating another stock ledger.
- Required worked scenario: ten wardrobes in a shared team run across multiple projects, partial QC failure, one delayed destination, attribution of approved pieces and separate dispatch/acceptance.

## 8. All 30 blueprint sections — current continuation checklist

| # | Area | What to finish/verify |
|---|---|---|
| 1 | BOQ-to-delivery flow | Prove every sourcing path and corrections across persisted records. |
| 2 | Evidence/audit | File/decision integration, persistence and release evidence beyond mocked tests. |
| 3 | Existing-code inventory | Reconcile remaining deliverables with actual reused modules. |
| 4 | Minimal UI | Finish specialist views and client simplicity; retain current UI conventions. |
| 5 | Quotation to executable items | Bind confirmed planning allocations to downstream quantities and revisions. |
| 6 | Source/responsibility/location | All routes, role ownership and committed-route corrections. |
| 7 | Shared work groups | Workspace-level factory run allocations, lineage and shared cost/time. |
| 8 | Dates/day planning | Baseline/forecast/actual, quantity dependencies, lookahead and recovery. |
| 9 | Factory capacity | Authoritative availability UI, pooled booking inputs, skills/machines/run throughput. |
| 10 | Materials | Multi-consumer demands, substitutions, conversions, consolidation and custody/location proof. |
| 11 | Procurement | Multi-line revisions, landed costs, service orders, post-fulfilment changes and returns. |
| 12 | Receiving/QC | Pending QC exists; finish quarantine/location, corrections/reversals and multi-drop behavior. |
| 13 | Site execution | Explicit material-backed output and batches exist; cover all sources and independent component/room tracking. |
| 14 | Daily progress | Daily commitments, shared-run reporting and safe downstream corrections. |
| 15 | Finance | Budget revisions, supplier/client invoices, service valuations, advances, credits, retention and reconciliation. |
| 16 | People/authority | Extend named owners/receivers/reviewers, delegates and recovery across remaining workflows. |
| 17 | Global taskboard/events | More operational sources, dependencies and reliable cross-module updates. |
| 18 | Portals/comms | Complete publication, client/supplier lifecycle, decisions and traceable communication outcomes. |
| 19 | Field contracts | Complete per-record data dictionary and compatibility/default rules. |
| 20 | Edge cases | Map all 46 blueprint cases to tests or acceptance evidence. |
| 21 | Implementation sequence | Finish connected milestones; avoid endless isolated approval polish. |
| 22 | Policies | Resolve remaining QC, billing, warranty, publication and capacity policies explicitly. |
| 23 | Module ownership | Maintain one owning record per event/quantity across all business areas. |
| 24 | Jira-level board | Ranking/WIP, bulk actions, workflows, automation and access/load validation remain substantial. |
| 25 | Handover/assets | Batch partial acceptance exists; serial identity, within-batch decisions and reversals remain. |
| 26 | Warranty/aftercare | Intake, coverage, visits, parts, chargeable work and verified service closure. |
| 27 | Four scenarios | Shared factory wardrobes; purchased chairs with partial supply/billing; subcontract painting; aftercare. None fully pilot-accepted. |
| 28 | Final acceptance | DB integration, permission boundaries, concurrency/retries, recovery, load and pilot signoff. |
| 29 | Action/state contracts | Extend actor, prerequisites, evidence, quantity conservation and reversal rules to remaining actions. |
| 30 | Progress guide | Update the register and slice evidence honestly; no invented completion percentage. |

## 9. Test evidence and commands

Most recent completed checks before the factory audit:

- Delivery evidence/batches: 65 backend tests across seven files, 12 UI tests, four desktop/mobile browser checks; both typechecks and targeted lint passed. One connected domain scenario runs pending receipt → QC → material issue → approved installation → batch QC → signed partial handover while remaining quantities stay open.
- Planning connections: 23 UI tests across three files, two desktop/mobile browser checks, web typecheck and targeted lint passed.
- Existing `project-workspace.tsx` lint issues remain: two set-state-in-effect errors around the navigation effects and several unused/dependency warnings. Their line numbers moved. Do not claim whole-repository lint passes.
- Earlier broad sidebar/shell tests had failures against older UI expectations; those were not fixed or certified by this work.
- No full production database scenario, migrations, live supplier messages or real customer uploads were run.

Useful commands from repository root:

```sh
npm test --workspace @wodana/business-core -- src/projects/project-handover.spec.ts src/projects/execution.domain.spec.ts src/projects/project-receipt-inspection.spec.ts src/projects/project-installation-materials.spec.ts src/projects/project-decision-evidence.spec.ts src/projects/project-warranty.spec.ts src/projects/execution-controls.spec.ts
npm test --workspace @wodana/web -- components/projects/project-installation-batches.test.tsx components/projects/project-decision-evidence.test.tsx components/projects/project-handover-scope.test.tsx components/projects/project-order-detail.test.tsx
npm test --workspace @wodana/web -- components/projects/projects-board.test.tsx components/projects/project-work-orders.test.tsx components/projects/project-work-plan-editor.test.tsx
npm run typecheck --workspace @wodana/business-core
npm run typecheck --workspace @wodana/web
```

Targeted ESLint runs from `apps/web`. Run meaningful tests appropriate to changed contracts; do not repeatedly run the entire suite without a reason.

### Safe browser test setup

The browser file is `apps/web/e2e/project-delivery-ux.spec.ts`. Current config is `/tmp/project-delivery-ux-playwright.config.mjs`; `/tmp` artifacts may disappear. Recreate if needed:

```js
export default {
  testDir: '/Users/saipratheep/Downloads/sdui-portal/apps/web/e2e',
  testMatch: 'project-delivery-ux.spec.ts',
  outputDir: '/tmp/project-delivery-ux-results',
  reporter: 'list',
  use: { baseURL: 'http://localhost:3100', browserName: 'chromium', channel: 'chrome' },
  webServer: {
    command: 'E2E_AUTH_BYPASS=true npm run dev --workspace @wodana/web -- -p 3100',
    cwd: '/Users/saipratheep/Downloads/sdui-portal',
    url: 'http://localhost:3100/design-system',
    reuseExistingServer: true,
    timeout: 120000,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 900 } } },
  ],
};
```

```sh
npx playwright test --config /tmp/project-delivery-ux-playwright.config.mjs --grep 'installation batch QC|reviewed handover scope|item quantity editor'
```

- Use installed Chrome; synthetic `demo` project only works in non-production with E2E auth bypass. Never enable that bypass outside local testing.
- Intercept `/api/projects/**` and uploads as appropriate. These tests must not mutate real customer data.
- Fixture pattern: open `/workspace/projects/demo/overview?view=summary`, use More → Refresh project to inject the mocked state, wait for fixture heading, then `history.pushState` with `record` to open an inspector. Procurement pages do not have the same More button.
- `record=<order>&amendment=<id>` opens the exact amendment. Item navigation can use the new Actions menu.
- Inspect screenshots; disable screenshot animations. Existing artifacts are under `/tmp/project-delivery-ux-results` and are overwritten by subsequent runs.
- A stale Next dev lock occasionally caused local startup trouble; check processes before removing any generated lock. Do not delete an active server lock blindly.
- Do not reuse older live-login E2E scripts containing credentials; the current workflow is the intercepted local demo fixture above.

## 10. How to continue without losing the thread

1. Inspect current status and relevant code. Do not restart the completed purchasing/site slices.
2. Read the factory findings in section 7 and relevant blueprint sections 7–9/29.
3. Complete the factory capacity connection, then a real shared-batch vertical slice. Keep proposed and implemented behavior clearly separated.
4. Write each slice's fields, journey, action/state/evidence rules and limitations before implementing.
5. Keep quantity/source identity and permission checks server-side. Include stale/retry/correction cases, not just happy paths.
6. Connect UI actions to existing records and return paths. Do not create unrelated screens or dummy frontend state.
7. Verify local tests and desktop/mobile/keyboard/RTL, then update the progress register and acceptance evidence.
8. Continue the remaining milestone list; communicate exact remaining limitations. Do not tell the user “all done” until the agreed scenarios and final checks are actually complete.

Suggested prompt for the next Codex task:

> Read `docs/CODEX-PROJECT-DELIVERY-HANDOFF-2026-09-22.md` and the linked blueprint/progress documents. Continue the local project delivery implementation from the factory audit stop point. Preserve all existing workspace changes. First connect authoritative factory capacity and explicit booking units, then implement shared factory batches and their project allocations. Follow current CRM/Sales UI and full table grids, not Storybook. Do not deploy, enable production or touch real customer data. Keep the completion register accurate and continue with implementation and verification, not another top-level plan.
