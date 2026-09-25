# Connected project workspace

> Superseded on 22 September 2026 at the user's request. The Palm release restores the existing project routes and operational tables. The four-section workspace is not the project entry point; old `/projects/new/:id` bookmarks redirect to the existing flow. Preserve the latest quotation builder, enquiries and colorful icons. This document is retained only as a design reference, not an approved rollout plan.

## Product decision

The project item register is the front door, not another copy of BOQ, purchasing or factory data. One row is one active released scope line, identified by its immutable scope-line ID. Areas group/filter those rows. A work package can deliver several lines; tasks, material requirements, RFQs, purchase orders, shipments, receipts, inspections and handovers link to those IDs rather than moving/copying the item between tables. Unreleased requirements and quotation revisions remain in Planning until commercial release.

Four primary destinations: **Items, Planning, Work, Finance**. Items opens first. Digital twin is a view of Items. Approvals, documents, shipping, quality and handover open from an item's context; they are not another permanent row of project tabs. Existing operational URLs remain available for deep links and migration; do not delete records or bypass their existing controls.

## Sections and ownership

| Section | Purpose and content | Primary action / exit |
| --- | --- | --- |
| Items | Sticky item identity; area, approved quantity/unit, BOQ lineage, plan/owner, approvals, material coverage, RFQs, POs, supplier, shipping, factory tasks, site tasks, quality, handover, cost and next action. Saved lenses change columns, never data ownership. | Open item inspector; select items then choose a contextual action. |
| Planning | Existing requirements, design, quotations and change requests. Keep draft scopes separate from executable commitments. | Approve/release through existing commercial gates, then the same released IDs appear in Items. |
| Work | Project-filtered view of the workspace's global work queue; one shared board/table. Factory/site/office, project, assignee, resource/team, priority and work type are filters. | Open the source task/approval/record. Status changes must use the existing domain command, not generic card writes. |
| Finance | Budget/forecast, commitments, certified/received invoices, payments, retention and reconciliation. Client price, procurement cost and actual spend remain different amounts. | Edit controlled budget or open the actual invoice/payment record. |
| Digital twin (Items view) | Spatial room/item index tied to the exact same scope IDs, drawings, tasks and live states. No fabricated coordinates, geometry or completion. | Select an area/item to open the same inspector. Actual 2D/3D placement requires a drawing/model and persistent element mappings. |
| Project controls | Existing project initiation, milestones, roles/teams, capacity calendars, client publication and closure, reachable as contextual tools. | Existing validated commands; no silent approvals or automatic publication. |

## Item inspector and selection

Click an item name to inspect it; clicking a status opens that linked section. Checkboxes select items only and never change workflow state. A selection summary explains the next step. Bulk actions must preserve the selected scope IDs, explicitly show material quantities/documents/suppliers, and validate every record. Select-visible never silently selects filtered-out items. Changes to filters clear selection. Unrelated legacy records are surfaced as unlinked work instead of being guessed onto an item by title or room.

Inspector sections: identity and approved scope; delivery plan and tasks; RFAs and document revisions; material requirements and inventory; RFQs/offers/orders; shipments and receipts; quality/defects; handover; audit/history. All links resolve the original record. A missing link has a truthful empty state and an appropriate next action.

## Connected flow

1. Requirement → design → quotation → agreement/payment gates → released scope.
2. Scope item → delivery plan (make / buy / subcontract / client-supplied; factory / supplier / site / office; installation or delivery-only) → responsible owner and tasks.
3. Drawing/specification → RFA draft → submit → independent review → approval/revision. RFA is approval of a specific revision, not an RFQ.
4. Selected scope → material requirements → stock/shortfall check → RFQs to eligible suppliers → offer comparison → draft PO allocation → independent PO approval → supplier acknowledgement.
5. Multiple partial POs may cover one requirement. Approved orders are commitments, not received stock. Pending approval is shown separately. Cancelled requests/orders do not cover demand.
6. Shipment updates → goods arrival → accepted / rejected / pending QC → accepted stock → reservation/issue to tasks. Shipping events are not blindly summed because successive status events may describe the same shipment.
7. Factory tasks → reviewed production quantities → QC-approved lots → dispatch → site receipt → installation tasks → inspection/rework.
8. Accepted installation and resolved blocking defects → handover packet → client acceptance → warranty. Financial closure remains separate from physical acceptance.

Parallel branches remain visible. Some units can be installed while other units are still being purchased. Do not collapse all columns to one linear status.

## Quantities and financial invariants

- Never add metres, pieces, hours or unlike materials into one progress numerator. Material coverage is reported per requirement; row summaries count covered requirements.
- Finished output, raw stock, reported progress, inspected output and client acceptance are separate quantities.
- Sum each linked order once even if linked through both task and material. A shared order/package can appear in several item contexts; do not add per-row totals into a project total without deduplicating IDs.
- Only approved/acknowledged/closed POs are commitments. RFQs, drafts and cancelled orders are not. Group currency amounts; never add currencies together.
- Deducted scope stays in history but is excluded from active planning. Amendments, replacements and variations retain lineage.
- A row's next action is guidance, not permission. Server checks, project access, separation of duties, immutable snapshots, optimistic revisions and stable request IDs remain authoritative.

## Shared task-board design

The canonical task retains project ID, package/scope links, parent, predecessors, owner, assignees, resource, area, location, priority, dates, output quantity/unit, readiness, inspected progress and audit history. A workspace board aggregates these records without copying them. Project/team/factory boards are filters of that same queue.

Lane families: To do, In progress, Review, Blocked, Done. Source states remain visible on cards. Moving a card is not permission to approve a PO, certify a receipt or bypass QC. Execution task transitions use the task command and explain blocked dependencies/readiness. Business approvals stay in their approval workflows.

Existing capabilities to preserve: subtasks, dependencies, resource booking/capacity, workflow templates, comments/mentions, files, daily reports, inspection batches, role-aware approvals and audit. Subsequent enterprise increments: persisted personal/shared views, configurable swimlanes and WIP policies, bulk reassignment with capacity checks, task templates/custom fields, recurrence, time estimates/logging, automation rules, critical-path timeline, notifications and digital-twin geometry mappings. These require explicit contracts and tests; filter controls alone are not a Jira-equivalent engine.

## API and data changes

- `GET projects/:id/execution`: add a deterministic `itemRegister` read projection, built from existing scope, packages, tasks, materials, orders, transfers, documents/RFAs, dispatches, snags and handovers. Never persist derived statuses separately.
- `POST projects/:id/execution`: keep revision/requestId and existing permissions. Extend material planning to accept selected scope IDs and exclude deducted lines. Add atomic multi-requirement RFQ draft creation with server-resolved active suppliers and existing RFQ validation; never send messages automatically.
- `GET projects/work-queue`: extend server-side filters/metadata for location, priority, resource, area and source kind before cursor pagination. Project views use this same API and permissions.
- Frontend: register lenses and contextual inspector; explicit material-selection RFQ modal; shared global/project board; minimal shell with legacy URL compatibility.

## Verification and rollout

Domain tests: lineage/deductions, direct and package task links, cancelled records, mixed units/currencies, partial orders/receipts, pending QC, duplicate linkage, no invented shipping totals, selected material planning, atomic RFQ failure/idempotency, permissions and server-side board filters.

UI tests: checkbox semantics, filter resets, contextual actions, empty/unreleased state, drawer links, shared project filter and stale-response handling. Verify desktop, keyboard, narrow screens and RTL. Run web/backend type checks and targeted suites. Local implementation only; no production migration/deploy or changes to real customer records without a separate request.

## Delivery boundary

This change delivers the connected register, selection-driven sourcing, minimal project shell and shared filtered work board on existing domain controls. The advanced board increments and actual model/geometry binding above remain explicit follow-on work, not implied completed functionality. The spatial area index must be labelled accurately rather than presented as a completed 3D twin.
