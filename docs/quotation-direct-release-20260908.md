# Direct quotation builder — 8 September 2026

The builder now starts with searchable room choices. Picking a room opens its products immediately; a custom room can be created from the same search. Duplicate room types receive a distinct editable room name.

Products show variants upfront, with the first available variant visibly selected for a new add. Add becomes a quantity stepper. A new product cannot be added while its variants are loading or unavailable; a product with no variants can be added normally. Different variants remain separate lines. Existing quotation variants are preserved, including selections missing from refreshed Master Data.

The basket has direct quantity and selling-price inputs. Product search remains in place across repeated adds and item edits. The item editor presents variants, quantity, unit, price and linked-material checkboxes together. Other materials, custom finishes and notes remain available below. Reference prices are retained as references, with no automatic currency or selling-price conversion. Done applies the room to the quotation draft; Cancel leaves it untouched and the existing quotation save/review flow remains.

AI room additions stay on the suggestion list, allowing repeated adds without an automatic modal. Preview item links open the relevant editor directly. Portal gradients, dark mode, RTL and keyboard access remain supported.

## Checks

- 57 quotation/component tests; web type checking, targeted lint and production build pass.
- Browser checks cover real Master Data, visible variants, repeated add/decrease, basket pricing, linked materials, search retention, 25 items, Done/Cancel, preview identity, light/dark accessibility, RTL and 1024/768/390px layouts.
- Browser verification uses unsaved quotation drafts and compares server records before and after.
- Frontend-only release, no database migration. The requirements notebook and Iglo session policy remain in the existing backend release.

## Release

- `20260908-quotation-direct`, web port 13180.
- Backend remains `20260908-requirement-notebook`, port 18130.
- Previous web release stays available for rollback.
- Web build: `EV8iXtVukEj_vclinLg3j`.
- Pre-release backup: `/var/backups/wodana/current/release-20260908T092919Z`.
- Live at https://iglo.wodana.ai. All six staged and public-site browser checks passed with no browser errors or server record changes.
- Post-release backup: `/var/backups/wodana/current/release-20260908T093320Z`.
