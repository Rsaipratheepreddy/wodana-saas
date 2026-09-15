# MFA backend release contract — 15 September 2026

This slice adds generic staff multi-factor authentication to Wodana Business Core. It does not
change client-portal OTP behavior and does not connect the web screens yet.

## Behavior

- TOTP setup uses a ten-minute enrollment secret and a standard `otpauth://` URI.
- Successful confirmation returns ten one-time recovery codes and invalidates older access tokens.
- Password login for an enrolled user returns a five-minute, one-use MFA challenge instead of a
  session until TOTP or a recovery code is verified.
- TOTP steps cannot be replayed. Recovery codes are single-use. Five failed factor attempts lock
  verification for fifteen minutes.
- Customer-account owners and administrators require MFA by default. Other members may enroll
  voluntarily. Required users receive a seven-day grace period, including users with active
  sessions when migration 0059 is applied.
- Refresh-token rotation preserves authentication assurance. MFA enrollment or disablement changes
  the user security version so older access and refresh sessions are rejected.
- Recovery-code regeneration and optional disablement require recent MFA. Required administrators
  cannot disable MFA.

## Storage and configuration

TOTP secrets are encrypted with AES-256-GCM. Recovery codes are normalized and stored as HMAC-SHA256
hashes. Login challenge tokens are random 256-bit values and only their SHA-256 hashes are stored.

Production password authentication requires `MFA_ENCRYPTION_KEY`, a 32-byte value encoded as 64 hex
characters or base64url. Generate the production value in the deployment secret manager; do not
reuse the development key. `MFA_ENCRYPTION_KEY_VERSION`, `MFA_TOTP_ISSUER`, and
`MFA_STEP_UP_MINUTES` have validated defaults.

## Verification

Run the full non-database regression gate:

```bash
npm run verify:backend
```

Against a disposable migrated PostgreSQL database and running Business Core, run:

```bash
MFA_TEST_DATABASE_URL=postgresql:///wodana_mfa \
  npm run test:smoke:mfa --workspace @wodana/business-core
```

The clean replay produces 156 public tables across 59 registered migrations. The focused acceptance
test covers policy grace, enrollment, replay defenses, recovery, challenge, refresh assurance,
session invalidation, bounded factor-attempt locking, required-policy disable denial, and
plaintext-storage checks.

## Frontend handoff

The next slice is limited to the login challenge, mandatory-enrollment gate, authenticator setup,
one-time recovery-code acknowledgement, security status, step-up prompt, and friendly expired or
locked states. The frontend must replace its stored access token whenever confirm or step-up returns
a new token, while keeping the current refresh token unless the login challenge returns a new
session.
