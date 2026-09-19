# P03.3 native field-capture acceptance

Date: 2026-09-18  
Boundary: local application and backend only; no Palm/live data, deployment or provider was touched.

## Accepted behavior

- The native Site survey keeps visits, observations and measurements linked to the current Preparation, room and optional scope item. Existing optimistic record and specification versions remain the write boundary.
- Camera, photo-library and file choices expose explicit permission failures. New evidence is copied into the app document directory before a network call, capped at 20 files and 20 MB per file, and represented by a stable UUID.
- A site-evidence consent checkbox is required whenever new local evidence is attached. The backend accepts only the boolean confirmation signal and records server-authored `confirmedBy` and `confirmedAt` evidence rather than client-authored identity or time.
- Every queued operation is isolated by signed-in user, workspace and Preparation. It stores the record snapshot, specification version, stable media IDs, acknowledged-upload checkpoints and consent state; it never stores an access or refresh token.
- Sync uploads only unacknowledged files, checkpoints after each receipt and writes the site record last. A lost response can therefore retry without producing a second asset or site record.
- Network failures stay pending and retry on screen entry, app foreground or the explicit retry action. HTTP 409, revoked access and invalid payloads stop as visible conflict/permission/correction states with the local copy retained.
- Opening a conflict exposes the local draft. Reapplying it over a newer revision requires an explicit acknowledgement; the server still creates a new revision and retains prior history.
- Read-only users cannot start field capture, and measurement verification remains separately permission gated.

## Verification

- `npm --prefix apps/mobile run typecheck` — passed.
- `npm --prefix apps/mobile test` — 51/51 passed, including stable-ID replay, per-file checkpoints, acknowledged-file skipping, failure classification and user/workspace/case isolation.
- `npm --prefix services/business-core test -- --run src/pre-projects/site.service.spec.ts` — 10/10 passed.
- `npm --prefix services/business-core test -- --run` — 116 files passed, 1 intentionally skipped; 690 tests passed, 10 skipped.
- `npm --prefix services/business-core run typecheck` and `npm --prefix apps/web run typecheck` — passed.
- `npx expo export --platform all --output-dir /tmp/wodana-mobile-p033-export-20260918` — iOS, Android and web bundles exported successfully.
- `npx expo run:ios --device 'iPhone 17 Pro' --no-bundler` — clean Debug build succeeded with zero errors and zero warnings, then installed and opened on the booted iPhone 17 Pro simulator.
- `git diff --check` — passed.

## Deferred release gates

Queue encryption/expiry, background delivery guarantees, crash telemetry, physical-device camera/library denial recovery, Android/iOS real-device offline runs and release signing belong to P09.1/P09.5. Large-upload boundary and complete discovery-to-design/catalogue/quote handoff are exercised in P03.4. No store-readiness or production-release claim is made here.
