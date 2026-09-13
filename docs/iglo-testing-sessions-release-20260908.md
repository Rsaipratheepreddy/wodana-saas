# Iglo testing sessions — 8 September 2026

Iglo testing accounts can sign in from more than two browsers or devices. The exception is configured with explicit verified user UUIDs in `AUTH_DEVICE_LIMIT_EXEMPT_USER_IDS`. It changes the concurrent-device cap consistently during login, refresh, API authentication and the security policy response. It does not change passwords, token expiry, workspace permissions, revocation or logout.

The production allowlist was resolved from the 26 current active members of the active Iglo workspace (`d004d45c-7140-4b0c-a68d-e87d012c2390`, login slug `iglo`). It is recorded in the protected release directory. Accounts outside the list retain the two-device cap. New testers must be explicitly added to the list.

## Checks

- 36 authentication/configuration tests pass, including ten PostgreSQL tests in a disposable local schema.
- Six concurrent logins work for an exempt test account. Refresh, logout and revocation work; a different account retains its cap. Invalid passwords and wrong-tenant logins fail. Removing the exception restores the cap.
- Runtime configuration rejects wildcards, emails and malformed user IDs.
- Backend build and web type check pass. The deployed quotation UI image is reused unchanged.
- Staged and public checks verify the compiled server policy with temporary session rows rolled back, and verify both anonymous rejection and authenticated browser access.

## Deployment

- Release: `/opt/wodana/releases/20260908-iglo-testing-sessions`.
- Backend/web: 18120/13160; preceding quotation-polish services remain available for rollback.
- Pre-release backup: `/var/backups/wodana/current/release-20260908T083227Z`.
- Live checks passed: four authentication checks and three browser checks, with no browser errors and no retained verification sessions.
- Post-release backup: `/var/backups/wodana/current/release-20260908T083921Z`. Scheduled backups include the explicit testing-account policy and rollback configuration.
- No schema migration or user/password changes.
- To end testing, remove the user IDs from the backend environment setting and recreate that backend service. Existing over-limit accounts will then need to sign out extra devices using the usual device picker.
