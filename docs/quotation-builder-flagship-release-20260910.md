# Quotation builder flagship pass — 2026-09-10

## Product decision

The quotation builder is an area-based costing ledger. An area can be a room, a floor, delivery, installation, or any other priced section. Users can create areas and items directly in the quotation; the catalog remains an optional accelerator, never a prerequisite.

## Benchmarks used

- [Houzz Pro](https://pro.houzz.com/for-pros/houzz-pro-features): line items, assemblies, reusable templates, client-ready preview, online approval, and estimate-to-project continuity.
- [Procore estimating](https://support.procore.com/products/online/user-guide/project-level/estimating/tutorials/generate-bid-estimates): grouped subtotals, proposal granularity, and change-order inclusion.
- [Buildxact categories and items](https://help.buildxact.com/en/articles/2980681-how-do-i-get-started-with-categories-and-items-in-estimates): editable categories, direct custom items, optional price-list selection, and reordering.
- [Buildxact variations](https://help.buildxact.com/en/articles/3038641-all-about-variations-change-orders): variations as mini-estimates with materials, labour, markup, and category assignment.
- [JobTread estimating](https://www.jobtread.com/features/estimating): selections, photos, scope, terms, e-signatures, and downstream budget/project connections.

## Delivered workflow

1. Create an area directly or optionally start from the area library.
2. Add a custom item directly inside that area or optionally select from the item library.
3. Edit item, quantity, unit, rate, and variant in the costing row.
4. Open the focused Materials modal for material/finish/labour rows, client-supplied flags, specifications, costs, and automatic item-rate calculation.
5. Review the generated description, which remains separate from the item name and is rebuilt from materials plus item notes.
6. Add a photo, preview the client document, adjust scope/terms and payment milestones in expandable panels, then continue through internal and client approval.

## Synchronisation guarantees

- Accepted base quotations release every priced line—including custom lines—into project scope.
- Preparation-linked lines retain measurement, design, and version validation. Manual lines are no longer falsely rejected merely because they were created in the quotation.
- Linked change requests are stored in both directions: the quotation contains `requestIds`, and each selected request receives the quotation `quoteId`.
- Issuing and accepting a linked quotation continues to advance the change-request status.
- Accepted addition/deduction quotations remain controlled project variations and retain their material descriptions, quantities, units, values, and deduction targets.

## UX guardrails

- Deep plum `#76538f` is the primary action and active-state colour; green is not used as brand chrome.
- Areas are collapsible and show item count plus subtotal at all times.
- Item and Description are separate columns.
- Materials have a dedicated, visibly highlighted control and never expand inside the main table.
- Desktop remains an editable ledger; mobile becomes a labelled two-column editing flow instead of a horizontally clipped spreadsheet.
- Pricing summary stays visible. Scope/terms and payment schedule are progressively disclosed.
- AI, templates, undo/redo, preview, requirements import, custom units, custom variants, photos, pricing modes, and payment schedules remain available.

## Verification

- Web TypeScript: pass.
- Business core TypeScript: pass.
- Focused quotation unit tests: 16/16 pass before the progressive-disclosure addition; 11/11 quotation-workbench tests pass afterward.
- Quotation Playwright fixture: 6/6 desktop and mobile scenarios pass across materials, units, variants, photos, preview, header, manual edit, and AI paths.
- Business-core regression: 327 passed, 10 skipped.
- Full web regression: 100/100 files and 531/531 tests pass in the serialized sign-off run.
- Web and business-core production builds: pass.
- Web lint: zero errors; existing warning baseline remains.

No deployment was performed in this pass.
