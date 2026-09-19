# P03.1 — stable Site/Room/Zone/Item identity evidence

## Accepted local boundary — 18 September 2026

P03.1 adds a tenant-scoped identity and revision layer over the existing discovery sources. It does not copy or become authoritative for brief text, measurements, designs, catalogue choices, prices, quotes, project quantities or finance facts.

### Identity rules implemented

- A valid pre-execution case with an active Job link gets one primary Site identity.
- Existing `pre_project_rooms.id` values are preserved as Room identity IDs.
- Included requirement `pre_project_brief_entries.id` values are preserved as Item identity IDs.
- Moving or renaming a source appends a revision; it does not remint the identity.
- Excluding or archiving an existing item archives its identity while retaining revisions and downstream references.
- Zone is a supported node kind, but no placeholder Zone is created. A real zone workflow can add one later under a Site or Room.
- Existing and new site evidence is attached to the primary Site ID. Measurements still retain their exact record/specification version.
- `GET /workspaces/:workspaceId/jobs/:jobId/tree` is a versioned, permission-checked projection. It is read-only.

### Migration and backfill safety

- `0089_one_tree_identity.sql` is additive: two new RLS tables plus a nullable Site reference on existing site evidence.
- The migration performs no automatic tenant scan or data backfill.
- `backfill-one-tree.ts` requires one workspace, defaults to a read-only report and refuses `--apply` outside a disposable loopback `wodana_job_smoke_*` database.
- A missing active case→Job link causes the apply transaction to fail; it never guesses lineage.
- Removing the adapter in a disposable transaction left the original 3 enquiries, 2 opportunities, 1 case and 1 project unchanged; rollback restored the adapter and its node.

### Verification

- Business Core typecheck: passed.
- Focused identity tests: 4/4 passed.
- Full Business Core suite: 115 files passed, 1 skipped; 686 tests passed, 10 skipped.
- Shared contract typecheck and suite: passed.
- Fresh-database migration from zero: passed.
- Synthetic database smoke: stable IDs, rename revisions, archive lineage, site-evidence attachment, API projection and cross-tenant RLS passed.
- Job identity preflight/apply/replay: 3 Jobs and 8 links, then 0 new roots/links on replay.
- One Tree apply/replay: 0→1 node, then 1→1 with no duplicate revision.
- `git diff --check`: passed.

No Palm/live data, deployment, production migration, client grant or external provider was touched. Multi-site authoring, explicit Zone authoring, client-safe tree access and discovery UI acceptance remain later tasks.
