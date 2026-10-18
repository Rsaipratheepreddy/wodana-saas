# Local completion and acceptance work

## Latest continuation — Catalog and signed handover

Follow-up evidence: `docs/qa-projects/delivery-2026-09-22T07-20-50.268Z` also verifies persisted receipt quarantine, partial independent QC, accepted-only stock, rejected overbilling, corrected partial invoice, capped payment and refused premature order closure. It verifies a warranty claim against the accepted installation, rejects a task outside the accepted packet, and requires another reviewer to close the correction. This is not yet the full purchased-chair installation or scheduled aftercare-visit story.

The backend sweep passed 658 tests with one outdated work-queue parameter assertion. That assertion was corrected for project/assignee filters and a new invalid-ID guard test added; the affected file now passes all four tests. The screenshot's action strip now has discrete white linked rows, bold action titles, pale urgency chips and priority edge markers, verified visually in the local browser. Nine work-order component tests pass; web typecheck passed before the added test-only assertion.

Completion order is fixed in `module-completion-order-2026-09-22.md`: Catalog/Projects, then Client Portal, then HRMS.

`docs/qa-projects/delivery-2026-09-22T07-14-04.400Z` passes the disposable persisted runner with actual Catalog collection, room, unit and item creation, room/item links captured in planning, existing specification/quotation/release steps, and factory-to-installation delivery. The quotation deliberately uses an audited negotiated selling-price override; automatic rate-card price selection is not certified by this run. Changing the Catalog item's name after release leaves the captured specification and released BOQ unchanged.

The delivery test now includes a reviewed closeout document, exact inspected installation-batch quantity, frozen handover packet, signed acceptance and rejection of a second ready pack for the same installed quantity. Remaining work does not become closed. No external client message is sent.

An old held-project assertion was updated to reflect the user's explicit requirement that rooms/working requirements remain editable while held. Web shortcut test typing was corrected. Catalog tables now opt into the shared cell grid and use pale chips with record links for relevant fields. A transient Materials loading state incorrectly displayed a failure when no catalog was selected; it now uses the all-catalog loading/error state.

This remains one factory story, not acceptance of all four scenarios or completion of the module. Supplier/subcontract/finance/shared-capacity/aftercare milestones below remain open.

User instruction: finish the remaining project flow locally, without permission checkpoints. Production, real customer data and external messages are out of scope. This document tracks actual acceptance evidence; it is not a completion claim.

## Verification environment

Native PostgreSQL 16 is available under Homebrew even though its tools are absent from PATH. A fresh cluster is running on loopback port 56437, entirely under `/tmp/wodana-delivery.46QTQy`. Database `wodana_funnel_test_delivery` contains synthetic workspaces only. The API uses a copied build outside the repository so repository `.env` credentials are not loaded; outbound mail/storage/Redis integrations are disabled. API port 8168. Retain these paths only as the current session location; a reusable runner will create fresh paths and clean up its own processes.

Session update: that initial API and PostgreSQL cluster have now been stopped. Use the reusable runner below for new acceptance work; it does not depend on those ports or processes.

All 113 journal entries through migration 0113 applied using the Drizzle ORM migrator. The installed drizzle-kit/esbuild combination has a binary version mismatch, so the verified ORM migration API was used without changing repository dependencies. The RLS manifest check passes. 459 existing project/commercial tests pass.

The persisted generic funnel now passes through source definition, client confirmation, quotation import, commercial agreement/receipts/release, scheduling, conflicts and permissions. Two stale smoke assertions were updated: definition publishing is explicit, and quotation creation no longer pre-imports scope before the composer applies it.

## Work queue

1. Extend isolated acceptance to four persisted delivery stories and real concurrent requests; include the new shared-batch migration, RLS and replay behavior.
2. Complete factory quantities: partial allocations, shared capacity reservation, lot QC/rework, safe dispatch, output/time/cost attribution. Reuse existing output and stock ledgers.
3. Complete receiving/procurement corrections, service acceptance and financial reconciliation; preserve accepted/billed/issued quantity boundaries.
4. Complete installed assets and aftercare, with explicit coverage and client-safe publication.
5. Complete operational global work projections and remaining board capabilities using source authority.
6. Reconcile all 30 sections and 46 edge cases against code and tests; complete local browser, permissions, concurrency and load acceptance. Record remaining gaps honestly until each passes.

## Confirmed gaps found while connecting tests

- Whole-task QC currently checks reviewer permission but not independence from the task owner/assignees. Add the missing independent-review guard.
- Site start checks all factory predecessors for full completion before checking accepted partial receipts. This defeats the intended partial-installation path; preserve predecessor gates for non-factory work but allow eligible accepted factory quantities.
- Batch source snapshots use all variation lines instead of current executable scope; deducted lines must not be newly grouped.
- The existing commercial-project smoke is bound to a named local customer database and session. Do not run it in this task. Reuse its scenarios in the new isolated harness instead.

## Verified continuation

The first three defects above are fixed with regression coverage. Execution commands now take the workspace capacity lock before the project row, matching scheduling and avoiding inverted lock ordering.

`npm run test:smoke:delivery` creates a disposable native PostgreSQL cluster, applies the full migration journal, builds an API copy outside repository `.env` discovery, runs both acceptance scripts, writes evidence, and stops its own processes. Latest successful evidence: `docs/qa-projects/delivery-2026-09-22T05-40-31.269Z`. This includes the source-to-release funnel plus factory allocation concurrency/replay/conflicts, source snapshot drift, cancellation, nonmember denial and actual RLS reads using another workspace context.

Production lots now bound partial QC to approved output. Independent QC, rework history, lot-specific dispatch conservation and finished-stock availability are implemented. The persisted API story continues through resource booking, approved factory output, failed/passed lot inspection, dispatch, independent site receipt, approved installation output and independent installation-batch QC. Existing controlled drawing and commercial gates remain enforced. This is one delivery story; it does not certify all four blueprint scenarios.

Validation: 67 project/commercial test files, 463 tests passed; backend build and web typecheck passed; 22 targeted component tests passed; 2 desktop/mobile browser cases passed for production-lot QC, keyboard, RTL, full cell borders and preserved failed-save drafts. Both screenshots were inspected. Targeted production-lot component lint passes. Whole-workspace lint was not asserted clean.

Remaining work is still substantial: shared-run capacity and partial source allocations/time/cost; procurement/service and finance correction depth; installed assets/warranty visits/portal publication; full operational global board; final coverage of all 30 sections, 46 edge cases and four persisted scenarios. Do not present the successful checks above as completion of those areas.

## Final integrated continuation

The latest isolated source-to-release plus delivery acceptance passed at `docs/qa-projects/delivery-2026-09-22T08-18-28.593Z/`. Includes catalog-linked frozen scope, measured subcontract certification, partial receiving and invoices/payments, purchased material consumption, partial handover and warranty. Full backend suite: 1,126 passed, ten skipped. See `docs/local-readiness-2026-09-22.md` for cross-module evidence and explicit remaining scope; this supersedes earlier counts, not the remaining functional gaps.
