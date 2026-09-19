# P07.5 — native notifications and deep-link evidence

**Scope:** local engineering acceptance only. No production push, Palm tenant, physical-device UAT or deployment was performed.

## What is implemented

- The Expo mobile app now has a real **Updates** destination backed by the tenant notification Inbox. Push is opt-in and never prompted on startup.
- Device consent records the current iOS/Android permission, locale, timezone and stable installation ID. Enabling push registers one Expo endpoint; disabling or signing out revokes the current device.
- Raw Expo tokens are kept in Redis behind an opaque reference. PostgreSQL retains the token hash, consent link and lifecycle metadata, never the raw token.
- Notification taps resolve through Business Core. Lead, Inbox conversation, opportunity, pre-project, assigned/manageable project and canonical Job links are permission checked again before mobile navigation. Missing, stale or unauthorized targets fall back to the CRM Inbox.
- Android creates the notification channel before permission/token work. Simulator, web, missing-build configuration and temporary registration failure remain usable through the in-app Updates list.
- Expo ticket acceptance stays `processing`; it is not shown as delivered. A separate receipt pass marks delivery, retries provider/rate failures, permanently rejects invalid payloads and revokes `DeviceNotRegistered` endpoints. Terminal push failure creates an idempotent in-app fallback.
- The CRM Jobs page no longer throws a development runtime overlay for an expected temporary upstream failure; it preserves the page shell and presents a recoverable status.

## Data and API

- Migration `0098_native_notification_devices.sql` adds tenant-isolated device consent, installation-bound endpoint lifecycle and receipt destination references.
- Tenant endpoints cover settings, consent, registration, push preference, revoke, Inbox and permission-checked open.
- Internal worker endpoints claim Expo receipts separately from delivery jobs and accept receipt outcomes independently of UI state.

## Focused verification

- Business Core TypeScript passed; focused notification suites passed: **2 files / 8 tests**.
- Intelligence worker push adapter suite passed: **5 tests**; Ruff and strict mypy passed for the changed worker path.
- Mobile TypeScript passed; notification payload/custom-link routing passed: **2 tests**.
- Web TypeScript passed; Jobs shared-table regression passed: **1 file / 3 tests**.
- Migration `0098` was applied to the local `wodana` database and its consent/endpoint columns were verified.

## Deferred release evidence

- Expo credentials/EAS project identity, APNs/FCM configuration, physical iOS/Android permission recovery, background delivery and a real Expo receipt remain P09.4–P09.5 gates.
- No delivery/provider claim is made from a successful UI state or Expo ticket alone.
- Full cross-module synthetic E2E remains P08.6/P09; this slice used focused verification so delivery work can continue without carrying compile or contract failures.
