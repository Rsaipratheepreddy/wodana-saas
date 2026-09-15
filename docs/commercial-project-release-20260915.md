# Commercial-to-project release contract — 15 September 2026

This backend slice closes the accepted-scope integrity gap without changing routes, database
tables, existing project JSON, or frontend behavior.

## Locked behavior

- Final delivery release recomputes the accepted quotation hash. It must match the approved Owner
  Review and active Deal File before any delivery project is created.
- Every Preparation-linked quotation line must still be included, unarchived, and on the exact
  quoted scope/specification versions. Linked designs must remain approved with no open blocking
  thread.
- The first release freezes quotation, Deal File and release identity plus selling-price and source
  lineage into `project_execution.content.scope`.
- The frozen line keeps specification, finish, quantities, selling rate and rounded line total,
  structured material rows, custom materials, and versioned catalog snapshots.
- Internal unit cost and quotation photos are not copied into the execution record. The client
  portal's public project projection does not expose the internal execution scope.
- Retrying release never replaces an existing execution baseline.
- Later accepted variations use the same safe line shape. If an accepted variation has a stored
  hash and its content changes, synchronization is rejected.

## Compatibility

The change is additive inside existing JSONB content. New fields are optional in the TypeScript
contract so historical projects continue to load. No schema migration or data rewrite is required.

## Verification

`npm run verify:backend` passes with 359 Business Core tests (10 skipped), the production TypeScript
build, 67 Intelligence/Automation tests, strict mypy, and Ruff. Four focused project-release tests
cover the immutable snapshot, price drift, stale Preparation versions, and idempotent retry.

## Next backend slice

Add one isolated, deterministic API/database golden path beginning at real CRM intake and ending at
delivery release. It must prove IDs and tenant ownership through Intake, Enquiry, Lead, Opportunity,
Preparation, accepted Quotation, Owner Review, Deal File, and Project without direct SQL creation of
the business records under test.
