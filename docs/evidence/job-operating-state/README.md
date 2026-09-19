# Job phase, timeline and Next Action acceptance

Local acceptance evidence for P01.2 on 18 September 2026. This is a Business Core projection and audited-stage slice, not a web-screen, Palm deployment or production-data change.

## Implemented contract

- A Job phase is derived from the furthest source evidence the actor can read: Intake → Qualify → Discover → Design & scope → Price → Agree → Release → Deliver → Handover → Aftercare. No mutable Job phase column was added.
- When a later Job source is outside the actor's permissions, the phase and Next Action are returned as `unknown` instead of inferring stale state from an older visible lead.
- One Next Action carries title, accountable membership/name, due date, reason, source type/ID/version and a working route to the existing CRM, Pre-execution or Projects screen.
- Blocked, Awaiting client and At risk are computed from current-phase source evidence. An old CRM reminder cannot outrank a live Project action.
- A responsible operator can set one short stage only inside the current derived phase. The command requires `jobs.stage.manage`, expected version, request ID and reason. Its current value is versioned and every write has an immutable event; exact retries return the first result and stale writes fail.
- Job detail returns an access-filtered timeline of immutable Job-link events, audited source events and stage events with occurred-at, recorded-at, actor and source pointer.

The additive `0096_job_operating_state.sql` migration stores only the audited manual stage and its immutable events. It does not copy customer, phase, owner, risk, commercial or project facts into the Job registry.

## Verification

- `npm test --workspace @wodana/business-core -- --run src/jobs/job-operating-state.spec.ts` — 1 file / 5 tests passed.
- `npm run test:smoke:palm-fixture` — passed against a fresh migrated disposable loopback database. It verified a released Project derives `deliver`, its action routes to that Project, stage set/replay/stale-write behavior, stage timeline evidence, and a CRM-only reader receives `unknown` with no leaked downstream action.
- `npm test --workspace @wodana/business-core` — 131 files passed / 1 skipped; 777 tests passed / 10 skipped.
- `npm run typecheck --workspace @wodana/business-core` — passed.
- `git diff --check` for the migration, contracts, Jobs service/controller/DTO/domain tests and funnel smoke — passed.

The first isolated run exposed a PostgreSQL parameter-type ambiguity in the permission-scoped projection; the corrected query passed the fresh migration/funnel rerun. The acceptance path also caught stale upstream CRM actions outranking current delivery work; action and flag selection are now constrained to the current evidence-derived phase.

## Remaining boundary

P01.3 must compose the shared page shell and bordered DataGrid into Today, Jobs and Job views and verify responsive light/dark browser behavior while preserving old deep links. Provider communication states remain P07. Palm clone/live migration, physical-device acceptance and deployment remain P09. No live tenant, provider, domain, invitation or deployment was touched.
