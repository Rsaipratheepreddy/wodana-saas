# Smart quotation composer backend — 15 September 2026

The composer is an additive preparation layer over the existing quotation engine. It does not
replace the direct builder, saved templates, revisions, approvals, client portal, agreements, Deal
File, or release flow. Blank, template, and manual quotation workflows remain valid.

## API contract

```text
GET  /api/v1/workspaces/:workspaceId/commercial/cases/:caseId/quotation-composer?quoteId=:quoteId
POST /api/v1/workspaces/:workspaceId/commercial/cases/:caseId/quotation-proposals
POST /api/v1/workspaces/:workspaceId/commercial/cases/:caseId/quotation-proposals/:runId/apply
POST /api/v1/workspaces/:workspaceId/commercial/cases/:caseId/quotation-proposals/:runId/dismiss
```

The read contract returns the draft revision, current confirmed Definition Baseline, review
readiness, comparison with the previous quotation revision, and the latest proposal runs. Proposal
creation supports confirmed-scope and assistant modes. Assistant output is only an untrusted
proposal input; the backend accepts no model-supplied quantity, selling price, cost, catalog
snapshot, or tenant identity.

## Safety and productivity rules

- A proposal is bound to the exact commercial revision, draft hash, Definition Baseline ID,
  source hash, evidence hash, and proposal hash. Any material source or draft change requires a new
  proposal.
- Every cited source must exist in the authorized confirmed snapshot. Every catalog identity and
  version is loaded again inside the tenant transaction. Variants, rooms, units, and material recipe
  relationships are checked before presentation and again before apply.
- Selling prices are resolved by the existing deterministic workspace price-book service. A change
  to the price source, rate, currency, tax, unit, quantity, validity, or price status invalidates the
  proposal instead of silently changing the amount during apply. AI never prices a quotation.
- Applying selected items is one transaction. It appends to the draft, preserves manual lines,
  merges room names case-insensitively, and skips matches found through either scope identity or
  catalog-work/variant identity. It never removes or replaces existing work.
- Existing 100-room, 300-line, payment, totals, quotation-state, and Definition readiness gates
  remain authoritative. Composer readiness makes those blockers visible earlier and separately
  identifies custom and client-supplied items for review.
- Create, apply, and dismiss commands use workspace-scoped request IDs. Exact retries return the
  saved response; a reused ID with different intent is rejected. Case and proposal locks serialize
  concurrent writes.
- Runs and command receipts use composite tenant foreign keys and forced row-level security. Create,
  apply, and dismiss events enter the shared audit and outbox path.

## Verification

- Composer domain and service tests cover draft binding, manual-line preservation, cross-identity
  duplicates, limits, actionable readiness, revision comparison, exact retries, request-ID misuse,
  stale revisions, missing confirmation, unauthorized citations, and changed price evidence.
- The complete backend gate passes with 577 Business Core tests and 70 Intelligence/Automation
  tests, TypeScript type-check and build, strict mypy, and Ruff.
- The isolated fresh-database funnel applies all 74 migrations and proves proposal creation, exact
  create/apply replay, duplicate-safe atomic apply, Definition binding, and the unchanged journey
  through quotation acceptance, Deal File, release, schedule, and execution.
