# Cross-project supply queue — first connected slice

The project remains the owner of each material requirement, supplier enquiry, order, receipt and stock transfer. A workspace queue is a projection of those records, not a second purchasing database. This lets a buyer find work across authorized projects without opening every project to discover it.

## Journey

1. A released project item generates or receives a company-supplied material requirement with a required quantity, unit and need-by date.
2. The global **To order** view shows only the uncovered quantity after accepted receipts, active purchase orders and approved/in-transit transfers. Client-supplied material is excluded. A submitted order remains a pending commitment and must not be labelled stock.
3. A buyer opens the source requirement in its project context to request supplier quotes or create an order. The first slice does not claim cross-project order creation; that needs a shared source-aware form and the existing budget, supplier and approval gates.
4. Supplier enquiries and active orders appear in the same workspace queue with their project, supplier, status, quantity, unit and date. Their source IDs and project links remain stable. Receipts update the existing project record and inventory projection, not a duplicate global record.

## Read contract and rules

- Rows: source kind/ID, project ID/name, title, status, quantity/unit, due date, supplier when present, and a contextual link. No supplier cost or client price in this first projection.
- Source data: `project_execution.content.materials` and `.orders`, plus `project_stock_transfers`. Use the shared `materialInventory` calculation; do not recalculate shortages in UI or sum different units.
- Authorization: tenant filter on every query. A workspace manager sees active projects; another member sees only active project assignments. No cross-project supplier, stock or requirement leakage.
- Company warehouse balances are a separate inventory view and are returned only to members with buying or project-management permission. They are not added to project requirement quantities or treated as received project stock until a recorded transfer is accepted.
- Exclude archived projects and cancelled orders. Keep draft/submitted/approved/acknowledged orders distinct from supplier enquiries. Closed orders remain in project history, not the default actionable queue.
- Loading/error/empty states must be truthful. A later UI slice will add search/filter, role-safe actions, direct contextual editing and desktop/mobile/keyboard/RTL checks before the global Purchasing sidebar entry is considered finished.
