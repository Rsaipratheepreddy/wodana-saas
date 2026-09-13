# Quotation canvas release · 7 September 2026

The quotation builder now uses a compact tool rail, a 360 px editing sidebar and a white document canvas. Rooms generate document pages; six items are shown per room page. Page navigation, fit/zoom, draft undo/redo and client preview stay separate from the commercial approval controls. Inputs no longer sit inside the document's table cells.

The sidebar provides Pages, Rooms, Materials, Details, Payments, Terms, Templates and Review. Room and item selection uses current workspace catalogs. Materials retain record IDs, versions, product codes and specification notes. Custom materials store a name, code, brand, specification and client-supplied flag within the quotation; they never create workspace catalog records. They appear in client/print output and in project scope on release.

Quotation templates are persisted per workspace with row-level security. Templates are created from saved server-side quotations using an explicit field allowlist. Client identity, source-scope IDs, approvals, issued hashes and accounting records are excluded. Applying creates fresh item, room, material and milestone IDs. Currency mismatches are blocked. Current catalog links are checked before application; unavailable products retain their written specification and show a warning. Rates and quantities are copied exactly. Draft replacement requires a specific review action.

Payment milestones use full-width fields and support drag or keyboard-accessible arrow reordering. Percentages still require 100% before approval. Existing acceptance, version locking, invoice and release controls remain in effect.

## Validation

- 13 frontend tests: materials, amounts, client privacy, template isolation, currency checks and fractional-quantity cent rounding.
- 25 commercial backend tests: material validation, acceptance hash, template filtering, catalog refresh and project material text.
- Local end-to-end test: Preparation import; catalog room/work/variant/material selections; multiple materials; custom client material; save/reopen; maximum numeric values; ten viewport/theme combinations; payment reorder; template save/apply; client preview. The catalog record count remains unchanged. Test records are removed afterward.
- TypeScript and scoped lint checks passed. Production images build successfully.
- Staged/public browser verification is recorded in the deployment log; it blocks commercial writes and verifies that the original production quotation is unchanged.

## Deployment

Release directory: `/opt/wodana/releases/20260907-quotation-canvas`.
Web port: `13030`. Business Core port: `18020`.
Migration: `0048_quotation_templates.sql`, additive table only, with an entry in the existing Drizzle ledger. Existing users, quotations, prices and integration connections are preserved.
Pre-release backup: `/var/backups/wodana/current/release-20260907T095546Z`; all 11 checksums verified.
Rollback: execute the release's `rollback.sh` to restore the previous nginx routing. Previous application containers remain available. The additive template table can remain in place on rollback.

The server's scheduled backup now includes the new release configuration and migration.

## Live verification

The final image passed the staged and public browser checks on `iglo.wodana.ai`, including the actual light/dark switch at 1440, 1280, 1024, 768 and 390 px. Existing production quotation content was compared before and after verification and remained identical. Login, landing, client portal and API readiness all returned 200. The public web release header is `20260907-quotation-canvas`.

Post-release backup: `/var/backups/wodana/current/release-20260907T101423Z`; all 13 checksums verified. The existing rollback containers remain available.

Final web manifest: `sha256:3af24bf0e5bac8695ce3462168d8da1d558780c20263226d41b7051cbf1e7826`.
Final core manifest: `sha256:121833ff71a1f1405a5dbdd56ccdf1f5dc7b9663e9ac420e760f617affab8db3`.
