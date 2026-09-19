# P04.1 catalogue records

Date: 2026-09-18  
Boundary: local source, tests and a disposable PostgreSQL database only; no Palm/live data, provider or deployment was touched.

## Accepted model

- The existing workspace catalogue remains the single storage model. Its public vocabulary is now explicit: `work` is an **item**, `variant` is a **variant**, and a `construction` template is an **assembly**. Existing record UUIDs and links are preserved.
- Categories, units, materials and other classifications continue to use typed catalogue links instead of copied strings. Records and assets retain version and archive semantics.
- Supplier offers are the purchase-cost authority. An active offer is bound to one workspace, supplier, catalogue item, unit and legal entity, with dated currency, source, tax treatment and optional lead time.
- Replacement offers carry explicit lineage through `replacesOfferId`. Active or archived offers remain immutable; a changed commercial fact is a new version rather than a rewrite of history.
- A legal entity's base currency is returned with each supplier offer. The API labels an offer `base`, `conversion_required` or `unbound`; applicable-cost selection requires an explicit legal entity and currency.
- Catalogue list responses expose legal-entity context and an explicit `priceVisibility` capability. Users with `catalog.view` but without `supplier_offers.view` see selling prices only; purchase/internal costs and imported cost attributes are removed server-side. Purchase/internal price changes require `supplier_offers.manage`.
- The web price editor follows the same capability: cost types and cost imports are absent for a selling-only user. This is a display aid, not the security boundary; the Business Core remains authoritative.

## Migration proof

Migration `0090_catalog_commercial_context.sql` was applied with the complete migration history to a newly created disposable PostgreSQL database.

- `legal_entity_id` and `replaces_offer_id` were present on `workspace_supplier_offers`.
- The legal-entity and replacement same-workspace foreign keys were validated.
- The replacement self-reference check was valid.
- The active-offer commercial-context check was installed `NOT VALID` deliberately: it rejects new or changed active offers without a legal entity while allowing a controlled backfill of any legacy active rows.
- The disposable database was dropped after inspection.

## Verification matrix

| Acceptance case | Evidence |
| --- | --- |
| Shared item/variant/assembly vocabulary | `catalog-record-model.spec.ts`; list payload integration in `catalog.spec.ts`. |
| Category, unit and record links | Existing catalogue service/schema tests plus the full Business Core and web catalogue regressions. |
| Supplier, legal entity, currency and lead time | `supplier-offer.spec.ts`, DTO/service reference validation and migration proof. |
| Active/versioned/replacement costs | Supplier-offer state, optimistic-version and immutable-active tests; `replaces_offer_id` same-workspace constraint. |
| Archive safety | Catalogue service prevents archive while active offers/record links depend on the record; supplier offers retain reason/actor/time. |
| Permission-aware prices | `catalog-pricing-visibility.spec.ts`, `catalog.spec.ts` and `catalog-price-dialog.test.tsx`. |

## Regression results

- Business Core typecheck passed.
- Focused Business Core matrix: 4 files and 30 tests passed.
- Full Business Core suite: 118 files passed, 1 intentionally skipped; 701 tests passed, 10 skipped.
- Web typecheck passed.
- Web catalogue matrix: 15 files and 56 tests passed.
- Full web suite: 137 files and 654 tests passed.
- Fresh disposable database migration through `0090` passed; constraint state was inspected before exact database cleanup.
- `git diff --check` passed before this evidence record was added.

## Deferred release gates

Before a release migration, legacy active supplier offers without a legal entity must be reported, assigned or archived, and the active-offer constraint validated. Exchange-rate conversion is not inferred: a non-base currency stays visibly `conversion_required` until a versioned conversion policy exists. Parametric assemblies, comparison/selection UX and reproducibility/multi-currency acceptance are P04.2–P04.4. No Palm/live migration or deployment is claimed.
