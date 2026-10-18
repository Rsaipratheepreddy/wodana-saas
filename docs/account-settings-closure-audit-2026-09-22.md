# Account settings local closure audit

## Scope and journey

Account menu → Sign-in security → inspect current device and other active sessions → explicitly confirmed session action. Authenticator setup and recovery remain behind their existing confirmation and step-up flows. Organization administration remains distinct: company profile → workspace requests → request status or cancellation.

Important fields are account name/email, MFA enabled/required state, enrollment deadline, remaining recovery codes, device/browser, IP address and last activity. Organization requests retain name, registered name, entity code, reason, status and optimistic version.

API dependencies: `/api/auth/mfa/*`, `/api/workspace/security/sessions/:familyId`, `/api/workspace/organization-requests` and its cancellation endpoint. Existing backend authorization is retained. No real credentials, security settings, sessions or external messages will be changed during this audit.

## Implemented

- Failed organization cancellation now presents its error on the visible page and leaves the pending request available to retry. Previously the error was rendered only inside the closed request form.
- Recovery/setup copy actions now show manual-copy instructions when clipboard access is absent or fails; codes remain selectable and the saved-code acknowledgement is still required.
- Successful MFA disable now removes revoked sessions from the active-device display, retaining the current device. Confirmed against the existing backend behavior in `local-auth.service.ts`; no backend security policy changed.
- Current-device and MFA status use shared pale badges; pending organization requests use the warning tone. The session table uses the shared complete table grid.

## Verification and remaining scope

- Four web suites passed: `security-page`, `organization-account-panel`, `company-profile` and `workspace-account-menu`: **16 tests**. New regression coverage checks unavailable clipboard behavior, device-state synchronization after mocked successful MFA disable, and visible cancellation failures without losing the request.
- Web `tsc --noEmit` passed. Targeted ESLint passed after removing an unused helper.
- All mutation tests use mocked network responses. No actual password, MFA, session or organization changes, credential disclosure, or external messages occurred.
- Remaining: live-browser desktop/keyboard/RTL review of these settings, isolated company-profile/workspace-request mutation acceptance, and any requested account features beyond existing company profile, workspace requests, security and audit history. Self-service personal profile/password change is not implemented by this audit. Mobile application work is out of scope.

## Persisted account-security API acceptance

Added `scripts/smoke-account-security-isolated.mjs` and `services/business-core/scripts/smoke-account-security.mjs`. Run with `node scripts/smoke-account-security-isolated.mjs`. The runner starts a fresh PostgreSQL instance, applies all migrations, builds and copies the API to a temporary directory, uses random test signing/encryption keys and a new `@wodana.invalid` account, and stops its database afterward. The scenario refuses non-loopback URLs and databases outside its disposable naming prefix. Email credentials are absent; existing preview users and sessions are never used.

Passed on 22 September 2026: `docs/qa-projects/account-2026-09-22T08-11-20.175Z/security.json` with `ok: true`. Environment evidence confirms `databaseStopped: true` and `externalMessages: false`.

Verified through real local HTTP requests and persisted database state:

1. Password account enrollment into MFA invalidates the prior access token.
2. Session query distinguishes the current device from other sessions; attempting to revoke the current session is rejected.
3. Required administrator MFA cannot be disabled.
4. After explicitly making only the disposable fixture's policy optional, disabling MFA retains the current session and removes the other device. Both the other device's refresh and access token are rejected, while the current session still refreshes successfully.
5. The disable action produces a persisted `mfa.disabled` audit event.

The existing generic MFA smoke was intentionally not used because it assumes a hardcoded demo tenant. The new runner uses a fresh synthetic account and prints no MFA factors, passwords or tokens. No runtime implementation defect was found in the tested backend session behavior; the earlier change corrects the web UI's stale display.

Additional backend regression suites passed: `local-auth.security`, `mfa-crypto`, `session-policy`, and `local-auth.domain`: **12 tests across four suites**. Both new JavaScript scripts passed `node --check`.

## White Company/account surfaces

Scoped light-theme overrides in `company-profile.module.css`, `workspace-configuration-page.module.css`, `security-page.module.css`, and `audit-log-page.module.css` make page and passive surface backgrounds white, with neutral hover feedback. Pale semantic badges and branded action colors are unchanged. Dark theme is unaffected. Shared shell canvas/tab-bar coordination is owned separately by the root agent.

Rechecked five web suites including audit history: **19 tests passed**. Targeted ESLint for Company, Configuration, Security and Audit components passed.

This is a bounded account-settings audit; it does not assert all account management capabilities or a full production security audit are complete.
