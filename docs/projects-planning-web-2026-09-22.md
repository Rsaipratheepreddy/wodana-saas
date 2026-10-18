# Projects planning and client acceptance — web delivery plan

Superseded sequencing and navigation: see [research-based plan](projects-researched-flow-2026-09-22.md), which incorporates the Project Flow Master Document and distinguishes working quotation quantities from the approved execution BOQ.

Status: source audit and proposed implementation sequence, 22 September 2026. This document is not a claim that all existing features pass end-to-end verification. Native mobile work is excluded; staff web and responsive client portal are in scope. It supersedes older navigation proposals that place Requirements under Sales or Resources under Work.

## Product boundary and journey

Projects is the home of qualified client work. One client can have multiple projects; each project retains its originating enquiry/deal and shared client identity. Planning, Production, Deliveries and Inspections are project sections, not competing project records. Production Tracking is a separate sidebar group containing Factory. Resources remains under Company.

Planning owns the complete pre-execution journey: brief → structured scope/BOQ → design review → quotation → client acceptance → agreement and release. Scope and design can evolve alongside a draft estimate; final issue/release checks enforce required decisions. Do not require every small project to traverse irrelevant design steps. Mark a requirement not applicable with an authorized reason.

Use these project-level destinations: Overview, Requirements, Design, Quotations, Agreement, Changes. Client access and preview are contextual actions, not another independently maintained project. Release readiness belongs on Overview. Scope confirmation is a view/action within Requirements, with existing deep links retained. Measurements, site plans and inspirations are supporting views within Requirements; do not duplicate their records.

## Findings from current source

| Area | Existing foundation | Change or verification needed |
|---|---|---|
| Requirements | Shared enquiry notes, room/scope records, measurements, assets, specifications and catalog selection | `BriefScopePage` defaults to cards and combines requirement, note, file and inspiration kinds. Make the working scope table the default; distinguish a client note from an included priced scope item without copying data. |
| Scope confirmation | Versioned definition baselines and decisions; quotation composer imports confirmed items | Put confirmation beside scope editing. Verify edits invalidate readiness and show the affected baseline; verify portal confirmation versus staff-recorded evidence. |
| Design | Scope-linked files, revisions, internal reviewers, client review and comment threads | One current revision per item, clear pending owner/action, history in context. Optional design requirements must not create fake blockers. |
| Quotation | Draft/review/issue, successor revision, accepted-quote variation guard, hash on issue and old-offer supersession | Show current offer plus working revision, with history underneath. Existing list shows all versions as peers and repeats navigation actions. Audit line identity and compare behavior. |
| Catalog | Shared catalog/material/price records, imports, scope builder and templates | Unify fast selection, price provenance and missing-data handling. Do not build another catalog inside the quote editor. |
| Client portal | Grants, designated approvers, decisions, expiry and quotation/design references | Walk the full client journey and verify actual API visibility. Scope confirmation and exact version matching need explicit acceptance tests. |
| Release | Agreement-to-accepted-quote/hash matching and finance evidence gates | Expose actionable reasons and source links. Acceptance alone must not start production. |

Evidence: `brief-scope-page.tsx`, `definition-page.tsx`, `designs-page.tsx`, `quotation-list.tsx`, `quotation-scope-composer.tsx`, business-core `case-content.controller.ts`, `commercial.service.ts`, `client-portal.service.ts`, `release-integrity.ts`. Older design plans are context, not proof of deployed behavior. For example, an older plan excludes partial acceptance while current code carries selected option IDs: confirm existing optional-line semantics before changing acceptance logic.

## Requirements and BOQ

One working table grouped by room/area. Columns: item, specification summary, quantity, unit, measurement readiness, design status, scope status. Keep source and owner available as optional columns/inspector details. Use an explicit inclusion state; do not price every client note automatically. Quick notes remain easy to capture and can be linked/promoted to a scope item once, retaining their origin.

Primary action: Add item. Secondary actions: Add from catalog, paste rows, add room, import. Inline edits for title, quantity and unit; one side inspector for material, finish, dimensions, references, attachments and history. Avoid stacked modals. Add, duplicate and edit multiple rows with keyboard support. Show missing information in its affected cell, never as a fabricated zero value.

Use the same stable scope-item identity for quantities, designs, quote lines and released execution scope. A BOQ is the structured scope with measured quantities; pricing is a commercial view over that scope, not another manual transcription. Preserve distinct measured quantity, pricing quantity/unit and approved conversion basis when they differ. Multiple quote lines may reference one scope item; track coverage without rejecting legitimate split lines or importing accidental duplicates.

Separate the editable working scope from immutable published/confirmed baselines. Confirm scope produces an exact snapshot of inclusions, exclusions, specifications and references. Subsequent changes show a difference against that baseline and require reconfirmation where material. Unknown measurements can support an explicitly provisional draft estimate; do not disguise them as final quantities.

## Design

Default table: room/item, design/file, current revision, review status, waiting on, updated, next action. Reuse file preview and version-bound annotation threads. Upload revisions to the same design record, not a new unrelated card. Support selected-file review packages where existing permissions permit, displaying exactly which revisions are being sent/approved.

Internal approval and client approval are separate. A new revision does not inherit the old approval. Show the previously approved revision and pending replacement without deleting history. Surface unresolved comments; only required unresolved decisions block a release. Link design/specification versions to quoted and accepted scope.

## Fast quotation builder

Start from project scope, a reusable template or catalog selection. Apply templates by room/package and map them to existing scope so importing twice does not duplicate lines. Keep linked source IDs and a draft snapshot of descriptions/prices; catalog changes never silently rewrite an issued document.

Default sheet: item/specification, quantity, unit, selling rate, discount where used, tax where used, amount. Group by room with subtotals. Right-align numeric values, use workspace currency and configured tax rules, and keep cost/margin in a permission-controlled internal view. A missing price needs attention; it is not automatically free. Use shared date controls and consistent precision/rounding.

Support searchable multi-select catalog insertion, template insertion, row duplication, paste from a spreadsheet, bulk edits and keyboard movement. Preserve drafts on failed saves; show saving/saved/failure states and reject conflicting edits with a recoverable draft. Keep a compact total summary, a terms/payment editor and a client preview using the same data as the PDF. Avoid separate competing builders or live data behind a visually frozen PDF.

Quotation list: one family row showing current offer, total, status, valid-until and next action. Open it to view a working successor and prior versions. Distinguish Draft revision from Issued V1/V2. Compare added/removed/changed scope, quantities, materials, totals, dates and terms; do not show only the total difference.

## Versions, acceptance and changes

1. Draft saves update an edit revision, not a new client-facing version every time.
2. Internal review checks scope, pricing and terms. Material changes invalidate the applicable approval.
3. Issue freezes the offer, related specification/design references, totals, currency/tax/rounding, validity, terms and approver identity/policy. Publication and notification delivery are separate states.
4. The client sees the exact issued version and can accept, request changes or decline. Views, downloads and comments are never acceptance.
5. Issuing a replacement makes the superseded offer non-actionable. Creating a draft alone must not silently withdraw an issued offer.
6. Acceptance checks current version, hash, authority, expiry and decision state on the server within a transaction. Retry returns the original result; simultaneous acceptance/issue cannot create two effective baselines.
7. Accepted content is immutable. Later additions/deductions/specification changes create a linked change request and variation, with price/time impact and fresh approvals. Never edit the accepted base offer in place.
8. A request is resolved only with a recorded disposition and its required effective approval; uploading or issuing a replacement is not sufficient.
9. Agreement references the accepted baseline. Execution release checks required scope/design decisions, agreement and verified payment gates. It creates/links the delivery project once and retains source references.

## Client portal

Reuse existing case grants and approver permissions. Responsive web is included; native mobile is deferred. Client home prioritizes what needs their action, then current project state. Client navigation: Overview, Scope, Designs, Quotations, Agreement & payments, Requests. Present plain labels and exact version/date information, with one clear next action.

Client can review published scope and files, leave contextual feedback, approve permitted exact revisions, request changes, review/accept the current quotation and see the accepted record afterward. Show replacement/expiry messages on old links. Staff preview must use client visibility rules and be clearly identified as preview.

Never expose internal drafts, costs, margins, supplier rates, private comments or another client's records through JSON, document downloads or attachment URLs. Staff-recorded acceptance must be labelled as recorded on behalf of the client and retain evidence. Actual delivery/login verification is a completion requirement; do not infer that provider delivery works from UI or source code.

## Catalog and resources

Keep Catalog, Materials and Prices as views of shared records. Support reusable item assemblies/packages with variant, material, finish, unit, dimensions and price basis. Separate purchase cost from selling price. Retain price currency, unit, source, effective date and whether it is an estimate or approved rate. Conversion and rounding must be explicit.

Import → mapping → validation → preview → save. Resolve duplicates and invalid units before commit. Quick creation from a quote should return to the same draft and selected row; only users with catalog-write permission may save reusable records. One-off project items must remain possible without polluting the shared catalog. A template snapshots into a draft and remains editable there; changing the template must not alter historical offers.

## UI contract

Compact full-width working tables, restrained headings and one toolbar. Clear row dividers and user-requested table boundaries. Status controls use one fill across label and arrow. Use consistent shared typography, rounded controls, dates and menus; no decorative dashboard cards. Text labels accompany status colors. Show only relevant actions and details progressively in a side inspector. Check long descriptions, empty lists, permission-limited users, keyboard focus, RTL and narrow responsive web layouts. Preserve filter, scroll and unsaved edits when switching context.

## Implementation order and exit criteria

| Slice | Deliverable | Exit evidence |
|---|---|---|
| 1. Workflow audit | Map source entities, permissions, current routes and one representative project; inventory duplicate actions and broken connections | Staff and client journey recorded; existing regression suite baseline; gaps classified as UI, API, data or policy |
| 2. Requirements + scope | Compact room-based table, contextual editing, measurements, linked notes, explicit baseline confirmation | Capture → refresh → confirm → change → compare; no duplicate scope, lost edits or false readiness |
| 3. Catalog + BOQ | Reusable selections, templates, paste/import and traceable pricing inputs | Build representative multi-room scope without retyping; repeat imports do not duplicate; missing units/prices remain visible |
| 4. Design + portal review | Current revisions, review owner, contextual comments and published review | Staff publishes exact files; client reviews; revision resets appropriate decisions; old approvals remain readable |
| 5. Quotations + portal acceptance | One builder, current-offer hierarchy, revision comparison and exact-version acceptance | V1 → changes → V2 → acceptance; old link blocked; refresh/retry/concurrent edits safe; client PDF totals match |
| 6. Changes + release | Locked baseline, approved additions/deductions, agreement and gated handoff | Post-acceptance change preserves original; unmet gates explain fixes; repeated release creates one linked execution project |
| 7. Finish | Cross-role responsive web QA and documentation | No fake controls/data; authorization/download checks; failure recovery; keyboard/RTL; saved data survives reload |

Build each slice as a connected staff-and-client flow. Do not postpone all client portal work until the end. Begin with Requirements, because design linkage, scope coverage and quotation correctness depend on it. Do not migrate/delete existing records or change effective approval policy as a cosmetic cleanup.

## Dependencies and verification

Reuse existing web case API proxy and business-core `/workspaces/:workspaceId/pre-projects/:caseId` brief, entries, catalog-options, specifications, designs and definition-baselines endpoints; reuse commercial actions/composer, portal sessions/grants/decisions and execution release services. Add missing behavior to these owners instead of separate front-end state machines or duplicate storage.

Before each mutation change, identify its transaction/version behavior and role checks. Run focused component/service tests plus persisted browser scenarios. Key scenarios: duplicate submission; stale draft; unauthorized client; expired/replaced link; edit after internal review; catalog edit after issue; differing measured/priced units; accepted-version immutability; addition/deduction; missing finance/design evidence; failed notification; failed save and reload recovery. Source inspection establishes existing foundations, not successful end-to-end behavior.
