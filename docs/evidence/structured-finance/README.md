# P06.3 structured-finance evidence

Verified locally on 18 September 2026. No deployment, provider write, Palm tenant mutation or invitation was performed.

## What is now true

- The accepted contract is bound to the CRM opportunity's active legal entity and contract currency. The agreement, generated payment milestones, provider invoices, receipts, allocations and credit notes carry that identity.
- A payment request is not a receipt. Client-supplied payment details remain evidence only and do not change accounting status.
- A provider balance of zero creates a `provider_confirmed` receipt and exact milestone allocation. It does not automatically become a finance-verified receipt.
- An authorized staff flow records a manual receipt first, then performs a separate finance-verification action. Release checks require the verified receipt and an unreversed full allocation in addition to provider freshness.
- Provider replay is idempotent. A reopened provider balance rejects the prior provider receipt, reverses its allocation, reopens the milestone and reopens project finance truth without rewriting accepted handover evidence.
- A verified deduction produces a first-class legal-entity credit-note record instead of only changing a generic credit flag.
- Provider invoice data remains adapter evidence. The structured ledger is Wodana's workflow truth; provider identifiers, connection identifiers and internal legal-entity IDs are removed from the client-safe payload.
- The staff payment table uses the shared bordered `DataGrid` and added receipt actions use shared design-system controls. It explicitly labels payment request, reported receipt, provider confirmation and finance verification.

## Automated verification

- Focused Business Core: `finance-ledger`, accounting invoice and project readiness/release — 15 tests passed.
- Full Business Core: 125 files passed, 1 skipped; 754 tests passed, 10 skipped.
- Focused web finance/commercial/client quote: 3 files, 9 tests passed.
- Full web serial: 145 files, 684 tests passed. One unrelated catalogue test that timed out only under the first parallel run passed alone and in the complete serial run.
- A dedicated `commercial.finance.verify` permission is assignable through existing roles; owner/administrator defaults are migrated for continuity, while manual receipt self-verification is rejected.
- Business Core and web TypeScript checks passed. Migration `0095` applied cleanly to a disposable database and created the finance permission exactly once.
- Changed web files passed ESLint; `git diff --check` passed.

## Acceptance boundary

This is the complete structural finance slice, but it is not a UAE or India tax-compliance certificate. `taxValidation` stays visibly `unvalidated`; Wodana does not calculate or claim authority-specific invoice compliance until D06 and a regional pack are signed off. Exact Palm assignment of the new Finance Verifier permission is tenant configuration/UAT, not assumed by code. P06.3 therefore remains a gated progress item on the delivery board rather than a compliance-ready release claim.

Native mobile has no finance-verification action in this slice: receipt verification is a controlled back-office action and remains web-first. Client payment links and status remain responsive and client-safe.
