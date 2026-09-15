# CRM intake and identity-resolution contract — 15 September 2026

This slice makes intake replay and duplicate decisions deterministic, tenant-scoped and auditable. It does not change the CRM user interface or deploy any environment.

## Locked behavior

- New intake requests use a canonical version-2 SHA-256 payload hash, so JSON object key order does not create a false idempotency conflict. Existing version-1 intake records retain their original replay behavior.
- Idempotency and external-event identifiers are normalized before persistence. A materially future-dated `receivedAt` value is rejected before a record is created.
- One verified exact contact match resolves to the active customer. No match creates a new customer. Multiple possible matches remain in the duplicate-review queue.
- Every ready intake stores the resolution type, resolved customer, resolution time and bounded decision evidence. Historical ready intakes are backfilled as `legacy_ready`.
- Duplicate review supports three explicit decisions: attach to an active customer, create a separate customer, or reject one candidate while another candidate remains. Split and reject decisions require a reason.
- A final decision closes every remaining pending candidate with explicit resolution evidence. Identical retries return the completed result; attempts to change a completed decision return a conflict.
- Workspace guards, database checks, optimistic versions and a workspace identity lock prevent cross-tenant references, invalid review states and concurrent double resolution.
- Intake and candidate detail responses expose the match strength, score, reasons, decision state and final resolved customer required by the later UI.

## Verification

- Focused intake/hash integrity tests: 16 passed.
- Business Core regression: 466 passed, 10 skipped.
- Fresh isolated lead-to-project funnel: passed, including intake replay and resolution-evidence assertions.
- Existing-data migration rehearsal: 21 historical ready intakes backfilled without an incomplete resolution; cross-workspace resolution guards rejected invalid references.
- Database-backed CRM lead-flow smoke: 29 passed, including duplicate review and same-decision replay.
- Business Core TypeScript check and production build: passed.

Provider onboarding/configuration, qualification and conversion integrity, frontend integration and deployment remain separate delivery slices.
