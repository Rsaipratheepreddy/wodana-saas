# Local readiness — 22 September 2026

Scope: Catalog and Projects, client web portal, basic HRMS and account settings. Mobile was explicitly cancelled. Work remains local; no deployment, external messages or changes to real employees/security settings.

## Verified in this continuation

- Full backend suite: 181 files passed, one skipped; 1,126 tests passed, ten skipped. Transactional-email tests use mocks.
- Project/commercial/HRMS/settings web group: 271/272 passed on the broad concurrent run; one quotation-workbench test exceeded its five-second timeout. Its entire 14-test suite passed when rerun with one worker. This is recorded as a timeout/rerun, not a clean first run.
- Catalog requirements enter a negotiated quotation and frozen released BOQ in the isolated funnel. Later catalog edits do not rewrite released specification links. This does not certify every catalog recipe/rate-card configuration.
- Persisted project story covers factory booking/output, independent QC/rework, dispatch and site receipt, installation, signed partial handover, supplier receiving/billing/payment guards, measured subcontract acceptance, purchased material consumption and warranty correction. Quantities, historical packets and tenant boundaries are checked.
- Client portal: five main destinations; Designs under Approvals; Alerts under Progress; real shared image previews; compact white surfaces with semantic chips. Desktop and Pixel 7 browser checks passed, including no page overflow and no POST during inspection.
- Client public quantities derive from approved published reports. Unpublished corrections preserve the previous report and its selected attachments. Unauthorized, unselected or superseded file requests are denied. This is a targeted boundary correction, not universal publication approval.
- Basic HRMS: leave half-day date-state fix, truthful load failures/retry, white tables/chips. Desktop/mobile leave checks and isolated attendance/leave/correction/allowance/independent-approval/RLS/evidence tests passed.
- Account settings: visible cancellation errors, clipboard fallback, session-display synchronization after MFA disable, white surfaces. Isolated MFA/session/audit API checks passed with synthetic accounts only.
- Company page inspected in the running browser: white canvas, section surfaces and navigation; pale semantic chips preserved.

## Acceptance evidence

- Project source-to-delivery: `qa-projects/delivery-2026-09-22T08-18-28.593Z/` — final rerun passed on the integrated backend build.
- Account security: `qa-projects/account-2026-09-22T08-11-20.175Z/security.json`.
- HRMS: `qa-hrms/hrms-2026-09-22T08-15-19.191Z/hrms.txt`.
- Portal UI screenshots: `qa-client-portal/2026-09-22/`.

## Still open — do not call the whole product complete

1. Projects: shared factory partial-allocation ledger, shared-run capacity and lot/time/cost attribution. Existing whole-task batches and tested lots are not equivalent to these capabilities.
2. Full 30-section/46-edge-case closure: finance reversal/amendment depth, installed asset/service visits, all four exact blueprint scenarios and advanced board capabilities are not completely certified.
3. Client portal: central cross-module draft/review/publish/withdraw workflow and server-enforced per-project section visibility are not implemented. Phase/stage and some metadata/commitment alerts remain live; not every client-visible change passes a universal internal queue.
4. HRMS: old project/site transfer smoke fixture is incompatible with the current commercial release gate and was explicitly skipped. Actual camera/GPS and all device/RTL/accessibility combinations are not newly certified. Payroll is outside the existing basic HRMS scope.
5. Account settings: existing security/company flows are tested; this does not add every personal profile/password-management feature or constitute a production security audit.

## Local runtime

Preview: http://127.0.0.1:3000 . Isolated synthetic API on 8168. The development Turbopack process crashed; the preview was restarted with Webpack and the Company page successfully loaded. Backend rebuilt and copied to the isolated preview. No production readiness or deployment approval is implied.

Final web TypeScript check passed with incremental output disabled. A repository-wide diff whitespace check reports two existing trailing-space lines in quotation-room-tree.tsx and lead-workbench.tsx outside this final pass; no claim of a clean whole-repository lint run.

Navigation verification: all ten workspace-shell tests pass after replacing five obsolete sidebar/tab expectations with the current unified Projects/Resources navigation. Pointer and keyboard collapse, authorized product visibility and planning routes remain covered; no cases skipped. Company/settings/security white-surface component group: 19 tests passed; targeted ESLint passed.
