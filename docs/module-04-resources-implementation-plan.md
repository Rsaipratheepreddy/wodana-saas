# Module 04 — Resources

## Decision and limits

The 21 September product implementation plan remains authoritative for module order. Home is paused by the user. The next business-module design pass is Resources, before Sales/Clients/Inbox. Connections has an implemented setup surface but live authorization, operation verification and recovery acceptance are still open; advancing this design does not mark those complete.

## Navigation and ownership

Keep six main destinations: Home, Inbox, Sales, Clients, Projects, Resources. Connections and Settings are utilities. Resources owns Catalog, Materials and Prices as views of shared records, not three copies of the same data. Existing routes, access checks and bookmarked URLs remain valid. Requirements and Quotations belong to Sales; delivery work belongs to Projects. A client identity is shared across the journey.

Sidebar correction: show **Clients once** in Work, pointing to the shared CRM client directory when authorized, with the project-clients portfolio route as a fallback for project-only roles. Keep the older URLs valid. Because Catalog is the only Resources destination, the Company sidebar now links **Catalog directly**, with no Resources accordion or duplicate Clients entry. This changes navigation, not client ownership or permissions.

## First end-to-end slice

Start with the existing Materials library, while also verifying its empty state. Offer two concise actions: Import file and Add material. For import, reuse the existing parser, mapping, dry-run validation and transactional save. Show a review of unresolved units, specifications and prices before saving; preserve missing values rather than treating them as zero. Return to the imported records with their source retained. Let the user correct a record in context, save it, and find it again after refresh. Quotation reuse is the subsequent connected acceptance scenario, not a new quotation implementation in this slice.

## Dzylo benchmark and Palm Living boundary (25 September 2026)

The [official Dzylo product walkthrough](https://www.youtube.com/watch?v=NYw__DcZEH8) shows shared Leads, Quotations, Tasks, Procurement and Inventory destinations alongside project-specific views. A qualified lead becomes a room-wise quotation; conversion opens project execution. Procurement is followed through request, RFQ, vendor comparison, purchase order and delivery, with project context retained. This supports one record shown in both a cross-project work queue and its project context, not duplicate records or a requirement to open every project to find an order. The last point is our proposed information architecture, not a claim about Dzylo's internal data model.

Palm Living's confirmed flow adds gates that Dzylo's generic walkthrough does not establish: Sales Admin prepares each applicable quotation, QS reviews its estimate before issue, the client approves, Finance records payment, and Owner/Admin approves the agreement and payment. The first applicable paid approval creates exactly one Deal File/project; a later main quotation joins that same record. Material-list sign-off precedes procurement. Do not copy Dzylo's generic lead-to-project transition in place of these gates.

The local Palm catalog audit found 0 rooms, 534 items and 39 materials, with the material review indicating missing details and many items without linked materials. These are observations of the local demo workspace, not evidence about production. Resolve catalog relationships, units and price provenance before attempting to redesign quotation costing or execution tasks. Inspect and map the supplied default room-builder workbook before importing it; deduplicate against existing records and do not erase user data.

The supplied `room_builder_catalog.xlsx` has SHA-256 `90ff51b53f46e41ada1aa81262224d868d0415427eb8d9ef51e1f8c5a43a9588`, matching the workbook recorded in [the earlier local import](room-builder-local-20260908.md). That report proves a previous idempotent import into a different local workspace; it does not prove the currently open Palm workspace contains those records. The workbook has 23 data sheets and 7,392 rows, including 35 rooms, 243 furniture elements and 1,674 composition lines. Its source prices are INR reference amounts without current UAE supplier verification. Do not activate them as AED selling or procurement prices. Reconcile the target workspace and existing catalog identity, then dry-run the established importer before any scoped commit.

The currently open Palm local demo resolves to workspace `af041cf6-6bd5-4db1-932a-b145bda49d0c` in the local `wodana_palm_prod_copy_20260924` database. A read-only, tenant-scoped query found **Palm Living Core Collection** with 534 items and 0 rooms, plus **Palm Living electrical materials**. Neither is the earlier Room Builder import. The current catalog landing lists collections separately with per-catalog counts. Opening a collection scopes Rooms, Items, Materials, Brands and Units to that collection; Materials no longer combines records from multiple catalogs. The collection selector preserves the chosen catalog in the URL. A default marker chooses the initial catalog only; it never merges or replaces the others.

### Room Builder import audit (25 September 2026)

The read-only [audit command](../services/business-core/scripts/audit-room-builder.mjs) verified the exact supplied workbook hash, 24 sheets (index plus 23 data sheets), 7,392 source rows and unique row IDs within every sheet. Its 243 furniture elements all point to existing rooms; all 1,674 BOM lines and 150 tier variants point to existing elements. These are source-integrity checks, not an import.

The Palm local target has 635 active child records in Core Collection (534 items, 77 variants, 23 record groups and one unit), plus 41 active children in Electrical Materials (39 hardware and two units). Source provenance namespaces differ. Exact normalized furniture-item names overlap with Palm items in **zero** cases; the workbook's electrical product names also overlap with Palm electrical hardware in **zero** cases. This does not prove semantic non-duplication: near matches, alternative names and specifications still need review, and the existing Palm collections must remain untouched.

Import policy for this source:

1. Create a **separate Room Builder catalog** as the default selection, while keeping both Palm collections available as distinct rows in the catalog list and selector. Do not replace or move the 534 existing items or their references.
2. Preserve each workbook ID, sheet and row as provenance. Keep all original source columns as bounded specifications. Repeated product names within a record kind need distinct display identities (for example, append the source code); do not discard or collapse rows based on name alone.
3. Keep all `*_inr` fields and estimated costs as **source/reference specifications requiring review**. Do not create current UAE supplier offers, AED rates or approved selling prices without dated source, unit, inclusions, tax and currency decisions. Missing rates remain missing, not zero.
4. The electrical sheet has **61 rows across 11 brand IDs** absent from the 100-row Brands sheet. Two of those names match an existing source brand under a different ID; nine names do not. Retain the original ID/name on each product and flag the brand link for review. Do not invent a verified brand-master relationship.
   The 40-row Units sheet also mixes incompatible meanings in its `0D` group (pieces, kg, litres, watts, lumens and kelvin) and uses different base units for similar lengths. A reviewed [unit map](../services/business-core/scripts/room-builder-units.mjs) now normalizes physical units to the app's bases and leaves product-specific packs and technical ratings non-convertible. The original workbook conversion values remain source specifications; no unapproved automatic BOM/quotation calculation is created from them.
5. Import graph links only after validating target identity, type and catalog scope. Commit atomically, verify 7,392 source-provenance rows, all link targets, default selection and zero changes to existing Palm catalog fingerprints. Rerun must create zero duplicates. The old importer expects a mapped source file that is not present in this checkout, so it cannot be safely executed as-is against Palm.

**Local-copy status (25 September 2026):** The reviewed [deterministic mapper](../services/business-core/scripts/map-room-builder.mjs) accounted for all 7,392 source rows and generated 243 extra item construction templates. All 7,635 records passed catalog DTO and business-rule validation. A tenant-scoped rollback-only run validated every link and unchanged Palm catalog fingerprints; the same plan was then committed **only to the local Palm database copy** as a separate default Room Builder collection. A retry dry run reused all 7,635 records and created zero duplicates. The 61 missing-brand-ID product rows remain unlinked and marked for review. No workbook INR reference amount was activated as a quote, supplier offer or AED rate. Production has not been changed; collection UI, correction flows and role-specific pricing visibility still require acceptance checks.

## Interaction design

- One direct Catalog sidebar destination and one search/filter/action toolbar; Materials and Prices remain related views, not competing sidebars.
- A readable working list with aligned identity, specification, unit and price information. No oversized summary cards or repeated introductions.
- Direct actions for missing information on the affected record. Avoid a second, detached checklist repeating the whole list.
- Preserve search, filters and scroll when opening and closing an editor. Routine edits stay in the working surface; complex specifications, price evidence and history use the existing contextual inspector.
- After creating a related record, return to the original context with that record selected. Do not send users through Settings to continue their work.
- Compact shared button sizes, white bordered editable controls, distinguishable labels and values, consistently sized Lucide icons, existing primary and secondary colors. Use quiet surfaces and spacing for sections rather than decorative boxes and grid lines.
- Prices carry currency, unit and source/date context. Buying cost, selling price and stock availability are different facts. Permission checks govern cost visibility.

## Existing implementation to reuse

`apps/web/app/workspace/catalogs/page.tsx` already maps material and item views to `CatalogSettingsPage`. That component has search, imports, missing-detail checks, editable sheets, a record inspector and price dialogs. Improve this path instead of adding a competing library. The current material review repeats up to five problem records above the sheet; evaluate consolidating those actions into the working list. Current view changes reset search; context preservation needs explicit verification.

## Delivery sequence

1. Audit rendered empty and populated Resources screens and their sidebar entry against this navigation contract.
2. Refine the Materials list, empty state and contextual review using existing components and APIs.
3. Walk through import → validation → correction → save → refresh using a small representative file; then verify one record can be selected in quotation work without re-entry.
4. Apply the accepted pattern to Catalog and Prices. Continue to Module 05 Sales, Clients and Inbox afterward.

## Acceptance evidence required

Record observed results for empty and populated libraries, missing unit/price, invalid imports, duplicates/retries, failed saves, read-only roles and restricted buying costs. Check keyboard focus, narrow screens, long names and RTL. Refresh must retain saved records; failed drafts must remain recoverable. Compilation alone is not acceptance. No actual customer import or provider connection is implied by design work.
