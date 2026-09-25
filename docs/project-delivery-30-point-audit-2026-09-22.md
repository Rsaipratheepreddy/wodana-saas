# Audit of all 30 project-delivery blueprint sections

22 September 2026. Source audit against `project-delivery-implementation-blueprint-2026-09-22.md`, the shorter UX plan and current implementation. No application code, records, activation flags or deployments were changed during this audit. The RFQ implementation proposed immediately before this review was not started.

## Finding

The blueprint contains substantially more than the navigation/item-table implementation. The shorter UX plan is a first-slice contract, not a complete implementation plan. It must not replace the 30-section blueprint. No end-to-end delivery route has been demonstrated complete by the recent UI tests.

RFA is also an actual specification gap: the blueprint discusses approvals in multiple places but does not define a named request-for-approval lifecycle, register or full field contract. RFQ is explicitly covered in sections 11, 19, 20 and 29. These are different workflows; the user's intended expansion of “RFA” is still unconfirmed, so the approval design below is a proposal, not an implemented capability.

**Status meanings:** Covered = covered by the written specification, not necessarily delivered. Partial = source foundations exist but do not satisfy the full section. Missing = explicit specification or inspected implementation is absent. Policy-dependent = cannot finalize the relevant behavior without a business rule. Not verified = no sufficient executable/persisted evidence from this audit. This is not a blanket runtime certification.

## All 30 sections

### 1. The product decision — Partial implementation
The BOQ → classify → assign → execute/source → QC → deliver → install → accept/aftercare sequence is specified. Released scope, packages, item pipeline and the new item table support the beginning. The table is package-based and task-count based; it does not yet express simultaneous per-quantity states, exact next receiving owner or every handoff. Restore the agreed delivery quantity/unit to the everyday item design once allocation semantics are settled. A package count or completed-task count must not substitute for delivered units.

### 2. Evidence and audit boundaries — Covered specification; verification incomplete
The blueprint records the supplied master document, implementation evidence and primary market sources. Those remain reference material rather than instructions. Prior test counts verify specific foundations only. The latest four browser checks use an empty synthetic project; they do not validate real procurement, invoice creation, manufacturing or handover. Preserve the separation between reviewed design, inspected code, tested behavior and demonstrated persisted journey.

### 3. What exists and what needs deeper work — Covered audit; gaps remain
The inventory already identifies single-line orders, scalar budgets, invoice linking versus generation, capacity slots versus throughput, missing batch allocations and incomplete global work projection. The navigation work did not close these. Convert each finding into a tracked deliverable with schema changes, migration/compatibility, source action and acceptance evidence. Existing files are foundations to extend, not proof of the target feature.

### 4. Minimal everyday interface — Partial implementation
Six grouped staff sections and the CRM item table now exist. Current Supply still exposes eight sub-tabs, and some specialist screens retain another view selector. A complete consolidation is needed: Supply sub-tabs should be Requirements & stock, RFQs & offers, Orders, Receiving & returns; shortage/awaiting/late views become table filters. Keep supplier directory in Resources with contextual access. Client portal simplification is planned only. RFA, changes, aftercare and item quantity details need explicit homes. Use current CRM/Sales controls, not Storybook.

### 5. Quotation to executable items — Partial implementation
Release and source snapshots exist in `project-release.ts`, `released-scope-line.ts` and `project-work-packages.ts`. Unique active scope ownership is enforced. Explicit many-to-many quantity/value allocation, bundled commercial lines, delivery-unit conversion, selected alternatives and downstream disposition for deductions need complete contracts and demonstrations. Do not weaken unique ownership just to permit split rows. Existing accepted-version/release gates remain authoritative.

### 6. Choose a route without confusing responsibility and location — Partial implementation
Supply method, delivery route and site work exist. The current plan editor still suggests factory fabrication for both make and subcontract; vendor-location validation also constrains work to factory. This does not cover site subcontracting cleanly. Verify all nine listed scenarios: own factory, external custom, ready-made, employee site fabrication, subcontract wet trade, supplier-installed, client-supplied, hybrid and service-only. Route changes after commitments need impact review, not deletion. Each route must preserve component material responsibility.

### 7. Work groups and batches — Missing full allocation implementation
Packages organize work but are not the shared-run/batch allocation model specified here. Add exact project/item/room/revision allocations, split conservation, optional piece identity, rework lineage and single-run time/cost allocation. The A4/B3/C3 wardrobe run needs one occupancy reservation with attributed output, not ten overlapping team bookings. Until this exists, only sequential project work can be represented honestly.

### 8. Dates and day-by-day planning — Partial implementation
Task dates, schedules, calendars, bookings and rescheduling foundations exist. The target additionally requires separately retained contractual/baseline/forecast/supplier/actual dates, backward/forward planning, two-week lookahead, daily quantity commitments, elapsed curing waits and partial-quantity dependencies. UI must show proposed impact before a changed promise is committed. Unknown dates stay unknown.

### 9. Factory teams and capacity — Partial implementation
`project-schedule-capacity.ts` distinguishes exclusive people/crews and pooled slots. This is not manufacturing throughput. Work-center queues, roster-effective dates, skill compatibility, setup/run time, simultaneous crew/machine constraints and shared-run costing need completion. A company Factory destination currently being reachable does not prove operational visibility across projects. Booked, working, absent, unbooked and capable remain separate facts.

### 10. Material planning and buying — Partial implementation
Requirements, inventory movements, reservations and transfers exist. Multi-consumer allocations, reviewed recipes/conversions, allowance/pack surplus, substitutions, separate custody/ownership/quality and consolidated buying need deeper implementation. Shortage calculations must distinguish pending drafts from committed incoming supply and prevent double coverage. No client/vendor-included component should generate a duplicate purchase.

### 11. Supplier request, offer, award and order — Partial implementation
Request creation, private supplier access, response history, manually recorded offers, award, submit/approve, acknowledgement and receipts exist. Full RFQ revisions, multi-line documents, landed-cost comparison, validity/no-bid, controlled amendments, short-close, service valuation and split awards remain incomplete. Concrete gaps: vendor portal specification is read from the current material; quote table calls all non-enquiry records selected, including cancelled awarded orders; request creation does not send messages. Do not call issue/share/delivery tracking implemented. Supplier quotes is currently under Supply; its label should explicitly include RFQ for discoverability.

### 12. Delivery, receiving and quality — Partial; important quantity gap
Receipts, independent dispatch preparation checks, source/receiving-task links and rejection handling exist. Dispatch receiving currently requires accepted + rejected = the full dispatch quantity; it has no pending-inspection remainder in that transaction. General partial inspection, quarantine, packing components, multiple arrivals and multi-drop allocations need implementation. Generic task inspection requires all measured work first, whereas dispatch eligibility uses approved output; neither proves a separate partial-QC release ledger. This must be resolved before claiming the ten-wardrobe partial-QC scenario.

### 13. On-site construction and installation — Partial implementation
Site tasks/readiness, commissioning and direct factory-to-site entitlement checks exist. Equivalent installation entitlement for purchased/external/client-owned inputs, component ratios and independently ready room/area quantities need completion. Wet-trade/service work must not depend on fabricated factory receipts. Subcontract materials/labour inclusions must prevent double purchasing and costing.

### 14. Daily progress with little typing — Partial implementation
Incremental reports, review/return, publication and audit foundations exist. A confirmed-work Today view, zero-output/service cases, single-capture shared-run allocation and downstream-safe corrections need scenario verification. Approved progress is not automatically QC release. Text-only client publication remains a policy decision; current evidence requirements must not be silently removed. Separate internal report from approved client summary and selected attachments.

### 15. Money and invoices — Partial; major data and workflow work
Supplier bill matching and capped payments exist; the project client-invoice UI connects/refreshes accounting invoices. Provider `invoice.create` capability is not an implemented project billing journey. Needed: item/category budget revisions, actual/open-commitment/uncommitted forecast, multi-line matching, services, advances, credits, payment allocations, retention, billing entitlement, create/reconcile/amend/credit/reversal handling. Current global uniqueness of a payment reference conflicts with legitimate split settlement. Tax, recognition, currency and pilot billing basis remain policy-dependent. No live financial operations are authorized by this audit.

### 16. People and authority — Partial implementation
Manage/buy/review/report checks and some independent decisions exist. The complete handoff requires named current owner, next receiver, due date, reviewer and acknowledgement; delegation and deactivated-owner recovery also need explicit workflows. Permission and accountability are separate. A person with several roles must not bypass required independent review. Role-specific field and portal access need a complete matrix and tests.

### 17. Global task board and connected events — Partial implementation
Project task board, pulse, event recording, notifications and revision/request-ID handling exist. A generic durable global action projection with source/action/revision identity, correct close/reopen behavior and retry-safe reconciliation is not demonstrated. The existence of a Tasks sidebar entry is insufficient. Preserve one canonical record; drawing approval, purchase approval and QC actions cannot be completed by independently dragging a duplicate card to Done. Permission filtering must apply before counts and pagination.

### 18. Client portal, supplier portal and WhatsApp — Partial implementation
Published views and source-bound supplier submissions exist. Complete verification still needs room/item privacy, download revocation, forwarded-token authority, approved delay messaging, exact-version approvals and invoice/claim continuity. WhatsApp compose is not sending or delivery tracking. Manual incoming evidence needs attribution and explicit order/project matching. The new four-section client UX has not been implemented. Keep client-facing progress/decisions/payment/support distinct from internal operational tabs.

### 19. Field and column contract — Covered specification; Partial schema/UI
All 16 rows were checked: Project, Item, Work group, Batch/run, Task, Material need, RFQ/offer line, Order line, Delivery/receipt, Inspection, Daily update, Budget row, Supplier bill, Client invoice, Change, Handover. Existing types cover parts but not full allocation, revision and quantity contracts. Add an explicit field dictionary per record: key, type, unit/currency, required-at-draft/action, source, permissions, validation, edit-after-commit behavior and migration. RFA and installed-item/service-claim records also need first-class entries. Optional column configuration is not typed custom-field support.

### 20. Edge cases that must be designed before release — Covered register; Not fully verified
All 46 listed cases remain required. Existing tests provide scattered coverage; no 46-case acceptance evidence map was established by the recent UI work. High-risk unresolved clusters are unit/scope conversion, revised specifications, split/surplus awards, partial QC/quarantine, shared resources, post-dispatch corrections, invoice unknown outcomes/payment splits, and warranty/service intake. Each case needs a named test or persisted walkthrough; where policy is unresolved it stays blocked rather than marked passed. The complete case list remains section 20 of the blueprint.

### 21. Implementation sequence after plan agreement — Specified; UX summary drifted
The original nine slices (0–8) still apply. The shorter five-item UX sequence lost explicit purchased-and-installed, factory, site/subcontract, financial-depth and operational-acceptance exit criteria. Restore the original sequence and add explicit aftercare and board capability milestones from sections 24–28. First settle source identity/allocation and action contracts, then prove the purchased-item journey with failure recovery. The last UI delivery is enabling work, not completion of slice 1.

### 22. Decisions for the design review — Policy-dependent
All 11 decisions remain visible: owner/payment gates; optional grouping; factory detail; shared runs; independent source/location; QC policy; accounting authority; billing basis; client publication; supplier communication; customization limits. Existing safeguards remain until their replacement is explicitly agreed. Resolve only decisions needed by the next slice; do not infer fixed deposits, warranty durations, tax treatment or factory production rates.

### 23. Separate modules and ownership boundaries — Covered specification; Partial UX mapping
All 12 boundaries were checked: Planning, Items & work, Schedule & resources, Procurement, Stock & receiving, Factory, Quality & handover, Deliveries, Updates & communication, Financials, Aftercare, Global task board. Six main tabs are presentation groups, not a reduction to six business modules. Deliveries, approvals, changes and aftercare need explicit subview/inspector ownership. Original pre-project records remain authoritative; links must not create a second quotation/design system.

### 24. Task board capability contract — Partial foundation; substantial missing depth
All 31 capability rows remain in scope. Current project board/table controls are not Jira-level completion. Trace separately: identity/direct links; hierarchy; work types; intake/backlog; five views; filters/search; swimlanes; ranking; columns; WIP limits; quick capture; assignment/reviewer/watchers; dates/effort; dependencies; subtasks/checklists; bulk preview; guarded drag/keyboard; inspector/full page; collaboration; time/output; templates/recurrence; custom fields; versioned workflow configuration; safe automation; notifications; analytics; import/export; archive/reopen; performance; reliability; accessibility. Current source-based tasks, comments, guarded actions and schedule pieces are useful foundations; shared ranking, all-work-type projections, configuration and representative-load verification remain unproven. Preserve its three staged deliveries, not a blanket “parity” item.

### 25. Handover and the installed item record — Partial implementation
`project-handover.ts` contains source-derived packets, current-packet checks, outstanding items and portal decisions. Installed asset/piece identity, serial/model, scope-quantity coverage, multiple warranty types and reliable partial-acceptance start dates need completion. Whole-project closure requiring financial closure is distinct from valid physical handover with retained obligations. A frozen packet does not alone establish every installed-item or warranty fact.

### 26. Warranty and aftercare — Partial foundation; full service lifecycle missing
Existing warranty claims are tied to accepted handovers and warranty end dates; expired coverage is rejected by the warranty-specific route. Needed: general service intake for expired/unknown items, coverage assessment, goodwill/chargeable decisions, appointments/access confirmation, repeat visits, parts/replacement lineage, costs/recovery, verification and distinct client feedback. Aftercare must persist beyond project completion. A Snags & warranty label is not the complete module.

### 27. Worked scenarios and reconciliation — Specified; Not demonstrated end to end
All four stories remain acceptance work: A ten wardrobes across three projects; B ten purchased chairs with five initially accepted and matched billing; C 120 m² subcontract painting with independent room readiness; D post-handover wardrobe claim with appointment/parts/recovery. Existing narrow procurement/factory/site tests do not prove all four stories or exact quantity/cost reconciliation. Each requires a local persisted fixture, reload and role transitions, including the failure path.

### 28. Final acceptance and delivery boundaries — Specified; Not met
Require quantity/cost conservation, source-derived board actions, automation permissions, coverage dates, no-access visits, replacement lineage and aftercare without fresh execution scope. Keep migrations/compatibility, role privacy, concurrency, retries, keyboard/mobile/RTL and realistic data volumes in the release gate. Do not report the project flow complete because individual screens render or component tests pass. Local-only boundary remains.

### 29. Action and state contract — Partial and not sufficiently translated
The 17-action matrix is in the blueprint; it was not translated into a complete UI/backend acceptance contract by the recent UX work. Existing domain handlers enforce many prerequisites, but exact revision, quantity eligibility, approved authority and connected effects differ by action. See the full action map below. RFA submission/review/return/revision decisions need their own added contract. A displayed action must explain its state/prerequisites and use the authoritative command; no independent status dropdown can stand in for these decisions.

### 30. Review guide — Covered structure; needs traceability
The blueprint has a reading guide but lacked a living implementation evidence register. This audit supplies the 30-section coverage map. Next delivery records must reference section and requirement ID, source owner, schema/API change, screen, policy decision and acceptance evidence. Keep outstanding work and explicit deferrals visible; do not silently remove requirements when minimizing the UI.

## All 17 actions in section 29

“Existing” below means code path found, not complete compliance with every cell in the blueprint.

| Action | Existing source / screen | Gap or required verification |
| --- | --- | --- |
| Release accepted scope | `project-release.ts`; pre-project commercial release | Exact source/options, revisions, conversions and deduction disposition across allocation model |
| Confirm item plan | `work_package` / `task`; Project → Items → plan dialog | Distinct draft/confirmed semantics, allocation conservation, route matrix and named handoff owners |
| Confirm booking | Execution service scheduling + `project-schedule-capacity.ts`; Work → Teams & bookings | Shared run, crew+machine combined constraints, changed roster and impact scenarios |
| Issue RFQ | `request_supplier_quotes`, `enquiry`; Supply → Supplier quotes | Request creation exists; frozen issuance revision and observed sharing/delivery states do not |
| Approve order | `order_status: approved`; Supply → Orders | Review/buy/release/budget checks exist; line allocations, issued revisions and amendments incomplete |
| Record acknowledgement | Supplier update → buyer `order_status: acknowledged` | Bind evidence to issued revision; a changed price/specification needs a separate decision |
| Accept goods | `receipt`; Supply → Receipts | Accepted/rejected evidence exists; pending quarantine, shipment remainder and destination allocation incomplete |
| Start operation | `task_status`; Work → Tasks/Factory/Site | Existing readiness gates; verify all routes and partial-quantity eligibility without weakening release |
| Approve daily output | `approve_report`; Work → Daily progress | Independent review exists; shared-run and downstream correction scenarios need completion |
| Pass QC | `inspect` and related controls; task inspection/quality | Generic inspection is whole-task; separate partial QC eligibility/checklist/version ledger required |
| Dispatch | `dispatch_status`; Work → Factory → Dispatch | Preparation review exists; eligible QC quantities, packing and multi-drop/destination readiness incomplete |
| Receive at site | `dispatch_status: received`; receiving controls | Full dispatch accepted/rejected enforced; partial/pending receipts and all sourcing routes incomplete |
| Accept installed work | Reviewed output + `inspect` / commissioning | Bought/client/external component entitlement, installed quantity and independent QC need route tests |
| Approve supplier bill | `approve_supplier_invoice`; Budget & payments → Supplier invoices | Existing goods quantity/rate match; services/advances/credit and multi-line exceptions incomplete |
| Issue client invoice | Commercial Connect/Refresh + provider create capability | Complete invoice-request/create/unknown-outcome/reconcile/amend lifecycle missing from project UI |
| Accept handover | `handover_status`, `decideHandoverFromPortal` | Frozen packets exist; exact partial coverage/authority and retained obligations require walkthroughs |
| Resolve service claim | Snag resolution + `project-warranty.ts` foundations | Assessment, visits, chargeable approval, parts/recovery, independent verification and feedback lifecycle incomplete |

For every command the implementation checklist must include: current source/revision; actor and delegation; required fields/evidence; eligible quantity/value; prerequisite errors; resulting state; audit record; connected action projection; visibility/publication; duplicate retry; concurrent-change conflict; correction/reversal route. These are acceptance conditions, not extra client-visible columns.

## RFA correction to the plan — proposal to settle before implementation

RFA means request for approval in this proposed addition. RFQ asks a supplier for a price; RFA asks a designated reviewer to decide on a specific submission. RFI/technical query asks for clarification and must not be treated as approval. If the user intended RFQ only, retain the RFQ work and confirm the approval terminology before creating a separate register.

Place a staff **Approvals** sub-tab under Project, with source/type filters. Show current pending decisions in the item's Decisions panel and global My work. Show only explicitly assigned/published client decisions in the client Decisions tab. Reuse pre-project approvals where they already own the source; do not make a conflicting second approval truth.

Candidate types: drawing/shop drawing, material/finish/sample, substitution and technical-method submission. Quote/variation acceptance, spend approval, QC inspection and handover keep their own domain actions; an approval queue may surface them without merging their state machines.

Proposed request fields: stable reference, project/item/room, type, source record and exact revision, submitter, designated approver(s), internal/client responsibility, submitted/due date, attachment versions, decision scope/quantity, state, decision/comment/evidence, predecessor request, affected work/hold and publication policy. Use source references rather than copying mutable text as the authority.

Proposed states: Draft → Submitted → In review → Approved / Returned for revision / Rejected / Withdrawn. Revised submission retains the previous decision and identifies the new source version. “Approved with comments” must distinguish nonblocking comments from conditions that still prevent release; do not implement a blanket ready state. Required multi-approver policy and delegation need a decision before coding them.

Submission freezes the reviewed content. A comment, uploaded file, viewed link or WhatsApp reply is not a recorded approval. A changed approved drawing/material triggers an impact review of orders, stock, work and installed scope. Technical approval does not approve cost or authorize production independently of existing release gates.

## Corrected UI coverage map — proposed, not newly built

| Main area | Concise sub-tabs | Details shown contextually |
| --- | --- | --- |
| Project | Items, BOQ & designs, Approvals, Changes, Overview | Source quotation/agreement, route/quantity plan, cost/date impacts, decision history |
| Supply | Requirements & stock, RFQs & offers, Orders, Receiving & returns | Shortages, supplier directory, transfers, shipment/receipt/QC, service valuations |
| Work | Tasks & timeline, Teams & capacity, Factory, Site & daily work | Batches/runs, work centers, day plan, packing/dispatch, receiving appointments, commissioning |
| Quality & handover | Inspections, Defects, Handovers, Aftercare | Checklists, concessions/rework, installed items, coverage, claims/visits/parts/recovery |
| Budget & payments | Budget & forecast, Supplier bills, Client invoices & payments | Advances, credits, retention, exceptions, reconciliation, approved budget changes |
| Files | Register | Revision history, transmittals and protected evidence; approval status links back to its decision |

These groupings preserve all 12 module owners in section 23. They are not additional top-level tabs and are not yet all implemented. Reuse existing URLs and screens wherever possible. Client navigation stays Progress, Decisions, Payments, Handover & support. Global Tasks/Factory operate on the same source records across projects. Company-wide Aftercare can become its own destination when that queue is implemented.

## Restored delivery order

1. Reconcile this audit with the blueprint and settle RFA terminology, allocation identity, route semantics and the first billing/QC policy. Produce field dictionary and command contracts for the next slice.
2. Complete accepted-scope → classified item → assigned plan, with source/quantity allocation and technical approval links. This is original slice 1, not another table redesign.
3. Prove purchased-and-installed flow: RFQ → offer → approved PO → partial receipt/QC → installation → acceptance, with linked bill and client milestone. Include reject/replace, retry and privacy.
4. Prove own-factory and site/subcontract routes separately; partial QC, batches, dispatch and exact receipt must reconcile.
5. Add cross-project runs/capacity and canonical global action projection; deliver task-board capability stages explicitly.
6. Deepen finance, portals and communication; their basic correctness/privacy is mandatory in earlier slices, not deferred wholesale.
7. Complete installed-item/aftercare lifecycle, all four worked scenarios and the full edge-case acceptance register.
8. Run persisted operational acceptance and migration/recovery checks. Only then assess deployment readiness; deployment remains a separate user decision.

## Evidence and limits

Key inspected sources: `apps/web/components/projects/project-pipeline-navigation.tsx`, `project-work-orders.tsx`, `project-work-plan-editor.tsx`, `project-workspace.tsx`, `vendor-comparison.tsx`, `project-suppliers.tsx`; `apps/web/components/commercial/payment-invoice.tsx`; `services/business-core/src/projects/execution.types.ts`, `execution.domain.ts`, `execution.service.ts`, `execution-controls.ts`, `project-work-packages.ts`, `project-schedule-capacity.ts`, `project-factory-handoff.ts`, `project-design-control.ts`, `project-handover.ts`, `project-warranty.ts`, `project-execution-events.ts`, `vendor-order.service.ts`; integration provider capability declarations.

The prior implementation verification (34 component tests, four empty-fixture browser checks, web typecheck) remains scoped to that UI change. No new full-flow test run is claimed by this documentation audit. Section-specific existing test files are evidence candidates, not automatic passes for the blueprint's broader scenarios.
