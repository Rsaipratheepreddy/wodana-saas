# Slice 1H — controlled order amendments before fulfilment

Journey: approved/acknowledged order → Amendments → propose revised unit price and delivery date with supplier evidence/reason → independent reviewer sees before/after totals → approve or reject; proposer can withdraw. Approval rechecks release, budget, current terms and fulfilment, then updates the order and requires supplier acknowledgement again. Until approval, current order terms remain authoritative in staff and supplier views.

Boundary: quantity, supplier, item, unit and currency remain fixed. Orders with receipts, shipment records, supplier progress/delivery updates, returns or invoices cannot use this first amendment flow. Amendments after fulfilment need line-level financial adjustments/credits; they are not silently applied to historical receipts or invoices. Closed/cancelled orders cannot propose or approve changes. Only one pending proposal is allowed.

Record: ID, status, creator/time, reason, supplier evidence, original quantity/rate/date/currency, proposed rate/date, reviewer/time and decision note. Approved/rejected/withdrawn proposals remain immutable history. Approval requires review permission, a different actor, current project release, open final account and sufficient operational budget including every other approved/acknowledged/closed order. Failed checks do not mutate the order or proposal. Existing command revision/idempotency/project locking remains mandatory.

UI: existing order inspector gets an Amendments sub-tab; compact full-grid before/after table, before-tax totals and delta, state, evidence and contextual approve/reject/withdraw actions. Proposal dialog uses existing fields. No global main tab. Pending amendments stay local to the order in this slice; projection into the global task queue remains outstanding.

API: order_amendment, order_amendment_decide through existing execution command. No supplier messages, stock updates, payments or invoices are generated. Selected quote and original RFQ snapshots remain historical evidence.

## Verification

Implemented locally. 36 focused backend tests, 8 UI tests and 2 desktop/mobile browser checks passed. Both TypeScript checks and targeted amendment/inspector lint passed. Before/after table screenshots inspected; browser checks exercise keyboard access to Amendments and independent approval dialog, RTL layout and page overflow. Backend tests cover unchanged live terms while pending, independent reviewer enforcement, budget replacement calculation, stale terms, fulfilment appearing after proposal, release/final-account guards, rejection, withdrawal and repeated decisions. Fixtures only; no live database changes, supplier messages or deployment.

Next: project/global approval projection for pending amendments and explicit reviewer ownership. Post-fulfilment amendments, quantity changes, credits and change-order accounting remain outside this slice. Current proposals are found under each order's Amendments tab.
