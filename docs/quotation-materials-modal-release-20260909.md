# Quotation materials modal — 9 September 2026

Status: live at https://iglo.wodana.ai. Verified 9 September 2026, 04:40 UTC.

## Changes

- Dedicated Materials column opens a standard, wide modal. No inline material accordion or repeated material headings in the main table.
- Modal edits are staged. Apply updates the quotation and its generated description; Cancel discards unfinished changes.
- Compact item-name cells, separate descriptions, neutral quotation styling, and clear variant/material actions replace oversized title boxes.
- Units, material types, pricing methods, and AI room context use the existing design-system selectors. Custom units and catalog/custom variants remain available.
- Material quantities and costs remain per item unit. Manual rates are preserved unless Calculate from materials is selected; client-supplied materials are not charged.
- Catalog identifiers are excluded from generated descriptions when they are only a repeated catalog code; authored material specifications are retained.
- AI assistance remains available in its collapsible panel. Photos, manual editing, save/reopen, preview, and undo/redo remain supported.

## Verification

- Web TypeScript check passed.
- 60 targeted web tests passed across nine files.
- 19 pricing/domain/material-text tests passed across three files.
- Six Playwright scenarios passed across desktop and mobile, covering modal Apply/Cancel, styled selectors, custom units, variants, materials/catalog additions, pricing, photo upload, saved quotations, preview, and AI retry/review flows.
- Reviewed desktop table and desktop/mobile modal screenshots.
- Targeted lint: no errors; existing quotation photo img-element performance warning remains.

## Deployment

- Live web release: `20260909-quotation-materials-modal` on port `13330`.
- Existing automated native-host deployment script; web-only, preserving the live backend.
- No database migration or customer-data edits.
- Previous web release: `20260909-quotation-item-table`.
- Deployment completed with a verified backup and a healthy new web container; the previous release remains available for rollback.
- Public login returned HTTP 200 with the correct release header. Backend readiness and PostgreSQL checks passed.
- Public static chunk `0p--5-o03fe78.js` includes the Materials modal, custom-unit dialog and new table instructions.
- `/testing/quotation` returned HTTP 404 in production. Interactive checks used isolated local fixtures, not customer records.
