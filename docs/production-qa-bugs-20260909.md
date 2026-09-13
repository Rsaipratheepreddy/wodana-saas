# Production QA Bug Report

**Decision:** Application release signed off; external accounting exceptions remain  
**Tested:** 9–10 September 2026  
**Environment:** `https://iglo.wodana.ai`, `https://client.wodana.ai`, `https://api.wodana.ai`  
**Live release:** `20260910-production-signoff-r4`  
**Method:** Fresh authenticated browser testing, full local web/core regression, real local API lifecycle smoke, optimized production builds, staged deployment health checks, public endpoint verification, tenant-brand verification and production provider-status reads.

## Final production sign-off update

Release `20260910-production-signoff-r4` is live and signed off for application use. Login and client portal return HTTP 200 with the expected release header. Business Core readiness reports PostgreSQL, outbox, worker, Redis and Intelligence API healthy. The Intelligence API and automation worker are healthy and connected to the live core.

- Brand corrected to deep plum `#76538f` with restrained warm orange `#e99a72`; the client portal uses the minimal layout. Green is reserved for genuine success states.
- Business Core: 51 test files passed and 1 skipped; 327 tests passed and 10 skipped.
- Web: all 100 test files passed; all 529 tests passed.
- Focused project/client-portal regressions: all 16 passed.
- Business Core and Web type-checks passed. Business Core and optimized Web production builds passed. Web lint has zero errors.
- The complete local lifecycle smoke passed from lead qualification through requirements, site plan, verified measurements, design approval, quotation acceptance, agreement/payment gates, execution release, procurement, delivery, inspection, published closeout, handover, finance close and accounting reconciliation. Temporary smoke records were removed.
- The unintended 9 September QA mutation was corrected transactionally: the Guest bedroom handover is back to Draft, the project is back to Active, no client acceptance exists, and a correction entry was appended to the audit trail.
- The released Palm Jumeirah scope was reconciled to its accepted quotation: all three items now preserve both `MR plywood` and `Natural Veneer`, with a correction entry in the audit trail.
- Obsolete Wodana release containers and unused images were removed while retaining the live and immediate rollback releases. Root-disk use fell from 88% to 66% and available memory returned to approximately 1.9 GiB.

### External accounting exceptions

These are provider/account configuration exceptions, not application release defects:

- QuickBooks US sandbox remains `degraded` because the provider returns HTTP 502. The application records and exposes the degraded state correctly; live QuickBooks posting is not signed off.
- Zoho Books is connected but the selected organization is INR while this workspace is AED. AED accounting posting is not signed off until the correct organization is selected or a documented multi-currency policy is approved.
- Google Workspace and WhatsApp are connected without a current recorded error.

The observations below are retained as the pre-fix audit baseline. Their status text describes the earlier release and should not be read as the current production decision.

## Historical local remediation update

**Updated:** 9 September 2026  
**Candidate:** Local workspace only; not deployed  
**Decision at that time:** The reported QA defects were remediated in the local candidate, but production sign-off remained rejected pending deployment and production verification. The final result is recorded above.

| ID | Local remediation | Remaining production action |
| --- | --- | --- |
| QA-001 | Deployment now carries an explicit `WODANA_RELEASE_ID` and exposes it in readiness. | Deploy one identifiable candidate and repeat production QA. |
| QA-002 | Release now requires Owner Review, Deal File, approved current designs, complete client material approvals, accepted quotation, operational agreement/payments and resolved changes. | Exercise the complete path with fresh production records. |
| QA-003 | Demonstration agreement/payment evidence is rejected by release and readiness rules. | Audit the existing demo-backed production project and correct it through an approved data procedure. |
| QA-004 | “Review readiness” is diagnostic first and requires an explicit confirmation before persisting Ready. Whole-project Handover also requires all handovers and all snags closed. | Correct the Guest bedroom state caused during QA and retain its audit trail. |
| QA-005 | Quotation-to-project release transfers every material and specification, with regression coverage for both MR plywood and Natural Veneer. | Retest against a freshly accepted and released quotation. |
| QA-006 | Handover is blocked by missing material procurement/receipt evidence, required inspections, unpublished client documents, open snags and incomplete handovers. | Re-evaluate the existing production project after data correction. |
| QA-007 | Quotation review is blocked until scope links, site plan, verified measurements and approved current designs are ready. | Retest in staging and production. |
| QA-008 | Provider reads now update connection health immediately and write success/failure audit events. Local QuickBooks invoice and customer reads succeeded. | Confirm the intended live QuickBooks company and run an authorized AED lifecycle. |
| QA-009 | WhatsApp tools now load approved templates; failures degrade the connection and successes restore it. Local template load succeeded. | Run a controlled real template/OTP test after deployment. |
| QA-010 | Accounting connections with a provider currency different from the legal-entity currency are marked Needs attention and removed from the healthy count. | Connect the correct AED accounting organization or approve a documented multi-currency policy. |
| QA-011 | Readiness now checks PostgreSQL, durable outbox backlog/worker freshness, Redis and the integration API, and includes the release ID. Provider health remains tenant-scoped in the workspace UI. | Verify worker/queue telemetry on the deployed stack. |
| QA-012 | Provider read successes and failures now persist as workspace audit events. Local Google, QuickBooks and WhatsApp reads are present in the audit store. | Confirm the same events in production Audit Logs. |
| QA-013 | OAuth redirects and deployment checks now use `api.wodana.ai`; the invalid `integrations.wodana.ai` contract was removed. | Deploy and verify public TLS/routes. |
| QA-014 | Internal-review submission requires explicit confirmation that the file preview matches its folder, room/item and design type. | Retest with a deliberately mismatched artifact. |
| QA-015 | Handover requires approved closeout documents to have client files and published transmittals. | Retest with internal-only and published documents. |
| QA-016 | Client report publication requires evidence files; handover requires completion of the configured inspection task. | Retest report publishing and handover inspection gates. |
| QA-017 | Agreement & payments, Change requests and Approvals & release are present in pre-execution navigation. | Visual navigation retest after deployment. |
| QA-018 | Baseline HSTS, CSP, frame, MIME, referrer and permissions headers are configured and verified locally. | Verify the CDN/reverse proxy preserves them in production. |
| QA-019 | Project dates render with an explicit `en-GB` locale and UTC timezone on server and client. | Confirm no hydration warning in production browser logs. |
| QA-020 | Shared modal dialogs now use an opaque surface/backdrop and lock document/body scrolling. | Repeat desktop and mobile form-preview checks. |
| QA-021 | Quotation material editing stacks into labeled mobile cards instead of an undiscoverable wide table. | Repeat the 390 px materials workflow. |
| QA-022 | Client quotation rows stack on mobile with quantity, unit, rate and amount visible. | Repeat the 390 px client preview. |
| QA-023 | Project navigation collapses and overview grids become single-column at the tablet breakpoint. | Repeat the 768 px project workspace check. |
| QA-024 | Converted opportunities now take ownership from the active opportunity before falling back to the stale lead owner. | Confirm the same manager across CRM and Pre-execution. |
| QA-025 | Design folder count now uses `file` for one and `files` otherwise. | Visual smoke test after deployment. |
| QA-026 | CRM stage label is now `Disqualified`. | Visual smoke test after deployment. |

### Local verification evidence

- Business core: 50 test files passed, 1 skipped; 324 tests passed, 10 skipped.
- Integration service: all 65 tests passed; strict source type-check and focused lint passed earlier in this remediation.
- Live local read-only checks: QuickBooks invoices and customers loaded, Google calendars loaded, WhatsApp approved templates loaded, and all operations produced runtime health/audit events.
- Local integration summary correctly reports 3 connected, 4 configured and 1 needing attention because the configured Zoho Books INR organization conflicts with the AED legal entity.
- Web regression: 98 of 100 files (522 of 524 tests) passed in the combined two-worker run; the only two failures were test-runner contention timeouts, and both affected files then passed independently (quotation 9/9, leads 17/17). The optimized Next.js production build and TypeScript check passed.
- Targeted Playwright: all 13 executable desktop/mobile checks passed for the form builder, requirements notes, quotation/materials/AI flow and complete design approval flow; 1 touch-only drag case was intentionally skipped in favor of its tested button/keyboard path.

### Broader regression-suite debt

The complete legacy Playwright run is not a release-pass signal yet: 92 checks passed, 50 failed and 10 were skipped. These failures are outside the 26 production defects above, but they must be triaged before final acceptance rather than hidden by the targeted green run. The main clusters are stale navigation/catalog expectations after the current information architecture, test-mode project pages that fail their server-side backend read, old CRM inbox fixtures, data-grid mobile/accessibility/snapshot baselines and workspace visual baselines. The detailed Playwright error contexts remain under `apps/web/test-results/` for the next QA pass.

The original production observations below are retained unchanged as the audit baseline.

## Release blockers

| ID | Severity | Defect | Status |
| --- | --- | --- | --- |
| QA-001 | P0 | The public release is not the current release candidate | Open |
| QA-002 | P0 | Execution release omits owner, design and material approval gates | Open |
| QA-003 | P0 | Demonstration evidence satisfies live release and payment gates | Open |
| QA-004 | P0 | Handover readiness silently changes persisted project state | Open and data cleanup required |
| QA-005 | P0 | Accepted quotation materials are lost in the project BOQ | Open |
| QA-006 | P0 | Project can reach Handover with missing procurement and unresolved controls | Open |

P0 means stop ship. P1 must be fixed before production acceptance. P2 is a material usability or reliability defect. P3 is minor polish.

## Detailed defects

### QA-001 P0 Public release is not the current release candidate

**Route:** `https://iglo.wodana.ai/login`

**Steps**

1. Request the live login page.
2. Inspect the `X-Wodana-Release` response header.
3. Compare the public workflow with the current locally verified owner-review, Deal File, material-approval and project-control implementation.

**Expected:** Production sign-off is performed against the same candidate that is intended for release.

**Actual:** Production serves `20260909-quotation-materials-modal`. The newer owner-review, Deal File, material-release and project-control changes exist only in the local workspace and are absent from the public application. Therefore the current local candidate has no production verification.

### QA-002 P0 Execution release omits mandatory owner, design and material gates

**Routes**

- `/workspace/pre-projects/cases/cc957c01-ad6b-48aa-8fac-5289e95cc51d/execution-release`
- `/workspace/pre-projects/cases/b194df8a-107c-4daa-a6c6-586c3a0fc0a0/execution-release`
- `/workspace/pre-projects/cases/4df963ad-cbf1-44c5-9b7d-0381af801ca9/execution-release`

**Steps**

1. Open Approvals and release.
2. Open Release checklist.
3. Compare it with the Design tab and the required commercial gates.

**Expected:** Independent Owner Review, active Deal File, approved design revisions and approved client material selections are mandatory gates before project execution.

**Actual:** The checklist contains only client quotation acceptance, signed agreement, required payments and resolved change requests. The page explicitly says, `Design decisions remain in Preparation → Design while that workflow is being connected.` A released case shows zero designs and zero approved designs.

### QA-003 P0 Demonstration evidence satisfies live release and payment gates

**Routes**

- `/workspace/pre-projects/cases/cc957c01-ad6b-48aa-8fac-5289e95cc51d/contracts`
- `/workspace/pre-projects/cases/cc957c01-ad6b-48aa-8fac-5289e95cc51d/execution-release`
- `/workspace/projects/020d2ffb-586f-4355-8cef-5f2dca182d5f/commercial`

**Steps**

1. Open the Palm Jumeirah penthouse agreement and payment records.
2. Open release History and Release checklist.
3. Open the connected project Budget and Payments and Books.

**Expected:** Explicit demonstration records are isolated from production truth and cannot satisfy agreement, payment or release controls.

**Actual:** Evidence says `Demonstration agreement record; not a live signed contract`, but the UI reports Signed agreement verified. Two milestones are Verified paid using `demonstration ledger` references, and the release history says no real client approval, invoice or payment was created. The same records still drive an Active production project and its financial status. No Demo badge separates these records from operational projects or KPIs.

### QA-004 P0 Handover readiness silently changes persisted project state

**Route:** `/workspace/projects/020d2ffb-586f-4355-8cef-5f2dca182d5f/handover`

**Steps**

1. Observe Guest bedroom final handover in Draft with the action `Check readiness`.
2. Click `Check readiness` once.

**Expected:** Display the readiness result and blockers first. Persist a status change only after an explicit confirmation. An open snag, unpaid final milestone and incomplete handovers must prevent whole-project Handover advancement.

**Actual:** The click immediately saved Guest bedroom as Ready, changed the action to Record acceptance and moved the whole project from Active to Handover. No checklist or confirmation was shown. The project still had one open snag, an upcoming final payment, no procurement records, internal-only documents and two Draft handovers.

**Production data cleanup:** QA caused this one unintended state change while verifying what appeared to be a diagnostic action. The audit now contains `Handover status · Antro Tenant Owner · 9 Sept`. Guest bedroom final handover must be reviewed and returned from Ready only through an approved data-correction procedure. No acceptance was recorded, and QA did not attempt a second mutation or manual rollback.

### QA-005 P0 Accepted quotation materials are lost in the project BOQ

**Source:** `/workspace/pre-projects/cases/cc957c01-ad6b-48aa-8fac-5289e95cc51d/quotations?quote=d2596719-0304-4624-bca0-5254cc1547c1`

**Destination:** `/workspace/projects/020d2ffb-586f-4355-8cef-5f2dca182d5f/boq`

**Steps**

1. Open accepted quotation V1.
2. Confirm each of its three items contains two materials, `MR plywood` and `Natural Veneer`.
3. Open the connected project BOQ.

**Expected:** Every accepted material/finish and its specification remains attached to the released item.

**Actual:** Each project BOQ row contains only `MR plywood`. `Natural Veneer` is absent from all three released items.

### QA-006 P0 Project can reach Handover with missing procurement and unresolved controls

**Routes**

- `/workspace/projects/020d2ffb-586f-4355-8cef-5f2dca182d5f/overview`
- `/workspace/projects/020d2ffb-586f-4355-8cef-5f2dca182d5f/procurement`
- `/workspace/projects/020d2ffb-586f-4355-8cef-5f2dca182d5f/site-work`
- `/workspace/projects/020d2ffb-586f-4355-8cef-5f2dca182d5f/handover`

**Expected:** Material-bearing scope needs accepted procurement/stock/waiver evidence. Open snags and incomplete handovers must block the Handover stage.

**Actual:** Procurement has zero orders, zero enquiries/comparisons and no commitments or receipts. Execution is three of three tasks and 100 percent. The overview reports one open snag. One room readiness click nevertheless moved the whole project into Handover.

### QA-007 P1 Quotation review ignores upstream readiness

**Route:** `/workspace/pre-projects/cases/4df963ad-cbf1-44c5-9b7d-0381af801ca9/quotations?quote=1fe9664f-227e-43cc-8445-8327972bd40a`

**Expected:** Submit for review is blocked, or clearly requires an authorized exception, until the required site and design inputs exist.

**Actual:** Submit for review is enabled while all three requirement items have no captured dimensions, Site plan has no records, and Design has zero internal approvals, zero client approvals and zero approved files. The only design remains Draft.

### QA-008 P1 QuickBooks is falsely shown as healthy

**Route:** `/workspace/integrations`

**Steps**

1. Observe `4 connected`, `4 configured`, `0 need attention` and `QuickBooks · US sandbox — Connected`.
2. Open QuickBooks tools.
3. Load Invoices and payment links.
4. Repeat with Customers.

**Expected:** Provider data loads, or the connection changes to Degraded/Needs attention with a fresh-error timestamp.

**Actual:** Both reads returned `Provider rejected the request. Check account access and settings.` The summary continued to show Connected and zero needing attention. Integration details also showed no mapped organization.

### QA-009 P1 WhatsApp is healthy in summary but unusable in Integration tools

**Route:** `/workspace/integrations`

**Expected:** A Connected WhatsApp account permits approved-template refresh/use, or the connection is marked as needing attention.

**Actual:** WhatsApp Business is counted as Connected with zero integrations needing attention, but Approved message templates, the selector and Refresh templates are disabled in its tools dialog. Integration details show no mapped organization. Backend template retrieval returned two approved templates, so the user-visible account/tool mapping is inconsistent.

### QA-010 P1 Accounting currency mismatch is accepted as healthy

**Route:** `/workspace/integrations`

**Expected:** The selected accounting organization must match the Iglo AED ledger, or an explicit supported multi-currency policy must warn and block incompatible posting.

**Actual:** `Zoho Books · Wodana (INR)` is Connected and counted healthy while the workspace, quotations and projects use AED. A fresh Zoho invoice read completed with no records. QuickBooks is a US sandbox rather than the live Dubai company.

### QA-011 P1 Readiness endpoint does not represent production readiness

**Endpoint:** `https://api.wodana.ai/api/v1/health/ready`

**Expected:** Production readiness covers or separately exposes the integration API, Redis/provider vault, worker, reconciliation queue and critical provider degradation.

**Actual:** The endpoint returns HTTP 200 and `status: ready` with only `checks.postgres: ok`, while fresh QuickBooks reads fail and no worker/queue freshness is visible.

### QA-012 P1 Provider reads and failures are missing from Audit Logs

**Routes:** `/workspace/integrations`, `/workspace/settings/audit-logs`

**Steps**

1. Load Google provider calendars successfully.
2. Attempt the failing QuickBooks invoice/customer reads.
3. Open Audit Logs fresh.

**Expected:** The dialog promise, `Provider actions are recorded in the workspace audit log`, is true for successful reads and failures.

**Actual:** Neither Google loads nor QuickBooks failures appeared. The latest audit row remained Lead Form created.

### QA-013 P1 Documented integrations hostname has invalid TLS and no service route

**Endpoint:** `https://integrations.wodana.ai/api/v1/health/ready`

**Expected:** The documented deployment hostname has a valid certificate and serves the integration readiness endpoint.

**Actual:** TLS validation fails because the certificate does not include `integrations.wodana.ai`. With certificate validation bypassed for diagnosis, the route returns HTTP 404. Current webhook routes under `https://api.wodana.ai/api/v1/integrations/providers/webhooks/...` are reachable, so this is deployment/configuration contract drift.

### QA-014 P1 Design metadata/content mismatch can be sent for approval

**Route:** `/workspace/pre-projects/cases/4df963ad-cbf1-44c5-9b7d-0381af801ca9/designs?folder=65c1ccdf-c0fa-42d5-8df3-23c0a49535dc&file=465659c9-1a31-4d99-a8dc-fe0de7e4e11b`

**Expected:** Folder, item, design type and preview describe the same artifact, with validation before review.

**Actual:** The folder is Acoustic wall treatment and the design type is 2D floor plan, but the preview is a Woddy `LOTTIE ANIMATION CONCEPT`. Send for review remains enabled.

### QA-015 P1 Handover readiness does not require published closeout documents

**Route:** `/workspace/projects/020d2ffb-586f-4355-8cef-5f2dca182d5f/documents`

**Expected:** Required closeout documents are published/transmitted to the client before handover readiness.

**Actual:** Both approved documents remain Client visibility Internal, with zero transmittals, while the project reached Handover.

### QA-016 P1 Completion and client sharing do not require evidence or inspection

**Routes**

- `/workspace/projects/020d2ffb-586f-4355-8cef-5f2dca182d5f/daily-progress`
- `/workspace/projects/020d2ffb-586f-4355-8cef-5f2dca182d5f/overview`

**Expected:** Completed joinery reports need the configured evidence/inspection before client publication and handover readiness.

**Actual:** All three daily reports are Approved and Client shared with zero photos and `No photos attached`. The overview shows zero inspection checks, but execution is 100 percent and the handover stage advanced.

### QA-017 P1 Critical commercial pages are missing from pre-execution navigation

**Route:** Any `/workspace/pre-projects/cases/{caseId}/requirements` page.

**Expected:** A user can move through requirements, design, quotation, agreement/payments, change requests, approvals/release and client access in a clear end-to-end sequence.

**Actual:** The case sidebar exposes only Requirements, Client inspirations, Design, Quotations and Client portal. Agreement and payments, Change requests and Approvals and release are absent. They can only be reached through indirect deep links elsewhere, making the release path undiscoverable from the working case.

### QA-018 P1 Public web responses omit baseline browser security headers

**Routes**

- `https://iglo.wodana.ai/login`
- `https://client.wodana.ai/portal/iglo-architects`
- `https://wodana.ai/`

**Expected:** Production responses set an agreed browser-security policy, including HSTS, clickjacking protection, content security policy, MIME sniffing protection and an appropriate referrer policy.

**Actual:** Fresh response headers contained none of `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy`.

### QA-019 P1 React hydration failure on Project overview

**Route:** `/workspace/projects/020d2ffb-586f-4355-8cef-5f2dca182d5f/overview`

**Viewport:** 1440 × 900

**Expected:** Server and client render identical content with no recovery render or console error.

**Actual:** A fresh navigation logs minified React error `#418` with a text mismatch. The date changes from `04 Sep` before hydration to `04 Sept` after hydration, causing a client rerender and visible instability.

### QA-020 P2 Form preview is transparent and does not lock background scrolling

**Route:** `/workspace/crm/leads` → Forms → Edit form → Preview form

**Viewports:** 1440 × 900 and 390 × 844

**Expected:** Preview owns an opaque modal surface and prevents background scrolling.

**Actual:** The dialog background computes to transparent and the page body remains scrollable. Builder content visibly bleeds through the lower preview on desktop.

### QA-021 P2 Materials editor hides required fields on mobile

**Route:** DIFC quotation `1fe9664f-227e-43cc-8445-8327972bd40a` → Materials

**Viewport:** 390 × 844

**Expected:** Required material fields are discoverable through a stacked mobile editor or clear column navigation.

**Actual:** The dialog content is about 324 px wide while its materials table is about 1000 px wide. Only Material and Specification are initially visible. Type, Qty, Unit, Rate, Amount and actions require a long horizontal swipe with no clear cue.

### QA-022 P2 Client quotation preview hides price details on mobile

**Route:** DIFC quotation `1fe9664f-227e-43cc-8445-8327972bd40a` → Preview

**Viewport:** 390 × 844

**Expected:** The client can see quantity, rate and amount in the default row view or a responsive stacked layout.

**Actual:** Quantity, unit, rate and amount are off-screen in an internal horizontal scroller with no explicit cue.

### QA-023 P2 Project workspace is cramped at tablet breakpoint

**Route:** `/workspace/projects/020d2ffb-586f-4355-8cef-5f2dca182d5f/overview`

**Viewport:** 768 × 1024

**Expected:** The sidebar collapses or the project grid becomes one column at the tablet breakpoint.

**Actual:** The persistent approximately 246 px sidebar leaves about 522 px for two-column KPI and decision cards. Headings and labels wrap into narrow fragments and reduce scanability.

### QA-024 P2 Lead ownership differs between CRM and Pre-execution

**Routes**

- `/workspace/crm/leads?lead=198910d7-1dcc-487a-bbd1-e1185bfe1d16`
- `/workspace/pre-projects?search=DIFC%20executive%20office%20fit-out`

**Expected:** One authoritative lead manager is shown across both modules.

**Actual:** DIFC executive office fit-out is Unassigned in CRM but assigned to Naina Verma in Pre-execution.

### QA-025 P3 Design folder uses incorrect singular count

**Route:** DIFC Design → Acoustic wall treatment folder

**Actual:** The folder header says `1 files`; the adjacent count correctly says `1 file`.

### QA-026 P3 CRM stage label has incorrect casing

**Route:** `/workspace/crm`

**Actual:** The stage label is `DisQualified` instead of `Disqualified`.

## Untested production outcomes

These paths do not have production sign-off evidence:

- Client WhatsApp OTP receipt and portal approval. The DIFC case has zero active client logins, and QA did not send an external message.
- Live QuickBooks or Zoho invoice/payment creation, refund, credit, supplier bill or purchase-order write.
- Worker execution, reconciliation queue freshness and due-reminder processing. The supplied SSH credential was rejected, so current container/worker logs could not be inspected independently.
- The latest local release candidate, because it is not the release currently served by production.

## Passed checks

- Production login, workspace shell and the main CRM, Pre-execution, Projects, HRMS and Integrations entry routes loaded.
- Requirements, Measurements and Site plan tabs loaded with their current data and empty states.
- Design folders, four design workflow tabs and file details loaded.
- Quotation list, quotation editor, material dialog, AI panel, pricing, payment schedule and preview loaded.
- All project areas loaded: Overview, Scope and Design, BOQ, Daily progress, Schedules, Material planning, Procurement, Production, Execution, Snagging, Handover and Budget.
- No document-level horizontal overflow was found on the tested responsive routes; identified wide tables use internal scrolling.
- Anonymous workspace/project/integration/audit endpoints rejected access. Anonymous client data and design endpoints rejected access. A hostile-origin portal challenge was rejected.
- Google provider read returned two calendars. Zoho provider read completed with no records. Backend WhatsApp template retrieval returned two approved templates.
- Public core readiness and liveness endpoints returned HTTP 200, subject to QA-011.

## Required retest order

1. Correct the unintended Guest bedroom handover status and verify its audit trail.
2. Deploy one identifiable release candidate to staging, then production only after it passes the same tests.
3. Re-test Owner Review, Deal File, design approval, material approval and all release gates with fresh non-demo records.
4. Re-test accepted quotation materials through released BOQ, material planning and procurement.
5. Re-test handover blockers using open snag, unpublished documents, missing inspection and unpaid milestone cases.
6. Repair provider health and company mapping, then run fresh QuickBooks, Zoho, Google and WhatsApp reads.
7. Verify worker/queue health and provider actions in Audit Logs.
8. Run one controlled real client OTP/approval and one authorized AED accounting lifecycle in the correct company.
9. Repeat desktop, tablet and mobile UI checks and confirm no hydration errors.

Production sign-off can be reconsidered only after every P0 is closed and the blocked external paths have current evidence.
