# Backend UAT baseline — 13 September 2026

This document is the B0 verification baseline for incremental backend work. It covers the
NestJS Business Core and Python Intelligence/Automation service only; it does not certify the
frontend or production infrastructure.

## Repeatable verification

Run from the `wodana-saas` directory:

```bash
npm run verify:backend
```

The command fails on the first type, test, build, lint, or Python-version error. It does not
connect to production, call external providers, or mutate a database.

## Initial result

- Business Core TypeScript check: passed.
- Business Core tests after the manifest guard: 331 passed, 10 skipped.
- Business Core production compilation: passed.
- Migration-manifest guard: 3 passed.
- Intelligence/Automation tests after environment isolation: 67 passed.
- Intelligence/Automation strict mypy check: passed for 29 source files.
- Intelligence/Automation Ruff check: passed.
- Clean PostgreSQL migration replay: all 52 registered migrations passed and produced 146
  public tables. The disposable database was removed after verification.
- Existing-installation rehearsal: a schema-only clone carrying 53 historical migration records
  accepted the current journal without error and retained all 146 public tables. No business rows
  were copied.
- Authenticated workspace HTTP smoke: passed 15 access, ownership, concurrency, hierarchy,
  isolation, archive, and integration safeguards against a disposable database and Redis instance.

## Baseline corrections

1. Production-settings tests now explicitly disable optional QuickBooks and Zoho configuration.
   This prevents credentials or callback URLs from a developer shell from changing test results.
2. The migration suite now verifies that every journal entry has a SQL file, journal indexes are
   unique and ordered, and no new SQL file can remain unregistered silently.
3. `0023_pre_project_brief_scope.sql` is an explicit historical exception. It is intentionally
   absent from the journal; migration 0032 conditionally creates the same brief foundation for
   installations that did not apply the reserved migration.

## B0 completion

The clean replay, existing-installation rehearsal, authenticated smoke, module map, defect register,
and repeatable verification command are complete. B1 behavior changes may proceed one isolated task
at a time.

No live deployment or production-data mutation is part of B0.

## Current regression status after the B2-B8 backend slices

- Business Core: 346 tests passed and 10 skipped; type-check and production build passed.
- Intelligence/Automation: 67 tests passed; strict mypy and Ruff passed.
- Clean database replay: all 57 registered migrations passed; the schema contains 147 public
  tables.
- Lead-flow HTTP/database smoke: 29 of 29 checks passed on a clean generic workspace.
- Workspace HTTP/database smoke passes 19 safeguards, including business-unit color and
  `visibleName`, terminology default fallback, optimistic locking, tenant isolation,
  unauthorized-write denial, and restore-to-default.
- Legacy configuration rehearsal: branded lead-channel and AED budget fallbacks are materialized
  only for existing workspaces with no override; existing custom taxonomies remain unchanged.
- Project file-index SQL was parsed against a freshly migrated schema; its focused service tests
  cover delivery and pre-execution grouping and tenant-safe project lookup.
- Portfolio-calendar HTTP/database smoke passed on a clean generic workspace, covering computed
  project summaries, department colors, timed events, overlap detection, department filters,
  stable department codes and visible names, the 93-day range limit, and denial of an outside user.
- Existing-installation rehearsal: a schema-only copy with 53 historical migration records accepted
  migrations 0053–0057. The terminology table remained empty, so existing tenants resolve the
  current product defaults without a data rewrite.
- The disposable PostgreSQL database and isolated Redis test data were removed after the smoke.
