# Local catalog and Pre-execution update — 8 September 2026

This update runs locally at http://localhost:8130. The user explicitly requested no deployment; neither this catalog nor the navigation changes were deployed to production.

The catalog follows the earlier Room Book / Price Book structure documented in `../docs/catalog/room-book-price-book-architecture.md` in the parent repository and its existing catalog models. Saved catalog implementations and previews were reviewed. The later generic group index is replaced with direct Rooms → Items → Variants / Materials navigation and separate material master and material tables. Existing catalog records and downstream references are retained.

## Local import

The supplied `room_builder_catalog (1).xlsx` has SHA-256 `90ff51b53f46e41ada1aa81262224d868d0415427eb8d9ef51e1f8c5a43a9588`. Every cell in its 7,392 source rows was compared with the mapped records before import. The data includes 35 rooms, 243 items, 400 material master rows, 1,674 composition rows, and 150 supplied pricing-tier variants. A further 205 unpriced Standard variants cover items without supplied variants.

Imported into the local `wodana` database, workspace `f81e8362-8d08-440a-89dd-06ec7a8b46e7`, as default catalog Room Builder (`8292ae13-6134-52de-aa43-5a8c4df0128f`). The importer uses existing tenant permissions, validates DTOs and typed links, writes audit events, and wraps all batches in one transaction. An exact rerun reused all 8,383 child records and created zero duplicates. Existing-catalog fingerprints remained unchanged. Source prices retain INR and their units; tier amounts remain estimates until a tenant confirms a price entry. Specification-only BOM rows are not falsely presented as exact manufacturer products.

## Loading and UI

The initial request loads rooms, items, variants and units. Material records load only for the selected catalog, while the room table is usable. Editors and import tools load on demand. Graph indexes and search results are memoized; large pickers limit rendered results and retain search. The loading UI reports failures and supports retry. State resets across workspace changes.

The selected-case sidebar contains only Requirement gathering, Quotations, and Client portal, without section headings. Old overview links redirect to Requirement gathering. Existing transactional data and backend routes remain intact.

## Validation

- Catalog web tests: 28 passed, including navigation, room filtering, shared/variant-specific materials, viewer controls, deferred loading, retry, and failed-edit preservation; the final page subset of 8 tests was rerun after loading-state refinements.
- Pre-execution navigation/list tests: 32 passed after updating the expected landing URL.
- Core catalog and recipe tests: 22 passed.
- TypeScript production build and targeted ESLint checks passed.
- Actual browser create, edit, archive and restore actions passed against the isolated local QA database.
- Desktop 1440px, Windows-size 1280px at 125% scale, and mobile 390px checks passed with no page overflow or browser errors. Rooms rendered in approximately 0.4 seconds and selected-catalog materials completed around 1.2 seconds on this machine's local production build; these are local observations, not production latency guarantees.
- Both isolated QA and normal local database imports passed. The normal local rerun verified idempotency and preservation of existing catalogs.

Validation reports are in `qa-room-builder-local/`. Production import remains unperformed.
