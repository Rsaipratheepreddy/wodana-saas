# P09.1 — mobile operational readiness progress

Date: 18 September 2026  
Status: engineering safeguards complete; signed-build and physical-device acceptance remain open.

## Implemented locally

- Development, UAT and production are explicit build environments. UAT/production reject loopback or non-HTTPS APIs; production requires a locked tenant slug.
- EAS profiles separate development, internal UAT and production channels. Runtime compatibility follows the app version, and Expo Updates remains disabled unless an EAS project ID is supplied.
- Refresh tokens and the offline encryption key use device-only SecureStore access.
- Attendance, survey and project queue metadata is authenticated and encrypted with XChaCha20-Poly1305. Native pending photos/files are encrypted at rest and materialized only into a temporary cache file for upload, then removed.
- Offline records expire after seven days and their pending evidence is removed. Optimistic conflicts, permission changes and invalid records remain visible instead of silently merging.
- A render error boundary keeps encrypted offline work intact, offers a local recovery action and records only bounded, non-free-form device diagnostics.

## Verification

- `npm --prefix apps/mobile run typecheck` — passed.
- `npm --prefix apps/mobile test` — 71/71 tests passed.
- Expo public config resolves the app-version runtime policy, the Expo Updates config plugin and an honest disabled-updates state without an EAS project ID.

## Still required before P09.1 can be checked

- Configure the real EAS project/channel and signing credentials, then produce an internal UAT build.
- Connect and verify a crash/performance telemetry provider; the local recovery log is not remote observability.
- Run camera/file/location/notification denial-and-recovery, offline/reconnect, update rollback and accessibility checks on physical iOS and Android devices.
- Record device/OS and crash-free evidence in P09.5 before any distribution decision.
