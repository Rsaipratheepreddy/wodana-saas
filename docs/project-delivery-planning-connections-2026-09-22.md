# Planning row connections

The main Client projects table also gains Actions: planning overview, quotations/BOQ and release readiness for existing cases; project items, execution plan, materials, procurement, site execution and handover for linked execution projects. Unconfigured qualified leads retain the existing permission-controlled planning-start action. These are explicit navigation connections; no project is automatically released or production-enabled.

Project items get a compact Actions column opening existing item stages: plan, tasks/assignment, materials/procurement, readiness, factory/site execution, QC and handover. Actions navigate to the owning record UI; they do not release work or bypass permissions. Row next-action behavior remains.

Plan-work rows get contextual task details, materials and progress actions with a return path to their current planning stage. Pending installation batches appear under Quality even while a task remains in progress. Handover becomes available for passed, unoffered batches, without treating earlier acceptance of another batch as completion of the entire task. Existing backend gates remain authoritative. Preserve the bordered grid and existing CRM/Sales controls.

The materials stage also lists linked supplier requests/orders with direct record actions. Validation: 23 component tests pass across the main project table, item table and planning editor. Two desktop/mobile browser checks cover keyboard item-menu navigation into materials and QC, followed by the existing quantity planning/RTL checks. Web typecheck and targeted lint pass. Main client-project menu routes are component-tested; live backend navigation and production activation were not exercised.
