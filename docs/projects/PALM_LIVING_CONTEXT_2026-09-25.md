# Palm Living × Wodana — consolidated project context

**As of:** 25 September 2026  
**Purpose:** One handoff brief for product, design, engineering, QA and Palm Living UAT.  
**Status:** Working context, **not** a production-readiness certificate, signed BRD, or transcript of a private client call.

## 1. How to read this brief

This file consolidates the requests in the current Wodana conversation, the Palm Living feedback tracker, the 24 September client-confirmed commercial flow, the lead-flow draft, the project BRD, the catalog workbook, and relevant repository plans. No verbatim recording of the latest Cece conversation was provided. Therefore, “client-confirmed” below means the written [24 September flow contract](../qa-projects/palm-flow-v2-acceptance.md) or a specific Palm feedback-tracker item; it does **not** imply that Cece has accepted the current software.

Evidence and precedence:

1. **Confirmed Palm flow:** the 24 September commercial-to-project contract governs quote rounds, project creation and applicable routes. Later explicit user decisions in this chat govern the requested product direction.
2. **Palm feedback to resolve:** PLM-001–024 in the Cece-raised tracker are client requests/questions. The tracker copy marks **all 24 Open** and reserves “PLM Verified” for Palm after testing.
3. **Drafts and proposals:** the lead-flow report, BRD, blueprint, design references and implementation plans add detail but are not automatic client sign-off. Older notes that conflict with the confirmed flow are superseded for Palm.
4. **Implementation evidence:** local code/tests or a synthetic journey can establish local behavior. They do not establish tenant configuration, deployment, external-provider delivery, Palm UAT, or production acceptance.

The goal is a configurable Wodana product with Palm Living as its first design-and-build tenant—not a collection of Palm-specific hard-coded screens.

## 2. What Palm Living and this conversation are asking for

Palm needs a connected operating flow from enquiry through commercial approval, design and scope, purchasing, production/site execution, client handover and aftercare. Staff must see the source record, current state, responsible person, next action and blocker without reopening every project. Client-facing information must be a controlled, revision-bound subset of internal information. One client, room, item, quote decision or receipt should not be re-entered because work moved to another module.

The user has repeatedly asked for a **production-quality, minimal, table-first product**: small and verifiable slices in dependency order; reusable atomic components and tokens; real connected records; clear roles and permissions; no dummy activity or invented rates; careful happy and denial paths; and a Monday Palm onboarding target that does not excuse incomplete flows. “Zero bugs” is the quality goal, not a claim that a test suite can guarantee it.

The draft late-night message requested for Cece said the team was considering the finalized discussion/flow, had invested **60+ hours in customization**, needed more time rather than showing the same incomplete flow, and would update the timing if it closed sooner. This was a **requested message draft**, not evidence that it was sent, that hours were independently audited, or that Palm agreed to a revised date.

## 3. End-to-end operating model

```text
Lead/enquiry → qualified opportunity → exact service route and requirements
  → applicable quote round: Sales Admin → QS → issued revision → client
  → linked agreement and Finance-verified payment → Owner/Admin approval
  → exactly one Deal File + Project Ref + project at the first paid/approved round
  → applicable design/scope and any later main quote round on that same project
  → client material-list sign-off → procurement/stock → factory/site work
  → installation → snag resolution → client handover → final account/aftercare
```

**On Hold** is independent of the stage: it stops advancement while preserving the selected route, stage and evidence. Every skipped stage needs a recorded, applicable-route reason; skipping a stage cannot bypass a required approval. The CRM owns the pre-project commercial record until the first applicable agreement is paid and approved. A later quote or payment round attaches to the **same** Deal File and project. A repeat command must not create duplicates.

### Service routes confirmed in the 24 September contract

| Route | Before the project | First project stage | Later work |
| --- | --- | --- | --- |
| Design plus fit-out/furniture | Requirements → design quote → QS estimate review → client acceptance → agreement → Finance-verified first payment **at least AED 15,000** → Owner/Admin approval | Site visit and confirmed design scope, then Design & Specifications | Separately reviewed main quote, client acceptance, second agreement/payment/Owner approval on the same project; material-list sign-off; applicable delivery |
| Moodboards/design only | Same applicable design quote and first paid approval | Site visit and design scope, then Design & Specifications | Accepted design deliverables → complete. No invented main quote, procurement or delivery stages |
| Furniture only, no design | Requirements → main quote → QS → client → agreement/payment → Owner/Admin approval | Material List Sign Off | Procurement and only the applicable manufacturing, site, installation, snag and handover steps |
| Ready-made furniture | Furniture route with the item explicitly identified as ready-made | Material/list and purchasing route as applicable | **No** Manufacturing Readiness or Factory Production merely to fill a template |

For applicable physical delivery the high-level order is **Material List Sign Off → Procurement → Manufacturing Readiness → Factory Production → Site Works → Installation → Snagging → Client Handover**. Actual work packages may overlap when their *own* prerequisites allow it; the stage label is not permission to start unready work. The ID/account manager schedules material selection only after the applicable approval/payment, and the client signs the resulting material list before procurement. A possible Founder/Creative Director (Karen) sourcing approval is a **future extension**, not a current blocker.

The design quote is a package/inspiration proposal **before** detailed design. AED 15,000 is the minimum first verified release payment on the design route, not every design fee. The example AED 90,000/100%-upfront design proposal and example main-proposal prices/terms are reference-document content, **not** global defaults. A site visit records confirmed scope and flags fee changes for controlled commercial review before detailed design proceeds.

### Commercial gates and separation of duties

| Decision | Source and rule | Actor |
| --- | --- | --- |
| Prepare quote | Requirements, selected scope, catalog/manual lines, internal cost and terms | Sales Admin/account manager |
| Approve estimate for issue | QS decision bound to that exact quote revision; a later edit invalidates stale review | Quantity Surveyor |
| Accept proposal | Client decision bound to the **issued** revision/hash and retained as evidence | Client |
| Verify money | Receipt/payment proof and amount tied to the correct agreement/round; design first release enforces AED 15,000 floor | Finance |
| Approve Deal/release | Distinct from Finance verification and quote preparation; decision stored with actor and reason | Owner/Admin or the configured Operations approver |
| Start procurement | Approved commercial route plus explicit client material-list decision | Authorized project/procurement actor |
| Start manufacturing | Released BOQ/technical scope, required production payment, plan, materials, capacity and quality readiness for the applicable package | Authorized operations/factory actors |
| Complete | Independently verified snag/quality evidence, frozen handover pack, client acceptance and applicable final-account closure | Named internal reviewers and client |

The Cece tracker requests **Enquiry → Opportunity → Won → Deal Submission → Finance check → Operations approval → Production**, with enquiry/opportunity/deal cross-links, provisional split commissions (1–3 lines), payment proof, and independent Finance/Ops decisions. The later user decision recorded in the [CRM closure audit](../palm-crm-closure-audit-20260924.md) is that **every** Deal File, including showroom furniture, comes from a **Won opportunity**; this supersedes the tracker’s proposed direct-from-enquiry furniture exception (PLM-008). “Won” is one Sales outcome, not proof of cleared funds or production release. Whether completion/full payment becomes a separate KPI remains PLM-009 **open**; never count one opportunity as two wins by default.

## 4. CRM, lead intake and Sales

The [Palm lead-flow report](#source-register) is a **draft** but gives useful structure: keep **lead source**, **channel**, **intake method** (form/manual/automated) and **assignment method** separate. Preserve original enquiry/message, created/last-updated time, owner/team, activity and duplicate links. Distinguish walk-in QR submission from staff-entered walk-in even though both are walk-ins. Manual self-generated enquiries can have a named salesperson; controlled company forms can enter the Sales queue. A selected channel is **not** proof of a live Meta/PlyLeads/WhatsApp connector.

Current lead-flow draft enquiry choices are Renovation/Fit-Out, Full Fit-Out, Interior Design, Interior Design + Furniture, Furniture Only, Concepts/Early Ideas, Architecture/ODG and Not Sure Yet. The feedback tracker permits a temporary TBC/uncertain intake but requires Sales to replace it before qualification/conversion. Final taxonomy, customer types, budget bands, form copy and attribution rules require Palm approval. The draft contradicts itself on whether budget and project description are required; do not hard-code those fields as mandatory until resolved.

PLM-001–024 also cover Pipeline/New Opportunity labels, conversion, required enquiry type, mandatory Emirate/optional Area, country-code-aware phone validation, WhatsApp link normalization, read-only enquiry reference, generated title, internal-note privacy, and demo coordination. Palm’s tracker still marks them Open even where local code exists; see [status below](#9-current-implementation-and-release-truth).

Cece tracker index (all statuses in the supplied tracker copy: **Open**):

| IDs | Requested outcome / unresolved question |
| --- | --- |
| PLM-001–002 | Rename Deals to Pipeline and New enquiry stage to New Opportunity, including related navigation/report labels. |
| PLM-003–004 | Won opportunity before Deal File; Deal Submission → Finance check → separate approval before production. |
| PLM-005–007 | Convert enquiry to opportunity; require Enquiry Type on intake; replace TBC before qualification. |
| PLM-008 | Original furniture-only direct Create Deal exception; **superseded** by later decision that all Deal Files start from Won opportunities. Palm should confirm this override. |
| PLM-009 | Define whether a later completion/full-payment measure is a distinct KPI rather than a second Won count. |
| PLM-010–011 | Fresh configured demo link and a confirmed meeting time; not resolvable from code alone. |
| PLM-012–014 | Deal submission linked to Enquiry Ref/opportunity; 1–3 provisional commission lines; payment proof. |
| PLM-015–016 | Finance verifies receipt and final commission or returns with reason; separate Operations/System Admin decision authorizes release. |
| PLM-017–018 | Mandatory Emirate and optional Area tied to Emirate. |
| PLM-019–021 | Phone country code and validation; working WhatsApp action for normalized numbers. |
| PLM-022–023 | Locked, generated Enquiry Reference and generated human-readable Enquiry Title. |
| PLM-024 | Decide who can read internal enquiry notes, including staff/support boundary and client exclusion. |

Palm operational configuration in the [product blueprint](../WODANA_PRODUCT_BLUEPRINT.md) specifies Monday–Friday 08:00–18:00 **Asia/Dubai** office hours, weekend Sales notifications, and a 60-elapsed-minute ownership takeover when neither call nor note is logged. An internal note may stop takeover but is **not** a verified client response; first-response SLA is separate. The weekend duty roster and exact SLA target still need tenant configuration/confirmation.

## 5. Roles, visibility and communication

Role names are configurable; the actions and separation boundaries are the important contract.

| Role/surface | Primary work | Must not be conflated with |
| --- | --- | --- |
| Client | Submit enquiry/requirements; review exact published quote/design/material revision; approve or reject; receive approved updates; accept handover | Staff notes, purchase cost, margins, supplier negotiation, internal risk |
| Sales/Account Manager | Intake, qualification, requirements, quote preparation, client follow-up, Deal submission and material-selection scheduling | QS estimate approval, Finance verification, Owner release |
| Sales Admin | Build and issue controlled quote after QS review | Self-certifying the estimate or changing an accepted revision silently |
| Quantity Surveyor | Estimate review, quantity/cost checks and revision-bound approval | Issuing/accepting the client proposal or verifying payment |
| Finance reviewer | Check receipt and proof, final commission amounts, return missing submissions | Final Deal approval or fabrication release alone |
| Owner/Admin or Operations approver | Independent commercial/release decision after Finance | The Sales submitter or Finance reviewer on the same decision |
| Design/technical lead | Scope, drawings, revisions, technical/finish reviews | Treating moodboard approval as fabrication-drawing approval |
| PM/planner | Package plan, owners, dates, dependencies, capacity, progress, change impact, client-safe publication | Replacing source approvals with a completed task checkbox |
| Buyer/store/receiver | Cross-project demand, offers, orders, delivery, stock, reservations and inspection | Self-approving orders or treating pending/rejected stock as available |
| Factory/QC/site | Released work, measured output, dispatch/receipt, independent quality, daily reports, snags | Starting against stale BOQ or counting unaccepted quantities |

The client portal is a separate, permissioned surface. A proposed communication chain is **versioned source decision → authorized internal review → client-safe publication → client response linked back to source**. Staff mobile should support fast field evidence/actions, not expose full administrative configuration. Messages, reminders and AI drafts need delivery receipts and an audit trail; an integration marked “connected” is not evidence that an actual notification arrived.

The [client Q&A draft](#source-register) describes intended user invites, seats, MFA, export, UAE-region storage, encryption, backups and support boundaries. These answers are **not independently verified production controls or signed contract terms**. Several commercial/legal questions have blank answers (licence, support cost/scope, user pricing, liability, arbitration, insurance, renewal); resolve with the responsible business/legal owner before making client commitments.

## 6. Product modules and navigation

The sidebar direction explicitly requested in this chat is compact, direct and grouped as follows. Names and icons are UI proposals until reviewed in the running product; permissions hide or disable unavailable actions with a reason.

| Group | Direct destinations | What the user should find |
| --- | --- | --- |
| Daily work | Home, Inbox, Tasks, Calendar, Approvals | Owned actions, communications, commitments and real decisions |
| Business | Sales, Clients, Projects | Enquiries/pipeline, customer graph, released project context |
| Operations | Purchasing, Inventory, Factory | Cross-project ordering, stock/receipts, production queues |
| Company | People, Catalog, Connections, Settings | Roles, independent catalogs, integrations, tenant rules |

**Catalog is a direct sidebar destination**, not a “Resources → Catalog” submenu. Avoid a large redundant page heading repeating the sidebar label. Purchasing/Inventory/Factory should feel like operational tables with clear next actions, not three disconnected dashboards. The older blueprint’s seven-item global nav and older ten-tab Project plans are historical proposals; this chat’s requested sidebar is the current design direction, subject to product validation.

### Catalog and the supplied workbook

- Support **any number of separate catalogs** per workspace. Do not mix the generic/default room-builder catalog with **Palm Living Core Collection**. A catalog owns groups and typed records; display group names are organizational, not business logic or stable identifiers.
- Maintain Room → Item → Variant and explicit Materials, Brands, Units, compositions/BoM, media, prices and provenance. Snapshot record/revision/specification when used by an accepted quote or released BOQ; later catalog edits cannot rewrite history.
- The user supplied [`room_builder_catalog.xlsx`](../../../room_builder_catalog.xlsx) as the requested default seed/reference. It is byte-identical to the Downloads copy checked on 25 September. The workbook has **24 sheets**: one index and 23 data sheets with **7,392 source rows**, including rooms, items, materials, BoM components and pricing tiers. It describes an **INR-priced generic interior catalog**; its amounts are **not Palm AED rates**, verified supplier costs, or approved quote prices.
- The existing [catalog foundation](../catalog-foundation.md) documents a **local “Room Builder Test” import**, not a Palm production default rollout. Imported amounts were flagged “needs review.” The [catalog adoption review](../catalog-adoption-review.md) describes source fingerprints, candidate price modes and media; that slice explicitly says it did not import the reviewed workbook. The final seed must preserve provenance, review status, units, brands, pack contents and catalog isolation.
- A separate `Palm Living Core Collection.xlsx` is present in Downloads and should be reviewed/imported as a separate tenant catalog, not silently merged with the generic default.
- The requested UX is a compact, enclosed, Dzylo-inspired catalog/data table with search, controlled filters/sort/columns, accurate row actions, import review, archived visibility and clean empty/error states. Dzylo is **inspiration**, not authority to copy its data or bypass Palm gates.

### Quotation builder and AI

Start from one accepted requirement/room/item tree and support an explicit **design** and/or **main** quote round according to the route. Room/items, quantities, units, variants, material finishes, internal costing, sell price, exclusions, validity and revision diff must be inspectable. Distinguish “price unavailable” from zero; no fabricated catalog price. The client receives only approved sell-side information, never internal cost/margin.

AI may help extract source-linked requirements, propose item/BOQ lines, highlight missing quantities/prices/exclusions, explain a revision, and prepare a preview. Every suggestion needs provenance, uncertainty and human accept/edit/reject. AI must **not** invent rates, certify QS quantities, approve a quote, send it, record payment, release work or publish to the client. Deterministic server calculations and the named QS/Finance/Owner decisions remain authoritative.

### Projects, planning and tasks

The confirmed Palm flow creates the actual Deal File/Project Ref/project at the **first paid, Owner-approved applicable round**. Older [projects operating research](../projects-operating-flow.md) suggests a Planning project before commercial release; that is **superseded for Palm**. Staff may prepare draft planning in the CRM/case before the gate, but it must not appear as a released project or imply a signed contract.

After release, the project should reuse existing case/requirements/designs/quotes; it must not create a second copy of those records. A package is a defined piece of scope (for example, a wardrobe); tasks are activities within it (survey, fabricate, dispatch, install). Track **work location**, **performer**, and **material supply responsibility** separately. Planning should expose quantities, owners, teams, dependencies, dates, capacity conflicts, required drawings, material demand and the effect of revisions. A project needs a single readable overview, source-linked sections, next action and reasoned blocker—not duplicated tab hierarchies or static “things to do.”

Tasks are important but **downstream** of correct catalog, quote, project and package identities. A useful task has one owner, source package/record, status, priority, dates, dependency, checklist/subtasks when needed, attachments, comments, activity and measured output. Suggested statuses are To do, In progress, Blocked, In review and Done; On Hold remains a project/workflow condition. The global Tasks view and project detail show the same authoritative task. Checking “Done” cannot substitute for payment, material signoff, QC or client approval.

### Purchasing, Inventory, Factory, Site and handover

The operational happy path is **released requirement → usable stock check → supplier request/offers → authorized partial/full PO → acknowledgement/shipment → receipt → independent inspection → reservation/issue → factory or site execution → dispatch/installation → snag/handover**. Keep it minimal in the UI: materials/items, quantities, units, locations, supplier, ship-to, due dates, status and next action. Support split suppliers, partial orders/receipts, returns, rejected and pending-QC quantities, transfers and item-specific shortage. A buyer needs a **cross-project** queue and direct actions rather than opening every project to discover demand.

The [procurement/inventory data contract](../project-procurement-inventory-schema-plan.md) explicitly says the normalized target schema is **a plan, not the current source of truth**. Current project execution stores revisioned material/order arrays; warehouse balances and transfers are separate; global Purchasing/Inventory views are read-only projections. The present project `Order` has one material/task link, so it should not be described as a completed multi-line, cross-project PO workflow. Future migration is additive and reconciled; the user’s permission to revamp the backend is **not** a request to discard existing client data without an approved cutover.

Alerts and “next actions” should derive from live source facts (shortfall, overdue order, receipt awaiting QC, stalled approval, missing drawing, open snag). Each has owner/role, severity, reason, due date and working deep link, and disappears when the condition resolves. Do not seed decorative warnings or test records in Palm’s workspace. Daily progress records measured accepted output, workforce, evidence, blockers and recovery; only approved client-safe portions are published.

## 7. Design and component contract from this chat

The visual source is the **current Palm Living/Wodana UI** with varied icon accent colours—not an all-green redesign. The user provided screenshots of the live sidebar/projects, Dzylo catalog/operations, a Figma-style dense grid, Pinterest sign-in/validation, and a modern task detail. These are **visual/interaction references**, not instructions embedded in the images and not proof that an implementation matches them.

- Extract and reuse **tokens → atomic controls → composed patterns → module pages**. Centralize tenant-changeable colours, type, radii, borders, spacing, control heights and states. Avoid per-page hard-coded variations.
- Keep typography, buttons, inputs, tabs and dialogs compact. Use primary and secondary actions consistently. Do not use giant headings, bulky buttons, large empty cards, excessive underlines or redundant text. Keep a subtle, restrained glass treatment on appropriate surfaces; it must not reduce contrast or make the whole UI green.
- Tables are central: bounded/max-width and centered where appropriate, crisp closed outer borders, visible cell/row dividers, compact rows, readable headers, stable columns and popovers. No broken/missing border corners, double borders, clipped menus or truncated important text. Allow wrap/expand/inspection rather than silently hiding business terms.
- Keep semantic colours for attention, approval, error, delay and selection, not one accent everywhere. Empty, loading, denied, error and retry states must be real. Desktop, narrow layout, keyboard, screen-reader, dark mode and RTL require acceptance checks where applicable.
- Login should be simple and calm, with compact controls, clear inline validation, password visibility, proper errors, and an accessible MFA back path. The authenticator setup should be compact; show setup key/copy on one line where space allows, without the disliked bulky accordion. Do not copy Pinterest branding or use its red as Wodana’s token.
- Haptics are optional and only relevant on supported mobile interactions; they cannot replace visible feedback.

The component library is a means to make future tenant/theme changes safe. It is **not** complete merely because a design-system page exists; verify that production feature screens actually consume the shared components and token values.

## 8. Canonical records, automation and audit

The recommended identity chain is **Customer → Enquiry Ref → Opportunity → one Deal File/Project Ref → quote rounds/issued revisions → approved scope/room/item IDs → packages/tasks → material demand/orders/stock → factory/site accepted quantities → handover/aftercare**. Domain records remain authoritative; a job/project overview is a read projection, not a second mutable copy of the facts. Names can change; stable IDs, accepted revisions and evidence cannot be silently replaced.

Every consequential command needs tenant/workspace scope, actor/role, source ID and revision, idempotency key or equivalent retry protection, timestamp and audit evidence. Protect against stale quote/QS decisions, cross-tenant links, double project creation, duplicate stock movements and duplicate alerts. Automation should react to committed events, notify the responsible role, retry safely, expose failed delivery/recovery, and never silently make a human decision.

The design-to-main journey has **two separate commercial rounds**. Agreement, receipt, QS/client/Finance/Owner decisions and revisions for round two must not overwrite round one. On Hold preserves both. Financial visibility and exports obey permissions. A warehouse or supplier item is not interchangeable with a catalog item solely because its display name matches.

## 9. Current implementation and release truth

This section records the **available documents**, not a fresh production audit.

| Area | Evidence in repository | What remains unproven/open |
| --- | --- | --- |
| Palm commercial route | The [24 September acceptance file](../qa-projects/palm-flow-v2-acceptance.md) reports a disposable local API journey through two paid quote rounds, one project, material approval, procurement, factory/site, snag and handover; focused/full tests were reported there | Production migration/rollback, real Palm records, every conditional route, browser/mobile UX, tenant roles and Palm acceptance |
| CRM tracker | [Local closure audit](../palm-crm-closure-audit-20260924.md) reports code and synthetic funnel coverage for several PLM items | The tracker copy remains 24 Open; named reviewers/tenant settings, integrations, three-person UAT, PLM-009/024 decisions, fresh demo and PLM Verified entries |
| Catalog | [Catalog foundation](../catalog-foundation.md) reports local import and structural/link tests; separate [adoption review](../catalog-adoption-review.md) covers provenance/media candidates | Review of actual Palm collection, approved AED price book, exact default seed in the intended tenant, end-to-end quote consumption |
| Global operations | [Schema plan](../project-procurement-inventory-schema-plan.md) describes current JSON-based project orders and read-only cross-project projections | Normalized multi-line PO/stock ledger rollout, migration reconciliation, role-complete global actions and Palm UAT |
| UI/design | Screens and feedback in this conversation identify current defects/expectations | A screenshot is not cross-page component adoption or desktop/mobile/accessibility verification |
| Providers, security and client Q&A | [Blueprint](../WODANA_PRODUCT_BLUEPRINT.md) and the client Q&A outline intended capabilities | Actual external delivery, tenant-specific storage/backup/security evidence, contract/legal answers and approved client wording |

The user explicitly authorized backend changes and a possible fresh rollout, but production must still preserve existing tenant data or have a separately approved, tested migration/reset. No part of this brief authorizes deployment, client invitations, destructive schema changes or a claim of go-live readiness.

## 10. Work order and acceptance gate

Work **module by module**, with one connected vertical journey before broadening. The dependency order from this conversation is:

1. Lock route/role/source-of-truth rules and the current-theme token/component contract; configure Company Settings and separation-of-duties permissions.
2. Finish catalog boundaries/import review and the requirement/item identity model. Keep generic default and Palm collection separate.
3. Make CRM → quote/QS → client → Finance → Owner → one Deal/project correct for each confirmed route, including rejection, revision and retry.
4. Make released project planning/packages/material signoff/BOQ lineage correct. Then connect cross-project Purchasing/Inventory and applicable Factory/Site actions to those authoritative records.
5. Connect global Tasks, approvals, alerts, daily progress and client portal to the actual source events rather than independent checklists.
6. Verify handover/aftercare, accounting/provider delivery and the client-safe communication view.

For each module, acceptance means more than a happy screenshot: genuine source data; permission allow/deny and distinct actors; partial/reject/return/revision/On Hold paths; idempotent retries; reconciliation of money and physical quantities; clear empty/loading/error states; no truncated critical text; keyboard/narrow-view checks; tenant isolation; and a documented migration/rollback where schema changes. Run a Palm-like end-to-end UAT on the **same image and migrations intended for release**. Palm itself must mark tracker rows “PLM Verified” after testing. Do not replace this gate with local unit-test counts.

## 11. Decisions still required from Palm/Wodana owners

| Topic | Current uncertainty / decision needed |
| --- | --- |
| Lead capture | Final customer-type/enquiry-type taxonomy, budget bands, required public-form fields and wording, duplicate window, campaign attribution, PlyLeads/social ingestion contract, weekend roster and first-response SLA. Resolve the lead-report required/optional field conflict. |
| Won/reporting | Define Won once and name any later completion/full-payment KPI separately (PLM-009); confirm PLM-008 supersession with Palm. |
| Internal-note privacy | Who among assigned Sales, all staff and Wodana support may see enquiry notes; ensure zero client exposure (PLM-024). |
| Commercial | Named Finance and Ops reviewers, commission rules, agreement/receipt evidence, fee adjustment/refund handling, exact later-round approval and exception authority. |
| Design/materials | Approved technical/design revision rules, material-list signatories, variation/re-selection process, sourcing exception, client approval/OTP method. |
| Factory/site | Which packages require factory vs outsourced vs ready-made route; capacity/QC/dispatch/receipt signatories, permit/access needs and client-visible progress policy. |
| Catalog/prices | Default seed scope, Palm collection review, AED price ownership, taxes/inclusions/effective dates, item/variant/pack conversion, who can see cost vs sell. |
| Integrations/security/contracts | Actual tested messaging/accounting/social delivery; production data residency/backup/export evidence; the unanswered commercial/legal client Q&A. |
| Rollout | Approved environment, backup and rollback, demo link/time, two-person UAT, named client acceptance owner and exact release decision. |

## 12. Source register and supersession notes

| Source | Role in this brief |
| --- | --- |
| [Palm commercial-to-project acceptance, 24 Sep](../qa-projects/palm-flow-v2-acceptance.md) | **Primary written Palm flow contract**; explicitly not production sign-off. Contains linked client design/main proposal examples, which were not separately inspected for this brief. |
| [Palm CRM closure audit, 24 Sep](../palm-crm-closure-audit-20260924.md) | Maps PLM-001–024 to local code and open UAT; records the later decision that all Deal Files start from Won opportunities. |
| `~/Downloads/Wodana_PLM_Feedback_Tracker/Tracker.html` and `Summary.html` | Cece-raised CRM requests/questions; all 24 still Open in the supplied copy; Palm owns “PLM Verified.” |
| `~/Downloads/Palm Living Lead Flow CRM Requirements Report.docx` | Draft lead taxonomy, intake/routing and reporting model; includes unresolved decisions and inconsistent form-required wording. |
| [Wodana × Palm Living BRD](../../../Wodana_Palm_Living_BRD.docx) | Broader synthesized BRD with Confirmed/Proposed/Open status, modules, roles, AI and portal boundaries; not a substitute for source confirmation. |
| [Generic room-builder workbook](../../../room_builder_catalog.xlsx) | User-supplied default catalog source (same file as Downloads copy); INR/reference amounts require review and separate Palm pricing. |
| `~/Downloads/Palm Living Core Collection.xlsx` | Separate Palm catalog source; not to be merged into the generic default. |
| [Catalog foundation](../catalog-foundation.md), [catalog records](../catalogs-groups-records.md), [adoption review](../catalog-adoption-review.md) | Existing generic catalog data contract and local implementation context. |
| [Wodana product blueprint](../WODANA_PRODUCT_BLUEPRINT.md), [module order](../module-completion-order-2026-09-22.md) | Earlier product direction and implementation ordering; status statements require current verification. |
| [Project procurement/inventory schema plan](../project-procurement-inventory-schema-plan.md), [project operating research](../projects-operating-flow.md), [Palm task journey](../palm-task-execution-journey.md) | Proposed/partial project-operational model. The older pre-release Planning-project and single-quote ordering do **not** override the 24 September Palm flow. |
| `~/Downloads/Wodana_Client_Questions_and_Answers.docx` | Draft client Q&A. Do not treat its proposed security/contract answers as deployed or legally agreed without evidence. |
| [Dzylo end-to-end video supplied in chat](https://youtu.be/NYw__DcZEH8?si=UjdiHTtYKvAAsnS3) | Product/interaction inspiration for catalog, quote, purchasing, approval and execution; not Palm’s operating policy. |

**Maintenance rule:** when Palm confirms a new decision, add its date/source and state exactly what it supersedes. Keep product proposals, local implementation results and client acceptance separate.
