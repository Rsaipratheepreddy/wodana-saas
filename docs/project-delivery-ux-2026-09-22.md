# Project delivery UX — initial implementation contract

> Consolidated UX design: [Final UI/UX plan](project-delivery-final-ui-ux-plan-2026-09-22.md). This file records the earlier implemented slice, not full blueprint coverage.

## Reference and scope
Use the running Sales/CRM UI and existing sidebar: the CRM enquiries DataGrid configuration, compact controls, workspace flow tabs and existing record dialogs. Storybook is not a design reference. Keep existing URLs, permissions and domain records. This is local implementation; no project activation or deployment.

The delivery blueprint remains the workflow contract. This iteration implements staff navigation and the item worklist, not all procurement, factory, financial or client-portal capabilities.

## Navigation
Six main sections, with contextual sub-tabs rather than eleven competing main tabs:

| Main section | Sub-tabs / existing destinations |
| --- | --- |
| Project | Items, Overview, BOQ, Designs |
| Supply | Requirements & stock, Stock transfers, Orders, To order, Supplier quotes, Receipts, Returns, Suppliers |
| Work | Tasks, Teams & bookings, Factory, Site, Daily progress |
| Quality & handover | Completion checks, Defects & warranty, Handovers |
| Budget & payments | Existing Budget, Supplier invoices, Client payments, Retention views |
| Files | Existing documents, technical queries and transmittals |

Only permitted destinations appear. A main section opens its first accessible destination; deep links select the correct main section and sub-tab. Sub-tabs scroll on narrow screens using the same workspace styling. Existing specialist views remain within their screen. Later consolidate their view selectors into table controls rather than adding more navigation levels.

Global Tasks and Factory remain workspace destinations. A project is a filter/context on connected records, not a second copy of tasks. Do not introduce another sidebar or duplicate these modules.

## Staff journey and item table
Open project → see item worklist → filter by area/stage/owner or search → open item/current next action → use existing plan editor for classification, assignment, dates, tasks, materials and checks → refreshed server state drives the next action.

Reuse the actual CRM DataGrid: flush layout, compact toolbar, column configuration, filtering, sorting, CSV export, row opening and shared keyboard/mobile behavior. Default columns: Item, Room/area, Stage, Owner, Target finish, Next action. Optional columns: Supply, Site work, Tasks complete, Blocker. No money columns or operational forms in the everyday item list; BOQ and Budget retain commercial context. Views: All items, Needs attention, Accepted. Needs attention means a recorded blocker or overdue status, not guessed urgency.

One row is one existing work package; one package can cover multiple BOQ lines. The source BOQ remains its own table. Do not flatten a many-to-many relationship by silently choosing the first package. Open a row to inspect; use the contextual next-action button to open the appropriate editor tab. Missing pipeline data stays visible as “Review item”; it must not cause an item to disappear or imply readiness. Unassigned owners and unscheduled dates are explicit.

## Data and API contract
Read ProjectState.data.workPackages, members, itemPipeline and pulse. Reuse the existing projectItemPipeline domain fallback only when the server read model is absent. Classification comes from supplyMethod/siteWork, owner from ownerId and members, target from plannedEnd. Existing onOpen callback routes to the existing work-plan dialog and action API. No new storage, endpoints, status engine, writes on navigation or percentage calculations. A displayed task count is not installed quantity, QC approval or client acceptance.

## Client experience (subsequent implementation)
Client portal has four main sections: Progress, Decisions, Payments, Handover & support. Progress groups approved updates by room and shows the next promised milestone. Decisions contains only pending client approvals and changes with cost/date impact. Payments contains customer-facing invoices and payment status. Handover contains acceptance packs, warranties and service requests. Internal supplier prices, workforce allocation, blockers and draft notes are not exposed automatically. Staff explicitly publish approved client updates through existing permission-checked actions.

Supplier portal remains request-specific: submit offer, confirm delivery, attach evidence. Submitted evidence is not accepted stock or approved invoice.

## Subsequent slices
1. Navigation and CRM-style item table (this iteration).
2. Item detail UX and precise quantity/batch handoffs, using existing domain actions; validate partial/QC-failure/rework scenarios.
3. Supply receipts/returns and factory shared capacity views; distinguish team occupancy from throughput.
4. Site daily work and installation evidence, global task-board parity and linked filters.
5. Client decisions/publication, invoice lifecycle, handover/warranty.

Each slice needs its own field/action contract and real permission/edge-case verification before it is described as complete. No fake actions or placeholder operational counts.

## Verification
Component checks for group selection, deep links and permission fallback; item actions, search, attention views, missing read models, accepted records and read-only labels. Typecheck and scoped lint. Browser checks of local synthetic fixtures for desktop, mobile, keyboard and RTL; record limitations if full verification is blocked. Never use production data to test state-changing actions.

## Implemented and verified
- Six main navigation groups with permission-filtered destinations, contextual sub-tabs and existing deep links. Removed the duplicate Tasks / Teams selector inside Execution.
- Project item cards replaced with the live CRM DataGrid pattern; linked next actions retain existing editor routing. BOQ/design tables use flush appearance.
- Missing server pipeline entries remain visible. No production records or enablement flags changed.
- 34 component tests passed across item worklist, navigation, BOQ and project workspace; TypeScript passed.
- Four Playwright checks passed in installed Chrome against the local read-only demo fixture (desktop/mobile), including keyboard menu focus, RTL width/empty-state visibility and receipt deep links. Inspected desktop and mobile screenshots. Browser fixture has no items; populated item/action cases were tested at component level.
- Scoped lint passed for changed item/navigation/BOQ components and tests. Broader project-workspace lint remains blocked by existing set-state-in-effect errors at lines 142–143 and existing warnings, outside this change.
- Client-portal restructuring and the remaining delivery slices above are planned, not implemented in this iteration.

## RFQ contract slice — proposed, not implemented; paused for full-plan review
User journey: Supply → Supplier quotes (RFQ) → select a requirement and suppliers → create requests → explicitly share private links → record/receive quotations → select with reason → draft PO → submit → reviewer approves. Creating a request is not sending; selecting a quotation is not approving spend.

RFQ table default fields: reference, requirement, supplier, quantity, latest quote, required delivery, response, workflow state and action. Context, original quote, estimate and response deadline remain configurable secondary columns. Existing enquiry URLs and private portal routes remain unchanged.

Proposed: new RFQs would capture the request title, specification, quantity/unit, requirement/task links, dates and creator/time as a source snapshot. Existing requests without a snapshot are explicitly legacy records. Frozen requests are corrected by cancelling and creating a new request; selecting a quote preserves the original request while creating draft-order terms. Snapshot-bearing purchase drafts cannot switch to a different requirement or unit. Supplier submission remains evidence/proposal, not approval or receipt. No automatic messages are sent.

The UI uses existing enquiry/order state and quotations; it never infers sent/delivered status. RFA (request for approval) is a separate concept and is not implemented by renaming RFQs.
