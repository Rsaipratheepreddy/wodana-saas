# Quotation UI release — 7 September 2026

The live quotation builder uses the original portrait cover layout and interior image with the current
theme. The editor, client preview and printed quotation share the same cover component. Quotation
tables have explicit column widths, wrapping descriptions and contained numeric controls. A visible
**Edit materials** action opens material and finish fields with catalog selection. Accepted quotations
remain locked; the existing revision/variation workflow controls subsequent changes.

## Release

- Public release header: `20260907-quotation-fix`.
- Directory: `/opt/wodana/releases/20260907-quotation-fix`.
- Image: `wodana-web:20260907-quotation-fix` (linux/amd64).
- Image manifest: `sha256:ceb9e4d6806abe6cd33a9e9618c94591184879a51edef58ecee16cf32028230e`.
- Container: `wodana-quotation-fix-web-1`, loopback port `13010`.
- Compose source: `infra/hostinger/compose.quotation-fix.yaml`.
- Nginx routes the existing public web domains to port 13010. The previous web remains on 13000.
- This release makes no database migrations or business-data changes. Backend services and provider
  connections are unchanged.
- Rollback: run `/opt/wodana/releases/20260907-quotation-fix/rollback.sh` on the server. This restores
  the previous web routing without changing the database or restarting the backend.
- The scheduled native-host backup includes the new web configuration and container metadata.
- Post-release backup: `/var/backups/wodana/current/release-20260907T073516Z`.

## Validation

- Eight component tests, TypeScript and ESLint passed.
- Local connected quotation checks passed: list to builder, room/work/material catalogs, item and
  material editing, save/reopen, Preparation import/refresh, connected BOQ, payment schedule and stale
  catalog version rejection.
- The compiled release and public site passed table cell bounds and page layout checks at 1440,
  1280, 1024, 768 and 390 pixels.
- The public material editor applied changes in browser state; reload confirmed persisted production
  quotation data stayed untouched. Persistence was tested locally.
- The public client preview displayed the shared cover. No JavaScript errors occurred in the tested flow.
- Screenshots of the cover, table and focused material editor were visually reviewed.
