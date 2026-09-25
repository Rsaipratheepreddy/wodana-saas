# Projects redesign plan

Planning proposal dated 20 September 2026. No application changes are included.

## Basis and scope

Primary reference: Project Flow Master Document.docx, all seven pages. Supporting example: Estimate Proposal 0744 Rev. 5 - Test Client.pdf. The source document describes one studio's operating rules and an evaluation of Wodana; those observations are evidence, not instructions to change systems or proof of current product capabilities. Its source spreadsheets were not supplied or independently verified.

The product should manage design services, supply-only orders, bespoke manufacturing, installation, fit-out, repairs and mixed projects through shared records. The 18 source stages must all have a home, without forcing every project through every activity. This plan covers the identified operational cases; new contract and jurisdiction-specific requirements still need configurable policies.

## Main design decision

Build around a project containing locations, deliverables and linked work. A deliverable is the contracted outcome: six chairs, an installed media wall, a room design or a repair. It carries its approved scope, quantities, revisions, tasks, materials, costs, approvals and acceptance history across sections.

Project -> location or room -> deliverable -> work steps, material requirements, orders, inspections and handover.

Allow unallocated locations, services without rooms, multi-site projects and shared project expenses. One commercial line can have several delivery batches; one purchasing order can cover several deliverables. Use explicit quantity and cost allocations so neither case duplicates scope or progress.

Keep commercial scope, technical specifications, material demand and task quantities distinct but linked. A selling quantity of one cabinet does not mean one unit of raw material, one production operation or one supplier invoice.

## Entry and release

Preserve Lead reference -> Deal reference -> Project reference, with the accepted commercial version and evidence retained. Creating a draft must not authorize spending or production.

Support two commercial routes:

1. Approved execution scope: bring the accepted quotation, agreement, drawings, material approvals, required payment evidence and owner authorization into Projects. Existing approved work is reused.
2. Approved design engagement: activate the design scope after its commercial checks, then develop technicals and execution pricing. Manufacturing remains blocked until the later execution scope is approved and released.

Route 2 is a proposed extension needing product agreement. It resolves the source's design and BOQ stages occurring after project creation; the current release code principally assumes an accepted quotation with approved design evidence. Do not weaken its controls silently.

For the Palm configuration, retain the documented required-payment and Owner Review gates. For other tenants, derive required payments from the signed engagement; do not impose universal full prepayment. Record applicable requirements, decision maker, evidence, scope, version and time for every authorization.

Owner Review supports approve, return with reasons and reject. Separate authorization to activate design, commit purchasing and release manufacture/site work. A PM can verify readiness; financial or commercial authorization follows the configured approval authority. Imported live projects need a reviewed opening baseline and missing-evidence exceptions, never invented approvals.

## Navigation and responsibilities

Global Projects navigation: All projects, My work and Calendar. Team workload is a view of Calendar; reusable workflow configuration belongs in workspace administration. Existing specialized global pages can become filtered queues for procurement and production teams.

Inside a project use nine compact sections:

| Section | Responsibility | Main outcome |
| --- | --- | --- |
| Overview | Project identity, team, dates, risks, decisions and next actions | Clear ownership and next step |
| Scope & design | Deliverables, measurements, inspiration, concepts, layouts, renders, technicals and material approvals | Approved specifications tied to scope |
| Plan & schedule | Tasks, dependencies, milestones, bookings and baseline dates | Executable work with owners and capacity |
| Purchasing | Material demand, stock reservations, supplier enquiries, orders, receipts and returns | Accepted supply against real demand |
| Factory | Production readiness, work orders, operations, inspection, packing and dispatch | Accepted manufactured quantities |
| On-site | Site readiness, preparation, receipts, installation, daily updates and inspections | Verified installed or site-completed quantities |
| Handover | Inspections, snags, acceptance, documents and aftercare | Accepted deliverables and tracked obligations |
| Budget & payments | Contract value, costing, budget, changes, invoices, receipts and supplier commitments | Reconciled commercial position |
| Files & activity | Linked documents, revision history, conversations and decisions | Searchable project evidence |

Only show applicable execution subviews. A design-only job needs no factory; an installation-only job needs no renders. Hidden navigation does not delete records or bypass required controls. Keep approvals and changes as linked records with project-wide queues, not disconnected duplicate databases.

## Mapping every source stage

| Source stage | Proposed home and behavior |
| --- | --- |
| 01 Owner Review | Upstream permission-gated commercial decision; visible as linked evidence in Projects |
| 02 Deal File | Activated commercial baseline linked permanently to the lead and project |
| 03 New Project | Initiation confirms owner, scope, route, locations, roles and dates |
| 04 Concept / Moodboard | Scope & design deliverable; configured revision allowance and client feedback window |
| 05 Space Planning | Scope & design layouts, dimensions and versioned approval |
| 06 Renders | Named visualiser, due dates, versions and revision allowance |
| 07 Awaiting Client Approval | Approval state of the relevant deliverable, not a blanket freeze of the project |
| 08 Technical Drawings | Technical designer prepares; appropriate reviewer approves the exact revision |
| 09 Material Selection | Sample/specification and client decision linked to affected items and purchasing |
| 10 Costing / BOQ | Surveyor validates quantities; sales assistant prices; authorized reviewer checks margin and commercial changes |
| 11 Procurement | Purchasing demand to accepted receipt or accepted subcontract service |
| 12 Ready for Manufacturing | Evidence-based release for selected scope and quantity |
| 13 Manufacturing | Factory operations, batches, inspection, rework and packing |
| 14 Site Works | Site preparation can overlap manufacturing with explicit dependencies |
| 15 Installation | Delivered quantities, crew booking, installation and inspection |
| 16 Snagging | Assign, correct, verify, close or reopen against the affected item |
| 17 Complete | Record accepted handover; track commercial closure and warranty separately |
| 18 On Hold | Hold overlay at project, room or deliverable level; preserve prior state and resume conditions |

## States and progress

Project lifecycle: Draft -> Active -> Handover -> Closed. Keep On hold and Cancelled as explicit alternative states with reasons. Show design, supply, factory and site progress separately because these activities overlap.

Task lifecycle: Draft -> Ready -> In progress -> Awaiting verification -> Completed, with Blocked and Cancelled alternatives. Readiness is computed from applicable evidence; it is not a manually checked green badge. Return failed verification to correction. Preserve all transition history.

Keep physical completion, client acceptance and financial closure separate. A client may accept a room while another room is unfinished, or handover may occur while an agreed retention is outstanding. Closing a project does not erase warranty obligations.

Calculate progress from accepted quantities or approved weighted milestones. Show reported versus verified progress. Do not add factory and installation percentages together or average arbitrary status labels. Attendance is not completion. Cancellations and approved scope changes revise the denominator with baseline history retained.

## Design and scope workflow

Each design deliverable records type, owner, reviewer, linked rooms/items, due date, files, version, internal review, client decision and revision allowance. Internal approval and client approval are different events. Comments do not count as approval. Client approval applies only to the submitted version and selected scope.

Allow approve, request changes and reject, with reasons and evidence. Partial approval identifies exactly what is approved. Consolidate a submitted feedback round; count chargeable rounds according to the agreement rather than per comment. Distinguish corrections from requested scope changes. Additional fees are proposals requiring approval, never automatic invoices.

Survey records retain proposed, measured and approved dimensions, units, surveyor, date and evidence. Missing dimensions remain unknown. A design change after release flags impacted tasks, purchases and manufactured batches for review; it never silently replaces their released drawing.

Concept work completed in pre-execution remains the same linked record. Projects continues its history without copying files into a second uncontrolled design area.

## Scheduling and daily work

Tasks link to deliverables and carry responsible person, optional collaborators, location, duration, dependencies, planned dates, actual dates, quantity and inspection requirement. Reusable workflows suggest tasks for each delivery route. Users review the generated work before publishing it.

Store client promise separately from internal target, baseline and current forecast. Model statements such as eight to twelve weeks after drawing approval with a trigger and duration range. Before approval, show the date as unconfirmed; do not fabricate a deadline. A delay produces an impact preview before changing dependent bookings or client promises.

Book people, crews and factory capacity across projects. Check calendars, leave, skills and clashes. Being assigned to the project does not reserve capacity. Permit authorized overbooking only with an explicit visible exception.

My work replaces personal trackers: tasks due, approvals waiting, blockers and next client meetings. Daily update captures work quantities, photos, time, issues and next actions once, with supervisor review. Corrections preserve original submissions. Offline drafts and retry protection prevent duplicate progress on mobile.

## Purchasing and materials

Approved specification -> quantified demand -> stock reservation -> shortage -> enquiry -> supplier selection -> approved order -> delivery -> inspection -> accepted receipt -> issue to work.

Track specification, unit, waste allowance, supplier, source of supply, required date and allocation. Client-supplied and subcontractor-included materials must not generate duplicate purchase requests. Reserve stock transactionally across projects; distinguish on-hand, reserved, quarantined and incoming quantities.

Handle split orders, partial receipts, damaged/rejected goods, substitutions, back orders, returns, replacements and unused stock. Receiving is not automatically accepting. Services require measured or certified completion instead of a goods receipt. Substitutions trigger technical/client approval where required and a commercial change when applicable.

## Execution and handover

Manufacturing release checks applicable drawing revision, dimensions, material approval, available inputs, commercial authority, required payments and capacity. Permit batch release without approving the entire project. Long-lead purchasing can have its own authorization before full production release.

Track factory output, inspected output, rework, scrap, packing and dispatch separately. Dispatch includes accepted quantities, destination, transport, delivery booking and site readiness. Site checks cover access, permits where applicable, clear areas, prerequisite trades, services, storage and protection.

Installation records quantities and evidence; inspection creates snags when needed. A snag has severity, owner, due date, evidence, correction and independent verification where required. Reopening preserves its history. Internal defects do not become chargeable client variations automatically.

Handover packets can cover a room, batch or whole project: accepted scope, inspection results, permitted outstanding items, manuals, as-built drawings, warranties, client acceptance and dates. Blocking defects prevent acceptance; nonblocking exceptions need named ownership and due dates. Warranty claims reference the accepted item and applicable coverage; disputed or out-of-period claims can still be recorded for assessment rather than disappearing.

## Money and changes

Maintain separate figures for accepted contract value, approved additions/deductions, revised value, cost budget, purchase commitments, actual cost, forecast remaining cost, client invoicing, received money, supplier bills and payments. Paid money is not margin. Do not count an order commitment and its invoice twice in forecast cost.

Payment schedule supports percentage or fixed amount, triggering event or date, allocated value, required release condition, invoice linkage and collection status. Support part-payments, advances, credit notes, refunds, retention, disputes and cancelled milestones. Trigger satisfaction proposes a billing action; it does not mark the invoice paid. Currency, tax and rounding follow workspace/contract configuration, with deterministic totals.

Change request -> impact review -> commercial approval and client acceptance where applicable -> new baseline -> affected work replanned. Record effects on scope, quantities, budget, dates, stock, orders, commission and previously completed work. Pending changes stay visible but outside approved totals. Emergency work requires a separately authorized limited instruction with scope and limit; it cannot bypass all approvals.

## People and access

Support all source roles: sales/account manager, senior designer, junior designer, technical designer, visualiser, PM, creative director, finance, procurement/production, owner/admin, sales assistant and surveyor. Roles are assignable responsibilities; one person may hold several, subject to approval separation policy. Add external client, supplier, subcontractor and inspector access as scoped capabilities.

Surveyor verifies measurements and technical quantities; sales assistant prepares the priced BOQ; commercial approver authorizes it. Finance verifies payment and accounting evidence; payment verification is separate from owner release. Technical designer remains a configurable responsibility, not a hard-coded person.

Restrict cost, margin, commission and internal notes by permission. Client portal shows explicitly published versions and decisions. Vendor access is limited to their order and relevant specifications. Every API enforces workspace, project and record permissions; hiding controls is insufficient. Revoked access invalidates active sharing access as appropriate.

## Every tracked field has a home

| Source field group | Product record |
| --- | --- |
| Project ID, work order, client, location, type, description | Project identity and linked engagement |
| All named people | Project role assignments and task/deliverable owners |
| Concept, layout, render, technical and material status | Versioned deliverables and approvals |
| BOQ cost, sell and margin | Commercial baseline and restricted cost plan |
| Procurement, manufacturing, site, installation and snag status | Derived quantities and workflow summaries |
| Promise, target, handover, days remaining | Separate promise/baseline/forecast/actual dates and calculated countdown |
| Payment date, status, invoice paid | Payment allocations and reconciled invoices, supporting multiple transactions |
| Priority, risk, next action, owner, due date | Project and deliverable controls, linked to actionable records |
| Next meeting and client notes | Calendar event and permission-aware communication history |
| Live count per person and stage/risk counts | Saved portfolio views derived from the same records |

Separate priority from risk and completion. Replace ambiguous source risk values with clear labels such as On track, At risk and Blocked; preserve imported labels for audit. Any manual risk override requires a reason and review date.

## Exception coverage to test

| Case | Expected behavior |
| --- | --- |
| Design-only, supply-only, site-only, repair or mixed work | Applicable route and checks only |
| Multiple rooms, sites, vendors or delivery batches | Quantity allocations; no duplicate scope |
| Missing approval, measurement or responsible person | Draft allowed; affected release blocked with next action |
| Some items approved, others waiting | Release approved quantities independently |
| Client late approval, supplier delay or access denied | Affected work blocked, forecast impact and recovery owner shown |
| Client changes approved dimensions/materials | Versioned impact review; released work does not silently update |
| Client-owned material damaged or unsuitable | Condition evidence, custody and decision before work proceeds |
| Partial delivery, rejection, replacement or return | Outstanding usable quantity stays accurate |
| Scope deducted after purchase or manufacture | Preserve costs/history and resolve committed liabilities |
| Failed inspection or reopened snag | Corrective work tracked without double-counting progress |
| Project paused, cancelled or restarted | Control new actions; preserve commitments and review restart readiness |
| Partial handover, retention or unpaid balance | Distinct physical, acceptance and financial states |
| Warranty claim or new paid aftercare | Assess coverage; connect to original accepted work |
| Team member leaves or role changes | Reassign open responsibilities without rewriting past decisions |
| Concurrent edits, retries or offline submissions | Conflict handling and idempotent mutations |
| Integration outage or reversed payment | Reconciliation state, retry visibility and release impact review |
| Invalid units, negative quantities or over-allocation | Validated conversions and quantity limits; explicit adjustment records |

## Clean interface

One project header with name, client, owner, health and target. One compact row of section tabs. Section-specific tools appear with the relevant table. Do not reproduce a second global header or a giant row of stage buttons.

Use compact bordered grids, inline editing, keyboard navigation, sensible column widths and saved views. Open a consistent record drawer for linked details. Keep advanced options collapsed. Use in-app confirmations for consequential actions and visible save/error states. On mobile present a focused task/update screen instead of squeezing the desktop grid.

Overview answers: What needs my decision? What is blocked and why? What can start? What changed the handover forecast? Each answer opens the underlying record. Show useful empty states with one next action. Avoid decorative counts without a working destination.

## Automation and AI

Useful automation derives readiness, updates quantities, exposes dependent blockers and creates reviewable next actions. It does not silently send messages, change promises, release production or approve costs.

AI can draft work packages from approved scope, extract proposed requirements from documents, identify missing measurements, summarize feedback, suggest schedule impacts and draft client updates. Show source evidence and uncertainty. Review before applying edits; preserve a diff and undo where possible. Never invent dimensions, approval, cost or payment evidence. Core workflows remain usable without an AI provider.

## Existing code and migration

Reviewed navigation, release, work-package, workflow, warranty and execution code. Useful foundations already exist: frozen commercial/design evidence, scope-linked work packages, dependency validation, readiness checks and accepted-handover warranty links. This was a targeted review, not an exhaustive runtime audit.

Issues to design around: current release assumptions about completed design; one active work package per scope line versus partial batches; whole-project gates versus partial acceptance; restrictions on recording out-of-coverage warranty claims; duplicate commercial/payment ownership across pre-execution and Projects. Validate existing behaviors before deciding what to reuse.

Define stable IDs and record ownership first. Retain pre-execution commercial source versions while Projects owns execution. Payment evidence must have one authoritative record and linked views. Use typed commands for approval/release, concurrency checks and retry protection. If operational records move out of the large execution document, migrate incrementally with reconciliation; do not replace the backend blindly.

Import existing projects with a preview: map roles, statuses, dates, rooms, quantities and references; flag contradictions; preserve original values and provenance. Reconcile totals and counts before switching. Retain read-only legacy access and a rollback path. Do not delete the referenced spreadsheets or replace external tools merely because the document suggests it.

## Delivery sequence and acceptance

1. Foundation: agree record ownership, routes, permissions and two entry paths; document status transitions and migration mappings.
2. First complete journey: approved engagement -> project -> item -> design approval -> work plan -> release -> verified work -> partial handover. Include a revision, payment gate and failed inspection. Prove persistence and permissions.
3. Supply and capacity: stock, purchasing, vendor work, factory batches, resource booking, dispatch and mobile progress.
4. Commercial and closeout: change impact, payment reconciliation, client publishing, handover packs, warranty and reporting.
5. Assisted operations: AI proposals and deeper integrations once the underlying records are reliable.

Validate with design-only work, bespoke joinery, supply-only furniture, multi-trade fit-out and a repair using client-owned material. Every scenario must preserve traceability, reconcile quantities/money and show the next responsible action. Test tenant isolation, permissions, approval invalidation, retries, partial operations and concurrent edits. Do not call the feature complete based only on populated screens.

## Decisions before implementation

Recommended defaults: support both design engagements and execution engagements; allow partial release/handover; use configurable role permissions; keep workflow templates optional; separate warranty from financial closure; keep client portal administration in workspace settings with project-level publishing.

Confirm later: whether paid design engagements are sold separately; exactly which payments gate each route; who can authorize commercial release; how revision rounds are counted; whether the reference's three moodboard/two render rounds or proposal's two design rounds applies to a given agreement. Contract terms take precedence over template defaults. Do not hard-code the reference's fees, time windows or warranty duration globally.


## Detailed operating model for factory site purchasing and finance

Updated after the navigation discussion: Factory and On-site are separate main tabs. The following is a proposed functional design, not existing implemented behavior or additional rules claimed from the client master.

### Classify how work is delivered and how it is supplied

Do not force each scope item into a mutually exclusive Factory or On-site category. Store the work route separately from the supply responsibility.

Work routes include factory plus installation, factory plus delivery, purchased item plus installation, purchased item plus delivery, site-only work, repair and design/service-only. Supply responsibility can be own stock, purchased by the company, included in a subcontract, client-supplied or mixed at component level. An outside factory is a vendor responsibility, not a different physical destination.

A media wall can have workshop joinery, purchased lighting and site electrical preparation. Its one parent deliverable links several work orders and procurement allocations. Subcontracted supply-and-install remains one commitment with progress evidence, avoiding another internal purchase for the same included materials.

Scope holds the approved client outcome and specifications. A reviewed technical breakdown adds component quantities, material takeoff, waste, operations and labour estimates. The surveyor checks quantities before buying or production release. A quote's materials description is not sufficient to automatically create purchase quantities.

### A reviewed plan work action

Select approved items and choose Plan work. A preview proposes factory jobs, site tasks, material demand, dependencies, owners and need-by dates using a reusable template. Show existing linked records and unresolved inputs. Confirm creates only missing records with stable links; repeating the action cannot duplicate work or orders. Editing the plan is allowed before release. Changes to released scope require impact review.

The item drawer shows Specification, Work, Supply, Costs and History. These are linked views of the same underlying records in the specialist tabs. Use the drawer to explain blockers such as waiting for an approved drawing or a particular material receipt.

### Factory operating flow

Queue -> readiness review -> released work order -> material issue -> operations -> quality inspection -> packing -> dispatch -> destination receipt.

Production templates define only relevant operations, for example cutting, assembly, finishing and upholstery. Users can split output into batches. Record planned, issued, consumed, produced, accepted, rejected, reworked and dispatched quantities distinctly. Defective pieces cannot be dispatched as accepted output. Rework retains its original source and cost.

Release specifies the exact scope revision and quantity. Changing a specification flags unstarted, in-progress and completed batches separately. Work can proceed on an approved batch while another is blocked. External manufacture follows the purchase/subcontract order with vendor milestones and inspection, rather than fictitious internal machine bookings.

### On-site operating flow

Survey and readiness -> area preparation -> accepted material/item receipt -> assign and release task -> execute -> report progress -> inspect -> correct defects -> client handover.

Preparation includes access, protection, demolition, prerequisite electrical/plumbing work, dimensions, permits and other checks only where applicable. Work includes installation, painting, tiling, ceiling work, site fabrication, repairs and subcontracted trades. Every task links its area, scope quantity, owner, team/vendor, current drawing, dependencies and evidence.

Separate installation requiring delivered furniture from site work that can proceed independently. Track daily reported quantities and inspector-accepted quantities. Site receipt is not installation completion. A photo is supporting evidence, not automatic acceptance. Include failed visits, blocked access, additional visits and client-owned property condition reports with reviewable time/cost impact.

### Purchasing buys inputs of several kinds

Purchasing supports raw materials, components/hardware, finished goods, subcontract work, and services such as transport, rental or specialist installation. Each request has its source deliverable/task, specification, quantity/unit, destination, need-by date, budget allocation and responsible buyer.

Demand -> usable stock/reservations check -> shortage request -> supplier enquiry or approved direct purchase -> selection -> approved order -> acknowledged dates -> receipt/service acceptance -> invoice check -> payment.

For an invoice, compare the authorized order and accepted receipt/service, with explicit approved advance and other exception flows. A supplier invoice cannot itself mark goods received. Purchasing may consolidate requests with compatible specifications while retaining project/item allocations. Stock transfers between warehouse, factory and site are not new purchases. Client-supplied or subcontract-included inputs remain visible for readiness without generating company purchase orders.

### Financial connections

Maintain a client ledger and a supplier/cost ledger linked to the project. The client side flows from agreement and accepted changes to billing milestones, invoices/credits and allocated receipts/refunds. The supplier side flows from cost budget and approved orders to accepted supply, bills/credits and allocated payments/refunds. Internal labour, consumed stock and overhead allocations also contribute to cost using documented valuation rules.

At order approval, record commitment. At receipt or service acceptance, record the applicable operational cost/accrual state. Supplier bill matching settles the related commitment/accrual rather than adding the same cost again. Display actual plus remaining commitments plus uncommitted forecast as a reconciled forecast, with non-overlapping amounts. Accounting integration remains the authority for posted entries when configured; local operational estimates must be labelled.

Example excluding tax: selling value 20,000 and cost budget 12,000; approved supplier order 8,000, of which 3,000 has become actual cost, leaves 5,000 open commitment. A further 4,000 uncommitted forecast yields 12,000 forecast final cost and 8,000 forecast margin. Receiving a 10,000 client advance changes cash and outstanding collection, not the forecast margin. A supplier payment settles cash liability; it must not add cost again.

Payment gates use verified allocations to the relevant engagement, not a generic Paid badge. Preserve partial receipts, reversals, credits, retention and disputes. Invoice issuance, recognition and tax settings need explicit accounting configuration; do not derive accounting policy merely from project progress.

### Suggested compact subviews

Factory: Work orders, Production, Dispatch. Quality checks open from the affected work order.
On-site: Work plan, Daily updates, Inspections. Readiness and deliveries are linked within the area/work record.
Purchasing: Requirements, Orders, Receipts. Supplier comparisons and returns open within the order.
Budget & payments: Summary, Cost plan, Client billing, Supplier bills, Changes. Payment allocations open from their invoice/bill, with a consolidated transactions view available.

These views share records; they do not create separate status trackers. Search, filters and columns should be purposeful to each grid rather than repeated generic toolbars.
