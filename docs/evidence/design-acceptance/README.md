# P05.4 — design acceptance

## Accepted local behavior

- **Rejected revisions:** a client can reject the exact published revision with a required reason. The decision remains in history, the revision is read-only, and the team must upload a new revision rather than overwrite the rejected evidence.
- **Expired reviews:** every new client review has an explicit decision deadline. The staff workspace and client portal derive an `expired` state when it passes; the client can still open the protected file but cannot submit a decision, and no verification challenge is consumed. The default is seven days for compatibility, with a validated one-to-ninety-day UI choice.
- **Superseded revisions:** only the latest revision can receive a decision. Earlier published revisions remain available as labelled history and are rejected by the decision service even if a stale browser submits them.
- **Multiple rooms:** the client-safe queue identifies room, item and design type, so equally named deliverables in different rooms are distinguishable. Staff source context remains revision-bound.
- **Round limits:** the included-round policy and actual client-review count are visible. Once the allowance is used, sending another review requires an explicit approved exception reason. The reason is stored in design activity; the product does not invent a fee, approver role or Palm-specific hard stop.
- **Client-safe view:** the portal returns published/decision history only, with protected file routes, room/item context and deadline. Internal drafts, staff cost data, internal user identifiers and review assignment are not exposed.
- **Permission boundaries:** assigned internal reviewers use the design-review permission; recorded staff-side client decisions require the dedicated decision permission; client approvers can decide only the current published revision; client viewers are read-only.

## Persistence and migration

- Migration `0094_design_review_expiry.sql` adds a nullable `client_review_expires_at` timestamp and a partial expiry index.
- A fresh disposable PostgreSQL migration through `0094` passed, and both the timestamp column and index were verified.
- Existing review records with no deadline remain non-expiring compatibility records. New review sends always receive a validated deadline.
- Expiry is derived on reads and enforced directly on decisions rather than rewriting historical status with a background worker.

## Verification on 18 September 2026

- Business Core focused acceptance: 3 files, 56 tests passed.
- Business Core full suite: 123 files passed, 1 skipped; 738 tests passed, 10 skipped.
- Web focused acceptance: 3 files, 44 tests passed.
- Web full serial suite: 143 files, 679 tests passed.
- Shared design-system component suite: 1 file, 6 tests passed.
- Mobile suite: all 52 tests passed.
- Business Core, web and mobile typechecks passed.
- Changed design-workspace browser test ESLint passed.
- Playwright design workspace passed in desktop Chrome and Pixel 7 mobile emulation, 2/2, including responsive screenshot capture and no horizontal overflow.
- `git diff --check` passed.

## Boundary and remaining risk

This is local acceptance evidence, not a Palm/live release. No tenant, provider, invitation, domain or deployment was changed. A physical-device run is not claimed here; it remains P09. Existing pre-migration reviews without a deadline are deliberately preserved. Commercial round allowance, overage price and exception authority remain configurable product decisions; this slice records the reason without inventing contractual terms. P06 begins the room-first quotation and agreement flow.
