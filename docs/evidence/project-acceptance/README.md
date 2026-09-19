# P08.6 — connected project acceptance

Date: 18 September 2026  
Scope: local application, local PostgreSQL and synthetic records only. No Palm/live mutation, provider call, invitation or deployment.

## Accepted path

The database-backed acceptance run starts with an enquiry and finishes with a completed project without bypassing the product's hard controls:

1. qualify the enquiry, create the opportunity and pre-execution case, then accept a revision-bound quotation and definition;
2. record the agreement, independently verify the required receipt, complete Owner Review and release the exact Deal File once;
3. initiate the project with an accountable owner, team and dates, and generate work packages from the released scope and approved design evidence;
4. apply and release a project hold without destroying the prior phase, sequence package dependencies, enforce material/readiness checks and reject a conflicting crew booking;
5. source project material, reserve accepted stock, dispatch and partially receive it, retain rejected/missing quantity truth, and complete only the matching booking after verified work;
6. submit reviewed progress and inspection evidence, preserve the immutable baseline, release an accepted deduction as a credit and a later accepted addition as a variation;
7. keep handover blocked by an open snag, require a different reviewer to close the correction, accept the exact handover packet through the client OTP boundary, then open and process an in-scope warranty issue; and
8. verify the final finance receipt and close the project without rewriting quotation, receipt, change, stock, quality or acceptance history.

Negative and recovery coverage includes duplicate conversion and booking prevention, self-review denial, self-verification denial, hold enforcement, missing/excess stock, partial and rejected receipt, provider failure/recovery, expired-job replay, tenant isolation, client-portal isolation and idempotent retries.

## Provider and data boundary

- Accounting checks use temporary provider metadata and a controlled local HTTP double. No live accounting write or credential is used.
- Email, WhatsApp, push, Meta Lead Ads and PlyLeads delivery are not claimed by this acceptance run.
- All generated case, project, booking/history, resource, catalogue and provider-metadata records are removed by exact identifier in dependency order.
- The post-run database inventory returned zero synthetic cases, resources, accounting records and catalogue records.

## Verification

- `COMMERCIAL_TEST_API=http://127.0.0.1:8131/api/v1 node scripts/smoke-commercial-projects.mjs` from `services/business-core` with the local `.env` loaded — passed the complete CRM → pre-execution → finance → Projects → handover/aftercare path and its accounting-control sub-run.
- Focused Business Core regression suites — 21 files, 122 tests passed; `tsc -p tsconfig.json` passed.
- Focused web regressions — 11 files, 37 tests passed; internal tenant-operation route tests — 1 file, 6 tests passed.
- `npx next typegen && npm run typecheck` from `apps/web` — passed after consolidating the conflicting operation decision route under the canonical `[resource]` segment.
- `npm run test:e2e -- projects-navigation.spec.ts project-planning.spec.ts --workers=1` from `apps/web` — 8/8 passed across desktop and Pixel 7 projects. This covers the project table, module switcher, all principal project sections, schedule/milestones, task state, teams/bookings, work calendars, light/dark switching, empty states and horizontal-overflow checks.
- Focused native project/offline suites — 3 files, 11 tests passed; native typecheck passed. Earlier P08.3–P08.5 evidence retains native receipt, report, snag, handover and encrypted offline/reconnect coverage.

## Defects closed during acceptance

- A frozen CRM qualification whose valid form value is `null` no longer falls through to mutable live form state or dereferences `null`.
- Next.js no longer receives two different dynamic parameter names at the same tenant-operation route level; the decision route now uses the existing `[resource]` segment.
- The obsolete browser test for the retired work-plan table was replaced with the current backend-guided schedule, task, resource and calendar flow.

## Remaining release gates

This closes local engineering task P08.6. It does **not** close signed/physical iOS and Android acceptance, real-provider receipts, regional tax/retention validation, Palm clone migration, two-person Palm UAT or release authorization. Those remain P09/P10 gates and must not be represented as deployed or client-ready evidence.
