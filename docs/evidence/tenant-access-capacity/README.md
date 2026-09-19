# CP03.3 tenant access and capacity acceptance

Verified locally on 18 September 2026 with synthetic tenants only. No Palm Living data, invitations, provider connection or deployment was changed.

## Accepted behavior

- Tenant admins can invite a person with team access only; the web BFF now preserves `teamIds` and does not invent a direct role.
- A member may have no direct role when an active assigned team supplies access. The web BFF forwards that exact state for authoritative backend validation.
- The people directory explains direct plus inherited access and assigned teams. Any member role/status edit opens one compact before/after review before a write occurs.
- Suspension warns that access ends immediately and the seat is released; reactivation is rejected when capacity is full. The backend remains the seat authority.
- `/me` resolves the union of roles and modules from multiple active teams. Native mobile consumes that effective summary and fails closed on malformed roles or modules instead of guessing locally.
- Concurrent invitations reserve seats atomically. Acceptance preserves the reservation; suspension, cancellation and expiry release it; replacement invitations can reuse the capacity; billing reports the same total.
- Member revocation, suspended organizations and foreign-tenant reads are denied. Concurrent last-owner removal is rejected.

## Automated evidence

- Web member/invitation routes and member screen: 3 files, 13 tests passed.
- Web typecheck, changed-file ESLint and optimized production build passed.
- Native mobile: 73 tests passed; typecheck passed. The added cases cover inherited role/module unions and malformed effective-access denial.
- Disposable migrated PostgreSQL app-effect smoke passed: two-team role union, CRM + Projects module union, same-account organizations, brand effect, foreign-account denial, organization suspension and member revocation.
- Disposable seat smoke passed: concurrent reservation, acceptance, suspension, capacity-blocked reactivation, cancellation, expiry reuse and billing consistency.
- Disposable workspace smoke passed 19 named safeguards, including tenant isolation, ownership transfer, concurrent invitation acceptance, last-owner protection and concurrent last-owner protection.
- Feature raw-element scan found no raw `table`, `button`, `input` or `select` in the changed member feature. Shared `GroupedTable`, form fields, buttons, menus and dialogs are reused.
- `git diff --check` passed after implementation.

## Visual evidence

- [Desktop member directory](screenshots/members-desktop-light.png)
- [Review-before-apply access diff](screenshots/member-access-review-desktop-light.png)
- [Mobile dark member directory](screenshots/members-mobile-dark.png)

The captures use the explicit local `E2E_AUTH_BYPASS` fixture and verify layout only. Desktop and 390 px mobile had no document-level horizontal overflow. Authentication and authorization claims come from the database-backed smokes above, not from these screenshots.

## Remaining release gates

- Real Palm team membership, named approvers and seat allocation require authorized Palm clone/live UAT.
- Physical iOS/Android device behavior, provider delivery receipts and deployment remain P09 gates.
- Sold-plan entitlement intersection is CP04; this slice proves tenant roles, teams and capacity and does not label an unconfigured commercial module as sold.
