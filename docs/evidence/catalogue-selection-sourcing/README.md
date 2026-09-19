# P04.3 catalogue selection and sourcing evidence

## Accepted local behavior

- The quotation item browser composes the shared bordered `DataGrid`; search remains server-backed/debounced and room/all-item scope is explicit.
- Active variants can be compared by specification and selling-price policy, then selected without leaving the room workflow.
- Adding an item preserves the selected item/variant IDs and versions. Existing quotation lines remain unchanged until the room edit is applied.
- A persisted quote price explains its rate-card reference, version, effective dates, pricing date and tax treatment. Manual overrides show their reason, actor and time. Stale backend issues remain visible.
- Supplier offers have a permission-protected comparison page at `/workspace/pre-projects/supplier-offers`. It shows item, supplier/site, unit price, quantity tier, legal entity, currency boundary, validity, lead time, source evidence and freshness state.
- Supplier currency is not silently converted. Offers outside the legal entity base currency are marked `FX required`; unbound legacy offers are marked `Entity needed`.
- Purchase-offer data continues to require `supplier_offers.view`. Selling-price-only catalogue users do not receive supplier offers or purchase prices.
- No native procurement editor was added. Supplier comparison and quotation composition are office workflows; the existing native survey flow already identifies the room/item where field lookup is valuable.

## Shared-component compliance

- Product, variant and supplier list views use the existing TanStack-backed `DataGrid` column definition pattern.
- Buttons, segmented control, select, form fields, badges, callout, container and stack use shared design-system components.
- The missing shared `PageHeader` pattern was added once to the design system and consumed by the sourcing page.
- The touched feature files contain no raw `<table>`, `<button>`, `<input>` or `<select>` elements.

## Automated checks

- Web typecheck: passed.
- Focused web regression: 10 files / 62 tests passed.
- New/changed P04.3 focus: 5 files / 14 tests passed.
- Business Core supplier-offer focus: 1 file / 5 tests passed.
- Touched-file ESLint: passed.
- Repository-wide ESLint remains blocked by nine pre-existing errors outside P04.3; none are in the files listed below.
- Full web regression is recorded in the delivery-board evidence row after the serial run completes.
- `git diff --check`: passed before evidence update.

## Primary implementation files

- `apps/web/components/commercial/quotation-product-picker.tsx`
- `apps/web/components/commercial/quotation-catalog-price.tsx`
- `apps/web/lib/commercial/catalog-price.ts`
- `apps/web/components/workspace/supplier-offer-page.tsx`
- `apps/web/app/api/workspace/supplier-offers/route.ts`
- `apps/web/app/workspace/pre-projects/supplier-offers/page.tsx`
- `apps/web/design-system/patterns/page-header.tsx`

## Release boundary

This is local code and synthetic automated acceptance only. No Palm Living data, supplier cost, deployment, invitation or provider connection was changed. P04.4 still owns reproducibility, unavailable records, unit conversion, margin permission, multi-currency boundary and quote-handoff acceptance.
