# Requirements tabs — 9 September 2026

Requirements now contains three in-page tabs: Requirements, Measurements and Site plan. The original table and form components replace the combined notebook workspace. Client inspirations remains separate in navigation. Existing requirements, CRM links, attachments and measurements retain their records.

- Release: `20260909-requirements-tabs`, web port 13240.
- Build: `NGJlho2o18Q5PUh0ctSvy`.
- Previous release: `20260908-requirements-unified`.
- Verified backup: `/var/backups/wodana/current/release-20260908T205831Z`.
- Rollback: `/opt/wodana/releases/20260909-requirements-tabs/rollback.sh`.
- No backend deployment or database migration.

The production build, type check, targeted lint and 32 focused tests passed. Authenticated live browser checks confirmed all three tabs and their forms, alongside the separate Client inspirations navigation. Public login and API readiness passed. Browser verification did not save or change production records.

The deployment script now closes standard input for database dumps and build-ID inspection so remote commands cannot consume the remaining deployment instructions.
