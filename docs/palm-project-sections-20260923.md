# Palm project sections and connected demonstration data

Scope: PLM workspace `af041cf6-6bd5-4db1-932a-b145bda49d0c`, named demo project `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01`, source case `77777777-7777-4777-8777-777777777703` only. No destructive reset or quotation-builder rollback.

Live release: `20260923-palm-project-tabs-r1` at https://plm.wodana.ai. Web container healthy and public release header verified. Full verified pre-release backup: `/var/backups/wodana/current/release-20260923T041626Z`; proxy rollback: `/opt/wodana/releases/20260923-palm-project-tabs-r1/rollback.sh`. Backend remains the prior healthy release; no schema changes.

## UI

- Portfolio separates Planning (default) and Production. Existing execution rows offer both their original planning case and production workspace.
- Fixed Overview rendering for legacy projects without an initiation baseline. It now renders the existing project pulse, delivery stages, actions, timeline and activity instead of an empty setup panel.
- Existing operational navigation, icons, enquiry flow and latest quotation builder retained.

## Section coverage

| Area | Persisted records |
| --- | --- |
| Requirements / specifications | Three existing room items, three new proposed specifications with reference-design links |
| Measurements / site | Planned visit, three incomplete/unverified measurement sets, open coordination observation |
| Design / BOQ / quotation | Existing four source designs, six project documents, three released BOQ lines and accepted demonstration quotation retained |
| Change requests | New open internal sample request; no accepted scope or quotation changed |
| Approvals / client updates | Draft RFA against a controlled draft drawing; unpublished client-update draft |
| Materials / warehouse | Seven requirements; supplied Palm electrical catalog item linked to illustrative stock and a requested transfer with no movement |
| Procurement | Existing two orders and receipt history; one RFQ, supplier directory entry, draft return |
| Teams / factory / site | Two resources, three bookings, five tasks, one batch/allocation, one dispatch; invalid member IDs and wrong dispatch destination repaired |
| Daily progress | Existing four reports preserved; one new draft with zero additional output and coordination risk |
| Quality / handover | Existing two snags and three draft packs; stale draft task/document references repaired; new draft commissioning check |
| Budget / finance | Existing budget/payment schedule untouched; new draft supplier invoice and illustrative held retention, no payment |
| Files / coordination | Existing files/designs; draft transmittal and open maintenance-information query |

All new operational examples are labelled DEMO. Supplied electrical catalog names/model details are source data; sample quantities, stock and allocations are not claimed to be real physical inventory. No external message, RFA decision, contract acceptance, payment or accounting integration was triggered. Empty status filters (for example returned reports when none were returned) remain truthful.

## Data safeguards and verification

- `palm-demo-enrichment.ts` and `scripts/palm-demo-enrichment.cjs`: named-workspace/project/quote guards; existing domain commands; row locks; dry-run rollback by default; before-image backup; existing order/document decisions checked unchanged; repeat run is a no-op.
- `scripts/palm-demo-all-sections.cjs`: additive deterministic IDs, transactional writes, scoped guards, before-image backup, incomplete survey/proposed selection semantics; repeat run is a no-op.
- Two changes advanced project revision 50 → 51 → 52. No unrelated projects or tenants were reseeded.
- Final database verification: 3 requirements/specifications, 5 site records, 4 source designs, 7 materials, 3 orders (including RFQ), 5 tasks/reports, 3 handovers, 6 documents, 2 resources, 3 bookings, 1 factory batch, 1 warehouse row/transfer, 2 quotations, 3 payment milestones and 1 change request. All added specialist records present; zero stale draft-handover references.
- Before-images preserved at `/var/backups/wodana/palm-demo-20260923/before-sections.json` (SHA256 `33394b3f5b89655d2299433a051d2ea1129084a911b01ab093415e9ccf32f4f5`) and `before-all-sections.json` (SHA256 `529a9aa899343b305823c9a4344627aaeece3aad1b53dbbefbff968398d84f59`).
- 33 targeted UI tests passed, including the legacy Overview regression and portfolio tab/cross-link behavior. Web typecheck and backend build passed. Production web image built successfully.
- Authenticated browser verified RFA, materials, finished stock, orders, RFQ, receipts, return, supplier directory, teams, factory/site tasks and daily progress. Browser session expired before remaining post-release checks; do not represent those as fully browser-verified.
