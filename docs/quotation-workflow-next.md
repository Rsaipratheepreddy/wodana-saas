# Quotation-first commercial workflow

## Product direction — 22 September 2026

Requirements is raw capture: notes, photographs, links and measurements. It does not need an internal-review task for each note. Measurements can start from a typed item name or catalog selection. Drawings stay a simple folder/file browser with preview, comments and revisions.

The quotation is the commercial source of truth. Requirements and drawings inform it; they must not become a second quotation builder. This document is the next implementation plan, not a claim that every behavior below is already implemented.

## One clear journey

1. **Draft quotation:** add catalog items or custom work, optionally bring in requirements and measurements, and organize lines by room or area.
2. **Review and send:** review scope, prices, linked drawing revisions, exclusions and payment terms. Send one identified version to the client.
3. **Client decision:** record acceptance or requested changes against that exact version. A requested change creates the next draft; it never edits the sent document silently.
4. **Accepted quotation:** lock its scope, quantities, prices, taxes, drawing references and payment terms. Derive the agreed BOQ and commercial handover from this snapshot.
5. **Change request:** select an accepted item or add new work, describe the change, show price/time impact, and prepare an addition, deduction or replacement for acceptance. Preserve the original accepted quotation.

## Main editing screen

Use a white canvas, compact shared controls and a single editable table. Keep the title, version and status together. The primary action follows the state: Save draft, Send for review, Send to client, or View accepted version.

Default columns: Item / specification, Quantity, Unit, Rate, Amount. Group by room only when rooms exist. Show tax/discount controls in the totals area; show images, detailed dimensions, catalog provenance and drawing links in the selected line editor. Keep totals visible without consuming the main canvas. Currency comes from company setup.

Fast entry: searchable catalog picker, custom line, duplicate line, add row below, keyboard navigation and reusable room/item templates. Importing a requirement is an explicit selection and must not silently add every note to the price. Missing prices remain visibly incomplete; do not invent rates or quantities.

Client preview should be the same document snapshot that is sent. Include clear scope, inclusions/exclusions, validity, payment milestones and attachments. Internal cost/margin and staff comments stay private.

## Versions and changes

- Keep one visible working draft per quotation chain, with a version history and a clear comparison to the last sent version.
- Before acceptance, requested changes produce a revised quotation version.
- After acceptance, use a linked change order with old value, new value and net difference. A replacement may require both a credit and an addition, presented together to the user.
- An unaccepted change never alters agreed totals or releases additional work.
- Display original accepted value, approved changes and current agreed value separately. Keep requested/pending changes out of the agreed total.
- Preserve acceptance identity, timestamp, channel and exact document version. Editing source notes or catalog prices must not modify accepted snapshots.

## Payments and accounting

Derive agreed payment milestones from the accepted quotation, with explicit handling of accepted changes. Separate scheduled, invoiced, paid and overdue amounts. Do not silently redistribute payments already made.

QuickBooks/Zoho Books integration belongs after agreement: map the customer and approved invoice/credit documents, store external IDs, retry idempotently and show sync failures. Do not treat a quotation acceptance as a payment or claim a sync is complete without a provider response.

## Existing pieces to reuse

The repository already contains `QuotationStudio`, the quotation sheet/document, catalog caching, payment-schedule controls, and `ControlledChangeCase`. The latter already links change requests to quotation documents and distinguishes additions/deductions. Reuse these contracts before adding new state or screens. The current scope composer references definition snapshots; review whether that prerequisite should remain optional for ordinary draft capture under the simplified requirements workflow.

## Delivery order and QC

1. Audit current quotation state transitions, totals and persistence; document gaps against this plan.
2. Finish the compact line editor and catalog/custom-item capture. Verify reload, failed-save recovery, units, rounding, currency and tax behavior.
3. Finish sent-version comparison and exact-version acceptance locking, including stale writes and permission tests.
4. Connect change requests to addition/deduction/replacement documents and agreed-total updates; test retries and rejection paths.
5. Verify payment milestone impact, agreed BOQ derivation and handover. Accounting sync and client portal require their own end-to-end verification.

For each slice: desktop and narrow-screen screenshots, keyboard access, RTL, real persistence checks on labelled sample data, and focused domain/UI tests. Do not expand the UI with additional dashboards or mandatory review steps for raw notes.

## Implementation checkpoint — 22 September, Drawings and quotation capture

- Drawing preview now exposes saved revisions and downloads without returning to a separate details page. Earlier revisions are read-only. A newer background revision cannot silently receive an existing unsent comment. Responsive image fitting recalculates when the viewer width changes.
- Live sample R2 was uploaded, saved and reloaded. R1 remained accessible with its original asset download. Verified the full drawing and borderless comments at 390px; restored desktop sizing. No review decision or external comment was submitted.
- New draft quotations no longer automatically import every included requirement. Import requires explicit item selection in the web UI. Server validation rejects selected items that are no longer included/available. Refresh retains negotiated rates and costs.
- The quotation grid starts with compact item, description, quantity, unit, rate, amount and action columns. Images and dimensions remain available through column settings and item details. Existing saved column choices are preserved. Light-theme editor canvas is white.
- Live selected import refreshed the single sample line without duplication; reload retained one line and its unchanged amount. The sample remains a draft with zero pricing; no prices, acceptance or payments were invented.
- Quotation mobile page navigation exposes the selected tab and keeps horizontal overflow contained. Payment schedule opens from the same quotation. Quotation review opens the connected Approvals preview.
- Validation: 28 drawing UI tests passed before the final responsive refit; the final viewer suite passed 4 tests after it. Commercial regression: 23 files / 143 domain tests passed. Connected frontend suite and web typecheck rerun after final edits.

The client portal, live provider sync and real client acceptance remain outside this checkpoint. This does not certify a live accepted-contract/payment/production handover. Follow the remaining delivery sequence above for those states; do not substitute a fabricated acceptance in the sample workspace.
