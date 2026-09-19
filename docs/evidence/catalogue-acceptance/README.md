# P04.4 catalogue acceptance

Date: 2026-09-18  
Boundary: local source, synthetic tests and disposable PostgreSQL databases only. No Palm Living data, invitation, provider connection or deployment was changed.

## Accepted behavior

- A resolved selling price freezes the catalogue, item, optional variant, unit, rate-card and pricing-zone versions together with quantity, currency, pricing date and tax basis. Saving an unchanged quotation retains an exact cloned snapshot; it does not silently refresh to a newer rate.
- Quantity, quotation currency, tax or unit changes mark the prior evidence `stale` and set its usable rate to zero until an explicit refresh or authorized override is saved. The assisted quotation handoff also re-resolves and rejects a proposal when the deterministic price basis drifted.
- The selected item, variant, rate zone and unit must still exist at the requested version. Archived or superseded variants cannot be reused. Applicable supplier offers exclude inactive suppliers/sites, archived item/unit records, expired/future offers and tiers above the requested quantity.
- Physical unit conversion is permitted only between versioned units in the same non-pack dimension. The source unit ID/version/label and exact conversion factor are pinned into the price snapshot and shown in price provenance. Pack or incompatible dimensions remain an explicit unit mismatch; Wodana never guesses a pack conversion.
- Selling-price resolution requires the quotation currency exactly. Supplier offers are also scoped to an explicit legal entity, currency and unit. Offers outside an entity's base currency remain labelled `FX required`; no hidden exchange rate or cross-currency arithmetic is performed.
- Internal quotation cost and gross margin now use separate `commercial.costs.view` and `commercial.costs.manage` permissions. Without view permission, the Business Core redacts line costs and frozen Deal File cost/margin before returning state. Without manage permission, submitted cost changes are ignored: stored line costs are preserved and injected costs on new lines become zero.
- The BOQ shows internal cost/margin only when view capability is returned. Cost inputs are enabled only with manage capability. Client-safe quotation projections continue to omit cost, margin and internal catalogue-price evidence.

## Migration proof

Migration `0091_commercial_cost_permissions.sql` was applied with the complete history to a newly created disposable PostgreSQL database.

- Both permissions were present after the fresh migration.
- A synthetic existing workspace with Owner and Administrator system roles was created; replaying the idempotent migration produced all four expected role/permission grants.
- Future workspace bootstrap remains covered by `WorkspacesService.insertSystemRoles`, which grants Owner and Administrator every registered permission.
- The disposable databases were dropped after inspection.

## Acceptance matrix

| Case | Evidence |
| --- | --- |
| Price-version reproducibility | `catalog-selling-price.service.spec.ts` and `commercial-price-retention.spec.ts` freeze old/new rate versions and preserve an unchanged quote snapshot. |
| Unavailable supplier/variant | Selling-price tests reject archived/stale variants; `supplier-offer.spec.ts` verifies current active supplier/site/item/unit/date/entity/currency/tier constraints. |
| Unit conversion | Selling-price tests cover `sq.m` to `sq.ft`, same-workspace source-unit loading and pack mismatch. Price provenance exposes the pinned conversion. |
| Margin permission | `commercial-cost-access.spec.ts` covers server redaction and write preservation; quotation builder tests cover hidden, view-only and editable states. |
| Multi-currency boundaries | Selling-price tests return `currency_mismatch`; supplier comparison marks base, conversion-required and unbound evidence without converting. |
| Quote handoff | `quotation-composer.service.spec.ts` rejects selling-price drift; retention tests make changes stale while preserving the original evidence. |

## Verification results

- Focused Business Core acceptance: 5 files / 37 tests passed.
- Full Business Core regression: 122 files passed, 1 intentionally skipped; 719 tests passed, 10 skipped.
- Focused web acceptance: 3 files / 19 tests passed.
- Full web regression, serial: 142 files / 670 tests passed.
- Business Core and web typechecks passed.
- ESLint passed for the changed P04.4 web files.
- Fresh disposable migration through `0091` and existing-role grant replay passed.
- `git diff --check` passed before this evidence record was added.

## Shared-component and release boundary

The price evidence and override flow use shared Button/Form/Input components, while the quotation list remains on the shared bordered DataGrid. P04.4 added no raw feature controls. The older quotation editor still contains legacy raw controls that predate this slice; their component migration remains tracked by the cross-product component cleanup and P06.1 rather than being concealed as complete here.

There is deliberately no exchange-rate engine in this acceptance slice. Cross-currency buying or selling requires a future versioned conversion policy and evidence source. Until then, users must choose an offer/rate in the required currency or use the existing permissioned selling-price override with a recorded reason. No live release or Palm Living UAT is claimed.
