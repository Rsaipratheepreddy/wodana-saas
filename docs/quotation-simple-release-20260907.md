# Quotation hierarchy release — 7 September 2026

The quotation builder uses a single Room → Item → Materials hierarchy. Room and item chevrons align on the left. Lilac room headings and a warm material heading distinguish levels; document pages remain white with plain tables and restrained typography.

Two primary sections replace the eight-tool rail: Rooms & items, and Document. Item quantity, unit and price appear together with its material list. Optional specification, variant and unit-catalog controls are collapsed. Catalog, custom and reusable quotation materials support add, replace, edit and removal. Room actions support rename, reorder and removal; items support duplication, moving and removal.

Catalog search results render inline so nested sidebar scrolling cannot dismiss or clip a floating menu. Search text alone never creates a catalog selection. The selected record, version and snapshot remain connected to quotation data. Custom materials stay quotation-specific and are retained in reusable templates.

The document section retains cover, room pages, totals, payment schedule, terms, acceptance, review and templates. Existing draft saving, fixed-version protection, imports, approval actions and payment calculations remain in use.

Validation: 16 frontend tests; connected local Preparation → quotation → catalog/custom materials → save/reload → payment reorder → template reuse → client preview; numeric maximums and widths in ten light/dark layouts. Local fixtures were cleaned up. Production checks use an existing draft with commercial write requests blocked.

Deployment: web-only image `wodana-web:20260907-quotation-simple`, web port 13040. Existing core 18020, database, integrations and storage are retained. Rollback restores the preceding nginx configuration pointing to web 13030. No migration or data seeding.

Status: live. Staged and public verification passed; the existing production quotation is unchanged. Iglo workspace, landing and client portal return HTTP 200 with release header `20260907-quotation-simple`. Pre-release backup `release-20260907T110143Z` verified all 13 checksums; post-release backup `release-20260907T110530Z` verified all 15 checksums and includes the new web release.
