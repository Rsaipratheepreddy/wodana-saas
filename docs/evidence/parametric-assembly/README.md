# P04.2 first parametric assembly

Date: 2026-09-18  
Boundary: local source and automated tests only; no Palm/live data, provider or deployment was touched.

## Accepted slice

- The wardrobe is the first common measurable assembly. Its existing master-data template resolves variants, material/component rows, factory/on-site operations and charges from width, height and item quantity.
- The assembly output retains its template ID/version, component norm source ID/version, quantity basis, norm factor, net quantity, reviewed waste percent and allowed quantity. Process rows explicitly identify their norm as `labour_or_process` rather than hiding labour inside an unexplained total.
- Compatible units are converted through the catalogue unit factors. Pack demand is aggregated before rounding so two component rows do not independently over-order the same SKU.
- A preview can bind width, height, length or depth to distinct dimensions from a verified pre-execution survey. The actor must also hold `pre_projects.view`; catalogue access alone cannot disclose site measurements.
- The request pins survey ID, scope-item ID and survey version. Stale or recheck surveys fail clearly instead of silently recalculating from changed dimensions.
- A user may adjust a bound dimension only through a positive adjustment with a plain-language reason. The response keeps both the measured value/unit and applied value/unit, marks the adjustment and includes its reason in the change summary.
- Manual sandbox dimensions remain supported when no survey is attached. Once an axis is survey-bound, sending an unreasoned direct replacement is rejected.
- The previously unreachable preview path is connected end to end: the web BFF accepts bounded same-origin `/catalog/preview` commands and the Business Core controller exposes the validated `RecipePreviewDto` endpoint.

## Verification matrix

| Acceptance case | Evidence |
| --- | --- |
| Measurable wardrobe assembly | `catalog-recipe.spec.ts` verifies the 8 × 9 ft / 72 sq.ft assembly and execution routing. |
| Units and pack rounding | `catalog-recipe.spec.ts` covers compatible unit conversion, aggregated pack demand and invalid currency/date/rate boundaries. |
| Waste allowance | `catalog-recipe.spec.ts` verifies 72 net → 79.2 allowed at a reviewed 10% allowance without rewriting the net measurement. |
| Labour/process norm | Recipe line contract and test preserve basis, factor, kind and source record version. |
| Survey dimensions and justified adjustment | `catalog-recipe-measurement.spec.ts` covers verified source conversion, provenance, reasoned adjustment, stale/recheck and silent-override denial. |
| Permission/source service boundary | `catalog-preview.service.spec.ts` calculates from a pinned survey and denies a catalogue-only actor before any survey query. |
| Web-to-API path | Catalogue route and recipe preview component tests prove the same-origin command is proxied and the resolved measurement renders. |

## Regression results

- Business Core and web TypeScript checks passed.
- Focused Business Core matrix: 4 files and 32 tests passed before the final full run; the focused recipe/service matrix remained green after waste/norm assertions.
- Focused web preview/gateway matrix: 2 files and 3 tests passed.
- Full Business Core suite: 120 files passed, 1 intentionally skipped; 707 tests passed, 10 skipped.
- Full web suite: 139 files and 657 tests passed.
- `git diff --check` passed before this evidence record was added.

## Deferred boundaries

The preview does not itself create a quotation or persist a commercial commitment. P04.3 owns variant comparison and room/item selection UX; P04.4 owns immutable price/version reproducibility, unavailable variants/suppliers, margin and multi-currency acceptance, and the quote handoff snapshot. No generic visual formula builder was added.
