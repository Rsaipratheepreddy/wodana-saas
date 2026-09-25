# Wodana product and design master plan

21 September 2026 · Proposed full product scope · Planning, not implementation sign-off

Wodana should help a service business capture a request, agree the work, deliver it, communicate progress and reconcile money through connected records. Its visible experience should be calm and easy to learn. Complexity belongs in accurate relationships and business rules, with progressive disclosure in the interface.

This is the umbrella plan for the SaaS product. The [Palm connected product plan](palm-connected-product-plan-2026-09-21.md) remains the detailed client acceptance case. Where navigation differs, this master plan takes precedence as the proposed product direction. Neither document establishes that planned behavior is implemented or production-ready.

## Product positioning and boundaries

Start with client-facing service businesses that sell and deliver scoped work. Interiors is the first deeply validated configuration; agencies, consultancies, installation firms and other project services should use the same core. Do not claim suitability for every industry before testing its workflows.

The promise is practical: enter information once, find it quickly, see what is next and complete work without recreating context. Market leadership is an aspiration to test through task success, trust, speed and retention, not a feature count or a visual claim.

Use three layers:

1. **Shared core:** people, organizations, enquiries, deals, scope, quotes, work, conversations, approvals, documents, financial links and permissions.
2. **Industry packs:** terminology, forms, roles, fields, templates, workflow defaults and relevant operational capabilities. Palm activates design, BOQ, inventory, factory, site and handover.
3. **Workspace configuration:** company identity, branding, selected pack, custom properties, views, permitted automation rules and integrations. Personal preferences control Home, favorites, density and view defaults.

Generic means reusable business concepts with meaningful defaults. It does not mean making each customer build an application from a blank database. Do not put tenant-specific branches throughout UI components or allow custom fields to replace authoritative monetary and approval fields.

## Reference direction

| Reference | What was reviewed | Adopt | Adapt for Wodana |
| --- | --- | --- | --- |
| [Pixem FlowPilot on UI8](https://ui8.net/pixem/products/flowpilot---ai-workforce--automation-saas-ui-kit) | Public listing and preview montage viewed in browser; paid Figma source not acquired | Quiet sidebar, neutral working canvas, compact hierarchy, sparse purple accents; listing's emphasis on simulation and human review | Use tenant accent tokens, flatter working sheets and fewer persistent panels. Keep AI inside actual business tasks. |
| [Notion Projects](https://www.notion.com/product/projects) | Official product page | Linked tasks and projects, contextual views and configurable properties | Supply business defaults and typed commands for approvals, stock and finance. |
| [Notion Forms](https://www.notion.com/product/forms) | Official product page | Forms write into the working records and can begin workflows | Add versioned mappings, routing and review appropriate to CRM intake. |
| [AI Automation Dashboard by Sujon Hossain](https://dribbble.com/shots/27018565-Ai-Automation-Dashboard) | Published description, not a detailed visual inspection | Review/revise/approve as part of an automation workflow | Use as a secondary interaction reference. This similarly named FlowPilot is not assumed to be Pixem's UI8 kit. |

The public previews establish a visual direction, not a complete component specification. Create original layouts; no kit purchase is needed for this planning work. Wodana's proposed search, component behavior and measurements below are design decisions, not claims about those products.

### Additional references requested by the user

The user explicitly welcomes close reuse of familiar interface patterns from Figma, Miro, Notion and Jira. Familiar conventions are the default; consistency and task fitness decide where they belong.

| Product pattern and source | Apply it here | Concrete behavior |
| --- | --- | --- |
| [Figma contextual properties](https://help.figma.com/hc/en-us/articles/360039832014-Design-prototype-and-explore-layer-properties-in-the-right-sidebar) | Quote item, selected requirement, material, drawing or form question | Selection changes one contextual inspector; preserve the working surface and selection; common keyboard editing and undo where valid. |
| [Miro frames](https://help.miro.com/hc/en-us/articles/360018261813-Frames) and [toolbars](https://help.miro.com/hc/en-us/articles/360017730553-Toolbars) | Optional visual discovery, room moodboards and collaborative requirement mapping | Group references by room/topic, comment in context, and convert selected ideas into proposed structured requirements with backlinks. Approval happens on a versioned record. |
| [Notion connected views](https://www.notion.com/product/projects) | Briefs, clients, projects and saved working views | A record can be opened as a page or peeked from a table; its linked data is available in appropriate table, board, calendar or gallery views. |
| [Jira boards](https://www.atlassian.com/software/jira/guides/boards/overview) and [timelines](https://support.atlassian.com/jira-software-cloud/docs/create-manage-and-visualize-work-on-the-timeline/) | Sales queues, factory work, site tasks and scheduling | Filtered boards over shared work records; explicit owners, dependencies and dates. A drag to a gated state checks readiness and explains missing evidence before changing anything. |

Choose the representation by task: sheet for quantities/pricing, board for work queues, timeline for scheduling, document for a brief, canvas for visual discovery, and gallery for client-facing designs. These share identity, search, selection, inspector and decision conventions. A Miro-like canvas is optional and later than reliable form/brief capture; it must not force ordinary staff to learn a spatial editor to submit an enquiry.

These additional references were checked through their official documentation. Their paid/private design files and complete applications were not inspected. The current interactive concept demonstrates five selected surfaces and local interactions; it is not the complete twelve-screen prototype or a working CRM.

## Full product map

Primary navigation: **Home, Inbox, Sales, Clients, Projects, Resources**. Global search, Create, notifications, workspace switcher and profile are consistent utilities. Favorites and saved views appear under their relevant destination. Settings, reporting, forms and automation are discoverable through a compact workspace menu and contextual links, not dozens of competing sidebar entries.

| Area | Scope and primary result | Main surface |
| --- | --- | --- |
| Account and access | Sign in, recovery, MFA, invitations, workspace choice, clear restricted states | Focused form; resumable invitation flow |
| Workspace onboarding | Business type, team, import, branding, channels, first useful workflow | Short setup checklist with safe defaults |
| Home | Cross-product personal work; predefined configurable widgets | Actionable lists and small summaries |
| Inbox | WhatsApp/email/portal conversations, ownership, replies, templates, internal notes, follow-up | List, thread and contextual drawer |
| Sales | Intake, assignment, duplicate review, qualification, activities, deals, quotes, losses and conversion | Table or board; record workspace |
| Clients | People/companies, contacts, relationship history, linked work, communication and sharing | Compact profile with linked views |
| Requirements | Briefs, scope, site information, selections and versioned confirmation | Structured record with limited document blocks |
| Quotations | Room/grouped lines, images, dimensions, pricing, discounts, taxes, terms, revisions and proposal | Working sheet, item drawer and print preview |
| Agreements and approvals | Internal review, client acceptance, payment prerequisites, controlled release and variations | Evidence and version-specific decision panel |
| Projects | Scope, ownership, schedule, dependencies, capacity, risks, progress and change impact | Overview plus specialized working views |
| Purchasing | Demand, shortages, RFQs, comparisons, orders, receipts, returns and supplier bills | Linked sheets and approval actions |
| Factory | Readiness, work orders, material issues, operations, batches, quality and dispatch | Role queue and focused work order |
| Site and field | Visits, readiness, assignments, receipts, evidence, inspection, snags and offline reporting | Mobile task capture; office review sheet |
| Handover and service | Partial handover, sign-off, documents, warranty and service requests | Acceptance pack and follow-up queue |
| Resources | Products/materials, units, price versions, supplier offers, stock locations and movements | Searchable catalog, gallery and stock ledger |
| Financial operations | Client billing milestones, invoice links, allocations, commitments, costs and exceptions | Reconciled summaries and linked transactions |
| Client portal | Progress, decisions, invoices, messages and shared files | Visual project story and focused reviews |
| Supplier collaboration | RFQ response, acknowledgement, promised dates, documents and delivery evidence | Narrow, scoped external workspace |
| Forms and templates | Intake, briefs, surveys, inspections, proposals and reusable work plans | Guided builder, preview and version publishing |
| Automations | Routing, reminders, task creation, approved communication and sync exceptions | Rule list and readable trigger/condition/action editor |
| Knowledge | SOPs, reusable guidance and contextual help linked to the task | Searchable short pages and templates |
| Reporting | Funnel, source, workload, delivery, margin, collection and integration health | Saved views and focused drill-down reports |
| People and capacity | Team membership, role assignment, availability, workload; optional attendance/leave | Team views and calendar; HRMS in app switcher |
| Tenant administration | Branding, terminology, roles, integrations, audit, export, retention, billing and entitlements | Grouped settings; search within settings |
| Platform operations | Provisioning, subscriptions, tenant health, support access and incident recovery | Separate operator console with audited access |

Advanced payroll, a general accounting ledger, a universal website builder and arbitrary autonomous AI agents are outside the initial core. Keep extension boundaries without putting unfinished modules into everyday navigation. Existing HRMS stays a distinct optional module; it should not dictate the CRM Home.

## Shared record and workflow architecture

Party → enquiry → deal/engagement → quote revision → accepted scope → project/deliverables → work and supply → acceptance/service. Conversations, documents, activities and decisions link across these objects. Multiple enquiries or projects can belong to one client. Preserve original sources, distinct legal entities and tenant boundaries.

Define one authoritative owner for each field: customer contact data, approved scope, inventory movements, posted invoice state and published progress must not have competing editable copies. A quotation, a procurement takeoff and a factory bill of materials have separate quantities and purposes. Model explicit allocations and unit conversions.

Store typed properties and relations independently of their presentation. Table, board, gallery, calendar and timeline are views of the same records. User-customizable page blocks can arrange permitted data; they cannot bypass transition rules. Snapshot accepted versions while ordinary linked views reflect the current permitted record.

Commercial approval, project health, task progress, message delivery and sync status are different state machines. Every sensitive transition has actor, authority, source version, evidence and timestamp. Support return for correction, rejection, hold/resume, cancellation, partial release and reversals where relevant. “On hold” is an overlay, not the last stage.

Domain actions emit durable events for timelines, notifications, projections and integrations. Handle repeated events, out-of-order webhooks, concurrent edits and ambiguous external results explicitly. A delayed integration may create a pending state; it cannot invent a successful payment or shipment.

## Minimalism rules

- One page title, one local view toolbar, one dominant primary action. Avoid repeating the page title in nested panels.
- Show the five to seven most useful properties first; secondary properties open in the drawer or a Properties section. This is a default, not an arbitrary limit on legitimate working sheets.
- Use neutral backgrounds and typography. Give colors specific meaning; never color every module, row and status independently.
- Use sentences only when they explain a decision or error. Prefer “Drawing V3 needs approval” to a paragraph describing the workflow.
- Preserve context during edits and review. Open linked records in a consistent drawer, with an explicit full-page option for deep work.
- Keep essential actions visible. Progressive disclosure must not mean unlabeled icons, hover-only controls or undiscoverable menus.
- Default to useful real data or a single next step. Avoid decorative counts, placeholder performance charts and onboarding banners after setup.
- Separate ordinary work from configuration. Staff act on their records; administrators configure the rules behind them.

## Design language and configurable branding

Use the current full-bleed design-system direction. Propose a 224px desktop sidebar, a 48px utility bar and consistent local spacing. Default text is 14px, secondary metadata 12px, headings 20–24px; essential text must remain readable at zoom. Tables default to 40px rows, with 36px compact and 48px comfortable modes. Use 4/8/12/16/24/32 spacing, restrained 6–8px control radii, and elevation only for menus, drawers and dialogs. These are starting specifications to validate in prototypes.

Keep tables flat with subtle row separators, aligned currency/quantity values and clear edit states. Use images where they explain design/materials or progress. Avoid oversized cards, gradients behind working content, excessive pills and multiple dark navigation bands. Motion should confirm interaction, respect reduced motion and never slow data entry.

Brand configuration uses semantic tokens with three independent layers:

| Layer | Configurable values | Stable contract |
| --- | --- | --- |
| Tenant identity | Logo, brand seed, optional secondary accent, portal identity, approved font choice | Consistent spacing, type hierarchy and interaction behavior |
| Appearance | Light/dark/system; optionally restrained neutral warmth | Legible surface/text combinations across modes |
| Semantic state | Accessible palettes defined by the product | Success, warning, error, information and focus retain meaning independently of brand hue |

Derive action, hover, pressed, soft-selection and focus tokens from the seed. Validate normal text contrast at 4.5:1 and relevant UI boundaries/focus at 3:1 as design acceptance targets. If the seed is too light, retain it as decorative identity while deriving a darker usable action tone and showing that preview. Verify every actual surface pairing, not just brand color against white.

Offer examples such as Palm sage, violet and blue with identical layout and state semantics. Use brand color for primary actions, selected navigation and restrained emphasis; keep most of the canvas neutral. Scope theme by tenant to prevent cross-workspace leakage. Portal and document identities may have legal-entity overrides; preserve issued document branding snapshots.

Appearance editing needs live preview of a table, form, alert, button and client page; Reset, Save and Cancel; versioned configuration and rollback. User appearance preference can override mode/density, not the tenant's company identity. Do not accept arbitrary tenant CSS/scripts. Existing `primary-color.ts`, generated tokens and design-system provider are starting points; audit actual use rather than introducing another theme engine. Current legacy guidance assigning green to action/success must evolve into separate brand and semantic roles.

## Search and creation everywhere

Provide a persistent search affordance and Cmd/Ctrl+K. Search clients, enquiries, projects, quotes, materials, messages, files and help; show record type, meaningful context, reference and recency. Recent and pinned records work before typing. Keyboard arrows select, Enter opens, Escape closes and restores focus. Results can open in a drawer or their working view.

Enforce access before returning titles, snippets, counts or semantic answers. Tenant and legal-entity boundaries apply to indexing and previews. Handle stale/deleted records and permission changes. Offer filters such as “Quotes awaiting reply” as visible, editable query chips. Natural-language parsing proposes these filters; it does not silently broaden access. Show which records support an AI answer.

Global Create offers only relevant object types and carries current client/project context. A slash menu inside a brief inserts a section, checklist, linked view, reference image or requirement group. It is not another unbounded application builder. Reuse the existing universal-search implementation and extend its behavior after verifying its permission contract.

## Component architecture

Reuse primitives already in the repository. Standardize a small set of assemblies with documented accessibility and state contracts.

| Family | Reusable pieces | Principal use |
| --- | --- | --- |
| Shell | Sidebar, utility bar, breadcrumb, view tabs, command search | Stable navigation |
| Record | Compact header, property rows, relations, drawer, version indicator | One record across contexts |
| Data | Working sheet, board, gallery, calendar, timeline, saved-view toolbar | Multiple views of shared records |
| Capture | Field, field group, repeatable items, attachments, validation summary | Intake and structured requirements |
| Work | Next-action row, dependency, task, evidence capture, readiness summary | Guide execution |
| Decision | Review panel, change comparison, decision footer | Approvals and controlled changes |
| Communication | Thread, composer, audience picker, delivery state, sharing preview | Inbox and client updates |
| Composition | Document section, linked-record block, widget, template selector | Flexible but understandable pages |
| Assistance | Suggestion preview, provenance, confidence/missing evidence, diff | AI that can be checked |
| Feedback | Loading, empty, stale, offline, conflict, failure, undo | Trust during real use |

All assemblies share localization, formatters and semantic tokens. Business-specific editors compose them; do not make the quotation builder or factory task a generic CRUD form. Every control has keyboard behavior, focus restoration, a meaningful disabled reason and mobile treatment.

## Configurable forms and requirement capture

Build with templates first: enquiry, discovery brief, site survey, supplier response, material selection, inspection, handover and service request. Start from an existing record's properties where possible. A field can be text, number, money, date, choice, person, relation, file, measurement or repeatable group. Drawings and room-specific images belong to the relevant requirement.

Editor layout: question list and live preview, with selected question properties in one panel. Support conditional questions, validation, required/optional flags, mobile preview, branding and confirmation text. Map submissions to controlled record fields and routing rules. Public forms cannot set internal approval/payment fields. Keep source attribution trusted and distinguish source/channel/intake/assignment as Palm requires.

Publishing freezes a form version and mapping. Later edits preserve the meaning of prior answers. Include drafts, preview, duplicate review, upload limits, spam controls, delivery errors and export. A failed submission retains user input. Repeated submit must not create duplicate leads.

Requirements evolve from raw enquiry to structured brief to confirmed scope. AI can extract candidate values with citations to source text/image; unknown values remain unknown. Allow the user to confirm only changed requirements. Preserve the difference between client preference, estimator assumption and approved specification.

## Home and contextual onboarding

Home is personal and cross-functional. Preset widgets include Next actions, Follow-ups, Inbox, Approvals, Delivery readiness, Receipts, Schedule and Workload. Each widget has a real action, permitted data, empty/loading/stale/error states and limited size/filter settings. Offer role defaults and user reordering with keyboard alternatives. Save separately for each user/workspace.

The first session should reach a useful action quickly: choose business pack, add/import one client, capture an enquiry and build a first draft quote. Defer optional integrations until needed, but never imply a disconnected channel is live. A checklist can be resumed or dismissed. Contextual help explains a blocked action and offers its direct resolution. Provide isolated sample data with a visible Sample label and a clean exit; never pollute live business records.

## Innovations with measurable value

| Proposed capability | User experience | Dependency and proof |
| --- | --- | --- |
| Next useful action | “Two materials missing for Friday's batch” with a link to resolve the shortage | Deterministic readiness first; correct owner and evidence |
| Capture once | Paste a customer request and review a proposed brief, linked client and follow-up | Source-preserving extraction, duplicate review, explicit apply |
| Brief to quote | Suggested structured quote rows from confirmed requirements and permitted catalog | No invented prices or dimensions; measurable time saved |
| Change impact preview | Show affected cost, orders, batches, dates and client decisions before a revision | Version graph and explicit allocations; no automatic promise changes |
| Client-ready update | Draft concise progress using only approved, shareable evidence | Audience preview, correct version and delivery history |
| Find and act | Search an item and open its blockers, quote and pending action together | Permission-aware search and shared record drawer |
| Automation rehearsal | Show which records a rule would change and what exceptions stop it | Side-effect-free simulation and versioned activation |
| Guided recovery | A sync failure explains the affected invoice and safe next step | Durable operation ID and provider reconciliation |

Prioritize next actions, capture once and brief-to-quote. Change impact depends on trustworthy operational links. AI assists should be optional and contextual; do not make an empty chat box the product's main screen. No claim of autonomous operation until permissions, simulation, failure recovery and evidence are proven.

## Automation and integrations

Use a readable “When → If → Then” builder first. Templates cover assignment, follow-up reminders, approval requests, purchase readiness and invoice exceptions. Advanced branching can open a canvas later. Rules need named owner, scope, draft/test/live/paused states, sample run, version, execution history, loop limits and retry policy. Distinguish internal reversible updates from external messages, purchases and approvals. Define which require human review or preapproved policy.

Connection setup and operational use are separate: an admin connects QuickBooks or WhatsApp; staff use permitted invoice/reply actions within their work. Connection health needs Connected, Needs attention and Disconnected plus actual operation evidence, not a marketing badge. Scope integrations by tenant/entity and verify provider-specific contracts at implementation time.

QuickBooks first slice: match customer, create one invoice from approved billing, store external identity, refresh balance/payments, allocate verified receipts and reconcile release gates. Define taxes/currency/account mapping and who owns posted state. Supplier bills, credits and refunds have separate acceptance scenarios. WhatsApp first slice: incoming event, correct contact/thread, permitted reply/template, provider delivery evidence and error recovery. Do not expose provider diagnostics to clients.

Calendar, email and file integrations need conflict ownership, duplicate prevention and clear source links. Import/export is a first-class integration: preview mapping, missing values, original IDs, row errors, reconciliation and resumable import. Outages preserve drafts and reveal stale state; offline reporting records local capture time and server acknowledgement, with conflict review on reconnect.

## Client and supplier experience

Client portal navigation is My project, Reviews, Payments and Messages. Display current milestone, next expected event and requested decision above a visual room/item story. Include published photos, short updates and supporting files. Accurate quantities such as “4 of 6 accepted” are better than unexplained percentages. Design-only clients see design milestones; supply-only clients see delivery, not irrelevant factory steps.

Every shared document/update has audience, publication status, source revision and history. Staff can preview the client's exact view. Requests and replies return to the existing work record. Decide notifications by importance and preference; aggregate routine updates to reduce noise. Client data entry uses plain business language and responsive controls.

Supplier access is scoped to authorized requests/orders. A supplier can respond, confirm date/quantity and upload evidence without viewing client margins or unrelated projects. External links need expiry/revocation and clear identity requirements based on sensitivity.

## SaaS operation and trust

Support tenant isolation, role and record-level permissions, invitations, ownership transfer, MFA/session management, audit, export and retention. Track plan limits and billing without blocking safe reading/export of existing work unexpectedly. Operator support access must be explicit, time-bounded and audited. Define backup/restore rehearsal, account recovery and incident ownership before rollout.

Customer-facing UI must handle loading, zero results, permission denial, read-only state, expired link, missing provider, stale data, optimistic conflict, partial failure and offline capture. Never translate a failed fetch into “all clear”. Maintain accessibility, keyboard operation, RTL, localization, money/unit/date formatting and reasonable performance with real record volumes.

Proposed performance budgets: warmed command search p95 under one second and immediate local typing feedback; common working views interactive within two seconds on an agreed test device/network; long imports/exports run asynchronously with progress. These are targets requiring instrumentation, not measured current results.

## Palm requirement coverage

| Client requirement | Shared product capability | Palm configuration and acceptance |
| --- | --- | --- |
| QR/staff/channel enquiries | Forms, intake metadata and assignment | QR and staff walk-ins remain distinguishable; budget ambiguity resolved |
| Source reporting and freshness | Typed attribution, timestamps and saved reports | Separate source/channel/intake/assignment; original message retained |
| Owner Review and Deal File | Approval and engagement release | Required verified payment plus authorized owner decision; linked lead/deal refs |
| Design and technical stages | Scope versions, deliverables, tasks and decisions | Named designer/visualiser/surveyor; agreed revision rules |
| Image-rich quotation | Structured sheet and proposal rendering | Sample nine items and AED 146,475 reconcile; missing subtotal flagged |
| Nine material categories | Configurable catalog and inventory | Missing unit/price/quantity remains unresolved, not silently zero |
| Purchasing and factory | Demand, allocations, batches and inspections | Partial receipts, shortages, rework and client-owned components |
| Site and handover | Mobile task reporting and versioned acceptance | Evidence review, snags, partial handover and aftercare |
| Client progress and communication | Published view and unified conversation history | No private costs; client sees exact decision version and meaningful progress |
| QuickBooks and WhatsApp | Tenant-owned provider connections | Live permitted invoice/payment and messaging tests pass |

Each configuration must also pass generic fixtures: an agency service project without inventory, a design-only engagement, supply-only delivery and installation/repair. Palm-specific requirements must not leak into those journeys.

## Delivery order and acceptance

| Release | Scope | Required evidence |
| --- | --- | --- |
| A. Product contracts | Routes, core records, roles, pack boundaries, tokens, reference screens and status definitions | One authoritative owner per field; gaps/assumptions logged; no conflicting parallel plan |
| B. Shared experience | Shell, search, drawer, working views, theme preview, configurable Home and guided setup | Same scenario usable in three brands, light/dark, keyboard/mobile; Home distinct from Sales |
| C. Sales and communication | Intake/forms, assignment, client record, Inbox, brief, quote and decisions | Complete real-data-shaped enquiry-to-release journey; sample money/version rules correct |
| D. Delivery and portals | Scope/work/supply, purchasing, factory/site, progress publishing and handover | Six-chair partial batch, repaired client-owned item, design-only and service-only journeys |
| E. Operations and pilot | Integration recovery, imports, reporting, billing/access, backup/recovery and role-separated pilot | External delivery and finance evidence; tenant isolation; export/rollback and support process |
| F. Differentiating assistance | Change impact, AI extraction/drafts, simulated automation and richer saved views | Measured reduction in work with no increase in correctness or privacy failures |

Provider feasibility, financial correctness and security validation start in A; E is acceptance, not first investigation. Prototype the highest-risk interactions early: search-to-record, quote editing, form building, widget layout and client decision. No delivery dates until work is sized against current code and outstanding changes.

Proposed usability acceptance: at least 4 of 5 representative users complete each core task unaided; median quote preparation time improves at least 30% from measured baseline; no unexplained money mismatches, duplicate downstream records on retry, unauthorized release or unpublished client data. Track support requests, failed searches, time to first valid quote, overdue follow-ups and recoverable provider failures. These are pilot targets, not promises of superiority.

Keep a screen inventory recording current route, purpose, source of truth, replacement pattern, owner and acceptance evidence. Reuse current quotation, search, theme, Inbox and project foundations after behavior checks. Migrate route by route with compatibility links, preserved drafts and feature rollback. Retire an old surface only when its replacement handles equivalent data and edge cases. Existing unrelated modifications must be preserved.

## Decisions and next design deliverables

Proceed with neutral surfaces, restrained tenant accents, six primary destinations, predefined Home widgets, typed properties and templates, and optional industry packs as recommended defaults. Resolve Palm's form requirements, commercial release stages, revision allowances, duplicate policy, finance authority and outbound communication policy before implementing dependent rules.

Next design work should produce a connected twelve-screen prototype: Home, command search, Sales sheet, client record, Inbox, brief/form builder, quotation, approval, project item/work queue, purchasing/factory detail, client progress and branding settings. Each screen includes useful empty/error/permission states. Follow with a component/state inventory and implementation backlog linked to release acceptance, rather than disconnected visual redesign tickets.

This plan covers the intended product architecture and major lifecycle surfaces. Detailed schemas, provider contracts and screen-level interaction specifications are implementation deliverables; no document can guarantee all future industry requirements or market leadership.
