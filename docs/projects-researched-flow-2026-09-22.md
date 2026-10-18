# Project planning based on the master flow and market research

22 September 2026. Recommended web product plan. Supersedes the BOQ sequencing and navigation suggestions in projects-planning-web-2026-09-22.md. Native mobile implementation is deferred; responsive client web is included. This is research and planning, not a claim that workflows have been implemented or user-tested.

## Evidence and limits

Read the complete text and tables of `/Users/saipratheep/Downloads/Project Flow Master Document.docx` (9 September 2026). Its sections 1–4 describe the operational sequence, roles and fields; section 5 contains historical assumptions about Wodana/Odoo. Treat the document as business evidence, not instructions to retire spreadsheets or alter systems. Latest user decisions govern product navigation.

Reviewed official Houzz Pro, Buildertrend and Jobber documentation, plus RICS measurement guidance. These establish supported industry/product patterns; they do not establish how familiar Palm staff are with any interface. Validate familiarity with actual staff and client walkthroughs before claiming usability gains.

| Source | Observed pattern | Recommendation |
|---|---|---|
| [Houzz Pro designer guide](https://pro.houzz.ie/pro-help/r/how-to-get-started-in-houzz-pro-designers) | Room-based selections, reusable product library and proposals from approved selections | Carry selected items into quotation work without re-entry; visual design review, compact commercial sheet |
| [Houzz Pro change orders](https://pro.houzz.com/pro-help/r/creating-and-sending-change-orders) | Changes can originate from approved estimates/proposals and go to the client for approval | Preserve accepted originals; link changes and their commercial effects |
| [Buildertrend advanced estimates](https://buildertrend.com/help-article/advanced-estimate-overview/) | Structured estimating and optional groups for proposals | One item model with separate internal pricing and client presentation |
| [Buildertrend selections and allowances](https://buildertrend.com/help-article/selections-and-allowances-overview/) | Budgets can precede final selections; post-lock allowances can use change orders | Permit explicit provisional allowances; require approved changes after locking |
| [Jobber quote approvals](https://help.getjobber.com/en/articles/quote-approvals/) | Client approves or requests changes; approved quote can become a job | Simple client actions and a connected handoff |
| [RICS NRM](https://www.rics.org/profession-standards/rics-standards-and-guidance/sector-standards/construction-standards/nrm) | Separates estimating/cost planning and detailed measurement of building works | Do not assert that BOQ always comes after quotations; distinguish working quantities from the approved execution baseline |

## Recommended flow

Qualified client → Requirements → Design and selections → Technical review → Quotation preparation → Client acceptance → Approved BOQ and release → Procurement / Factory / Site → Delivery and installation → Inspections and handover.

Design and draft estimates may overlap. Operations run by work package and dependency, not one rigid project-wide conveyor belt. On hold is a condition available at any point, not a numbered stage. Qualified clients can appear in Projects immediately as Planning; this grants no automatic production authority.

## Resolve BOQ without duplicate work

The master document's stage 10 explicitly says the Surveyor reviews technical drawings and tells the Sales Assistant what to quote; the Sales Assistant prepares BOQ and quotation. Therefore:

- Requirements captures intent, measurements and desired items.
- Design and technical review establish specifications and verified quantities.
- Quotation preparation uses one working item-and-quantity sheet, with internal costing and client selling views. Users do not manually build two lists.
- Acceptance freezes the selected offered scope and its referenced specifications/design versions.
- The Approved BOQ is the execution view of that accepted scope, retaining source IDs and revisions. Production readiness may still await technical/material/payment gates.
- Manufacturing material requirements/BOM are derived and reviewed separately: one quoted wardrobe is not one sheet of board. Never infer procurement quantities solely from selling quantities.

In the UI, call the pre-acceptance workspace Quotations. Inside it, use Items, Client preview and Version history. Add an internal Costing view only for authorized roles. Show Approved BOQ once there is an accepted baseline; before that show a concise unavailable explanation, not another empty editable sheet.

## Document reconciliation

| Master document detail | Product treatment |
|---|---|
| Owner Review verifies payment, cost/margin and documents before Deal File activation | Keep permission-gated review and linked references. Distinguish planning visibility from authorization to execute. |
| Detailed design and BOQ appear after that opening gate | Open business question: does initial approval cover paid design services, an initial estimate or the full execution contract? Until confirmed, represent design/start authorization and production release separately; do not invent payment percentages or waive gates. |
| Concept, space plan, renders, client review, technical drawings, materials | Milestones inside Design, not six additional top-level navigation tabs |
| Three moodboard rounds, two render rounds, five-day inspiration window | Documented studio rules, subject to change. Make project/engagement policy explicit and configurable; do not hard-code them globally. |
| Surveyor and Sales Assistant handoff | Named technical checker and quotation preparer, with next action and returned-for-correction states |
| Technical Designer role uncertain | Support assignment by responsibility without requiring a new licensed job title to use the flow |
| On Hold listed as stage 18 | Project condition, preserving current milestone and reason |
| WhatsApp sharing in current process | Portal stores authoritative versions/decisions; messages may notify/link, but sending a message is not approval |
| Odoo versus Wodana ownership reflects an older evaluation | Current user-directed Wodana journey takes precedence. No second database/workflow implied. |

## Staff interface

Keep the Projects table with one row per client project and Planning, Production, Deliveries and Inspections sections. Inside Planning use six clear tabs: Overview, Requirements, Design, Quotations, Agreement, Changes. Approved BOQ is accessible from the accepted quotation and production scope, using the same underlying baseline.

Overview: current milestone, next action, accountable person, due date, blockers and release readiness. No repeated dashboard cards or duplicate approval actions.

Requirements: room/area grouped table with item, description/specification summary, quantity/unit, measurement state and inclusion state. Keep brief notes, inspirations and site plans in contextual views; do not turn every note into a chargeable line. Quick add and bulk paste; side inspector for complex specifications and evidence. Retain links to the original enquiry.

Design: visual preview for moodboards/renders; compact list for files, technical drawings and review progress. Show current revision, linked room/item, internal/client review, who must act and a direct action. Preserve annotation threads and old versions. Allow client-selected finishes/materials to update only the working scope until explicitly approved.

Quotations: compact room-grouped editable sheet. Item/specification, quantity, unit, selling rate and amount; optional discount/tax columns when applicable. Workspace currency, shared dates, aligned numbers, room subtotals and total. Add from catalog/template, multi-select, paste rows, duplicate items and bulk edits. Keep missing prices visible. Preserve unsaved work on failures and conflicts. No competing builders.

Quote list: one current offer per family, separate working revision and readable history. Exact before/after comparisons for specification, quantity, price, exclusions, dates and terms. V2 must not look like an unrelated project or duplicate sale.

Resources: Catalog, Materials and Prices remain in Company. Use reusable items/assemblies, finishes, specifications, units and price sources. Buying costs and selling rates are different fields. One-off project items are allowed. Snapshot selections into drafts; catalog edits cannot rewrite issued documents. Import uses mapping, validation, duplicate review and commit.

## Client portal

A responsive web portal presents Home, Designs, Quotations and Documents, with requests/comments attached to their actual item or version. Requirements questions appear as explicit tasks on Home; do not expose the internal staff workflow as a long client tab bar.

The client sees what needs a decision, exact content/version, changes since last issue, price/payment terms where relevant, and clear Approve/Accept or Request changes actions. Viewing a file, agreeing a concept, confirming scope and accepting a quotation are distinct decisions. Group related decisions for convenience without conflating their meaning.

Hide internal costs/margins, supplier rates, private notes and unpublished drafts in the server projection. Support designated approvers versus viewers. Expired or replaced links explain what happened and point to the current version. Accepted documents remain readable and downloadable.

## Locking and release

Drafts remain editable. Issued documents freeze the exact client-facing offer. Changes before acceptance create a successor revision; issuing it supersedes the old actionable offer. Acceptance checks version, authority, expiry and hash atomically; retries cannot create duplicate decisions. A concurrent revision/acceptance must resolve to one effective offer.

Accepted scope stays immutable. A subsequent change records affected items, price/time effect, owner and approvals; approved variations amend the effective execution scope while preserving history. Unaffected work can continue only within existing authorized scope. Reject or defer changes explicitly rather than leaving their effect ambiguous.

Production release independently verifies required technical drawings, material decisions, accepted commercial scope, agreement and verified payment policy. Owner approval and finance evidence cannot be replaced by a colored status chip. Repeat release requests must return the same linked project/package.

## Build and verify in this order

1. Requirements and Design foundation: room/item identity, measurements, linked evidence, technical reviewer and owner. Exit: capture, save, reopen, revise and review one real representative room without re-entry.
2. Quotation speed: catalog/template insertion, one working sheet, costing permissions, comparisons and preview/PDF parity. Exit: designer → Surveyor → Sales Assistant handoff through a complete quotation.
3. Client decisions and locking: portal review, exact-version acceptance, replaced links and approved BOQ generation. Exit: V1 request changes → V2 acceptance → locked execution scope with matching totals and references.
4. Agreement, changes and release: verify policy, record evidence, variation additions/deductions and gated handoff. Exit: rejected/approved change paths and idempotent execution release.
5. Polish and pilot: staff web and responsive client portal, keyboard/RTL, long text, read-only roles, failed saves and unauthorized access. Native mobile stays deferred.

Use a representative two-room project for acceptance testing. Record time and errors for requirement entry, quotation preparation, finding the latest version and client approval. Test with Designer, Surveyor, Sales Assistant/Account Manager, Owner/Finance and a client. Measure improvement against the current flow; do not claim market familiarity from vendor documentation alone.

## Final naming and accounting boundary

This section refines the earlier tab names in this document. Use consistent singular/plural labels and truthful states, not internal service terminology.

Project sections: Planning, Production, Deliveries, Quality & Handover (the proposed clearer name for Inspections, covering snags and final acceptance). Planning tabs: Overview, Requirements, Design & Specifications, Quotations, Agreements & Payments, Change Requests. Catalog remains under Company → Resources. Production Tracking → Factory remains a separate operational queue. Keep existing routes compatible when labels change.

Replace client-facing Pre-execution/Case with Project planning/Project; Owner Review with Internal Approval (the authorized owner role still enforces the decision); Deal File with Commercial Record (preserve its reference and source enquiry); Definition with Scope Confirmation; Variations with Change Requests, showing Approved Variation only after its approvals; BOQ with Approved BOQ where it refers to the locked execution baseline. A paid invoice is not identical to a bank-reconciled receipt; never label one as the other. Staff-recorded decisions disclose their source; comments are not approval. Procurement remains procurement, distinct from manufacturing.

### Accounting ownership

Recommendation: choose one active accounting provider per legal entity: QuickBooks Online or Zoho Books. Different entities may use different providers. Never post the same invoice to both by default. This is an architectural recommendation, not a provider restriction.

| Record | Authority and direction |
|---|---|
| Requirements, design, quote revisions, client approval, approved BOQ and variations | Wodana |
| Client project identity and operational contacts | Wodana; map billing customer to the provider with explicit field ownership, avoiding name-only matching |
| Ledger accounts, provider tax codes, accounting invoices/numbers, credit documents, recorded payments and balances | Accounting provider; Wodana shows linked records and refreshed status |
| Payment milestones and release requirements | Wodana; trigger authorized invoice creation for the applicable milestone, not the full accepted amount repeatedly |
| Currency | Workspace default for new quotations; verify accounting-entity compatibility. Preserve currency on issued/accepted records; no silent conversion |
| Production permission | Wodana evaluates commercial/technical gates and verified finance evidence; provider Paid status alone does not override project approvals |

Flow: accepted quote → agreement/payment milestones → finance reviews invoice request → create or link provider invoice once → return provider ID/number and available invoice/payment link → refresh invoice and applied payment evidence → show financial status and evaluate release readiness. Optional provider estimate mirroring is out of the initial slice: Wodana remains the one client quotation approval surface. Do not ask clients to approve the same offer in two portals.

Integration mechanics: existing adapters and commercial invoice paths first; stable external-ID mappings scoped to legal entity/provider/company, durable request IDs, retry/reconciliation before duplicate creation, provider conflict/version checks, and clear pending/failed/last-synced states. Reconcile line amounts, taxes, discounts and rounding before posting. Never modify an accepted quote to conceal a provider total mismatch. Handle partial payments, credits, voids, refunds and reversals; reassess affected release readiness and alert owners without pretending already executed work can be undone. Payment links depend on provider/account setup and must not be fabricated.

Provider records can be refreshed on demand initially; add provider-supported event delivery plus periodic reconciliation only after validating each connector's capabilities. Do not assume both providers expose identical events, draft semantics, deposits or payment-link behavior. Support accounts/region-specific mapping and sandbox verification.

Source audit found QuickBooks and Zoho Books adapter capability definitions for accounting read, invoice creation, payment-link read and receipt read in `services/business-core/src/integrations/provider-capabilities.ts`, plus commercial accounting tests. Available-in-code is not proof a live tenant is connected or verified.

Official accounting references: [Zoho estimates](https://www.zoho.com/books/api/v3/estimates/), [Zoho customer payments](https://www.zoho.com/books/api/v3/customer-payments/), [Intuit accounting entity reference](https://static.developer.intuit.com/sdkdocs/qbv3doc/ippphpdevkitv3/entities/content.html). Intuit's current linked-transaction/webhook pages were JavaScript-only in this research session; exact adapter behavior requires implementation-level and sandbox verification, not assumptions from those pages.

### Delivery sequence including finance

1. Final names, navigation and Requirements working table; preserve existing records and IDs.
2. Design/specification review and shared catalog-to-quotation flow.
3. Quotation versions, responsive client review, acceptance locking and Approved BOQ.
4. Agreements/payment milestones and one chosen accounting-provider vertical slice; keep provider-neutral interfaces for the second. Verify customer mapping → invoice → partial/full payment refresh → reconciliation.
5. Change Requests, approved variations, credit/additional-invoice handling and final release checks.
6. Cross-role pilot and regression checks; native mobile remains outside this build.

Do not expose fake connected states during phases 1–3. Planning and draft work remain usable without an accounting connection; finance-dependent release clearly states what is missing. Before live rollout resolve the master document's initial-design engagement versus execution-contract gate and the entity's accounting provider. Those decisions need not block Requirements UI implementation.

### Approval hub — 22 September follow-up
Place Approvals immediately after Overview. This is the team's pre-client review queue, separate from post-acceptance owner review and production release readiness. Show one current scope package, each active design's latest revision, and active quotation versions, with type, title/version, actual status and a Review action. Review opens the existing scope, design or quotation workflow within Approvals; retain its permission checks, blockers, reviewer assignment, revision history and explicit client-send confirmation. Do not bulk-send documents, imply internal approval equals client acceptance, or create a second approval state. Requirements use definition-baselines, designs use their revision review endpoints, and quotations use the commercial review/issue endpoints. Client access remains a linked configuration screen. Portal publication and outbound notifications remain distinct. Verify navigation order, source-status rendering, routing to real review controls and responsive presentation.

### Web implementation verification checkpoint — 22 September
- Approvals is now the second Planning tab. Queue combines current scope, active design revisions and active quotation versions; superseded/withdrawn versions stay out of the current queue. Review opens existing permission-aware workflows, including scope confirmation, design review/client submission and quotation internal review/issue. Quotation preview is read-only within Approvals. Owner sign-off remains under Release readiness.
- Verified Approvals queue and scope/quotation detail navigation on localhost; checked 390px layout with no document overflow and restored desktop viewport. No client publication or external messages were sent during verification.
- Requirements: compact Inquiry Requirements sheet, checklists, table insertion and row/column controls. Live sample table increased from 3 to 4 rows using Add row, then Undo restored 3. Checked task state persisted through save/reopen.
- Live sample requirement now contains an uploaded test sketch and separately saved marked copy. Fixed the web proxy routing that incorrectly parsed JSON markup submissions as multipart file uploads. Saved/reloaded both attachments successfully; original retained. CRM-backed drawing uses its own upload adapter; adapter behaviour has a unit test, but has not yet had a live CRM image round-trip check.
- Updated obsolete workspace tests to the note-board and shared top-navigation design while retaining payload, conflict, linked-CRM, measurement and read-only checks. 48 targeted UI tests passed; 5 markup route/component tests passed (2 component tests overlap the 48). Typecheck passed before final whitespace-only note-preview change; final check rerun.
- Remaining goal work: detailed visual review of commercial forms after expanding content accordions; full connected design/specification → quotation → agreement/payment → controlled change/release verification using appropriate non-production fixtures and backend tests; compare remaining workflow requirements with master document. Do not call the whole Planning goal complete yet. Client portal implementation remains deferred.

### Connected UI correction pass — 22 September, 02:25
- Replaced the custom Approvals table with the shared DataGrid, compact toolbar, current titles/revisions and status chips. Removed explanatory footer prose, unused bulk selection and duplicate back navigation. Design detail headings now retain their intended compact size.
- Resources has one Catalog entry; removed the duplicate Materials sidebar/Home destination. Materials remain a searchable category inside Catalog, so existing material records and deep links are preserved.
- Design review defaults to Scope item, Design, Stage and Next step. Secondary metadata stays available through column selection. Verified the upload/review action fits a 1280px desktop without sideways scrolling.
- The standalone quotation builder previously bypassed both requirement import and the approval workflow. It now opens Scope & pricing, imports linked included requirements using the existing revision-protected API, saves before import/review, and opens the exact quotation in Approvals. Failed saves stay in the editor. Scope imports retain source IDs/version and existing prices. Rich-note blank table rows are normalized only in the imported description, leaving the original note untouched.
- Agreement and payment milestone forms now use shared text, numeric, calendar and checkbox components. Accepted quotation milestones lock amount and release conditions; due date/reference stay editable. The payment-plan route opens Payment schedule directly. Release checklist review buttons now open the relevant local view rather than navigate back to the same screen.
- Live sample verification: included the explicitly labelled Kitchen base cabinets (sample) note; imported it into draft quotation 628dd43a-dd6e-4d81-a450-4e59da55195c and reloaded successfully. Saved design 963a6367-cf95-4c22-b5f6-e522e167e881 from the generated test sketch, linked to that requirement, with an explicit not-approved-for-construction note. Confirmed Requirements, Design V1 and Quotation V1 all appear in Approvals and open their own review workflows. No client acceptance, external communication or financial settlement was fabricated.
- Responsive Approvals check at 390px: document scrollWidth equals viewport width, shared grid contains its own horizontal scrolling; restored desktop viewport. Design upload and draft review checked visually. Accepted agreement/payment modal behaviour is currently verified with component fixtures, not a live accepted customer contract.
- Completion still requires final commercial-state visual QC (accepted agreement, payment, controlled change and release), live CRM-backed image drawing check, and the remaining master-document gate audit. Client portal implementation and actual QuickBooks/Zoho tenant verification remain deferred/unverified. Do not mark the broader Planning goal complete from this checkpoint alone.
- Final regression for this correction pass: 39 frontend files / 222 tests passed; the later release-check navigation test and default Design-column test passed in targeted reruns. Full web typecheck passed. Backend commercial/pre-project regression passed 38 files / 286 tests before the import-format fix; the updated scope test suite passed all 5 tests after that change. Backend build succeeded and the sample API was restarted with the built code.
- Added isolated Storybook commercial-state fixtures (Agreement, Payments, Release, Changes), with no production writes. Storybook did not reach a listening port in this session; processes were stopped. These fixtures are typechecked but not yet browser-verified. Live project checks covered pre-acceptance pages only; do not conflate these with accepted-state visual sign-off.
- Found and fixed the residual off-white canvas: nested DesignSystemProvider roots reset their own canvas colour. Scoped the Planning light-theme provider background to white and confirmed computed bottom-canvas colours are all rgb(255,255,255).

### Requirements-first acceptance pass — 22 September
User narrowed the immediate work to Requirements before Designs or commercial modules. Check all five Requirements views: note capture/edit/search/archive; Measurements (linked requirement, unit, evidence, validation); Site plans (upload/open/retain original); Inspiration (rich notes, image/link references); Scope confirmation (current included scope, revision and permission gates). Check Project brief, rooms, paste import and photo markup as supporting forms. Verify saved data after reload, failed-save draft retention and read-only behavior. Keep client publication outside test actions. Hide only the Planning and Requirements navigation scrollbar; retain overflow scrolling, keyboard focus and all route links. Use white canvas, fixed note cards, shared compact controls and no content accordions.

### Requirements correction — 22 September 2026
- Removed the spreadsheet-oriented “Paste rows” action from Requirements.
- Measurements now uses one compact shared table of actual saved dimensions, with requirement, dimension, size/unit, verification status, and edit action. Unmeasured notes no longer produce placeholder rows.
- Add and edit share the same measurement fields, source/reference validation and unit behavior. Fixed required-label alignment caused by the case form label selector.
- Live desktop QC: saved 2400 mm sample measurement loads correctly in table and editor; keyboard Tab reaches measured size. Isolated 320×568 modal QC: fields fit and scroll with the action footer accessible. Full application mobile coverage remains separate from this component check.
- Focused Requirements suite: 31 tests passed; TypeScript passed. Scoped whitespace check passed. Earlier backend Requirements suite: 59 tests passed.
- An unrelated existing client-portal bookmark route assertion still fails in the broader routes suite; this correction does not claim completion of the client portal or the full Planning module.

### User correction: raw capture and simple drawings
Requirements is raw information gathering, not an internal review workflow. Removed the internal-review card labels/actions and the redundant raw-note review gate/warning in definition/readiness. Historical review fields remain stored; no automatic acceptance was recorded.
Measurements now supports a new typed item or catalog item directly, plus an existing item. Standard dimension choices are Length, Width, Height, Depth, Thickness, Diameter, Radius and Custom. Capture requires a name/type, size and unit; notes are optional. Existing estimates and stored provenance are preserved. Measurement verification is not falsely inferred. Live labelled sample “Sample wall — measurement QC” saved Width 1800 mm without evidence text and persisted after reload.
Restored drawing folders as the default and removed the extra review-table mode. File previews/comments, folder upload, metadata editing and revision upload remain reachable. Visually checked folder → file → preview → close. Next commercial plan is in quotation-workflow-next.md; it is a plan, not completed implementation.
Additional QC: live Requirements, Measurements, Site plans and Inspiration at 390 px, fixed-height note cards, keyboard access to offscreen planning tabs with hidden scrollbar, 320 px note editor checklist/table interactions, and portaled RTL dialogs. Shared dialogs now carry provider direction explicitly.
