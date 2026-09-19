# P07.4 — AI suggestion review evidence

**Scope:** local engineering acceptance only. No live provider, tenant, deployment, client publication or autonomous business action was performed.

## What is implemented

- A reusable `AiSuggestionReview` design-system pattern presents the suggested wording, evidence and source, proposed before/after changes, uncertainty and provenance in one review surface.
- CRM lead response work now uses the shared pattern. The backend contract also accepts permitted lead, opportunity, commercial-case and project source records so later screens can compose the same primitive rather than fork it.
- Staff can accept, edit-and-accept, or reject. Every decision is permission checked, immutable, audited, request-idempotent and version guarded.
- Creating or reviewing a suggestion never updates the source CRM, commercial or project record. It cannot send a message, move a stage, commit a price, publish to a client or approve work.
- Rules-based fallback and connected model output use the same persisted evidence/provenance contract. A failed persistence call is surfaced as unavailable instead of presenting an unauditable review action.

## Data and API

- Migration `0097_ai_suggestion_review.sql` creates tenant-isolated `ai_suggestions` and `ai_suggestion_decisions`, RLS policies and `ai.suggestions.use` permission grants.
- `POST /workspaces/:workspaceId/crm/ai-suggestions` validates the same-tenant source and persists the evidence-backed draft.
- `PATCH /workspaces/:workspaceId/crm/ai-suggestions/:id/decision` records an accept/edit/reject decision without mutating the source entity.
- Audit events distinguish system-generated suggestion creation from human review and explicitly record `sourceRecordChanged: false`.

## Verification

- Business Core focused suite: migration manifest plus AI suggestion service, including create, edited review, exact replay and stale/already-reviewed rejection.
- Web focused suite: CRM assist interaction plus lead-page and CRM record-workbench regressions.
- Business Core and web TypeScript checks pass.
- Touched feature files use the shared component system; no new raw `table`, `button`, `input` or `select` controls were introduced.
- The migration was applied to the local development database only, and application-role table access was verified.

## Deferred truth

- Model quality, provider pricing and production delivery are not certified by this slice.
- Additional opportunity, commercial and project placements should reuse this primitive when their task slice is opened; this evidence does not claim those screens are already present.
- Repository-wide legacy component cleanup, Palm UAT, physical devices and deployment remain separate tracked work.
