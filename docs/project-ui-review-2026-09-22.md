# Project UI review — 22 September 2026

Local-only correction pass prompted by screenshots of the portfolio, capacity, factory batches, dispatch, daily reports and task details.

## Updated

- Compact accessible action menus replace full project/team names in narrow action cells (portfolio, work orders and capacity). Existing action handlers remain intact.
- Specialist project tables, including dispatch and daily-report entries, use a closed single-line grid. Removed double-border overrides from factory DataGrids.
- Task dialogs retain a fixed viewport-bounded height across empty/populated tabs, with internal scrolling. Board and detail-tab scrollbars are hidden without disabling overflow.
- Batch metadata uses labelled fields. Allocation columns are split into Progress & QC, Delivery and Planning; every original field remains available.
- Positive pending task counts use pale red chips. Zero/completed counts stay neutral. Notification badges use solid red with white text as explicitly requested.

## Verified

- Web TypeScript check passes.
- 23 focused tests across portfolio, work orders, capacity, batches, global board and notifications pass.
- 23 tests across factory batches and project workspace pass (the batch suite overlaps the preceding run).
- Local browser: dispatch grid, empty task tab, batch metadata and delivery subview inspected.
- Narrow viewport 390 × 844: batch dialog has zero document overflow; table retains auto overflow and keyboard scrolling while scrollbar-width is none. Viewport reset afterwards.

## Closure boundary

This is a UI correction pass, not project-module acceptance. Full end-to-end delivery acceptance and the remaining implementation gaps in the delivery blueprint/handoff are still outstanding. Earlier broader CRM tests also have unresolved stale UI expectations and a font mock failure. Do not claim full module completion based on these focused tests.

## Latest user-directed simplification

- Overview now contains client name, owner and target only, with existing authorized edit/lifecycle controls. Removed readiness dashboard, release summary, notes and CRM answer panels as requested. Approvals remains its own tab.
- White task/production board surfaces and workspace tab bars; coloured calendar event cards preserved. Removed the point-event override that had replaced calendar colours with a neutral bordered style.
- Requirements, measurements, site records and designs remain editable across lifecycle states for members with existing edit permissions. File review permissions and revision guards remain enforced. Released commercial snapshots are not rewritten by these working-record edits.
- Agreements now show signed terms as compact read-only values. Added authenticated PDF/photo upload and download directly under Signed documents. A separate audited attachment command validates workspace, project and agreement identity, retains executed terms, deduplicates files and enforces a 20-file limit. Failed linking retains a retry action.
- Fixed shared upload hit area: the absolute file input previously escaped its unpositioned label outside the original form, intercepting Payment schedule clicks. The upload label now owns its positioned hit area.
- Local browser verified upload and reload persistence using agreement-upload-test-only.png, and verified Payment schedule displays its two milestone rows. Released-project Add measurement and Edit measurements are enabled.
- Backend pre-project/commercial suites: 293 tests across 39 files pass. Backend build passes. Frontend shared/planning suites: 49 tests passed before the final overview simplification; its revised four tests pass. Web typecheck passed before the final header-only change; final check recorded in task response.
- Local API now runs PID 44922; preview-api.pid is authoritative. No deployment or external messages.

Remaining module acceptance is unchanged: shared factory capacity/cost allocation, procurement/finance correction depth, aftercare/portal and complete 30-section/four-scenario acceptance are not closed by this UI work.

## Follow-up fixes and task consistency

- Fixed controlled enquiry/customer selection retaining the key but clearing its display text; native required validation had prevented follow-up submission. Verified a synthetic local follow-up saves and appears on the next-day timeline. Timeline regression now asserts selected text and the current segmented time input.
- Rebuilt the isolated local API; preview PID is stored in preview-api.pid (41345 at this update). Global task work-queue endpoint now serves the existing local data with project/member filters. No deployment.
- Global task page has page gutters and two aligned toolbar rows, resilient to React Aria template elements.
- Teams view split into Teams, Bookings and Needs booking. Booking uses the existing server-validated command; completed/cancelled tasks are excluded. The task details no longer offer Confirm booking for completed/cancelled tasks.
- Shared project StateBadge now uses moderately tinted dusty blue, lavender, amber, sage and terracotta. Applied to global/project task cards, details, factory batches and lot QC.
- Validation: follow-ups/global board 25 tests pass; teams/workspace/batches/global board 27 tests pass; web typecheck and focused lint pass. These overlap earlier tests and do not establish complete project-module acceptance.
