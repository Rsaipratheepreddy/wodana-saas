# P03.4 discovery acceptance

Date: 2026-09-18  
Boundary: local application, disposable PostgreSQL and simulator only; no Palm/live data, deployment or provider was touched.

## Accepted behavior

- Room identity survives rename, and a room removed from the source definition becomes an archived One Tree node instead of disappearing or receiving a new UUID.
- A stale published discovery definition exposes a plain-language change summary for changed brief text, rooms and room items before a new revision is published.
- Client-safe discovery views continue to redact internal evidence and require the existing purpose-bound OTP decision flow for confirmation.
- Photo/file evidence requires explicit consent when local media is attached. The client sends only the confirmation signal; the backend records the authenticated actor and server time and preserves the earlier confirmation on later edits.
- The upload boundary accepts an exact 20 MB file, rejects empty and over-limit files, inspects content rather than trusting a filename or MIME claim, and records a SHA-256 digest.
- Native offline capture retains a per-user/workspace/case draft, uploads stable media IDs once, checkpoints each receipt and surfaces retry, conflict, permission and invalid-payload states without discarding the local copy.
- Discovery retains explicit handoffs to catalogue selections, design-folder context and quote/pricing readiness. Stale scope, specification and evidence versions remain blocking or visible readiness failures rather than being silently accepted.

## Verification matrix

| Acceptance case | Evidence |
| --- | --- |
| New/changed/deleted rooms and stable lineage | `one-tree.spec.ts`; disposable migrated PostgreSQL smoke archived a deleted source room under the same UUID and returned zero active rooms through the API. |
| Revision diff | `pre-project-definition.spec.ts` and `definition-page.test.tsx`; the web screen renders **Changes since published scope**. |
| Client visibility and immutable confirmation | `pre-project-definition.service.spec.ts`; internal evidence is redacted and OTP confirmation remains bound to the published version. |
| Photo rights and consent | `site.service.spec.ts`; spoofed evidence identity/time is rejected and the authenticated actor/server time are authoritative. |
| Large upload | `brief-notes.service.spec.ts`; exact 20 MB PDF content is inspected and hashed, while empty and over-limit payloads are rejected. |
| Offline retry | `apps/mobile/scripts/pre-project-field-queue.test.ts`; stable-ID replay, acknowledged-file skipping, per-file checkpoints, failure classification and isolation are covered. |
| Design/catalogue/quote handoff | `brief-notes.service.spec.ts`, `design.service.spec.ts` and `pre-project-readiness.spec.ts`; relation ownership, client gates, stale references and readiness evidence are covered. |

## Regression results

- Focused cross-boundary Business Core matrix: 7 files and 75 tests passed.
- Full Business Core suite: 116 files passed, 1 intentionally skipped; 694 tests passed, 10 skipped.
- Full web suite: 137 files and 654 tests passed.
- Full mobile suite: 51/51 tests passed.
- Business Core, web and mobile TypeScript checks passed.
- Pre-execution Playwright navigation: 12/12 passed across desktop and mobile projects.
- Native Expo all-platform export passed; a clean iPhone 17 Pro simulator Debug build installed and opened with zero errors and warnings during P03.3 acceptance.
- `git diff --check` passed.

## Deferred release gates

Physical iOS/Android device runs, encrypted/expiring offline storage, release signing, crash telemetry and Palm two-person UAT remain P09. Real Meta/PlyLeads or notification-provider delivery is not part of discovery acceptance and is not claimed. Catalogue pricing depth and parametric assemblies begin at P04.
