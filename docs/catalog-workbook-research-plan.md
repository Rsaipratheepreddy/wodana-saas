# Catalog workbook: research and implementation plan

Current implementation (7 September 2026): [Catalogs, groups and records](catalogs-groups-records.md). The flat catalog → tenant group → records flow supersedes earlier fixed-category navigation and quotation-preview proposals below. Preview UI and its public endpoint have been removed. The following historical notes do not authorise quotation or pricing work.


7 September 2026 · Operations web portal · Research roadmap; implementation status below

Current implementation: six tenant-facing categories, multiple tenant-owned groups, inline editable sheets, typed parent/component links, factory/site masters and a read-only quotation recipe preview are available. See [Tenant catalogs, factory and on-site recipes](factory-onsite-master-structure.md) for the current structure and limits. The broader features below remain a roadmap wherever they are not listed as implemented; arbitrary schemas/formulas, saved views, full XLSX import and final quotation issuance are not complete.


The user rejected the current Catalogs navigation and record-by-record drawer workflow. Replace it with a **catalog-group table that opens an editable sheet**. Follow the supplied dense table reference and the existing portal theme. Keep the Pre-project sidebar destinations, Pre-projects and Catalogs. Mobile-app and client-portal implementation remain deferred.

This plan supersedes the catalog UI recommendations in `workspace-catalog-master-data.md`. The existing 491 starter records remain useful; acceptance of that dataset does not mean acceptance of its current UI or completion of the pricing model.

## 1. What the research supports

| Evidence | Application to this product |
|---|---|
| [Houzz Pro assemblies](https://pro.houzz.com/pro-help/r/how-to-create-assemblies) combine components with quantities expressed relative to a parent item. | Configure an item recipe once, then reuse it for actual project quantities. Keep detailed internal costs independently controllable from client-facing scope. |
| [Microsoft calculated columns](https://support.microsoft.com/en-us/excel/use-calculated-columns-in-a-table-in-excel-for-the-web) apply a column formula to the table. [Structured references](https://support.microsoft.com/en-us/excel/using-structured-references-with-excel-tables) use table and field names. | A user chooses a calculation preset once. New rows inherit it. Display meaningful field names instead of requiring users to maintain cell addresses. |
| [Airtable relationships](https://support.airtable.com/articles/1484376934-understanding-linked-record-relationships-in-airtable) distinguish hierarchy, reusable links and relationships carrying their own attributes. Its [formula fields](https://support.airtable.com/articles/8772429326-getting-started-with-the-airtable-formula-field) work with linked lookups and rollups. | Material quantity belongs to an item's component row. The material itself is reusable across many items and rooms. Sum component costs into the item. |
| [Odoo manufacturing costs](https://www.odoo.com/documentation/master/applications/inventory_and_mrp/manufacturing/basic_setup/mo_costs.html) account for components and operations, and distinguish expected from actual costs. | Include factory work, site labour and outsourced services in the recipe, with quantities, rates and their own sources. Actual execution costs belong to later operational records. |
| [Autodesk takeoff definitions](https://help.autodesk.com/cloudhelp/ENU/Takeoff-GS/files/Takeoff_Output_Definitions.html) keep measured outputs, units and classifications explicit. | A wardrobe's quoted elevation area, its board consumption, and the number of sheets purchased are separate quantities. |

These are research inputs. The screen structure, field design, calculation policy and implementation sequence below are recommendations for Wodana, not claims that these vendors implement the exact proposed design.

## 2. Start with a catalog-group table

The Catalogs landing page should contain one compact header, one toolbar and a table filling the content area. Remove the second permanent sidebar and the repeated page/section introduction.

Header: **Catalogs**. Toolbar: search, filter, **New group**, import/export. Put starter installation in the overflow menu after initial setup.

| Group | Records today | Contains | Linked information |
|---|---:|---|---|
| Rooms | 42 | Reusable room types | Applicable item templates |
| Items | 71 | Wardrobes, kitchens, ceilings, installations and other scope templates | Rooms, component recipes, operations and pricing rules |
| Materials | 270 | Families and manufacturer references; exact variants added when specified | Category, product parent, brand, finish, stock format and supplier offers |
| Services & operations | 20 | Existing services, extended with measurable production and site operations | Labour/equipment rates and location defaults |
| Finishes | 22 | Finish vocabulary, later exact finish specifications and systems | Manufacturer code, compatible products and process recipe |
| Brands | 11 | Manufacturer identities | Product references |
| Units | 26 | Dimensional units | Valid conversions; product-specific packaging is linked separately |
| Categories | 29 | Material/trade classification | Optional parent category |
| Price books | New | Dated buying and selling rates | Exact material variant or service, supplier, currency, unit and validity |

Counts above describe the existing local starter, not future minimum counts. Do not display fabricated price-book data.

Rows also show status and last update. Clicking a group opens its sheet. A small **Catalogs / Items** breadcrumb and group switcher let users move between sheets without returning through multiple pages. The group table remains the first screen on a normal Catalogs visit; a copied sheet URL opens that sheet directly.

Suggested routes: `/workspace/pre-projects/catalogs` and `/workspace/pre-projects/catalogs/groups/:groupId`.

## 3. One reusable editable-sheet experience

Use the supplied screenshot's information density: compact toolbar, sticky column headings, quiet row separators, selection checkboxes and readable linked-value chips. Preserve current neutral surfaces, typography and accent tokens. On larger screens show roughly 15–20 ordinary rows where content permits, with comfortable density as an option.

```text
Catalogs / Items                         Group ▾          Saved
Search…   Filter   Group by   Columns   Import / Export   + Row
Selected field: Board quantity     fx  [calculated value / formula]
┌───┬──────┬─────────────┬──────────┬─────────────┬─────────┬───────┐
│   │ Code │ Item        │ Rooms    │ Calculation │ Unit    │ Price │
├───┼──────┼─────────────┼──────────┼─────────────┼─────────┼───────┤
│ ▸ │ …    │ Wardrobe    │ Bedroom  │ Elevation   │ m²      │ …     │
│ ▸ │ …    │ Base cabinet│ Kitchen  │ Running len.│ m       │ …     │
│ + │      │ Add a row…  │          │             │         │       │
└───┴──────┴─────────────┴──────────┴─────────────┴─────────┴───────┘
```

The sketch describes controls and hierarchy, not an instruction to add an outer rectangular card border. The actual page and grid remain full-bleed.

Required editing behaviour:

- Click or type to edit a cell; Enter commits/moves down, Tab commits/moves across, Escape cancels. Arrow keys navigate when not editing. The final editable row supports adding another row.
- Paste a rectangular block from Excel, fill down, duplicate rows, apply a value to selected rows, and undo/redo an edit batch. Retain numeric precision, leading zeroes in codes and intentional blank values.
- Linked cells provide search and **Create new…** inline. Creating a brand, room or material should return to the original cell with that new record selected. Missing required fields remain visibly incomplete rather than being filled with fictional values.
- Separate row selection for bulk actions from cell-range selection for copy/paste. Plain text cells remain ordinary editable data; a formula is entered only in an explicitly configured calculated field.
- Sort, filter, resize/reorder/hide columns, freeze code/name, and save views. Reordering must not change relationships or formulas. A total row reports whether it totals the current filter or the full group.
- Show compact thumbnail cells for reference images and open attachments in a preview. Routine naming, linking, dimensions and rates stay in the sheet. Use a drawer only for substantial notes, files, history or complex formula editing.
- Display Saving, Saved and failed cells/batches. Retain failed changes for correction. No modal Save operation for every ordinary cell.

Inline formulas have a visible calculated indicator; ordinary edits change their inputs. A deliberate **Override value** action records the override and reason, and offers Restore formula. It must not silently replace a formula with a pasted number.

For narrow-screen web, keep horizontal sheet scrolling, pinned identity and an optional single-row editor. The dedicated mobile app is a separate future task.

## 4. Generic configuration without a database-design burden

Creating a group asks for **name and preset**: Rooms, Items, Materials, Services, Rates or General list. A preset supplies columns, links, defaults and validation. Users can rename, reorder or add appropriate fields without designing a schema first.

Field types: text/code, number with unit, money with currency, percent, date, choice, boolean, attachment, linked record, lookup, rollup and calculated value. Each type exposes only relevant settings. A linked field asks which group to link to and whether one or several values are allowed. A calculated field asks for a preset and its inputs before offering an advanced expression.

Custom groups can participate in lookups and references. A general list is not automatically a billable material or purchasable item: users select an appropriate preset when they need that behaviour. Protect identity and required business fields from accidental removal; display aliases can change without changing field IDs.

Minimum entry is a name; generate the internal code. Save unfinished rows as drafts. Only require cost, unit, supplier, size or formula inputs when the record is being used in a calculation that needs them. **Missing rate** is a visible incomplete result, never a silent zero. A deliberate free/included cost remains distinct from missing data.

Precedence must be predictable: an explicit project override wins over the selected variant/recipe default; workspace defaults fill only still-empty values. Each applied value can show its origin. Changing a room default offers an apply-to-existing-items preview instead of changing every item silently.

## 5. Parent and linked records serve different purposes

| Relationship | Example | Where its extra data lives |
|---|---|---|
| Parent classification | Boards → Plywood | Category parent; reject cycles |
| Product and variants | Product family → exact 18 mm, 2440 × 1220 mm product | Variant row with its own reference, dimensions and status |
| Room applicability | Wardrobe template applies to several bedroom types | Room–item links; no copies of the wardrobe master |
| Item components | Wardrobe → carcass, back, shutter, hinges | Component rows with role, linked material, quantity rule, waste and optionality |
| Work required | Wardrobe → fabrication, finishing, installation | Operation rows with location, performer, duration/quantity and rate source |
| Commercial offers | Same exact product sold by two suppliers | Separate dated price-book entries |

A material must be reusable across many parent items. Putting its quantity or price directly on an ordinary `parentId` relationship loses that distinction. Expand an item row to edit its **Components**, **Operations** and **Price preview** in place. Offer a flat Components view for bulk editing across many items.

Keep room types separate from project spaces such as Bedroom 1 and Bedroom 2. Keep category classification separate from the Catalogs group that controls the sheet's fields.

Materials need explicit distinctions between internal code, manufacturer product/decor code, supplier SKU, finish/texture code and drawing/item code. Store codes as text. Do not generate all possible combinations of brand, thickness, size and finish: add only an actual product/variant or a clearly unfinished specification.

## 6. Formula presets and measurement bases

Start with presets users can select by name. Configure their inputs once on the item template. Display named fields such as `{Width}` and `{Height}` and maintain stable field IDs internally. A typed quantity carries its unit; a money value carries its currency.

The formulas below are proposed calculation contracts. Lengths are converted to compatible units first; examples using metres produce m² or m³. Percentages are represented as fractions in expressions.

| Preset | Calculation | Typical use / qualification |
|---|---|---|
| Count / point / set | `quantity × units_per_item` | Handles, lights, appliances or an explicitly defined installation point |
| Running length | `length × quantity` | Skirting, tracks, worktops sold by length |
| Plan area | `length × width × quantity` | Floors and ceilings |
| Elevation area | `width × height × quantity` | A stated cabinet/shutter selling basis; not total board consumption |
| Measured surface | `sum(selected face areas) − deductions` | Coating or cladding actual surfaces; name the included faces |
| Volume | `length × width × depth × quantity` | Relevant fill or solid material; not a default for every interior item |
| Panel component | `panel_count × cut_length × cut_width` | Each actual carcass/shelf/back component; dimensions follow its construction rule |
| Selected edges | `sum(edges selected for finishing) × panel_count` | Edge banding; not automatically the entire perimeter |
| Coverage per coat | `surface_area × coats / coverage_per_litre_per_coat` | A selected coating product with that exact coverage basis |
| Coverage for full system | `surface_area / system_coverage_per_litre` | Do not multiply by coats again when coverage already includes the system |
| Consumption allowance | `net_required × (1 + waste_allowance)` | Workspace/project allowance on relevant material quantities |
| Whole packs | `ceil(required_quantity / contents_per_pack)` | Exact SKU/pack combination, positive pack content; see aggregation below |
| Rate-based labour | `work_quantity × labour_rate` | e.g. installed m²; apply the explicitly selected labour quantity basis |
| Person-hour labour | `elapsed_hours × people × rate_per_person_hour` | Do not multiply crew size again when the rate is already per crew-hour |
| Batch operation | `ceil(quantity / batch_capacity) × setup_time + quantity × run_time_each` | Useful factory process estimate, with setup/run charging stated |
| Component total | `sum(component_costs + operation_costs + assigned_charges)` | Reusable item recipe cost |

Additional templates can handle fabric fullness/repeat, carpet rolls, tile layout, density-based mass or manufacturer hardware tables. They must expose the additional inputs rather than hiding unreliable constants in a universal formula.

Quantity pipeline: **measured gross → explicit deductions → net work → material consumption → allowance → procurement grouping → packaging/MOQ rounding**. Keep the intermediate values visible in “Explain calculation”. A waste allowance of 10% and a process yield of 90% are different calculations; offer yield as a separate advanced method, never apply both accidentally.

Two important limits:

- Area divided by sheet area is only a preliminary sheet estimate. Final cutting must consider actual part fit, grain, edging allowances, kerf and usable offcuts. Autodesk's [nesting material example](https://static.au-uw2-prd.autodesk.com/MFG224000-L_Class_Handout_MFG224000L_Nesting_Utility_HandsOn_Bob_Van_Der_Donck.pdf) documents orientation, grain and spacing controls. The catalog must not present its area estimate as an approved cutting plan.
- Hardware quantities can depend on exact hardware and door characteristics. [Blum's hinge guidance](https://ea.blum.com/en/number-of-hinges/) considers door weight and height. Store a sourced rule/lookup or require an explicit selection; do not seed a universal hinges-per-door formula.

## 7. Material pricing and selling price

Master dimensions and product codes belong to the material. A supplier's rate belongs to an offer or price-book entry. A rate entry needs product/variant, supplier reference, rate type, price unit, currency, quantity break, valid dates, source quotation and update date. Include MOQ, order multiple, lead time, discounts and delivery/inclusion terms where applicable.

The Materials sheet may display **Preferred buy rate** and **Sell rate** as linked lookups with a source/date badge. Users can add or change the underlying offer from that cell. Expired or conflicting offers should request a choice; picking the smallest number alone is not a valid supplier policy.

Odoo's [RFQ documentation](https://github.com/odoo/documentation/blob/19.0/content/applications/inventory_and_mrp/purchase/manage_deals/rfq.rst) describes vendor-specific prices and lead times. Its [packaging documentation](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/product_management/configure/packaging.html) places pack contents on the relevant product. Our recommendation is to retain this commercial/product distinction while letting users edit both through one sheet.

Keep three quantities visible: **installed/net quantity**, **allowed consumption**, and **whole-pack purchase quantity**. Their costs can differ. Aggregate compatible demand for an exact SKU, specification/batch constraint and delivery phase before whole-pack rounding; do not round every component or room and then sum those inflated purchases. A separate rounding policy can be chosen when rooms/phases genuinely require separate packs.

Preserve two costing views: consumption cost for an item and actual/estimated whole-pack purchase cost for procurement. If a quote allocates full-pack expense to items, record the allocation once; do not also charge the leftover as consumed material. Stock deductions require an explicit available/reserved-stock basis when inventory integration exists.

Simple pricing modes:

| User choice | Behaviour |
|---|---|
| Enter a fixed selling rate | Apply it to the item's stated selling quantity; costs can be tracked separately |
| Calculate from a recipe | Derive material + labour + operations + assigned charges, then apply the selected selling policy |
| Use a supplier/subcontractor quote | Store the quoted scope, rate, date and inclusions; add only excluded costs |

Formulas:

```text
Direct cost = Materials + Labour + Equipment/processes + Subcontracts + Assigned freight
Cost basis = Direct cost + Explicit overhead allocation + Explicit contingency
Sell with markup = Cost basis × (1 + markup)
Sell at target margin = Cost basis / (1 − target margin)
Achieved margin = (Net selling price − Cost basis) / Net selling price
```

Margin is undefined at zero net selling price; target margin must be below 100%. Discount affects achieved margin and must appear in the calculation. Apply either markup or target margin, not both automatically. [Houzz's markup explanation](https://pro.houzz.com/pro-help/r/how-to-use-the-markup-calculator-on-houzz-pro) distinguishes these two bases.

An illustrative cost of 10,000 with 25% markup sells for 12,500 and yields 20% margin. A 25% target margin requires 13,333.33 before any tax or discount. These are arithmetic examples, not recommended margins or market rates.

Mixed currencies require an explicit conversion rate and date. Taxes and recoverability belong to the selected legal entity's tax configuration, not a hardcoded universal catalog percentage. Freight/setup/overhead allocation must identify whether it is per unit, batch, item or order. Reject duplicate inclusion when a supplier rate already includes delivery, finishing or installation.

## 8. Where factory and on-site finishing belong

Include them, but only where they apply. Provide an item-level **Work method** preset: Factory-made + site installation, Site-built, Purchased finished, or Custom/hybrid. It fills the relevant operation rows; users can refine individual rows.

Each operation has **Location** (factory/site/supplier), **Performed by** (internal team/subcontractor/supplier), quantity/time basis, rate source and inclusion status. Separate these concepts: outsourced work can happen either at a factory or on site.

| Element | Factory-made example | Site-built example |
|---|---|---|
| Preparation and assembly | Cutting, edging, drilling and assembly operations | Site cutting, fitting and assembly labour |
| Finish | Selected finish system, preparation and application operations | Selected system plus site preparation/protection and application |
| Logistics | Packing and transport when excluded from supply rate | Material deliveries and any handling included in the scope |
| Installation | Site fitting and adjustment | Site fitting; avoid repeating labour already counted above |
| Purchased prefinished product | Its finish is already part of the product specification | Add only necessary installation/touch-up operations |

The Finishes sheet holds the appearance and exact finish code where known. A finish-system recipe holds actual products/stages, coverage basis, application method, coats and related operations. The **location of application** is an operation property; “Factory” is not a finish colour or material category.

For example, [Asian Paints' PU Palette technical sheet](https://www.asianpaints.com/content/dam/asian_paints/restricted/woodtech-pu-palette.pdf) qualifies its stated coverage by coat, surface condition and spray application. This supports storing a product-specific coverage basis. It does not establish a universal factory/site price or a coverage value suitable for every finish. Reconfirm the applicable product sheet when specifying an actual job.

Keep drying/curing elapsed time separate from chargeable worker hours. A location change can affect process, rate and lead time; show the resulting differences instead of applying a generic factory-versus-site multiplier. Show none of these fields for a room type or an ordinary brand record.

## 9. Worked example: quantities through price

Illustrative inputs only; no live supplier rates, tax treatment or production approval is implied.

| Step | Inputs | Result |
|---|---|---:|
| Net floor area | Measured work | 20 m² |
| Allowed material | 20 × 1.10 | 22 m² |
| Whole packs | ceil(22 / 1.44 m² per box) | 16 boxes |
| Purchased coverage | 16 × 1.44 | 23.04 m² |
| Material purchase cost | 16 × 900 currency units/box | 14,400 |
| Installation | 20 net m² × 250 currency units/m² | 5,000 |
| Delivery | Explicit excluded charge | 600 |
| Direct cost | 14,400 + 5,000 + 600 | 20,000 |
| Cost basis | 20,000 + 10% illustrative overhead | 22,000 |
| Selling price | 22,000 × 1.25 | 27,500 |
| Achieved margin | 5,500 / 27,500 | 20% |

The 1.04 m² beyond allowed consumption remains visible as purchased excess. Installation uses the 20 m² net scope in this example; it does not inherit material waste or box rounding. This example charges the full-pack expense to this one job, with no second consumption-cost charge.

## 10. Existing code: reuse and changes required

Inspected paths are relative to the repository root:

- `wodana-saas/apps/web/components/workspace/catalog-settings-page.tsx`: eight kinds selected by an inner sidebar, single-record inspector/editor, no group directory or multi-cell sheet editing.
- `wodana-saas/apps/web/design-system/patterns/data-grid.tsx`: existing portal grid supports individual cell editing, filtering, selection, child rows and virtualization. The inspected implementation does not provide rectangular clipboard paste, spreadsheet range selection or fill-down. Reuse its visual language and appropriate primitives; do not describe the current component as a complete spreadsheet.
- `wodana-saas/services/business-core/src/catalog/catalog.dto.ts` and `catalog.service.ts`: eight hardcoded kinds; free-text attributes; links restricted by kind. Links have no recipe quantity, formula or operation information. Record saves are already workspace-scoped and version-checked.
- `backend/app/services/measurement_service.py` and `schemas/measurement.py`: old app already has named quantity inputs, restricted arithmetic, dimensional checks, deductions, waste, rounding and calculation explanations. Preserve these useful contracts when designing the new engine. Its workday conversion uses a fixed eight-hour assumption; the new model should make working hours configurable.
- `backend/app/services/pricing_service.py`: old app has controlled unit conversion, fixed/markup/discount rules, decimal rounding and recorded price-book calculation inputs. Reuse that auditability, extend it for target margin and component cost rollups.
- `backend/app/schemas/pricing.py`: old catalog configuration has measurement-profile references and material links carrying role, quantity, unit and optionality. These are closer to the needed recipe relationship than the new catalog's simple links.
- `backend/app/models/catalog.py`: older variant wizard pricing documents a fixed/area focus. Do not generalize that limited width × height path into every material or trade.

The new catalog needs persisted group/field definitions, typed values, hierarchical and multi-record links, quantity-bearing recipe lines, operations, dated price offers and versioned calculation rules. Keep structural IDs, permissions and costing relations typed even when custom columns are flexible.

Persist a rectangular edit/import as a bounded transaction with a mutation ID and expected row versions. Validate dependencies together, return exact cell errors, and avoid partially creating unlinked rows. Preview import column mapping, links, duplicates and changes once; apply a confirmed batch without a confirmation dialog per row. Keep drafts recoverable after a refresh or failed save.

Formulas require a restricted parser, stable field references, dependency/cycle detection, dimensional checks, decimal monetary arithmetic, bounded evaluation and server-side verification. Disallow executable JavaScript, external workbook/network calls and arbitrary code. Changing a formula shows affected rows and sample results. A calculation error blocks a complete price instead of disappearing into zero.

For the grid implementation, [Handsontable with HyperFormula](https://handsontable.com/docs/react-data-grid/formula-calculation/) provides spreadsheet calculations, while [AG Grid clipboard support](https://www.ag-grid.com/react-data-grid/clipboard/) is an Enterprise capability. [HyperFormula lists GPLv3 and proprietary licensing](https://hyperformula.handsontable.com/docs/guide/licensing.html). These are implementation options, not installed dependencies or purchase decisions. Evaluate the needed grid interactions against the existing design system and licensing before choosing a production dependency. Keep business calculation contracts independent of the grid library.

## 11. Build order and acceptance

1. **Groups and editable sheets:** replace the inner-sidebar UI; reuse the 491 records; provide inline editing, linked quick-create, paste, fill-down, duplicate, undo and draft/error feedback. Add group presets and optional custom fields. Do not expose placeholder pricing controls as working calculations.
2. **Relationships and recipes:** category/product parents, room applicability, exact variants, component rows and operations. Demonstrate one wardrobe, one ceiling and one flooring recipe with clear measurement bases.
3. **Formula and price model:** named-input presets, typed units, explainable results, dated price books, packaging aggregation, markup/margin and factory/site work methods. No invented supplier prices or production yields.
4. **Use in Brief & scope:** select a room, an item template and materials; enter approximate dimensions once; obtain a clearly preliminary cost. Later link final requirement, exact approved 2D/3D revision, client selection evidence, finish codes and verified dimensions to a versioned project item.

Agreed project specifications and issued quotations retain their selected product, formula and price-book versions. New master data must never silently rewrite an approved item. Formula-derived estimates do not authorize fabrication; final dimensions, selected products and approved design remain separate decisions.

Acceptance scenarios:

- Paste 50 room/item/material rows and resolve missing links in the same sheet; no 50-drawer workflow.
- Link one material variant into several item recipes without duplicating its master or supplier rates.
- Reorder and filter rows without changing relationships or numeric results.
- Enter equivalent mm and ft dimensions and obtain equivalent physical quantities.
- Catch missing rates, zero coverage, incompatible units/currencies, circular references and stale edits.
- Explain net, consumption and purchase quantities separately; aggregate packs once.
- Compare a factory-made/site-installed item with a site-built alternative without double-counting work.
- Update a supplier rate and preview affected current estimates while leaving issued/approved snapshots intact.
- Preserve drafts when a save fails; server rejects unauthorized workspace or cost access regardless of visible columns.

Arithmetic examples in this document were independently checked with decimal calculations. This is not validation of a production formula engine. An arithmetic wording inconsistency in the Houzz assembly example was not copied into these formulas; source claims and examples were evaluated rather than treated as executable specifications.
