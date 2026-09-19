# CP04.2 commercial entitlement UI acceptance

Verified locally on 18 September 2026 against a fresh migrated disposable database and synthetic customer account. No Palm Living data, provider, invitation, domain or deployment was changed.

## Delivered

- Wodana Control presents the three entitlement concerns separately: modules sold by the account contract, modules allocated to the organization, and unfinished platform capability exceptions.
- The bordered shared `DataGrid` shows every product module as **Included / Not included**, **Enabled / Not allocated**, and **Available / Internal preview / Unavailable** without implying that a provider is connected.
- Sold seat/project limits, the allocation source and effective date remain visible beside the module matrix.
- Plan versions come from the backend catalogue. A legacy plan without module metadata is labelled as an explicit commercial override rather than having capabilities inferred from its name.
- Operators can schedule, suspend or restore an allocation, select only sold modules, inherit or override sold limits, set an optional end date and record the required reason.
- The shared confirmation dialog shows plan, state, modules added/removed, effective period and limits before any mutation. Its copy explains that access changes affect web, mobile and API entry points while records remain retained.
- Immutable allocation history and independent platform capability exceptions stay visible below the editor.

## Verification

- Focused web tests: **3 files, 14 tests passed**, including catalogue proxying, sold/allocated/unavailable rendering and review-before-apply behavior.
- Web TypeScript check and production build passed; both entitlement BFF routes were included.
- Changed-file ESLint passed with no warnings or errors.
- Feature-scope raw-control scan returned no raw `<table>`, `<button>`, `<input>`, `<select>` or `<dialog>` in the entitlement feature or its BFF routes.
- The disposable operator-web smoke applied all migrations, exercised the authenticated operator/API flow and rendered the real entitlement projection through the Next BFF.
- Playwright asserted no document-level horizontal overflow and captured desktop/mobile light/dark states plus the before/after confirmation dialog.
- Smoke teardown removed the synthetic database, web build and local services.
- `git diff --check` passed before this evidence update.

## Captures

- [Desktop light](screenshots/cp04-entitlements-desktop-light.png)
- [Desktop dark](screenshots/cp04-entitlements-desktop-dark.png)
- [Mobile light](screenshots/cp04-entitlements-mobile-light.png)
- [Mobile dark](screenshots/cp04-entitlements-mobile-dark.png)
- [Allocation review](screenshots/cp04-entitlement-review-desktop-light.png)

## Honest boundary

This closes the local CP04.2 operator UI gate. CP04.3 still has to prove the same downgrade, suspension and restoration behavior in tenant web navigation, direct URLs, API commands, native navigation and stale offline queues. Capability flags describe Wodana release availability; they do not certify any external provider connection. Palm/live data, real providers, physical devices and deployment remain P09 release gates.
