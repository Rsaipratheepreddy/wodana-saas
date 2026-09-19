# P09.2 — Palm clone migration rehearsal

Date: 18 September 2026  
Scope: disposable Palm-labelled synthetic tenant and disposable local PostgreSQL databases only. No Palm/live access, export, invitation, provider, domain or deployment.

## Rehearsed migration

`scripts/smoke-palm-clone-migration.sh` builds the complete Palm synthetic funnel in a uniquely named local database, then:

1. refuses any non-loopback or non-disposable source database;
2. takes a custom-format PostgreSQL backup and verifies its SHA-256 digest;
3. restores the backup into a separately named local clone;
4. compares tenant defaults and brand, record counts, Job lineage, effective permission coverage, direct/team role topology, queue access, workflow fingerprints, provider state and domain state;
5. rejects unresolved lineage issues, pending invitations, active provider connections and active custom domains;
6. runs the One Tree mapping on the clone and proves it does not duplicate Job links or change effective permissions;
7. deliberately mutates only the clone, proves the snapshot changed, drops it, restores the backup, and proves the exact pre-cutover snapshot hash returned; and
8. re-reads the source and proves it was unchanged before deleting both disposable databases and the temporary backup.

## Passing local result

- 3 enquiries, 3 leads, 1 opportunity, 1 pre-execution case, 1 commercial case, 1 delivery project and 1 project-execution document reconciled.
- 3 Job identities, 12 active identity links and 3 One Tree nodes reconciled.
- 42 catalogue records reconciled, including the Palm electrical-material fixture.
- Orphan/link issues: 0.
- Effective-permission differences: 0 across 90 permission-coverage rows.
- Active provider connections: 0; active custom domains: 0.
- One Tree mapping replay: no duplicate links.
- Backup restore: exact snapshot hash match after deliberate clone mutation.
- Source snapshot: unchanged.
- Cleanup check: no `wodana_funnel_test_*` or `wodana_job_smoke_palm_clone_*` database remained.

## Verification

- `npm run typecheck --workspace @wodana/business-core` — passed.
- `bash ./scripts/smoke-palm-clone-migration.sh` — full synthetic Palm funnel and clone migration rehearsal passed.
- Targeted `git diff --check` — passed.

## Remaining gate

This proves the migration mechanism and rollback plan without client data. P09.2 remains open until an explicitly authorized, current Palm snapshot is placed in an isolated clone and its real role/team, orphan/link, configuration and provider/domain differences are reviewed. The script cannot be pointed at Palm live and does not perform a production cutover.
