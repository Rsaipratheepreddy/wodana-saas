# Wodana operator authentication — CP00.5 implementation contract

**Status:** implemented and verified locally on 17 September 2026; not deployed or production release-ready.

The Wodana control plane is an operator product, not a special customer workspace. `/internal` must never require an active `workspace_memberships` row, tenant branding, a tenant slug, or customer onboarding. Reuse `users`, `local_auth_credentials`, `user_mfa_credentials`, and active `platform_administrators` rows as identity sources; do not grant customer workspace membership as a bootstrap shortcut.

## Why the current login cannot be reused unchanged

- `LocalAuthService.login` selects `tenant_login_branding` and an active workspace membership after password verification.
- `MfaService.beginPrimaryAuthentication` and `consumeLoginChallenge` require a workspace ID; `auth_mfa_challenges.workspace_id` is non-null and verification rechecks tenant membership.
- `auth_refresh_sessions` and its JWTs have no operator-vs-tenant scope. The local JWT audience is `wodana-web`, so sharing it would let control-plane credentials reach tenant APIs unless every path is re-audited.
- The Next `/internal` page and BFF currently call tenant `/me` with `wodana_access`; the BFF then forwards a service secret. Business Core does not independently know the human operator for these calls, and subscription audit currently has a null actor.

## Target boundary and migration

1. Add separate, short-lived, hashed **platform challenge** and **platform session** records. Scope these to an active platform administrator and the current password/MFA version. Use a distinct HttpOnly, Secure, SameSite=Strict operator cookie. Do not reuse `wodana_access`, `wodana_refresh`, tenant JWT audience, or selected-workspace cookie. Sessions must be revocable and fail immediately when administrator status, user status, password or MFA version changes.
2. `POST /auth/platform/login` verifies a local password with the existing lockout policy and active platform role, then creates a short-lived MFA challenge. An operator with no active MFA can use only a short-lived password-bound enrollment challenge; no control-plane session is issued until TOTP is confirmed. Reuse the existing encrypted TOTP/recovery credentials and factor verifier, but emit platform events with no workspace ID. Challenge attempts, replay and expiry must be enforced transactionally.
3. `POST /auth/platform/mfa/verify` accepts TOTP or a recovery code and issues the platform session. Enrollment start/confirm expose the secret and one-time recovery codes only to the password-bound operator, never to the tenant login or another browser. Require MFA on *every* platform session; no grace period for control-plane data.
4. `GET /auth/platform/session` and `POST /auth/platform/logout` validate/revoke only platform sessions. The internal Next page redirects missing or expired operator sessions to a Wodana-branded `/internal/sign-in`, never to `/login`. Tenant workspace pages and APIs continue using only tenant sessions; a platform session must not imply tenant membership or support impersonation.
5. The Next internal BFF verifies the operator session on every request, checks origin/CSRF for writes, forwards both the server-held service credential and the operator assertion to Business Core, and never exposes either token in HTML or JSON. Business Core independently validates the operator assertion and the active platform role for human control-plane routes. Machine-only jobs get explicit separate service endpoints; they must not be disguised as a human operator.
6. Attribute every provisioning, invitation rotation, account limit, access and billing command to the real operator ID and correlation ID. Use a platform audit record for global/account commands and the tenant audit record with `actor_user_id` for organization changes. Do not silently backfill a null actor as the tenant owner. Existing active `platform_administrators` rows remain the authorization roster; migrate credentials/MFA without creating tenant memberships. Operators who lack credentials need an explicit secure setup path.

## Required tests and acceptance

- Password, lockout, unconfigured MFA enrollment, TOTP, recovery code, expired/replayed/over-attempted challenge, logout and session expiry.
- User/admin suspension and password/MFA change revoke access; tenant session cannot access `/internal`, platform session cannot access tenant `/me` or workspace APIs.
- No active tenant membership is needed to reach the control plane; a user with only tenant membership is denied before Business Core management is called.
- CSRF/forged Origin, missing service secret, missing/forged operator assertion, cross-tenant target, stale version and duplicate provisioning are denied or retried safely.
- A synthetic local operator signs in, passes MFA, reads an account/organization, and executes one audited management command. Check the operator ID in both platform and workspace audit records. Test light/dark and mobile sign-in. No Palm live data, production credential or deployment is involved.

Do not mark CP00.5 complete from a sign-in mock or a page screenshot. The database migration, Business Core checks, Next cookie/BFF, audit and real local path must pass together.

## Local implementation and evidence

- Migration `0078_platform_operator_auth.sql` adds separate hashed operator challenges/sessions and a platform audit table. It was applied only to local `wodana` PostgreSQL.
- Business Core has `/auth/platform/*` password, enrollment, MFA, session and logout routes. Existing active `platform_administrators` and local credentials are the roster; no customer membership or tenant branding is consulted. Every session requires confirmed MFA, and session validation rechecks user/admin status, exact password-change timestamp and MFA version. The new `/internal/operator/tenants/*` routes require **both** the service credential and a separately validated operator session. Existing `/internal/tenants/*` routes remain service-only machine APIs; the web portal no longer calls them.
- Next uses a distinct `wodana_operator` HttpOnly, SameSite=Strict cookie and a `/internal/sign-in` page. Its BFF strips the operator token from JSON, checks write origins, validates the operator session per request and forwards the server-held service credential plus operator assertion. Customer `wodana_access`/`wodana_refresh` cookies do not grant internal access.
- Management, provisioning and owner-invitation commands on the operator route write the real operator ID and one correlation ID into tenant and platform audit records. The local smoke executed a synthetic management change and verified both records. The synthetic workspace, operator, and their audit records were removed after the test; the test-only cleanup restores the append-only audit trigger in the same local transaction.
- The local-only interactive `scripts/provision-local-operator.mjs` creates an operator with a hidden password prompt, or attaches local credentials to an **existing active** platform administrator without granting tenant access. It refuses an existing non-operator and an already-credentialed operator. New and existing-admin paths were exercised locally with synthetic accounts and cleaned up.
- Focused Business Core specs, web BFF/portal specs, TypeScript builds and the production web build passed. The local API + web smoke covers MFA setup, TOTP, recovery code, failed-factor/password lockout, challenge expiry/replay, session expiry/logout, suspension, password/MFA version invalidation, missing/forged assertion, tenant `/me` denial, web cookie/BFF and audited command. Playwright sign-in tests passed on desktop and mobile in light/dark mode. No Palm or production data was touched.

Remaining release gates outside CP00.5: provision real Wodana operator credentials through an approved production process; deploy migration/API/web together; verify production email/provider, TLS/cookie and rollback; finish the broader CP00.6 tenant-app effects. The local bootstrap tool intentionally refuses remote database hosts.
