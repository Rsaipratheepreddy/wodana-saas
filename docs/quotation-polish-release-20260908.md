# Quotation builder polish — 8 September 2026

This pass makes adding a product distinct from editing a quotation item. The product browser shows Add / Add again, an item count, and a direct Edit action. Existing rooms open with their room settings collapsed, while new rooms show the name and Master Data selection. Modal actions explicitly add a room to the quotation or update the room in the draft.

The AI suggestion detail now labels the variant and materials separately from its recommendation. The document and editor show a compact variant tag, using the linked product identity even after the quoted item or room is renamed. Generated material identifiers are omitted from customer-facing descriptions; catalog links, authored specifications, quantities and prices remain stored unchanged.

Headers and product rows are more compact. The item editor labels its current mode, keeps Details & price beside Materials, and shows the exact variant and description that appear in the quotation. The portal's primary gradient and light/dark themes are retained.

## Validation

- 62 web tests and 25 commercial tests pass, including add/edit isolation, cancel, undo, large-room search, variant labels after renaming, AI suggestion field separation and material notes.
- Web type check, targeted lint, core build and production web build pass.
- Browser checks cover real Master Data products, repeat adds, linked materials, 25 items, editing existing rooms, preview, light/dark accessibility, RTL and 390/768/1024px layouts.
- Browser changes stay in unsaved quotation drafts; server records are compared before and after verification.
- Release build: `fOpudc1_UwQ2n5vvdKzjM`.
- No schema migration or Master Data import.

## Release

- Release directory: `/opt/wodana/releases/20260908-quotation-polish`.
- Web/core listen on 13150/18110; the preceding quotation-builder release remains available for rollback.
- Pre-release backup: `/var/backups/wodana/current/release-20260908T081125Z`.
- `artifact-checks.json`, staged/public results and `release.json` record checks and cutover status on the server.

- Live at https://iglo.wodana.ai. All six staged and public browser checks passed for the verified build, with no browser errors or server data changes.
- Post-release backup: `/var/backups/wodana/current/release-20260908T081714Z`.
