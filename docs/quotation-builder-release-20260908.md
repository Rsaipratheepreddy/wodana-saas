# Quotation builder — 8 September 2026

The quotation workspace now has a continuous document preview on the left and AI / Room builder tools on the right. The divider supports dragging, keyboard adjustment, RTL, and a saved width. Mobile uses a Preview / Builder switch.

The document shares its compact image header, room tables, concise variant names, material descriptions, totals and payment terms with the client and print views. Room configuration has a compact searchable cart, product browsing with variant choices and quick Add controls, plus separate Details and Materials tabs for the selected item. Repeat adds of the same product/variant increase its quantity. Master Data links, component material choices and source prices are retained; changing a variant clears incompatible catalog material selections. Selling prices remain explicit user input.

AI reads the authorized case brief, requirements, inspirations, layouts and measurements. Supported case-owned image/PDF files are read within visible limits. Suggested room/item/variant IDs are checked against the authorized Master Data graph. Analysis never edits the quotation; Add is explicit, quantities start at one and rates require review. Saved quotations can become reusable templates without copying client or approval details.

Woddy fetches the current Master Data graph on every analysis, including newly added rooms/items and aliases. It preserves distinct room instances, checks all supplied requirement entries, and shows missing or unmatched scope in a visible Needs review list. The former 12-room/15-item prompt limits are removed; plans beyond the supported quotation capacity are rejected explicitly instead of truncated. No model retraining or catalog synchronization job is required.

## Validation

- 59 web tests and 25 commercial backend tests pass.
- TypeScript, targeted ESLint and production web/core builds pass.
- Browser verification covers linked room configuration, save/reopen, real AI analysis, explicit Add/undo, template creation/application, compact print output, mobile, pointer/keyboard resizing and RTL.
- WCAG AA checks report no violations in the tested light, dark and dark-modal feature surfaces.
- Production evidence exposed ambiguous case-versus-catalog IDs in AI output. Request-local Master Data keys and strict graph validation now resolve verified suggestions; production provider checks returned linked rooms/items.
- Production-scale material lookup is indexed by record. The measured server computation dropped from 55.9 seconds to 0.14 seconds, with unchanged linked choices; a large-catalog regression checks material and price scope.
- Item configuration requests load only the selected recipe, linked variants, materials, units and prices. Seven configurations across three production items matched the full graph; scoped queries took 0.12–0.44 seconds.
- Regression coverage includes newly added room/item links, 24 separate bedroom instances, 30 items in one room, 181 requirement entries, omitted scope and invalid-link reporting.
- Modal details scroll independently while desktop room items stay visible; selecting another item returns to the top. Desktop, tablet and mobile form overflow is checked in the staged/public browser checks.
- Measurement-only case analysis is covered by a regression test.
- A 60-item room regression verifies searching and switching without losing hidden items, alongside cart add/quantity/variant behavior and cancel/apply isolation.
- Test edits to the local draft were restored and temporary verification templates were removed.

The first public AI check timed out after staged verification passed. The proxy was rolled back to the previous release. Analysis now retries one transient provider failure within an overall 110-second deadline, with tests for timeouts, temporary outages and non-retryable requests. Matching distinguishes configurable base products from extra requirements that still need review.

## Release

- Release: `20260908-quotation-builder`.
- Previous release: `20260908-master-data`.
- Web build: `FGTPsIiwxZOls4WEfYhaN`.
- Server directory: `/opt/wodana/releases/20260908-quotation-builder`.
- Web/core ports: `13140` / `18100`. Integration service remains on `18006`.
- Compose source: `infra/hostinger/compose.quotation-builder.yaml`.
- Existing Linux runtime images are extended using compiled artifacts; the dependency lockfile is unchanged.
- No schema migration or catalog data import is needed.
- The staged AI check found the inherited Gemini 2.5 model unavailable for this account. The release uses Gemini 3.5 Flash, matching the validated local configuration.
- Pre-release backup: `/var/backups/wodana/current/release-20260908T055512Z`.
- The server `release.json` records staged/public checks, backup locations and cutover time. `rollback.sh` restores the prior nginx routes; previous services are retained.

## Verified deployment

- Live: https://iglo.wodana.ai
- Cutover: 2026-09-08T07:37:57Z
- Post-release backup: `/var/backups/wodana/current/release-20260908T074029Z` (checksums verified).
- All eight staged and public browser checks passed with no captured errors or failed responses. Production case data remained unchanged.
- Scheduled `wodana-release-backup.timer` is active. Previous services and rollback configuration are retained.
