# Project delivery implementation blueprint

> Subsequent review: [All 30 sections audited](project-delivery-30-point-audit-2026-09-22.md), with [consolidated final UI/UX plan](project-delivery-final-ui-ux-plan-2026-09-22.md). The UI plan refines navigation and adds an explicit proposed RFA lifecycle; the business and acceptance requirements below remain in scope. Historical planning-only statements below describe this document’s original preparation, not the status of later user-authorized local UI work.

22 September 2026. Final draft for product review, including module boundaries, a full task-board capability contract and aftercare. No development, enablement, customer data changes, external messages or deployment are authorized by this document. This expands the earlier pilot outline; it does not replace existing implemented behavior until individual changes are agreed. Final draft means ready for review, not that unresolved business policies or implementation have been approved.

## 1. The product decision

Updated operating sequence following the user's clarification: **BOQ → classify each item → assign and estimate → source/build/perform → check quality → hand over and deliver → install and verify → client acceptance and aftercare.** Classification is explicitly step two, before assigning the delivery work. This sequence is the primary product flow; the later sections specify supporting modules and exceptions.

Organize delivery around the agreed item and its actual work. A project manager starts with a room-based Items table derived from the accepted quotation. Most users should never have to navigate the internal data model to complete their daily work. At every handoff the application answers: what quantity is ready, who is responsible now, who receives it next, by when, and what evidence is required.

Use optional work groups and batches when quantities, responsibilities or delivery dates need separation. Do not force every item through a package/batch/operation hierarchy, require factory steps for purchased products, or model every approval as a newly created execution task.

One item can simultaneously have two units being made, one waiting for delivery and one installed. Preserve quantities and source decisions underneath a short readable summary. One project-wide stage or completion percentage cannot express this reliably.

| Step | User's decision/action | Result and accountable role |
| --- | --- | --- |
| 1. BOQ | Review the released item, room, quantity/unit and specification | One source-linked item; PM owns planning |
| 2. Classify | Choose internal factory, external manufacture, site work, ready-made purchase or client supply; identify material responsibility, stock use and installation need | Reviewed delivery route and relevant steps; PM/technical lead own the decision |
| 3. Assign and estimate | Responsible team estimates effort, resources, materials, cost and finish; PM confirms against client need and capacity | Committed plan with source lead, QC reviewer, receiver and installer as applicable |
| 4. Source or execute | Buy inputs, reserve stock, manufacture or carry out site work; report actual progress | Traceable supply/output and exceptions; buyer/factory/site lead owns the current action |
| 5. Check quality | Inspect the specified quantity against its applicable revision and checklist | Released quantity or defect/rework decision; assigned quality reviewer owns the decision |
| 6. Hand over and deliver | Named next owner acknowledges ready quantity; confirm collection, transit, destination and receipt | Exact custody/quantity transfer; logistics and receiving lead own their respective events |
| 7. Install and verify | Install eligible units or finish site work; inspect and resolve defects | Accepted installed/work quantity; site lead and independent reviewer own their actions |
| 8. Accept and support | Client accepts exact delivered scope; attach care/warranty and retain open obligations | Handover and installed-item history; PM then service coordinator owns follow-up |

The rows describe dependencies, not a rigid whole-project conveyor. Draft scheduling can happen early. Eligible partial quantities can move forward. On-site work skips transport when nothing moves; ready-made goods skip manufacturing; no-install items skip installation. Finance, changes, communication and task-board projections support all steps without becoming extra item stages.

Further primary-source research for this refinement: [Odoo buy/manufacture replenishment](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/mto.html) distinguishes sourcing routes; [subcontractor resupply](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/subcontracting/subcontracting_resupply.html) handles components supplied to an external manufacturer; [operation-specific quality checks](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/quality/quality_management/quality_checks.html) attaches checks to manufacture and inventory movements. Our handoff and interface proposal adapts these patterns; it is not a claim of identical product behavior.

## 2. Evidence and audit boundaries

Reviewed the complete paragraph and table text of `/Users/saipratheep/Downloads/Project Flow Master Document.docx`, the current project implementation and related planning, inventory, sourcing, schedule, portal and operating-flow notes. This is a content and source audit, not a rendered document layout review or live operational walkthrough.

The attachment supplies the 18 stages, role responsibilities, technical-check-to-quotation handoff, payment/owner gates, priority/risk, next action and project promise. Its historical Odoo/Wodana ownership assumptions and suggested retirement of spreadsheets are reference material, not instructions. Its stage 10 already puts working BOQ preparation alongside quotation. Distinguish this working scope from the accepted execution baseline and manufacturing materials list.

Market research below is from primary product/industry sources checked for this analysis. It establishes useful patterns, not Palm's actual factory productivity, contract policy or staff preferences. All recommended behavior and examples in this blueprint are our proposed design unless explicitly described as existing code.

| Evidence | Relevant pattern | Application to this plan |
| --- | --- | --- |
| [Depa manufacturing and procurement](https://depa.com/services/ffe-manufacturing-and-procurement/) | In-house fabrication and external sourcing coexist; shop drawings, samples and alternatives need coordination | Support mixed routes at item level and retain specification evidence |
| [Odoo Shop Floor](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/shop_floor/shop_floor_overview.html) | Work-center and operator views, predecessor/material readiness, time and output capture | Factory is a resource-and-operation queue across projects |
| [Buildertrend bids](https://buildertrend.com/help-article/bids-overview/) | Scoped requests with line items, documents and deadlines; suppliers respond through a link; changed requests require renewed responses | Preserve RFQ revisions and supplier response history |
| [Buildertrend purchase orders](https://buildertrend.com/help-article/purchase-orders-overview/) | Orders connect scope, schedule and commitments | Issued purchase lines retain source demand and delivery dates |
| [Odoo vendor bills](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/purchase/manage_deals/manage.html) | Ordered-versus-received billing policies and three-way matching | Match ordinary goods bills to order and accepted receipt; model advances separately |
| [Odoo quality checks](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/quality/quality_management/quality_checks.html) | Checks attach to operations/products/quantities | Use one inspection mechanism at receiving, manufacture and site stages |
| [Buildertrend daily logs](https://buildertrend.com/help-article/daily-logs-overview/) | Daily records with controlled internal, vendor and client visibility | Capture once; publish an explicitly selected client update |
| [Buildertrend job costing](https://buildertrend.com/help-article/job-costing-budget-overview/) | Original/revised costs, commitments, actuals and forecasts are distinguishable | Separate cost budget, obligations, recognized cost and cash |
| [Procore forecast to complete](https://support.procore.com/faq/which-calculation-method-should-i-choose-when-using-the-forecast-to-complete-feature) | Remaining forecast complements already captured cost sources | Do not add the full PO again on top of its linked invoices |
| [Buildertrend invoicing](https://buildertrend.com/help-article/invoice-overview/) | Billing can follow different contract bases, including progress | Configure billing basis; do not invoice from arbitrary task percentages |

Some direct Odoo page fetches timed out; the vendor-bill and quality patterns above were available through the official indexed documentation. No legal, tax or fixed productivity policy is inferred from these sources.

## 3. What exists and what needs deeper work

Paths below are relative to the repository root. Findings are source observations, not claims that deployed integrations work.

| Area | Existing evidence | Consequence for implementation |
| --- | --- | --- |
| Quotation release | `services/business-core/src/projects/project-release.ts` verifies commercial readiness, quotation hash and design/material evidence; creates/reuses execution and snapshots accepted lines | Reuse this handoff; never retype approved BOQ or release through a board drag |
| Released lines | `released-scope-line.ts` preserves source IDs, dimensions, material rows and catalog snapshots; line total is calculated from quantity × rate | Reconcile discount/tax/optional-line and allocation semantics explicitly; do not derive contract totals by blindly summing these execution values |
| Packages | `project-work-packages.ts` creates one package per released line and enforces unique active scope ownership | Helpful default, but bundled quote lines and later splits need explicit quantity allocations |
| Route planning | Package has supply method and site-work fields; editor suggests factory work for both make and subcontract | Subcontracting must not automatically imply off-site manufacture; site subcontracting needs an independent work-location decision |
| Materials | Requirements link to one consuming task and optionally a scope line; movements, stock and transfers exist | Shared demand and multi-destination purchases need line allocations, not repeated unlinked material rows |
| Purchasing | `execution.domain.ts` supports RFQs, award, approvals, acknowledgement, shipments and receipts | Current order shape has one material/task/quantity. Add document headers and lines for realistic multi-item orders while adapting existing records |
| RFQ delivery | Creating quote requests records “Not sent”; WhatsApp UI prepares a message and says delivery is not tracked | Created, shared, delivered and responded must remain distinct |
| Supplier access | `vendor-order.service.ts` provides revocable seven-day order links and quotation/acknowledgement/progress/delivery submissions | Extend this foundation; supplier submissions are proposals/evidence, not our receipt or approval |
| Supplier invoices | Draft and approved invoice records; approval checks accepted unbilled quantity and order rate; payments capped at balance | Add multi-line matching, advances, credits, service valuation and provider reconciliation; vendor identity must not depend on display-name matching |
| Client invoices | `payment-invoice.tsx` connects/refreshes existing provider invoices. Provider service separately supports invoice creation | Project-level creation, recovery after uncertain outcomes and amendments need an end-to-end contract; capability in the adapter is not completed product flow |
| Finance linkage | Commercial invoice link currently maps one provider invoice to one milestone and verifies amount/currency/account | Combined milestone invoices or multiple invoices per milestone need explicit allocation support, not relaxed matching |
| Budget | Project has scalar budget/forecast and approval compares summed order commitments | Introduce explainable item/cost-category allocation and actual/open-commitment separation; selling price is not the operating cost budget |
| Capacity | Exclusive people/crews, pooled factories/vendors, calendars, leave and cross-project conflicts exist | Capacity slots are not production rates. Current one active task booking/resource model needs review for simultaneous crew and machine constraints |
| Factory | Factory entry lists projects; tasks/output/dispatch controls exist; no explicit batch field in the task schema reviewed | Build an operational queue; add batch allocation only where needed; review partial QC release before assuming partial approved reports are dispatchable |
| Daily progress | Incremental report entries, independent review, revisions, explicit publication and evidence selection exist | Reuse; define partial QC and corrections after downstream dispatch/billing |
| Site and quality | Receipt-to-site-task linkage, inspection, snags, commissioning and handover controls exist | Extend receipt entitlement to purchased/external goods and services without artificial factory tasks |
| Portal | Published progress and selected files, client decisions and schedule alerts exist | Verify row/detail/download privacy and add approved impact explanations without claiming WhatsApp delivery |
| Global work | Project task board, portfolio calendar, pulse and field queue exist | General staff action projection is still needed; retain source-specific commands and permissions |

The earlier focused baseline passed 39 backend and 9 frontend tests. No tests were added for this planning exercise. That baseline does not verify all the structural gaps above or a persisted end-to-end journey.

## 4. Minimal everyday interface

Proposed project destinations: **Overview, Planning, Items & work, Procurement, Quality & handover, Updates, Financials**. Items & work offers Items, Tasks and Timeline views; these are views of connected records. Planning retains the existing requirements/design/quotation/approval journey. Add **Aftercare** when handed-over scope exists. A project's Factory view is available directly from its factory items and from the company Factory module, retaining project context. Documents remain accessible in context and through a project document register. This is a proposed classification, not an instruction to discard current deep links or implement navigation changes now.

Company-level destinations: **My work, Projects, Factory, Procurement, Schedule, Aftercare**; financial operations remain permission-scoped. They filter the same records; they are not independently maintained trackers. Users see only destinations and actions appropriate to their roles. A dedicated tab is justified by a repeated queue, distinct responsible role or specialized transaction, not by every database table.

| Screen | Default content | Main action |
| --- | --- | --- |
| Overview | Next handover, next decisions, actual blockers and responsible people | Open the next action |
| Items | Room-grouped approved scope with delivery plan and quantity progress | Plan selected items |
| Plan | Task list/timeline and day/week crew plan | Assign or schedule work |
| Updates | Today's work, reports, exceptions, selected client updates | Record today's work |
| Money | Cost budget, purchases/bills, client invoices/payments and changes | Review the relevant financial action |
| Factory | Actual operations grouped by work center/team/date | Allocate or report work |
| Buying | Need to source, awaiting quotes, approval, due deliveries, receipt issues | Act on selected demand/order |
| My work | Assigned execution and source-derived decision/follow-up actions | Open source record |

Use one shared item inspector: summary, work, materials/orders, files/decisions and history. Display tabs only when relevant. A compact row has no more than roughly eight default fields; detailed columns are selectable saved views. Bulk actions apply only to compatible records and show exclusions before saving.

Simple terminology: Item, Work group, Batch, Task, Material needed, Ask for prices, Supplier offer, Order, Delivery, Check quality, Daily update, Client invoice, Supplier bill. Technical names such as RFQ, BOQ or commitment can remain where familiar, with a short explanation. Do not call a quotation, manufacturing instruction and purchase order all “work order.”

## 5. Quotation to executable items

1. Requirements and design establish the working room/item list, measurements, specifications and inclusions. Draft quotation quantities can be provisional when explicitly labelled.
2. Surveyor/technical checker verifies the applicable drawing and quantity basis. Commercial prepares price, terms, exclusions, alternatives and payment milestones.
3. Issue freezes the offered version. Client acceptance identifies the exact version, chosen options, authority and evidence. A concept approval is not acceptance of price or fabrication drawings.
4. Release preserves accepted scope and approved technical/material references through the existing commercial gate. Planning before release is permitted where current policy allows; no spend or production authority is implied.
5. The PM opens Items with imported scope. For each item, review delivery quantity/unit, route, owner and required date. Missing cost estimates remain missing; do not copy selling price into a cost budget.
6. Link execution splits to source lines. One quote line may cover a whole kitchen, requiring several deliverables. Several commercial lines may price one deliverable. Store explicit allocation rather than depending on a one-to-one title match.
7. A partial or revised release is a controlled addition to the baseline. Unselected optional items never enter execution. Deducted scope retains procurement/output history and generates a disposition decision.

Keep commercial quantity, delivery quantity, material quantity and work measurement separately. Examples: wardrobe sold by square foot, delivered as two units, built from sheets/metres/pieces; painting delivered as 120 m², worked through preparation/primer/coats. Conversion needs a documented basis. Completion of three painting operations does not mean 360 m² sold or invoiced.

An indivisible item needs an identifier only when distinction matters: room destination, dimensions, finish, revision, serial/warranty, inspection result or rejection history. Otherwise aggregate identical quantity. Room/item names may change; stable IDs do not.

## 6. Choose a route without confusing responsibility and location

Ask four questions, with defaults suggested from the item template and reviewed by a person:

- Who supplies the item or performs the work: our team, supplier, subcontractor, client?
- Where is each work step performed: our factory, supplier workshop, site, office, or no manufacturing?
- What remains at site: delivery only, installation, construction/service, commissioning, or none?
- Who supplies each needed material: us, subcontractor as included scope, or client?

| Scenario | Generated delivery plan |
| --- | --- |
| Own-factory wardrobe | Technical readiness → material supply → factory operations → factory QC → dispatch → site receipt → installation → site QC |
| External custom wardrobe | Approved specification → supplier offer/order → supplier milestones and inspection → shipment → receipt → installation → QC |
| Purchased chair | Select approved SKU → buy/reserve → receive/check → place/deliver → acceptance; no manufacturing task |
| On-site joinery by employees | Material supply → site/access readiness → site fabrication → installation/finishing → QC |
| Tiling or painting by subcontractor | Scope/rates and order → material responsibility → site readiness → daily measured work → inspection/service acceptance |
| Supplier includes installation | One scope/commitment with supply and service portions; separate receipt and installation evidence; no second installation purchase |
| Client-supplied appliance | Expected arrival → receive/check → installation/commissioning by assigned team; no company purchase |
| Hybrid countertop | Site measurement/template → external fabrication → delivery → site fitting/sealing → QC |
| Design-only/service item | Assigned work → review → service acceptance; no fictional stock or delivery |

Operations templates are editable project snapshots. Applying a template twice must not duplicate tasks. Catalog/template changes do not rewrite committed work. A change of route after ordering or starting work triggers an impact review rather than deleting old steps.

## 7. Work groups and batches

A work group is optional organization: all joinery in a room, waterproofing on one floor, or loose furniture for an area. Give it one accountable coordinator. Grouping must not change source ownership or physical quantities.

A batch is a planned quantity handled together. Create one when part of a quantity has a different date, team, specification or destination, or when production needs a traceable lot. Most single-item work needs no separate user-facing batch setup.

For ten identical wardrobes across three projects, use one workshop run with allocations, for example A:4, B:3, C:3. Each allocation retains project, item, room/destination, quantity and specification revision. Group only compatible work; different dimensions, finishes or approved revisions remain distinguishable even if machines process them in one session.

Reserve the team's time once for the run, then allocate time/output/cost to its project lines. Ten separate overlapping exclusive team bookings would be incorrect. Existing project-bound booking architecture needs a deliberate shared-run design before supporting this fully. First operational slice may schedule project batches sequentially on one global queue, but cross-project shared runs are a required later acceptance scenario, not silently claimed as done.

Splitting 10 into 6+4 preserves total allocation. Moving units to another project requires a controlled stock/scope allocation, not editing the label. Rework does not create an extra sold unit. Replacement production has its own cost and link to the original failed unit.

## 8. Dates and day-by-day planning

Retain distinct dates: contractual promise, approved baseline, current forecast, supplier promised date, latest supplier ETA and actual completion. Show original promise beside current forecast when they differ. Unknown dates say Unconfirmed; do not default them to today.

Plan backward from the required site date: installation and inspections require accepted delivery; delivery requires packing/QC and transport; manufacturing needs materials, drawings and capacity; procurement needs sourcing, approval, supplier lead time and receiving inspection. Use configured working calendars, supplier calendars and elapsed-time waits such as drying/curing. A dependency can refer to a released quantity/area instead of requiring the whole predecessor to finish.

Forward-check the resulting plan against actual resource availability. A booking can be tentative before materials arrive, but start remains blocked until readiness passes. When a delay arises, propose downstream changes and alternate teams/suppliers; show affected client milestones before confirming. Never silently rewrite the baseline or client promise.

The planner uses a rolling two-week lookahead and a committed daily plan. Each day lists operation, exact item/batch, team, available work hours, planned quantity, location, readiness and blocker owner. The team lead confirms actual work and proposes tomorrow's plan at shift end. Unfinished work carries remaining quantity, not a duplicate task.

Illustrative sequence only; no production durations are asserted:

| Day | Factory | Site | Coordination |
| --- | --- | --- | --- |
| 1 | Confirm released drawings, materials and run allocation | Verify dimensions, access and storage | PM confirms first delivery need |
| 2 | Team A cuts compatible allocated parts | Site team completes enabling work | Buyer resolves a missing hardware delivery |
| 3 | Assembly reports actual output; QC checks first lot | Site lead confirms receiving slot | Planner adjusts only affected remaining work |
| 4 | Approved lot packed/dispatched; remainder stays in queue | Receive and inspect exact delivered units | Damage creates one linked issue and replacement action |
| 5 | Continue remaining/replacement work | Install accepted units and record quantities | PM reviews forecast and publishes a client update if needed |

## 9. Factory teams and capacity

Different questions need different facts: booked, currently working, absent, available for assignment and capable of this operation. Being clocked in does not mean available; being unbooked does not prove the required skill or material readiness.

Represent work center, crew, roster effective dates, operator skills, calendar/shift, planned downtime and operation duration. Factories with little detail can start with named crews and manually estimated time. Add machine constraints where they affect commitments.

Record throughput with a basis: operation/product family, quantity, unit, time period, crew size, working hours and setup time. “Ten wardrobes” alone is not a capacity rate. A planner might estimate four team-hours of assembly per compatible unit; ten units then need forty team-hours plus applicable setup, not ten simultaneous capacity slots. A crew-hour and a person-hour must remain distinguishable for cost calculations.

Operations may need both a crew and a machine; reserve these constraints together. Do not allow a person to be double-booked through membership in two crews or a separate individual assignment. A changed roster must revalidate future confirmed bookings. Leave, overtime and exceptions follow explicit permissions; a leave reason is not shown to everyone in Factory.

Factory view shows: scheduled/ready/in progress/awaiting check/blocked operations, next free slot, remaining work and affected projects. Count distinct projects and distinguish active from merely planned. External suppliers provide promised capacity/availability; do not invent visibility into their staff or machines.

## 10. Material planning and buying

Technical preparation converts deliverables into reviewed component demand with quantities and units. Retain recipe revision, approved substitution, allowance/waste basis, pack format and stock identity. Manufacturer/catalog recipes are suggestions until project-specific dimensions and selections are confirmed. Cutting optimization is a separate capability and must not be implied by area arithmetic.

Net requirement considers valid accepted stock, stock allocations, existing issues, approved incoming supply and expected transfers without subtracting anything twice. Pending approvals should be shown separately so a pending PO can prevent duplicate drafts without pretending confirmed coverage. Need-by dates determine whether incoming supply is usable in time.

The buyer selects requirements and creates a purchase request or asks suppliers for prices. A material can serve several items; one PO can cover several requirements. Keep allocation rows linking demand, ordered quantity, destination and cost. Allocate a single invoice or shipping charge once by an explicit reviewed basis.

Combine purchases only where specification, unit, supplier, legal entity/currency and destination requirements permit. For the first delivery, keep cross-project demand separate even when the UI groups it for comparison; company-wide consolidated POs require allocation support and are a deliberate extension.

Stock carries custody and quality status: warehouse, factory, transit, site, quarantine. Client-owned or vendor-owned goods retain ownership. Issued material is not automatically consumed; unused returns, waste and transfer are explicit. Finished output and raw stock have separate quantities.

Minimum-order/pack surplus becomes authorized surplus stock, not fictitious project consumption. Substitutions require technical approval and client approval when contractually required. A cheaper supplier cannot silently change an accepted finish. Unavailable or unknown price is not zero.

## 11. Supplier request, offer, award and order

Request header: number, revision, buyer, supplier recipients, deadline, destination, requested delivery window and currency expectations. Lines: source requirement, specification/revision, quantity/unit, acceptable alternatives, supplied/included scope and attachments. Keep internal budget and competitor offers private.

Supplier submits line prices, available quantity, unit/pack basis, currency, taxes, freight, installation inclusions, lead time/promise, payment terms, validity, exclusions and evidence. Permit no-bid and partial quotation. Revise an offer by preserving previous submissions. Staff may record a WhatsApp/email/PDF offer with attribution and original evidence.

Compare comparable scope and landed cost, not only the lowest displayed rate. Flag missing freight/tax, different units, substitutions, short quantities, payment advances and late promises. Approve exceptions explicitly. Award may split a line across suppliers, but all awards together cannot exceed approved demand except a recorded surplus/allowance decision.

Use a purchase-order header with line items. Approval commits the agreed quantity, rate, destination, promised date and terms. Supplier acknowledgement references the issued revision. Separate states for commercial approval, supplier response and physical fulfilment; one enormous status list will become ambiguous.

Order amendments preserve the original and state changed price, quantity/date and consequences. Short-close an unneeded remainder with reason and authority without deleting receipts or bills. Supplier cancellation, no-response, expired offers and reselection produce actions and forecasts. An external manufacturer can report progress, but its statement does not certify our QC or site receipt.

For service/subcontract orders, record measurable scope, milestones or daywork rates and material responsibility. Certify performed service before normal billing. Do not invent a goods receipt for painting labour.

## 12. Delivery, receiving and quality

Separate shipment, arrival, inspection and acceptance. Each delivery line identifies order/output source, item, destination, quantity/unit, batch/piece when relevant and receiving person. One vehicle can carry many project deliveries; manifests do not merge project ownership.

At receipt record delivered, accepted, rejected and pending-inspection quantities. For the inspected delivery quantity, accepted + rejected + pending equals delivered; missing/not-delivered remains outstanding. Quarantined material cannot make a task ready. Partial vehicle unloading/receiving creates separate receipt events against the shipment remainder.

Factory QC, incoming QC, installed-work QC and commissioning reuse the same inspection concept with stage-specific checklists. Checks record scope, inspected quantity, outcome, evidence, inspector and revision. A sample inspection needs a declared sampling policy; never extrapolate arbitrary sample results without that rule. Critical defects hold the affected units or work; unaffected accepted units may continue.

Defect disposition: repair in place, return/rework, replace, scrap, or authorized acceptance with concession. Link responsible party, due date, cost responsibility and follow-up inspection. Reinspection closes the defect; a separate movement records a return or replacement. A supplier credit is a financial event, not a physical return.

Dispatch requires eligible QC-released output, destination readiness, delivery booking, protected packaging and necessary documents. Packaging may contain components of one item or several items; use a packing list when a wardrobe arrives disassembled. Arrival does not mean installation-ready if parts are missing.

For bought goods, tie installation eligibility to the same accepted receipt allocation used by purchasing. For an assembly needing two hinges and one door per unit, compute installable quantity from the approved component requirement and available accepted components; do not simply take the minimum of incomparable quantities. Current direct factory/site handoff requires the same unit; broader conversions need an explicit allocation contract.

## 13. On-site construction and installation

A site task identifies room/zone, item or scope, measurable quantity/unit, owner/crew, drawings, predecessor work and required materials/tools. Readiness includes measurements, applicable permits/access, storage, preceding trades, utilities and safety/inspection holds where relevant. Requirements are configurable by project and trade, not universal mandatory fields.

Examples: waterproofing inspection before covering; drying time before another coat; first-fix electrical readiness before closing joinery; finished floor protection before installation. Area-specific readiness prevents one unfinished room from blocking every other room.

Site lead receives exact items, reports missing/damaged pieces and assigns eligible work. Approved installation output cannot exceed accepted available supply for that work. Construction tasks such as painting are controlled by approved measured area and material readiness, not a fictional factory receipt.

Use one material responsibility decision per component/service to avoid buying included subcontract materials or paying internal labour again for a supplier-installed item. Attendance remains attendance; approved time allocation contributes cost only according to the employment/subcontract arrangement.

## 14. Daily progress with little typing

The assigned person's Today view is prefilled from confirmed work. Enter quantity completed this shift, hours where needed, blocker, a photo when required and tomorrow's remaining plan. One report can include several task rows; the user should not re-enter project, room, drawing and item for every row.

Daily output is incremental: 2 yesterday + 3 today = 5. Display “Today” and “Total so far” together to prevent accidental cumulative entry. Service tasks may use approved checklist/milestone completion instead of invented numeric units. Zero-output days are valid with an explanation; future actual progress is not.

Submission → reviewer approves or returns → progress recalculates → optional client publication. Reporting approval, physical QC, client publication and client acceptance are separate events even when one compact screen coordinates them. A failed QC cannot remain dispatchable merely because a report was approved.

Corrections reference and replace the earlier contribution. If a correction would make already dispatched/installed/billed quantities exceed valid output, route it through reconciliation with affected records; never silently produce negative stock or erase history. Keep photo timestamps/source where available, but a photo is not automatic evidence of exact quantity.

For one factory run across projects, capture time once and allocate it across run lines. Require allocations to reconcile to the reported total. For subcontract labour included in a fixed order, retain attendance and output without generating duplicate wage cost.

Client publication contains selected photos, plain-language summary, approved progress and revised forecast context. Internal workforce, safety incident detail, negotiations and cost stay private unless explicitly appropriate to the viewer. A text-only update should be possible under the agreed evidence policy; current implementation requires an attachment to publish a daily report, which needs a product decision.

## 15. Money and invoices

### Client commercial value and operational cost

Keep accepted selling value plus approved variations separate from the approved cost budget. A cost budget groups item/work group and cost category: materials, internal labour, subcontract/factory, logistics, equipment and approved overhead/contingency. Preserve original and revised budgets; reallocations record the authority and reason.

Show baseline budget, approved changes, current budget, pending commitments, approved commitments, recognized actual cost, remaining committed exposure, uncommitted forecast, forecast final cost, variance and cash paid. Apply one documented tax/currency/cost-recognition basis; nonrecoverable tax, freight, inventory valuation and labour recognition must be agreed with finance. Unknown costs keep a visible completeness warning.

Recommended operational forecast on a consistent basis:

`Forecast final cost = recognized actual cost + remaining cost under existing commitments + forecast uncommitted work`.

Remaining commitment excludes amounts already recognized as actual and cancelled/credited obligations as applicable. Example excluding tax: PO 1,000, recognized linked bill 400, remaining order exposure 600, other uncommitted work 200 → forecast 1,200, not 1,600. Payment of the 400 changes cash, not cost a second time. Received-not-invoiced exposure must stay visible according to the agreed recognition policy.

Every amount opens its source allocation. Cost overruns do not automatically increase the client contract. A variation can change revenue, cost, schedule or all three, and each approval has an explicit meaning.

### Supplier bills and advances

Capture supplier invoice identity, legal entity, date/due date, currency, order lines, quantity, rates, tax, other charges and document evidence. Match normal goods billing to the order and accepted unbilled receipts. Services match approved valuations/milestones/time according to their contract. Differences enter an exception queue; receiving staff cannot silently change the approved rate.

Support partial bills, one bill covering multiple order lines, multiple payments and credit notes. Prevent duplicate supplier invoice identity across the legal entity using stable vendor identity and controlled number normalization; flag suspected duplicates rather than relying on supplier names. Payments may settle several bills and bills may receive several payments; use allocations, not a globally unique payment reference that prevents legitimate splits.

An agreed supplier advance is a separate authorized payment request/advance balance. It may precede receipt and must not be forced through a received-goods invoice or recognized as completed work. Apply/recover it against later bills according to the contract and accounting provider. Returns after billing need linked credits or a disputed payable state; they cannot rewrite an approved bill.

### Client invoice generation

Choose contract billing basis: payment milestones, approved quantities/progress, or another explicitly configured basis such as time/materials. Initial implementation should support the actual pilot's basis fully before claiming all methods. A client advance is not earned installation progress. Retention and stored-material billing apply only if the contract supports them.

For a milestone: show evidence that its trigger is met → finance reviews the invoice request → create or link the accounting invoice → retain provider ID/number and document → issue/share through the approved channel → reconcile payments and balance. Do not generate the whole contract amount on every milestone.

For progress billing: approved valuation of eligible quantities or milestones → deduct previously billed eligible value and apply agreed advance recovery/retention → reviewed invoice request. Do not bill procurement, fabrication and installation as three copies of the same contract value. Define stage value allocation where the agreement bills those stages separately.

One accounting provider per legal entity is the proposed ownership rule. Wodana owns operational evidence and requests; the provider owns posted accounting documents and payments. Use the existing QuickBooks/Zoho capability surface, but verify each supported create/update/credit action with its provider before implementation. Manual verified records need explicit source labels and evidence; they do not pretend to be provider-synced records.

Creation needs durable request identity, recoverable unknown outcomes, customer/company/currency matching and reconciliation before retrying. “Request timed out” must not trigger a second invoice blindly. Draft editing follows provider capabilities; issued/posted corrections follow controlled amendment or credit/replacement, not silent overwrites. Track connection failure, last successful sync and outstanding error. Provider payment reversals reopen the relevant finance issue and assess future release gates without pretending completed physical work can be undone.

Current code's one-invoice/one-milestone rule can be retained for the first supported billing flow. Combined invoices or split invoices require deliberate line/milestone allocations with amounts that reconcile, not an ad hoc override.

## 16. People and authority

One person may cover several roles in a small company. Assign responsibility to named people, but keep permissions and required independent decisions explicit. Existing independent-review controls must not be weakened by role consolidation. Delegation includes effective dates and history.

| Role | Owns | Hands off when |
| --- | --- | --- |
| Sales/account manager | Client commitments, requirements, commercial communication | Accepted scope and client expectations are recorded |
| Designer/technical lead | Revisioned design, selections and technical answers | Applicable versions are approved for the intended work |
| Surveyor/estimator | Measurement, BOQ basis, material takeoff and estimate | Quantities/specifications are checked |
| Project manager | Item plan, accountability, dependencies, target/forecast and recovery | Work is ready for the assigned team; exceptions have owners |
| Buyer | RFQs, comparison, orders, supplier dates and expediting | Supply is acknowledged and receiving knows what is due |
| Factory planner | Operation sequence, work centers, crews and batches | A capacity-backed daily plan is confirmed |
| Team lead/operator | Assigned work, actual time/output and blockers | Evidence is submitted for review |
| Storekeeper/receiver | Custody, receipts, quarantine, issues and returns | Accepted material/output is available to the correct work |
| Quality reviewer | Inspections, dispositions and verification | A defined quantity/work scope is released or rejected |
| Logistics coordinator | Delivery booking, packing/manifest and transport | Site receiver has the exact shipment and documents |
| Site manager | Area readiness, installation plan and site progress | Work is ready for inspection or sectional handover |
| Finance/commercial approver | Budget authority, bill matching, invoice requests and payment evidence | Financial decision is recorded and reconciled |
| Client approver | Published design/variation/quotation/handover decisions within authority | Exact version and decision are recorded |
| Supplier/subcontractor | Own offer, promise, progress and delivery/bill submissions | Our assigned reviewer validates the submission |

Each handoff needs source record, receiving owner, due date and acknowledgement/action state. An action cannot disappear because its previous owner was deactivated; reassignment becomes visible.

## 17. Global task board and connected events

Two record classes appear on one work surface: planned execution tasks and actions arising from source records. Examples of the latter are Review supplier offer, Resolve damaged delivery, Approve drawing and Verify invoice discrepancy. Do not create editable clones of those source statuses.

Board row identity is workspace + project + source type + source ID + action type/revision. A new source revision can reopen a decision; an unchanged refresh cannot create another task. Finished actions remain in history. Comments and attachments are attached to their authoritative record and surfaced in the board inspector.

Columns: To do, Working, Waiting, Review, Done. Readiness, overdue and on hold are explicit flags/details. Source-specific action buttons control transitions; a review card cannot be marked done without making its underlying decision. Planning/design work is not blocked by an execution-only release rule.

| Event | Canonical change | Connected effect |
| --- | --- | --- |
| Accepted scope released | Execution baseline and item links | PM planning actions appear once |
| Requirement shortage | Material demand projection | Buying queue shows need and consuming work |
| Supplier offer submitted | Offer revision | Buyer review action; no automatic award |
| Supplier ETA changes | Supplier update/promise review | Affected dependencies flagged; PM recovery/client-update action |
| Accepted material receipt | Receipt/stock movement | Related readiness recalculated; bill-match quantity available |
| Daily report approved | Reviewed output | Work progress changes; QC action if required |
| QC passes | Eligible quantity released | Dispatch/next operation readiness changes |
| Site receives shipment | Exact receipt allocation | Installation entitlement updates |
| Defect raised | Linked quality issue | One correction action with owner and due date |
| Bill/invoice mismatch | Financial exception | Finance action; relevant payment/release warning |
| Client change accepted | Controlled variation | Affected scope/plan/budget amendment tasks |

Use reliable saved events/outbox processing for projections and notifications. Updates in the board, item and portal should show the same source revision; handle delay/failure with a refresh state. Permission filtering applies before counts, search and pagination. A global page must not fetch every project's private JSON into the browser.

## 18. Client portal, supplier portal and WhatsApp

Client home answers: what needs my decision, what is happening in each room, next delivery/handover, what has changed, and payments needing attention. Suggested views: Home, Progress, Approvals/Documents, Payments and Requests. A published room/item row contains plain status, selected photos, last update and current communicated forecast. It never exposes purchase rates, margins, other clients, internal employee details or private negotiations.

A delay has internal cause, affected items, previous date, proposed forecast, recovery owner and next update date. PM confirms the client-facing explanation. Existing computed late alerts may remain visible according to the visibility policy; distinguish an operational risk from an approved revised promise. “Supplier late” does not automatically mean the whole project is late if float or alternate work absorbs it. Do not conceal an affected published commitment while waiting for polished wording.

Client decisions bind to exact versions and designated approver authority. A reply/comment or message delivery is not acceptance. Unpublish/revoke must apply to attachment access as well as the screen; immutable sent snapshots and retained audit records need explicit access rules.

Supplier portal exposes only that supplier's request/order, relevant approved documents, submission forms and their history. It should support offer/availability, acknowledgement, promised-date updates, shipment notification and bill/evidence submission as implemented. It cannot accept our goods receipt, approve its own bill or inspect competitors' offers. Revoked/expired links show a clear renewal path. A token link demonstrates possession, not necessarily identity of a named signer; stronger confirmation is needed where the business requires named authority.

WhatsApp/email are communication channels. Attach incoming messages/files to the relevant item/order/request with sender, time and message reference when available. If the sender has several projects/orders, ask the staff member to match the context rather than guessing. Manual capture labels who recorded it and preserves evidence. Extraction can prefill an offer or change request, but cannot award, alter drawings or release work without review.

Record prepared, sent, delivered and responded only when actually observed from the channel. Current WhatsApp link only opens a composed message. Local pilot uses local staff/client/supplier sessions and fixtures; no external invitations or supplier messages are needed.

## 19. Field and column contract

All records additionally carry stable ID, workspace, creator/updater timestamps, version, source links and appropriate audit evidence. Fields below are conditional: required to commit/perform an action, not all required to save a draft.

| Record | Default visible fields | Detail fields needed for correctness |
| --- | --- | --- |
| Project | Client/project, PM, next action, next milestone, forecast, risk | Case/contract/legal entity/currency, baseline dates, role assignments, hold reason, calendars |
| Item | Room, item, qty/unit, supply/work route, owner, needed date, progress, next action | Quote/source allocation, specifications/revisions, delivery qty basis, inclusions, costs and acceptance criteria |
| Work group | Name, coordinator, date, completion/blockers | Member item allocations, dependency/release scope |
| Batch/run | Reference, compatible item/operation, quantity, team, date, state | Per-project/item/room allocation, specification revision, pieces, time/cost allocation, rework lineage |
| Task | Title, item, owner/team, dates, quantity progress, readiness | Operation/location, predecessors and lags, resource constraints, estimated effort, drawing, QC policy |
| Material need | Material/spec, required/unit, available, incoming, shortage, needed date | Recipe/version, allowance, pack conversion, ownership, allocations, substitutions |
| RFQ/offer line | Item/spec, requested/offered quantity, price/unit, promised date, status | Currency, tax/freight, validity, minimum/multiple, exclusions, alternative and evidence |
| Order line | Supplier, reference, item, ordered/outstanding, promise/ETA, state | Approved revision, rate/currency/charges, destinations, demand/cost allocations, payment terms |
| Delivery/receipt | Reference, source, destination, due/actual, quantities, receiver | Shipment remainder, package/piece IDs, inspection/quarantine, evidence, custody and returns |
| Inspection | Item/batch, stage, inspected/pass/fail/pending, inspector | Checklist/version, measurements/tolerances, photos, concession, defect and reinspection |
| Daily update | Date, team/location, task, today quantity, blocker, next action | Hours/time allocations, evidence, reviewer, correction link and publication selection |
| Budget row | Item/category, approved budget, actual, open commitment, forecast, variance | Source allocations, revision authority, currency/tax basis, contingency and completeness |
| Supplier bill | Supplier/number, PO, amount, matched/exception, due, balance | Line receipt/service allocations, tax/charges, advances, credits, external accounting identity |
| Client invoice | Number, milestone/valuation, amount, due, status, balance | Contract/version, prior billed value, tax, retention/advance recovery, provider sync and payment allocations |
| Change | Affected items, reason, owner, status, cost/time impact | Initiator, evidence, approvals, bought/made/installed quantities and disposition |
| Handover | Room/items, date, approver, accepted/outstanding | Quantity coverage, documents, defects allowed by agreement, warranty and retained finance obligations |

Allow optional typed custom fields scoped to a record type and role. They may add information; they cannot replace canonical quantity, money, ownership, approval or status rules. Units, money and dates use shared typed controls. Required-at-action validation explains exactly what is missing.

## 20. Edge cases that must be designed before release

| Case | Required behavior |
| --- | --- |
| Quote revised during acceptance | Exactly one effective decision/version; other action refreshes |
| Optional lines not accepted | Excluded from execution and billing scope |
| Lump-sum room versus individual items | Explicit scope/value allocations; no duplicate contract amount |
| Selling and production units differ | Reviewed conversion/measurement basis; no guessed multiplication |
| Same named item in two rooms | Stable identity keeps dimensions and destination separate |
| Design revised after materials bought | Affected work held/reviewed; obsolete stock and cost disposition retained |
| Client changes already-made item | Controlled variation plus reuse/rework/scrap decision |
| Factory route changed to subcontract | Cancel/amend remaining commitments and bookings; retain performed work |
| Supplier includes material and installation | Component responsibility prevents duplicate purchase and labour cost |
| Client material delayed or damaged | Client-supply issue and forecast; no fabricated PO |
| Supplier quotes a different pack/unit | Normalize through approved conversion before comparison |
| Minimum order creates surplus | Explicit surplus authorization and stock ownership |
| Split award to two suppliers | Award totals reconcile to requirement; no double commitment |
| Supplier proposes substitute | Technical/client decision as applicable; old spec remains until approved |
| RFQ specification changes after responses | New revision and impacted-offer reconfirmation |
| Order cancelled after partial receipt | Close/amend remainder; receipts and payable obligations preserved |
| One order/bill covers multiple items | Quantity and amount allocations reconcile to document total |
| Advance before delivery | Authorized advance; no fake receipt or completed-work claim |
| Received quantity partly uninspected | Pending/quarantine excluded from usable supply |
| Received item has missing parts | Incomplete assembly cannot unlock installation |
| Full rejection | Zero accepted is valid; replacement/return tracked explicitly |
| Return after invoice approval | Credit/dispute linked to bill; approved bill not silently edited |
| Shipment arrives over several days | Separate receipt events against the same outstanding shipment |
| Partial manufacturing QC | Only released units eligible for dispatch; failed units stay held |
| Factory done but site unavailable | Finished stock/custody retained; dispatch booking revised |
| Shared crew across projects | One occupancy reservation with project allocation or nonoverlapping bookings |
| Crew member also individually booked | Member-level collision rejected |
| Machine breaks or worker absent | Replan remaining work and affected promises; preserve actuals |
| Wet trade needs curing | Calendar-aware elapsed dependency; not productive labour hours |
| Daily total mistakenly entered as today's output | UI shows incremental basis and validates against remainder |
| Correct report after delivery or billing | Reconciliation workflow protects downstream quantity/value integrity |
| Rework on an installed item | Separate correction effort/cost, no second sold-unit completion |
| One payment settles several bills | Payment allocations sum once; reference reuse is not mistaken for duplication |
| Provider create timed out | Reconcile prior request before retry; no duplicate invoice |
| Posted invoice changes externally | Refresh, mismatch/dispute handling and controlled correction |
| Payment reversed | Finance state reopens; future gated work reviewed; history preserved |
| Cost overrun without client variation | Forecast/margin changes, client value stays unchanged |
| Partial room handover | Exact item/quantity coverage and outstanding obligations |
| Handover with agreed retention | Operational completion separate from financial settlement |
| Message could refer to multiple orders | Explicit context matching, no automatic guess |
| Supplier/client link forwarded or expired | Scope-bound access, expiry/revocation and authority checks |
| Owner deactivated | Open work reassigned visibly, audit retained |
| Repeated/parallel submit or offline retry | Stable request identity, version check and recoverable conflict |
| Another project's record ID in request | Server rejects cross-project/workspace relationship |
| Attachment hidden in UI but URL retained | Download authorization enforces current visibility |
| Custom field suggests readiness | Cannot bypass canonical release/inspection checks |

This is the initial acceptance register, not a claim that every business exception has been discovered. Each pilot walkthrough adds concrete cases and resolves policy ambiguities before expanding scope.

## 21. Implementation sequence after plan agreement

Do not start by adding Factory, Buying and global boards separately. Build and verify a thin item journey across the existing owners, then expand routes and aggregation.

| Slice | Contract to settle first | Reviewable deliverable and exit test |
| --- | --- | --- |
| 0. Blueprint review | Terms, route matrix, identity/allocation model, billing basis and roles | Walk three representative item stories on paper, including partial failure and money; no code |
| 1. Accepted scope and item plan | Quote-line mapping, working/released quantities, defaults, draft/commit validation | Local accepted quote opens linked items; split/group without duplicate scope; costs remain distinct |
| 2. One purchased-and-installed item | Multi-line-ready order/receipt allocation, QC and service links | Demand → offer → approved order → partial receipt/QC → install → accepted work; linked bill and client milestone |
| 3. Own factory and daily work | Operations, batch quantities, QC eligibility, crew/resource constraints | Material issue → planned batch → daily output → partial QC → dispatch → exact site receipt; failed units recover correctly |
| 4. Site construction and subcontracting | Site route, material responsibility, measured/service acceptance | Painting/tiling example with area dependencies, included labour/materials and no factory requirement |
| 5. Cross-project scheduling and work | Shared-run allocation, occupancy, source-derived actions | Three local fixture projects share one crew without collisions or duplicate cost; global/project views agree |
| 6. Financial depth | Budget allocation, bill matching/advances/credits, provider invoice lifecycle | Explained actual/commitment/forecast totals; partial bills; retry-safe invoice request; refund/reversal scenarios |
| 7. Client and supplier continuity | Publication, source authority, communication status and link access | Role-specific walkthrough through offer, delay, client update, approved change and handover |
| 8. Operational acceptance | Persistence, failure recovery, permission and usability criteria | Reload-safe flow; narrow/desktop/keyboard/RTL; concurrent edit, partial delivery and rework tests |

Portal visibility and financial links are checked in every relevant slice; slices 6–7 deepen those flows, not defer all finance/privacy until the end. Use existing domain/service owners and extend their tests. Before architectural changes, inventory all affected routes and migrate old shape through compatibility adapters; do not reset existing data.

Local pilot means one main local project plus explicitly synthetic local companion projects when testing shared factory capacity. No live client/supplier invitations, payment creation or production enablement. Accounting behavior can use adapter fixtures initially; actual provider integration is reported unverified until a separately authorized sandbox test.

## 22. Decisions for the design review

Recommended defaults are enough to create a reviewable specification. Resolve these business facts before their dependent implementation; do not ask the user to design the whole system.

| Decision | Proposed starting point |
| --- | --- |
| Initial owner/payment gate | Separate design engagement authorization from execution release; confirm actual contract practice |
| Grouping | Room/item first; work groups and batches optional |
| Factory detail | Named crews and operation estimates initially; machines where genuinely constraining |
| Cross-project runs | Shared operation allocation only for compatible work; otherwise sequential project batches |
| Supply policy | Who supplies and where work happens are independent |
| QC | Independent review according to existing controls; stage-specific checklist and quantity release |
| Finance ownership | One active accounting authority per legal entity; Wodana requests and reconciles |
| Client billing | Implement pilot's actual milestone/progress agreement; no invented deposit percentages |
| Client updates | Reviewed summary and selected evidence; visible commitment risks; separate published forecast and contractual promise |
| Supplier communication | Secure source-bound link plus attributed manual capture; external delivery only when actually integrated |
| Customization | Saved columns/views and typed optional fields; fixed integrity rules |

The next planning review should use one wardrobe, one purchased item and one on-site construction item, tracing every record, quantity, owner, date, cost and client-visible event through both normal delivery and one failure. Approval of the overall blueprint is not automatic authorization for deployment or external transactions.

## 23. Separate modules and ownership boundaries

These classifications refine the interface in section 4. A module has its own queue and permissions but connects through the same item/order/task identities. Small modules do not imply separate services or databases.

| Module or tab | Owns authoritative records | Surfaces elsewhere |
| --- | --- | --- |
| Planning | Requirements, specifications, drawings, client quotation, agreement and exact decisions | Item source evidence, procurement specification, portal approvals |
| Items & work | Delivery allocations, work groups, execution tasks and dependencies | Global task board, factory/site views, item progress |
| Schedule & resources | Calendars, crew membership, resource constraints and bookings | Task timeline, factory run, installation appointment |
| Procurement | Demand sourcing, RFQs, offers, purchase/subcontract orders and supplier promises | Item supply state, budget commitments, supplier portal |
| Stock & receiving | Locations/custody, accepted receipt, quarantine, allocation, issue, return and transfer | Procurement receipt, factory input/output, site availability |
| Factory | Work centers, operation plans, production runs and allocated output | Project item, daily plan, QC and logistics |
| Quality & handover | Inspection results, defects, commissioning and acceptance packages | Source operation, receipt, client acceptance and aftercare |
| Deliveries | Packing lists, shipment allocations and receiving appointments | Factory dispatch, supplier shipment, site receipt |
| Updates & communication | Progress-report review, publication selection and source-bound messages | Client portal, team history and next actions |
| Financials | Cost budget/forecast and approved invoice requests; links to accounting authority | Item cost, procurement bill matching, client payments |
| Aftercare | Installed-item coverage, claim assessment, service appointments and resolution | Client requests, global work, supplier recovery and cost |
| Global task board | Work views, ranking, saved filters and permitted action routing | No second source of physical, approval or finance truth |

Stock & receiving and Deliveries may initially be subviews of Procurement/Factory rather than top-level navigation. Give them separate workspace destinations only when a storekeeper/logistics role has enough daily work to justify it. Quality & handover deserves a project tab because independent review and acceptance are recurring responsibilities. Aftercare deserves a module because claims continue across completed projects.

## 24. Task board capability contract

“Jira-level” is a quality and capability target, not a claim of full Jira product parity. The board needs powerful organization without becoming an alternate ERP. Research confirms distinct concepts for columns/status mappings, column limits, swimlanes, ranking permissions and workflow validators. Our proposed behavior below adapts those concepts to project delivery. References: [Atlassian columns and constraints](https://support.atlassian.com/jira-software-cloud/docs/configure-columns/), [swimlanes](https://support.atlassian.com/jira-software-cloud/docs/configure-swimlanes/), [ranking](https://support.atlassian.com/jira-software-cloud/docs/rank-an-issue/) and [workflow validators](https://support.atlassian.com/jira-cloud-administration/docs/configure-advanced-issue-workflows/).

| Capability | Required product behavior |
| --- | --- |
| Identity and direct links | Stable human reference plus internal ID; every action/card opens the same source record |
| Hierarchy | Optional work group → task → subtask; item/batch are explicit linked delivery context, not arbitrarily nested cards |
| Work types | Execution task, coordination task, decision/review, defect, delivery action, procurement action and service claim; source-controlled types retain their domain lifecycle |
| Intake/backlog | Unscheduled coordination work and unplanned execution demand remain visible with owner/triage; ready work distinguished from merely requested work |
| Views | Board, list, timeline, calendar, workload; saved personal and shared views; project and global scopes |
| Filters/search | Project/client, room/item, work group/batch, owner/assignee/team, type, location, priority, date, blocker, supplier where permitted and custom typed fields |
| Grouping/swimlanes | Project, work group, owner/team, factory center, due period; counts reflect the current authorized filter |
| Ranking | Manual order within a defined queue; distinct from priority and dates. Shared queue rank is consistent across views; personal sorting does not change factory dispatch priority |
| Columns | Configurable labels and allowed status mappings. Default To do/Working/Waiting/Review/Done. Source approval rules cannot be removed through board settings |
| Work-in-progress limits | Warn on excessive active work by team/queue; optionally require an authorized exception. A WIP card count is not a machine/crew booking capacity calculation |
| Quick capture | Create a coordination task with title and project/context; draft permits unknown fields. Starting execution requires quantity/readiness/assignment as applicable |
| Assignment | Accountable owner, assigned people/team, reviewer and watchers are distinct. Reassignment records history and prompts resolution of conflicting bookings |
| Dates and estimates | Start/due, original dates, forecast, estimated effort and remaining effort; preserve quantity/unit separately from hours |
| Dependencies | Blocks/blocked by and related links; reject cycles; quantity/area prerequisites and elapsed waits where relevant; show effect of rescheduling |
| Subtasks and checklists | Subtasks can own schedule/quantity/review; checklists guide a task but cannot silently substitute for required inspection or approval |
| Bulk actions | Assign, set compatible dates/labels, group, propose reschedule, report selected rows. Preview impacted records and per-row errors; never bulk-approve unrelated financial/quality decisions casually |
| Drag and keyboard | Drag reorders or requests a valid transition; keyboard/menu equivalent. Invalid movement explains the missing evidence; confirmed state updates after server success |
| Detail inspector | Description, linked sources, quantities, dates, people, checklist, comments/files and history; expandable to full page with stable URL |
| Collaboration | Rich comments, mentions, replies, watchers and attachments; explicit internal versus client/supplier visibility. Mentions never grant access |
| Time and output | Log time and quantity at the task/run; report once, allocate once. Distinguish estimated effort, logged time, reviewed output and QC release |
| Templates and recurrence | Versioned work templates; preview before creation; repeatable inspections/service visits create new occurrences, not overwritten history |
| Custom fields | Typed, scoped, permission-aware, filterable fields with defaults/validation; shared definitions avoid near-duplicate columns |
| Workflow configuration | Versioned transition schemes per work type; required fields, permission checks and reasons; migration preview for existing work |
| Automation | Trigger/condition/action with explicit rule owner, preview, audit, deduplication and failure queue; reminders/escalations/assignment suggestions cannot bypass release or spending rules |
| Notifications | Per-role inbox, digests, mentions and overdue escalation; no alert per every tiny source refresh; respect visibility and user preferences |
| Reports | Aging, blocked time, overdue actions, review turnaround, throughput and on-time delivery; quantity productivity only across comparable units/operations |
| Import/export | Column mapping, validation, duplicate/source matching and preview; export respects permissions. Imported completion cannot forge inspected physical output |
| Archive/reopen | Preserve audit and source links. Reopen a coordination task normally; physical/financial source corrections require the source workflow |
| Performance | Server pagination and windowed rendering; filter/count consistency; no entire-workspace payload download; performance tested with representative large fixtures |
| Reliability | Concurrent-edit recovery, stable request identities, draft preservation, accessible loading/errors and reconnect state |
| Accessibility | Keyboard and screen-reader flows, clear focus, RTL, narrow screens, reduced motion and status meaning beyond color |

Backlog and weekly planning are required; Scrum sprint/release mechanics can be an optional preset if a team actually uses them. Software-specific repositories, commits and deployment controls do not belong in this project delivery module. Advanced administrator customization follows the same source integrity rules as the default board.

Implementation sequence for the board: (1) shared identity/inspector, filters, list/board, assignments, comments/history and guarded actions; (2) timeline/workload, dependencies, bulk edits, ranking and saved shared views; (3) workflow/custom-field administration, safe automation, recurrence and analytics. The detailed capability list remains the target; it should not be represented as delivered by completing only stage 1.

## 25. Handover and the installed item record

An installed item record connects delivered scope to its ongoing service identity. Reuse the delivery item and append installation/coverage facts rather than making the client enter the asset again. Capture serial/model where available, room/location, installed date, commissioning result, supplier/manufacturer, applicable warranty documents, maintenance instructions and accepted handover reference.

Handover is prepared for exact room/work-group/item quantities. Confirm installation and required inspections, commissioning, manuals/as-built drawings, keys/accessories, care instructions and training where applicable. Disclose any agreed nonblocking outstanding items with owner and date. Blocking defects prevent acceptance. Freeze the offered package so a later file revision cannot silently change what the client accepted.

The client reviews and accepts or requests corrections. Record decision authority, date, package version and evidence. Physical handover, client acceptance, final invoice, retention release, warranty expiry and project archive are distinct milestones. A balance or retention may remain after valid physical handover according to the agreement.

For partial room handover, coverage begins only for the accepted scope according to its contract. Do not start every item's warranty from the first room's handover or from one global project-completion date. An outstanding snag remains an outstanding contractual obligation; relabeling it warranty does not erase its original due date or commercial effect.

Existing `project-handover.ts` has area/package-derived frozen packs, client decisions and owned outstanding items. Existing `project-warranty.ts` links claims to accepted handover and an end date. Item-specific multiple coverage types, service appointment lifecycle and coverage assessment need extension; these are not established by the current single `warrantyUntil` field.

## 26. Warranty and aftercare

The client should be able to open the installed item or room and choose Report a problem. Prefill the project, location, item and acceptance record. Ask for description, photos if available, urgency and access preferences. Allow Unknown item for triage rather than requiring technical knowledge.

Claim flow: Received → Assess → Awaiting information/parts/appointment → Scheduled → Work in progress → Ready for verification → Resolved/Closed. Reopen preserves the previous visit and resolution. Store coverage outcome separately: pending assessment, covered, supplier/manufacturer responsibility, goodwill, chargeable or declined with reason. Receiving a claim is not an admission of liability.

Coverage may include our workmanship, manufacturer product warranty and purchased maintenance contract, each with provider, scope, start/end and supporting terms. Do not invent warranty durations or assume repair resets coverage. Supplier coverage may start before client handover; show the gap as our internal exposure. Resolve the actual contract terms when setting these policies.

Assign one service coordinator, accountable technician/subcontractor, due response and next action. Suggest an appointment with duration, required skills/parts and access. Client confirmation and team confirmation are separate. A visit can be rescheduled, unsuccessful due to no access, require diagnosis or lead to another visit. Book service crews through the same capacity engine as project work.

Parts follow the same stock/buying/receipt rules. A replacement retains old/new serial or item identity, removal/return/disposal evidence and applicable coverage. Record actual time, parts, transport and any supplier recovery once. Customer goodwill repair and recovery from a supplier can proceed on separate tracks.

Expired or uncertain coverage should still permit a general service request and manual assessment. Current warranty-specific endpoint rejects expired coverage; the new intake should route such requests to assessment/chargeable service without pretending they qualify automatically. If chargeable, obtain approval of the service estimate before committing the applicable work, except an explicitly authorized emergency policy. Changes in price/scope require renewed approval.

Verification records the actual repair and functional check. Notify the client through approved channels and record feedback/confirmation according to the service policy. A client who does not respond is not silently recorded as having accepted the repair; administrative closure, if allowed, identifies its reason and remaining obligations.

Recurring maintenance plans create scheduled service occurrences, optional renewal quotes and reminders. Expiring warranty does not erase open claims. Preserve reported date and policy assessment where the repair occurs after expiry. Archived projects remain linked to aftercare with restricted access and a designated owner.

This pattern is informed by [Buildertrend warranty management](https://buildertrend.com/help-article/warranty-overview/), which supports claims, responsible parties and appointments. The coverage, costing and source-link rules here are proposed Wodana behavior, not claims about every competitor's implementation.

Additional aftercare fields: installed item ID, claim source, reported/event dates, severity, coverage decision/evidence, coordinator, service provider, response target, appointment window, access confirmation, parts and costs, visit outcome, replacement lineage, client-facing update and closure reason.

## 27. Worked scenarios and reconciliation

### Scenario A: ten wardrobes across three client projects

These numbers test conservation of quantities; they are not production estimates or operational records.

1. Projects A, B and C allocate 4, 3 and 3 compatible wardrobes to a shared assembly run. Each retains its own room/specification/delivery allocation.
2. The planner reserves Team A once. A hypothetical estimate of four crew-hours per unit plus two hours setup totals 42 crew-hours. Work-center capacity and shifts determine dates; this estimate does not mean ten units fit in one day. Actual time is later allocated to the three projects on a reviewed basis.
3. Fabrication/assembly reports ten units ready for inspection. QC releases eight: A4, B2, C2. B1 and C1 require rework. Total remains ten; approved report quantity and QC release remain distinct.
4. Dispatch allocates those eight units to their exact sites, possibly on one multi-drop vehicle. Each site receives its own document and items.
5. A accepts three and rejects one damaged in transport. B accepts two; C accepts two. Seven are accepted at site. Installation can consume at most A3/B2/C2 until more accepted receipts exist.
6. A's transport defect, B's factory defect and C's factory defect have separate source locations, owners and remedies. Rework/return/replacement records preserve custody; closing the three issue cards cannot create three available units.
7. Installation, final QC and partial client acceptance cover only the seven eligible units initially. Supplier/carrier recoveries and remaining work costs remain allocated to their respective projects.

This tests shared capacity, cross-project privacy, partial QC, multi-drop logistics, transport damage, quantity entitlement, costing and partial acceptance in one story.

### Scenario B: purchased chairs with partial supply and billing

1. Project requires ten chairs; Supplier S is awarded ten at 100 each, excluding tax for this example. Approved commitment is 1,000.
2. Six arrive. Five pass; one is rejected. Usable receipt is five, remaining accepted requirement is five. The supplier's shipment assertion cannot override this.
3. A normal goods bill for six units fails matching. Finance resolves the discrepancy or receives a valid credit/corrected bill; only five accepted unbilled units are matchable under the proposed policy. Any contractual prepayment has its separate advance treatment.
4. If a bill for five is approved, actual recognized cost is 500 under a bill-based illustration; remaining approved exposure is 500. Paying the 500 does not add a second 500 cost.
5. Supplier replaces the rejected chair and supplies the four outstanding original chairs. Their accepted receipt completes ten. Replacement identity prevents treating eleven shipped attempts as eleven contracted units.
6. If the last four are cancelled, close the remaining commitment with evidence; changing the client scope separately requires its own decision. Do not silently reduce the original client requirement.

### Scenario C: on-site painting with a subcontractor

1. Accepted scope is 120 m² across two rooms. Subcontract includes labour; paint is company supplied. No factory task is generated.
2. Room 1 is ready; Room 2 waits for another trade. Schedule preparation/primer/coats and required drying time for Room 1 independently.
3. Reports capture each operation's daily measured area. Preparing 60 m² and priming 60 m² does not become 120 m² of completed finished painting; item completion follows the required finished/inspected scope.
4. The site reviewer rejects a finish patch. Rework records additional effort and cost without a second sold area. Supplier service valuation follows accepted stage quantities/rates in the subcontract.
5. The client's invoice follows the client agreement, not the subcontractor's invoice timing. Room 1 can reach partial acceptance while Room 2 remains pending.

### Scenario D: wardrobe problem after handover

1. Client selects the accepted bedroom wardrobe and reports a door alignment problem. The item already carries drawing/finish, installation, supplier and handover references.
2. Service coordinator assesses workmanship versus hardware coverage and checks the original reported date. No automatic promise of free replacement is made.
3. A technician appointment is confirmed with client and crew. If a replacement hinge is required, reserve the correct part or procure it; no whole-project reopening is needed.
4. Technician records time, part used and functional-test evidence. Independent verification or the configured service review closes the repair action, with a separate customer-feedback state.
5. If the manufacturer reimburses the part later, its recovery is linked to the same claim without reversing the repair history. Any revised coverage is an explicit recorded policy decision.

## 28. Final acceptance and delivery boundaries

Add to the acceptance register: shared-run output totals reconcile by project; partial QC cannot over-release; one card appearing on several boards is counted once per underlying action; WIP limits never substitute for capacity; automation cannot approve its own procurement/quality output; arbitrary custom fields cannot alter financial totals; expired-warranty intake routes to service assessment; partial handovers have distinct coverage dates; no-access visits do not falsely complete claims; replacement parts preserve serial/coverage lineage; completed projects support aftercare without manufacturing fresh execution scope.

After plan agreement, extend the implementation sequence with an explicit aftercare slice: installed-item identity and handover coverage → claim intake/assessment → appointment/parts → repair/review → client communication and supplier recovery. Validate it on the same local project's handed-over item. Task-board advanced capabilities have their staged contract in section 24. Do not call the complete project flow finished until these promised slices have evidence or are explicitly deferred by the user.

Final draft artifacts consist of this specification and the earlier audit record. Application source, data, module activation and deployments are unchanged by this planning work. The next action is product review of the proposed model and unresolved business policies, not development.

## 29. Action and state contract

The following matrix defines the decisive handoffs. Draft creation may happen earlier; committing the action needs its prerequisites. Existing global commercial release controls remain authoritative until any narrower activity-specific release policy is explicitly designed and approved. Planning or pricing an unreleased item does not authorize an order or production.

| Action | Actor and prerequisites | Authoritative result | Must not imply |
| --- | --- | --- | --- |
| Release accepted scope | Authorized commercial/operations roles; required exact-version approvals and payment evidence | Frozen executable scope and source-linked items | Every item's technical/material/crew readiness |
| Confirm item plan | PM; source scope, route, owner and valid quantities | Planned tasks/demand with allocation | Booked capacity or approved purchase |
| Confirm booking | Planner; authorized resources, calendar and conflict check | Reserved capacity for the time window | Work can start despite missing readiness |
| Issue RFQ | Buyer; reviewed specification and recipients | Frozen request revision and actual sharing state | Supplier received it or agreed |
| Approve order | Spend approver; valid demand, budget and terms | Cost commitment and issued revision | Physical receipt or payment |
| Record supplier acknowledgement | Supplier submission reviewed by buyer | Confirmed scope/date with attribution | Our acceptance of a changed price/specification |
| Accept goods | Authorized receiver/inspector; exact delivery evidence | Usable quantity and stock/custody allocation | Installed work or paid bill |
| Start operation | Assigned lead; released scope, technical/material/access/capacity checks | Active work | Completed output |
| Approve daily output | Independent reviewer; valid incremental evidence | Reviewed progress contribution | All required QC passed |
| Pass QC | Authorized inspector; relevant version/checklist and quantity | Defined eligible output/work | It has shipped or reached the client |
| Dispatch | Logistics/release roles; eligible quantity and destination readiness | In-transit custody with source allocation | Site receipt |
| Receive at site | Authorized receiver; arrived quantity and condition | Exact accepted/rejected/pending quantities | Installation complete |
| Accept installed work | Site/quality reviewer; eligible supply and required checks | Inspected installed quantity | Client handover or invoice payment |
| Approve supplier bill | Finance/reviewer; goods/service/advance policy and matching | Authorized payable or controlled exception | Cash paid |
| Issue client invoice | Finance; billing entitlement, identity and provider response | Linked invoice with confirmed issue state | Receipt of money or operational acceptance |
| Accept handover | Designated client approver; current package and allowed outstanding items | Accepted scope and applicable coverage start | All financial obligations settled |
| Resolve service claim | Service reviewer; assessment, completed repair and evidence | Recorded outcome and closure basis | All warranty coverage reset or customer explicitly agreed |

Quantity balances are constrained per item/unit/allocation, not across unrelated units. Financial balances are constrained per legal entity/currency/document allocation. Store and format money using currency precision rather than assuming every currency has two decimals; any foreign-currency order requires an approved conversion basis and explicit exchange variance, never summing unlike currencies into a budget.

Changes to quantities or finance after downstream activity require a reversal/correction chain with evidence. A source action creates or resolves its global work action in the same reliable event flow. Notifications occur after saved decisions and remain retryable without repeating the business action.

## 30. Review guide

For the first review, read sections 1, 4–7, 23 and 27 to assess whether the model feels natural. Review sections 8–18 and 25–26 with the people who schedule, buy, receive, install, inspect, bill and support the work. Sections 19–20, 24 and 29 are the implementation contracts and acceptance checklist. Section 3 distinguishes existing foundations from missing or restricted behavior. Sections 21–22 and 28 define sequencing and unresolved business decisions.

No fixed delivery estimate is proposed yet. Estimate each slice after its data changes, migration needs and acceptance scenarios are agreed; page count is not a reliable measure of this implementation.
