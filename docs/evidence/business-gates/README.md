# P06.4 — four business gates

Local engineering acceptance on 18 September 2026. No Palm tenant, live provider, deployment or production record was changed.

## Product decisions implemented

1. **H1 · Owner Review** is independent of receipt timing. An authorized reviewer still needs the accepted quotation, executed matching agreement, truthful checklist and exact material approvals. The submitter cannot approve their own review.
2. **H2 · Release receipt** is mandatory. An empty `requiredForRelease` set is never treated as success. At least one accepted payment milestone must be marked for release, and the linked receipt must be finance verified, fully allocated, operational, and bound to the contract legal entity and currency.
3. **H3 · Production receipt** is explicit. `requiredForProduction` is stored on the accepted payment milestone and copied into the agreement payment and frozen project baseline. It is never guessed from a milestone title or free-text trigger. Starting a factory task rechecks all applicable milestones against finance-verified receipt/allocation truth.
4. **H4 · Client acceptance** remains required before completion. Completion already requires every immutable handover pack to be accepted, all outstanding commitments to be resolved or transferred to warranty, physical work closed and final finance reconciled. Portal acceptance remains purpose-bound; the signed-record fallback records the named client signatory and evidence on the current pack.

## UX contract

- Payment schedule tables show separate “Before release” and “Before production” controls.
- Client quotation documents display both contracted gate purposes.
- Agreement payment tables explain whether a row is only a request, receipt reported, provider confirmed or finance verified.
- The release checklist no longer shows an empty payment schedule as ready.

## Override policy

No generic warning override is shipped in this slice. Security, source-version, accounting, receipt/allocation, physical quantity and client-acceptance truths remain non-overrideable. A future exception must be a named server rule with a dedicated permission, reason, affected scope, source version and audit record; it cannot be a frontend bypass.

## Verification

- Focused Business Core gate/domain/release tests: 4 files, 29 tests.
- Focused web payment/release tests: 4 files, 20 tests.
- Full Business Core suite: 126 files passed, 1 skipped; 757 tests passed, 10 skipped.
- Full serial web suite: 145 files and 684 tests passed.
- Business Core and web TypeScript checks passed.
- Changed web files linted with no errors; two existing `img` optimization warnings remain in the quotation document.
- `git diff --check` passed.

Regional tax validation, real accounting-provider reconciliation, physical-device UAT and Palm tenant acceptance remain release gates and are not claimed here.
