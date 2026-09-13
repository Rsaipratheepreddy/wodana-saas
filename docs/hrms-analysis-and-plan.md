# Basic HRMS: analysis and implementation proposal

Implementation notes and current verification: [HRMS implementation](hrms-implementation.md). This document preserves the original analysis and proposal.

Prepared 7 September 2026. Status: **awaiting user approval; implementation has not started**.

Build a small employee attendance and leave module for an interior design business. Its purpose is to answer who is working, where they checked in, which project they are working on, and who is on leave. Payroll, salary calculation, payslips, tax, billing, and complex HR administration are outside this proposal.

## 1. Source review and proposed destination

I reviewed the current files, the older backend baseline in Git (`cd03b37`, with `5fe7a6c` as the earlier HR baseline), the older Wodana web attendance page and Flutter site check-in consumer, and the newer Wodana application.

There are two product generations in this workspace:

| Generation | What exists | Implication |
| --- | --- | --- |
| Older FastAPI backend and adjacent `Wodana-Frontend` | Employee profiles, leave, payroll, attendance events/sessions, manual timesheets, labour records, and a separate site check-in system | Useful as a reference and possible historical data source; it contains conflicting attendance paths. |
| New `wodana-saas` | Next.js web, Expo mobile, NestJS Business Core, workspace identity/permissions, CRM and pre-project capabilities | The HRMS web page is explicitly a placeholder. Business Core does not mount an HRMS module. Mobile has module entry screens. |

**Proposed implementation target:** `wodana-saas/services/business-core`, `wodana-saas/apps/web`, and `wodana-saas/apps/mobile`. This is a planning assumption supported by the newer README and the 7 September mobile module review. The older root `docs/CANONICAL_REPOSITORIES.md` describes the previous FastAPI/Flutter architecture. Approval of this proposal includes the newer destination; reconcile that documentation during implementation.

There are substantial existing uncommitted changes, including recent leave improvements. They were treated as existing user work. This review changes only this planning document.

## 2. What is wrong in the older implementation

Findings below distinguish source inspection from isolated reproduction. They are not claims about the exact version deployed to production.

| Finding | Evidence | User-visible consequence |
| --- | --- | --- |
| Site check-in and HR attendance are separate stores | `backend/app/services/checkin_service.py` writes `check_ins`; Flutter's `site_check_in_repository.dart` calls `/check-ins/*`. The HR page reads `/labor/attendance/events` and `/labor/attendance/sessions`. No bridge is present in these write paths. | A successful site visit need not appear in the HR timesheet. |
| Later sessions on the same day are dropped | `_recalculate_attendance_session` in `backend/app/services/labor_service.py:446` slices events from the first check-in through the first checkout. The same logic is in the committed baseline. | A second visit or a return after lunch disappears from the daily total. |
| Corrections can fail to correct time | `apply_regularization_approval_outcome` appends a new ordinary event; the session reducer does not exclude the original event using the correction reference. | Changing a 09:00 arrival to 10:00 can leave the original eight-hour total unchanged. |
| The old Timesheets tab is an attendance grid with incomplete aggregation | `../Wodana-Frontend/web/app/dashboard/people-attendance/people-attendance-workspace.tsx:245` reads sessions/events; around line 392 it uses `sessions.find(...)` for each employee/day. It does not use the manual `/labor/timesheets` records. | Multiple project sessions collapse into one cell, and two different meanings of “timesheet” coexist. |
| Staff self-service permissions are incomplete | `/labor/attendance/events` accepts designer/sales/procurement attendance, but GET events/sessions is restricted to management/accounting roles. The page also loads `/hr/employees` and leave balances, both restricted. | Staff may be able to record attendance but cannot load the data needed for their own history or leave form. |
| Project-site evidence is not required consistently | `AttendanceEventCreate` allows `PROJECT_SITE` without a project, coordinates, geofence, or selfie. Geofence validation runs only when a caller supplies a geofence ID. | A project-site label does not establish a location check or photo evidence. |
| The dedicated site flow cannot capture images | `CheckInRequest`, `CheckOutRequest`, and the `CheckIn` model have coordinates but no photo asset field. | It does not satisfy the requested image check-in/check-out workflow. |
| Site rules conflict | Dedicated site check-in uses project coordinates and a 50–100 m boundary; workforce attendance uses separate `site_geofences` and a different allowed radius range. Dedicated checkout rejects users already outside the site. | Sites can behave differently depending on the entry point; leaving before checkout can trap an open record. |
| Leave assumes a five-day working week | `_weekdays` in `hr_service.py:255` excludes every Saturday/Sunday. Leave overlap is checked by date, and balances are charged to the starting year. | A six-day studio calendar, complementary half-days, holidays, and year-crossing leave need explicit handling. |
| HR is larger than this business need | Profiles include financial details; salary, payroll periods/runs/lines, overtime and multi-stage timesheet approvals are implemented. | Employee attendance inherits forms and workflows that are unnecessary for this request. |

The old attendance grid also treats a missing record as absence using browser-local dates. Its Today overview reuses the selected week's data. The replacement should query Today independently, use the work calendar, distinguish “Not checked in yet,” and show request failures rather than silently treating missing data as an empty attendance list.

### Verification performed

The existing attendance schema, timesheet schema, and leave schema tests pass: **10 tests passed**. They cover payload validation, route registration and a basic overnight calculation; their success does not establish an end-to-end HR workflow.

Two isolated executions of the actual session reducer used in-memory query results, without a database connection:

| Scenario | Expected | Current result |
| --- | --- | --- |
| Check in 09:00, out 12:00, in 13:00, out 17:00 | 420 minutes; last checkout 17:00 | 180 minutes; last checkout 12:00 |
| Original check-in 09:00, correction to 10:00, checkout 17:00 | 420 minutes | 480 minutes |

No application code, migrations, production data, or deployed services were changed. Live mobile camera/GPS behavior was not tested during this planning review.

## 3. How HRMS should fit an interior design business

Employees move among a studio, client sites, suppliers, and several projects during one day. Designers also work on projects while physically in the office. Sales and site survey visits may happen before a delivery project exists.

Model three related facts separately:

1. **Attendance:** Is this employee checked in for work, and for how long?
2. **Work context:** Is the time general work, a pre-project case, or an assigned project?
3. **Location evidence:** Office, project site, field/travel, or permitted remote work; what photo and location were captured?

Selecting a project while drawing in the studio must not label someone as physically at that site. A project-site visit is part of attendance, so its duration must not be added a second time to the employee's total.

This proposal adapts established patterns to Wodana rather than adopting a full HR suite. Zoho documents photo/GPS attendance and correction requests; Connecteam documents job-linked geofences, switching jobs, and review of outside-boundary checkout; Jibble documents personal/team daily, weekly and monthly time views. These references support the workflow patterns, not a claim that Wodana already implements them. [Zoho mobile guide](https://help.zoho.com/portal/en/kb/people/mobile/mobile-app-guide/articles/zoho-people-mobile-application-help-guide), [Connecteam geofence guide](https://help.connecteam.com/en/articles/3597710-how-to-create-a-geofence), [Jibble timesheet guide](https://www.jibble.io/help/how-do-timesheets-work).

### Employee examples

| Situation | Employee action | Recorded result |
| --- | --- | --- |
| Accountant starts at the studio | Check in → Office → photo | Attendance without requiring a project. |
| Designer draws for Project A at the studio | Office, optionally select Project A | Office attendance and project time; no site-presence claim. |
| Supervisor starts directly at Project A | Check in → Project site → assigned project/site → photo and GPS | Attendance starts and a site segment opens in one transaction. |
| Supervisor leaves A for B | Change work location → Field/travel; on arrival change to Site B | Separate A, travel, and B segments within the working session. |
| Salesperson visits a prospective client | Field/client visit; optionally link a lead or pre-project context where authorized | Attendance can precede project conversion. Initial structured site linking uses an existing pre-project case. |
| Employee takes half-day leave | Leave → date → first/second half → reason | Approval and the remaining working half coexist in the day view. |

Lead-only visits can use Field with a note in the initial release. A typed lead link can follow if needed; do not require fake projects to record these visits.

## 4. Proposed first-release scope

### A. My Attendance

One main action: **Check in** or **Check out**. While checked in, offer **Change work location/project**. Show today's elapsed time, current context, verification status and a readable event timeline.

At check-in/check-out, capture a fresh camera photo, timestamp and current location. Project-site selection requires an authorized project or pre-project site. Office/general work does not require a project. Remote work is available only when enabled for the employee. Photo evidence is a captured image, without face recognition or biometric matching.

Site arrival/departure also captures evidence. A single transition can close one segment and open the next using the same timestamp; it must not create overlapping time. If the employee changes to Site B only after leaving Site A, B's coordinates cannot retrospectively verify departure from A. Flag the missing/late departure for review.

Allow multiple completed working sessions per day. Permit only one open session and one open work segment for a member at a time. End all active work segments when checking out. Repeated taps and network retries return the same action result.

### B. Site location and verification

Administrators configure the office and each site's map pin and radius; users see the selected site, their location, and the check result. Provide coordinate entry/current-location capture as well as a map so setup does not depend on address search.

Use one site definition across HRMS and Projects. Start with a proposed 150 m radius, adjustable during site setup; calibrate actual sites during the pilot. Capture GPS accuracy and capture age. The server computes distance and verification using stored site settings, rather than accepting a client-provided “inside” flag. Keep the site-coordinate/radius version with the evidence so later edits do not rewrite history.

Use **Inside boundary**, **Outside boundary**, and **Location uncertain**. An inaccurate or stale fix cannot be labelled verified just because its central point lies inside the circle. Initial accuracy/freshness thresholds are configuration decisions to validate on real devices.

Outside/missing location, denied camera access, or an unconfigured site offers retry or a reasoned exception request. An exception remains visibly pending; approval accepts the explained attendance without inventing GPS/photo evidence. Checkout must offer this recovery path after someone has left the site.

Location capture happens when the employee acts. This scope has no continuous GPS tracking or automatic arrival/departure. The team view must say “Checked in at” with a timestamp, not claim live location or continuous presence.

### C. Automatic time summary

Replace manual weekly timesheet entry with a read-only daily/weekly/monthly summary generated from attendance sessions and their work segments. Label the main screen **Attendance** and its report **Time summary**.

Show employee, date, first arrival, last departure, recorded working duration, project/site breakdown, leave and unresolved exceptions. General work is a valid category. Project time and site time are breakdowns of the same duration. Time remains recorded attendance, not billable hours or a productivity score.

If a break must be excluded, the employee checks out and checks in again; dedicated break controls can be added later if requested. An unfinished session is shown as open, not finalized as eight hours. Stale open sessions require correction; do not silently fabricate a checkout.

Ordinary complete attendance needs no weekly approval. Review only corrections and exceptions. Include CSV export using the same filters and calculations as the UI.

### D. Leave

Employees submit leave for themselves, see their own balances and history, and withdraw pending requests. Managers approve/reject their actual reports; an HR administrator handles the configured fallback. Rejections require a reason. Approved leave cancellation is reviewed and reverses its balance effect once.

Support configurable leave names, annual allowances, full day and first/second half. Use a configured working week and holiday calendar. Reserve pending allowance, debit once on approval, and release on rejection/withdrawal. Split year-crossing requests by leave year and check overlap by day-part. Approved half-day leave must not hide attendance in the other half.

Start with manually configured annual allowances and opening balances. Accrual engines, encashment, carry-forward automation and payroll treatment are outside the first release. Attendance during approved leave raises a conflict for review rather than silently deleting either record.

### E. People and administration

Use existing workspace members and login identities. Enable attendance for eligible internal members and record only employee code (optional), designation/team, reporting manager, office/work calendar, and active dates. No new employee password/account flow or required financial fields.

Staff with client/vendor portal identities and subcontractor labour muster are outside this employee HRMS. Existing labour records remain a separate project operations concern.

## 5. Screens and access

| Screen | Employee | Reporting manager / project manager | HR administrator / owner |
| --- | --- | --- | --- |
| My Attendance | Own check-in/out, timeline, corrections, time summary | Own self-service too | Own self-service too |
| Leave | Own requests and balances | Approve assigned reports; scoped team availability | Configure types/calendar; handle authorized requests |
| Team Attendance | No unrestricted team evidence | Reports' attendance; project managers see assigned project visit facts | Organization attendance and exceptions |
| People | Minimal permitted directory information | Team context | Enable members and configure reporting relationships |
| Settings | None | Site management only when granted | Offices/sites, calendars, attendance policy |

Manager authority comes from explicit permissions plus reporting/project scope, not merely a broad role name. A project manager's access to site attendance does not expose an employee's unrelated leave reasons or personal photos. Private evidence needs an explicit authorized read; a minimal directory does not grant it. Prevent self-approval and configure an independent fallback approver.

Mobile uses the existing HRMS Home entry. Its first screen prioritizes the attendance action, today's status, Leave and History. Web uses the existing workspace shell: employee self-service first for staff; Team Attendance and a review queue for authorized managers. No new module or separate sign-in is required.

## 6. Implementation design and dependencies

Business Core owns all writes and calculations. Web and mobile use the same typed contracts, workspace membership, authorization, audit records, and transactional operations.

Suggested records (final names can follow repository conventions):

| Record | Responsibility |
| --- | --- |
| Employee settings | Attendance eligibility, manager, work calendar and active dates linked to membership |
| Workplace/site | Office or site coordinates, radius and version; scoped link to a pre-project/project |
| Attendance session | One working interval; open/completed state |
| Work segment | Non-overlapping office/site/field/remote interval within a session, optional work context |
| Attendance event and private media asset | Original captured action, actor, server/device times, photo reference and location evidence |
| Attendance review | Requested correction/exception, decision, reason and revision relationship |
| Leave type, allowance and request | Simple calendar-aware leave accounting with audited decisions |

Daily summaries should be derived from these records, not editable parallel timesheets. Corrections preserve original evidence and explicitly supersede its effect in the calculated view. Preserve a before/after audit trail. Lock/version transitions, enforce uniqueness for open attendance, reject invalid event ordering, and make concurrent requests and retries safe at the database level.

Store timestamps in UTC and use the configured work-calendar timezone for day/week grouping. Define overnight reporting consistently: split report durations at local midnight while keeping the original session and evidence intact. Work calendar changes must not silently recalculate historical attendance/leave under different rules.

**Required project dependency:** The new Projects list currently renders `DEMO_PROJECT` and says real projects will appear when execution release is connected. HRMS must not save demo IDs or introduce a duplicate project list. First establish a minimal persistent project identity, authorized assignments, and site relationship in the project domain, linked to pre-project release. Existing pre-project cases can anchor survey sites before release. This is a small necessary shared foundation, not approval to build the full execution module.

The existing storage service provides useful mechanics, but attendance needs its own private asset ownership and retrieval checks. Validate image content/size, finalize uploads before treating evidence as complete, and use protected downloads. Define configurable media retention before production rollout.

The first release is online-first with retry-safe capture: preserve an interrupted pending action/photo and clearly show **Pending sync** until the server accepts it. Reconcile server state before issuing a conflicting next action. Missing connectivity must not display a false successful check-in. Delayed capture that cannot meet the normal verification policy goes to review. Full offline chains across multiple sites and devices are deferred.

Notifications initially mean visible in-app pending requests and decisions backed by HRMS records. Reuse shared event/outbox infrastructure, but do not assume the CRM-specific notification inbox already supports HRMS. Device push and email reminders can follow separately.

## 7. Build order after approval

| Step | Deliverable | Completion check |
| --- | --- | --- |
| 1. Foundation and contracts | Confirm destination documentation; employee eligibility/manager permissions; calendars; private media; minimal persistent project/site/assignment integration | Real authorized members and real sites can be selected without demo IDs or a payroll dependency. |
| 2. Attendance capture | One session/segment engine, camera/GPS check-in/out, changing work context, retry and exception paths; working web/mobile controls | Office → travel → site → checkout is recorded once, with photos and consistent totals on both clients. |
| 3. Leave and corrections | Self-service leave, actual-manager review, cancellation, balances, missing-punch correction and exception decisions | Full-day/half-day leave and approved corrections update totals exactly once while preserving evidence. |
| 4. Team views and reports | Scoped Today view, history, weekly/monthly summary, evidence drawer, review queue and CSV | All sessions/sites appear; the same filters produce matching UI and export totals. |
| 5. Pilot and historical cutover | Device checks, role/tenant tests, historical-data assessment, reconciliation and release | A small staff pilot passes the cases below before organization rollout. |

Each step includes relevant automated checks. Mobile attendance is part of the proposed delivery, not just a web mockup. Detailed estimates should follow confirmation of the project foundation and historical-data needs.

### Acceptance cases

1. Designers, sales, supervisors and accounts users can record and read their own attendance; customers/vendors cannot access employee HR records.
2. Office check-in works without selecting a project. Project work in the office never appears as a verified site visit.
3. One day with 09–12 and 13–17 sessions totals seven hours. Two sites and travel appear as separate segments without overlapping time.
4. Both checkout and check-in have photo/location evidence or an explicit reviewable exception; gallery URLs and client-supplied verification flags are not accepted as proof.
5. Wrong site, poor GPS, missing permission, left-site checkout, upload failure, app restart, timeout/retry and duplicate taps have recoverable states.
6. Two devices cannot open overlapping sessions or apply one action twice. Cross-tenant/user/project/photo access is denied on the server.
7. A correction from 09:00 to 10:00 with 17:00 checkout produces seven hours, retaining both the original evidence and the approved correction.
8. Holidays, Saturday working, half-day attendance/leave, cancellations, year boundaries, overnight work and timezone changes follow the configured calendar.
9. The Today view does not change when an unrelated history filter changes. API errors are shown as failures, not fabricated absence.
10. Weekly/monthly totals match CSV; pending/unverified/open records are identified consistently. Historical imports cannot silently double-count site visits already represented in attendance.

## 8. Historical data and scope boundary

Reuse verified concepts: workspace identities, tenant isolation, assigned project access, distance calculations, immutable evidence and audited corrections. Reimplement the broken session reducer and connect site attendance to the same source of truth.

Before any migration, inventory actual legacy data and map legacy user/project IDs to new memberships/projects. Retain source identifiers and import provenance. Compare `check_ins`, attendance events/sessions and manual timesheets for overlaps; never sum them blindly or invent missing photos. Reconcile historical totals in a dry run. Keep legacy history available until mappings and differences are reviewed; do not delete the old tables as part of this module build.

Out of scope: payroll and salaries, payslips, financial/tax details, overtime pay, billing rates, recruiting, performance reviews, complex rostering, biometric/face recognition, continuous GPS tracking, subcontractor wages, and a full offline synchronization engine.

**Approval requested:** the basic scope above, implemented in the newer Wodana web/mobile and Business Core, including its minimal shared project/site dependency. The proposed result is attendance with images and location, optional project context, simple leave and automatic time summaries.
