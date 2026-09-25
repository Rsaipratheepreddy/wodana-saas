# Project delivery — final UI/UX plan

22 September 2026. Final design proposal following the complete 30-section audit and research into Dzylo, Buildertrend, Procore, Jira and Odoo. This is the consolidated UX reference for subsequent local implementation. It supersedes the navigation and sequencing proposals in the shorter UX note; it preserves the business rules, data requirements and acceptance cases in the original blueprint. It does not claim those capabilities have been built.

Related: [30-section audit](project-delivery-30-point-audit-2026-09-22.md), [business blueprint](project-delivery-implementation-blueprint-2026-09-22.md), [earlier implemented UX slice](project-delivery-ux-2026-09-22.md).

## A. Design decision

**One authoritative record, several permission-scoped views.** Global modules organize work across projects. A project shows its own items and linked records. My work shows the current person's actions. Client and supplier portals show a deliberately limited published/request-specific view.

A buyer should not open twenty projects to find overdue deliveries. A project manager should not leave a project to understand its outstanding materials. Both should open the same purchase order, with the same history and permitted commands.

Keep the current Sales/CRM tables, sidebar, spacing, typography, filters, dialogs and tokens. Storybook is not the reference. Simplify which information is initially visible; do not remove required records or weaken action validation.

## B. What the market research establishes

Reviewed public official product pages/help documentation, not authenticated competitor accounts. Feature claims describe published product behavior; they do not verify proprietary internals, every edge case or an exact navigation layout. Our architecture below is a design recommendation derived from those patterns and our existing code.

| Product | Published pattern | What we adopt |
| --- | --- | --- |
| Dzylo | Consolidated dashboards and switching between concurrent projects; project tasks, finances and timelines together | Portfolio context plus an individual project workspace. [Project management](https://dzylo.ai/interior/project-management/) |
| Dzylo | Material requests feed RFQs, comparison, orders, delivery acceptance and stock | Project-originated demand with an operational purchasing queue. [Procurement](https://dzylo.ai/interior/procurement-management/) |
| Dzylo | Document versions, review states and separate internal/client feedback; a client app with progress, decisions and warranties | Make approvals and external visibility explicit. [Document review](https://dzylo.ai/engineering-architecture-drawing-review-tool/), [Client app](https://dzylo.ai/interior/client-app/) |
| Buildertrend | All Jobs task creation, My Tasks, customizable private/shared views, related schedule/daily-log records | Reusable worklists with saved context and source links. [Tasks](https://buildertrend.com/help-article/tasks-overview/) |
| Procore | Company and project tool levels; project submittals track revisions, submitters and approvers | Separate company operations from project context; technical approvals need a formal submission record. [Tool levels](https://support.procore.com/products/online/user-guide), [Submittals](https://support.procore.com/products/online/user-guide/project-level/submittals), [Revisions](https://support.procore.com/products/online/user-guide/project-level/submittals/tutorials/create-a-submittal-revision) |
| Jira | Boards can select work from multiple projects/spaces through saved filters | Global/project/team boards are views, not duplicate work records. [Board filters](https://support.atlassian.com/jira-software-cloud/docs/configure-filters/) |
| Odoo | Shop Floor supports manufacturing-order and work-center views, readiness and operator work tracking | Factory is an operations/resource workspace, with project context attached. The accessible overview was version 18; version 19 overview fetch failed. [Shop Floor](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/manufacturing/shop_floor/shop_floor_overview.html) |
| NN/G | Advanced/rare details can be revealed after the primary task is clear | Small default tables and focused record/action details. [Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) |

Do not copy competitor marketing claims about automation, delivery tracking, approvals or factory capacity into our product without implementation evidence.

## C. Global, project and personal ownership

| Record/work | Company-wide home | Project view | Personal action / external view |
| --- | --- | --- | --- |
| Delivery item | Projects portfolio/search | Project → Items | Assigned planning/follow-up; client sees published progress |
| Execution/coordination task | Tasks | Work → Tasks & timeline | My work; field Today |
| Technical approval (RFA) | Tasks → Approvals saved view | Project → Approvals | Named reviewer; client sees only assigned published requests |
| Material requirement/RFQ/order | Purchasing | Supply | Buyer queue; supplier sees own request/order |
| Stock/movement | Purchasing → Stock & receiving | Supply → Requirements & stock / Receiving & returns | Storekeeper/receiver actions |
| Factory operation/run | Factory | Work → Factory | Team/operator Today; external manufacturer sees its order only |
| Crew/machine reservation | Shared scheduling within Work/Factory | Work → Teams & capacity | Planner's conflicts and availability |
| Shipment/receipt | Purchasing receiving queue or Factory dispatch queue according to source | Supply receipt or Work → Factory → delivery record | Logistics/receiver action linked to the same record |
| QC/defect | Tasks → Inspections/defects saved views | Quality & handover | Assigned independent reviewer; approved client-facing issue summary |
| Daily report/update | Tasks → Reviews; source team's Today | Work → Site & daily work | Reporter/reviewer; approved publication in client Progress |
| Budget/bill/client invoice | Finance | Budget & payments | Finance review; client sees its issued invoices/payment status |
| Handover/installed item | Projects / Service as appropriate | Quality & handover | Designated client acceptance; installed-item support |
| Service claim/appointment | Service | Quality & handover → Aftercare | Service coordinator/technician; client support |
| Drawings/documents | Resource library for reusable masters only | Files and linked item/approval | Permission-filtered record/download |

Global lists include a Project column and an All projects scope selector. A project page pins its project scope and removes redundant Project columns. Switching to All projects is an explicit link, not a hidden filter change. Global multi-project selection must not implicitly authorize consolidated orders or shared runs before allocation support exists.

Project-scoped records retain stable IDs and source authority. Shared factory runs reserve resources once and expose only each project's allocation to project viewers. Stock can be company-owned without belonging exclusively to a project; project allocations are separate. Pure coordination tasks may have no project, but execution, spending and client decisions require the appropriate scope.

## D. Sidebar and page hierarchy

Preserve the current sidebar's visual design and existing Sales navigation. Arrange delivery destinations by role using the existing grouping pattern:

- Daily work: Home, Inbox, Tasks. Tasks includes My work, Approvals, Waiting, Overdue and saved views; do not add a separate sidebar destination for every filter.
- Business work: Sales, Projects, Purchasing, Factory, Finance, Service. New destinations appear only when their queue exists and the user has access. Typical users see only their relevant subset.
- Company: People, Resources, Connections, Settings. Supplier directory belongs in Resources; buyers can open it contextually.

Only two horizontal navigation levels inside a project: main section and sub-tab. List/board/timeline, Mine, Pending, Late and filters belong in the shared table toolbar, not a third tab row. Secondary actions belong in an action menu or record detail. No new nested sidebar inside the project.

The project header shows name/client, project switcher, back-to-origin and one compact attention summary. Original contractual date and changed communicated forecast are available together; no wall of KPI cards. The default project page is Items; Overview is optional for management reporting.

## E. Final project main tabs and sub-tabs

| Main tab | Sub-tabs | Existing destinations preserved/connected |
| --- | --- | --- |
| **Project** | Items · BOQ & designs · Approvals · Changes · Overview | Existing overview, BOQ/design query routes and source pre-project quotation/variation/design records |
| **Supply** | Requirements & stock · RFQs & offers · Orders · Receiving & returns | Material planning/warehouse, enquiries, procurement, deliveries/returns |
| **Work** | Tasks & timeline · Teams & capacity · Factory · Site & daily work | Plan/teams/calendar, production/dispatch, site work/commissioning, daily reports |
| **Quality & handover** | Inspections · Defects · Handovers · Aftercare | Existing inspection commands, snagging, handover packs; service lifecycle extended |
| **Budget & payments** | Budget & forecast · Supplier bills · Client invoices & payments | Commercial budget, invoices, accounting; retention/advances/credits inside relevant detail/views |
| **Files** | Register | Existing documents; filters for drawing/specification/as-built/manual/warranty; related transmittals and technical queries |

This is a target mapping. Do not expose placeholder tabs as working modules. While migrating, existing deep links resolve to the same records; retain view selection and back navigation. BOQ & designs can use a toolbar record-type selector, avoiding another tab tier. Aftercare appears when service access is relevant and remains available after completion. A technical query/RFI is a clarification record, distinct from RFA approval.

## F. Shared screen and interaction contract

Every operational list uses the current CRM DataGrid configuration: compact toolbar, search, saved view, filter, sort, columns, export and one appropriate primary action. Default to approximately six to eight columns; optional detail fields remain accessible. Group by room/team/project/date through a view, not duplicated tables with separate storage.

Opening a row uses the current record dialog/inspector pattern, preserves list state, and offers a stable full-page link for large documents or complex comparisons. Do not promise background table interaction while the current modal inspector traps focus. Reuse its actual keyboard/focus behavior. One action dialog at a time; avoid nested modal stacks.

Drafts accept incomplete information. Submission/approval/dispatch requires the relevant fields. An unavailable action explains the missing prerequisite and links to it. Preserve entered values on validation, network or version conflict. Show Saving/Saved/Failed, and reconcile uncertain outcomes before retrying irreversible commands. Basic reversible fields can use inline editing; decisions use a deliberate action.

State is not only a color. Show stage plus separate Blocked/Delayed flags. Missing owner/date/cost is Unassigned/Not scheduled/Not estimated. Empty state distinguishes no released scope, no matches, no permission and load failure. Unauthorized data must not be loaded and hidden with CSS.

Store per-user view preferences by workspace/module/scope; shared views have an owner and permissions. Back/refresh preserves selection/filter/sort. Server-side filtering/counts/pagination and representative-volume checks are required before global deployment; a local client-side table is only the initial UI foundation.

## G. Items and classification — the primary project journey

Default columns: **Item, Room, Quantity/unit, Route, Owner, Needed date, Progress, Next action.** Item includes a stable reference and link; progress shows approved quantity stages or a concise “2 installed / 5 required” summary only when those quantities are supported. Mixed units never share one sum. Optional: source quote/revision, dimensions, specification, baseline/forecast, team, blocker, cost and task count.

1. Released BOQ creates source-linked items. A bundled line can be allocated into deliverables through a controlled allocation editor, retaining commercial totals and delivery-unit basis.
2. **Classify** is the second step: supplier/team responsible, location, material ownership and site work. Offer the nine route scenarios from the blueprint. Ready-made skips factory; site subcontracting stays on site; client supply skips company purchasing.
3. **Assign and estimate:** responsible lead/team, required reviewer/receiver, target window, effort, materials and cost. Defaults are suggestions; capacity must be booked separately.
4. Confirm the plan after reviewing missing requirements and conflicts. Planning approval does not approve procurement or execution release.
5. Open the current action directly from the row. A mixed/partial item opens its allocation details rather than forcing the whole item into one state.

Item detail contains five sections: Summary; Work; Supply; Decisions & quality; History & files. Show route-specific content. Costs appear only with finance permissions. Within a source transaction the inspector links to the canonical RFQ/PO/inspection/approval rather than permitting an alternate status edit.

Use optional groups and batches. Basic single-item users never need to create a batch manually. Splitting 10 into 6+4 shows a live reconciliation; over-allocation blocks confirmation. A replacement/rework keeps original identity and separate effort/cost.

## H. RFA, approvals and changes

For this proposal, RFA means **request for approval**. The screenshot's RFQ remains **request for quotation**. The exact preferred label can be confirmed without losing either workflow in the design.

Project → Approvals is a source-linked register. Defaults: Reference/type, Item/room, Submission/revision, Current reviewer, Due, State, Next action. Filters: Mine, Waiting for client, Returned, Overdue, Completed. Types cover drawings/shop drawings, materials/finishes/samples, substitutions and technical submissions. Existing quotation, variation, purchase, QC and handover decisions can appear as linked decisions but retain their own authoritative commands and distinct states.

RFA detail shows submitted content on one side and decision/history on the other. Capture exact source/file revision, affected scope, submitter, designated approver, due date, required recipients and internal/client visibility. Proposed lifecycle: Draft → Submitted → In review → Approved / Return for revision / Rejected / Withdrawn. New revision retains previous evidence/decision and creates new review work. Conditional approval cannot unlock work while mandatory conditions remain unresolved. Multi-approver policy is configurable only after its required/optional/sequence rules are settled.

Approve/Return/Reject require deliberate decisions on the displayed revision. A comment or viewed message is not acceptance. Technical approval does not approve cost. Changes to already-bought/made/installed scope open an impact review showing quantity, stock, commitments, cost, dates and client effect. Project → Changes reuses the source change/variation record and prevents direct rewriting of accepted scope.

Global Tasks → Approvals is a filtered action view of this same register and other authorized decisions. Client Decisions shows only requests assigned/published to that client, with simpler wording and a clear revision/impact summary.

## I. Supply, receiving and logistics

| Sub-tab / view | Default columns | Primary journey |
| --- | --- | --- |
| Requirements & stock | Material, For item/room, Required, Available, Incoming, Shortage, Need by, Owner | Review demand → reserve/transfer or request quotes |
| RFQs & offers | Reference, Requirement, Supplier, Requested/offered qty, Offer, Promise, State, Next action | Create request → explicitly share → collect/record offers → compare → select |
| Orders | PO, Supplier, Scope summary, Value/currency, Due, Fulfilment, Approval, Next action | Draft → submit → approve → supplier acknowledgement → fulfilment |
| Receiving & returns | Delivery/source, Destination, Due/arrival, Delivered, Accepted, Rejected/pending, Receiver, Action | Arrival → inspect → accept/quarantine/reject → return/replacement/credit |

Global versions add Project and use the relevant role's saved view. Show exceptional warnings such as missing freight, unit conversion or late delivery within comparison details. The comparison opens a full-width table when several vendors/lines require it. Never rank an incomplete offer as cheapest just because a missing price displays zero.

RFQ issuance must freeze the reviewed revision. Created, manually recorded sharing, channel-confirmed sent/delivered and response are separate observations. Manual WhatsApp/email/PDF offers preserve staff recorder, sender, time and evidence. Changing the request after response requires a new revision and reconfirmation. No automatic external sending is implied by this plan.

Orders support header/lines with exact demand/destination/cost allocations. Selecting a quote produces a draft commitment; spend approval is a later authorized decision. Purchase amendments and short-closing retain receipts/bills and a reason. Services use valuation/accepted work; advances use their own authorization rather than fabricated receipts.

Receiving form is line-based and prefilled from expected delivery. Display remaining quantity and record delivered = accepted + rejected + pending inspection. Eligible stock comes only from accepted allocation. Returns, financial credits and replacement receipt are distinct linked events. Each partially arriving shipment has a conserved remainder.

Delivery detail contains packing/components, source allocations, destination, named receiver, booking, carrier/reference, dispatch and receipt evidence. A vehicle/run can serve several projects while project users see only their delivery lines. Logistics actions appear in global My work; the specialist queues remain Factory dispatch or Supply receiving. Do not add a separate global Logistics module initially.

## J. Work, factory and site

Tasks & timeline uses one shared work component with List, Board, Timeline and Calendar choices. Teams & capacity supplies the workload view. Daily planning uses assigned crew, exact work quantity, readiness, time window and remaining work; unknown dates are not defaulted to today. Reschedule previews preserve baseline and show downstream/client implications before confirmation.

Global Factory has four sub-tabs: **Queue, Capacity, Runs, Dispatch**. Queue columns: Operation/item, Project allocations, Work center/team, Planned quantity, Ready quantity, Scheduled window, State, Next action. Operator Today is a saved view; a planner can see all queues. Project → Work → Factory is the same operations filtered to project allocations, with a link to global capacity.

Capacity shows who is booked, working, absent or unassigned, remaining working hours and required skill/machine constraints. Throughput includes product/operation, unit, crew size, setup and time basis. Attendance is a linked fact, not an availability promise. Multi-resource booking must be checked atomically; one person cannot be reserved through two crews.

Runs allow compatible work across projects: ten wardrobes A4/B3/C3 → one crew booking → output allocated by project → eight QC-released, two held → exact dispatch allocations. Show planned/reported/QC-released/held/dispatched quantities separately. Do not expose other-project details to a project-only viewer. External manufacture tracks supplier promises/evidence without inventing a view of their workforce.

Site & daily work defaults to Today for field staff: room, assigned work, eligible quantity, readiness, owner and one action. Record today's quantity/evidence/blocker, display prior total and remaining quantity, and submit for review. Include zero-output and no-access days. Proposed tomorrow work retains remaining quantity rather than cloning unfinished tasks. Work type chooses installation, measured construction or service evidence rules.

## K. Quality, handover and service

Inspections columns: Item/batch, Stage, Eligible/inspected quantity, Pass/fail/pending, Reviewer, Due, State, Action. The detail carries checklist/version, measurements/tolerances, evidence, sampling policy if applicable and reinspection. Required inspection cannot be replaced by a generic task checklist.

Defects show source location, affected quantity, severity, responsible owner, due and disposition. Repair, return, replace, scrap and authorized concession keep different effects. Report approval, QC release, custody transfer, installation acceptance and client acceptance remain separate decisions.

Handovers show room/scope, quantity coverage, required documents/checks, outstanding obligations, approver and state. Freeze the offered pack; partial acceptance covers only those items/quantities. Show operational acceptance separately from final account/retention. Installed-item detail retains model/serial where relevant, location, installed date, commissioning and applicable coverage.

Aftercare uses the same Service workspace filtered to the project. Claim columns: Claim, Client/project/item, Issue, Coverage assessment, Owner, Appointment/due, State, Next action. Unknown/expired coverage may enter assessment. Visits track client/team confirmation, access failure, parts, work/evidence and verification. Chargeable work requires its approved estimate; repair does not automatically reset warranty. Client feedback/confirmation and administrative closure are explicit, not inferred from silence.

## L. Finance

Budget & forecast shows item/category rows with baseline/current budget, actual cost, open commitment, uncommitted forecast, final forecast and variance. Clicking a figure opens its source allocations. Cash paid and client revenue are separate views. Unknown cost completeness is visible. Budget changes retain approver/reason.

Supplier bills default to supplier/number, PO/service reference, amount/currency, match/exception, due, balance and action. Detail handles receipt/service matching, rates/tax/charges, advances, credits and payment allocations. Invoice number identity uses the stable vendor/legal entity. One payment may settle several bills without being counted several times.

Client invoices & payments shows billing milestone/valuation, entitlement, amount, issued state, due, paid/balance, provider sync and action. Create/link invoice happens only after entitlement review. Unknown provider outcome displays Reconciliation needed; no blind retry. Draft edits and issued corrections follow provider-supported rules. Retention, advances and credits remain accessible as filters/detail rather than more main tabs.

Global Finance surfaces cross-project approvals, matching exceptions, receivables/payables and reconciliation. Project money views use the same records. Accounting authority, currency/tax basis and billing policy are explicit prerequisites; do not invent them in the UI.

## M. Global task board and My work

Global Tasks is the staff work surface. Saved views: My work, Team, Approvals, Waiting, Overdue, All permitted work. Display List/Board/Timeline/Calendar/Workload as representations, with only applicable controls available for each record type. Filters/grouping cover project, room/item, team/owner, type, stage, due, blocker and permitted supplier/custom fields.

Each row/card shows reference/title, project/item context, current owner, due, state and next action. Cards represent execution tasks, coordination work or source-derived actions. A review action opens the approval source; completion follows its saved decision. Closing a card cannot receive stock, approve a bill or fabricate QC. One action appearing on multiple boards is counted once in global totals.

Planned capability stages retain all 31 requirements in blueprint §24:
- Core: identity, hierarchy, work types, backlog, source links, list/board, filters, assignment, dates, comments/history, guarded transitions and accessibility.
- Planning: all five views, grouping, manual ranking, dependencies, subtasks/checklists, bulk preview, time/output, templates, shared views and source-aware reopen/archive.
- Administration/scale: WIP policies, custom fields, versioned workflow configuration, recurrence, safe automation, notifications, analytics, import/export, pagination/performance, retry/conflict/draft recovery.

These stages are tracking groups, not a reduction of the 31-row contract. Every original row needs an implementation/test reference. WIP limits count work; capacity books hours/resources. Shared ranking is a specific queue property, not changed by someone's private table sort.

## N. Client and supplier experiences

Client gets four main destinations:

| Tab | What the client sees | What they can do |
| --- | --- | --- |
| Progress | Published room/item updates, selected photos, next milestone and communicated forecast | Read, ask a contextual question |
| Decisions | Assigned design/material/variation/handover requests, exact version, cost/date impact | Approve, return or reject where permitted |
| Payments | Own issued invoices, due/paid/balance, approved supporting documents | Review and submit payment evidence through supported flow |
| Handover & support | Accepted items, manuals, coverage and requests | Review pack, report a problem, confirm appointment, view resolution |

Home is the Progress landing with a small Needs your decision section, not another mandatory navigation level. A multi-project client can switch authorized projects. Never show supplier costs, internal reviews, workforce/other-project details or draft negotiations. Unpublishing must affect protected download authorization. Unresolved impact on a published commitment remains visible according to policy, even before a revised promise is agreed.

Supplier sees only its request/order: Requirements, Your response, Deliveries and Documents as applicable. Request-specific private links can use a simple detail page rather than the entire staff shell. Offers support partial/no-bid, terms and revision evidence; acknowledgement/date changes and shipment notices are submissions for staff review. A supplier cannot accept its own goods or approve its own bill. Expired/revoked access provides a renewal request path without exposing data.

Communication is attached to its source. An ambiguous message needs context matching; external delivery states require actual channel evidence. Use local fixtures for portal testing; no client/supplier messages or live payments are authorized here.

## O. How the action/state contract appears in the UI

Do not make users navigate a page of state-machine terminology. Every decisive action presents: **record/version, eligible quantity/value, current state, required evidence, responsible reviewer/receiver, resulting state and affected downstream work**. Safe optional fields stay collapsed. Approval screens clearly distinguish review from commit.

Example: dispatch eight of ten wardrobes. The dialog shows eight QC-released units, two held, allocation A4/B2/C2, destination/receiver, carrier and packing evidence. Confirming dispatch changes custody to In transit; it does not record receipt or installation. If the source changed, preserve the draft and require refreshed eligibility.

The complete 17-action mapping remains in the [audit](project-delivery-30-point-audit-2026-09-22.md#all-17-actions-in-section-29). Implement RFA submit/review/return/revision in addition. Each command contract must specify actor/delegation, version, input validation, quantity/value limit, source transition, audit/event, global action consequence, external visibility, retry identity, conflict recovery and correction/reversal.

UI buttons use server-authorized decisions. Release rules, independent review, accepted quantity, budget and approval cannot be overridden by custom fields, drag-and-drop or changing a label. Technical approval, spend approval, report review, physical QC and client acceptance remain different authorities.

## P. Fields, components and implementation boundaries

Keep the full field contract in blueprint §19 and aftercare fields in §§25–26. Before building each record, specify every key's type, unit/currency, source, default, editability, required-at-draft/action, permission and validation. Add RFA and shared run/quantity allocation dictionaries explicitly. No claim that every possible business field is known; new pilot exceptions must extend the register with rationale.

Reusable components: existing CRM DataGrid and view toolbar; workspace tabs/sidebar/header; record inspector/full-page detail; typed money/quantity/unit/date/member controls; source links; revision/file preview; activity history; contextual action form; linked-record selector; quantity allocation rows; comparison table; scheduling/capacity view. New domain-specific components must compose the live UI patterns, not introduce another table/control family.

Low-risk inline edits are reversible. Submitted specifications, issued prices, accepted quantities and posted finance use revision/correction workflows. Imports validate source IDs and units and show a preview. Exports respect row/field permissions. Temporary IDs and uncertain sync states must not look like finalized documents.

Mobile favors Today, receive, inspect, report and review flows; use the same table with prioritized columns/horizontal scrolling and a full-screen record detail. Desktop supports broader comparisons. Keyboard/menu equivalents for drag; clear focus after closing; RTL logical layout; reduced motion; readable non-color statuses. If offline capture is added, label pending sync and do not claim approval until server reconciliation.

## Q. Coverage of every original blueprint section

| Blueprint section | UX ownership in this plan | Completion requirement retained |
| --- | --- | --- |
| 1 Product decision | G, I–K | All delivery handoffs; quantity states |
| 2 Evidence/boundaries | B, R | Source/claim/verification distinction |
| 3 Existing implementation audit | P, R + audit | Gaps, compatibility and evidence |
| 4 Minimal interface | C–F | Role/global/project navigation; few defaults |
| 5 Quote to executable items | G | Exact source/versions/allocations |
| 6 Route classification | G, I–J | All nine routes; source/location/ownership |
| 7 Groups and batches | G, J | Optional groups; conserved allocations |
| 8 Dates/daily planning | J | Promise/baseline/forecast; dependency impact |
| 9 Factory capacity | J | Skills, crew/machine, shared bookings, throughput |
| 10 Materials and buying | I | Demand/stock/ownership/conversion/surplus |
| 11 RFQ/offer/order | I | Revision, compare, approve, acknowledge, amend |
| 12 Delivery/receiving/QC | I, K, O | Partial/pending/rejected quantities and custody |
| 13 Site/construction | J | Area readiness; install entitlement; services |
| 14 Daily progress | J, N | Incremental review; corrections; publication |
| 15 Finance/invoices | L | Budget, matching, advances/credits, provider lifecycle |
| 16 People/authority | C, H, O | Named owners and independent decisions |
| 17 Global board/events | M, O | Canonical actions, source transitions, reliable events |
| 18 Portals/WhatsApp | N | Publication, attribution, protected access |
| 19 Field contract | F–P | All 16 records plus RFA/service/allocation dictionaries |
| 20 Edge cases | R + blueprint register | All 46 cases mapped to evidence |
| 21 Implementation sequence | R | End-to-end slices, not isolated modules |
| 22 Policy decisions | H, L, R | All 11 decisions preserved |
| 23 Module ownership | C–E | All 12 owners retained in grouped navigation |
| 24 Task-board capabilities | M | All 31 capability rows; three stages |
| 25 Handover/installed item | K | Exact scope, frozen pack, coverage identity |
| 26 Warranty/aftercare | K, N | Intake, assessment, visit, parts, recovery, closure |
| 27 Four worked scenarios | J, R | Wardrobes, chairs, painting, service claim |
| 28 Final acceptance | O–R | Reconciliation, reliability, permissions, usability |
| 29 Action/state contract | H, O + audit | All 17 actions plus explicit RFA lifecycle |
| 30 Review guide | Q–R + audit | Requirement-to-implementation traceability |

A navigation home is not completion evidence. The audit currently marks most operational areas partial; this plan gives their missing functionality a clear UI home without pretending it exists.

## R. Build and acceptance order

Keep the previously implemented CRM-style navigation/item table as a foundation. Do not keep redesigning the shell while source integrity is unresolved.

1. **Contracts and item planning:** reconcile source/allocation fields, all route choices, RFA/source approval links and state/authority contracts. Settle pilot-dependent QC/billing rules. Validate draft versus commit and existing release gates.
2. **Purchased and installed journey:** material demand → RFQ/offer → draft/approved PO → partial receipt/QC → site eligibility → install/verify → handover, with linked supplier bill and client milestone. Include one rejection/replacement and one retry.
3. **Factory journey:** material issue → crew/resource booking → optional batch/run → incremental report → partial QC → packing/dispatch → exact site receipt. Include failed units and returned damage.
4. **Site/subcontract journey:** measured work, room prerequisites/curing, material responsibility, service acceptance and no fictional manufacture/receipt.
5. **Global operations:** cross-project run allocations/capacity plus canonical action projection; task-board planning and administration stages get separate exit checks.
6. **Finance and portals:** deepen cost allocation, services/advances/credits/retention and recoverable invoice generation; client/supplier role walkthroughs. Basic finance links/privacy apply in earlier slices too.
7. **Aftercare:** installed-item coverage → service intake/assessment → appointment/parts → repair/review → client communication/recovery.
8. **Operational acceptance:** all four worked stories, the 46-case register, migration/compatibility, concurrency/retry, download privacy, large data, desktop/mobile/keyboard/RTL and reload-safe persistence.

Maintain a delivery register: blueprint section + requirement ID; record/command; global/project/portal surface; implementation owner; policy dependency; automated test; persisted walkthrough; status. Missing evidence stays pending. No arbitrary completion percentage for this scope.

The final walkthrough uses one local pilot project and synthetic companion projects for cross-project tests. Actual accounting-provider operations, external messages, project enablement and deployment require their separately authorized step. This planning/research turn changes documentation only.
