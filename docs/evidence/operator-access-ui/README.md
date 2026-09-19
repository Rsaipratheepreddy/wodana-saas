# Operator access and seat UI

Verified locally on 18 September 2026 against a fresh migrated disposable database. No Palm/live tenant, provider, domain, email or deployment was used.

## Delivered

- The Wodana Control tenant inspector explains active, invited and pending seat reservations as **used / reserved / available** values from the authoritative access response.
- The shared `DataGrid` lists each accepted member with direct-role and active-team inheritance, effective modules and membership state. Pending invitations are summarized separately and never expose their token.
- The UI explicitly preserves the ownership boundary: Wodana operators may inspect why access exists; tenant administrators own teams, tenant roles and member offboarding.
- Tenant billing, seat limits and workspace state use one **Review changes** action. The shared confirmation dialog shows only changed fields with before/after values before the audited command runs.
- Platform capabilities now control every operator action. A support observer can read tenant/access facts and request time-boxed support, but cannot provision, change billing or entitlements, approve support, change domains or execute data operations.
- The tenant-operations screen uses the same capability policy and shows concise read-only states instead of misleading disabled forms.

## Verification

- Web typecheck passed.
- Focused web tests: **5 files, 23 tests passed** for the portal, tenant operations, access BFF, internal proxy and shared components.
- Changed-file ESLint passed with no warnings or errors.
- Production web build passed; `/api/internal/tenants/[externalTenantId]/access` and all operator routes were included.
- Feature-scope raw-control scan returned no raw `<table>`, `<button>`, `<input>` or `<select>` in `app/internal` or `app/api/internal`.
- The disposable operator-web smoke passed password/MFA/session checks, the authenticated Next BFF, scoped operator denials, tenant operations and the rendered access/review path.
- Playwright checked no horizontal overflow and captured:
  - desktop light/dark access inspector;
  - 390×844 mobile light/dark access inspector;
  - desktop before/after review dialog.
- Smoke teardown removed the synthetic database, web build and local services.
- `git diff --check` passed before this evidence update.

## Captures

- [Desktop light](screenshots/cp03-access-desktop-light.png)
- [Desktop dark](screenshots/cp03-access-desktop-dark.png)
- [Mobile light](screenshots/cp03-access-mobile-light.png)
- [Mobile dark](screenshots/cp03-access-mobile-dark.png)
- [Seat-limit review](screenshots/cp03-review-desktop-light.png)

## Honest boundary

This closes the local CP03.2 operator UI gate. Member offboarding remains a tenant-administrator action rather than an internal-operator shortcut. CP03.3 must prove tenant web/native enforcement for team inheritance, capacity races, expiry, reactivation, revocation, last-owner protection and cross-tenant denial. Real Palm users and physical devices remain P09 UAT gates.
