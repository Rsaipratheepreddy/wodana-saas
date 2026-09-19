# CP05.1 account billing authority acceptance

Verified locally on 18 September 2026 with disposable synthetic accounts and organizations. No Palm Living data, payment provider, tax filing, invitation or deployment was changed.

## Accepted contract

- The versioned account contract is the commercial billing authority. Existing organization subscriptions are represented as allocations and cannot silently redefine account terms.
- Contract, organization allocation, usage snapshot and collection state each keep immutable effective history with the responsible operator and reason.
- Invoices, credit notes and receipts share one document model. Idempotency stores the event payload hash, so an exact provider retry is safe while a conflicting replay is rejected.
- Provider notification and finance verification remain separate facts. A provider cannot mark its own receipt as finance verified, and a refund requires an existing paid or verified document.
- Collection history supports current, grace, past-due and collections truth without changing sold modules or tenant lifecycle as a side effect.
- Legal-entity references may be recorded, but regional tax treatment remains explicitly `unverified` until an accepted region pack and compliance evidence exist.

## Verification

- Full Business Core suite: **151 files passed, 1 skipped; 865 tests passed, 10 skipped**.
- Business Core typecheck and production build passed.
- Focused billing/domain/operator suites passed **18/18 tests**.
- A fresh disposable database applied every migration through `0108_account_billing_authority.sql` and passed tenant-isolation verification.
- Authenticated operator smoke proved contract/allocation/usage/collection history, exact invoice replay, conflicting replay rejection, provider verification denial, explicit finance verification, refund, orphan-refund denial, past-due state and current-state recovery.
- Public operator and tenant projections explicitly map allowed fields rather than returning database rows. Private metadata, external references and internal collection reasons are not leaked into tenant billing responses.

## Honest boundary

This is local billing truth, not a payment processor. It creates no provider charge, receipt, tax filing or legal compliance claim. Real provider webhooks, finance reconciliation, regional tax acceptance, Palm clone/live data and deployment remain release gates.
