# Palm Living Sales CRM closure audit — 24 September 2026

Source of client acceptance items: `Downloads/Wodana_PLM_Feedback_Tracker/Tracker.html` (PLM-001–024). Acquisition/routing context: `Downloads/Palm Living Lead Flow CRM Requirements Report.pdf` (draft). This is a **local implementation audit**, not a Palm production or client sign-off. The tracker copy marks all 24 items Open and reserves “PLM Verified” for Palm after testing.

## Agreed business rule

Every Deal File, including Furniture/showroom sales, starts from a **Won opportunity**. This user decision supersedes the direct-from-enquiry Furniture exception proposed in PLM-008. A Won status is a Sales outcome; Finance-confirmed Deal File and production release are separate, later events. Do not count them as a second Won until Palm defines PLM-009.

## Local implementation status

| Tracker item | Local state | Release/acceptance still required |
| --- | --- | --- |
| PLM-001–002 | Pipeline labels and new-pipeline “New Opportunity” stage are in code. Migration `0115_sales_enquiry_titles.sql` renames the legacy stage. New pipelines also include explicit Won/Lost outcome columns. | Apply migration and verify Palm's existing pipeline labels. |
| PLM-003, PLM-008 | Deal submission and production release require a linked Won opportunity; direct Furniture Deal File path is intentionally not offered. | Verify a Furniture example and an interiors example with Palm. |
| PLM-004, PLM-012–016 | Sales submission requires accepted quotation, signed agreement, HTTPS payment proof and 1–3 provisional commission lines. Finance can correct amounts or return with reason; a separate Operations reviewer approves/rejects; production remains locked without Finance evidence and approval. In-app handoff/outcome notices and enquiry/opportunity ↔ Deal File links are in code. Reusable, editable Finance reviewer and Operations approver roles/permissions are seeded by `0116_commercial_review_roles.sql`. | Apply migration, assign named reviewers in Settings, and run a three-account Palm UAT, including returns, rejection, notification receipt, and release denial. Existing pre-migration approved records need re-review; do not bypass the new gate. |
| PLM-005–007 | Enquiry-to-opportunity conversion, mandatory enquiry type, and replacement of “Not Sure Yet” before qualification/conversion are implemented. | Test real Palm configuration and access by Sales role. |
| PLM-009 | **Open business definition.** Current CRM reports count an opportunity marked Won once. | Palm must decide whether completion/full payment is a separate KPI, and name that KPI; do not double-count one opportunity as two wins. |
| PLM-010–011 | **External coordination.** A fresh demo link and meeting time cannot be confirmed from local code. | Choose recipient, schedule and approved deployment/demo environment. |
| PLM-017–023 | Mandatory Emirate, optional Emirate-specific Area, country-code phone capture/validation, normalized WhatsApp link, read-only enquiry reference, and generated enquiry title are implemented in the local intake and UI paths. | Verify manual entry, public form and import with Palm sample data; verify phone and WhatsApp behavior for non-UAE numbers. Apply the reference/title migrations before expecting this on Palm. |
| PLM-024 | **Open client privacy decision.** Internal notes currently display inside the staff enquiry workbench. | Palm must specify access for assigned Sales vs all staff vs Wodana support, and confirm that notes never appear in client-facing output. Then implement and test that policy. |

## Wider PDF requirements that prevent full CRM sign-off

- The report is a draft. Customer types, budget bands, lead-conversion KPI, assignment policy, duplicate review window, public form wording/QR branding, campaign attribution and some lifecycle terms need Palm's approval.
- Shared channel-labelled enquiry forms are not a native Meta Lead Ads or PlyLeads connector. Those providers need an authenticated API/webhook contract and credentials. Do not label manual channel selection as automated ingestion.
- Palm tenant configuration and live behavior must be verified: sales team/queue and role inheritance, one-hour takeover, weekend notifications, office-hours SLA, duplicate decision, first follow-up, qualification, reports reconciliation, and a synthetic enquiry → Won opportunity → Finance → Ops → production-denial/approval journey.
- This local pass was not deployed. The synthetic funnel now runs against a newly created, disposable local database with current migrations; it is not evidence that the Palm production tenant is configured or that Palm users have accepted the workflow.

## Reviewer roles in Settings

- **Finance reviewer:** view pre-execution/opportunities and verify receipts, payment proof and final commission amounts. May return to Sales. Cannot approve the Deal File.
- **Operations approver:** view pre-execution/opportunities, approve/reject only a Finance-confirmed Deal File, and authorize production release. Does not receive quotation-approval access through this role.
- The submitting Sales person, Finance reviewer and Operations approver must be three distinct user IDs for one Deal File. Owner/administrator may have the permissions but cannot bypass separation of duties on a submission.

## Local verification

- Business-core commercial: 29 test files, 160 tests passed.
- Business-core CRM: 30 test files, 252 tests passed.
- Web CRM: 31 test files, 159 tests passed.
- Web commercial: 38 test files, 170 tests passed with a 20-second per-test limit; the quotation workbench alone also passed 14/14 at that limit. Its long UI interactions can exceed Vitest's default 5-second limit under load.
- The disposable Palm synthetic funnel passed on 24 September: shared form → enquiry → qualification → opportunity → commercial checks → project release, including assignment, duplicate, permission, workflow and replay checks. The generic funnel also passed. The runner drops only its uniquely named test database on exit.
- Browser handover scope and acceptance-entry checks passed on desktop and mobile using an isolated local web server and mocked project state. This verifies the handover interface, not a signed Palm acceptance.
- Four focused backend test files passed (48 tests), project workspace tests passed (22), and backend/web typechecks plus builds passed after the daily progress changes.
- Broader CRM/project regression checks passed: 79 backend files / 617 tests and 41 web project files / 177 tests.

## Daily progress handover improvement

- The report editor now separates shift/workforce, evidence, and safety/recovery. It records trades, headcount, hours per person, measured task output, conditions, materials, blockers, tomorrow's plan, photo references, and—when the programme is at risk—a cause, recovery action, owner and next update date.
- The backend persists the crew lines and derives headcount/labour hours from them. A partially filled crew line can remain in a draft, but submission rejects incomplete lines. The narrative limit was expanded to 1,000 characters; feed cards show a short excerpt while the report document preserves the full text.
- The report document presents a shift summary, labour table, output against plan, schedule recovery, evidence and review history with more whitespace and responsive spacing. Client publication still requires independent approval and explicitly selected evidence; internal labour and incident details are not automatically exposed.
- Focused unit/component tests cover persistence, validation and the report view. The editor's desktop/mobile browser layout still needs a Palm-like seeded project for a visual acceptance pass; the existing mocked browser route does not seed the server-rendered project state.

## Sign-off gate

Local code has passed focused tests, typechecks, builds, the disposable backend funnel, and desktop/mobile browser handover checks. Palm release sign-off still requires an approved deployment, tenant configuration, three-role live UAT, client choices on PLM-009/024 (and confirmation of the later PLM-008 override), a scheduled demo (PLM-010/011), and Palm's own PLM Verified entries. Until those happen, status is **not signed off for Palm production**.
