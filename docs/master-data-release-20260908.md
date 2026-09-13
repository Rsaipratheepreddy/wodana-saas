# Portal and Master Data release — 8 September 2026

The current portal is live at https://iglo.wodana.ai. Traffic switched at **2026-09-08T05:15:44Z** and HTTPS responses identify release `20260908-master-data`.

## Changes

- Shared lead, qualified-lead and room item tables; gradient actions, clear links, compact room cards and updated navigation.
- Focused item and material editors with separate details, specifications and linked records; material requirements remain distinct from selected products.
- Quotation Templates appears below Master Data. Client inspirations remains inside each pre-execution.
- The existing Rooms & joinery collection (35 rooms, 243 items) is the Master Data default. Only its default-selection metadata changed; the other 9,303 catalog records were fingerprint-compared and unchanged. Production retains its existing catalog contents and prices. No schema migration or local database replacement was performed.

## Runtime and recovery

- Release directory: `/opt/wodana/releases/20260908-master-data`.
- Compose: `infra/hostinger/compose.master-data.yaml`.
- Web: `wodana-master-data-web-1`, loopback 13130.
- Core: `wodana-master-data-business-core-1`, loopback 18090.
- Integration service remains on loopback 18006. Existing PostgreSQL, object storage and provider vault are retained.
- Images: `wodana-web:20260908-master-data`, `wodana-core:20260908-master-data`.
- Web build: `ZKPgGptPQL71V35_yuJ3c`.
- Previous web/core services remain available. Run `/opt/wodana/releases/20260908-master-data/rollback.sh` as root to restore the previous nginx routing.
- Pre-deployment backup: `/var/backups/wodana/current/release-20260908T050704Z`.
- Post-deployment backup: `/var/backups/wodana/current/release-20260908T051724Z`. Checksums verified; scheduled backups include this release's private runtime and rollback files.
- The runtime images extend the prior Linux images using compiled application artifacts; the dependency lockfile is unchanged. The local Docker builder reported an I/O error, so the previously established artifact-packaging method was used.

## Verification

- Production web/core builds, type checks, targeted lint, 44 web tests, 22 catalog tests and 25 commercial tests passed.
- Staged and public browser checks passed for the room grid, item editor, linked material table, material editor, templates, qualified leads, leads and mobile layout. No browser errors or server-error responses were observed.
- Public login, landing page and API readiness returned 200; current web, core and integrations are healthy.
- The server's `release.json` records archive checksums, validation results, configuration change and backup locations. No credentials are included here.
