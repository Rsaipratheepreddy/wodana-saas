# Quotation materials and compact editing

The quotation item table uses a white canvas, light structural dividers and restrained lilac actions.
Quantity and monetary controls are 36 pixels high. Units have a separate action opening item details.
Item names open the detail editor; materials have their own editor.

Materials and finishes are versioned catalog selections, with product names, codes, source catalogs and
individual removal. Multiple products can be selected. Custom specifications are separate from catalog
identity. The client document receives the selected names/codes and specifications without exposing
internal costs or catalog identifiers. Draft changes still require Save changes; issued/accepted
versions remain immutable.

Preparation import now carries material, finish and brand catalog identities from the detailed scope
specification, deduplicates existing scope links and ignores not-applicable selections. Explicit scope
refresh retains the existing selling rates and costs. An item exceeding the existing 12-selection
limit fails with a clear split-scope instruction instead of importing an unsaveable quotation.

## Validation

- 10 UI/helper tests: multiple products, separate notes, correct removal, cancellation, unit-link cleanup,
  blank/negative inputs, exact amount calculation and retained prices.
- 20 commercial backend tests, including Preparation catalog identity propagation.
- Web typecheck, targeted ESLint, backend build and linux/amd64 production images passed.
- Connected local browser test: Preparation import, two material selections, save/reopen, room editing,
  BOQ cost edits, scope refresh without lost rates, payment schedule persistence and stale catalog rejection.
- Desktop, tablet and mobile table cell bounds checked at 1440, 1280, 1024, 768 and 390 pixels.
- Public verification applies only unsaved browser changes; existing production quotation data stays intact.

## Deployment

- Release: `/opt/wodana/releases/20260907-material-builder`.
- Compose: `infra/hostinger/compose.material-builder.yaml`.
- Web: `wodana-material-builder-web-1`, loopback 13020.
- Core: `wodana-material-builder-business-core-1`, loopback 18010.
- Images: `wodana-web:20260907-material-builder`, `wodana-core:20260907-material-builder`.
- Web manifest: `sha256:4100986c224e80b0929c4083af90f74e197de5623d48d42aef81f6df96d6619c`.
- Core manifest: `sha256:e45a83a21c6a79b815e01913acbeae3697a2aab709aa4c232903ae29db2cc0ff`.
- No database migration. The same production database, object volume and provider vault are used.
- Nginx routing can be reverted using the release directory's `rollback.sh`. Previous web/core services
  remain available. Internal integration callbacks remain on the compatible 18000 core instance.
- The scheduled backup includes both current containers and their private runtime/proxy configuration.
- Pre-release backup: `/var/backups/wodana/current/release-20260907T075645Z`.
- Post-release backup: `/var/backups/wodana/current/release-20260907T080109Z`.
- Server preview and public HTTPS verification both passed product selection, mobile modal bounds,
  compact controls, white table styling, client preview and unchanged persisted quotation comparison.
