# Project procurement and inventory: production data contract

Status: implementation plan. The current source of truth is **not** yet migrated to the target tables below.

## Verified current state

- `delivery_projects` owns project identity and tenant scoping. `project_execution` stores a revisioned `ProjectData` JSON document; its `materials` and `orders` arrays currently own requirements, supplier requests, purchase orders, receipts, and project material movements.
- `project_warehouse_stock` stores warehouse balances; `project_stock_transfers` stores tenant-scoped transfer records. A committed transfer covers a requirement once, and an accepted receipt becomes stock only after inspection.
- `materialInventory` and `orderReceivingPosition` are the shared quantity calculations. The cross-project Purchasing and Inventory pages are read-only projections of these source records. A buyer can follow a row into the owning project to act.
- A project `Order` currently contains one material/task link. This cannot be presented as a completed cross-project, multi-line purchasing workflow.

## Target boundaries

| Record | Required identity and relationships | Critical controls |
| --- | --- | --- |
| Material requirement | Tenant + project + requirement ID; optional BOQ line, task, catalog item/version; quantity, unit, need-by, supply owner | Snapshot the released specification; revisions must not silently rewrite an approved order. |
| Supplier request and offers | Request ID + one or more requirement lines; supplier IDs; offer versions and evidence | Preserve every response and comparison; selected offer must be explicit and auditable. |
| Purchase order and lines | Tenant + PO ID; supplier, buyer, ship-to, terms; each line linked to its source requirement and project | Separate draft, submitted, approved, acknowledged, closed, cancelled; approval and amendment history cannot be overwritten. Partial order and split-supplier quantities must be supported. |
| Shipment and receipt | PO line ID; shipment reference, expected/actual date; accepted, rejected, pending inspection; receiving person/evidence | Accepted + rejected + pending must equal measured arrival. Receiver cannot approve their own pending inspection. Pending/rejected stock is never available. |
| Stock movement and reservation | Immutable event ID; catalog identity/version, location, unit, quantity, source document, actor/time | Receipt, issue, return, waste, transfer and reservation are ledger events; no hidden balance edits or negative available stock. Idempotent commands and transaction locks protect concurrent writes. |
| Action/alert projection | Source type + source ID, owner/role, due date, severity, deep link | Derive from live source states and quantities; do not seed a second, manually maintained “things to do” list. Clear automatically when the condition resolves. |

All tenant-owned rows need composite tenant-scoped foreign keys, row-level security, created/updated timestamps, actor IDs where a decision occurs, optimistic revision or idempotency protection, and tenant-safe indexes for project, supplier, status, and need-by queries. Financial columns must remain permission-gated in reads and exports.

## Safe transition (no client-data reset)

1. Freeze the current command contracts and record representative real cases: one requirement split across suppliers, partial receipt and independent QC, returned goods, transfer, overdue delivery, and a cancelled order.
2. Add normalized tables with constraints and tenant isolation; do not drop or rewrite `project_execution` yet. Backfill into the new tables from a consistent revisioned snapshot and reconcile counts, quantities, source IDs, and approval histories.
3. Write both representations in the same transaction, using existing command IDs for idempotency. Compare old and new read projections in shadow mode, including concurrent order/receipt/transfer operations.
4. Switch one read surface at a time: project requirement detail, then cross-project Purchasing, then Inventory and alerts. Roll back reads without deleting either representation if reconciliation fails.
5. Only remove legacy JSON fields after client acceptance, retention/export checks, and a separately approved migration. No destructive migration is part of Monday onboarding.

## Module acceptance gate

- From a released project requirement, a buyer can check matching warehouse/site stock, request multiple supplier offers, compare them, issue a partial or full PO, and see exact remaining demand without opening unrelated projects.
- A reviewer can approve/reject within authority; another person records and inspects delivery. Partial, rejected, pending-QC, returned, and transferred quantities remain distinct and reconcile to the order and stock ledger.
- The cross-project queue gives each permitted user a direct source action; project and inventory balances agree after refresh; alerts have an owner, explanation, priority, and working deep link and disappear when resolved.
- Tests cover tenant isolation, role separation, duplicate requests, concurrent receipts/transfers, numeric precision, unavailable catalog items, empty/error states, keyboard and mobile use, and no text truncation.
