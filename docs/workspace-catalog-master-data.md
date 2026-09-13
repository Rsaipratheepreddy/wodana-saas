# Workspace catalog and master data

Current implementation (7 September 2026): [Catalogs, groups and records](catalogs-groups-records.md). The flat catalog → tenant group → records flow supersedes earlier fixed-category navigation and quotation-preview proposals below. Preview UI and its public endpoint have been removed. The following historical notes do not authorise quotation or pricing work.


Current user decision: proceed with this starter catalog now. Expand the material/product/SKU coverage with verified supplier data during production setup.

Decision date: 7 September 2026. Current scope: operations web portal. Mobile and client portal are deferred. The latest navigation decision places **Catalogs in Pre-project**, alongside the **Pre-projects** list. Reusable master data remains workspace-owned. This supersedes the earlier Workspace settings placement. Brief & scope resumes after this foundation; the previously proposed preparation mockup is not the approved UI direction.

## Current implementation

See [Tenant catalogs, factory and on-site recipes](factory-onsite-master-structure.md) for the current model and behavior. Catalogs now opens with six business categories, tenant-owned named groups and compact editable sheets. It uses the portal theme and exposes quotation preview as an action. A record can belong to several tenant groups without duplication.

The original 491-record room/material library is preserved. Factory/site processes, construction and variant recipes, measurement/allowance/commercial rules, tax references and zones extend the starter to **1,052 records across 26 master types**. Tenant groups are additional workspace-owned containers. All 71 existing items link to one of 69 parent recipes; 13 template families have component-level detail, and 56 start as expandable measured scopes.

Nine original manufacturer entries retain 51 published size/pack options. Product-family references, workbook suggestions and unapproved rates are not presented as final specifications or market prices. Exact product/finish codes now belong to SKU/finish configuration; project selections and approvals remain separate downstream records. See the linked implementation note for workbook corrections, formula support, sources and validation.

## Old flow inspected end to end

1. **Workbook seed.** `room_builder_catalog.xlsx` feeds shared reference tables through `backend/seed_catalog.py`. It contains 35 rooms, 243 furniture elements, 40 units, 100 brands, 400 material-master rows, separate product-category sheets, 1,674 composition rows and 150 pricing-tier rows. The product sheets contain dimensions, brand/product labels, prices and sometimes performance claims, but the inspected headers do not include a source URL or verification date. Their presence is not evidence of current manufacturer accuracy.
2. **Workspace curation.** `catalog_management_service.py` provides organization-owned catalogs, draft/published versions, `SPACE → WORK_GROUP → ITEM → OPTION` entries, services/add-ons and CSV transfer. `catalog_workspace_sync.py` builds workspace entries from the shared reference data. Separate tenant-material and price-book models add workspace choices and rates.
3. **Selection API.** `catalog_service.get_catalog_rooms` merges shared rooms with the latest active tenant-catalog entries. The latest-version lookup does not filter to published status. Some other paths, including `get_room_builder_items`, still read the shared room/item/variant tables directly. The result is multiple reference namespaces and different selection paths rather than one consistently workspace-owned model.
4. **Requirement capture.** The old unified register calls `/catalog/rooms`, merges those room names with case room configurations and captured entries, and permits custom room text. It resolves a room reference and stable `room_key`, creates the case room configuration if missing, then saves the requirement or source with room context. The same register supports notes, files and inspirations.
5. **Catalog confirmation.** `confirm_catalog_requirement_item` locks the requirement case, calls `create_or_reuse_room_item`, and creates/reuses a confirmed requirement line with room/item/variant references. The catalog helper has a tenant-specific branch and a shared-room branch. Thus requirement capture can also create master data; it is not purely a consumer.
6. **Material planning and costing.** `_material_plan_payload` reads relevant requirements, material compatibility/composition data, an active workspace price book and material policy with room/item overrides. Dimension and rate choices are stored on requirement configuration. This mixes reference choice, project decisions and commercial context across several services.
7. **Quotation handoff.** `_quotation_payload_from_requirement` consumes confirmed requirement items, baseline/context, material policy and commercial configuration; `generate_quotation_draft` is a downstream step. Catalog changes must therefore not silently rewrite already agreed scope or quote values.

The new implementation does not modify or migrate the old production application. It establishes one workspace-owned catalog API in the new Business Core. No bulk copy of unverified workbook prices, generated-looking SKU combinations, technical claims or color codes has been performed.

## Ownership and structure

| Information | Owner | Rule |
|---|---|---|
| Room type, work template, category, unit, material, finish, brand, service | Workspace catalog, accessed through Pre-project → Catalogs | Shared across the workspace; editable by catalog managers |
| Bedroom 1, Bedroom 2, Kitchen on floor 2 | Pre-project/project | Separate room instances referencing a room type |
| Client needs, inclusions, exclusions, priorities | Brief & scope | Project decisions, not new global defaults |
| Measured dimensions and evidence | Site survey | Actual project values; never inferred from catalog sizes |
| Manufacturer format, thickness, pack and specification | Material record | Exact source, date and market; custom values allowed |
| Supplier, SKU offer, cost, selling rate, currency, tax and validity | Price book / costing | Dated commercial records; not reference facts |
| Accepted product, size, unit and rate | Project scope/quote snapshot | Store selected values and source record/version together |

The data model contains `workspace_catalog_records` and tenant-safe `workspace_catalog_links`. Record IDs and codes remain stable. Links distinguish category, brand, unit, room applicability, suggested materials and available finishes. A material belongs to one category and one measurement unit, optionally a brand and multiple finishes. The current material library has generic families and named manufacturer references within categories; it does **not** yet model an exhaustive manufacturer SKU/variant hierarchy.

No destructive delete is exposed. Archiving a master referenced by an active catalog record is blocked, with the dependent names shown. Restore verifies dependencies. All writes are permission-checked, version-checked and audited. Both tables enforce PostgreSQL row-level workspace isolation and composite foreign keys. An exact create retry reuses the same record without a second update or audit event.

## Material coverage

The starter spans boards/substrates; laminates/veneers; timber; glass/mirrors; tiles; stone/countertops; flooring; paints/coatings; wallcoverings/panels; ceilings/partitions; insulation/acoustics; hardware; modular accessories; sanitaryware; faucets/showers; plumbing; electrical; lighting; HVAC; appliances; fabrics/furnishings; furniture; doors/windows; metalwork; adhesives/sealants; waterproofing; civil materials; safety/automation; and landscape/exterior materials.

Each generic entry has a category-specific specification checklist. For example, lighting needs power, lumens, color temperature, CRI, cut-out, IP rating and driver compatibility; boards need grade, thickness, sheet dimensions and emission/product details. These are fields to complete, not claims that every listed product has a particular certification or suitability.

Sizes retain physical dimensions as numbers in millimetres. Pack quantities carry their own unit. A thickness-only option is not combined automatically with every sheet format. Nominal pipe sizes and hardware lengths must not be mistaken for actual outside diameters or cabinet clearances. Sheet, box, roll, bag, set and lot have no universal area or quantity conversion. Dimensional conversion factors are relative to metre, square metre, cubic metre, kilogram, each and hour; project/pack conventions remain explicit.

## Research register

The following manufacturer or standards sources were reviewed on 7 September 2026. The starter uses factual specifications and short original summaries, not copied catalogs or images. Product-specific sources take precedence over broad marketing guides. Availability still needs confirmation for the intended market.

| Source | Fact used in the starter |
|---|---|
| [Greenply size guide](https://www.greenply.com/blogs/plywood-size-charts-explained-everything-you-need-for-your-next-build) | Reference thicknesses 4, 6, 9, 12, 16, 19 and 25 mm; no assertion that every grade is sold in every combination |
| [Greenpanel Exterior MDF](https://www.greenpanel.com/products/mdf/exterior-mdf.aspx) | Published sheet formats and thickness options, stored separately |
| [Greenlam collection](https://www.greenlam.co.in/media/pdf/Greenlam%20Edition%202023-2025.pdf) | Super Gloss 1 mm, 2440/3050 × 1220 mm; larger format depends on decor |
| [Kajaria Gres catalog](https://www.kajariaceramics.com/catalogo/catalogue/gres-60x120.pdf) | Four listed tile formats, with box contents and thickness left product-specific |
| [Gyproc Gypboard Plain](https://www.gyproc.in/products-plasterboards/gypsum-plain-board) | Five published board formats, retaining 1219, 1829 and 2438 mm exactly |
| [Caesarstone specifications](https://www.caesarstoneus.com/design-and-specification/) | Standard/jumbo formats, 20/30 mm thickness examples, design-dependent availability and tolerance context |
| [Asian Paints Royale Luxury Matt technical sheet](https://static.asianpaints.com/content/dam/professionals/products/pdfs/tds/TDS_Royale_Luxury_Matt.pdf) | This product's 1, 3.6, 16.5 and 18 L pack sizes; not the packs of other Royale variants |
| [Blum MOVENTO technical catalog](https://publications.blum.com/2024/catalogue/id/510/) | Nominal lengths for 760H TIP-ON, with series/load context |
| [EGGER EL2835](https://www.egger.com/en/flooring/decors/1784252?country=PF) | Specific 1292 × 193 × 8 mm plank example |
| [Saint-Gobain DECORGLASS](https://www.saint-gobain-glass.com/DECORGLASS) | Pattern-dependent thickness range; no invented discrete stock formats |
| [Astral CPVC Pro](https://www.astralpipes.com/wp-content/uploads/2022/12/CPVC-Pro_PC_MAY-2024.pdf) | Preserve nominal-size/system/OD distinctions rather than treat trade names as actual diameters |
| [NIST unit conversion guidance](https://www.nist.gov/pml/us-surveyfoot/revised-unit-conversion-factors) | International foot and derived dimensional conversions |

India is the initial market assumption because the existing workbook and commercial fields are India-oriented. International unit support and selected international manufacturer references are present. This is not an independently verified UAE stock catalog.

## Next Brief & scope integration

The user's additional requirements are now captured in the [current item-specification plan](brief-scope-item-specification-plan.md): final requirements, exact approved 2D/3D revisions, client-selected materials with codes and references, brands, finishes and finish codes, item details, and approximate/verified final dimensions. These are project-specific records linked to workspace masters. The existing catalog's internal `code` must not be mistaken for a manufacturer product or finish code; exact product/finish code fields are available in master configuration; project selection snapshots remain planned.

When Brief & scope resumes, its room and work selectors should consume this workspace catalog, filter out archived masters, and include general work templates when filtering by room. Creating a case room stores `roomTypeId` plus its distinct display name and identity. Selecting work stores the catalog record ID/version and a snapshot of the selected label, measurement basis and unit. Material and finish choices remain suggestions until explicitly selected; they do not create quantities, prices or approvals.

Workspace managers may promote a useful custom project item to the master catalog through an explicit action. Routine requirement capture should not silently mutate shared master data. Existing project snapshots remain readable after a master is renamed or archived.

The master price book and read-only quotation preview are available. Saved Brief & scope, BOQ, quotation and procurement consumers are not connected in this change. Neither mobile nor client-portal screens have been implemented here. These boundaries prevent the current catalog work from falsely appearing to complete downstream operations.

## Validation and rollout

- Migration `0024_workspace_catalog` is registered and applied to the local `wodana` database. The earlier unfinished Brief & scope migration `0023` remains unregistered and unapplied.
- Backend tests validate every starter DTO, unique IDs/codes, typed references, dimensional rules, stale updates, missing/foreign references and exact request retries.
- Portal tests cover editing, retaining data after a failed request, subsequent save, view-only actions and room filtering of general work.
- `scripts/smoke-catalog.mjs` checks local authentication, real database persistence, repeated starter installation, duplicate rejection, optimistic concurrency, starter preservation, invalid references/sizes, dependency archiving and workspace membership. Its own test records are archived afterward.
- A direct query under the `wodana_app` database role verified that another workspace context sees zero Iglo catalog records.
- Browser verification uses the real local portal, including sourced material details and the room editor. Production deployment and legacy-data migration are separate work.

Code: [starter pack](../services/business-core/src/catalog/catalog-starter.ts), [service and rules](../services/business-core/src/catalog/catalog.service.ts), [settings UI](../apps/web/components/workspace/catalog-settings-page.tsx), [schema](../services/business-core/src/database/catalog.schema.ts).
