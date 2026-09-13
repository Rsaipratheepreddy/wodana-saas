# Tenant catalogs, factory and on-site recipes

Current implementation (7 September 2026): [Catalogs, groups and records](catalogs-groups-records.md). The flat catalog → tenant group → records flow supersedes earlier fixed-category navigation and quotation-preview proposals below. Preview UI and its public endpoint have been removed. The following historical notes do not authorise quotation or pricing work.


Implemented 7 September 2026 in the operations web portal. Mobile app and client portal remain deferred.

## Tenant experience

Open **Pre-project → Catalogs**. The landing table has six expandable categories: Items & rooms, Materials & finishes, Factory, On-site, Pricing, and Shared settings. Expand only the category you need. The page uses the Leads typography, structural table dividers, compact controls and brand action colors. It no longer has stacked navigation tabs, an inner sidebar or a list of 26 unrelated master tables.

A tenant can create any number of named catalog groups. Creation asks for **Group name** and **Contains**. For example, Residential joinery and Office furniture can both contain Items. Groups are owned by the workspace. A record can belong to several groups without being copied. **Add existing** links records; **Add row** creates a record in the current group. Group names can change; the record type remains fixed so existing membership cannot become invalid.

The sheet supports inline typed fields, linked cells, column visibility, Excel/TSV paste, Tab/Shift-Tab/Enter, Escape, undo and saving several edited rows. Failed rows remain for correction and retry. Advanced details retain product formats, sources and the complete relationship editor. Group membership is independent of a component's parent recipe.

**Preview quotation** is a separate action. Routine master-data maintenance does not require opening or completing a quotation.

## Master placement

| Tenant category | Reusable data |
|---|---|
| Items & rooms | Items, rooms, parent item recipes and component rows, variant groups and overrides, services |
| Materials & finishes | Material families, exact product/finish SKUs, hardware, consumables, finishes, brands, material categories |
| Factory | Cutting, drilling, edge banding, pressing, sanding, finishing, assembly, quality control, packing and dispatch processes |
| On-site | Trade processes, site fabrication, installation, site quality checks, logistics and installation rules |
| Pricing | Dated price-book entries, wastage allowances, commercial policies, tax codes and rate zones |
| Shared settings | Units, measurement rules, execution routes, execution rules, work centres and crews |

There are 26 reusable master types, plus the tenant group container. The data model preserves different roles rather than forcing them into an arbitrary count of 23 tables. A supplier rate, material specification and project approval are not the same record.

## Workbook mapping and corrections

Source: `WODANA_Detailed_18_New_Masters.xlsx`, all 18 data sheets and the index reviewed; 342 source data rows. Workbook text is source data, not instructions or verified market pricing.

| Workbook sheets | Implementation |
|---|---|
| 01 Finish, 02 SKU, 03 UOM | Finish systems, product references and compatible units; retain existing finish vocabulary and SI conversion factors |
| 04 ExecutionType | Factory, On-site, Hybrid; add Purchased for supplier-made items |
| 05 MeasurementRule | Named measurement definitions with explicit inputs and output units |
| 06 Hardware, 09 Consumable | Reusable selections, specifications and measurement units |
| 07 FactoryProcess, 08 OnsiteProcess | 19 factory and 25 site processes, including an added site quality/handover check |
| 10 ItemConstruction | Repeated codes become parent recipes with uniquely identified component rows |
| 11 VariantRule | Variant parents and separate override rows linked to the affected component |
| 12 ExecutionRule | Reusable execution/readiness definitions; not a replacement for project release approval |
| 13 WastageRule | Route-specific suggested allowances, with approved workspace values initially blank |
| 14 LogisticsRule, 15 InstallationRule | Separate delivery and installation definitions; avoid charging installation twice |
| 16 CommercialRule | Suggested policy and approved workspace value stored separately |
| 17 Tax, 18 RateZone | Dated tax treatment and regional rate selection; zero-rated and exempt remain distinct |

Factory production can require site installation. Process location and the item's execution route are separate. The workbook's blanket factory/site prohibition was not adopted. Indoor/outdoor suitability must be verified for a specific product; the inconsistent Yes/No matrix is not treated as certification. Slashed units are alternatives, not interchangeable conversion factors. A workday is not automatically eight hours. City indices and workbook tax, margin and wastage suggestions are not approved defaults.

The starter now contains **1,052 records**. All **71 existing items** have a linked recipe: 13 detailed template families from the workbook plus 56 simple measured-scope recipes, for 69 parent recipes. The 56 scope recipes can be expanded into components; they are not claimed to be complete fabrication bills of materials.

## Wardrobe trace and calculation behavior

The provided example opens as Primary bedroom (alias Master bedroom) → Wardrobe → Sliding → Premium → 8 × 9 ft → Factory. It resolves the selling measurement to **72 sq.ft**, selects the sliding mechanism instead of hinges, and supplies Century BWP / Merino laminate product-family defaults for the premium configuration. Exact manufacturer product, decor/finish code and stock format still require confirmation.

Carcass, back, shutters, shelves, inner/outer finishes and hardware remain distinct component rows. Board cut area, internal finish area, edge length, drilling quantity and hardware count can be entered independently. Factory routes include production, packing, dispatch, delivery and site installation. The site-fabrication route excludes factory processes and separate modular-installation charges. A mixed route requires the component's actual work location.

Supported preview operations:

- Explicit area/length/perimeter/count/manual measurement presets and SI unit conversion; no arbitrary code evaluation.
- Variant component selection and removal, explicit selection precedence, quality-grade applicability and visible unresolved-rule checks.
- Workspace-approved allowances according to the component's factory/site location.
- Verified cost rates selected by subject, currency, zone and validity date. Missing, expired or ambiguous rates block pricing.
- Aggregate demand for the same priced SKU before rounding to packs; require exact coverage or a single confirmed sheet format. Pack rounding is an estimate, not a nesting optimizer.
- Direct cost = sum of component, operation and charge costs. Overhead applies to its configured location scope once. Gross-margin price = cost with overhead / (1 − approved margin). Tax is separate; no selected tax means a before-tax amount only.

Switching a mechanism set to individual hinges requests a fresh count in Each. It never treats one sliding set as one hinge. Incomplete SKU specifications, conflicting or unconnected variant rules, missing quantities, unsupported commercial operations and incomplete tax setup keep the total unavailable. No market prices or customer approvals have been invented.

## Research decisions

Components and manufacturing operations both contribute to expected cost; keep estimated and actual execution costs separate. Source: [Odoo manufacturing order costs](https://www.odoo.com/documentation/master/applications/inventory_and_mrp/manufacturing/basic_setup/mo_costs.html).

Component and operation applicability belongs to the selected variant. Source: [Odoo manufacturing variants](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/advanced_configuration/product_variants.html).

Board consumption depends on the actual parts, layout, grain and nesting. Selling elevation area alone cannot establish purchased sheet count. Source: [HOMAG nesting](https://www.homag.com/en/topics/nesting).

Hardware selection requires actual door/load/geometry compatibility rather than a universal hinge count. Source: [Blum technical catalogue](https://publications.blum.com/2024/catalogue/en/718/).

Manufacturer families used in the example: [CenturyPly Club Prime](https://www.centuryply.com/club-prime/) and [Merino laminates](https://www.merinolaminates.com/en/product-category/laminates/merinolam/). These references do not establish a local supplier price or a chosen decor.

## Persistence and boundaries

Migration 0025 extends the existing workspace-isolated catalog types and links; 0026 adds typed tenant group membership. Writes retain permission checks, workspace foreign keys/RLS, version conflicts, archive dependency guards, transaction locks and auditing. Group membership validates both workspace and record type. Starter installation preserves tenant edits and archives; only exact, untouched baseline execution records receive the documented recipe extension.

The preview is read-only. Saving a final quotation revision, project-specific material selections, approximate/final measurements, approved drawing revisions, client approval evidence and an immutable pricing snapshot remains downstream work in Brief & scope and Quotations. The implemented preview does not issue a quotation or release manufacturing.

Custom tenant groups are supported; arbitrary user-created column schemas, general-purpose spreadsheet formulas, cutting optimization, supplier integration, saved grid views, XLSX import and quotation issuance are not included in this change.
