# Palm Living web release — 19 September 2026

Release candidate: `20260919-palm-product-r1`  
Target: `https://plm.wodana.ai`  
Scope: generic Wodana web product plus Palm tenant configuration and Core Collection data

## Verified release evidence

- Web: 164 test files / 759 tests passed; typecheck and production build passed.
- Business Core: 152 test files / 873 tests passed; 1 file / 10 tests intentionally skipped; typecheck passed.
- Palm end to end: CRM intake through pre-execution, quotation, project, procurement, production, onsite work, handover, and warranty passed.
- Palm configuration: first run created the 16 approved tenant settings; second run changed zero settings.
- Core Collection: all 542 source rows accounted for as 635 normalized records with 355 extracted images. The second import reused all records and images.
- Migration guard: the 72-migration production baseline plus all 34 pending migrations was replayed using the native-host release procedure. The rollback rehearsal left the baseline unchanged, the committed run reached all 106 migrations, and the final timestamp/hash history matched exactly.
- Clone/backup/rollback smoke: passed with no permission drift or orphaned data.

Prepared collection source SHA-256:

```text
5ad1c3696081169f82e3ffa778690126d567f0b23952493f35c2508d923f1e46
```

Checksummed deployment artifact:

```text
/Volumes/pratheep-ssd/development/Igolo-Management-main/release-artifacts/palm-core-collection-20260919.tar.gz
SHA-256 383b1d5a11a710b3acf6c1821a0d2d85d9b66cf6a5b5475de0173512d53185a2
```

The archive contains the reviewed manifest and all extracted assets. Validate both the archive checksum and the manifest's source-workbook checksum before a remote commit.

## Deliberate safety boundaries

- The website enquiry form remains `DRAFT` until Palm approves its public wording and a live receipt test.
- Numeric workbook prices are preserved, but no calculated rate cards are activated until Palm confirms whether prices include tax and which cost components they include.
- Sales pipeline stages and qualification questions are not invented; they remain pending Palm approval.
- Meta Lead Ads and PlyLeads are not silently simulated. Shared-link/QR intake works; provider connections require separately approved credentials/scope.
- AI remains optional and suggestion-only. It cannot invent measurements/prices, approve, or send a quotation.
- Alta is represented by the approved uppercase heading policy with Montserrat fallback until a licensed Alta webfont is supplied.

## Controlled deployment sequence

1. Restore Docker Desktop health and build both `linux/amd64` release images.
2. Authenticate to the production host and inspect the live Palm vhost, release, service ports, database migration prefix, storage volume, and health endpoints.
3. Select unused web/core ports from observed server state; never guess them.
4. Run `infra/hostinger/deploy-web.native-host.sh` with:
   - `PUBLIC_URL=https://plm.wodana.ai`
   - `NGINX_SITE=plm.wodana.ai`
   - `RELEASE_NAME=20260919-palm-product-r1`
   - `DEPLOY_CORE=1`
   - `APPLY_PENDING_MIGRATIONS=1`
   - an empty `WODANA_CRM_ONLY_WORKSPACE_SLUGS`
   - the observed unused ports and current Intelligence service values
5. The script takes and verifies a full database/Redis/object/proxy/release backup before mutation, rejects migration divergence, rehearses pending SQL in a rollback transaction, applies it atomically, starts and health-checks the new stack, and switches only the Palm vhost.
6. Authenticate to Palm production and run the tenant profile in dry-run then commit mode. Confirm the second commit has `changed: []`.
7. Validate the prepared collection hash, run the catalog import dry-run, commit it, and confirm a repeated commit reports 635 reused records and 355 reused images with zero uploads.
8. Run authenticated production UAT for permissions, CRM intake, pre-execution, quote/media/PDF/portal, project production/site/handover, notifications, analytics, and audit evidence.
9. Publish the public form and activate commercial rate cards only after their separate client approvals.

## Rollback

Every release directory contains `rollback.sh`, the prior Palm Nginx configuration, the release manifest, and the verified backup location. The proxy can be returned immediately to the prior release. Database restore is a separate deliberate operation from the recorded pre-release backup and is not run automatically for additive migrations.

## Current external blockers

- Docker Desktop currently returns an I/O error from its containerd metadata store. It needs a restart/repair before image production; three unrelated containers were left running rather than interrupted automatically.
- Production SSH authentication is not available in the current environment; the default key was rejected.
- Palm production login is awaiting a user credential handoff for authenticated seeding and UAT.
