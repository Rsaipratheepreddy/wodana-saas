# CP05.2 billing and usage UI acceptance

Verified locally on 18 September 2026 against a fresh migrated disposable account. No Palm Living data, provider, invoice or deployment was changed.

## Delivered

- Wodana Control shows the authoritative account contract, organization allocation, collection state, usage snapshots and document history in one concise billing timeline.
- Plan, recurring amount, capacity, next-bill basis, overdue amount and tax-verification status are visible without mixing commercial entitlement, organization allocation and platform availability.
- Contract, allocation and collection changes use the shared form controls and require a reason plus a shared confirmation dialog before mutation.
- Contract review shows before/after state, seats/projects, next bill and a deterministic current-period estimate only when the known dates support one. It never claims that a provider charge, credit or cancellation was created.
- Bordered shared `DataGrid` tables supply sorting, filtering, export, empty/loading behavior and responsive horizontal access; feature code contains no raw table or form controls.
- The tenant Billing page uses the same contract/usage/document projection with a concise access-policy explanation and without operator-only notes or references.

## Verification

- Full web suite: **162 files, 744/744 tests passed**.
- Web TypeScript check and production build passed; the billing BFF routes were included in the build.
- Focused billing/operator tests passed **17/17** before the full run.
- Changed-file ESLint and the feature raw-control scan passed.
- The disposable operator-web smoke completed MFA sign-in, loaded the real billing projection through the Next BFF, exercised billing history and rendered the review dialog.
- Playwright asserted responsive layout and captured light/dark desktop and mobile states plus the contract review.

## Captures

- [Desktop light](screenshots/cp05-billing-desktop-light.png)
- [Desktop dark](screenshots/cp05-billing-desktop-dark.png)
- [Mobile light](screenshots/cp05-billing-mobile-light.png)
- [Mobile dark](screenshots/cp05-billing-mobile-dark.png)
- [Contract review](screenshots/cp05-billing-review-desktop-light.png)

## Honest boundary

These captures and flows use synthetic local data. The UI previews known contract arithmetic; it does not invent provider proration or payment completion. Real Palm finance acceptance, provider receipts, regional tax review and deployment remain later gates.
