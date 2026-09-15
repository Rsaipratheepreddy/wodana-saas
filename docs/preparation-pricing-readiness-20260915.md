# Preparation pricing readiness — 15 September 2026

Preparation now exposes one tenant-safe readiness contract for pricing on web and mobile:

```text
GET /api/v1/workspaces/:workspaceId/pre-projects/:caseId/readiness?target=pricing
```

The response contains a deterministic state hash, overall and per-item readiness, blocking checks,
non-blocking warnings, and ordered next actions with stable action codes. Client applications can
render the same facts differently without reproducing business rules.

## Pricing blockers

- Preparation is not active.
- No included scope exists, except for an intentionally custom-only quotation.
- No current site-plan/reference file with an attached asset exists.
- A quotation scope item was removed, excluded, archived, duplicated, or changed after import.
- The current item specification is missing or changed after import.
- The item's site measurement is missing, awaiting recheck, unverified, or lacks current evidence.
- An exact design revision is not linked to the current specification, is not client-approved, or
  has open blocking feedback.

Quotation submission calls the same evaluator inside its existing transaction. The endpoint and
the write gate therefore cannot drift into separate interpretations of readiness.

## Warnings

Captured-but-unreviewed requirements, proposed/change-requested materials, open site observations,
and a newer design revision are visible as warnings. They do not silently block pricing, preserving
the current commercial policy while giving teams an early review queue.

## Edge behavior

- Custom-only quotations remain supported, but the active-Preparation and site-plan gates remain.
- Dependent actions are suppressed until they are possible; for example, evidence is not requested
  before a measurement exists, and approval is not requested before a design is linked.
- Removed and excluded items stop at the refresh action instead of producing cascading noise.
- All queries are scoped by both workspace and Preparation identifiers and require
  `pre_projects.view` for the read endpoint.
- This slice adds no schema or data migration.

## Verification

- 10 focused readiness evaluator/service tests pass, including tenant boundary, lineage, stale
  versions, missing prerequisites, warning-only states, duplicates, removed scope, and custom-only
  quotations.
- The full backend gate passes with 550 Business Core tests and 70 Intelligence/Automation tests.
- The disposable API/database funnel proves an incomplete state with ordered remediation, a ready
  state after site/design controls, and successful quotation submission through delivery release.
