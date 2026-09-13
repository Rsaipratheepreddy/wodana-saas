# Projects module — v1 scope baseline

Scope baseline prepared 7 September 2026. Implementation has since progressed; this document records the intended scope, not a delivery claim. See [current local verification and production boundaries](projects-delivery-verification.md) for tested behavior and remaining activation work.

## 1. The whole cycle

Pre-project BOQ and agreement → project scope and releases → tasks/subtasks → assignments and resource bookings → materials, factory and site execution → daily reporting and review → inspections/snags → handover → warranty and financial closure.

Factory work, purchasing and site work can overlap. Documents, comments, changes and commercial controls support the entire cycle.

## 2. Where everything belongs

| Project tab | Required scope |
|---|---|
| Overview | Milestones, approved progress, overdue work, blockers, decisions and next actions. |
| Plan & teams | **Tasks** as the default view; expandable subtasks, assignments, dependencies, schedule, team availability and milestones. |
| Material planning | Requirements, material responsibility, stock availability, reservations, shortages, issues, returns and waste. |
| Procurement | Vendors, quotation requests/comparison, purchase and subcontract orders, approvals, promised dates, deliveries, receipts and service acceptance. |
| Production | Internal or external factory jobs, operations, assigned resources, readiness, reported output, quality, rework and dispatch. |
| Site work | Area readiness, permits/access, trade work, installation, inspections, commissioning and site issues. |
| **Daily progress** | A visible top-level tab: mobile field updates, report drafts, submission, manager review, revisions and approved reports. Includes site/factory filters. |
| Snagging | Defects, responsibility, due dates, evidence, reinspection and verified closure. |
| Handover | Area/project completion, acceptance, as-builts, manuals, warranties, remaining obligations and warranty defects. |
| Documents | Drawing/specification revisions, technical queries, approvals, transmittals and linked evidence. |
| Commercial | Original BOQ/contract, budget, commitments, cost forecast, change requests, valuation/billing approvals, retention and accounting status. |

Comments, attachments, activity history and permissions are shared capabilities on records, not another competing task system or standalone sidebar tab. Site work and Production show filtered views of the same task records used by Plan & teams.

## 3. Scope, tasks and subtasks

**Hierarchy:** Project → work package → task → subtask. Area/room and BOQ references are linked attributes. A checklist is useful for small checks; use a subtask when work needs its own owner, dates or measured progress.

Example: **Master-bedroom wardrobes** is the package. Tasks are survey, fabrication, delivery and installation. Fabrication contains cutting, assembly and finishing subtasks. The current demo incorrectly labels individual activities as work packages; correct that distinction in the next build.

| Every task/subtask needs | Behavior |
|---|---|
| Identity and scope | Stable ID, title, description, package, area, linked BOQ lines/revision, quantity/unit where measurable, trade and site/factory location. |
| Responsibility | One accountable owner; assigned people, crew or vendor; supervisor/reviewer; followers. Ownership and booking remain separate. |
| Planning | Priority, baseline and forecast dates, duration, multiple predecessors, milestones and readiness requirements. Prevent dependency loops. |
| Execution | Status, reported/approved output, actual dates, blockers, inspection requirement and linked daily updates. |
| Collaboration | Comments/replies, @mentions, attachments, notifications and chronological activity with author/time. |
| Record actions | Create, add subtask, edit, assign/reassign, reschedule, hold/resume, cancel and reopen with reason. Archive rather than destroy referenced execution history. |

Task state: Draft → Planned → In progress → Awaiting inspection → Completed. Blocked, On hold and Cancelled are explicit alternatives. Tasks without a required inspection may complete after progress review. Booking state and readiness are separate from task state.

Pre-project owns the original approved BOQ and agreement. Project scope retains stable line IDs and approved revision references. Splitting a BOQ item into tasks must not duplicate its contract quantity or value. Internal planning tasks can exist without a priced BOQ line, explicitly identified as non-billable project work.

A linked Planning project may be prepared while Pre-project continues. Purchasing, factory and site releases each require the relevant approved scope, technical information and commercial authority. Changing a project status alone grants none of those approvals.

## 4. Assignment and availability

- Assign an owner to make responsibility clear; confirm a dated booking to reserve labour or factory capacity.
- Use shared workforce records, team membership, work calendars, shifts, leave and existing bookings across all projects. Check individual members too, so booking a person separately cannot bypass a crew reservation.
- Show the task, project, period and reason for each clash. Suggest a compatible available resource or date; a planner confirms the change.
- Preserve original dates when forecasting a delay. Show downstream and cross-project effects before moving bookings. Never silently assign a crew already occupied elsewhere.
- Distinguish employees, labour-only subcontractors, supply-and-install subcontractors and outside factories. External capacity requires vendor acknowledgement; it cannot be inferred from an empty internal calendar.
- Start with named crews and simple factory resource slots. Arbitrary fractional staffing and automatic production optimisation are deferred, not prerequisite features.

The server must enforce reservations transactionally, including concurrent requests. Browser-only checks are insufficient for live allocations.

## 5. Daily progress: the main execution loop

**Site manager/foreman → mobile update → submit → project manager or designated reviewer → approved progress → tasks, schedule and overview update.** Factory supervisors use the same reporting mechanism for their jobs. Reports are internally visible by permission; client publication is a separate explicit action.

The mobile entry starts with “My assigned work” and “Add daily update”. Default project, date, location and assigned tasks where known. Permit several contributors and shifts, then consolidate a project/day report without duplicate entry.

| Report section | Capture |
|---|---|
| Context | Project, date, shift, area, reporter and linked tasks/subtasks. |
| Work done | Planned output, today's measured quantity/unit or milestone evidence, previous approved total, proposed new total and remaining work. |
| People | Crew/person references, actual attendance and hours, internal/subcontract breakdown, with HR attendance linked where available. |
| Materials | Received, used, returned and wasted quantities, linked to stock/receipt records for verification. |
| Evidence | Photos/files against the actual task and area, with reliable upload/retry status. |
| Problems | Delays, material shortages, access, safety/quality issues, instructions, responsible person and due date. |
| Next shift | Tomorrow's plan, requested resources and unresolved decisions. |

Report state: Draft → Submitted → Approved or Returned for changes. Approved reports can be published to the client. Revisions preserve prior evidence and require review. Local/offline drafts must show pending/failed sync and use stable retry IDs; never display unsent work as received by the server.

Progress rules:

- Distinguish reported output, approved execution progress, inspection acceptance and commercially certified work. These are different facts.
- Approved report contributions update leaf tasks. Parent/package/project progress derives from agreed quantities or frozen execution weights; do not average unrelated tasks or add parent and child progress twice.
- Fabrication and installation of the same four wardrobes are separate operations, not eight delivered wardrobes. Aggregate using agreed phase weights.
- Repeated submissions, concurrent reports and revised reports must not double-count output. Corrections adjust the prior contribution with an audit record. Rework earns no duplicate completion credit.
- Scope above the approved quantity needs a reviewed change or correction. Attendance alone earns no progress. An approved daily report does not automatically issue stock, certify a bill or authorize payment.
- Replace the demo's freely editable progress slider with this reviewed reporting flow. Explicit administrative corrections require a reason and audit trail.

## 6. Comments and shared controls

Open a task once to see Details, Subtasks, Updates, Comments, Files and History. A site update creates one linked progress record; its activity appears on the task without copying it into another disconnected report. Comments can request a decision but cannot silently approve scope or change progress.

Support threaded replies, @mentions restricted to people who may access the record, attachment permissions, edit history and resolve/reopen. In-app notifications cover assignment, mention, due work, submission, return and approval; actionable links open the relevant record. External sharing is explicit and restricted to approved content.

Permissions apply on the server to the workspace, project and record. A site reporter updates assigned work; a designated reviewer approves reports; planners manage bookings; buyers and commercial staff manage their records; vendors see only their own enquiry/order/work; clients see only published material. Reporting and approving are separate capabilities, even where a small company's role configuration combines them.

## 7. Materials, vendors, changes and money

Material demand comes from the approved work requirements and manufacturing needs, with clear company/vendor/client supply responsibility. Reserve stock, purchase shortages and track partial deliveries, rejections, returns and issues. Avoid buying materials already included in a subcontract package.

Begin vendor access with authenticated, restricted enquiry/order forms: quote, acknowledge dates, provide progress and submit delivery evidence. Internal staff approve orders and accept goods/services. A full vendor dashboard can follow; scoped vendor submissions belong to v1.

Change request → assess scope, cost, time and affected purchases/work → required technical/commercial/client decisions → approved variation → controlled scope, drawing, order and schedule revisions. Preserve the original BOQ and link the same variation to Pre-project. A defect is not automatically a billable change. Authorized work pending final price needs a separately recorded instruction and exposure limit.

Wodana owns operational budgets, commitments and approval evidence. One selected accounting system per company—Zoho Books or QuickBooks—owns accounting documents and settlement. Track external IDs, sync state, retries and reconciliation; prevent duplicate invoice/bill creation. Manual recording of verified accounting references is a valid initial connector fallback, not a fake successful sync.

Physical handover, final account, retention and warranty obligations close separately according to the contract. Partial area handover must remain possible.

## 8. Compact interface contract

- One compact title/action row; the next row contains views, search and filters. The primary action is **Add task** in Tasks and **Add daily update** in Daily progress.
- Tasks and expandable subtasks are the first visible content. Keep aggregate KPIs in Overview; small counts may sit in filters.
- Replace the tall clash banner with an inline “1 booking clash” control opening the affected records. Do not consume the task canvas with a hero/header section.
- At 1440 × 900 and 100% zoom, target the first task row within 180px below the workspace top bar and at least six visible rows. Verify mobile task access at 390px; use compact rows and a focused detail sheet.
- Keep current neutral typography and lilac–rose–peach accents. Gradients identify primary actions and selected context. Preserve theme, keyboard, RTL and reduced-motion behavior.

## 9. Existing code and integration decision

This is source inspection, not a claim of deployed or verified end-to-end behavior:

| Existing source | Reuse candidate / gap |
|---|---|
| [New Plan demo](../apps/web/lib/projects/planning.ts) | Local flat tasks, crew suggestions and booking checks; lacks real subtasks, responsible users, comments and report-derived progress. |
| [Business Core Projects](../services/business-core/src/projects/projects.service.ts) | Current portal's delivery-project, assignment and attendance foundation; not the complete execution contract. |
| [Older execution models](../../backend/app/models/execution.py) and [API](../../backend/app/api/v1/execution/router.py) | Task parent IDs, user/team assignments, comments, attachments and execution endpoints already exist. Map their concepts and identifiers before reuse. |
| [Older daily-report service](../../backend/app/services/project_service.py) and [workflow tests](../../backend/tests/test_daily_log_workflow.py) | Report submission/review/publication and approved task progress logic exist. Quantities, multi-contributor reports and revised aggregation need a fresh contract. |
| [Workspace comments](../../backend/app/models/workspace_comment.py) | Generic anchored threads/mentions exist alongside task comments. Choose one authoritative record-thread model; do not create duplicate conversations. |

Use Business Core as the proposed authority for new portal execution records. Inventory/migration or explicit adapters must preserve links to older records; do not let both backends independently write the same project progress, booking or commercial record. Resolve this mapping before the first production migration.

## 10. Build sequence and acceptance

| Increment | Complete outcome before moving on |
|---|---|
| A — execution foundation | Real linked project/scope; compact task/subtask table; owners/assignments; record comments/files/history; roles; mobile daily update; manager review; derived task progress. |
| B — planning and bookings | Multiple dependencies, milestones, calendars, availability, server-enforced reservations and visible delay effects. |
| C — supply and control | Material requirements/reservations, vendor forms, orders/receipts, baseline budget and change approval; accounting references/connector status. |
| D — delivery and closeout | Factory/site readiness, inspections, rework/snags, commissioning, partial handover, warranty and finance reconciliation. |

These increments are one agreed module scope, not permission to omit later parts. No real purchase or factory/site release goes live before its applicable controls exist. Advanced AI scheduling, payroll, a second general ledger, machine nesting/optimization and a full external portal suite are later enhancements.

Release acceptance must demonstrate: task/subtask assignment and comments; denied unauthorized access; mobile save/retry without duplicate reporting; returned and revised report handling; correct parent progress without double counting; no simultaneous crew/member booking; visible reschedule impacts; partial/rejected receipts; technical revision/change control; vendor isolation; published-only client access; and physical handover with permitted outstanding retention.

Client configuration remains explicit: actual factories/teams and calendars, reviewer roles, project locations/approvals, payment/retention terms and accounting company mapping. These are not inferred as facts about the client. They do not prevent building the shared workflow above.
