# Slice 1E — frozen supplier request scope

Journey: material requirement → separate RFQs for selected suppliers → supplier offers → select full/partial quantity → draft purchase order → existing approval controls. No messages are sent by creating a request.

New requests capture server-owned scope: capture time/person, project revision, material/task/BOQ IDs, catalog ID/version, title, specification, work title/area, requested quantity/unit/currency, required delivery and response deadline. Supplier portal and request inspector use this frozen scope. Request edits are blocked once captured; cancel and create a replacement to change scope. Existing legacy requests are not backfilled with invented historical data; they retain live fallback context until replaced, and cannot be edited after a supplier response.

Partial selection preserves original requested quantity. Selection validates all inputs before mutation and creates only a draft order; budget, commercial release and approval remain separate. Draft order quantity/date/pricing may be negotiated, but its frozen RFQ identity cannot be reassigned to another material, task, supplier or unit. Portal disclosure remains limited to supplier-facing fields.

UI: existing Items/Offers inspector and tables, no additional main tab. Frozen original quantity appears as a compact fact after selection; immutable request edit action is hidden. Current table grids remain intact. API: existing execution commands and restricted vendor endpoint; optional snapshot supports stored legacy records without a migration.

Remaining separate slices: explicit RFQ revision/supersession, selected offer identity, cross-supplier split awards, quote expiry/tax/freight/payment terms, and execution-task global aggregation. This is scope preservation, not the complete procurement roadmap.

Implemented locally: server-owned RFQ snapshot, immutable request scope, supplier portal frozen specification, original quantity on partially selected order, atomic award validation, cancelled quote badge, and request cancellation entry point with reason. New request creation does not backfill legacy snapshots. Inspector preserves the existing Items / Offers / Notes structure and bordered tables.

Validation: 59 focused backend tests and 27 focused UI tests passed; desktop/mobile browser checks cover both global approvals and the RFQ inspector (4 passed), including keyboard tabs, RTL, table borders and overflow. Screenshots inspected. Final verification after cancellation wiring: both TypeScript checks, targeted lint, all 59 backend tests, all 27 UI tests and all four browser checks passed. No real supplier link was issued or message sent, and no customer data was changed.
