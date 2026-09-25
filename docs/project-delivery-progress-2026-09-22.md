# Project delivery — implementation progress

This register reconciles the original 30-section blueprint and its audit with slices 1A–1J and 2A–2E. It is a progress update, not a fresh runtime certification of every pre-existing module. Sections unchanged by these slices retain the earlier audit's partial/unverified status. Test counts are evidence for individual slices, not a project completion percentage.

Slice 2A adds pending receipt inspection, independent incremental QC decisions, stock/invoice exclusion for pending goods, and task-aware material availability in package readiness. Procurement grids expose Pending QC and the receipt action. Slice 2B adds explicit material-per-output planning for site tasks, issued-material capacity, cumulative installation approval limits and protection against returning materials supporting approved output. Legacy tasks remain opt-in. The purchased-item milestone remains incomplete: receipt corrections, custody/location evidence and installed-item client acceptance still need completion; no material/output conversion is inferred.

## Current position

Factory capacity and first shared-batch slice: authoritative capacity subview and explicit pooled booking units are connected. Global Factory → Batches and project-scoped Batches now group compatible whole factory tasks across projects, freeze source snapshots, prevent duplicate active allocation, detect source drift and project existing output/QC/dispatch/receipt. Versioned cancellation retains history and rejects started work. Migration 0113 is written/journaled but not applied; no live database concurrency acceptance is claimed. Split-task allocations, shared reservations, per-lot QC/rework/cost/time remain outstanding. Details: `project-delivery-shared-factory-batches-2026-09-22.md`.

Planning connections: main client-project and item tables expose contextual Actions; task planning links to materials/progress, linked procurement records, pending batch QC and eligible partial handover. Navigation reuses existing records and preserves return context. No production enabling or commercial-release bypass is introduced.

Slice 2E adds named installation batches from approved output, independent batch QC/rework, partial pack quantities derived from passed batches, overlap prevention, signed/portal batch acceptance and guards against reducing allocated output or prematurely closing the batched work. A connected domain scenario covers receipt QC → material issue → installation approval → batch QC → signed partial handover while outstanding quantities remain open. This is local domain and mocked-browser evidence, not full database/pilot acceptance of the entire purchased-item scenario. Remaining large milestones below still apply.

Slice 2D connects direct image/PDF uploads and record-file selection to receiving, receipt QC, task inspection and signed acceptance dialogs. Server-owned evidence snapshots and authenticated history links preserve the selected evidence. Notes remain required; uploaded files stay internal and cancellation leaves them under Files. Slice 2E extends this to batch QC and adds batch-based quantity acceptance.

Slice 2C preserves reviewed handover packets during signed acceptance, rejects overlapping ready/accepted task scope, validates frozen quantities/units/location on both acceptance paths, and displays scoped quantities, document revisions and structured task inspection history. Its original package-only acceptance and text-only decision evidence limitations are extended by 2D–2E above.

The work is in the foundation and procurement stage. Item classification, draft planning, confirmed delivery-quantity allocations, internal RFAs, a global RFA/amendment queue, frozen supplier requests, offer selection, limited request replacement, pre-fulfilment order amendments and amendment reviewer recovery now have focused local implementation/tests. Existing factory, site, stock, finance, portals and handover code provides additional foundations.

The four blueprint scenarios are not yet marked accepted end to end: shared factory wardrobes, purchased chairs with partial supply/billing, subcontract painting, and post-handover service. Local mocked tests do not replace these acceptance runs. A defensible whole-project percentage or finish date needs estimates and acceptance evidence for the remaining work.

## All 30 sections

| # | Area | Current status | Main remaining work |
|---|---|---|---|
| 1 | BOQ-to-delivery product flow | Partial | Prove connected quantity handoffs through installation/acceptance. |
| 2 | Evidence and audit boundaries | Partial verification | Persisted integration journeys and release evidence. |
| 3 | Existing-code inventory | Documented; gaps open | Close the inventory's deliverables and verify reused code. |
| 4 | Minimal interface | Partial | Consolidate specialist views and simplify client-facing navigation. |
| 5 | Quotation to executable items | Partial | Carry confirmed allocations through downstream operations and changes. |
| 6 | Route/responsibility/location | Partial | Demonstrate every sourcing route and committed-route corrections. |
| 7 | Shared work groups/batches | Full allocation model missing | Multi-project run allocation, piece/rework lineage and shared cost/time. |
| 8 | Dates/day planning | Partial | Baseline/forecast/actual dates, quantity dependencies and lookahead. |
| 9 | Factory capacity | Partial | Shared-run throughput, skills, crews/machines and work-centre queues. |
| 10 | Material planning | Partial | Multi-consumer demand, substitutions, conversions and consolidated buying. |
| 11 | RFQ/offer/order | Partial; recent progress | Multi-line/full-batch revisions, landed costs, service orders, post-fulfilment amendments. |
| 12 | Receiving/QC | Partial | Pending inspection, quarantine, partial QC release and multi-drop quantities. |
| 13 | Site execution/installation | Partial | All-source installation eligibility and independent room/component quantities. |
| 14 | Daily progress | Partial | Daily commitments, shared-run output and safe downstream corrections. |
| 15 | Budgets/invoices/payments | Partial; substantial depth remains | Budget revisions, service billing, credits, retention, client invoice generation/reconciliation. |
| 16 | People/authority | Partial; recent progress | Extend named owner/receiver/reviewer and recovery beyond current approvals. |
| 17 | Global taskboard/events | Partial | Add operational work sources, dependencies and reliable cross-module updates. |
| 18 | Client/supplier portals/comms | Partial | Published client decisions/progress, lifecycle consistency and communication outcomes. |
| 19 | Field/column contract | Partial | Complete per-record dictionary and compatibility for remaining domains. |
| 20 | Edge cases | Partial verification | Map all 46 blueprint cases to tests or acceptance evidence. |
| 21 | Implementation sequence | Planned; execution in progress | Complete original delivery milestones, not just procurement sub-slices. |
| 22 | Business policies | Open decisions | Resolve QC, billing, publication, warranty and capacity policies as needed. |
| 23 | Module ownership | Partial | Finish source ownership and links across all 12 business areas. |
| 24 | Jira-level board capabilities | Partial; substantial work remains | Operational projections, ranking/WIP, bulk actions, workflows, automation and load/accessibility checks. |
| 25 | Handover/installed item | Partial | Exact quantity acceptance, installed identity, serials and warranty start dates. |
| 26 | Warranty/aftercare | Partial foundation | Intake, coverage assessment, visits, parts, chargeable work and closure. |
| 27 | Four worked scenarios | Not accepted end to end | Run each scenario with corrections and reconciliation. |
| 28 | Final acceptance | Not complete | Integration, permissions, concurrency, recovery, load and pilot acceptance. |
| 29 | Action/state contracts | Partial; recent progress | Extend enforced actor/state/evidence/quantity/reversal contracts to all remaining handoffs. |
| 30 | Review/progress guide | Documented | Maintain this register with each delivered slice and acceptance result. |

## Remaining delivery milestones

1. **Purchased-item vertical journey:** accepted BOQ → RFQ/order → partial receipt/QC → site installation → client acceptance. Include rejection, delay and correction. This should be the next focus instead of further isolated approval polish.
2. **Factory journey:** shared batches across projects, real capacity, output attribution, partial QC, rework and dispatch.
3. **Site/subcontract journey:** daily planning, crews, material consumption, progress, service valuation and installation.
4. **Financial depth:** revised budgets, invoice generation/matching, advances, credits, retention and final reconciliation.
5. **Portal and communication completion:** explicit publication/approvals, supplier lifecycle and traceable client updates.
6. **Handover and aftercare:** installed-item records, partial handover, warranties, visits and service resolution.
7. **Global board completion:** all work sources and the agreed advanced board capabilities.
8. **Pilot readiness:** database integration, security/permission boundaries, retries/concurrency, representative load and the four scenario acceptance runs.

These are major milestones, not equal-size tasks or an effort estimate. Several already contain useful code; each still needs connection, completion and validation.
