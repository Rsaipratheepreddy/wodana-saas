# Client portal implementation — 22 September 2026

## Journey and layout

Client signs in using their granted contact identity, chooses an authorized project, reviews shared information and responds to a specific revision. Keep five main destinations: Home, Progress, Approvals, Payments and Inbox. Designs belongs under Approvals; schedule alerts belong under Progress. Existing Progress subtabs remain Overview, Work progress, Daily updates, Documents and Handover. Home contains actionable decisions and a small gallery of actual shared design images, not marketing photographs or invented project progress.

Use the current workspace typography, white surfaces, compact controls, semantic pale status chips and solid red/white actionable counts. Preserve exact-version approval, OTP confirmation, payment evidence, requests and warranty actions. Images must use the same authorized file endpoints as downloads. Unsupported document formats get a file action instead of a broken image.

## Existing server contracts

- Client data is supplied by client-portal.service.ts and execution.domain.ts; clients do not query unrestricted internal project data.
- Scope definitions, quotations, design versions, material approvals, payments, requests and handover decisions already have distinct contracts. Preserve these contracts and their permission checks.
- Approved daily reports require publishedAt and exclude superseded reports. Milestones use visibleToClient. These are existing record-level publication controls.
- Portal settings currently expose brand and enabled state, not project section visibility.
- Schedule alerts currently derive live from linked procurement, dispatches, published work and visible milestones. Overall progress currently derives from internal project totals. Neither represents a universal internal approval queue.

## Required internal publication module (next backend slice)

Add a project-level Client updates workspace with Draft, Awaiting review, Published and Withdrawn filters. An update references its source module, source record, immutable revision, project, author, reviewer, client title/summary, attachments, affected scope, due/forecast dates and publication timestamp. Never copy unrestricted internal notes, costs, supplier discussions or employee data into its client payload.

Transitions: draft → submitted → approved → published; submitted → changes requested; published → withdrawn or superseded. Review permissions are separate from authoring and client decision rights. Version-check every transition and retain an audit event. Editing a published source creates a new pending revision; it must not silently alter an accepted client decision.

Project visibility settings govern Progress, Designs, Approvals, Documents, Payments and Requests. Enforce visibility in the data serializer, direct file downloads and decision endpoints, not merely navigation. Default policy for existing clients requires explicit migration review; hiding a section does not silently cancel outstanding obligations. Staff preview must use the exact sanitized client payload.

Route daily progress, delay/recovery notices, material/design decisions, change requests, delivery milestones, handover and warranty responses through the relevant approval contract. Preserve an explicit policy for already-published commitments becoming overdue: show a factual overdue state while human-written recovery communication awaits approval. Do not automatically message clients.

## Acceptance and dependencies

Test project isolation, viewer versus approver, exact revision and OTP, stale updates, duplicate submissions, denied/withdrawn file access, hidden-section deep links, pending/superseded reports and no internal costs/notes. Verify desktop, narrow mobile, keyboard and RTL. UI regression tests alone are not release approval. HRMS and staff mobile remain separate modules; no client UI should expose staffing or payroll details.

## Bounded implementation in this pass

Group navigation, white surfaces, semantic status chips, actionable counters and genuine shared-design previews. Existing flows remain connected. Central publication and section controls above are planned, not claimed implemented.

Validation: all three client portal test files pass (13 tests), including exact design revision approvals, scope confirmation, quotation options, warranty requests, read-only viewers, project switching and a new five-tab/image-preview regression. Web TypeScript check passes. Targeted ESLint has no errors and retains two pre-existing refresh-effect dependency warnings. This pass has not completed browser/mobile/RTL visual acceptance or server publication/visibility implementation.

## Subsequent publication correctness and browser acceptance

Public quantities and overall/milestone progress now derive from approved, published reports. Private corrections no longer hide the client's existing report. Work statuses derive from published quantities and explicit QC evidence instead of raw internal task status; full published quantity alone cannot bypass required inspection or lot QC. Four dedicated serializer regressions pass; the related execution/alerts suite passed 40 tests before the fourth regression was added. Root also corrected report file authorization and alert supersession consistently. This does not constitute the universal publication queue described above: phase, stage, dates and task metadata still use current records.

Desktop Chrome and Pixel 7 browser checks passed twice after layout fixes, using a separate port 3100 Next instance and mocked client data. Checked all five main destinations fit the viewport, gallery image loads, approvals/design navigation, pale status chip, compact design row, schedule alerts and no document-level horizontal overflow. No POST requests were issued. Visual inspection found a clipped Inbox tab and oversized design row; tabs now wrap at narrow widths and the design table uses compact Open design / Review actions, with full decision actions retained in the review queue. The design component suite passes all 9 tests after this change.

Evidence screenshots: `docs/qa-client-portal/2026-09-22/{desktop,mobile}-portal-{home,designs}.png`. Screenshot images are intentionally a local logo fixture, not represented as real project photographs. Production previews only use actual shared image revisions. Browser spec: `apps/web/e2e/client-portal-ui.spec.ts`; opt in with `CLIENT_PORTAL_QA_SLUG` for an enabled isolated portal and `BUSINESS_CORE_URL` for its local API. No user session was modified. Comprehensive RTL, keyboard and server-enforced section visibility acceptance remain open.

## Execution section visibility consumer

The client now consumes optional `PublicProject.clientSections` (`progress`, `documents`, `handover`, `updates`), defaulting to enabled for older payloads. Progress controls Overview, Work progress and Daily updates; Documents and Handover have individual controls; Updates controls published client notices and schedule alerts. Disabled content is not mounted, including already-open progress records and handover/warranty decision dialogs. Hidden active views fall back to an enabled section, or Home when every execution section is disabled. Commercial Approvals, Designs and Payments remain separate and available.

The Updates subtab shows only published `clientUpdates`, with title, summary, kind and publication date. Internal source identifiers are not shown as client links. Server filtering and direct-file authorization are required alongside these UI controls; the UI is not the authorization boundary. Fourteen targeted client tests pass, including visibility changes while a report is open, hidden active navigation, preserved commercial tabs and published-update rendering. Backend/staff implementation is being integrated separately by the parent task.
