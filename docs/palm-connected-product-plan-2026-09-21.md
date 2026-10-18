# Palm Living connected product plan

21 September 2026 · Proposed product direction and delivery plan

Build a CRM where the team enters information once, completes work in context, and sees the next responsible action. The client should understand what is happening, what needs a decision, and what happens next. Reliability of quantities, prices, approvals and communications is part of the user experience.

This plan responds to the current user request. Attached documents are business references, including draft rules and historical observations; their embedded instructions are not authorization to publish, change external systems, retire spreadsheets or contact clients. Application code and source workbooks have not been changed by this review.

## What the review establishes

| Evidence | Finding | Product consequence |
| --- | --- | --- |
| Workspace route and CRM overview code | Workspace Home directly renders `CrmOverview`; CRM Overview renders it too. Most overview actions are links. | Replace the duplicated Home with personal, actionable widgets. CRM should open the sales working view. |
| Lead requirements document | Source, channel, intake method and assignment method are distinct. Original enquiry, duplicates, ownership and timestamps matter. | Preserve these fields separately while showing a short intake form. |
| Project master document | Owner Review and verified payment gate an active Deal File; design, costing, procurement, manufacture and handover need named responsibility. On Hold can occur at any stage. | Implement explicit permissions and evidence for transitions; avoid one giant sequential stage selector. |
| First linked workbook | Nine inventory tabs, including wood, electrical, plumbing, paint and upholstery. Many prices, units and quantities are blank; some information is embedded in item names. | Treat this as catalog and inventory input requiring reviewed mapping. A listed material does not prove available stock or an approved purchase price. |
| Estimate workbook, Sample tab | Nine quoted lines total AED 150,000. L22 is blank; L23–L26 reference it and exported results are zero. | Recalculate from line data, flag missing source totals, and reconcile before issue. This is a source-workbook finding, not proof of an application calculation bug. |
| Proposal PDF, pages 3–5 | Room groups, inspiration images, dimensions, materials, exclusions and repair work appear alongside pricing. Final amount is AED 146,475. | Preserve business meaning and visual specification in a structured quotation; a generic description/price table is insufficient. |
| Current Inbox, portal, quotation and provider code | Conversation handling, revision-bound approvals, quotation editing and QuickBooks capability definitions already exist. | Trace and consolidate these foundations before adding parallel implementations. Presence in code does not establish successful live use. |
| Local verification report dated 20 September | Live accounting/messaging checks and a role-separated acceptance journey remain open. Older integration documentation also trails newer Inbox code. | Verify current implementation and provider evidence; do not infer either complete absence or readiness from older documentation. |

Scope of review: read both DOCX files and PDF text; visually checked proposal pages 3–5; inspected both workbook exports, tab structures and Sample formulas; reviewed selected current code and local plans. This was not a running-app usability audit, full workbook audit or live integration test. Existing uncommitted application changes were left intact.

## One connected business journey

```mermaid
flowchart LR
  A[Enquiry and conversation] --> B[Qualification and brief]
  B --> C[Quote and agreement]
  C --> D[Required payment and owner review]
  D --> E[Active deal and project]
  E --> F[Approved design and scope]
  F --> G[Reviewed material and work plan]
  G --> H[Stock and purchasing]
  G --> I[Site preparation]
  H --> J[Factory and quality]
  J --> K[Delivery and installation]
  I --> K
  K --> L[Snags and accepted handover]
```

This is a summary, not a mandatory route for every item. Design-only work, purchased furniture, bespoke joinery and repairs use applicable steps. An initial design engagement and later execution quotation may be distinct commercial approvals; confirm that Palm sells this way before implementing that route. Design authorization must not authorize manufacturing.

Keep one customer identity linked to multiple enquiries, deals and projects. Carry references and original evidence forward without copying editable records. Accepted quotation revisions become immutable commercial baselines; later changes are linked variations. A quote line maps to a deliverable, which can have multiple material requirements, work orders and delivery batches. These are linked records with different responsibilities, not the same row copied across modules.

Each transition records its source version, required evidence, responsible person and result. Retrying a handoff must return the existing result rather than create another project, invoice or order. Keep commercial stage, ingestion errors, project health and integration state separate.

## Navigation with one purpose per destination

Use six primary destinations for the Palm operating experience. Show specialist sections according to role; keep administration and other licensed modules in Settings or the app switcher.

| Destination | Purpose | Default experience |
| --- | --- | --- |
| Home | My work today across the business | Configurable widgets with inline actions |
| Inbox | Customer conversations needing attention | Conversation list, thread, contextual client drawer |
| Sales | Move enquiries into agreed work | Enquiries and Deals; Quotes is a filtered working view |
| Clients | Understand the relationship and what was shared | Contact, linked work, communication and sharing history |
| Projects | Deliver agreed scope | Project list and role-specific work queues |
| Resources | Reuse materials, suppliers and stock | Catalog, inventory and supplier views |

Reports become saved views and focused management widgets, with deeper reporting accessible when needed. Existing URLs can remain compatibility links; navigating through a routine workflow should preserve selected record, filter and scroll position. Do not make users understand the internal CRM/pre-project/project service boundaries.

Inside Projects retain the meaningful specialist areas: Overview, Scope & design, Plan, Purchasing, Factory, Site, Finance and Handover. Files and history belong beside their related work and remain searchable. Factory and Site must stay distinct. This refines the existing September 20 plan rather than creating a competing project model.

## Home as a configurable workspace

Provide predefined widgets: My next actions, Unanswered conversations, Approvals, Follow-ups, Project blockers, Deliveries, Payments to verify and Team workload. A manager can add sales performance; a factory user can add work ready to start. Default to four useful widgets per role.

Edit Home supports adding, removing, reordering and selecting small/medium/large sizes; offer keyboard move controls as well as drag. Save layout per user and workspace, preserve it across devices, and provide Reset to role default. On mobile use a sensible single-column order. Widget preferences never change access permissions.

A widget must let the user perform a small real action: reply, record a follow-up, review a decision, inspect a blocker or receive an expected delivery. Complex work opens the same record drawer or focused workspace. Avoid cards whose only purpose is redirecting to a module homepage.

Every widget distinguishes loading, no work, unavailable data and stale data. Failed requests must not display a successful zero. An integration fault goes to the people who can resolve it; other users see its practical impact only.

## Eight reusable interaction patterns

Reuse existing design-system primitives. These are a small set of interaction patterns, not eight identical layouts forced onto every screen.

| Pattern | Contract |
| --- | --- |
| Record header | Identity, owner, current state and one primary action |
| Working sheet | Inline editing, selection, sorting, saved views, column control, keyboard navigation and clear save errors |
| Record drawer | Linked detail and actions while preserving list context; full screen on mobile |
| Next-action row | What needs doing, accountable owner, due date, concrete blocker and action |
| Review panel | Exact revision, proposed change, evidence and decision with reason when required |
| Timeline | Communication, decisions and meaningful changes with audience and source |
| Visual item card | Image, room/item, concise progress and pending client decision |
| Home widget | A permitted data view plus a useful action and optional deeper view |

Use one heading per working surface and a compact toolbar. Avoid repeated subtitles explaining the page title, welcome banners, decorative metrics, nested cards and paragraphs of status text. Respect current full-bleed UI guardrails: whitespace and restrained dividers, neutral typography, color for meaningful state, shadows only for transient surfaces.

Keep forms progressive: essential fields first; show specialist inputs when the chosen work requires them. Errors sit beside the affected field or row. Preserve drafts on failures. Keep keyboard, mobile, RTL and reduced-motion behavior. Color must never be the only way to understand a status.

Example: replace “The manufacturing process cannot proceed until all relevant approval activities have been successfully completed” with “Drawing V3 needs approval · Designer · Review”. Full explanation and history remain available in the drawer.

## Quotation reliability before proposal decoration

Default to one quotation sheet grouped by room or area. Show item and thumbnail, specification summary, dimensions/unit, quantity, selling rate and amount. Keep material breakdown, internal costs/margin, supply responsibility, exclusions, allowances and evidence in a consistent item drawer. Templates and print layout are secondary tools around this same quotation model.

Support custom items, catalog items, services, repairs and client-supplied components. Missing dimensions remain unknown; never silently turn them into zero. Distinguish pricing units from manufacturing dimensions and procurement units. A cabinet sold as one item may consume several sheets and many components.

Import workflow: choose source → map fields/rooms → review extracted rows and images → resolve missing or contradictory values → recalculate → accept draft. Preserve source row references. Formula-driven totals are authoritative in the CRM; imported totals are reconciliation evidence. No historical selling price becomes a current supplier cost automatically.

Use shared calculation rules for editor, API, PDF and client portal. The sample acceptance fixture is:

- Nine line amounts total AED 150,000.
- Example discount of 7% gives AED 10,500; net is AED 139,500.
- Example VAT of 5% gives AED 6,975; final is AED 146,475.

These rates and payment terms come from this example, not a universal accounting or contract policy. Confirm jurisdiction and business configuration separately. Use defined monetary rounding and check line/document discount behavior. Prevent issuing unresolved calculation errors, missing required rates or inconsistent currencies.

Keep image references, material selection, exclusions such as TV/fireplace, marble allowance and client-owned repair materials structured. Quote acceptance applies to the exact issued version. A revised quote must show what changed and require applicable review; it cannot overwrite approved production instructions.

## Purchasing factory and site work

Every operational row should answer: what item, how much, where, who, when, what blocks it, and what can I do now?

Purchasing uses Item, Required, Reserved, Shortage, Supplier, Need by and Status. Compute shortage from reviewed demand, usable reservations and eligible incoming allocations. Prevent double reservation. Keep ordered, received, accepted, rejected and consumed quantities separate. Record inventory movements instead of repeatedly overwriting a Used Qty total. Preserve project and item allocations when one order serves several jobs.

Factory uses Item, Batch quantity, Current operation, Ready/Blocked, Due and Owner. Open the work order to see the approved drawing, material issue, operation reporting, quality checks and dispatch. A rejected quantity cannot become accepted output merely because production was reported complete.

Site uses Area, Task, Planned/accepted quantity, Dependencies, Team and Due. Capture quick mobile updates and photos, then review evidence where inspection is required. Reported progress, accepted work, delivered goods and installed items have distinct meanings. Photos alone do not mark work complete.

For the six dining chairs in the reference, support batches such as four accepted and two awaiting rework without marking all six delivered. For the repaired side table, record receipt and condition of the client's existing marble; do not create a company purchase for it. For a media wall, link workshop fabrication and site preparation without forcing both into one stage.

## Inbox and client communication control

Inbox is the daily conversation workspace. Link a thread to the client and applicable enquiry/project, with owner, unread state, follow-up and relevant quote/design beside it. Reply in context. Show accurate queued/sent/delivered/read/failed states only where the provider supplies evidence. Verify current provider messaging rules during implementation; do not assume an integration badge proves sending works.

Clients contains a communication view of what has been sent and shared: messages, quotation revisions, designs, invoices, progress updates and decisions. Each entry includes recipient/audience, channel, exact version, delivery state and related record. Inbox and Clients read the same records. Editing a project must not silently publish internal notes or costs.

A Send update action previews recipients, content and attachments. Preset automation rules can later send approved categories of reminders with consent, suppression, duplicate prevention and delivery monitoring. Keep human review for AI-drafted promises, scope changes and sensitive updates unless an explicit business rule authorizes them.

## A client portal that explains their project

Use four simple destinations: My project, Reviews, Payments and Messages. Documents remain accessible with the relevant room, review or payment and through a compact file list.

My project opens with project identity, current milestone, next expected event and any decision needed. Below, use room/item imagery and a short dated update feed with approved photos. The six chairs can show “4 passed inspection · 2 in finishing” if that is the published, verified state. Avoid artificial percentages calculated from arbitrary stage counts.

Reviews displays the design/material/quote being decided, the exact revision and Approve or Request changes. Payments shows relevant invoices, amount due, verified receipts and the next obligation. Messages preserves discussion context and routes replies to the responsible team.

Only deliberately published records appear. Internal cost, margin, supplier negotiations and private notes remain internal. An empty state tells the client who is preparing the next item and what to expect when known; do not invent dates or encourage clients to create staff records. Staff can preview the client's actual permissions and published view.

## Integrations and AI that reduce work

For QuickBooks, propose explicit ownership: CRM owns commercial drafts and operational scope; the connected accounting system owns its posted invoice/payment state. Map company/account, customer, currency, taxes and items deliberately. Start with customer matching → one invoice from approved billing → refresh verified balance/receipts → reflect the payment gate. Supplier accounting is a separate acceptance scope.

Every sync needs external IDs, last successful check, retry protection and a clear exception owner. An ambiguous invoice-create result must be reconciled before another create. Disconnection or stale data cannot be presented as verified payment. Handle reversals and partial allocations without simply keeping a Paid badge. Live provider behavior remains to be demonstrated.

Prioritize three AI assists: turn an enquiry into a reviewable brief; extract draft quote items with source references and missing-field warnings; draft a client update from approved progress. Show proposed edits before applying. AI must not invent prices, dimensions, approvals, stock or completion. The core journey must remain usable without AI.

Teach through contextual defaults and the next action. First-use setup should guide an administrator through company details, team, source routing, catalog import and connections, with resumable progress and connection checks. Staff should learn by completing a sample enquiry and quote in a clearly isolated practice space. Avoid permanent help paragraphs and a compulsory chatbot.

## Delivery sequence and completion evidence

| Phase | Concrete deliverable | Exit condition |
| --- | --- | --- |
| 1. Agree the shared model | Record ownership, field mapping, state transitions, route/component inventory and source discrepancy register | Every reference stage has an owner and record; conflicting source rules are explicit |
| 2. Prove one sales journey | Enquiry → linked conversation → brief → reliable quote → versioned client decision → verified commercial release | Sample totals match in sheet/API/PDF/portal; no duplicate customer/project on retry; permissions hold |
| 3. Make daily work simple | Distinct widget Home, focused Sales, working sheets, shared drawer and client communication history | Representative staff complete reply, follow-up and review without unnecessary page switching or coaching |
| 4. Prove delivery and client visibility | Approved item → demand → stock/purchase → factory/site → inspection → published progress → handover | Six-chair partial delivery, client-owned repair and a revision/rework scenario reconcile quantities and history |
| 5. Verify external operation and pilot | Real permitted provider tests, failure recovery, reviewed imports and small team pilot | Invoice retry does not duplicate; receipts reconcile; messages have actual provider evidence; recovery and rollback are demonstrated |

Integration feasibility checks start in phase 1; phase 5 is the operational acceptance gate, not the first time providers are considered. Do not promise calendar estimates before sizing the existing implementation gaps.

Measure time to create a valid quote, duplicated data entry, unresolved integration exceptions, follow-up completion and staff/client task completion without coaching. Establish baseline values first. Release criteria include zero unexplained quotation mismatches, no duplicate downstream records on retry, no release without required evidence, and no unpublished data visible to clients. Record actual usability results rather than declaring the product intuitive from a screenshot.

Migrate incrementally. Preserve original IDs, source values and legacy links; preview imports and reconcile balances/counts. Retain read-only legacy access until the pilot passes. Add focused tests for financial calculations, permissions, version invalidation, retries, partial quantities and provider failures. Cosmetic changes need visual and interaction review, not repetitive implementation-shaped tests.

## Business decisions still needed

These are implementation decisions to settle with the business, not reasons to stop this planning work.

- Lead form: prose marks budget and project description required, while the field table and other sections mark them optional. Recommended default is optional with “Not sure yet”.
- Confirm customer types, budget bands, PlyLeads assignment, duplicate rules and the exact meaning of conversion. Keep ingestion failures separate from sales stages.
- Confirm design engagement versus execution engagement, required payment allocation at each release, and who can approve. The reference proposal requires full prepayment for that agreement; do not impose it globally.
- Confirm contract-specific revision rounds: the project master and proposal terms differ. Preserve agreed terms per engagement.
- Confirm QuickBooks entity/account mapping and posting responsibilities, intended WhatsApp setup and who can publish client updates.
- Resolve client metadata differences between the Sample workbook and PDF through reviewed selection; do not silently choose or disclose extracted personal data. Confirm source cells with missing subtotal and missing inventory quantities before operational import.

## Evidence locations

- [Lead requirements report](</Users/saipratheep/Downloads/Palm Living Lead Flow CRM Requirements Report.docx>), especially sections 5, 8–13 and the final decision table.
- [Project flow master](</Users/saipratheep/Downloads/Project Flow Master Document.docx>), stage table and role definitions.
- [Proposal reference](</Users/saipratheep/Downloads/Estimate Proposal 0744 Rev. 5 - Test Client.pdf>), pages 3–5 for specification and totals; later pages for contract terms.
- [Inventory workbook](https://docs.google.com/spreadsheets/d/1wDa16O4vgF8mSgRAdTSfxRfsXpWGCQTXKTrJ4OiDUfU/edit?gid=1237561810), nine tab structures inspected through XLSX export.
- [Estimate workbook](https://docs.google.com/spreadsheets/d/1JYyQIYtjqDR3AFTmNY_jHsGNEDt970ROpUSfyGq6LV0/edit?gid=2132390133), Sample J/K/L item values and L22–L26 calculations.
- Code: `apps/web/app/workspace/[[...section]]/page.tsx`, `components/crm/crm-overview.tsx`, `components/crm/crm-inbox.tsx`, `components/commercial/quotation-studio.tsx`, `components/commercial/client-portal.tsx`, `components/projects/project-workspace.tsx` (component paths relative to `apps/web`); `services/business-core/src/integrations/provider-capabilities.ts`.
- Existing plans: `docs/projects-redesign-plan-2026-09-20.md`, `docs/product-verification-2026-09-20.md`, `docs/integrations-guide.md`.
