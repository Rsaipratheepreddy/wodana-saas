# Preparation definition baseline — 15 September 2026

Requirements, specifications, material selections, measurements, and exact design revisions now
produce one client-safe Definition Baseline before a Preparation-linked quotation can enter review.
This is a versioned confirmation layer over the existing Preparation records; it does not create a
second requirements or design source of truth.

## Contract

```text
GET  /api/v1/workspaces/:workspaceId/pre-projects/:caseId/definition-baselines
POST /api/v1/workspaces/:workspaceId/pre-projects/:caseId/definition-baselines
POST /api/v1/workspaces/:workspaceId/pre-projects/:caseId/definition-baselines/:baselineId/decisions
```

The read response contains the current computed source hash, publication blockers, the latest
baseline, version history, confirmation state, permissions, and one stable next-action code. A
publication supplies that source hash and an idempotency key. Stale reviews are rejected instead of
publishing different content from the content the team reviewed.

Each published baseline freezes a client-safe snapshot and SHA-256 evidence hash. It includes the
brief, spaces, active requirements, exact item-specification versions, selected catalog identities,
evidence-file identities, and exact design-file hashes. Internal costs, selling controls, storage
object keys, and file bodies are excluded.

## Lifecycle and downstream lineage

- A baseline can receive exactly one attributed client decision: confirmed or changes requested.
- Portal decisions require the designated approver and a purpose-bound, expiring, one-use OTP.
  Staff may record confirmation received by meeting, email, phone, WhatsApp, signed document, or
  another evidenced channel under a separate permission.
- Editing any captured Definition content changes the source hash. The prior baseline becomes
  superseded and cannot authorize quotation review.
- A changes-requested decision requires remarks. The requested change must alter the source before
  a replacement baseline can be published.
- Publishing unchanged content is a safe no-op. Exact command and decision retries return the
  original result, including after the Preparation later closes.
- A Preparation-linked quotation can enter internal review only against the current confirmed
  baseline. Its ID, number, and evidence hash are frozen into the quotation hash, Deal File, and
  released project scope.
- Custom-only quotations remain supported without manufacturing a false Preparation lineage.

## Tenant and decision safety

- All baseline, decision, and command records are workspace scoped, protected by forced RLS, and
  linked to the same Preparation through composite foreign keys.
- Publishing and staff-recorded decisions use distinct permissions. New permissions default only
  to the tenant owner and administrator system roles.
- Baseline and decision tables grant the application role insert and read access, not update or
  delete access.
- Publication and decisions lock the Preparation row, so simultaneous decisions cannot both win.
- Client portal data excludes internal decision evidence. A portal grant must belong to the same
  workspace and Preparation as the decision it records.
- Publication and decision events enter the existing audit/outbox path with the acting staff or
  named client identity.

## Verification

- 12 focused Definition Baseline domain/service tests cover safe redaction, deterministic hashing,
  readiness, malformed identifiers, role denial, invalid OTP, attributed decisions, serialized
  writes, replay after closure, and internal-evidence redaction.
- 40 focused Definition/readiness/commercial/project tests pass together.
- The complete backend gate passes: 563 Business Core tests, 70 Intelligence/Automation tests,
  TypeScript type-check and production build, strict mypy, and Ruff.
- The isolated fresh-database funnel applies all 73 registered migrations and proves initial
  publication, idempotent replay, OTP confirmation, supersession after a specification edit,
  replacement confirmation, quotation lineage, Deal File lineage, and released-project lineage.
