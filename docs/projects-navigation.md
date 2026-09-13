# Project tabs and delivery cycle

Scope review: [Projects module — v1 scope baseline](projects-scope-v1.md) now defines the proposed complete scope, including a new Daily progress tab and task/subtask collaboration. The ten-tab list below records the currently implemented navigation; further implementation is paused for scope review.

Status: navigation and flow guides implemented for the demo project on 7 September 2026. [Plan & teams](project-planning.md) now has working seeded tasks, crew bookings, conflict checks and a weekly calendar, saved in the browser. Other operational forms, live bookings, approvals, vendor access and accounting integration remain planned.

## Starting a project

Pre-project agrees the BOQ, drawings, contract and release conditions. The delivery project references that approved baseline. Break the scope into work packages and tasks, with materials, owners, dates and required approvals. Factory and site activities can run in parallel when their prerequisites are ready.

## The ten tabs

| Tab | Flow | Result |
|---|---|---|
| Overview | Approved scope → milestones → blockers → decisions | Know project health and who acts next. |
| Plan & teams | BOQ → tasks → availability → confirmed bookings | Coordinate crews and factory capacity across projects. |
| Material planning | Demand → available stock → reservations → shortages | Know what to reserve and buy, and when it is needed. |
| Procurement | Quotes → approved order → delivery → verified receipt | Track suppliers, subcontractors and outstanding quantities. |
| Production | Approved drawings → readiness → manufacture → quality check → dispatch | Track custom items from an internal or external factory. |
| Site work | Area readiness → booked crew → execution → inspection | Cover civil, electrical, plumbing, finishes and installation. |
| Snagging | Defect → responsible team/vendor → correction → verification | Close issues with evidence; reopen failed fixes. |
| Handover | Completion checks → document pack → client acceptance → warranty | Record acceptance and remaining obligations. |
| Documents | Link to work → revision review → approval → final records | Keep the correct drawing and evidence attached to each activity. |
| Commercial | Agreed budget → commitments/costs → billing approval → accounting status | Follow contract value, margin and amounts due or paid. |

Assigning a team to a project does not book its time. The planned booking workflow must check availability across projects and flag the effects of delays. Materials, drawings, permissions and release conditions also determine whether work can start.

## Commercial → Change requests

Request → assess scope, cost and date impacts → required decisions → approved variation → update affected drawings, orders, bookings and releases.

Keep the original BOQ and its revision history. Pending requests do not automatically increase contract value. Link the same change record to Pre-project Variations. A defect is not automatically a billable client change.

## Vendors and accounting

Procurement will own vendor interactions. Begin with authenticated, restricted enquiry/order pages for quotations, promised dates and delivery evidence; vendors see only their assigned records. Internal teams verify acceptance and approve bills.

Select Zoho Books or QuickBooks as the accounting system for each company. Wodana manages operational approvals and project budgets; approved invoices/bills and payment status link to accounting. Physical handover and financial closure remain separate.

## Current routes

Open `/workspace/projects/demo/overview` for the tab directory. Commercial has Summary and Change requests views; the latter uses `?view=change-requests`. Old `installation` links redirect to `site-work`. Each guide shows its input, steps, outcome and connected tabs.

For research evidence and detailed requirements, see [Projects operating flow](projects-operating-flow.md). This document records the selected navigation; Production keeps its existing label and Material planning remains separate from Procurement.
