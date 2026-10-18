# Materials and stock in the project flow

Implemented locally on 20 September 2026. This is an incremental extension of existing execution transactions, not a replacement ledger or a data reset.

## Reference alignment

Reviewed the original `/Users/saipratheep/Downloads/Project Flow Master Document.docx`, including its 18-stage flow and full field list, alongside `projects-redesign-plan-2026-09-20.md` and `projects-scope-v1.md`.

- Owner Review and Deal File remain upstream commercial gates. Inventory cannot release a project or approve expenditure.
- Material selection and approved BOQ define demand. BOQ selling quantities are not automatically a manufacturing bill of materials.
- Procurement checks existing accepted stock and approved incoming transfers before buying the shortage.
- Ready for Manufacturing retains technical, commercial, material and resource checks. A stock badge does not authorize manufacturing.
- Manufacturing uses the existing tasks, issued materials, reviewed output and dispatch records. Factory and site work can proceed in eligible batches independently.
- Installation uses accepted deliveries for the exact receiving task. Dispatch is not receipt or installation.
- Snagging, client acceptance, warranty and financial closure remain distinct existing controls.
- On Hold remains an overlay, not a compulsory pipeline stage.

The reference's studio-specific revision allowances and timelines are source requirements for configuration; this inventory change does not invent or override them. The document's suggestions to retire other trackers are not authorization to delete files or change external systems.

## Quantity ownership

`project-inventory.ts` is shared by the API, purchase-approval checks, stock transfers and UI. Material movements own physical stock. Purchase orders and approved transfers own incoming commitments; submitted purchase orders are shown separately as awaiting approval. Issues consume stock without creating a second shortage; unused returns restore on-hand quantity without counting as a second delivery. Reservations reduce available stock, not on-hand stock.

Factory output is a separate projection of reviewed factory output and dispatch records, preserving its own units. No raw-material quantity is converted to finished units by a guessed recipe. Factory output shows remaining to build, available at factory, reserved for approved dispatch, in transit, accepted at site and rejected output. Site acceptance is a cumulative receipt figure, not a claim that received items remain uninstalled.

Rejected factory output requires an explicit evidenced return and independently closed correction before it can be dispatched again. Closing a defect alone does not move stock. The return command records cumulative returned quantity, author, time and evidence; it cannot exceed rejected quantity.

## User actions

Material rows show the next action beside their name. The material modal holds stock quantities, reservations, orders and movement history. Check other stock opens a modal filtered to matching catalog identity, version and unit, and prefills the receiving material. Transfer receipt refreshes the project. Factory output opens the same work or dispatch/receipt modal already used by execution.

Order submission/approval and transfer approval check remaining demand including other incoming commitments. Both workflows acquire the same workspace stock lock before project locks to serialize competing commitments. Existing project revision checks, request replay protection and stock reservation rules remain in force.

## Verification boundaries

Targeted domain tests cover partial receipts, pending orders, incoming transfers, reservations, issues/returns, separate raw and finished quantities, partial factory delivery and rejected-output recovery. Existing execution and handoff tests remain applicable. Browser review uses existing operational records; no demonstration tasks, stock or purchase orders are inserted.

This does not implement automatic recipe backflushing, warehouse bin scanning, external accounting activation or supplier messaging. Material issues remain explicit verified transactions. General warehouse transfers require matching catalog materials; factory output continues through the existing factory dispatch/site receipt flow.
