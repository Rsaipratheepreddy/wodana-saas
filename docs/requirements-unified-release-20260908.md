# Unified requirements workspace — 8 September 2026

Requirements, actual site measurements and site plans now share one room-first workspace. Client inspirations remains a separate navigation item. Site managers can begin with a short project brief or room list, attach plans when available, and record only the measurements needed for each requirement.

## Validation

- Web production build, type checking and targeted lint passed.
- 56 focused web tests passed.
- The staged container passed its login health check and the existing business-core readiness check before cutover.
- Public login, authenticated Requirements workspace and API readiness checks passed after cutover.

## Release

- Release: `20260908-requirements-unified`.
- Web build: `qUlcdBm8LTAsFAbN50BNh` on port 13230.
- Previous release: `20260908-preexecution-design`; its healthy web container remains available for immediate rollback.
- Pre-release backup: `/var/backups/wodana/current/release-20260908T202720Z`; all recorded SHA-256 checks passed.
- No database migration or backend replacement was required.
- Live at `https://iglo.wodana.ai`.
- Rollback: `/opt/wodana/releases/20260908-requirements-unified/rollback.sh`.

Future web-only releases can use `infra/hostinger/deploy-web.native-host.sh`. It builds a Linux/AMD64 image, stages and health-checks it, creates and verifies a production snapshot, switches nginx, verifies the public release, and preserves the previous web release for rollback. Server passwords are requested without echo and are not saved to the repository or remote release directory.
