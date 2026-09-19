# P06.5 — controlled change golden path

Local engineering acceptance on 18 September 2026. No Palm/live data, provider or deployment was changed.

## Golden path preserved

1. The accepted base quotation, Deal File and released project scope remain immutable snapshots.
2. A Change Case names the change kind and exact accepted source lines, then captures affected packages, tasks, orders, materials and bookings.
3. Every affected record needs an explicit disposition and reason before client documents can be prepared.
4. Replacement creates a linked credit and addition; other changes create the appropriate controlled variation. The original accepted document is never edited.
5. Every client-accepted variation must retain its exact accepted hash and decision evidence. Changed or missing acceptance evidence is rejected as stale.
6. Positive variations require at least one fully allocated finance-verified release receipt. Provider confirmation alone is insufficient. Deductions remain credit records rather than fake receipts.
7. Project synchronization uses the current project revision and a stable request ID, records the Change Case lineage, adds only unreleased variations, and leaves the original released scope/value intact.
8. A second synchronization cannot add the same variation twice. A stale project revision fails before dependency reads or writes.

## Product UI

- The Change Case view shows change type, accepted source items, operational impact, disposition decisions/reasons and linked client documents.
- Project Commercial shows the immutable baseline, released variations and the originating Change Case/document count.
- The shared compact action is labelled “Refresh accepted changes,” reflecting an idempotent reconciliation rather than an unbounded import.

## Verification

- Focused Business Core change/gate/service tests: 3 files, 9 tests.
- Focused web Change Case/project tests: 3 files, 18 tests.
- Full Business Core suite: 127 files passed, 1 skipped; 761 tests passed, 10 skipped.
- Business Core and web typechecks passed.
- Changed project UI lint passed.
- `git diff --check` passed.

Regional finance/tax acceptance, provider delivery, physical-device UAT and Palm tenant acceptance remain separate release gates.
