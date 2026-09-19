# Wodana product blueprint

**Status:** product planning direction, pending validation; not a claim of implementation or client acceptance
**Updated:** 17 September 2026
**Execution board:** [WODANA_TASKS.md](WODANA_TASKS.md)

This is the durable product contract for the next Wodana delivery cycle. It combines the product-reshape, generic-platform and innovation briefs with the actual repository and Palm Living's lead/project documents. A future contributor should read this file and the task board before choosing work. Current code and tests determine what already exists; this document determines what we are trying to achieve. Never mark a capability shipped merely because it appears here.

## 1. Product promise and boundaries

Wodana is one operating system for design, fit-out and related firms: from first contact to aftercare. It should answer, on any active job: **Who is the customer? What was agreed? Where are we? Who owns the next action? What needs a decision?** Staff should never retype a room, scope item, customer, drawing or commitment solely because work moved to another module.

Palm Living is the first **Design & build** tenant configuration, not a fork. The same product must also support an interior-design studio without delivery, a fit-out contractor, a joinery/furniture business and a blank kit. Region packs (tax, locale, currency, privacy text, providers) are independent of firm-type kits (phases, stage names, roles and templates). The Wodana internal control plane is separate from every tenant workspace.

Business Core remains the only authoritative writer. Existing Enquiry, Lead, Opportunity, Pre-execution Case, Quote and Project domains stay authoritative for their facts. A **Job spine** connects them with one reference, identity, timeline, phase and next-action projection; it must not become a second store of copied business facts. A repeat enquiry for an existing Customer begins a new Job and links prior history. Raw, unvalidated intake remains an intake event before a Job is accepted.

Measure success by real work completed, not module count: enquiry assignment/first meaningful response time, room requirement coverage, quote preparation and revision time, overdue client decisions, promise-date reliability, unlogged site work, mobile crash/offline recovery, and support tickets caused by unclear navigation. P00 captures baselines; each slice sets an explicit target and instruments its outcome before calling it done. Do not invent current performance or claim improvement from screenshots alone.

## 2. Starting state: what exists and what is not proven

| Area | Current repository baseline | Acceptance boundary |
| --- | --- | --- |
| Workspace/auth | Tenant login, invitations, MFA, onboarding, members, roles, legal entities, terminology, audit and integration UI/API exist. Recent local code adds team-derived roles/CRM queue membership. | Multi-person Palm team/seat/access UAT and full onboarding are not signed off. |
| CRM | Customer graph, intake, duplicate review, assignment, SLA, work, conversations, qualification, opportunities, notifications and reports have backend and web paths. Mobile has native Today/Leads/Deals/Inbox/More paths. | Palm live routing, published forms, recipient delivery and qualified handoff require tenant configuration and UAT. Native Meta Lead Ads and PlyLeads are not connected. |
| Pre-execution/commercial | Brief, site evidence, designs, definition baseline, catalogue prices, quotations, agreement/release and controlled changes have significant backend/web coverage. Mobile captures brief/requirements and site visits, measurements and photos. | Complete revision, rejection, client OTP, money and release paths are not accepted across web/mobile. |
| Projects | Backend has initiation, release lineage, packages/tasks, design evidence, bookings, procurement/factory/site controls, daily reports, quality, handover and warranty. Web has project sections. | The full released-quote-to-warranty browser flow is not signed off. Mobile Projects is still a module tile without a native project workflow. |
| Mobile shell | Expo/React Native authentication, CRM, HRMS and pre-execution field capture exist. | Global Inbox, Create and Notifications are shells; native project delivery, offline sync, device push and design-token parity remain work. |
| Providers/AI | Integration and automation services exist with some local provider exercises. | A connection record is not proof of delivered messages, accounting posting, native social intake or safe AI outcomes. Verify each with an actual test receipt. |

Older readiness documents can describe earlier states. Re-check source and tests before changing a status. `memory.md` is historical delivery evidence, not a substitute for current code inspection.

## 3. Architecture and canonical record flow

```text
Web (Next.js)       Staff mobile (Expo)       Responsive client space
       \                  |                           /
        authenticated, versioned Business Core commands and reads
                            |
          PostgreSQL + tenant RLS + audit + transactional outbox
                            |
             Redis/workers + intelligence/provider adapters
```

- Business Core owns validation, permissions, transitions, idempotency, events and authoritative records. Web, mobile and workers never write business tables directly.
- `packages/contracts` holds versioned request/event contracts. Web and mobile share semantics, not necessarily identical screen layouts.
- Mobile keeps only encrypted local drafts/evidence and an idempotent upload/outbox. Commands carry source version and stable client operation ID; conflicts are presented for a person to resolve. A mobile cache is never a second business system of record.
- Store tenant, actor, legal entity, branch and correlation context explicitly. Keep immutable accepted baselines, decision evidence and original intake. Reject stale versions and cross-tenant references.
- Build the Job spine as an adapter/read projection over existing IDs first. Add schema only when the mapping, ownership and migration are specified in the canonical model. Backfill on a clone with orphan and permission-diff reports; never silently migrate Palm live data.
- The **One Tree** is `Job → Site → Room/Zone → Item/Assembly/Work`. Discovery originates its IDs; scope, design, catalogue selection, quote, BOQ, work packages, progress, snag and client views refer to those IDs where applicable. Empty early-stage trees are valid; do not fabricate rooms.
- A shared Next Action projection surfaces the owner, date, reason, route and source record. Domain commands remain domain-owned. A job-level timeline orders intake, communications, decisions, revisions, money and delivery events without rewriting their source history.

## 4. Lifecycle and gate rules

The generic journey is **Intake → Qualify → Discover → Design/Scope → Price → Agree → Release → Deliver → Handover → Aftercare**. A kit/job template may mark a phase *not applicable* with a recorded reason; it never silently jumps. The phase is computed from evidence and gate decisions. A responsible role may set a stage within the current phase; record who, when and why. Show computed `Blocked`, `Awaiting client` and `At risk` flags beside that stage.

The reshape brief specifies exactly four **business hard gates**:

1. Owner Review approval before commercial release.
2. Finance-verified on-contract receipt before Release.
3. Finance-verified before-production receipt before Ready for manufacturing, when that milestone applies.
4. Client handover acceptance before Complete.

Other operational readiness conditions should guide users with named warnings, an authorized override reason and a visible compliance record. This does **not** make security, tenant isolation, accounting truth, evidence authenticity, version consistency or physical quantities optional. A manager can override a workflow recommendation; they cannot claim money was received or materials installed when the evidence says otherwise. The existing backend has stricter command blocks; reconcile every one against this distinction before changing it. Do not weaken a rule by merely hiding an error in the UI.

## 5. Product surfaces and information architecture

### Staff web

Target daily navigation: **Today, Jobs, Customers, Inbox, Calendar, Catalogue, Reports**. Show **Team** and **Settings** by permission. A Job opens a single contextual workspace: **Overview, Discovery, Design, Scope, Quote, Agreement, Delivery, Handover, Money, Files, Timeline**. Only applicable steps appear for its kit/template; a direct link to hidden work explains why it is unavailable. Current Workspace/CRM/Pre-execution/Projects links must remain resolvable through migration, not break overnight.

- **Today:** assigned Next Actions, client decisions, overdue promises, genuine blockers and a clear first action; no decorative KPI tiles.
- **Jobs:** searchable list and one profile with client, reference, phase/stage, owner, promise, risk and the next decision. Linked source records are inspectable without context switching.
- **Customers:** one customer identity and contact/consent history; multiple Jobs may belong to one Customer.
- **Inbox/Calendar:** communication and commitments linked to Job/Customer, not unowned generic records.
- **Catalogue:** practical item, variant, assembly, supplier, price and lead-time work with clear cost/selling-price permissions.
- **Reports:** source/assignment/SLA/funnel, portfolio delivery/capacity and money; each report must reconcile to record lists and support a decision.
- **Team/Settings:** access inheritance, seats, firm terminology, legal entities, region/kit, provider capability status, security, audit, billing and data export. Technical worker controls stay in the internal portal. A tenant subdomain opens a simple branded sign-in/onboarding flow, not a marketing landing page.

### Staff mobile

Mobile is a **native action tool**, not a shrunk web dashboard. Home becomes Today; a job opens the next useful action. Keep fast access to Jobs, Inbox, contextual Capture, notifications and Profile with accessible tap targets. Admin configuration stays on web. Native work must include CRM response/follow-up, survey/photo evidence, design review where assigned, package/task updates, material receipt, daily site report, snag capture and handover walk-through. Offline queueing is for field drafts/evidence, with per-field conflicts surfaced on reconnect; never silently merge reviewed decisions, payments or approvals. Camera/location permissions are requested only when needed. Mobile uses the same web-derived design tokens, logo, terminology, locale and server permissions; remove stale pink/peach product gradients outside the logo.

### Client space

A responsive, passwordless/verified client product—not the staff workspace with hidden buttons. It shows a safe job timeline, the current approved scope/design, decision requests, quote/options, agreement/payment requests, approved progress stories, handover and warranty. Each published item carries an exact revision. High-stakes decisions use purpose-bound verification; staff approval precedes any AI-drafted update. No margin, vendor negotiation, private notes, staff-only risk or unapproved forecast leaks.

### Internal control plane

Wodana staff manage tenant provisioning, region/kit versions, capability flags, support access, provider health, usage and UAT clones here. Time-box and audit support access. Never link this portal into tenant navigation. The account/organization hierarchy, onboarding, domains, entitlements, seats, billing, operator roles, audit and tenant-app effects are specified in the [internal control-plane plan](WODANA_CONTROL_PLANE.md).

## 6. Innovative but practical workflows

1. **Discovery:** room-by-room needs, wants and constraints; annotated photos and inspiration; survey dimensions; client-co-created draft; evidence-anchored consultation suggestions; requirement coverage and an exact confirmed revision. First slice: room tree, per-room needs, photos, client brief link and uncovered-scope check.
2. **Catalogue:** variants, supplier price versions/lead times, one useful parametric assembly and labour/waste norms. A survey dimension can calculate a quote quantity; the estimator can inspect and adjust it with a reason. First slice: one assembly type, not a universal visual rule builder.
3. **Quotation:** room-first scope-bound lines, catalogue and authorized manual prices, options, margin visibility by permission, structural version diff, PDF and interactive client acceptance. Unpriced or unapproved scope is conspicuous. First slice reaches an accepted quote and preserves the exact priced baseline.
4. **Design:** per-room inspiration → moodboard → space plan → render → material/technical drawing, each with named author, revision, included round count, pinned feedback and client decision. Only approved published revisions reach the client or factory. First slice: per-room deliverables, comparison, comments and revision-bound approval.
5. **Communication:** one job timeline across portal, email, WhatsApp and logged calls; a structured decision request replaces ambiguous “please confirm” chats. Weekly progress is drafted from approved evidence and published by staff. First slice: decision requests, reminders and a client-safe timeline; provider delivery is verified before being claimed.
6. **Project delivery:** released scope → packages → tasks → materials/POs → factory/site → dispatch/receipt → install → quality → handover. A master timeline combines dependencies, supplier lead times, factory and crew capacity with the promised date. HRMS supplies approved availability/allocation, not private personnel details. The field pulse takes about a minute, records evidence and flags recovery actions. First slice: package readiness, connected timeline, site pulse and snag walk.

AI is one **suggestion primitive** across these flows: input evidence and provenance, proposed change/diff, confidence or uncertainty, human accept/edit/reject, and audit. It may not approve, send, publish, commit a price, move a stage or record payment by itself.

## 7. Generic configuration, money and provider boundaries

- **Region packs:** locale/language, dates, working calendar, currency defaults, phone/address normalization, tax labels/treatment, privacy text, data residency and available providers. Start with UAE and India; validate legal/tax details with appropriate authorities/advisers before release. A legal entity owns one base currency; a tenant may have multiple entities.
- **Firm kits and job templates:** versioned phase/gate/navigation defaults for Design & build, Interior design studio, Fit-out contractor, Joinery/furniture and Blank. Show an upgrade diff; preserve tenant overlays. A Furniture Only job must not show fake survey/design tasks.
- **Tenant extensibility:** controlled field options and bounded custom fields; separate staff/client terminology; branch-aware teams, queues and calendars; document templates with legal-entity branding. Archive configuration values instead of rewriting historical meaning.
- **Money:** structured invoices, credit notes, receipts and allocations tied to legal entity, agreement/milestone and verified payment evidence. Track actual PO, factory, site and subcontract costs against the accepted baseline. Keep commission rules reviewable and reasoned. Provider accounting sync is an adapter, not the system of record.
- **Capability adapters:** messaging, lead sources, payment, accounting, e-sign, calendar, storage and AI have provider-neutral contracts. Integrations UI distinguishes **Not configured**, **Connected** and **Delivery verified on date**, with a real test. A chosen channel is not proof of a live inbound connector.
- **Files/data rights:** versioned design assets, resumable large upload, malware scanning, per-tenant storage/quota, safe publication metadata, retention policy, complete tenant export and a separate privacy erasure action. Never equate archiving/discarding with erasure.
- **Packaging:** seats/storage/modules/AI allowance are plan entitlements; incomplete-feature flags are separate. Never upsell a capability that is merely unfinished.

## 8. First-customer acceptance: Palm Living

Palm's lead report requires separate source, channel, intake and assignment dimensions; company/social/shared-form/QR enquiries route to Sales, while staff-created walk-ins and self-generated leads can go to a named salesperson. Preserve original answers, review duplicates, expose created/last-updated timestamps and report by source/channel/owner/team/enquiry type/budget/freshness. Their eight enquiry types are Renovation/Fit-Out, Full Fit-Out, Interior Design, Interior Design + Furniture, Furniture Only, Concepts/Early Ideas, Architecture/ODG and Not Sure Yet. Customer-type options, budget bands and final form copy still need client approval. Shared links are the interim social intake; Meta Lead Ads and PlyLeads ingestion are not connected.

Palm office hours are **Monday–Friday 08:00–18:00 Asia/Dubai**. Weekend enquiries still notify Sales; the target model is a configured duty roster, with a visible queue fallback until one exists. If an assigned owner logs neither a call nor a note within **60 elapsed minutes**, another eligible owner or the queue takes over with audit and alerts. An internal note stops takeover but does not count as a verified customer response. First-response SLA target is a separate setting. `operations@palmlivingae.com` is the current client tester; `cece@palmlivingae.com` is an optional second tester, not permission to invite everyone.

Palm's project master lists Owner Review and Deal File before project release, then concept/moodboard, space planning, renders, client approval, technical drawings, material selection, BOQ, procurement, manufacturing readiness, manufacturing, site works, installation, snagging and completion. On Hold is a cross-stage condition. Track named roles, priority/risk, client promise, handover date, next action/owner/date and meeting. Wodana should replace roughly twenty fragmented trackers only when their decisions and data actually live in the Job. Palm's stage names and commercial revision allowances are tenant configuration, not generic hardcoding.

The Palm go-live path is **clone and configure → two-person access/routing test → synthetic shared-form lead → qualification → Discovery/design/scope → quote/agreement and verified receipt → Owner Review/Deal File → released project → mobile field evidence → client handover and warranty**. Validate every handoff, denial, retry, empty/error state and client-safe view. Do not deploy or invite a wider team from this plan alone.

## 9. Quality bar and non-goals

- One meaningful primary action per view; concise labels; consistent gutters, alignment, type scale, light/dark contrast and responsive states. Compose feature UI from the shared component/form library and DataGrid, extending variants there rather than copying controls in feature folders. No raw feature `table`, `button`, `input`, `select` or `dialog` elements. Every list view uses the shared table system and its column-definition pattern. Tables keep a complete subtle outer boundary and row separators as the latest product direction; avoid nested/double borders. No broad gradients or pink UI; the blue gradient is for the Wodana logo mark only. Tenant colours are centrally configured and used sparingly for action/selection, not whole-page decoration.
- Every slice tests real data, permission denial, loading/empty/error, retries/idempotency, mobile reachability, accessible keyboard/screen-reader/RTL behavior, and cross-tenant isolation. A green unit suite alone is not release acceptance.
- No fake data presented as client activity, no silent state changes, no unverified provider claim, no production deployment without separate authorization, and no password/token/MFA material in documentation or test output.
- Do not promise a completion date from this blueprint. Estimate only after the baseline audit and dependency map. Ship vertical slices with evidence, not five unfinished modules in parallel.

## 10. Decisions to resolve without blocking safe foundation work

1. Map each existing project hard block to business gate, non-overrideable integrity rule or guided warning; sign off the exact override permissions before altering backend commands.
2. Approve Palm's final public form required fields, customer types, budget bands, first-response SLA and weekend duty roster. The lead document is internally inconsistent on whether budget/description are required.
3. Confirm Palm's technical designer/surveyor/sales-assistant role boundaries and whether moodboard/render round allowances are current contract terms.
4. Choose actual provider credentials and verify delivery for email, WhatsApp, accounting and native social intake. No connector can be inferred from a selected CRM channel.
5. Validate region-specific tax, privacy, invoicing and retention details before any compliance claim.

Proceed with [the task board](WODANA_TASKS.md) in order. When code disproves a planning assumption, record the finding and adjust the blueprint before implementing around it.
