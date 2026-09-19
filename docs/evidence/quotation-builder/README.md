# P06.1 — room-first quotation builder

Date: 2026-09-18  
Boundary: local source, synthetic tests and browser fixtures only. No Palm Living tenant, provider, invitation, domain or deployment was changed.

## Accepted behavior

- The quotation composer reads the current immutable, client-confirmed Definition Baseline and reports exactly which included room/item scope is covered or still missing from the quotation.
- A scope proposal carries room and durable scope/catalogue identities, uses the exact resolved selling-price snapshot when available, identifies duplicates and never replaces an existing quotation line silently.
- Unpriced or stale catalogue evidence blocks review. Confirmed but uncovered scope remains a conspicuous warning rather than an invented contractual hard stop.
- New manual lines are available only to the existing commercial price-override role. The author must record a reason; the server rechecks permission, stores an audit event and excludes the internal reason from client payloads and freeze hashes. Unchanged legacy manual lines remain editable for compatibility.
- A line can be marked as a priced option. Options appear in the document and client projection but remain outside the base subtotal, cost, discount, tax, total and gross margin.
- Exclusions, inclusions, terms, tax, discount and milestone schedule remain part of the versioned quotation. Authorized cost viewers see internal gross margin; a recorded loss-making base quotation produces an explicit commercial-owner warning without inventing an unapproved threshold or release block.
- Revision comparison uses durable scope/catalogue identity and reports added, removed and field-level changed lines (room, item, quantity, selling price, option status, specification, materials and catalogue source). It deliberately excludes internal cost, authorization notes and price-resolution internals from the public structural diff.
- Client quotation projections retain option status while removing internal cost, margin, manual authorization and catalogue-price evidence.

## UI and component boundary

- The new confirmed-scope composer uses the shared `Button`, `Checkbox`, `Badge`, `Callout` and `Skeleton` components and has no raw button/input/select/table markup.
- The current spreadsheet-style quotation editor preserves its established grouped editable-table interaction and responsive client document. New authorization, option and status controls compose shared design-system controls.
- The repository-wide legacy raw-control migration is not claimed here; the explicit cross-product component compliance gate remains on the delivery board for the final design-system pass. P06.1 added no duplicate feature-local component library.

## Verification on 18 September 2026

- Business Core focused acceptance: 4 files, 33 tests passed.
- Business Core full regression: 123 files passed, 1 intentionally skipped; 742 tests passed, 10 skipped.
- Web focused quotation/totals acceptance: 5 files, 30 tests passed.
- Web full regression, serial: 143 files, 681 tests passed. A parallel run produced one unrelated catalogue-table timeout; that test passed in isolation and the full serial run passed.
- Mobile regression: all 52 tests passed.
- Business Core, web and mobile typechecks passed.
- Changed P06.1 web-file ESLint passed with zero errors; three existing `img` optimization warnings remain in the document/editor code.
- Playwright quotation workspace passed on desktop and mobile, 6/6, including the permissioned manual-line authorization dialog, material editing, catalogue selection, preview and responsive screenshots.
- The new scope-composer raw-control scan was empty and `git diff --check` passed.

## Remaining boundary

PDF/client presentation, expiry/selection/acceptance idempotency and agreement evidence are P06.2. Structured invoices, credit notes, receipts and allocations are P06.3. Business-gate authority and thresholds remain P00.3/P06.4 product decisions. No physical-device, Palm clone/live or provider acceptance is claimed.
