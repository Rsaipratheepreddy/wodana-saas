# Scoped operator access and tenant seat explanation

Verified locally on 18 September 2026. No live tenant, Palm data, provider, domain, email or deployment was used.

## Delivered

- Wodana operator authentication now resolves one current scoped role and an explicit permission list on every request.
- Compatibility `administrator` plus `platform_security_owner`, `provisioning_operator`, `account_billing_operator`, `domain_operator` and `support_observer` roles have separate policies.
- Every operator tenant and provisioning-draft endpoint declares a required permission; the permission guard fails closed when metadata is missing.
- Human operator identity continues through tenant commands and audit events.
- `workspace_seat_capacity(...)` is the single database calculation for active members, invited memberships, live pending invitations, reserved seats and available seats. Invite, acceptance, reactivation, cancellation/expiry release and limit-change paths lock the same workspace boundary.
- `GET /internal/operator/tenants/:externalTenantId/access` explains each member's direct roles, active-team inherited roles, granted/effective permissions, entitled modules and current organization-wide record scope. It also reports pending invitation role/team sources without tokens.
- The read model is inspection-only; it does not let Wodana operators silently change a customer's teams or tenant roles.

## Verification

- Business Core full suite: **150 files passed, 1 skipped; 850 tests passed, 10 skipped**.
- Business Core typecheck and production build passed.
- Disposable migrated database seat smoke passed:
  - concurrent seat reservation;
  - acceptance converts rather than double-counts a reservation;
  - suspension and invitation cancellation release capacity;
  - reactivation fails while full and succeeds after release;
  - billing reports the same reserved-seat total.
- Disposable migrated database operator smoke passed:
  - password/MFA/session and audit controls;
  - access explanation read;
  - live role change reflected by the existing session;
  - support observer read allowed;
  - billing mutation and support approval denied with 403.
- Migration, tenant-isolation verification, Business Core build and exact database cleanup ran inside both isolated smoke wrappers.
- `git diff --check` passed for the changed backend and smoke files.

## Honest boundary

This closes the CP03.1 local API gate. CP03.2 still needs the operator UI explanation and safe review actions. CP03.3 still needs tenant web/native acceptance for multi-team users, concurrent invitations, expiry/reactivation/revocation, last-owner protection and cross-tenant denial. Real Palm users and devices remain in P09 UAT.
