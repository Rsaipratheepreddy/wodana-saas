# P08.3 procurement, factory and site — local acceptance

Verified locally on 18 September 2026. No Palm tenant, provider, client invitation or deployment was changed.

## Connected operational truth

1. A purchase order retains ordered quantity, unit, price/currency commitment, supplier acknowledgement, promised date and lead time. Receipt evidence splits accepted/rejected quantities and accepted material becomes an inventory movement; it does not rewrite the approved project budget or commercial baseline.
2. Manufacturing can start only with released commercial truth, the before-production finance gate when configured, approved design/scope/material readiness, an active workshop/vendor, confirmed capacity and an acknowledged outside-factory order.
3. Approved factory output comes from independently reviewed daily evidence. Dispatch cannot exceed inspected output and must link a compatible factory predecessor to its exact receiving site task.
4. Dispatch is independently approved, records carrier/delivery-note evidence, and is then physically received by a different assigned site team member or authorized reviewer. The receipt accounts for the full quantity. Rejection creates a major snag and blocks replacement release until independently resolved.
5. Installation can proceed in phases, but approved installed output cannot exceed accepted site receipts. The baseline, received, installed and remaining quantities therefore stay explainable without mutating history.
6. Existing warehouse/project transfers retain reservation, dispatch, accepted/rejected receipt and rejection-disposition history. Existing supplier-return controls retain credit evidence, so inventory and finance facts are not replaced by a visual project status.

## Native assigned field work

- Projects is now a role-controlled native module rather than a web-only tile.
- Its API returns only assigned non-office tasks, dispatched deliveries and permitted acknowledged POs. The projection excludes supplier contacts, cost, currency, budget/margin, employee calendars/leave and broad project data.
- Assigned staff can submit task output for review, receive a dispatch, record a PO receipt when they have procurement permission, and attach camera evidence to their assigned task/receipt.
- Every mutation carries the current project revision and a stable request ID, then maps to the canonical project command. Existing optimistic concurrency, idempotency, permissions, independent review, inventory movement and audit behavior remain authoritative.
- The mobile proxy exposes only `field-queue`, bounded `field-actions` and stable evidence uploads; it does not expose unrestricted project execution writes.

## Automated verification

- Focused Business Core procurement/factory/site/field matrix: 4 files, 19 tests passed.
- Full Business Core regression: 130 files passed, 1 skipped; 772 tests passed, 10 skipped.
- Native app: 55 tests passed and TypeScript check passed.
- Native iOS and Android production JS exports completed successfully.
- Focused project web regression: 2 files, 16 tests passed; web TypeScript check passed.
- `git diff --check` passed.

## Honest boundary

This is local engineering acceptance, not a physical-device or Palm release. Native offline receipt/report/photo queuing, conflict resolution and the fast daily pulse are P08.4; signed builds and real-device camera/reconnect acceptance remain P09. This slice does not claim accounting-provider, logistics-provider or supplier delivery verification.
