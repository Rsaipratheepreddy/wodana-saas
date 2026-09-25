# Project sections and ownership

Reference: Project Flow Master Document.docx, supplied by the client, sections 01–05.

The master distinguishes approved technical drawings/material selection, BOQ, procurement, ready for manufacturing, manufacturing, site preparation, installation, snagging and handover. Its mapping of these stages to screens is exploratory; the screen grouping below is our implementation decision.

| Screen | User's job | Records shown |
| --- | --- | --- |
| Scope & design | Confirm what was sold and approved | Released BOQ, accepted variations, approved designs |
| Execution / All work | Plan how each BOQ item will be delivered | Supply method, site work, owner, linked tasks and requirements |
| Execution / Factory | Perform and inspect fabrication | Factory tasks, workshop, readiness, output, dispatch |
| Execution / On-site | Prepare the site and install | Site tasks, crew, dependencies, updates, inspections |
| Execution / Timeline | Arrange dates and dependencies | The same tasks, not another workflow |
| Purchasing / Requirements & stock | Determine what is needed and available | Task-linked materials, finished items, stock movements |
| Purchasing / Supplier orders | Source and receive supply | Enquiries, offers, approvals, supplier confirmation, receipts |
| Budget & payments | Control costs and payments | Budget, commitments, invoices, payments |
| Handover | Resolve defects and close delivery | Snags, completion evidence, acceptance |

## Connections

A BOQ item may need both factory fabrication and site installation. These are two linked tasks under one work item. A material requirement identifies the consuming task; Purchasing sources its shortage. A supplier order is not a factory task. Factory sees material readiness, while supplier pricing and ordering stay in Purchasing. Subcontracted fabrication still has a factory task; its supplier agreement remains a Purchasing record.

Client-supplied and supplier-included requirements are recorded without assuming they need a company purchase order. A buy-only item need not have a fabrication task. Dependency, drawing, resource and release checks continue to govern starting work. Planning never implicitly starts production.

## Navigation behavior

Factory and On-site open their task lists, not the work-item planning modal. The planning modal contains Work, Materials and Readiness. Materials shows requirements and receipt coverage, without supplier-order actions. Readiness uses a compact check matrix with optional drawing and release details. Reviewing a task opens an inspector in place; Back restores the originating work item and tab. Drawings with a file open the actual file separately. Supplier order operations live under Purchasing.

## Research

Odoo's official replenishment documentation distinguishes the supply requirement from its purchase or manufacturing order and keeps the records linked:
https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment.html

The separation here follows that general principle; the client's approval and commercial-release rules remain authoritative for this product.

## Procurement detail refinement — 20 September 2026

Orders and deliveries open the same compact order record. It contains the ordered requirement/specification, consuming task and room, quantity/rate, accepted and outstanding receipts, shipment history, invoice documents/references and payments, and editable notes. Internal material, task and commercial-page redirects were removed from this detail. Existing orders remain one requirement per order; the screen does not invent component breakdowns for a BOQ lot.

Supplier quotes open a read-only summary with explicit Record offer, Select quote and Edit request actions. Offer revisions remain in history. Selecting an offer creates a draft order through the existing approval flow. Sharing a supplier request remains an explicit action.

Work-location filters cover requirements, supplier quotes, orders, deliveries and invoices. Location comes from the consuming task (including the requirement's task when the order has no direct task), never from supplier type. Unlinked requirements remain Unassigned. Requirements additionally distinguish Company to procure, Client supplied and Included by supplier.

Shipment updates are manual, timestamped events keyed by a shipment/reference, with quantity, carrier, expected date and status. They do not change stock or imply acceptance. Record receipt performs the existing stock movement; partial acceptance leaves an outstanding balance. Supplier bills may be recorded before receipt, but approval continues to check accepted/unbilled quantities and the approved rate. Payment still requires an approved invoice. These updates are permission checked and audited by the project transaction.

Research: Odoo's official purchase bill-control documentation distinguishes ordered/received quantities and invoice matching: https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/purchase/manage_deals/control_bills.html . This implementation keeps the existing project's received-quantity approval policy. Carrier API tracking and multi-line purchase orders are not introduced by this refinement.

## Item-first navigation refinement

Project items is the default entry point. Its Items view uses compact BOQ-linked cards with owner, current state, Materials / Factory / On-site shortcuts and one next action. Project identity and setup live in its Overview subview. Package-specific preparation alerts are not repeated above the same cards; other project decisions remain visible.

Cards reuse work packages and their existing scope IDs, requirements, orders and tasks. Opening a material keeps the item as the return context. Factory and On-site shortcuts filter the item's tasks, and returning from a task restores that filter. Saving delivery planning advances to Tasks without starting or approving work. Execution opens the task board directly; Daily progress is an explicit execution view. Existing commercial release, stock, inspection and handover controls remain authoritative.

The item dialog now uses a sequential Classify → Plan work → Materials → Start checks → Execution → Completion pipeline instead of category tabs. Classification saves only the delivery choices; planning exposes owner, dates and linked tasks. Continue changes the displayed step only and never authorizes execution. Check & release for work still calls the existing server gate. Completion offers the existing handover generator preselected for this package only after its tasks are complete; pack generation retains server inspection and acceptance checks. Cards use white surfaces in light mode and retain dark-theme contrast.
