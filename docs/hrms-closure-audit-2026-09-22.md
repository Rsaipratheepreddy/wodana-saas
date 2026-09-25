# HRMS web closure audit — 22 September 2026

## Scope and existing journey

The September 7 analysis is a historical proposal, not the current implementation status. Current web routes implement employee attendance, leave, time summary, site attendance, team review, people, workplaces/assignments, calendars/policy and leave allowances. `docs/hrms-implementation.md` records the earlier delivery and tests. Payroll and salary processing are outside that approved basic HRMS scope.

Employee flow: configure calendar and employee → capture check-in evidence → change work context or check out → inspect generated time summary → request correction/exception where needed → independent review. Leave flow: select active leave type/date range/day portion/reason → reserve allowance on pending request → scoped approval/rejection → withdrawal or reviewed cancellation. Project assignment/site identity is shared with Projects; attendance is not a production-output count.

## Changes in this audit

- Fixed leave form state: changing the first day now resets day portion to full days. Previously selecting half-day and moving the first day earlier left an invisible `first_half`/`second_half` value that could submit an invalid multi-day request.
- Failed leave-history reads no longer claim zero requests or show successful empty states. Retry refreshes the same selected scope/year. Failed/loading balance requests do not show the setup-empty explanation.
- Fixed disabled blank options in the HRMS shared select adapter: the disabled-key mapping now matches its normalized option ID.
- HRMS tables retain a rounded outside frame, single cell dividers, white body rows and a single footer divider. Scrollbars are visually hidden while scroll regions retain keyboard focus and native scrolling.
- Cancellation awaiting approval uses the pending pale chip. Status text is semibold; shared HRMS empty states include an icon.
- Light-mode HRMS surfaces and leave-balance panels are white. Balance rings use semantic blue/rose/amber tones instead of large tinted blocks; dark theme remains token based.

No employee data, API contracts, attendance capture persistence, review permission gates or backend services were changed. No mobile edits were made; the mobile redesign was cancelled by the user before implementation.

## Critical cross-cutting finding

The audit found global `Permissions-Policy: camera=(), geolocation=()` while `my-attendance.tsx` uses `getUserMedia` and `geolocation.getCurrentPosition`. The coordinating agent fixed authenticated workspace documents to allow self camera/location while keeping microphone and public-page defaults denied. Workspace document scope is necessary because client navigation from another staff screen retains the original document policy. Verified actual isolated `/workspace/hrms/leave` response: `camera=(self), microphone=(), geolocation=(self), browsing-topics=()`. No camera was activated or permission prompt bypassed by this audit.

## Verification and limits

- 7 focused web tests passed: new leave form/error regressions, HRMS entry page and API route allowlist.
- Web TypeScript passed.
- Targeted lint passed after removing a test-only unused variable.
- Installed the matching missing Playwright headless browser. Both desktop and mobile leave-form browser fixture checks passed using an isolated Next process/build directory and mocked HRMS records. Reviewed the resulting screenshots. The user's local preview/session and employee records were untouched.

The UI checks alone do not certify persisted HRMS behavior; the additional HTTP/database checks below provide that evidence for the listed scenarios. Real camera/GPS behavior and photo retention still require operational acceptance. No production readiness claim is made by this UI fix.

## Additional persisted acceptance

11 focused backend HRMS domain/access tests passed. Then a temporary wrapper used the existing disposable delivery-cluster pattern to run HRMS HTTP/database acceptance against a new PostgreSQL cluster, all current migrations and the existing built API. No source build or shared database was touched. The final run connected the API as non-superuser `wodana_app`; administrative fixture setup used the private cluster owner. API and database stopped after the run.

Evidence: `docs/qa-hrms/hrms-2026-09-22T08-15-19.191Z/` contains the runner, API log, schema RLS verification, scenario output and stopped-environment record.

Passed persisted scenarios:

- Employee self-service and scoped manager access; viewer denied; staff denied people administration.
- Private photo upload/access isolation.
- Simultaneous identical attendance requests produce one event; changed retry payload and second open check-in reject.
- Two daily sessions total 420 minutes; correction changes this to 360; CSV matches; overlapping correction rejects.
- Employee cannot approve their own correction; manager cannot query an unrelated employee.
- Complementary half-day leave, overlapping leave rejection, pending allowance reservation, independent approval, withdrawal, reviewed cancellation and restored balance.
- Configured holiday rejection and cross-year allowance allocation.
- Cross-workspace denial, forced RLS isolation and immutable attendance evidence.

The unchanged legacy full HRMS smoke stopped at its project-release fixture: it inserted a won opportunity without the now-required commercial checklist, so release correctly returned 409 instead of its old expected 201. The final run explicitly omitted that obsolete release/site-transition block; it did **not** bypass the release gate or count that scenario as passed. The remaining test fixture needs a real accepted quotation/agreement/payment release setup before its project assignment transfer, site/field transition, outside-site checkout and delayed-capture segment can be recertified.

This substantially verifies basic attendance/leave persistence. Remaining functional acceptance is the updated project/site integration fixture and real browser/device evidence capture. Payroll, accrual/encashment engines, legacy HR import and chained offline event recording remain outside the basic HRMS scope, not unfinished promises of this slice.
