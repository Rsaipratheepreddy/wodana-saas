# Catalogs, groups and records

Implemented 7 September 2026 in the operations web portal, under Pre-project → Catalogs.

Catalogs starts with a flat table of tenant-named catalogs. Opening one shows its groups in another flat table. Opening a group shows an editable records sheet. Groups may contain different master record types, and a tenant may create multiple named catalogs and groups. The current portal theme and Leads table controls provide the visual baseline.

## Data contract

- Existing catalog containers retain kind `catalog_group` and their IDs. This internal name remains for compatibility; the UI calls them catalogs.
- Groups are records of kind `record_group`, owned by a catalog through `catalogId`.
- A master record has one optional `record_group` link. Moving a record replaces only that organisational link. All other typed links, its ID, code, content and catalog ownership remain unchanged. Records without a membership appear in Ungrouped.
- Record meaning is independent of group names. Rooms, Items, Materials, Units and the other existing kinds retain their fields. The new `variant` kind links an option to an Item. `custom` records support tenant attributes, a unit, a parent and links to other master records.
- Parents are optional, same-type relationships. An Item → Variant relationship uses the explicit `work` link. Circular parent chains, unavailable targets, and links to another catalog/workspace are rejected.
- Names can change; saved codes, kinds and IDs stay stable. Catalog names and groups do not become identifiers used by downstream modules.
- Basic records can be saved with incomplete specifications. Required type-specific relationships are checked when marking a record Workspace verified. Existing dimensional, rate-record and reference validation remains in place.
- Bulk moves and group ordering run in one permission-checked transaction. Every record version and destination is validated before any write. Changes are audited.
- Archives preserve data. Active incoming references block archival. An occupied group must have its active records moved or archived first. A catalog with active records or groups cannot be archived. Restoring verifies its catalog and linked dependencies.

The existing workspace RLS policies and composite foreign keys remain. Migration 0028 extends allowed record/link kinds; migration 0029 enforces one group membership per record with a partial unique index. Neither migration deletes or recreates existing records.

## Everyday editing

The sheet supports cell editing, Tab/Shift-Tab across fields, Enter/Shift-Enter between rows, Escape, adding rows, undo, and pasting up to 100 Excel rows at a time. Quoted multiline clipboard cells are supported. Known linked names/codes are resolved to IDs; unknown links are reported rather than silently created.

Save reports completion after every submitted row has finished. Successful rows persist and failed rows remain available for correction and retry. Filters and pagination are disabled while edits are pending. Navigation warns before discarding unsaved work.

The default mixed-type sheet shows Name, Description, Type and Linked records. Filtering to a record type reveals its specific editable fields. Columns can be selected, and Group is available as an editable column. Selected saved records can be moved together. A compact details panel provides optional specifications, sizes/packs, sources and searchable multiple-record connections.

Catalog creation supports a blank catalog, the starter library or a copy of another catalog. Copying remaps record and group IDs together. JSON export retains typed reference data; direct XLSX file import is not implemented. Excel clipboard paste is available.

## Starter organisation

The starter contains 1,055 master records and six editable groups:

| Group | Starting data |
|---|---|
| Rooms & items | Rooms, Items, Variants, Services |
| Materials & products | Materials, Brands, Finishes, SKUs, Hardware, Consumables, material Categories |
| Measurements | Units and Measurement rules |
| Factory & on-site | Execution types, Factory processes, On-site processes, Execution rules, Resources |
| Construction templates | Construction templates and Variant rules |
| Allowances & references | Wastage, Logistics, Installation, Commercial rules, Tax references, Rate zones, existing rate records |

These groups are editable starter records, not a fixed navigation taxonomy. A group's default record type only suggests the type of a new row; it does not restrict membership. Specification tiers and quality grades accept tenant terminology.

A canonical Wardrobe item and Sliding/Openable variant records have been added. Existing Hinged/Sliding wardrobe item records retain their IDs and content. They are not automatically merged or reclassified. The canonical item links to the existing wardrobe construction template.

Adding starter data creates missing records and groups. It organises only ungrouped, unarchived starter records that are still at version 1. Edited and archived records remain untouched. Repeating the operation does not recreate data or move records back after tenant changes.

The reference workbook's 18 additional master definitions inform the data vocabulary, together with Rooms, Items, Variants, Materials and Brands. Workbook pricing and automation descriptions do not expand the implementation scope.

## Execution and future consumers

Factory, On-site and Hybrid remain master execution choices. Factory manufacture may include on-site installation. Hybrid identifies work that can be split between locations; it does not imply applying every process twice.

The wardrobe's width × height is a front-elevation measurement. Board consumption also needs component geometry, depth and counts. Exact product/finish codes, stock sizes and purchase units remain separate from project dimensions. Construction and variant records store reusable definitions; this page does not compute a price or create a BOQ.

Future consumers should store stable catalog record IDs and versions with project-specific selections/snapshots. Renaming or regrouping master data must not rewrite agreed scope. Downstream consumers are not connected by this change.

Quotation-preview actions and the public catalog preview endpoint have been removed. Earlier recipe utilities remain as unused implementation work for later evaluation. No quotation automation, complex pricing workflow, mobile app or client portal was added.

## Verification

- Backend catalog and existing recipe regression tests: 21 passed.
- Catalog page and spreadsheet interaction tests: 9 passed.
- Browser test: create blank catalog, create mixed groups, Excel paste with multiline content, persistence after reload, bulk move, rename/reorder groups, and narrow-layout containment.
- Local API checks: stale bulk selection is rejected before writing; foreign-catalog membership is rejected; group and catalog archive guards hold; repeated create and starter requests preserve data; removed preview endpoint returns 404.
- Before/after comparison retained all 3,168 pre-existing local records and their original content and typed links. Nine records were added to the main starter catalog; 962 untouched starter rows were organised. Existing ungrouped custom or edited records remain visible.
- Local catalog tables were backed up before the additive migrations.

Earlier documents describe prior proposals and unfinished quotation work. This document is the current implementation boundary.

## Table and price correction (7 September 2026)

Catalogs, groups and record browsing now use the same DataGrid and table styling as Leads. Non-interactive row areas open the row; Enter/Space works from the focused row. Selection, dropdowns and action buttons remain independent. Edit table switches to the Excel-style sheet for cell edits, paste and bulk changes.

Type-specific browsing exposes units, materials, brands, finishes, execution and prices as appropriate. The price column stays visible while scrolling a narrow panel. Price records remain separate dated records linked to their subject; purchase price, internal cost and selling price are explicit types. No prices are fabricated for starter data. Existing records with no price type retain their unspecified meaning. Prices can be added, edited, archived and restored without changing the referenced master record.

Group, type and form choices use shared design-system dropdowns. Linked records can be searched, multi-select lists open in a small popover, and advanced metadata stays under More specifications & references. Empty search results can search the entire catalog, including previously ungrouped records.

[Factory/on-site research and workbook reconciliation](catalog-onsite-factory-research.md) records the domain definitions. No factory/on-site multiplier or quotation calculations are enabled by these UI changes.
