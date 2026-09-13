# Interior catalog enrichment — 7 September 2026

Workspace: Iglo. Existing catalog `5a83688b-fab6-45ae-b1f3-1c6fa6d6a160` is renamed from Dubai materials & execution to Interior design & fit-out and uses location-neutral master data. IDs, codes, existing units, prices, saved quotation snapshots and the separate Rooms & joinery library are preserved.

78 records added: 34 materials, 14 hardware choices, 16 item variants, 12 work items and 2 manufacturer references. 127 existing catalog, room, work and service records now carry better scope descriptions, measurement notes, material choices and room applicability. 81 work items have material links; cleaning, debris removal and demolition do not receive artificial material defaults.

New specifications include cabinetry boards and veneers, tile and worktop finishes, acoustic and ceiling materials, lighting and fabrics. Thicknesses are design specifications, not fabricated manufacturer stock offers. No supplier prices, tax assumptions, certification claims, available inventory or manufacturer order codes were invented.

Four manufacturer families carry primary-source references checked on 7 September 2026: Blum CLIP top BLUMOTION, Hettich AvanTech YOU, EGGER Eurodekor and Knauf Wallboard. Exact components, dimensions, availability and commercial offers still require selection for the specific quotation.

The enrichment is applied through existing permission-checked, version-checked and audited catalog APIs. The prepared delta and originals are stored in `services/business-core/scripts/data/iglo-interior-catalog-20260907.json`. Run `prepare-interior-catalog.py` against an authorized catalog export to inspect a delta; `apply-interior-catalog.mjs` defaults to review mode and requires a private token file. API dry run created zero persistent records; the final import created 78 and updated 127. Repeating the application created and updated zero records.

Validation: all 205 DTOs and graph connections passed the core validator; no cross-catalog or archived-target links. The Kitchen → drawer cabinet → plywood/HPL → Hettich variant chain works through quotation catalog APIs. Protected-table fingerprints verify unchanged quotations, payment templates, quotation templates, rooms, scope and item specifications.

UI verification also exposed a pre-existing date hydration mismatch: the server showed 6 September while the browser showed 7 September for the same catalog update. Catalog-list dates now use UTC consistently. The web-only `20260907-catalog-data` release uses port 13060; core 18020 and integrations 18001 remain unchanged.

Pre-update database backup: `/var/backups/wodana/current/release-20260907T115822Z`, 17 checksums verified. Web rollback restores port 13050. Catalog before-images are retained separately from the web rollback; rolling back the UI does not undo catalog edits.

Staged browser validation passed without hydration errors after the UTC date fix. The catalog list, item details, catalog picker and material preview work with the live data; test requests to save quotations were blocked. The release image is `sha256:360fac069e04cf3d7f7cfa20c29a8ce50b99451a6fbbba95e1099a4581af5903`.

Public browser validation passed after cutover. Post-update backup `/var/backups/wodana/current/release-20260907T120715Z` includes the new runtime and catalog plan, with 19 checksums verified. Existing quotation and preparation fingerprints remain unchanged after all checks. No test messages, quotations or supplier rates were created.
