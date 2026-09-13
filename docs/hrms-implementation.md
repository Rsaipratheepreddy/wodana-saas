# Basic HRMS implementation

Implemented in this order: Business Core backend, Next.js web, Expo mobile. This is the lightweight employee module described in `hrms-analysis-and-plan.md`; it does not introduce payroll or replace subcontractor labour muster.

## First-time setup

1. Open **HRMS → Calendar & policy**. Create a work calendar with the correct timezone, weekdays, holidays, and half-day boundary. Save the default calendar and attendance policy.
2. In **People**, enable existing workspace members, select their work calendar, reporting manager, and optional remote-work eligibility.
3. Give reviewers `hrms.team` in workspace roles; grant `hrms.evidence` only to reviewers who need attendance photos. Owners and administrators receive HRMS management permissions. A person cannot approve their own request.
4. In **Workplaces & assignments**, add office coordinates or a site tied to a real pre-project/delivery project, then assign employees. Check coordinates and radius at the real workplace. General office work can have no project; physical site attendance is recorded separately.
5. In **Leave allowances**, create the organisation's leave types and annual allowances. Individual allowances can be adjusted without changing historical requests.

The web sidebar has direct, refreshable routes for My attendance, Leave, Time summary, Site attendance, Team attendance, People, Workplaces & assignments, Calendar & policy, and Leave allowances. Management navigation follows the backend permission response. HRMS shares the CRM/Catalog workspace color theme, lilac/rose/peach primary actions, design-system dropdowns, buttons and modal dialogs. Compact tables and forms follow the portal geometry. The calendar screen includes a setup guide linking to employee profiles and sites, and leave rings use SVG so they remain circular under the app's square-geometry rule. Theme and direction changes carry through to open dialogs.

## Attendance and leave behavior

- Check-in, checkout, and work-location changes record immutable server-timed events, fresh camera photos, and action-only GPS. Location accuracy, age, distance, device time, and the site configuration snapshot remain available as evidence. There is no continuous location tracking or face recognition.
- One open session per employee; multiple sessions and work segments contribute to the same daily total. Reports split at employee-calendar midnight. A stale open session is flagged instead of accruing unlimited hours or fabricating a checkout.
- Missing/uncertain/outside-site evidence requires an exception reason. Checkout can still be submitted for review. Client retries keep the original action/capture IDs. Web stores pending captures in IndexedDB; native mobile copies photos into app storage and persists the pending record before uploading. A new web capture cannot overwrite another tab's pending capture. Rejected captures retain their evidence: a known validation rejection can be retried with a review reason, or explicitly discarded; uncertain network failures retain the original payload.
- Time corrections and missed-checkout requests require an independent scoped reviewer. Projections update after approval; original events and photos are preserved. Overlapping or inverted sessions are rejected.
- Daily summaries and CSV use the same server calculation. Project leads can view project site-visit facts without receiving employees' leave or photo records.
- Leave supports full/half days, calendar holidays, cross-year allowances, overlapping-request checks, reserved pending balance, withdrawal, and approved-leave cancellation with review. Approval does not silently overwrite attendance.
- Native HRMS includes camera/GPS capture, retry, history/correction requests, leave/balances, and manager approvals. Configure calendars, employees, sites and allowances on the web. The mobile screens use the home app’s lilac canvas, plum navigation, shared brand-gradient buttons, rounded cards, swipeable balance rings, status badges, and native date pickers. Colors are scoped to HRMS, preserving the existing welcome and sign-in screens. Form sheets avoid the keyboard and keep native touch targets. HRMS tabs have minimum label widths and horizontal overflow on small screens. The main mobile navigation places the selected gradient inside the active tab so interrupted width animations cannot leave a stale or clipped highlight. Empty successful API bodies (including no active attendance) are decoded as null, so a new employee can check in without a false network error.
- Mobile Home replaces the slogan and module search with live updates above the module grid. Its two highest-priority items link directly to attendance, personal leave, or the relevant approval queue. Reads use HRMS permissions, approval counts exclude self and non-actionable requests, and failed sources never produce misleading zero totals. Refresh runs on Home return, foregrounding, and manual refresh.

## Data and API

Migration: `services/business-core/drizzle/0030_hrms_attendance_leave.sql` (registered in the migration journal). It adds project/site identity, employee calendars, immutable attendance evidence, sessions/segments, review requests and leave records. New tables enforce workspace RLS and tenant-safe foreign keys. Database constraints also prevent overlapping employee sessions.

Authenticated endpoints live under `/api/v1/workspaces/:workspaceId/hrms`:

- `bootstrap`, `calendars`, `settings`, `people`
- `captures`, `captures/:id/photo`
- `attendance/current`, `attendance/actions`, `attendance/history`, `attendance/export`
- `reviews`, `reviews/:id/decision`
- `leave/types`, `leave/allowances`, `leave/balances`, `leave/requests`, and request `cancel` / `decision`

Shared project endpoints: `/api/v1/workspaces/:workspaceId/projects`, `from-pre-project`, `locations`, `assignments`, and `attendance`. Only won active pre-projects can release into delivery; site/assignment identity transfers while historical evidence keeps its original context.

The web BFF refreshes its existing authenticated session, checks mutation origin, allowlists paths and streams private media with no-store headers. Mobile uses the existing auth client with serialized token refresh and preserves multipart payloads when retrying. Its browser preview proxy supports only the needed workspace resources and never exposes refresh tokens to JavaScript.

Photos use the existing private brand-asset storage service with independent HRMS object keys. The configured photo access window currently blocks old-photo reads; it is **not an automated object-deletion policy**. Configure a private storage lifecycle/retention job before production retention requirements are agreed. Private local uploads and development signing secrets under `.data/` are excluded from Git. Pending device photos are removed after server confirmation. Clearing app/browser data also clears unconfirmed captures.

## Verification

From `wodana-saas`:

```sh
npm run build --workspace @wodana/business-core
npm run test --workspace @wodana/business-core
npm run typecheck --workspace @wodana/web
npm run build --workspace @wodana/web
npm run test --workspace @wodana/web -- app/workspace/hrms/page.test.tsx lib/hrms/routes.test.ts --maxWorkers=1
PLAYWRIGHT_BASE_URL=http://localhost:8130 npm run test:e2e --workspace @wodana/web -- hrms-navigation.spec.ts hrms-flows.spec.ts --workers=1
npm --prefix apps/mobile run typecheck
npm --prefix apps/mobile run test
```

`scripts/prepare-hrms-test-db.mjs` and `scripts/smoke-hrms.mjs` in Business Core use an isolated local `codex_hrms_test_20260907` PostgreSQL database. Run its API on port 8134 in development auth mode with the non-superuser `wodana_app` database role. The smoke check creates synthetic employees/workspaces and verifies real HTTP/database behavior, including role/tenant isolation, photos, simultaneous idempotent actions, 7-hour multi-session totals, corrections, project release/site transitions, project-lead scope, delayed-capture review, leave and cancellation. Never point this test fixture at a shared or production database.

Browser tests use explicit HRMS fixtures and the existing local demo login; they verify the UI contracts, camera-exception submission, persistent retry after reload, concurrent-tab protection, rejected-capture repair, direct sidebar routes, responsive layout, light/dark themes and RTL. Backend acceptance tests exercise the real persistence independently.

Expo SDK 55 native dependencies were installed with `expo install`; native config requests foreground camera/location access only. New native modules require rebuilding an existing development app. iOS/Android/web bundle export checks catch platform resolution failures; hardware photo quality, permission prompts, GPS accuracy and site radius still need a field-device pilot.

### Checks completed locally

- Business Core build and 140 unit tests passed; isolated database/HTTP acceptance checks passed with tenant RLS enforced.
- Web production build, TypeScript, focused lint and 12 HRMS/sidebar unit tests passed. Twelve browser cases passed across desktop/mobile, including light/dark brand colors, dropdown clearing, calendar creation and leave forms; two duplicate desktop-only cases are intentionally skipped on mobile. The shared-checkbox test was corrected to click its visible label and passed on both viewports.
- Mobile TypeScript, 26 transport/auth/design tests, iOS/Android/web bundle exports, and the native iOS Simulator debug build passed. The mobile theme revision was checked in the installed simulator with populated leave balances, half-day selection, native date pickers and attendance. Nullable attendance responses and private photo byte handling have regression coverage. Use Expo's default port 8081 for this prebuilt React Native debug runtime. The existing browser preview can continue on 8087. The installed iOS app was visually checked against the real local backend: attendance setup, leave, and approvals load successfully.

## Local sample data

`node services/business-core/scripts/seed-iglo-hrms.mjs` adds repeatable examples to the existing **local** Iglo workspace on port 8131 / database `wodana`. Build Business Core first; the script uses its calendar/date functions. It requires the existing local demo administrator login and rejects production mode.

The September 2026 sample contains two calendars, four employee profiles (the local administrator plus three fictional colleagues), three workplaces tied to the existing pre-projects where applicable, three leave types, twelve annual balances, twelve leave requests, nine closed attendance sessions, and four pending example reviews. Existing profiles/settings are preserved. Stable IDs prevent duplicates; rerunning was verified to keep the same counts. It does not promote pre-projects or change CRM stages.

Examples are labeled **Demo** in calendar/workplace/employee names, employee codes, request reasons and attendance notes. Attendance evidence explicitly says there was no real photo or GPS capture; no camera proof is fabricated, no live session is opened, and no invitations or credentials are created for fictional colleagues. The script records a local demo audit event. Calendar closures, allowances and sample coordinates are examples to configure before live use.

## Release boundaries

- No production deployment, payroll, push/email reminder rollout, or historical legacy HRMS import was performed.
- Legacy FastAPI/Flutter attendance stays intact. Import requires a separate inventory, tenant/user/project mappings, timezone policy and an audited dry run; the old check-in and HR attendance tables are not assumed equivalent.
- This release supports one durable pending capture with explicit retry, not a chain of offline attendance events.
- The full web test suite also contains unrelated pre-project navigation and catalog tests that currently fail. Focused HRMS checks and the backend suite are tracked separately; do not represent the whole repository as green.

The HRMS tab bar reserves its full button height plus vertical inset and does not shrink beside the page scroll view. This prevents the selected pill from being clipped, including on long leave/history screens. The main bottom navigation is hidden while HRMS is open; Back to Home restores it.
