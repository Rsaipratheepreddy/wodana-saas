# Wodana master plan — final

**Status:** for owner approval · **Date:** Friday 25 September 2026 · **First production:** Monday 28 September 2026 (Palm Living)
**This file is the only working plan.** It replaces `WODANA_PRODUCT_BLUEPRINT.md`, `WODANA_TASKS.md` and every dated plan/release note (they move to `docs/archive/` in M0). Palm business facts come from `docs/projects/PALM_LIVING_CONTEXT_2026-09-25.md` and `docs/qa-projects/palm-flow-v2-acceptance.md`; where this plan and those conflict, those win for Palm and this file is corrected.

Contents
0. Delivery roadmap (single plan, executed in order)
1. The honest position and release strategy
2. Product principles: minimal, productive, connected
3. Roles and separation of duties
4. The funnel: how a customer moves from first contact to aftercare
5. Service routes (flows)
6. Module specifications (purpose · records · states · rules · edge cases · events · screens · AI · tests)
7. Cross-cutting edge cases
8. Engineering rules and schema conventions
9. Build order, migration and cutover
10. Monday release (R1): scope, weekend work, go/no-go, rollback
11. Competitive position vs Dzylo
12. Decisions required

---

## 0. Delivery roadmap: one plan, executed in order (5 Oct 2026)

This section supersedes every earlier schedule in this file. §5a, §5b and §5c remain the design references.

### 0.1 Inputs, all covered
- **Palm tracker:** 128 items (PLM-001…128). An audit on 5 Oct found 60 built, 45 partial, 20 missing and 3 needing a decision, plus the "Enquiry Types Flow" tab and the Furniture A–E paths.
- **A second client's 14 points** (Shyam's notes; not Palm), so the product must serve both firms generically:
  1. audit trail
  2. cash
  3. P&L
  4. vendor payments
  5. payment approvals
  6. corporate card
  7. overheads
  8. BOQ → purchase
  9. every expense
  10. auto-trigger and allocation
  11. reminders and escalation
  12. warranty reminders
  13. quotation numbering
  14. change requests
- **Owner feedback:**
  - Notion-calm UI; strict table, tab, form and card rules; settings inside each module.
  - Planning list, project, site and overview screens.
  - Daily progress and PDFs.
  - Client portal: documents as cards, design comments both ways, warranty, feed.
  - Inbox scale and visibility; WhatsApp groups replaced.
  - Woddy as an agent; My day.
  - Materials and decisions ledger; Canva.
  - Robust notifications with consent; vendor portal (onboarding, KYC, bidding); mobile app.
- **Meeting, 2 Oct:** onboard up to the design close first; the enquiry type drives the steps; the inbox is the sales-admin front door; no WhatsApp groups.

### 0.2 Where we implement Palm's process more robustly than asked

| Palm asks | We build |
| --- | --- |
| Won when the payment proof is attached (PLM-122) | Attaching the proof creates the Deal File in the same action. AI reads the amount, date and reference; Finance verifies; the Owner approves and locks it. One record, no re-typing. |
| Material list sign-off (PLM-054), "client said X, now Y" | A **materials and decisions ledger**: every choice has a source, a time, evidence and a client confirmation. A change creates a new version with its price and time impact. Procurement is blocked until the list is locked. |
| Finance Requests board (PLM-107–110) | One **approval-policy engine** (amount thresholds, ordered approvers, Owner for large amounts, escalation) shared by invoice, refund and payable requests, POs, payments, discounts and change requests. There is no separate board to maintain. |
| Proposal 1 / Proposal 2 (PLM-103) | Two rounds inside one job, each with its own value, approval and Won date, reported once each (PLM-009). |
| Shared calendars design@ / logistic@ (PLM-090/091) | Team calendars inside Wodana synced with Google, without depending on shared mailbox logins. |
| WhatsApp groups | Inbox = front door → job room ⇄ client portal; WhatsApp only as the doorbell (§5b). |
| Reminders per item | One deadline engine for every step, task, approval, quote and payment: due-soon → overdue → escalation after N (default 3). Delivery runs with retries, fallback, consent and a health page. |
| Enquiry types and paths | Each enquiry type owns its steps (built), extended past Won into planning and production stages per type. |

### 0.3 Phases (strictly one after another; each ends verified on production)

| # | Phase | Scope | Exit check |
| --- | --- | --- | --- |
| P0 | **Stabilise** | Baseline r39 clean; fix failing tests (project-core date); e2e smokes (palm-flow, funnel) green; Palm demo data reset; triage the WIP stash 5 Oct (reuse only reviewed parts) | All suites green on HEAD |
| P1 | **Design foundation** | §5c D components and guard tests; apply to every list, tab, form and card; sentence-case titles; settings sheets inside modules (locations in Sales) | Before/after screenshots of every list and form; guard tests fail on violations |
| P2 | **Lead → enquiry** | PLM-025, 026, 029, 092, 096, 116, 024, 127, 100 · inbox front door, role visibility, File into job · consent captured on forms and portal | Live: form → lead with the right source/channel; duplicate → linked; inbox visibility per role |
| P3 | **Opportunity → Won → Deal File** | PLM-009, 066, 099, 101, 103, 106, 123, 082, 084, 085, 044, 080, 081 · proof → automatic Deal File · approval-policy engine · quotation numbering (13) · document audit trail (1) | Live: each enquiry type path end to end to an approved Deal File |
| P4 | **Design delivery + client portal** | PLM-049, 050, 051, 053, 128, 054 · materials ledger · design comments shared with the client · Canva · change requests (14) · portal revamp (feed, document cards, Q&A, warranty) | **Milestone A: CeCe onboarding up to the design close.** Tracker rows verified and updated. |
| P5 | **Daily operations and communication** | My day · deadline/escalation/auto-assign engine (10, 11) · notification robustness and health · daily progress rebuild · one PDF template · Woddy agent panel | Live: reminders fire and escalate; daily report → client feed |
| P6 | **Money: Wodana Books** | own double-entry books (E7) · second client's points 2–9 · PLM-067, 102, 107–113 · collections · P&L · cash · corporate card import | Live: P&L of a demo project reconciles to its records |
| P7 | **Production and procurement** | PLM-045, 046, 055–065, 068–074, 083, 086, 089–091, 098, 124–126 · BOQ → purchase · vendor portal (onboarding, KYC, bidding, PO acknowledgement) · Shopify core collection | Live: Furniture A–E and fit-out through delivery |
| P8 | **Reports, warranty, mobile** | PLM-104, 105 · warranty reminders (12) · mobile app parity (site, daily progress, approvals, My day) | **Milestone B: full handover.** |

Each phase also takes its research items from §0.7 (features R1–R14, AI ideas AI1–AI10, safeguards C1–C7).

### 0.3a Gaps found in the coverage check (5 Oct), now assigned

| Gap | Phase |
| --- | --- |
| **Re-verify the 60 items the audit marked "built"** (the failed retests of duplicates, form source/channel, returning customer, etc.). Every phase verifies the existing items in its area before adding new ones. | P2–P7 |
| **Enquiry-type steps editor matched to CeCe's Enquiry Types Flow tab** (her words, her paths; Interior Design mapped once she sends it) | P3 |
| **Project record revamp:** project overview, plan, money, site and handover tabs on the §5c D.7 anatomy | P5 |
| **Planning case revamp:** overview, requirements, site, moodboard and design tabs | P4 |
| **Site flow as one guided path:** visit → measurements → photos → checklist, on web and app | P4 |
| **Client portal moodboard:** Pinterest-style, Love/Avoid, comments | P4 |
| **Mobile app early, not last:** site check-in, daily progress, approvals, My day and the location settings everyone looks for move with P4–P5; full parity in P8 | P4–P8 |
| **Calendar and tasks robustness:** one calendar for meetings, visits, steps and deadlines; Google sync for every user | P5 |
| **Plan / work board:** sprints, stories, tasks and issues for projects | P7 |
| **Palm configuration data:** enquiry types, areas per Emirate, budget ranges, client types, design package prices, form branding, quote validity, roles per person. A checklist run with CeCe. | P2–P4 |
| **Catalogue:** real images replacing the placeholders; import the Core Collection with all fields | P3 / P7 |
| **External dependencies:** WhatsApp Business connection once Meta approves the app; Canva and Shopify credentials; Mailgun and push in production | tracked in every phase |
| **Arabic translation pass** for staff app and portal (strings via en.json; translated once, at the end) | P8 |
| **Operations:** monitoring and alerts, backup and restore drill, performance on large lists, security review of new tables (RLS) and permissions | P0 + P8 |

### 0.3b One system: eight shared engines every module uses
Each engine is built and tested once; modules only configure it. No module keeps its own status, reminders, approvals, files or chat.

| Engine | One job | Used by |
| --- | --- | --- |
| **E1 Job record** | One record from enquiry to warranty (enquiry → opportunity → case → project are views of the same job), with team per role, client, money summary and links | every module, the portal, My day, Woddy |
| **E2 Steps (flow)** | Enquiry-type steps through every phase (sales, design, procurement, production, handover); current step computed from records; gates; deadlines; owner per step | pipeline, planning, projects, factory, purchasing, portal stage line |
| **E3 Approvals** | Policies (what · amount ≥ X · approvers in order · Owner · escalation), separation of duties, one Approvals inbox | quotes/discounts, deal file, value lock, POs, vendor payments, expenses, refunds, change requests, stock corrections |
| **E4 Reminders and notifications** | Due-soon → overdue → escalate after N; delivery over in-app/push/email/WhatsApp with consent, retries, fallback, digest, quiet hours; health page; owner copies | every deadline and event |
| **E5 Documents and decisions** | Every file and decision versioned, with who/when/source/evidence; previews and cards; client-visible flag; Canva and PDF templates; audit trail | quotes, designs, BOQ, drawings, agreements, invoices, materials ledger, change requests, handover, warranty |
| **E6 Conversations** | One thread model with internal notes and client-visible messages; inbox (front door) → job room ⇄ portal; questions routed by stage; WhatsApp as doorbell | inbox, job room, portal, vendor portal |
| **E7 Wodana Books (own accounting)** | A true **double-entry general ledger** under every money movement: chart of accounts per region pack, journals posted automatically from receipts, invoices, vendor bills and payments, expenses, cash, card lines, payroll and overheads; per entity/branch with its TRN or GST number; bank feeds/statement import and reconciliation; AR/AP ageing; VAT/GST returns per region pack; period close and lock; P&L, balance sheet, cash flow, trial balance, project P&L. QuickBooks/Zoho become optional exports for firms whose accountant insists. | finance, projects, deals, procurement, payroll |
| **E8 AI agent (Woddy)** | Reads the record and context, proposes plans and actions as confirmation cards; never acts without a person; audited | every screen (side panel), My day briefing, extraction (payment proofs, chats → decisions) |

Phases P1–P8 first build or consolidate the engine a module needs, then the module's screens on top. A module may not ship its own variant of an engine.

### 0.3c Client mobile app and white-labelling (owner, 5 Oct)
- **Client mobile app:** the client portal as a native app (iOS/Android, same Expo codebase).
  - Sign in with mobile + code.
  - Feed, "Waiting for you", daily status, documents, payments (pay / upload proof), design comments, Q&A/chat, warranty claims.
  - Push notifications with consent.
  - Built in P4 alongside the web portal (same API and read models), released with Milestone A.
- **White-labelling (per firm), as configuration from Settings › Branding:**
  - name, logo, colours, fonts, email sender name/domain, WhatsApp templates, PDF templates, portal custom domain (e.g. portal.palmliving.ae);
  - **branded mobile apps via build flavours** (EAS app variants per firm: app name, icon, splash, bundle id, push credentials), published under the firm's store account or ours;
  - one codebase with a flavour config file per firm and a tenant lock in the flavour.
  - "Powered by Wodana" only where the plan allows.
- Added to P4 (client app + branding tokens) and P8 (store flavours per firm, custom domains).

### 0.3d WhatsApp templates, reminders and links (part of E4 + E6)
- **Each firm uses its own WhatsApp Business number.** It is connected by Embedded Signup; Wodana is the Tech Provider. Messages come from the firm's name and number (white-label).
- **Meta's rules, built in:**
  - Inside the 24-hour window after the client writes, free-form replies are allowed.
  - Outside it, only **Meta-approved templates** may be sent.
  - Templates have a category: Utility (reminders, updates, payments) or Marketing (promotions). Utility is used for operations and costs less.
- **Template library:**
  - Wodana ships ready templates per event and language: quote ready, design ready for approval, payment due/overdue, payment received, site visit confirmed/reminder, daily update ready, question waiting, handover, warranty visit, document shared.
  - When a firm connects WhatsApp, Wodana submits the templates to Meta for that firm and tracks approval (pending/approved/rejected with reason).
  - Firms edit the wording in Settings › Inbox › Templates. Fields such as {{client}}, {{amount}} and {{date}} fill from the record.
- **Event → template mapping** (per module notifications sheet): which event sends which template to whom, plus the reminder cadence (e.g. payment: 3 days before, on the day, 3 and 7 days after), quiet hours, and at most one reminder per day per client. Reminders run on the E4 deadline engine and stop the moment the action is done (paid, approved, answered).
- **Links:** each message carries a button with a **signed deep link** straight to the exact item in the client portal or app (e.g. "Approve design" → that design).
  - The link is short, expires, and is bound to the contact.
  - If it has expired, the client signs in with mobile + code and lands on the same page.
  - The app opens it if installed (universal/app links).
- **Consent and opt-out:** sends only with WhatsApp consent recorded (form, portal, or chat opt-in). STOP/opt-out is honoured automatically. Without consent or on failure, Wodana falls back to email, then push, then SMS.
- **Tracking:** sent / delivered / read / failed per message (Meta webhooks) on the record and on the Notification health page; failures alert the firm admin.
- **Costs:** utility templates only for operations; digests group several updates into one message; usage per firm shown in Settings.
- **Replies:** a client reply to a template opens the 24-hour window and lands in the job's conversation (E6), routed to the stage owner.
- **Delivered in:** P2 (connection, template library, consent), P5 (event mapping, reminders, deep links, fallback, health).

### 0.4 How each phase is executed, to keep bugs out
1. **Spec first:** journey, fields, rules, screens and edge cases written into §6 for the module, then reviewed.
2. **Build:** one owner agent per phase (Opus for logic and UI; Fable only for mechanical sub-tasks, with an exact brief). At most two agents run at once, never in the same code area.
3. **Gate:** unit + integration + e2e smoke tests; token and lint guards; typechecks.
4. **Deploy, then verify live:** click through each acceptance case on plm.wodana.ai, with screenshots.
5. **Tracker:** only verified items are marked Done, each with a one-line comment for Palm.
6. **Short release note** to the owner. Nothing starts in the next phase before the current one is verified.

### 0.5 Decisions needed from Palm
1. PLM-009: how Won is reported for Proposal 2.
2. PLM-024: who can see internal notes.
3. PLM-029: Digital Marketing lead format.
4. The ODG / Architecture path.
5. Interior Design flow mapping (Enquiry Types Flow tab).
6. Finance approvers and amount thresholds.
7. Refund timelines.
8. List of entities, licences and TRNs.
9. Calendar choice: Wodana calendars or Google shared calendars.

### 0.6 Handover
- Per-role training scripts and short videos on real data.
- Admin guide (enquiry types, steps, roles, approvals, notifications).
- Data import (clients, catalogue, suppliers).
- Go-live checklist, backup and restore test, support window.

### 0.7 Public research (6 Oct): what we add, and why
**Sources:** Capterra and Software Advice low-star reviews, Trustpilot, App Store, Houzz homeowner forums, CPA and designer blogs, competitor changelogs (Houzz Pro/Ivy, Programa, Mydoma, Studio Designer, DesignFiles, Fohlio, Buildertrend, JobTread, Dzylo, Atelier, HomeLane, UAE fit-out ERPs). Reddit, G2 and X were not reachable by the research tools.

**What the market says, in four lines:**
1. Clients and firms fight over **what was agreed** and **what it costs**: a final bill far above the quote, "extras" never agreed, hidden markup.
2. **Procurement silence** loses both margin and goodwill: backorders, damage, items that don't fit, nobody knows the delivery date.
3. Buyers punish **broken promises around the product**: QuickBooks "integration" that means typing twice, slow support, lock-in contracts, no bulk export, weak mobile apps.
4. AI is wanted for **admin and paperwork**: logs, client updates, bills, meeting notes. Flashy design features rank lower. About half of contractors don't trust AI accuracy yet.

Our existing plan already answers much of this: the decisions ledger, approvals, own books instead of a sync, the offline outbox, allowance lines, retention, the client portal, export (§7). The additions below fill what is still missing. Each goes into its phase's spec (§6) and gets tests like any other item.

**A. Features added**

| # | Add | Phase | Reason (evidence) |
| --- | --- | --- | --- |
| R1 | **Client budget tracker** in the portal: agreed value + approved changes + allowance spend = forecast final, with every change linked to its approval | P4 | Homeowners' top complaint is a final bill above the quote (Houzz threads; 78% of renovations go over budget). It ends "surprise" bills. |
| R2 | **Item-level client approval** with good/better/best options and **alternatives on rejection** (in-budget, in-stock, from the catalogue and past jobs), all written to the decisions ledger | P4 | "But you said…" disputes; Studio Designer users ask for item e-approval; Programa and Buildertrend ship options. |
| R3 | **Markup disclosure as a firm setting:** fee-based, disclosed markup, or all-inclusive price, applied the same way to quote, invoice and portal | P3 | Hidden markup is a top homeowner grievance (Houzz). This is configuration, not a branch. |
| R4 | **Product clipper and product library:** paste a supplier link or use the browser button; AI fills name, price, dimensions, finish, lead time and images; reused across jobs | P4 | The most frequent sourcing action; praised in Houzz Pro, DesignFiles and Programa reviews. |
| R5 | **Fit check:** item dimensions checked against the measured door, lift, stair and wall sizes from the site visit before an item is approved or ordered | P4 → P7 | "The couch doesn't fit through the door" and non-returnable items (Houzz threads). Nobody does this well. |
| R6 | **Client order tracking:** each client item shows ordered → acknowledged → shipped → delivered → installed with an ETA. A slipped ETA drafts the client message for a person to send. | P7 | "No one can tell me when my order will be delivered" (Havenly, Houzz). |
| R7 | **Client deposits held per job and drawn against orders**, visible to the client (deposit → ordered → delivered) | P6 | "Took the deposit and never ordered" disputes; trust accounting in Studio Designer. |
| R8 | **Native e-sign** for proposals, agreements, change requests and handover: typed or drawn signature, signer identity, IP, time, document hash and certificate page. DocuSign becomes optional. | P3 | Every competitor has it. Our signed record must sit with the decisions ledger, not in a third party. |
| R9 | **Time tracking billed to the client:** timer or entries per job and phase, billable flag, hourly fees on invoices, cost into project P&L | P5 (capture) · P6 (billing) | Design fees leak. Programa, Studio Designer and Mydoma have it; DesignFiles and Houzz Pro users complain theirs is weak. |
| R10 | **E-invoicing per region pack.** UAE: Peppol PINT AE via an accredited provider. Large taxpayers appoint one by 30 Oct 2026 and go live 1 Jan 2027; everyone else goes live 1 Jul 2027. India GST e-invoice follows the same adapter. Numbering is gap-free and issued invoices are immutable from day one of Wodana Books. | P6 (design), live before 1 Jul 2027 | A legal deadline for Palm and every UAE firm. Retrofitting it later would mean reworking the books. |
| R11 | **Change requests emailable and signable without a portal login** (signed link) | P4 | Buildertrend reviewers: "you can NOT email a change order". Clients ignore portals. |
| R12 | **Card-fee pass-through and payment links** where the region pack allows surcharges | P6 | Protects margin (StudioPay); legality differs by country, so it lives in the region pack. |
| R13 | **Notification control per person:** mute non-critical events per module, digest instead of a stream; critical events (approvals, payments, deadlines) can't be muted | P5 | "Can't turn off notifications" (Buildertrend). It keeps E4 trusted. |
| R14 | **Hide unused fields** per firm for each form and grid (configuration, never deletion) | P1 | "Need to turn off unused fields" (Programa); our Notion-calm rule. |

**B. AI ideas added to E8 (all propose → person confirms, with source, confidence and undo)**

| # | Idea | Phase | Daily pain it removes |
| --- | --- | --- | --- |
| AI1 | **Walkthrough → daily report:** photos and a voice note become the daily report, snags pinned to rooms, and tomorrow's checklist | P5 | Writing reports at night; the owner called daily progress the worst screen. Buildertrend's AI photo summary is called "gold". |
| AI2 | **"What changed since you last looked"** per viewer (client, manager, owner), built from the ledger and job events, respecting visibility | P4 (portal) · P5 (staff) | Client updates take an hour (Buildertrend: 60 → 6.5 min); "the designer went silent". |
| AI3 | **Unbilled-change detector:** reads job conversations and meeting notes for requests ("add a light here") with no matching change request and drafts one | P5 | Silent margin loss; disputed extras. |
| AI4 | **Margin-leak radar per project:** quoted cost vs committed POs, labour, time and changes; flags vendor price creep, unbilled changes, and spend growing faster than progress | P6 | Firms learn they lost money only at the end (UAE fit-out commentary; Red Zone in §6.21). |
| AI5 | **Vendor documents reader:** quote PDF or email → normalised bid comparison against the price request; bill → three-way match with PO and receipt; variance over 10% → alert | P7 | Retyping supplier quotes and bills (Buildertrend Bill Capture, Fohlio). |
| AI6 | **Order-acknowledgement watcher:** supplier replies parsed for changed dates, quantities or substitutions → PO update + client message + schedule shift, proposed | P7 | Backorders found by the client first (Canals, Studio Designer). |
| AI7 | **Voice note → tasks and decisions** (English, Arabic, Hindi, mixed) | P5 | WhatsApp voice notes are how site teams work today. |
| AI8 | **Ask the job:** "why did we switch the countertop?" answered only from the job's ledger, messages and files, with citations; no citation → no answer | P5 | "I never said that" disputes; staff turnover loses context. |
| AI9 | **Approval chaser with impact:** reminders, escalation, plus "each extra day moves handover by N days" from the steps engine | P5 | Waiting on client approvals is the most common delay. |
| AI10 | **Meeting notes → actions:** record or upload; summary, decisions to the ledger, tasks, client-shareable version | P5 | Programa and Houzz Pro ship it; meetings are where scope changes. |

**C. Engineering safeguards added (§7 and §8 apply them).** Phases: C1 → P6 (books, e-invoice) and P7 (Shopify); C2 → P2 (WhatsApp connection) and P5 (E4 delivery, AI); C3 → P3 (the first AI read, payment proofs) and every later AI feature; C4 → P1 (CI budgets on seeded data) and P8 (status page); C5 → P8 (whole-workspace export; grid CSV exists); C6 → P8 (control plane); C7 → P5 (mobile daily progress).
1. **External sync ledger.** Every push to QuickBooks, Zoho, Shopify or an e-invoice provider stores the external ID, a sync status per document, retries with an idempotency key, and a reconciliation report. A sync never touches a closed period. *Reason:* competitor syncs corrupt books (Houzz Pro, Mydoma backdated invoices).
2. **Integration cost metering per tenant** for WhatsApp messages, AI tokens and paid APIs, with budgets and alerts. Utility templates only for operations; fallback to push or email. *Reason:* Meta per-message pricing (July 2025) and Intuit metered API calls (2025) changed costs under customers.
3. **AI provenance.** Every AI-made field keeps source document/page, model, confidence and the person who confirmed it. Undo is a compensating command. *Reason:* about 50% of contractors distrust AI accuracy; trust comes from evidence.
4. **Performance budgets** (list p95 < 300 ms server, page interactive < 2 s on 4G) checked in CI on seeded large data, and a public **status page**. *Reason:* "slow and sometimes non-responsive" is a top complaint (Studio Designer).
5. **Self-serve full export** (CSV + files, per job or whole workspace, as a background job with a download link) tested in the e2e smoke. *Reason:* lock-in is a top reason firms hate their tools.
6. **Honest commercial terms in the control plane:** monthly plans, renewal reminder 30 days before, self-serve cancellation, export kept for 90 days. *Reason:* about 98% of Houzz Pro's negative reviews are billing and renewal.
7. **Offline capture order:** photos upload before text and the pending count is visible. This extends the §6.29 outbox. *Reason:* offline field capture loses trust when the sync queue is invisible (Buildertrend, Procore).

**D. Considered and not adopted**

| Idea | Decision | Reason |
| --- | --- | --- |
| Lead marketplace (Houzz model) | Decline | It creates a conflict of interest with our firms' clients (Business of Home), and lead quality is the top Houzz complaint. |
| Own 3D/AR rendering engine | Defer; integrate | Not daily operations. Canva (planned) plus partner render tools cover it; revisit after P8. |
| SketchUp/Revit plugins | Defer after P8 | Valuable for specification-heavy firms, but no current client needs it. |
| Factory nesting / cut lists from drawings | Pilot after P7 | Depends on each firm's CAD data. |
| Open AI connector (MCP server) | Defer to P8 | Proven demand (JobTread), but scoped, audited, read-first access needs E3 and E8 stable first. |
| Per-volume or per-project pricing | Decline | Buyers say it punishes growth. Price per workspace + seats. |

---

## 1. The honest position and release strategy

**What exists and is locally proven:**
- Workspace, identity and MFA, roles, the tenant control plane (provisioning, seats, entitlements, billing views), CRM (intake, SLA, assignment, qualification, opportunities), discovery (briefs, rooms, site records, designs, baselines) and catalog are relational and tested.
- The Palm commercial path passes an isolated API journey: two paid quote rounds, QS review, portal acceptance, Finance verification, Owner approval, one Deal File and project, then material sign-off, procurement, factory, site, snag and handover.

**What is weak:**
- Commercial and project data each live in one JSON document per record (`commercial_cases.content`, `project_execution.content`).
- A purchase order holds only one material for one task.
- Partial factory allocation is design-only.
- Tasks are split between project JSON and CRM follow-ups.
- Notifications have three paths, and reminders very likely don't fire (RLS).
- Money is handled as floats.
- Palm logic is hard-coded in core.
- The web app has two component libraries and inconsistent styling.

**Strategy — two tracks, no big-bang rewrite:**
- **Track R (release):** ship **R1 on Monday** with a deliberately narrow, hardened scope (§10): the funnel from enquiry to an approved Deal File and project, project stages and material sign-off. Everything not verified is hidden behind capability flags, not shown half-working.
- **Track V (v2):** rebuild module by module on relational tables (§6, §9). Each module goes live behind a flag after its tests and a Palm check, then replaces the old path. Palm stays in production throughout; no data is thrown away.

The rest of this document is the **complete v2 target**. R1 is the subset of it that ships Monday.

---

## 2. Product principles: minimal, productive, connected

**Minimalism (enforced in review):**
1. One primary action per screen. Secondary actions live in a `⋯` menu.
2. Every list is the shared DataGrid. Opening a row gives a right-side **inspector drawer**, not a new page, unless the record is a workspace (project, deal).
3. No decorative KPI tiles. Numbers appear only when they drive a decision, and each links to its list.
4. Navigation is at most two levels: sidebar group → page → tabs. No tab has sub-tabs.
5. Forms show at most 7 fields at first; the rest appear progressively. Defaults are prefilled from the source record, so nobody retypes a room, item, customer or amount.
6. Status is one chip with a semantic colour: neutral (draft), blue (in progress), amber (waiting/at risk), red (blocked/overdue), green (done), grey (cancelled/archived).
7. Every empty state gives one sentence and one action. Every error says what happened and what to do next.
8. Sizes are fixed: about 6 type sizes, 3 radii, 2 shadows, 4px spacing grid, 32px controls and 36px table rows. Tenant accent is used only for primary action and selection.

**Content rules (fixing what went wrong before — duplicate titles and walls of text):**
1. **One title per view.** The sidebar item, breadcrumb and page title never repeat the same word stack. A page has no H1 that repeats the sidebar label; the record name is the title (e.g. "PRJ-0042 · Al Barsha Villa"), not "Projects › Project › Project details".
2. **No section repeats its parent's name.** Inside "Materials", a card isn't titled "Materials summary".
3. **No explanatory paragraphs on working screens.** At most one line of helper text under a field, when needed. Longer guidance goes behind an ⓘ tooltip or the docs link.
4. **Labels ≤ 3 words, buttons ≤ 2 words** (verb first: "Issue quote", "Receive"). Status chips are one word.
5. **Show the state, not a description of it.** "Blocked · drawing D-12 not approved", not a paragraph.
6. **No duplicated data blocks.** A fact appears once per view; related records show as links, not copies.
7. **Numbers only where they drive a decision** (see minimalism rule 3).
8. A **UI copy review** is part of every module's definition of done. A lint check flags page headings that duplicate the nav label, and strings longer than 120 characters in feature components.

**Productivity:**
- `⌘K` command palette for navigating, creating and searching anything.
- Inline editing in tables, bulk actions, saved views per user, and keyboard shortcuts on lists (j/k, e, enter).
- **Home = "My next actions"**: every item says what is needed, why, by when, and gives a button that does it.
- Records create their follow-ups. An accepted quote creates the agreement and payment request, a released package creates its tasks, and a failed QC creates a snag and rework. People edit instead of retyping.
- Mobile capture (photo + quantity + note) takes under 60 seconds and works offline.
- Templates everywhere: quote, package→tasks, payment schedule, checklists, messages.

**Connectedness:** one identity chain `Customer → Enquiry → Opportunity → Deal → Project → Package → Task`, one space tree `Site → Room/Zone → Item`, one timeline per deal/project, one approvals engine, one task system, one notification service.

---

## 3. Roles and separation of duties

Role names are tenant-configurable; these are the **capabilities** the system checks.

| Role (Palm default) | Can | Cannot (enforced) |
| --- | --- | --- |
| Owner/Admin | configure the workspace; approve Deal rounds; approve overrides | approve a round they submitted or Finance-verified |
| Sales / Account manager | enquiries, opportunities, requirements, quote drafts, deal submission, client comms, schedule material selection | approve their own quote's QS review; verify money |
| Sales Admin | prepare and issue quotes after QS | change an issued or accepted revision (must revise) |
| Quantity Surveyor | review estimate: quantities, cost, margin; approve or return with reason | issue to the client; accept on the client's behalf; verify money |
| Finance | verify receipts, commissions, supplier invoices and payments; refunds | final Deal approval; production release alone |
| Operations approver | approve Deal/release when configured instead of Owner | be the submitter or Finance on the same decision |
| Designer / Technical lead | design deliverables and revisions; technical drawings | treat a moodboard approval as a fabrication approval |
| Project manager | plan packages and tasks, owners, dates; publish client updates; request approvals | mark gates done manually; approve own snag closure |
| Buyer | RFQ, supplier award, PO drafts, expediting | approve own PO above threshold; self-receive and self-inspect |
| Storekeeper / Receiver | receive, move and issue stock | accept QC they performed as the producer |
| Factory lead / Operator | work orders, output reports | approve own output; QC own output |
| QC inspector | inspections (output, receipts, installation) | inspect own work |
| Site supervisor | daily reports, installation progress, snags, site receipts | approve own progress |
| Client (portal) | view published items; accept or reject revisions; pay; accept handover | see cost, margin, suppliers, internal notes, risk |
| Vendor (portal) | view own POs; acknowledge; update dates; dispatch notes; invoices | see other vendors, prices or projects |
| Wodana operator (control plane) | provision tenants, support sessions (time-boxed, audited) | read tenant data outside an approved support session |

A separation rule is configured per approval step (`approval_policies.separation_rule`: `not_submitter`, `not_previous_approver`, `different_team`). A **small tenant** (one person doing two roles) can explicitly waive a rule; the waiver is recorded on every affected decision and shown in reports.

---

## 4. The funnel: first contact to aftercare

```text
 INTAKE ─▶ ENQUIRY ─▶ OPPORTUNITY ─▶ QUOTE ROUNDS ─▶ DEAL SUBMISSION ─▶ DEAL FILE + PROJECT ─▶ DELIVERY ─▶ HANDOVER ─▶ AFTERCARE
 form/QR   triage      qualify,       design/main     agreement +         first round paid        stages from   client       warranty
 WhatsApp  dedupe      requirements   QS → issue →    payment proof +     & owner-approved        the route     acceptance   claims →
 ads/call  assign/SLA  site visit     client accept   commission split    (exactly one)                                        tasks
                                                      → Finance → Owner
```

### 4.1 Intake → Enquiry
- **Sources:** public form/QR, staff manual entry, WhatsApp inbound, email, Meta Lead Ads, PlyLeads, phone log, walk-in. Four separate dimensions are recorded: **source** (where from), **channel** (medium), **intake method** (form/manual/automated) and **assignment method** (queue/named).
- **Raw intake is stored as-is** (`crm_intake_events`); the enquiry is created from it. Original answers are never overwritten.
- **Dedupe:** match on normalized phone (E.164), email and name + area. A match creates a duplicate candidate for review; nothing is merged automatically. An open enquiry from a known customer is linked to the existing customer and starts a new enquiry (repeat business).
- **Required at intake (Palm, tenant-configurable):** name, phone (country code), Emirate, enquiry type (temporary "Not sure" allowed; Sales must resolve it before qualification), consent. Optional: area (depends on Emirate), budget band, description.
- **Reference:** `ENQ-YYYY-#####` from sequences, read-only. The title is generated as "Name · Type · Area" and can be edited.
- **Assignment:** company forms, QR and ads go to the Sales queue by rules; staff-created and self-generated enquiries go to the named salesperson. Office hours: Mon–Fri 08:00–18:00 Asia/Dubai; weekend enquiries still notify the duty roster or queue.
- **Takeover:** if the owner logs no call or note within **60 elapsed minutes**, the enquiry moves to the next eligible owner or the queue, with audit and alert. A note stops takeover but does **not** satisfy the first-response SLA, which is a separate timer.
- **States:** `new → contacted → qualified | disqualified (reason) | duplicate (merged into X)`. Reopen is allowed with a reason.

### 4.2 Opportunity
- Created by **Convert** from a qualified enquiry. It carries the customer, contacts, needs and history; nothing is retyped.
- **Pipeline** (Palm labels): `New Opportunity → Requirements → Proposal → Negotiation → Won | Lost (reason)`. Stage names are tenant configuration; the underlying kinds are fixed.
- **Service route** is chosen here (§5) and is required before the first quote. A route change later is allowed with a reason until the Deal File exists; after that it is a change order.
- **Won** = the client accepted the issued quote of the first applicable round. This is a Sales outcome, not proof of money. Every Deal File comes from a Won opportunity, including showroom furniture.

### 4.3 Quote rounds (per route)
- `design` round (design fee), `main` round (fit-out/furniture) and `variation` rounds (after the project exists).
- Each quote: `draft → in_qs_review → qs_approved | qs_returned → issued → accepted | rejected | expired → superseded`.
- A QS approval is bound to the quote's `content_hash`. Any edit invalidates it.
- The client accepts through the portal (OTP-verified) or staff record acceptance with evidence (signed PDF or email). Acceptance is bound to the issued hash plus the chosen options.

### 4.4 Deal submission → Deal File → Start project
- After acceptance, Sales submits the **deal round**: agreement (file), payment proof (receipt), and a commission split (1–3 lines, provisional). Finance verifies the receipt and finalizes commission; Owner/Operations approves (a different person from the submitter and Finance). The first approved round creates the **Deal File** (`DEAL-YYYY-####`).
- **A project starts only from an accepted quotation** (*Start project* on the accepted quote, or *Start project* on the Projects page). The firm's **start rules** (Settings → Projects) decide what must be true first: signed agreement, verified payment(s) marked "before the project starts", owner approval — each can be switched off. A design-fee quotation never starts a project; design stays in Planning.
- Starting is one idempotent command per planning record: it seals the scope (§6.10), numbers the project, names the team, copies the route's stages, carries the planning record's people and site locations over, links the opportunity and Job, and makes Planning read-only. Later accepted quotations (variations) attach to the same project.

### 4.5 Delivery → Handover → Aftercare
Project stages come from the route (§5). Work is done through packages and tasks (§6.11), materials and purchasing (§6.12–6.15), factory (§6.16) and site (§6.17). **Complete** requires the client's handover acceptance and the final account being closed. **Aftercare:** warranty period from the handover date (in the tenant's timezone); claims become snags and tasks.

### 4.6 Cross-funnel conditions
- **On Hold** (deal or project): freezes advancement, keeps stage and evidence, and records reason, owner and review date. Reminders go to the owner on the review date.
- **Lost / Cancelled:** an opportunity is lost with a reason. Cancelling a deal after money has been received requires a refund or retention decision by Finance; the project is cancelled with a cost reconciliation.
- **Client unresponsive:** decision requests send reminders at +2 and +5 days (configurable), then flag "Awaiting client" on Home.

---

## 5. Service routes (flows)

Routes are **workflow templates** (data, versioned). A project freezes its route version at creation.

| Route | Before Deal File | Project stages |
| --- | --- | --- |
| **Design + fit-out/furniture** | Requirements → Design quote → QS → client → agreement + verified payment ≥ floor → Owner | Site Visit & Scope → Design & Specifications → *Main quote round* (QS → client → agreement/payment → Owner) → Material List Sign-off → Procurement → Manufacturing Readiness → Factory Production → Site Works → Installation → Snagging → Client Handover → Aftercare |
| **Design only (moodboards/design)** | same as above | Site Visit & Scope → Design & Specifications → Design Acceptance → Complete |
| **Furniture only (manufactured)** | Requirements → Main quote → QS → client → agreement/payment → Owner | Material List Sign-off → Procurement → Manufacturing Readiness → Factory Production → Delivery/Installation → Snagging → Handover |
| **Ready-made furniture** | same as furniture only | Material List Sign-off → Procurement → Delivery/Installation → Snagging → Handover (no factory stages) |
| **Fit-out only (contractor)** | Main quote → … | Site Works → Installation → Snagging → Handover |
| **Blank** | configurable | configurable |

Rules:
- A stage is **computed** from evidence and gate approvals. A PM may move within the allowed transitions; skipping needs an applicable-route reason and never bypasses a gate.
- **Mixed items:** one project can hold ready-made and manufactured packages. The project stage is the earliest incomplete stage across applicable packages; each package has its own route.
- **Route change mid-project** (design-only client adds fit-out): add a main round to the same Deal. The project route template is upgraded by an audited command that appends the delivery stages; nothing already done is rewritten.
- **Packages may overlap stages** when their own prerequisites allow it (e.g. kitchen in factory while bedroom is still in design). Stage labels are summaries, not permissions.

**Hard gates (never overridable):**
- **H1** QS approval on the exact revision before issue.
- **H2** Finance-verified receipt ≥ floor, plus Owner approval, before a Deal/round is released.
- **H3** Production payment milestone verified before factory start (when the route has one).
- **H4** Client handover acceptance before Complete.

Integrity rules (quantities, money, evidence, tenant isolation) are also never overridable. Everything else is a **guided warning** that an authorized role can override with a reason; the override is recorded and reported.

### 5a. Flows: one job, one line, configured by the firm

**Promise to the user:** every screen answers three questions: *what is happening now*, *who does it*, *what comes next*. One step at a time, plain words, and a real face on every step.

**Concepts.** Keep these four and no others.

| Concept | What it is |
| --- | --- |
| **Flow** | A versioned, published template, chosen by the enquiry type (its own top-level navigation item **Flows**, placed above Sales; shown to people who can manage flows, everyone else sees only the result). Firms edit flows from enquiry until production starts. Production and delivery flows are read-only in R1. |
| **Step** | One card on the flow. It has: a plain name, **who** (a role), **done when** (one check from the catalogue), **needs** (required fields), **deadline**, **tell** (notifications), **client sees it** (yes/no), **optional** (yes/no), and **column** (the pipeline column the job enters when this step completes). |
| **Branch** | Splits the line on one question: sub-path, package, budget band or client type. Each answer leads to its own steps, and the paths rejoin. |
| **Job** | An opportunity running a pinned flow version. Its current step is computed from the records. The column is computed from completed steps and is never set by hand. |

**Check catalogue.** Product-defined, read from real records, never typed in. The flow only chooses among these:
- contact logged · details complete (fields chosen per step) · intro meeting completed · client type set · sub-path chosen · feasibility confirmed · package chosen · discovery complete · site visit recorded;
- quote exists · QS approved · quote sent · client accepted · client approved on the spot · payment proof attached · payment verified · deal approved;
- design stage done (by name) · material list signed off.

New checks are added in code, once, for every firm.

**Engine rules** (never configurable):
1. A move forward must pass every step in between. Moves backward and to Lost are always allowed and audited.
2. **Won ⇔ payment proof attached** (PLM-122), in every flow. The publisher rejects a flow without it.
3. A published flow is immutable. Edits create a new version. Running jobs keep their version unless an admin migrates them, previewing the effect per job first.
4. The interpreter falls back to the built-in starter flows when a workspace has none, so nothing breaks while firms configure.
5. Every step completion, skip (with reason) and reassignment is an audited event. Notifications use the module's branded templates.

**Starter flows.** Each one is equivalent to the gates live since r30, with tests proving it.
- Furniture: a branch on sub-path A–E. A–D auto-qualify; E needs feasibility; Negotiation is optional.
- Design: details → intro → qualified → package/discovery → design quote → accepted → payment proof.
- Fit-out: details → intro → site visit → QS-priced quote → accepted → payment proof.
- Basic: payment proof only.

**UI. This is our USP.** Calm, one thing at a time, real avatars.

1. **Opportunity screen**
   - Header: title · client · value · owner avatar · one stage chip · **Edit** · **⋯** (Lost, history).
   - There is **no Won button**: Won is the result of the payment proof step.
   - One **Now card**: the step name as a verb ("Book the intro meeting"), one line of why ("Needed to move to Qualified"), the assignee avatar with a **Reassign** popover (people list with avatars), the due date, and **one primary button**.
   - Under it, "Then" shows the next two steps greyed.
   - One **progress line** of dots (✓ done with the doer's avatar on hover, ● now, ○ next). Clicking a dot shows that step's needs.
   - Tabs: Details · Activity · Files.
   - Removed: stage pills, the Progress tab timeline, the info box, and the Won/Change stage buttons.
2. **Board**
   - Card: client · value · now step · assignee avatar · due/overdue chip.
   - A refused drop shows one small sheet, "To move to *Won*: attach payment proof [Attach]".
3. **Flow builder** (top-level **Flows**, above Sales; React Flow, `@xyflow/react`, MIT, styled only with our tokens)
   - **Left:** Components, grouped as Contact · Meetings · Sell · Design · Logic. Each shows an icon and a one-line description.
   - **Centre:** a top-to-bottom canvas with snap and auto-layout. Steps are cards showing name, role avatar, check and deadline. The pipeline columns are soft background bands. Branches are drawn as labelled forks.
   - **Right:** properties of the selected card, in plain words with pickers only (no free-text rules).
   - **Top bar:** flow name · used by (enquiry types) · **Preview** (simulate a job: click "complete" step by step and watch the Now card, the board column and the client portal update side by side) · **Publish** (runs the validator: no dead ends, Won has the proof, every step has a role, every branch answer leads somewhere).
   - Keyboard accessible, RTL, and a mobile read-only view.
4. **My steps** (home): steps waiting on me, overdue first, one button each.

**Delivery plan.** Each phase ships alone. Nothing live breaks: the starter flows reproduce today's gates first.

| Phase | Build | Owner | Done when |
| --- | --- | --- | --- |
| F1 | Opportunity screen and board card on the current gates | Opus | Interior Design shows one Now card; the duplicated progress UI is gone; tests pass |
| F2 | `crm_flows` and `crm_flow_versions` (definition JSON = configuration; forced RLS); enquiry type → flow; job pins the version; the interpreter replaces the hard-coded gates; starter flows seeded per workspace on first read | Opus | Equivalence tests: starter flows give the same results as r30 gates for every flow × stage |
| F3 | Flow builder: palette, canvas, properties, validator, versioned publish | Opus (canvas, validator) + Fable (palette metadata, en.json keys, component tests) | A firm changes the Design flow, publishes, and a new job follows it |
| F4 | Preview simulator; "My steps"; deadlines and notifications per step; portal "Waiting for you" follows client steps | Opus + Fable | Preview matches live behaviour; reminders fire |

### 5b. Client communication: three places, one job each

| Place | Job | Who sees it |
| --- | --- | --- |
| **WhatsApp Inbox** | The front door: new leads until an enquiry exists | Sales Admin team and the assigned owner only |
| **Job room (staff) ⇄ client portal** | Everything about one job, sorted by type: questions, decisions, documents, updates, payments | The job team, each person added when their step starts (Sales → Designer → PM); the client sees only client-visible items |
| **WhatsApp / email** | The doorbell: "1 new update, 1 question → open your portal" | The client |

There are no WhatsApp groups. A known client's WhatsApp message is filed into their job and the job owner is told.

**Portal home is a feed.**
- **Top:** a stage line and "Waiting for you" action cards.
- **Daily status rings:** one per day, holding that day's photos and video.
- **Card feed, newest first.** Card types:
  - **Progress:** a carousel, with "Looks good" / "Ask about this".
  - **Document:** a preview thumbnail, title, type chip, status, and View / Download. Never a bare link.
  - **Decision:** Approve / Request changes.
  - **Payment:** amount, due date, Pay / Upload proof.
  - **Question for you:** answered with options or text.
  - **Meeting:** with "Add to calendar".
  - **Milestone.**
- **"Ask a question":** routed to the owner of the current stage.
- **Tabs:** Home · Questions & chat · Documents · Payments · Design.

**Inbox.**
- A compact search icon, and the chips Unassigned · Mine · Team · Closed.
- Visibility per role: own / team / manage.
- "File into job" on any chat.

**Order.**
1. **P1, portal cards.** Fable builds the presentational cards; Opus reviews them.
2. **P2, portal feed + Q&A + daily status.** Opus.
3. **P3, job room + stage routing + notifications.** Opus.
4. **P4, inbox visibility and compact UX.** Opus.

**Brief template for Fable tasks:**
- Exact files to touch.
- The data shape.
- The labels (verbatim, for en.json).
- The tests to add and the commands to run.
- An explicit "do not change" list.
- A one-screenshot acceptance check.

Fable never designs UI or logic: it implements a brief Opus wrote and Opus reviews the diff.

---

### 5c. Unified product revamp (owner + Palm feedback, 5 Oct 2026)

**Diagnosis.** Each screen invents its own layout. Tables, tabs, filters, cards, forms and gaps differ from page to page. Settings hold things people look for inside the module (e.g. locations). Funnels run in parallel. People are confused.

**Bar:** Notion-grade calm. One way to do each thing, everywhere.

**D. Design system: strict rules, enforced by components and tests**
1. **Page shell:**
   - Sticky header: one title, at most one primary action top-end.
   - Toolbar: search icon, *used* filters only, view switch, ⋯.
   - Content.
   - No uppercase titles, no decorative chrome.
2. **Table:**
   - Compact rows (40px).
   - First column = name + one muted secondary line.
   - Status as one semantic chip.
   - Owner as an avatar.
   - Numbers right-aligned.
   - Row click opens the record.
   - No horizontal scroll at ≥1280px; columns hide by priority.
   - Unused filters hidden; saved views as tabs only when they hold data.
3. **Tabs:** under the title, never more than 6; the active tab is bold with an underline; counts shown only when actionable.
4. **Forms:**
   - Single column, max ~40rem, label above field, equal field heights.
   - Sections divided by a hairline and a section title.
   - Save bottom-end.
   - Errors listed at the top and on each field.
   - Side sheet for edits; dialogs only for confirmations.
5. **Cards:**
   - One radius, one padding, one shadow.
   - Header (title + chip + action) · body · footer.
   - Grids of equal heights.
6. **Spacing:** the 4px grid inside components, φ rhythm between sections. One gap scale per page type.
7. **Record detail:** main column = the next step (action card); sidebar = Overview · Details · Files. The same anatomy for opportunity, case, project, order, vendor.
8. **Settings live in the module:** each module has its own "⋯ › Settings" sheet (Sales: enquiry types, sources, locations; Projects: stages, roles; Finance: approvals, numbering). Global Settings keeps only workspace, branding, billing and integrations.

**P1 build spec (6 Oct; from the UI inventory)**

*Today:*
- 25 pages use PageHeader; about 8 build their own `<h1>` header.
- 33 grids hide the toolbar and about 50 keep their own toolbar CSS.
- No Card component exists, and modules define about 230 local card classes.
- About 60 files lay forms out in two columns, and sections have no divider.
- Four records have more than 6 tabs: customer 10, HRMS 8, Finance 7, Project 7.
- Settings sit in 14 global routes.
- The tenant's all-caps heading font reaches staff titles.

*Foundation (design system):*
1. **Sentence-case titles.** Staff screens take only the firm's colours. The brand typeface stays on client-facing surfaces (portal, forms, documents).
2. **PageShell.** One title, one primary action, tabs under the title, toolbar, content; one gap scale per page kind.
3. **Card and CardGrid.** One radius, one padding, one shadow; header · body · footer; equal heights.
4. **Toolbar.** Search is an icon until used. Filter shows filters in use as removable chips. ⋯ holds sort, columns and export. The page's one action lives in the header.
5. **Table cells.** RecordName (name plus one muted line) and OwnerCell (avatar). Columns hide by priority below 80rem and 64rem.
6. **Forms.** FormLayout (one column ≤40rem, sticky Save at the bottom end); a hairline between FormSections. FormRow only for two tightly coupled fields (date and time).
7. **Tabs.** At most 6. The active tab is bold and underlined. Counts show only when they ask for action.

*Guard tests* (fail the build on new violations; the allow-list of existing ones only shrinks):
- no `<h1>` outside the design system;
- no `role="table"` div grids;
- no local two-column form classes;
- no more than 6 tabs;
- no local `*card*` surface rules in newly touched files.

*Rollout order:*
1. the Planning list (the owner's first complaint);
2. Sales lists (leads, opportunities, customers, follow-ups);
3. Projects list and Tasks;
4. Purchasing, Inventory, Factory, Finance, HRMS lists;
5. one-off headers (inbox, CRM screens, quotation templates, integrations, client projects, tasks);
6. form dialogs to single column with sections;
7. tabs over 6 grouped.

*Settings inside modules:* the ⋯ › Settings sheet per module; Sales gets enquiry types, sources and locations. Module settings move as each module's phase rebuilds it (P2 Sales …). Global Settings keeps workspace, branding, billing and integrations.

*Also in P1 (research R14):* hide unused fields per firm for each form and grid (configuration, never deletion).

*Exit (P1):*
- guard tests green;
- every list and form on the rules, with before/after screenshots;
- deployed;
- Planning list checked live on plm.wodana.ai.

**F. Features (Shyam's 14 points + Palm tracker + owner)**
1. **Document audit trail:** created/updated/uploaded by and at, plus version history on every document (quotes, designs, BOQ, approvals).
2. **Money:** cash monitoring (cash in, issued, used; project + company), a project P&L (revenue, purchases, expenses, vendor payments, allocated overheads), vendor payment monitoring (bills, paid, pending, due), configurable payment approval levels, a corporate card expense feed with reconciliation, complete expense capture per project and category, and overhead allocation rules.
3. **BOQ → internal material purchase requirement** → procurement planning.
4. **Automation:** auto-trigger and auto-allocate work on flow events; reminders by team with escalation after N reminders (default 3); warranty-period visit reminders to client and manager; deadline alerts before due.
5. **Notifications:** consent captured per contact and channel (WhatsApp/email/SMS); a quiet-hours and digest preference; templates per event; WhatsApp only with consent.
6. **Quotation numbering:** prefix/suffix/sequence per entity; upload external quotation documents.
7. **Change requests:** design revision + price impact + timeline/handover impact, with approval and history.
8. **Vendor portal:** vendor onboarding form, KYC documents with expiry, bank details approval, price requests and bidding (sealed, compare, award), PO acknowledgement and delivery dates.
9. **Woddy as an agent:** a side panel that acts on the current record with tools ("AI proposes, people confirm"), shows its plan and steps, and remembers context per record.
10. **Client portal:** a feed, typed cards, document cards (never bare links), warranty claims, design comments that both sides can make (threaded, pinned to the image), and Q&A routed by stage (§5b).
11. **Site flow and mobile:** site visit → measurements → photos → checklist as one guided flow on web and app. Locations configured in Sales.
12. **Enquiry-type steps editor:** follows CeCe's tracker per type (Enquiry Types Flow tab), not generic jargon.

**Order:**
- **R1:** D (foundation components + Planning table + forms) ∥ portal revamp ∥ money (cash, P&L, vendor payments, approvals) ∥ automation + notifications + consent.
- **R2:** projects/site/overview revamp on D ∥ vendor portal ∥ Woddy agent ∥ settings-in-module ∥ change requests + quotation numbering + audit trail.
- **R3:** mobile app parity; corporate card integration.

## 6. Module specifications

Every module lists: purpose · records (tables) · states · key rules · edge cases · events → notifications · screens (minimal) · AI · acceptance tests. Money is `numeric(20,4)` and quantities `numeric(18,4)` in every module.

### 6.1 Control plane (Wodana internal)
- **Purpose:** provision and run tenants safely.
- **Records:** customer accounts, organizations (workspaces), contracts, entitlements, seats, billing documents, domains, lifecycle versions, support sessions, operator identities and audit (existing tables; keep).
- **States:** tenant `draft → trial → active → grace → suspended → archived`; domain `requested → verifying → verified → certificate_issued → live | failed | removed`; support session `requested → approved → active → expired | revoked`.
- **Rules:** operators never read tenant data outside an approved, time-boxed support session. Suspension is reversible and blocks writes, not reads of exports. A seat limit is checked at invite and accept.
- **Edge cases:**
  - Owner invitation expired or bounced: rotate the link and show delivery status.
  - Slug collision.
  - Payment past due: grace, then suspend, with notices at each step.
  - Downgrade below used seats: block new invites and keep existing members.
  - Module removed: data stays, the UI hides it, and the API returns 403 with a reason.
  - DNS ownership lost: fall back to the default domain and alert.
  - Support session outlives the operator's role: auto-revoke.
- **Screens:** Accounts list · Account inspector (orgs, plan, seats, modules, billing, lifecycle, activity) · Create tenant (one flow).
- **Tests:** provision idempotency; suspended tenant cannot write; operator denied without a session; seat race (two invites for the last seat).

### 6.2 Identity and access

**Sign-in is identifier-first.** One entry screen asks for **email or mobile number**; the server resolves who it is and starts the right flow. The response never reveals whether an account exists (same timing and wording for unknown identifiers).

| Identifier resolves to | Flow |
| --- | --- |
| Staff with a password (one workspace) | password → MFA (required for Owner/Admin/Finance, else per policy) → workspace |
| Staff in several workspaces | password → MFA → **workspace picker** (only authorized, active organizations) → workspace |
| Staff invited, not yet activated | "Check your email": the invite link opens set-password → MFA setup (if required) → onboarding |
| Workspace owner of an unfinished setup | password → MFA → **resume onboarding** at the saved step |
| Client (portal contact) | **mobile number → WhatsApp OTP** (SMS/email fallback when WhatsApp fails) → their deals/projects |
| Supplier (vendor contact) | **mobile number → WhatsApp OTP** → their RFQs/POs |
| Wodana operator | redirected to the separate operator sign-in (password → mandatory MFA); never mixed with tenant sessions |
| Tenant host (custom domain/subdomain) | the flow is limited to that tenant; branded sign-in |

Rules:
- Staff keep **email + password** (+ MFA).
- OTPs are 6 digits, expire in 5 minutes, allow 5 attempts, have a resend cooldown of 30 s, are rate-limited per number and IP, and are single-use.
- Sessions: staff use a refresh cookie + short access token; clients and vendors get scoped sessions that expire after 30 days of inactivity.
- **Password reset** is by emailed link. **Lost MFA** uses recovery codes or an Owner reset with audit.
- An account can be both staff and client (different sessions and scopes).

**Onboarding by type:**
- **New tenant owner** (from control-plane provisioning): set password → MFA → company → legal entity & region → firm kit (route templates) → invite team → done. It is resumable at every step, and each step is saved server-side.
- **Invited staff:** set password → MFA if the role requires it → profile (name, phone, photo) → land on Home.
- **Client first login:** confirm name → accept portal terms → land on their project.
- **Supplier first login:** confirm company and contact → land on open RFQs/POs.

- **Records:** users, identities, memberships, roles, permissions (versioned seed), member_roles, teams (roles inherited through team), MFA, sessions, devices, invitations.
- **Rules:** effective access = sold entitlement ∩ role permission ∩ record scope (own / team / all). MFA is required for Owner, Finance and Admin. The last owner can't be removed or demoted.
- **Edge cases:**
  - A user leaves: deactivate, then reassign their open tasks, enquiries, approvals and projects through a guided **offboarding wizard**. Nothing stays orphaned.
  - A role changes mid-approval: the pending approval re-evaluates on decision.
  - A user in two tenants: the workspace switcher shows only authorized organizations.
  - Lost MFA device: recovery codes, or reset by an Owner with audit.
  - A concurrent session limit is reached.
- **Tests:** permission matrix per role; cross-tenant 404; offboarding leaves zero orphans.

### 6.3 Settings and configuration
- **Records:** org profile, legal entities (base currency, TRN, bank details for invoices), branches, tax profiles, currencies and rates, terminology, numbering sequences, work calendars, `workflow_templates` (routes, stages, gates, package→task templates, checklists), `approval_policies`, `notification_rules`, custom fields (bounded), document templates, catalogs.
- **Rules:** configuration is versioned. Records freeze the version they used, and old records keep their meaning when configuration changes. Values are archived, never deleted if in use.
- **Screens:** Settings hub with sections: Company · People & roles · Workflow · Approvals · Numbering & tax · Notifications · Templates · Catalogs · Connections · Security · Billing · Data export.

### 6.3a Country, currency and region rules (international by default)
Wodana is international. A country profile (region pack) supplies currency and decimals, locale, time zone, working week, units, phone and address structure, and tax model and labels. It is versioned data, extensible to any country.

| # | Rule | Where it is enforced |
| --- | --- | --- |
| 1 | Base currency belongs to a legal entity and is fixed once that entity has financial records. A group can hold entities in different countries and currencies. | Settings (legal entities) |
| 2 | A document in another currency stores an exchange-rate snapshot (rate, source, date). There is no silent conversion. | Quotation, payments, purchasing |
| 3 | Rounding uses the currency's decimals (3 for KWD, BHD and OMR). | Quotation, payments, finance |
| 4 | Tax follows the entity's country model. `none` hides tax fields. Rates are configured and validated per entity; "not configured" is never shown as 0%. | Settings (tax), quotation, invoices |
| 5 | Address and phone follow the country of that address or person, not the workspace. A UAE firm can have an Indian client or a Saudi site. Required region levels are choice lists, never empty text boxes. | CRM, discovery, projects |
| 6 | The time zone and working week drive SLAs, takeover timers, reminders and schedules. | CRM, projects, HRMS |
| 7 | Units (metric or imperial) set the catalog and measurement defaults. | Catalog, discovery |
| 8 | Language and region are independent (Arabic UI with UAE formats; English UI with Saudi formats). | Everywhere |
| 9 | Region pack upgrades are opt-in. Existing records keep the version they were created with. | Settings |

### 6.4 Catalog, measurements and pricing (flexible core)
The current catalog (generic `workspace_catalog_records` + links) is too weak for real quoting: no typed attributes, no measurement-driven quantities, no pricing rules. v2 makes the catalog the engine behind quotes, BoM, purchasing and factory.

**Structure:**
| Concept | What it is | Example |
| --- | --- | --- |
| `catalogs` | independent collections, never mixed | "Room Builder (default)", "Palm Core Collection", "Supplier X price list" |
| `categories` (tree) | organizational grouping per catalog; can carry an **attribute schema** | Kitchen › Base cabinets |
| `attribute_definitions` | typed attributes per category: `text / number+unit / choice / multi-choice / color / boolean / dimension` with required, allowed values and default | Width (mm), Carcass material, Shutter finish, Handle type |
| `items` | a sellable or buyable thing, with a **type** | see item types below |
| `variants` | a concrete combination of attribute values (a matrix is generated on demand, never 1,000 rows up front) | Base cabinet · 600 mm · BWP ply · Acrylic white |
| `components` (BoM) | an item made of other items, with **quantity formulas** | Wardrobe = carcass ply (formula) + shutters (formula) + hinges (count by height) + handles |
| `media`, `documents` | images, spec sheets, 3D/CAD links per item or variant | |
| `supplier_links` | variant ↔ vendor SKU, pack size, MOQ, lead time | |

**Item types (each behaves differently in quote, purchasing and factory):**
- `product`: a finished item (bought or made);
- `material`: a raw input (ply, laminate, tile, paint);
- `assembly`: a parametric item computed from dimensions and a BoM (kitchen run, wardrobe, false ceiling, wall panelling);
- `service`: labour or installation (per unit/area/length/hour/day);
- `package`: a bundle of items sold at one price (a "2BHK essentials" design package, a design-fee package);
- `ready_made`: bought finished, never manufactured.

**Measurements and units:**
- `units` with dimension kinds (count, length, area, volume, weight, time) and `unit_conversions` (mm↔m↔ft↔in, sqm↔sqft, sheet↔sqft by sheet size, box↔pcs by pack).
- **Measurement sources:** a site visit captures named measurements per space (wall lengths, heights, openings, floor area). A quote line can take its quantity from a measurement through a **formula** (`area(floor) × 1.05`, `perimeter − openings`, `ceil(height/450) × 2` hinges). The formula, its inputs and the result are shown on the line. A manual override needs a reason, and QS sees every override.
- **Waste and rounding rules** per material (e.g. tiles +8%, sheets rounded up to whole sheets, paint by coverage per litre), used for both quote qty and purchase qty (the difference is visible).

**Pricing (rule-based, explainable):**
- `price_books` (per catalog, currency, region/legal entity, customer segment, effective dates) with `price_entries` per variant: cost, sell, or **pricing method**:
  - `fixed`: a price per unit;
  - `cost_plus`: cost × (1 + markup), markup per category/item;
  - `per_measure`: rate per sqft/rft/sqm with a minimum charge;
  - `tiered`: quantity breaks;
  - `attribute_surcharge`: a base price + surcharges per attribute value (e.g. +12% for acrylic, +AED 150 for soft-close);
  - `assembly_rollup`: the sum of components' prices + labour + margin.
- **Every computed price shows its breakdown** (base, surcharges, waste, markup, tax) in the quote line inspector. QS reviews breakdowns, not only totals.
- Price states: `draft → reviewed → active → expired`. A missing price is NULL ("price unavailable"); it can be drafted but blocks issue.
- Cost comes from supplier links/rate contracts (latest approved), with a **price change alert** when a supplier's cost moves more than X% and affects active sell prices (the margin impact is shown).
- Cost is visible only with the cost permission; the client sees only sell values.

**Rules:**
- A quote or BoM line **snapshots** the variant, attributes, formula, inputs and price breakdown at use; later edits never rewrite history.
- A supplier offer is linked explicitly, never matched by name.
- Archiving keeps historical use; an archived item can't be added to new quotes.

**Edge cases:**
- Duplicate SKUs or names on import.
- Attribute schema changed after items exist: old values are kept and flagged "needs mapping".
- Unit mismatch.
- Currency conversion with a rate snapshot.
- Pack and sheet rounding.
- A formula error (e.g. a missing measurement): the line shows "needs measurement X" and blocks QS submission.
- A variant explosion: the matrix is generated lazily, only on use.
- One item in two catalogs: two separate records, linked as "same as".
- Tenant-specific price visibility (Sales sees sell only).

**Screens:**
- **Catalog:** one DataGrid per catalog: category tree filter, attribute columns chosen per category, inline edit with permission, bulk price update (by % with preview).
- **Item inspector:** attributes, variants, BoM with formulas, prices with breakdown, suppliers, media, usage in quotes/POs.
- **Import review:** mapped columns, proposed rows, conflicts, and accept all / per row.
- **Formula tester:** enter measurements and see qty and price.

**AI (propose, never decide):**
1. **Import mapping:** spreadsheet or supplier PDF columns → attributes, units and categories; duplicate detection; unit normalization.
2. **Attribute extraction** from spec sheets and product photos into typed attributes.
3. **Photo/text search:** "white handleless kitchen base 600" or a photo finds matching variants.
4. **Quantity formula suggestions** from item type (e.g. suggests the hinge rule for a shutter).
5. **Price sanity check:** flags sell prices below cost + minimum margin, stale costs, and outliers vs similar items. It never sets a price.
6. **Quote draft** uses the catalog + measurements (see §6.8).

**Tests:** snapshot immutability; formula evaluation (units, rounding, missing inputs); price method results and breakdown; permission-hidden cost; import idempotency; lazy variant generation.

### 6.5 CRM
- **Records:** parties (person/org), contact points, consents, enquiries, intake events, identity candidates, merges, queues and members, assignment rules/history, SLA policies/instances, activities (call, note, meeting, WhatsApp, email), conversations and messages, opportunities (+ team, stakeholders), pipelines and stages, qualification forms and values, taxonomies (enquiry types, customer types, budget bands, Emirates → areas).
- **States:** §4.1–4.2.
- **Rules:**
  - Phone numbers are stored E.164 and validated per country. The WhatsApp link is built from the normalized number.
  - Internal notes are visible to assigned Sales + managers by default (PLM-024 configurable) and **never** to the client or portal.
  - Convert keeps the enquiry reference and links both ways.
- **Edge cases:**
  - Same person, two phone numbers.
  - A company with several contacts.
  - An agent/referrer: a referral party with commission eligibility.
  - A lead from a campaign with UTM: attribution touches.
  - A weekend lead with no duty roster: queue plus Owner alert.
  - The owner is on leave (HRMS availability): skip them in assignment.
  - Reopening a lost opportunity: new stage history, same record.
  - Merging two customers who both have opportunities: the merge preview shows every moved record.
  - A spam form submission: rate limit, honeypot, and an "Spam" disposition that doesn't count in reports.
- **Events:** `crm.enquiry_created` (notify queue/owner), `crm.enquiry_takeover`, `crm.sla_breached`, `crm.opportunity_won` (→ commercial prepares the deal submission), `crm.opportunity_lost`.
- **Screens:**
  - Sales = Enquiries grid · Pipeline (board + grid toggle) · Enquiry inspector (provenance, contact actions: call/WhatsApp/email, timeline, next action) · Opportunity workspace (overview, requirements, quotes, deal, files, timeline).
  - Clients = customer list + customer profile (all deals and projects).
- **AI:** enquiry summary and a suggested next action; drafts a first-response message (a person sends it).
- **Tests:** takeover timing across weekend and office hours; dedupe; conversion keeps IDs; note privacy.

### 6.5a P2 build spec: lead → enquiry (6 Oct)
**Journey:**
1. A contact arrives through a form or QR code, the inbox (WhatsApp/email), a walk-in or call, an import, or the agency feed.
2. A sales admin files it into an existing job or creates an enquiry.
3. The system checks for a returning or duplicate client and asks for confirmation; it never merges silently.
4. The enquiry has the right source, channel, type and team.
5. The required fields for its enquiry type are complete.
6. The enquiry is qualified or converted.

**Decisions per tracker item** (build / better / configure / decline, with the reason):

| Item | Decision | What ships |
| --- | --- | --- |
| PLM-092 form errors | **Better** | One error box at the top listing every problem, with each field highlighted and linked, from a single validation call that returns all problems (not one 422 per field). Shared by every form (P1 FormDialog error banner). |
| PLM-096 required before conversion | **Build** | Required fields per enquiry type (Settings › Sales › Enquiry types), checked at conversion and at the gate that needs them. The error box lists what is missing. |
| PLM-100 team fields | **Build** | Team per role (sales, designer, PM, QS…) on the job (E1). Each enquiry type shows only its roles; "Not applicable" is allowed per role. |
| PLM-116 forms list | **Build** | A forms list on the P1 grid: source, channel and submissions columns; copy link, QR download and open on each row. |
| PLM-127 Concepts / Early Ideas | **Configure** | Removed from the default template and from Palm's enquiry types; existing records keep their history. |
| PLM-025 WhatsApp & email intake | **Build + external** | Inbox = sales-admin front door: File into job, or New enquiry prefilled from the chat. Email inbound via Mailgun routes per workspace address. WhatsApp goes live when Meta approves (demo mode until then). |
| PLM-026 socials | **Better** | A per-channel form link and QR (built), plus a "paste a DM" action that reads the message into the enquiry form (AI fill, person confirms). DM connectors are declined for now: each platform needs its own app review; we revisit once WhatsApp is approved. |
| PLM-029 digital marketing | **Waiting on Palm** | CSV import (built) and a webhook with a field map per agency. The format is needed from Palm (§0.5). |
| PLM-024 internal notes | **Configure** | A "who sees internal notes" setting (enquiry team only / everyone with Sales access). The default is the team; never the portal. |
| PLM-033/035–037/093/114/115/118/120 | **Re-verify** | Each gets a live retest script in the P2 click-through; anything failing is fixed in P2. |

**Inbox visibility (owner + 2 Oct meeting):**
- Sales admins see unassigned intake.
- Once a thread is filed into a job, the job's team sees it.
- Others see nothing.
- The composer always shows whether a message goes to the client or stays internal (E6-1).

**Consent:** forms and the portal capture channel consent (WhatsApp, email, SMS) with time and source. E4 reads it later.

**Reuse:** the stash patch `P2-intake-inbox.patch` (inbox visibility, lead team, enquiry problems; migrations 0249/0250) is reviewed file by file and renumbered from 0247.

**Edge cases:** E1-1…E1-4, E1-6, E6-1, E6-2, E6-4 (§7a), plus the spam submission and weekend lead cases (§6.5).

**Exit (live on plm.wodana.ai):**
- form → enquiry with the right source and channel;
- duplicate → linked after confirmation;
- returning client detected;
- error box shows every problem;
- inbox visibility per role (sales admin, designer, manager);
- forms list with QR;
- the re-verified items pass;
- tracker rows updated.

### 6.5b Booking pages (Calendly-style; owner, 6 Oct)
**Why:** a client picks a free slot on the firm's website or from a link: a design consultation, a showroom visit or a site visit. No back-and-forth on WhatsApp. Each booking is also an intake channel, so it creates or attaches to the job (E1) and goes on the right person's calendar.

**Records** (every table has `workspace_id`, FORCE RLS and `tenant_isolation`):
- `booking_types`:
  - name, slug, duration and color token;
  - location kind: our location (from Sales › Locations), client address, video link or phone;
  - buffers before and after, minimum notice, booking window in days, maximum per day;
  - questions: lead-form fields, with the enquiry type and source;
  - hosts mode: one person, round-robin in a team, or by enquiry type;
  - confirmation: automatic or needs approval;
  - active, version.
- `booking_type_hosts`.
- `availability_overrides`: per person, a date or range, extra or blocked hours.
- `bookings`:
  - type, host, start and end in UTC, the visitor's time zone, status (pending / confirmed / cancelled / completed / no-show);
  - contact and job link, answers snapshot, consent, source and placement (UTM);
  - a manage token hash; version.
- A Postgres exclusion constraint on (host, time range) for live bookings, so the same host can never be double-booked.

**Availability**, computed on the server:
- the workspace working week, hours and holidays from the region pack;
- each person's leave (HRMS) and overrides;
- busy time from Wodana (meetings, site visits, appointments) and from Google free/busy for connected members;
- buffers, minimum notice, the booking window and the daily maximum.

Slots show in the visitor's time zone with the firm's zone named. The slot is re-checked at confirmation.

**Public page `/book/{workspace}/{type}`:**
- tenant branding (logo, colours, "Powered by Wodana");
- pick a day, then a time, then a short form (name, phone in the region format, email, the type's questions, consent per channel);
- done: a confirmation with "Add to calendar" (.ics) and manage links.

Mobile first, RTL, every label through `t()`.

**Embeds:**
- a plain link and a QR per placement;
- an inline embed (`<iframe>` snippet);
- a popup button (one script tag);
- each carries source, channel and UTM.

**What a booking does, in one command** (idempotent, audited):
1. Find or create the contact; a duplicate goes through the E1-1 confirmation rule.
2. Create the enquiry (source "Booking page", channel from the placement), or attach to the open job.
3. Create the meeting with its appointment on the host's Wodana calendar.
4. Push a Google event with an invite when the host is connected.
5. Send the confirmation email through `renderBrandedEmail` with an .ics attachment.
6. Send a WhatsApp confirmation and a reminder through E4, only with consent.
7. Notify the host.

Signed manage links let the client reschedule or cancel within the type's rules.

**Staff:**
- Sales › ⋯ Settings › Booking types (in the module), each with its share sheet (link, QR, embed code);
- bookings appear on the Calendar and the job;
- the enquiry shows "Booked via booking page";
- one-click no-show and complete.

**Edge cases** (each a test):
- two visitors take the same slot at once: one wins and the other is offered the next slots;
- the host's Google calendar turns busy after the page loaded: re-check at confirm;
- time zones with daylight saving, and a visitor in another country;
- the host goes on leave after a booking: reassign within the round-robin team, otherwise the owner is told;
- a cancellation inside the minimum notice;
- spam: rate limit and honeypot;
- a booking for a returning client;
- an inactive type or a disabled workspace;
- a slot across midnight in the firm's zone;
- a region holiday.

**Phase:** built with P2 (intake). The tables and slot engine are reused by E4 reminders and by site-visit scheduling in P4.

### 6.6 Discovery (requirements and site visit)
- **Records:** `spaces` (site → room/zone tree, area, photos), brief (needs, wants, constraints, style, budget), requirement items (per space: what, quantity hint, priority), site visits (date, surveyor, measurements, photos with markup, access notes, services), definition baseline (client-confirmed revision, immutable).
- **Rules:** an empty tree is valid early; rooms are never invented. The confirmed baseline is what quotes reference. Changing it after acceptance goes through a change order.
- **Edge cases:**
  - Measurements disagree between visits: the latest wins, and history is kept.
  - A space removed after quoting: quote lines are flagged "orphaned space" for revision.
  - A client uploads inspiration through the portal: it enters as unreviewed until staff accept it.
  - Offline site visit on mobile: drafts sync later and conflicts are shown per field.
- **Screens:** Requirements tab (space tree + item grid + coverage "3 rooms without scope") · Site visit (mobile first).
- **AI:** extract requirements from notes, voice and photos into proposed items per room, for review.

### 6.7 Design
One design workspace in Planning, driven by the design package's stages. Reviews and approvals happen on the drawing, inside Design.
- **Stages** (from the package): space planning → concepts → materials → renders → sign-off. A compact clickable timeline; each stage holds its **deliverables per room** (layout, concept board, render view). A stage completes when its deliverables are client-approved; no manual stage buttons. Inspiration and site visit stay in Requirements/Site.
- **Deliverable states:** `draft → internal_review → internal_approved → client_review → approved | changes_requested`; a new revision supersedes. One lifecycle only (no folder shortcut, one comment model).
- **Reviews:** Creative Director (the package's reviewer role) approves or sends back with pinned notes; the designer presents a stage's deliverables to the client as one **presentation** (a round). The client decides in the client portal (§6.22), or staff record the client's decision with evidence (who, when, how, note).
- **Rounds:** one count per stage from the package's included revisions. A round beyond them needs the extra-revision fee (Design packages setting) accepted before work starts.
- **Materials:** chosen in the Material selection stage as material/finish boards the client approves. The priced list is the quotation's lines (catalog items); the procurement materials schedule (supplier, samples, lead time, order and delivery) lives in the Project and is generated from the accepted quote. One list per stage, never retyped.
- **Visibility:** drafts and internal review are staff-only; comments are internal or with-client; the project/site team sees approved work after sign-off.
- **Approvals queue:** Home → Approvals lists pending design reviews and client decisions and opens the drawing in Design. Design is not approved from Agreement.
- **Notifications:** review requested, sent back, presented to client, client decided, stage overdue, design signed off ("ready to quote").
- **Sign-off:** freezes the design baseline (approved drawings and material boards). The main quote starts from it; later design changes become a new quote revision (or a variation once the project exists). Working drawings continue in the Project.
- **Quotes vs design:** the design-fee quote is independent (package × area). The main quote is derived from the design baseline when the route includes design; without design it is built from Requirements.
- **Edge cases:** the client approves an old revision (rejected, shown the latest); a design change after a WO is released flags affected WOs/tasks "stale drawing"; a moodboard approval never satisfies the technical-drawing gate; a removed room archives its deliverables but keeps history.

### 6.8 Quotation
Planning ends in two outcomes: the signed-off design and the accepted quotation. The accepted quotation is the source of truth the Project's BOQ, budget, procurement and payments start from.

- **Shape (one flat list, many views):** every line has an **Area** (a case room from the catalog or typed, or *General*) and a **Work package** (trade: joinery, civil, electrical… from the firm's configurable list). Sections are views, never copies: *By area*, *By trade*, *Area → trade*. The firm kit sets the default (residential: by area; commercial: by trade) and the client document uses the view chosen for it.
- **Line kinds:** item (catalog product, material or assembly), service (labour or work by unit: point, m², day, lump sum), allowance / provisional sum (a budget spent down later), client-supplied (install only, priced at zero, never a PO), and the site services every fit-out needs: relocate (from area → to area), dismantle, remove and store (per period), dispose. Optional lines and choose-one alternates the client picks.
- **Line fields:** item + image, description, spec/finish, dimensions → quantity, unit, rate (sell); cost, markup and supplier behind permission; line discount and tax category; internal note.
- **Money is configuration, not code** (Settings → Quotations, defaults from the region pack):
  - tax categories and their components from the region/tax profile (VAT, GST split, sales tax, exempt), prices entered inclusive or exclusive, tax after discounts;
  - discounts on a line, an area/trade or the whole quote, as % or amount, in the order line → section → quote → tax; above the firm's threshold needs approval;
  - markup defaults firm → category → line, and a margin floor that needs approval;
  - rounding from the currency's decimals and the firm's policy (line then document, or document only);
  - payment schedule templates: milestones as % or amount tied to an event (on acceptance, stage start, delivery, handover), must total 100 %, optional retention;
  - validity days, numbering, internal review on/off, terms and exclusions as template text.
- **Builder (the USP):** a Notion-clean page with the lines grid in the middle.
  - **AI first draft:** when design is signed off (or from Requirements when the route has no design), AI compiles requirements, site measurements, moodboard notes and approved designs/material boards into a draft. Every line is a suggestion to accept; rates always come from the catalog and a missing price stays empty and blocks sending.
  - **Grid:** edit like a spreadsheet; typing in the item cell suggests catalog items and choosing one fills the row (unit, rate, spec, image, trade); Tab/Enter move between cells; `/` or *Add* inserts a line; drag lines between areas; select many to bulk-edit area, trade, markup or discount.
  - **Prompt:** "add false ceiling 18 m² in Living, gypsum" or "move the TV unit to the Family room" returns a proposed change set shown as a diff to accept or reject; never a silent write.
  - **Checks:** missing prices, zero quantities, areas with approved designs but no lines, margin below the floor, discounts needing approval.
  - **Together:** avatars of who is in the quote, live updates of others' edits line by line, and Figma-style comments pinned to a line, a cell, an area or the total, with @mentions, resolve, and client comments from the portal. Each line is version-checked, so two people editing the same cell get a merge prompt, never a lost edit.
- **Templates are a separate library**, never edited inside a quote: insert a template into an area (catalog items re-priced from today's catalog), save an area, a trade or the whole quote as a template; a whole-quote template keeps its area names and recreates missing areas in another project.
- **Pictures:** catalog items carry pictures; a line shows its catalog item's picture or its own (uploaded into the quote); an optional Pictures column in the builder and in the client document.
- **Nothing blocks:** a typed item can be added to the catalog in one step (unit, price in the quote's currency, picture), any custom line can be added later, and a new area can be created from a line's area picker.
- **Document studio:** 12 designed styles (fonts, paper, cover layout, table style; accent from the style or the firm's brand), editable cover, letter, terms and exclusions, sections on/off, items by area or trade (lines or totals, rates, descriptions, pictures), print or save as PDF. Items and money always come from the quote.
- **Proposal kit (built):** Settings → Quotations → Proposal holds the firm's introduction, letter note, default terms and exclusions, contact block, website and pictures (introduction, up to three terms pictures, closing, monogram). The client proposal keeps Wodana's fixed layout and fills it from the kit plus the tenant brand (logo, name, brand colour); pages without content are left out. New quotes take their currency, validity, tax rate, terms and exclusions from the firm's own configuration. A firm's kit is loaded at onboarding with `scripts/import-proposal-kit.mjs`.
- **Revisions and acceptance:** `draft → internal review (if the firm uses it) → sent (frozen R1) → accepted | changes requested | expired`; a new revision copies the last one and shows a diff (lines added, removed, changed; total and margin change per area/trade). The client accepts one revision on the portal (named signature or OTP) choosing options, or staff record acceptance with evidence. Acceptance starts the Project once the firm's release gates pass (agreement, payment per the schedule).
- **After acceptance (variations, §6.20):** the accepted revision is the baseline; the live BOQ = baseline + approved variations. A variation holds delta lines: add, omit (references the original line), replace (omit + add), move (area change plus its labour), and draw-downs of allowances. Before acceptance, the same requests are simply a new revision.
- **Records:** quotes (per case, kind quotation/variation), quote_revisions (frozen snapshot + hash), quote_lines (area_id, work_package_id, kind, catalog snapshot, qty, unit, cost, markup, rate, discount, tax_category, option group, position, version), quote_discounts, quote_payment_milestones, quote_comments (anchor: line/cell/area/total), quote_acceptances; workspace quotation settings. Money is `numeric`; the pricing engine is one shared pure function.
- **Notifications:** review requested / returned, sent to client, client commented, accepted / changes requested, expiring in N days, variation awaiting approval.
- **Edge cases:** two editors on one cell; a catalog price changes after the draft (flag, never silently reprice); an area removed with lines in it (move to General); a client accepts an old revision (rejected, shown the latest); validity expired (re-send); a 3-decimal currency; tax-inclusive price entry; an optional line chosen after acceptance (variation).
- **Tests:** pricing engine (orders, rounding, inclusive tax, currencies); revision freeze and diff; acceptance → project baseline; variation deltas → live BOQ; concurrent line edits.

### 6.9 Agreements, receivables and deal approval
- **Records:** deals, agreements, payment_requests (milestones from the schedule), receipts, receipt_allocations, client credits, refunds, commissions (provisional/final), approvals (Finance, Owner).
- **States:**
  - Deal round `draft → submitted → finance_verified | finance_returned → approved | rejected`.
  - Receipt `recorded → verified | rejected`.
  - Payment request `open → partly_paid → paid | cancelled`.
- **Rules:**
  - Each receipt needs proof and an allocation.
  - The floor is checked on verified receipts only.
  - Owner ≠ submitter ≠ Finance (configurable waiver, recorded).
  - Approval of the first round runs `OpenProjectFromDeal` (idempotent on deal ID). Later rounds link to the same project.
- **Edge cases:**
  - One receipt paying two milestones.
  - A partial payment.
  - Overpayment becomes client credit.
  - A bounced cheque reverses the receipt; if it breaks the floor it flags the round, and an already-released project gets an alert, not auto-rollback.
  - Refund needs an approval, then a credit note.
  - A commission split that doesn't sum to 100% is blocked.
  - The commission-earning salesperson leaves: commission stays with them, and Finance decides.
  - A payment gateway success webhook arrives twice: idempotent.
  - A receipt in another currency: rate snapshot.
- **Screens:** Deal workspace (rounds timeline, each round's documents, money, approvals) · **Approvals inbox** (all pending decisions for me, one-click decide with evidence) · Finance queue.
- **Tests:** H2 floor; separation of duties; exactly one project under concurrent approvals; webhook replay.

### 6.10 Projects
**Delivery spine (all modules hang off it).** One reference from Deal File to warranty; the accepted quotation becomes the **sealed scope**, then the live BOQ (baseline + approved variations). Every material, order, production order, delivery, installation, snag and warranty claim links to a BOQ line, so each line has a history ("line passport"): agreed → signed off → ordered/in production → received → delivered → installed → handed over → under warranty.

**Locked scope (the answer to "I already told you").**
- At start the accepted revision is sealed: lines (chosen options included), options not chosen, discounts, price from the one pricing engine, payment terms, terms and exclusions, the client's acceptance (who, when, how) and the agreement reference. It is canonical-JSON hashed (SHA-256); the row can never be updated; every read re-verifies the fingerprint and shows *Unchanged* or *Changed since it was sealed*. A scope certificate PDF comes with the document builder.
- After the seal nothing changes silently: every change is a variation with its own price, time impact and client acceptance; each live-BOQ line shows its origin (Baseline R3, VO-2).
- **Requirement trace (built):** every Planning requirement is Included, Not included, A later phase or Not possible (the last three with a reason the client reads) before a quotation can be sent — the send is refused while any is undecided. A quote line points at the requirement it covers; included requirements without a line are flagged. The decisions and covering lines are sealed with the scope (sealed document → Requests).
- Still to come: client-confirmed meeting notes (optional auto-confirm after N days) and "Ask the scope" answers with links to the requirement, line, exclusion and signature.

**Scope (built).**
- **Live BOQ:** the sealed baseline plus applied variations. Each line keeps its origin (R#, VO-n) and an append-only history (agreed, packaged, reduced, removed, moved, added, signed off).
- **Packages:** suggested per area, trade and way of delivery (made in our factory, bought materials, bought ready-made, subcontracted, supplied by the client, site work). They are named, owned and dated.
- **Variations:** built in the quotation builder. A variation can:
  - remove some or all of a line, as a credit at what the client paid, with no discount and with tax following;
  - move a line to another area, with its own labour price;
  - replace a line (a removal plus a new line);
  - add new scope.
  Once accepted (and, optionally, once its payment is verified), *Apply to project* seals it as VO-n and changes the live BOQ. Stale changes are refused with the line named.
- **Material list:** materials and finishes tied to the lines that use them, suggested from the catalog items on the lines.
  - Sending freezes a revision.
  - The client decides per material; a rejection says what they want instead.
  - Signed off means the latest revision is approved in full and unchanged since. This is the *Material sign-off* stage check.

**Plan (built: work items).** One task system for every piece of project work, run like an issue tracker.
- Items: tasks, subtasks (one level) and issues — blocker, client request, snag. Each item can belong to a package, a scope line and a stage.
- Items are numbered per project (#n) and never deleted; cancelling a task cancels its open subtasks.
- Statuses: To do → In progress → In review → Done, or Cancelled. A task can't be done while a subtask is open.
- Dependencies: finish-to-start or start-to-start, with a lag in days; loops are refused. An item is *blocked* while a predecessor isn't finished (or started). *Report a blocker* creates a blocker issue that holds the item up until it's done.
- Giving work to someone outside the team gives them access to the project without a role.
- Every change is history (`work_item_events`) and comments are append-only.
- Items are version-checked one by one, so a busy team doesn't trip over the project's version.
- Screens:
  - the project's **Plan** tab: List grouped by package with subtasks under their task and done work last, a Board by status (drag to move), a Timeline, or Sprints;
  - the item panel: properties saved as they change, subtasks, what it waits on, and activity with comments;
  - Home → **Tasks**: open work across projects, mine or everyone's, grouped Late / Today / Next 7 days / Later.
- Notices: given to you (in-app and email), a comment (assignee and the person who raised it), a blocker (project manager and assignee), done (the person who raised it), pushed later by a change upstream (assignee), a package planned (one per person), a sprint started or closed (team). The daily reminder run tells the assignee the day before work is due, and the assignee (in-app and email) and the project manager once when it's late (a missed day catches up for a week).
- **Scheduling (built):** dates count working days from the workspace's work calendar (its week and holidays), else its country's region pack, else Monday to Friday. Moving an item later shows what it would push (everything waiting on it, directly or through others, keeping each item's length in working days; nothing is pulled earlier and finished work never moves) and asks *Only this one* or *Move them too*; the people whose work moved are told. The project manager sets the baseline (every item's dates, replaced when set again); an item shows how many days it is behind it. The plan warns when its open work runs past the handover date.
- **Timeline:** the Plan's third view — items as bars from start to due, grouped like the list, with days off shaded, today and the handover date drawn across and the baseline under each bar; it opens on today.
- **Critical path (built):** a backward pass over the plan on the workspace's calendar gives each open, dated item the working days it can slip before the plan's finish moves. *Critical path* on the Timeline marks the items with none (the row says so, not only the colour); an item's panel says "On the critical path", "Critical: N working days too late for the plan's finish" or "Can slip N working days". When the plan ends after the handover date the Plan says by how much.
- **Progress (built):** whole percent from finished tasks — a task counts once done, and until then a task with subtasks counts the share of its subtasks done. A package is the share of its tasks (shown on its group in the list); the project weighs each package by its value in the live scope (equally when there are no values) and counts a package with no tasks as not started (shown as *Progress* on the project). Issues and cancelled work don't count. Measured progress from approved quantities comes with Site (phase 7).
- **Standard tasks (built):** Settings → Projects → Standard tasks holds, for each way a package is delivered (made in our factory, bought materials, bought ready-made, subcontracted, supplied by the client, site work), its tasks in order with working days, the team role that does each, the stage it belongs to, whether it starts with the task before and whether it needs the package's materials. *Plan a package* previews the tasks from a start date (dates on working days, who holds each role, "No factory lead named" when a role is empty) and creates them once, chained by dependencies; each person is told once about their tasks. A role a template uses can't be removed.
- **Sprints (built):** a project's work in short dated rounds, run like a tracker's backlog (the Plan's *Sprints* view: the running sprint with its burndown, the sprints planned next, the backlog, closed sprints with their report). Tasks and issues move between sprints and the backlog by selection; subtasks go with their task. The project manager creates, starts and closes sprints; starting records the commitment (only one runs at a time); work added or taken out mid-sprint is counted apart. Closing asks why each unfinished commitment was missed (blocked, waiting on the client, materials late, took longer than planned, people not available, other work came first, other) and where unfinished work goes. The burndown counts committed work left each day against a straight line over working days. The team is told when a sprint starts and closes. List, Board and Timeline filter by sprint.
- **Team (built):** Home → Tasks → *Team*, for people who oversee every project: open work, late, blocked, finished on time and median days to finish (last 30 or 90 days), then the same per person — open, late, due in 7 days, blocked, done, on time, days to finish. "On time" means finished on or before the due date on the workspace's calendar; work without a due date isn't counted in it; the totals are computed on their own, not averaged from people. A person opens their work.

**Records (built):** `delivery_projects` (reference with the firm's prefix, quote, route, priority, health, start and handover dates, hold), `project_scope_seals` (immutable), `project_stages` + `project_stage_confirmations`, `project_status_updates`, `project_assignments.role_keys` (one team model), `workspace_project_settings` (start rules, numbering, team roles, the variation payment rule), `project_templates` + `project_template_stages` (routes), `work_items` + `work_item_links` + `work_item_comments` + `work_item_events` (the plan), `work_templates` (standard tasks per way of delivery), `work_sprints` + `work_sprint_commitments` (sprints and what was committed).

**Stages and checks.** Routes are configuration (stages, owner role, checks). A stage finishes only when its checks pass. Checks are read from records wherever the record exists (project manager named, a role named, production payment verified) and otherwise confirmed by a person (e.g. "Client approved the drawings") until the module that records it lands — then the check reads the record. A stage that checks a payment can't be skipped; other stages can be skipped with a reason; the project manager can go back a stage with a reason (a stage skipped before it started starts then). Finishing the last stage completes the project, and a completed or cancelled project is a record: its name, dates, priority, team and status no longer change. On hold (reason + review date) stops all stage work until resumed.

**Team.** The firm's role list (Settings → Projects; default: project manager, account manager, designer, technical designer, quantity surveyor, procurement, site supervisor, factory lead, installation lead). One named person per role; the project manager leads. The stage owner or the project manager works a stage; only the project manager (or `projects.manage`) holds, renames, re-dates, names people and posts status.

**Closing (built).**
- **Completed:** the last stage finishing completes the project, but only once nothing is left open: orders still owed goods, orders or price requests never sent, deliveries waiting for inspection, moves on the way, anything at the project's site, and open work. The refusal lists each.
- **Cancelled:** someone with `projects.manage` cancels with why. *Cancel the project* lists what must be settled first (each opens where it's done) and what cancelling does by itself; it can't be sent while anything is left half-way.
  - First: sent orders still owed goods (cancel the rest with the supplier, or receive it), unsent orders or price requests shared with other projects, deliveries waiting for inspection, moves on the way, stock at the site.
  - By itself: unsent orders and price requests for this project only are cancelled, open work is cancelled and the running sprint closes (unfinished commitments marked removed).
- Either way, the project's stock kept elsewhere becomes free stock at the cost it has, and its site stops being a place stock is kept.
- A closed project shows when and by whom (and why, when cancelled); its details, team, stages and work no longer change. A completed project can be reopened with why by someone with `projects.manage` (its last stage is current again); a cancelled one can't.
- Notices: cancelled (team, in-app and email), completed and reopened (team, in-app).
- Still to come with Money (phase 9): the refund or retention decision and the cost reconciliation when money has been received.

**Status.** The project manager's update: On track / At risk / Off track plus one line (required when not on track); the latest is the project's status. Priority: Normal / High / Critical. Handover date shows "in N days" / "N days late" in the workspace time zone.

**Screens (Notion-clean, one thing per view).**
- Projects: one table — project + number, client, stage (n of m), next step + who holds it, handover, status; Running / On hold / Closed; *Start project* lists accepted quotations waiting to start.
- Project page: the name, properties (client, number, stage, status, priority, project manager, team, handover, agreed value · sealed R#), then tabs — **Overview** (the stages; the current one lists what it needs), **Scope** (the live BOQ, material list, changes and sealed documents), **Plan** (the work), **Updates**. Later phases add Site, Money and Files as their own tabs.

**Notifications.** Started (team: in-app + email), named for a role (in-app + email), stage finished (lead and the next stage's owner), on hold / resumed / off track (team), cancelled (team: in-app + email), completed / reopened (team). The actor is never told about their own step.

**End-to-end build order (agreed 26 Sept):** 1 project core ✔ → 2 scope ✔ (live BOQ, packages, line history, requirement trace, material-list sign-off, variations through the quotation builder) → 3 plan and tasks ✔ (one task system run like Jira: packages as stories, tasks, subtasks, issues, sprints with a board and burndown, statuses fed by the records; Gantt, global Tasks, Calendar, workload and on-time analytics) → 4 suppliers and purchasing ✔ (supplier register with approval status, buying company, payment terms, discount/commission deals; requests → optional price comparison → orders → confirmations; subcontract orders) → 5 receiving, stock and logistics (three-way bill match, bank-statement matching, reservations, deliveries with proof) → 6 factory (§6.16) → 7 site, installation, snags and handover → 8 warranty and aftercare → 9 money (client and cost ledgers, milestones, cash forecast, reconciliation) → 10 client portal ✔ and the automations switchboard. Each phase ships with its notifications, labels, RTL, real-database tests and smoke.

**Calculations never drift.** Exact decimals only; one pricing engine for quotes, variations, invoices and orders; totals are always derived (agreed = baseline + approved variations; milestones sum to 100 %; balance = invoiced − verified receipts); quantities guarded by ledgers (ordered ≤ required unless a reason, received ≤ ordered + tolerance, no negative stock); every figure opens to its lines; a nightly reconciliation flags mismatches.

**Edge cases:** start twice (same project); accepted total no longer matching the lines (refused, re-issue); start rules missing (listed with a link to where each is done); a planning record on hold or cancelled (no start); a role removed while a route uses it (refused); the lead can't be un-named; two people changing the project (version check, reload); project on hold (no stage work); PM changes (tasks remain; stage ownership and project notices follow the role, and order approvals belong to the workspace's approvers, so nothing waits on the previous person); cancellation mid-production (guided close-out ✔; money in phase 9); two sites in one deal (one project, sites as locations); a second property (new deal, new project).

### 6.11 Planning and tasks — the core
- **Records:** work_packages (space, source quote lines, supply `make|buy|buy_finished|subcontract|client`, work location, owner, planned dates, status), tasks, task_dependencies (FS/SS/FF + lag), task_assignees, task_checklist_items, task_progress_entries, task_watchers, comments, attachments, work_calendars, resources, bookings.
- **One task system:** project work, CRM follow-ups, approval to-dos, snag fixes, warranty claims and personal to-dos are all rows in `tasks`. `kind` is one of `work | gate | follow_up | review | personal`, and `source_type/source_id` links the record the task came from.
- **Statuses:** `todo → in_progress → in_review → done`, plus `blocked (reason required)` and `cancelled (reason)`. On Hold is a project/package flag shown as a badge.
- **Package → task templates:**

  | Package type | Tasks created |
  | --- | --- |
  | Manufactured item | measure → shop drawing → drawing approval (gate) → material ready (gate) → WO produce → QC → dispatch → install → install QC |
  | Ready-made | order → receive → deliver → install |
  | Site work | prepare → execute → inspect |

  They are generated on release, and the PM edits them.
- **Gate tasks** close only when their approval or source event happens (payment verified, client sign-off, QC pass, drawing approved). The checkbox is disabled, with a link to where the decision is made.
- **Readiness** is computed per task. It shows the first missing condition as text:
  - scope released
  - drawing approved (for factory/site)
  - material available or reserved
  - resource booked for the full span
  - predecessors done
  - project not on hold
  - payment gate satisfied
- **Scheduling engine:**
  - Forward pass (earliest dates) and backward pass (latest dates) over the work calendar gives float and the critical path.
  - Changing a task's dates or duration **ripples** to successors in one transaction, and the user sees a diff before saving.
  - Baselines are immutable snapshots; variance equals current minus baseline.
  - The promise-date risk is shown when the critical path end is after the promised handover.
- **Progress:**
  - A measurable task (qty) progresses by **approved** progress entries.
  - A non-measurable task progresses by status.
  - Package % is weighted by task weight; project % is weighted by package value.
- **Edge cases:**
  - A dependency cycle is rejected with the cycle path shown.
  - A predecessor is cancelled: the successor is re-linked or freed with a prompt.
  - A task moved to a non-working day snaps to the next working day.
  - A task split into subtasks: parent progress is rolled up and the parent can't be edited directly.
  - Reassigning a task whose owner left.
  - Bulk rescheduling (shift a package by N days).
  - A progress entry above the planned qty is rejected; a quantity change needs a reason.
  - A task done but its QC failed: reopened automatically as `in_progress` with a rework reason.
  - A task in two views (global board and project board) is the same row.
  - A reorder while another user edits: rank conflict resolved server-side.
  - Very large projects (2,000+ tasks): server-side paging and virtualized Gantt.
  - Offline mobile updates to a task changed on the server: a per-field conflict prompt.
- **Screens:**
  - **Tasks** (global): My tasks / Team / All, as grid or board by status, filters (project, package, owner, location, due), saved views.
  - Task inspector: title, status, owner, dates, readiness line, checklist, progress, files, comments, activity.
  - Project **Plan** = Gantt with dependencies and a critical-path toggle. **Board** = same tasks by status.
  - **Calendar** = tasks + bookings + meetings + site visits by person or team.
- **AI:** "What's blocking this project?" summary; suggested schedule from templates and historical durations; a draft daily plan per supervisor.
- **Tests:** CPM correctness; ripple transactional; gate can't be ticked; cycle rejection; readiness text for each condition.

### 6.12 Materials and client material sign-off
- **Records:** material_requirements (from package BoM or quote line: variant, qty, unit, supply_by, need_by), material_signoffs + lines (revision, client decision), sourcing_lines.
- **States:** requirement `draft → signed_off → sourcing → ordered | reserved → partly_received → received → issued → consumed`, plus `cancelled`.
- **Rules:**
  - Procurement can't start before the client material-list sign-off revision is approved (gate), unless the item is marked "no client choice".
  - Σ sourcing lines = required qty.
  - Need-by is derived from the task start minus lead time. **(Built:)** a task can say its package's materials must be there when it starts (*Materials: Needed when it starts*; the standard tasks set it on production, fitting, placing and installing). A material or bought scope line is needed by the earliest start of such open work in its package — a material tied to no scope line, by the project's earliest. It should be ordered its lead time before: the preferred (else longest) catalog supplier lead time, else the workspace's *Order ahead* days (Settings → Purchasing, default 14). *To order* shows *Needed by* and *Order by* (marked when passed); an order line says *Needed {date}*, or *Arrives after it's needed on {date}* when it's due later. The daily run tells the people who buy, per project, what should have been ordered by now (in-app and email; then weekly while it stays so).
  - **Stock counts first (built):** free stock reserved for the project (less released) or issued straight to it (less what came back) is counted before orders — matched by catalog item in the same unit, else by name and unit, the first need taking what it needs first. *To order* shows "{quantity} from stock" and leaves only the rest to order; over-ordering counts it too.
  - **Readiness (built):** open work that needs its package's materials lists those not in yet (received on orders or given from stock, short of what's needed): "N materials not in" on the list, and "Not in yet: …" on the item.
- **Edge cases:**
  - Client changes a finish after sign-off: new sign-off revision; affected POs and WOs are flagged for amendment.
  - Karen/founder sourcing approval: optional policy step (future), off by default.
  - A client-supplied item arrives late: blocks its tasks and alerts the PM.
- **Screens:** Materials tab (grid grouped by package: required / reserved / ordered / received / issued, and the next action per line) · Portal sign-off view (images, finishes, quantities, accept or reject per line).

### 6.13 Suppliers
**Built (Operations → Purchasing):** the supplier register on `workspace_vendors`:
- categories, approval (not reviewed / approved / on hold / not approved) with the categories it's the preferred supplier for;
- payment terms (upfront, advance % then rest on delivery, on delivery, N days credit, monthly statement) and a discount or commission deal;
- the main contact, and the buying companies (legal entities) that buy from it.

Approving is its own permission (`vendors.approve`), so adding a supplier never approves it. A duplicate name or tax number is refused, and archiving asks why. *Import* reads the list a firm already keeps (Excel/CSV, one sheet per company): it finds the columns by their names, turns written terms ("50 / 50", "SOA end of month", "30 days after received", "0.1", "Discount as requested") into those fields, merges rows with the same name, and gives approvals only when the person importing may approve. It shows what it will do first and is safe to run again.

**Built (supplier controls, in the supplier's sheet: Documents · Bank details · Performance):**
- **Documents** (trade licence, tax certificate, insurance, bank letter, other) with number, expiry and an optional file (PDF or photo). A new one of the same kind replaces the old, which stays as history. People who manage suppliers hear 30 days before one expires. When a *required* document has expired, the daily run puts an approved supplier on hold, with the reason.
- **On hold with open orders:** the buyers of those orders and the approvers hear. Each open order shows the hold, and can't be sent or received until someone who approves orders says it continues (with why); otherwise it's cancelled, or the rest is ordered elsewhere.
- **Bank details** are recorded as the supplier sent them (letter, email, in person, phone) and wait. Someone other than whoever recorded them records the call-back (who was called, on a number the firm already had) and then approves (the old account is retired) or refuses with why. Only people who approve suppliers see the whole number; others see the last four digits. One set of new details at a time.
- **Duplicates:** the same name, tax number or phone number (any formatting) on another supplier is refused.
- **Performance** from the records: orders and their value, lines delivered on time, rejected quantity and rate, returns, and how often and how fast the supplier answers price requests.
- **Rate contracts:** prices agreed with a supplier for a period (reference, currency, valid from/to), per catalog item, with pack size, minimum and lead time. While one is valid its price is an order line's default (before the catalog price) and its pack terms drive the pack hint; a line priced above it shows "Above the RC price". A contract is cancelled with why, not edited; expired or cancelled contracts price nothing.

- **Records:** vendors (`draft → pending_approval → approved → on_hold → blocked → archived`), sites, contacts, documents with expiry, bank accounts (Finance approval + call-back evidence), rate contracts + lines (price, validity, MOQ, pack size, lead time), scorecard view (on-time %, QC reject %, price variance, RFQ response time).
- **Rules:**
  - An RFQ may go to any vendor; a PO only to approved vendors.
  - An expired mandatory document puts the vendor on hold automatically.
  - Payments go only to an approved bank account.
- **Edge cases:**
  - Duplicate vendor (same TRN/phone).
  - Bank-change request by email (fraud pattern): requires a call-back.
  - Vendor becomes blocked with open POs: POs flagged with actions (continue with approval / cancel / replace).
  - A vendor that is also a customer: separate roles on the same party.
- **Screens:** Suppliers grid · Supplier inspector (details, documents, rate contracts, POs, invoices, scorecard).

### 6.14 Purchasing (RFQ → PO)
**Built (Operations → Purchasing: To order · Price requests · Orders · Deliveries · Suppliers; Settings → Purchasing):**
- **To order** lists, for every running project, the materials on its material list and the scope lines of bought (ready-made, bought materials) and subcontracted packages: needed, on placed orders, in draft, and left. It's derived from the records, not kept by hand. Projects whose client hasn't signed off the material list are shown apart and can't be ordered (a setting). Lines from several projects go on one order to one supplier.
- **Orders** (`purchase_orders`, `purchase_order_lines`, append-only `purchase_order_events`, frozen `purchase_order_revisions`):
  - Numbered by the buying company's numbering (`FAC-PO-2026-00001`).
  - Each line is for a material, a scope line or a free item.
  - Price comes from the supplier's catalog price when left empty. Discount defaults to the supplier's deal; tax defaults to the buying company's rate.
  - Amounts are exact: net = qty × price less discount, tax on net, each rounded to the currency's minor units; totals are sums of the lines.
  - Draft → waiting for approval (at or above the workspace's approval amount; other currencies always) → approved by someone other than the buyer → sent (branded email to the supplier, or marked sent; the delivery result is recorded) → confirmed (promised date and supplier reference).
  - *Change* on an approved order keeps what was approved and sends it through approval again. *Cancel* asks why and only works before anything arrives.
  - Deliveries move it to partly received and received (see §6.15). *Close* ends it; closing short asks why, and what never came goes back to To order.
  - Orders only go to approved suppliers (a setting). Sending records "ordered" in each scope line's history. The Procurement stage's check *Everything is ordered* reads the orders.
- **Notices:** approval needed (approvers, in-app and email), approved or sent back (the buyer).
- **Price requests** (`price_requests`, lines, suppliers asked, quotes):
  - *Ask for prices* from To order sends the chosen lines to several suppliers (any supplier may be asked), each emailed the list.
  - Replies are recorded per line: price and discount, delivery days, validity; a supplier can decline.
  - The comparison marks the cheapest per line after discounts. Each line is awarded to one supplier, and a dearer choice needs a reason.
  - Awarding creates one draft order per supplier at the quoted prices, still tied to the materials and scope lines. Only approved suppliers can be awarded (the setting).
- **Accuracy rules:**
  - Only materials the client chooses wait for their sign-off; a material can be marked "no client choice" (cement, screws). Bought and subcontracted scope lines were agreed in the quotation and order freely.
  - A material or scope line is ordered in its own unit.
  - Ordering more than a project needs says why, and the reason stays on the order. To order shows anything ordered past what's needed now (after a change).
  - A material on an order can't be deleted and keeps its unit.
  - An order's lines are saved in place: a line with deliveries or returns stays on the order, keeps what it's for and its unit, and can't go below what has arrived.
  - An expired supplier price can't be awarded, and the cheapest is chosen from valid prices only.
  - Create commands, and order and return commands sent with a command id, run once: a retry returns the result.
- **Following an order:**
  - The supplier's confirmation is per line: how much they confirm (less than ordered is shown on the line) and by when. The order's promised date is the earliest.
  - A line is due on its own promise, else the order's promise, else when it's needed. Expected deliveries sort by the first line still to come.
  - **Late orders:** the buyer hears the first day something still to come is late and then weekly, in the app and by email (in the daily reminder run). *Chase* records what the supplier said and a new date for the late lines.
  - **Cancel the rest of a line** with the reason (never more than is still to come; if nothing on the order would come, the order is cancelled instead). It can go to another supplier as a new draft order whose line is linked to the one it replaces. Still owed = ordered − cancelled − credited − accepted − waiting.
  - **Packs:** where the supplier's catalog price has a pack size or minimum, a draft line that doesn't fit shows the quantity that does, to use in one click (ordering past the need then says why).
- **Supplier alternatives:** the supplier's alternative for a line (another make, finish or size, with its price and why) is recorded on the line, and nothing on that line is received until it's decided. Someone who approves orders — not whoever recorded it — takes or refuses it (a refusal says why). An alternative never costs more (that's a changed order); for a material the client chooses, the material list is changed and signed off by the client first. Taking it keeps what was ordered first on the line and recomputes the order.
- Still to come: blanket orders, advances and retention (with payables), and vendor portal replies.

- **Records:** rfqs, rfq_lines, rfq_suppliers (sent/viewed/responded), supplier_quotes + lines (price, qty, lead time, validity, alternate item), purchase_orders (kind `standard | blanket | service`, revision), po_lines (ship-to **per line**: warehouse, factory or site), po_line_allocations (line → requirement/project, qty), po_revisions, po_acknowledgements (per line; partial allowed), blanket_releases, supplier advances.
- **PO states:** `draft → pending_approval → approved → sent → acknowledged | partly_acknowledged → partly_received → received → closed`, plus `cancelled` and `short_closed`.
- **Rules:**
  - Approval by amount and policy.
  - The spending guard runs **per project allocation** (one PO for two projects checks both wallets).
  - Σ allocations = line qty.
  - Received ≤ ordered + tolerance.
  - A PO line inside a valid rate contract may skip RFQ.
- **All cases:**
  1. **Phased/partial ordering:** order part of a requirement now and the rest later. The remainder stays visible in the buyer queue.
  2. **Consolidated order:** one PO, one vendor, many projects. Cost is booked per allocation.
  3. **Split award:** some lines to vendor A, some to B, with the reason recorded.
  4. **Amendment:** a qty, price or date change creates a new revision. Above tolerance it needs re-approval, and the vendor re-acknowledges. Qty can't fall below received.
  5. **Short-close:** cancel the undelivered remainder; demand returns to "to source".
  6. **Cancel:** only with no receipts.
  7. **Replacement:** a failed vendor gets a new line linked `replaces_po_line_id`.
  8. **Advance/retention:** advance payment request adjusted against invoices; retention is released after handover or a set period.
  9. **Service/subcontract PO:** received = approved progress quantity of the linked task.
  10. **Blanket PO:** call-off releases draw down qty and value; over-draw is blocked.
  11. **Direct-to-site:** cost books to the project on receipt and never touches warehouse availability.
  12. **MOQ/pack rounding:** the surplus is planned into stock and visible before approval.
  13. **Alternate item:** needs design or client approval if the spec changes.
  14. **Expired quote validity:** re-confirm before PO.
  15. **Vendor partially acknowledges:** a reduced qty or a later date updates the promised date, and the planning engine shows the impact.
  16. **Late delivery:** an expediting task is created automatically at promised date + 1.
- **Screens:**
  - **Purchasing** = Buyer queue (requirements to source across all projects, grouped by variant/vendor, multi-select → RFQ or PO)
  - RFQ comparison (item-wise table across vendors, pick per line)
  - PO grid
  - PO inspector (lines, allocations, revisions, acknowledgements, receipts, invoices)
- **Vendor communication:** RFQ and PO links sent by WhatsApp and email to the **vendor portal**; the vendor fills in prices and acknowledges there.

### 6.15 Receiving, inventory and payables
**Built (Purchasing → Deliveries; Settings → Purchasing → Receiving):**
- **Deliveries** has three views: *Expected* (sent and confirmed orders with lines still to come, the late ones marked), *To inspect*, and *Received*.
- **Receive** against an order (`goods_receipts`, `goods_receipt_lines`), numbered across the workspace:
  - Where it arrived: the project's site, the warehouse, the factory, or another place. `stock_locations` makes a project's site and the default warehouse and factory on first use.
  - When, the delivery note, and how much of each line came.
  - A line takes at most what's still to come plus the workspace's over-delivery allowance (0–50%).
  - Receiving again with the same id changes nothing.
- **Inspection** (a setting, on by default): everything that arrives waits until someone other than the receiver accepts or rejects it, with the reason for anything rejected. With inspection off, rejections are entered at receipt.
  - A line always has received = accepted + rejected + waiting. What arrived never changes (enforced in the database).
  - Rejected goods are still owed by the supplier.
- **Status and records:**
  - The order becomes partly received or received from its lines.
  - Accepted quantities show in To order and in each scope line's history ("received").
  - The order shows what arrived per line and its deliveries.
- **Delivery problems:**
  - A rejection says what was wrong (damaged, defective, the wrong item, not to spec such as colour, finish or size, or other) with a note.
  - A line can record what the supplier's delivery note says came. Anything short is flagged as missing, stays owed, and the buyer is told.
  - Inspection is line by line: some lines now, the rest later. The delivery counts as inspected once nothing waits.
  - **Returns to the supplier** (`supplier_returns`) cover rejected goods, and accepted goods found wrong later, from one delivery:
    - the supplier either *replaces* them (owed again, and the order goes back to partly received) or *credits* them (no longer owed, with the credit at the order line's price recorded for payables);
    - the supplier can be emailed the return note;
    - accepted goods leave stock when the supplier collects them;
    - an open return can be cancelled with a reason, and an order can't close while a return waits for pickup.
  - A delivery entered by mistake is **reversed** with a reason: it stops counting, exactly what it put into stock comes back out, and the order's status follows (back to confirmed or sent when nothing else arrived).
    - Its receiver can reverse it before anyone inspects it; a buyer can reverse it at any time.
    - A delivery can't be reversed once goods from it went back to the supplier.
  - Still owed on a line = ordered − credited − (accepted − returned after acceptance) − waiting for inspection.
  - A credit carries the line's net and tax. Each credit is the line's share up to now less what was credited before, so partial credits add up to the line exactly.
  - A project's site holds only that project's goods, and "today" is the firm's today in its time zone.
- **Site deliveries:** a delivery records who handed the goods over and takes up to 10 photos (checked as images, with previews, stored under the workspace). With the setting on (default), a delivery at a project's site without a photo shows "No photo yet" until one is added; the receive form asks for one at site.
- **Goods without an order** are recorded apart (who from, where, what the note says, photos), don't count and don't enter stock. A buyer matches them to an open order from that supplier, each line to one of its lines; they're then received like any delivery (by whoever received them, with inspection, stock and notices) and their photos go with the delivery. Or they're sent back, with the reason. Buyers are told when they arrive.
- **Notices:** inspection needed (inspectors), received (the buyer and the receiver), goods rejected and goods missing (the buyer), a return raised (the buyer), a delivery reversed (the buyer and the receiver), and goods without an order (buyers).
- **Permissions:** `stock.receive` and `stock.inspect`, alongside `purchasing.manage` and `purchasing.approve`.
- Accepted goods go into stock where they arrived (see Inventory below).

**Built (Operations → Inventory: Stock · Moves · History; Settings → Stock places):**
- **Stock** is held per item, place and owner: a project's stock, or free stock.
  - Items come from the catalog item, or by name and unit when there's none.
  - Every change is a row in the immutable `stock_movements` ledger. The database keeps `stock_balances` in the same transaction, and stock can never go below zero.
  - Deliveries add stock at the order line's price. Work bought as a service isn't stock.
- **Changes:** issue to a project, reserve free stock for a project or release it, take unused stock back from a project (only what was issued to it, with the reason), count (a difference needs its reason), and add opening stock with its origin. Each change runs once by its id, even when sent twice at the same moment.
- **Moves** between places: stock leaves when sent and arrives when received. Anything missing on arrival says why; a cancelled move puts everything back. One project's stock can't go to another project's site.
- **History:** the ledger per item, with the order, delivery or move each change came from.
- **Places:** warehouses, factory and other places in Settings; a project's site is made by its first delivery; a place with stock can't be closed.
- **Notices:** a move is on its way (receivers), a move arrived short (the sender), and stock was corrected (people who adjust stock).
- **Permissions:** `stock.view`, `stock.manage` and `stock.adjust`.
- **Units:** goods bought in another unit than the catalog item's (boxes of hinges kept as pieces) go into stock converted through the catalog's conversions and standard units (common ways of writing units, such as m² or nos, are understood), with the cost per stock unit; returns take out the same share.
- **Value:** stock is valued at moving average cost per item, place and owner, in the workspace's currency.
  - Goods in carry their cost: a delivery at its order price converted at that day's exchange rate, opening stock at the cost entered, a move at the cost it left with, a project return at the cost it was issued at.
  - Goods out leave at the average; taking out everything takes out all the value.
  - The stock grid shows each row's value and cost each, with the total worth; history shows each change's value.
- **Corrections needing approval:** a count whose difference is worth more than the workspace's limit (Settings → Purchasing → Stock) waits. Someone else with `stock.adjust` approves it, or refuses it with why; they are told when it waits.
**Built (Business → Finance: Supplier invoices · Payments · Payment runs · Owed to suppliers; Settings → Purchasing → Supplier invoices):**
- A supplier's invoice is entered as printed: their number (once per supplier unless cancelled), dates, the printed total, and lines taken from an order (what's still to invoice, at the order's net price and tax) or typed for charges not on an order (going to the project the order lines share). The supplier's PDF or photo is attached.
- **Three-way match on submit:** each order line invoiced (across held and approved invoices) no more than was accepted plus what the supplier credited; the price no more than the tolerance above the order's net price; the order's tax rate; the lines adding up to the printed total. A match is approved at once; otherwise it's **held** with each reason, and someone other than who entered it approves it with why (or it's cancelled with why).
- **Debit notes** follow from credited returns automatically: only the credited quantity that had been invoiced (invoiced beyond what was kept), so a return before invoicing needs none. Rounded to the currency; partial debits add up to the credit.
- **Payments:** paid on, amount (in the currency's minor units), how, reference (once per supplier). A bank payment goes only into the supplier's approved bank account (and says when new details are waiting). A payment goes against approved invoices, never beyond what an invoice or the payment has left; the rest stays with the supplier to allocate later. An **advance** names its order and goes against that order's invoices automatically when they're approved. A payment that didn't go through is reversed with why and its invoices are owed again. An invoice with payments can't be cancelled until they're reversed.
- **Owed to suppliers**, per buying company and currency: approved invoices − payments − debit notes; overdue (open invoices past due, never more than owed); held amounts; paid-ahead balances.
- One supplier's invoices and payments change one at a time (advisory lock), every command is idempotent and audited, and invoices are version-checked.
- Notices: a held invoice tells the approvers; invoices due within three days or overdue tell the people who pay, once per supplier until the set changes.
- **Retention:** the share of each invoice a supplier's terms hold back until handover, copied to its orders (changeable while an order is a draft).
  - Fixed when an invoice is approved: each order line's net at its order's share, summed per project and rounded once to the currency; charges not on an order hold nothing. Later terms never change it.
  - What's held isn't payable, overdue or due; Owed to suppliers shows it apart.
  - Released by the daily run once the client accepted the project's handover (each project of a multi-project invoice on its own), or earlier or later — all or part — by someone who approves payables, with why. Each release is recorded (automatic, or who and why); the people who pay suppliers are told.
- **Payment runs** (Finance → Payment runs): someone who pays suppliers lists approved invoices and how much of each (up to what can be paid now; everything due by a date at once) and submits it. Someone else — not who prepared it, enforced in the database — approves it or sends it back with what to change; it can be cancelled with why until it's paid.
  - A submitted or approved run reserves what it pays: no other run or direct payment takes the same balance, and its invoices can't be cancelled.
  - Approval and payment check everything again: each invoice still approved and payable, and each supplier with an approved bank account and no new details waiting. The account is fixed at approval; a change after it stops the payment until the run is approved again.
  - An approved run downloads as a bank file (supplier, account name, bank, account number — whole only for people who verify bank details — SWIFT, amount, currency, reference). Each download is audited.
  - Marked paid with the bank's reference per payment: one bank payment per supplier, company and currency, allocated exactly as the run says, all at once and once only.
  - Notices: submitted (approvers), approved or sent back (the preparer), paid (the preparer).
- **Pay through approved runs** (Settings → Purchasing → Supplier invoices, off by default): invoices are paid only through runs; an advance on an order is still recorded directly.

- **Receiving:**
  - Records: shipments/ASN (from the vendor portal), goods_receipts + lines (`received = accepted + rejected + pending_qc`), inspections (shared), vendor_returns + lines, debit_notes, and an unmatched-receipt queue.
  - Cases: multiple partial deliveries; over-delivery within tolerance, else held; under-delivery then remainder or short-close; wrong item; damaged; pending QC in a **quarantine** location; partial QC pass; receipt with no PO (queue, can't enter stock until matched); unit conversion; site receipt by mobile photo; a defect found after acceptance (reverse movement + debit note).
- **Inventory:**
  - Records: stock_locations (warehouse, factory, site, in-transit, quarantine), **stock_movements** (immutable ledger: `receive | issue | transfer_out | transfer_in | reserve | unreserve | adjust | return | scrap | offcut`), stock_balances (maintained in the same transaction), reservations, cycle counts.
  - Rules: available = on hand − reserved − quarantine ≥ 0; negative stock is impossible; moving-average cost per variant and location; adjustments above a threshold need approval.
  - Cases: transfer in transit (sent ≠ received; a loss in transit becomes an adjustment with approval); site surplus returned; partial issue; issue to the wrong project (reversal movement, never edited); offcuts as sub-records (optional); a stock count difference becomes an adjustment with a reason.
- **Payables:**
  - Records: supplier_invoices + lines matched to PO lines and receipts (**3-way match**), supplier_payments + allocations, credit/debit notes.
  - Cases: partial invoices; invoice before receipt (held); variance above tolerance (approval); duplicate invoice number per vendor (blocked); advance adjustment; retention; scheduled and partial payments; payment approval; paid ≤ approved − debit notes.
- **Screens:** Inventory = stock grid (variant × location: on hand, reserved, available, quarantine, value) + movements ledger + transfers + counts. Receiving = expected deliveries today, and receive against a PO (mobile first). Payables = invoices to match, and payments due.

### 6.16 Factory
- **Records:** workcenters (capacity per day), work_orders, work_order_allocations (task → WO qty; **partial**), production_batches + batch_work_orders (cross-project runs), work_order_materials (BoM lines → requirements; partial issue), work_order_operations (routing; outsourced step linked to a service PO line), production_outputs (approved by another person; scrap with reason), production_lots (QC-passed output of **one** allocation), rework_orders, dispatches + lines, site_deliveries + lines.
- **WO states:** `planned → released → in_production → qc → ready → dispatched → closed`, plus `on_hold` and `cancelled`/`short_closed`. **Released** requires the approved drawing, H3 payment, materials issued or reserved, and a capacity slot.
- **All cases:**
  1. **Partial work orders:** a task of 10 splits into WOs of 4 + 6. Σ allocations ≤ task qty under lock; a parallel 6 + 6 lets only one succeed.
  2. **Cross-project batch:** one cutting run for three projects; each WO keeps its lineage and cost.
  3. **Material shortage:** WO stays planned, with readiness text and a buyer alert. A substitution needs approval.
  4. **Partial output reports:** each is approved separately; output above the allocation is rejected atomically.
  5. **QC partial pass:** passed qty forms a lot; failed qty becomes a rework order linked to the source lot. Rework output replaces the rejected qty and never adds extra credit.
  6. **Outsourced operation** (polish, upholstery): send-out and receive-back through a service PO line; the WO waits in that operation.
  7. **Design revision during production:** affected WOs are "stale drawing" and stopped; the PM decides continue/rework/scrap with approval.
  8. **Deduction variation:** affected WO is blocked for replanning, never deleted.
  9. **Cancel:** only without output; otherwise short-close the remainder and return unused materials.
  10. **Capacity overload:** the schedule shows conflicts per workcenter per day; the planner moves WOs and the ripple reaches site tasks.
  11. **Ready-made items** never create WOs.
- **Dispatch and delivery:**
  - A lot can go in several trips.
  - Dispatched ≤ passed lot qty − previous dispatches + returns.
  - Site delivery records accepted and rejected qty. A rejected qty creates a snag plus a rework order and a return trip automatically.
- **Screens:** Factory = production queue (WOs by workcenter and day: board + grid) · WO inspector (allocations, materials, operations, outputs, QC, lots, dispatches) · Dispatch planner (ready lots → trips).
- **Build order:** F1 work orders, release checks, output reports, QC and ready stock ✔ → F2 work-order materials (issue, shortage, substitution) ✔ → F3 capacity schedule and cross-project batches ✔ → F4 outsourced operations ✔, drawing revisions ✔, deduction variations ✔, dispatch ✔ → site acceptance with rejections (snag, rework, return trip) with Site (phase 7).
- **F1 (built) — Operations → Factory: To make · Work orders; Settings → Factory:**
  1. *To make* lists the scope lines of packages made in our factory, in running projects: quantity, on work orders, left. *Plan work order* takes all or part of what's left (Σ work orders ≤ the line, under a lock), a workcenter and planned dates (by default the package's work that needs its materials).
  2. *Release* passes only when its checks do, each shown with what's missing: the project is running; the drawing is approved (a reference, recorded by whom and when); payments before production are verified; the package's materials are in (from orders or stock); a workcenter and dates are set. Each check is a Factory setting.
  3. *Start*, then *Report output*: good and scrapped (scrap needs why). Someone else approves or refuses each report; approved good can't pass what's left to make.
  4. *Quality check* of approved output: passed goes into stock at the factory, owned by the project (moved to site with Inventory → Move stock); failed says why and is made again (it never counts twice). With no check required, approval passes it.
  5. The work order is ready when all of it passed. On hold with why and resumed; cancelled only with nothing made; otherwise short-closed with why, and what wasn't made goes back to *To make*.
  - Notices: released (factory people and the project's factory lead), a report waiting (approvers), a check failed (factory lead and project manager), ready (project manager and installation lead).
  - Permissions: `factory.view`, `factory.manage` (plan, release, start, hold, close), `factory.report`, `factory.approve` (approve reports, check quality).
  - Records: `workcenters`, `workspace_factory_settings`, `work_orders` (numbered WO-n), `work_order_reports`, `work_order_checks`, `work_order_events`; made goods are `produce` movements in the stock ledger, and Inventory → History names the work order.
- **F2 (built) — materials on a work order (its sheet → Materials):**
  - Each material is a stock item and a quantity: from the project's material list or any other by name and unit. *Add from the material list* adds the materials used only on the work order's line, at its share of the line (rounded up).
  - *Issue* from the project's own stock or free stock at a place; more than it still needs only with why. *Return* sends issued stock back to the project's stock at the cost it was issued at, with why. Issued value shows as *Issued worth*.
  - The quantity can't go below what's issued; a material is removed only while none is issued.
  - *Swap for another* (with why) waits for someone else with `factory.approve`; approved, the old material is replaced (what was issued of it can still come back).
  - Release: when a work order lists materials, each must be issued or covered by the project's own stock after what its other running work orders still need of it; otherwise its package's materials must be in.
  - The daily run tells the people who buy about a work order that should start within a week (or already should have) and still waits for materials — once, then weekly.
- **F3 (built) — Schedule and Batches:**
  - A work order can carry the hours it takes. *Schedule* shows each workcenter's work orders over 2, 4 or 8 weeks and, first, the days a workcenter has more hours booked than its hours a day (hours spread evenly over each work order's working days, on the workspace calendar), naming the work orders that fill them; those rows say "Over".
  - *Batches:* work orders from any projects that haven't started run together (*Run together* from selected work orders: a name, workcenter and day). Each keeps its project, output and checks; a work order is in one open batch at a time. *Start batch* starts every released work order in it (a planned one must be released or taken out first; one whose scope changed can't start).
- **Stage check (built):** the default route's Production stage finishes on *Everything is made and checked* — every active scope line of its made packages has passed its checks in full (true when nothing is made) — read from the factory's records instead of a person confirming it; routes can use it on any stage.
- **F4 (built) — done outside and to site:**
  - *Send a step out* (what the supplier does, supplier, quantity, price each, back by) raises a draft service order linked to the work order for the buyer to place. Its quality check waits until the goods are back (received on that order); receiving it brings back our own goods, so nothing is added to stock. The sheet shows each step with how much is back and its order.
  - *Send to site* moves made goods from the factory to the project's site as a move linked to the work order (never more than is at the factory); the site receives it like any move, and what arrived short says why. The sheet lists each trip and what's still at the factory.
- **Changes after planning (built):**
  - *Deduction variation:* when a variation removes a work order's scope line or leaves it with less than its work orders hold, those work orders can't be released, started or reported on ("Scope changed"); the factory managers are told when the variation is applied. *Change quantity* brings a work order back within the line (never below what's made or waiting, never past the line); a removed line's work orders are cancelled or closed short. *To make* shows how much more is on work orders than a line needs.
  - *Drawing revision:* *Drawing changed* (new reference and what changed) records the new drawing and puts released or running work on hold; the factory lead, project manager and approvers are told. Someone other than who recorded it lets it go on (*Go on with the new drawing*); otherwise it's closed short and made goods are written off in Inventory.

### 6.17 Site execution
- **Records:** daily_reports (date, author, workforce by trade, weather, safety state `none|observation|incident`, forecast state `none|watch|blocked`, impact/recovery plan/next update date, photos), daily_report_lines → task_progress_entries, installation records (task progress), site deliveries, access/permit notes, commissioning checks.
- **Rules:**
  - A report needs evidence or a no-work reason.
  - Progress is approved by someone other than the reporter.
  - **Installed ≤ accepted delivered qty** from linked lots.
  - A delayed or blocked report needs a recovery owner and date.
  - Nothing auto-rewrites dates; the PM applies them.
- **Edge cases:**
  - Two supervisors report the same task on the same day: both entries count after approval, and duplicate photos are flagged.
  - A correction after approval: a superseding entry; history is never edited.
  - An incident affecting the schedule: a critical action on Home for the PM.
  - No report by 19:00: reminder; none by the next morning: flagged.
- **Screens:** Mobile: Today (my site tasks) → update qty + photo, daily report in under 60 seconds, receive delivery, raise snag. Web: Site tab (reports feed + approval queue).
- **AI:** draft the daily report from photos and a voice note; weekly client update from approved reports.

- **Built (project → Site):**
  - The project manager starts and finishes site work. While it runs, the daily run reminds the site supervisor from 19:00 when nobody has submitted today's report, and tells the project manager when a worked day ended without one.
  - A report (one per person, project and day): who worked by trade, the weather, what was installed against the scope, safety (none, an observation, an incident with what happened) and the outlook (at risk or blocked, with what's at risk, who recovers it and by when), notes, and photos — or why no work was done. It's a draft until submitted; the project manager is told.
  - Someone other than its author approves it or sends it back with what to change. Approved installation never passes the scope line and, for goods bought or made, takes them from the project's stock at its site — nothing is installed that didn't arrive. A correction is a later report taking some back, with why.
  - An incident tells the project manager at once (in-app and email); a blocked day tells them too.

### 6.18 Quality and snags
- **Records:** inspections (shared: output, receipt, installation, handover), checklists (templates per package type), snags (space, task, severity, source `inspection|delivery|client|warranty`, owner, due date, photos before/after), commissioning checks.
- **States:** snag `open → in_progress → ready_for_review → closed | reopened`.
- **Rules:** the closer ≠ the fixer; closing needs an "after" photo. A critical snag blocks handover.
- **Edge cases:**
  - The client raises a snag in the portal: staff triage it into a snag or reject it with a reason.
  - A snag belongs to the supplier's product: vendor return or claim.
  - A snag reopened after closure keeps its history.

- **Snags (built, on the task system):**
  - A snag is project work of type *Snag* with a severity (minor, major, critical), where it came from (the team, an inspection, a delivery, the client, a warranty claim) and the area it's in; the list shows major and critical ones.
  - Photos before and after (up to 10 each). Moving it to *In review* records who fixed it and tells the project manager and whoever raised it; someone other than the fixer or its assignee closes it, and only with a photo after. A closed snag opens again only with why (the assignee is told); its history keeps both.
  - A move that arrives short at a project's site raises a major snag from the delivery, in the package and scope line of the work order it came from.
  - Stage checks *All snags closed* (the default Snagging stage) and *No critical snag open* (the default Handover stage) read them.

### 6.19 Handover, final account and aftercare
- **Records:** handover_packs (revision, frozen contents: drawings, warranties, manuals, care guides, as-built photos), handover_items (outstanding), client_acceptances (portal, OTP), final_account (agreed + variations − deductions − received = balance), warranty_terms (per package/item, from the handover date), warranty_claims → snag/task.
- **Rules:**
  - **H4:** the project becomes Complete only after client acceptance of the frozen pack, zero critical snags and a closed final account (or an approved exception with a reason).
  - The client can accept with minor outstanding items listed.
- **Edge cases:**
  - The client refuses handover: the reason becomes snags and a new pack revision.
  - Partial handover (some rooms first): pack per space group.
  - A balance still due at handover: the payment request blocks Complete unless Owner waives.
  - A warranty claim after expiry: chargeable job (a new variation round).

- **Built (project → Handover):**
  - A pack (for the whole project or some of its areas) gathers what the client receives: drawings, warranties, manuals, care guides, as-built photos (PDFs or photos). Issuing it freezes revision R#: its contents listed and fingerprinted, and the database refuses any change after.
  - The project manager records the client's decision on an issued revision (who, when, how). Accepted: only while no critical snag is open in its areas; anything still outstanding becomes minor snags from the client; the team is told. Refused with why: the reason becomes a major snag, and a new draft revision (same documents) is made to issue once it's fixed.
  - The default Handover stage finishes on *The client accepted the handover*: accepted packs cover the whole project (a whole-project pack, or every area).
  - Still to come: the final account and a waiver for a balance still due (Money, phase 9). The client also accepts or refuses an issued pack in the client portal (§6.22).
- **Warranty and aftercare (built, project → Warranty; Settings → Projects → Warranty):**
  - Months of warranty per way a package is delivered (defaults: 12; nothing for what the client supplies). When the client accepts a handover pack, each scope line it covers starts its warranty that day, ending the day before the same date that many months later. The project manager can change an item's months, with why.
  - Claims are recorded as the client raises them (when, who, how, what, the item and area); the project manager and account manager are told (in-app and email). The project manager decides: *Covered* (inside the item's cover — or with why, as goodwill) raises a warranty snag; *Not covered* and *Chargeable* say why. A completed project still works its warranty snags; nothing else on it changes.
  - The daily run tells the account manager and project manager when warranties end within 30 days (once per project and end date).

### 6.20 Change orders (variations)
- **Records:** change_orders (kind `addition | deduction | replacement | move | schedule | price_correction`), impact assessment snapshot (affected packages, tasks, POs, WOs, bookings, reported work) with an explicit disposition per impact, variation quote rounds.
- **Rules:**
  - Nothing is released until every linked quote is accepted and paid (per policy).
  - A deduction blocks affected work for replanning and never deletes it.
  - A replacement = a paired deduction + addition.
  - Supplier commitments and reported work must be reconciled before release.
- **Edge cases:** the client rejects the variation (withdraw and restart with a fresh assessment); a partial acceptance stays pending; a variation during production follows factory case 7.

### 6.21 Finance (company view)
- **Records:** invoices + lines (per legal entity, tax per line, TRN), credit notes, receipts (shared), cost_entries (immutable project cost ledger from receipts to project, stock issues, labour, subcontract, petty cash), budgets per package, petty_cash_claims, accounting_postings (outbox to the provider).
- **Project wallet view:** agreed (quotes + variations), invoiced, received, committed (open POs), actual (cost entries), margin (with permission), forecast.
- **Spending guard:** a new commitment is checked against received − (actual + committed) per project, with the policy per tenant (strict / warning / off). An override needs Owner approval with a reason.
- **Edge cases:**
  - VAT rounding per line vs per invoice (tenant setting).
  - An invoice cancelled after posting to accounting: credit note, never delete.
  - A multi-entity tenant: each invoice belongs to one entity with its base currency.
  - Exchange rate changes between PO and invoice: variance recorded.
- **Screens:** Money tab per project · Finance area (Receivables, Payables, Approvals, Postings).
- **Built (Business → Finance → Client invoices):**
  - A tax invoice is issued for a started project's payment milestone (baseline or variation quotation sealed into the project):
    - numbered by its company's invoice sequence (Settings → tax and numbering);
    - split exactly by the sealed quotation's tax rates — each rate's share of the milestone follows its share of the quotation's total, tax is carved out of the amount the client pays, and the shares add up to the milestone;
    - the client, their address and tax number, and the company (name, address, tax number) as they were on the day.
  - One live invoice per milestone. Issued invoices, their lines and credit notes never change or go away (database guard).
  - A correction credits the invoice in full with a numbered credit note and why; the milestone can then be invoiced again. Price changes go through a variation, never a partial credit.
  - An invoiced milestone's amount and title are fixed on the deal until the invoice is credited.
  - Paid comes from the finance-verified receipts allocated to the milestone.
  - Notices: overdue invoices tell the people who issue invoices and the project's managers (once per invoice); a credit tells the project's managers.
  - The Money tab shows what's invoiced.
- **Built (project → Money, for people who see costs; budgets by people who manage costs):**
  - **Costs are read from what caused them, never typed:**
    - stock entering or leaving the project's ownership at its moving-average cost: received for it, allocated, issued from general or another project's stock, returned, released, corrected, sent back to the supplier, or a reversed delivery;
    - its own stock used on its own work, moves inside its stock, and factory output (whose materials were counted when issued) change nothing;
    - services and outside work as received, at the order's net price;
    - approved supplier invoices: the price difference on order lines, and charges not on an order;
    - site labour: the people per trade on approved site reports, at the trade's day rate on the report's day (not in a package);
    - factory labour: the hours reported with approved output, at its workcenter's hourly rate on the day it was reported (in the work order's package);
    - approved petty cash, on the day it was spent (in its package when it names one; reimbursing it adds nothing);
    - other currencies at the rate of their day; entries with no cost, labour rate or exchange rate are counted and shown as not costed.
  - **Committed:** the rest of each line on placed, open orders (and goods not yet inspected) at the order's net price.
  - **Client side:**
    - agreed = the sealed baseline plus sealed variations (in total and before tax);
    - received = finance-verified payments on those quotations.
  - **Summary:** margin = agreed before tax − spent − committed, and cash in hand = received − spent − committed, both only when the project and the workspace share a currency.
  - **Budgets:** one per package, plus one for costs not in a package; version-checked and audited. A package whose spent + committed passes its budget tells the project managers and cost managers once per budget version.
  - **Spending guard (Settings → Purchasing → Project money):** when an order is placed or approved, each project on it is checked against its money in hand (received − spent − committed, in the workspace's currency; projects kept in another currency aren't compared, and a missing rate counts as short).
    - Off lets it through. Warn lets it through, records it on the order, and tells the projects' managers and cost managers.
    - Strict stops it with what's in hand and what it needs. The buyer can ask; someone with `projects.funds_override` (Owner by default) lets it go ahead with why. Changing the order's lines clears that.
  - **Labour rates:** a day rate per trade (Settings → Projects → Labour rates, listing the trades site reports use without one) and an hourly rate per workcenter (Settings → Factory), each from a date: a new rate never rewrites the days before it; the same date again corrects that rate, version-checked. Factory output is reported with the hours it took (optional, at most 1,000).
  - **Petty cash (project → Petty cash; Finance → Petty cash):**
    - Anyone on the project's team claims what they spent for it (PC-n): the day, the amount in the workspace's currency, what for, the kind, optionally the package, and a receipt or why there's none. It's a draft until submitted.
    - The project's manager (or someone who manages projects) approves it or rejects it with why — never their own claim, which the database refuses too. Approved, it's a cost of the project; people with `payables.manage` reimburse it once, with a reference. Each person sees their own claims; whoever decides sees them all.
    - Notices: submitted (the project's managers), approved or rejected (the claimant), to reimburse (people with `payables.manage`), reimbursed (the claimant).

### 6.22 Client portal
- **Access:** passwordless (email/phone OTP), per deal and project grants, multiple client contacts with roles (decision-maker vs viewer).
- **Content (published projections only):** timeline, current approved scope and designs, decision requests (quote, design, material list, variation, handover), payment requests with a pay link, progress stories (staff-approved), documents, handover pack, warranty claim form.
- **Rules:**
  - Every item carries an exact revision. Decisions are OTP-verified for high-stakes items (quote, variation, handover).
  - Nothing unpublished, no cost, margin, supplier, internal note or risk leaks. This is verified by a projection test that lists every field.
- **Edge cases:**
  - The client forwards a link: OTP binds to their contact.
  - Two decision-makers disagree: the first valid decision wins and the other sees the result.
  - Expired link: request a new one.
  - Mobile-first layout; Arabic/RTL ready.

- **Built (the client portal; Settings → Client portal; project → Updates → Client portal):**
  - **The tenant's own site:** `/portal/{link}`, or `/portal` on the tenant's own domain or sign-in subdomain. Their logo, name, colours and fonts from the branding record through the design tokens; always light, with their brand surface as the header and foot so their logo reads (the device's dark preference is not followed); the client's language and direction; the tab shows their name and logo; Wodana only as "Powered by". Their support phone, email and WhatsApp at the foot.
  - **Sign-in:** the mobile number the team has for the contact, and a 6-digit code by WhatsApp — or by email when WhatsApp can't (no connection, not on WhatsApp). The same answer whether or not a number has access. Codes last 5 minutes, allow 5 tries and are used once; a number gets one every 30 seconds and at most 6 in 10 minutes, a requester at most 20. The first sign-in confirms the client's name. A session lasts 30 days without use (90 at most); staff sign a contact out everywhere, and changing a contact's number, role or access, or switching the portal off, ends their sessions.
  - **What the client sees** (only what the tenant allows and staff published, field by field; a hidden section is never sent):
    - *Home:* the project, its stage (n of m, with its name if shown) and handover date, what's needed from them (decisions, invoices to pay), the latest shared update and their project manager's name.
    - *Progress:* the stages, the status updates staff shared (their words, never the status) and the photos staff chose from approved site reports.
    - *Decisions:* quotations and variations as issued (with their options priced by the quotation engine), designs shared for review, the requirements to confirm, the material list (names, finishes, quantities and areas; never suppliers, codes or notes), handover packs and the team's questions — each at its exact revision.
    - *Payments:* tax invoices (number, dates, amount, paid, what's left, overdue) with what was received on them, and the payment schedule; a pay link only where one exists; amounts only if the tenant shows them.
    - *Documents:* the signed agreement, approved designs and issued handover packs. *Warranty:* what's covered until when, the client's reports and a form to report a problem. *Messages:* the client's requests and the team's replies (as "your project team").
  - **Decisions:** quotations, designs, the requirements, the material list and handovers are confirmed with a fresh code bound to exactly that record and choice; a quotation only by the decision-maker it was issued to, the rest by any decision-maker on the project (the first decision stands; the other sees it). Accepting a handover lists what's still to finish (minor snags) and starts the warranty; refusing says why (a major snag and a new revision). A warranty report is a claim with the client contact as its author. The team hears each decision. Every portal command is idempotent by its id (a retry returns the first result; a different body under the same id is refused) and audited with the client contact.
  - **Tenant controls:** portal on or off; which sections clients see; what progress shows (stage names, dates, updates, photos); whether invoice amounts show; welcome title and text; support contacts; a live preview in the real brand. Per project: a narrower set of sections, or a pause that hides the project and stops its notices. Staff share each status update and each approved site photo on purpose. Client contacts (name, mobile, email, decision-maker or viewer) are managed on the pre-project and on the project.
  - **Client notices** (email in the tenant's brand, once per event, opening the portal where the thing is; never while paused or for a hidden section): a quotation or variation issued (everyone on the project), an invoice issued (everyone), a design, material list or handover waiting (decision-makers), an update shared (everyone). Tenants edit the texts like other templates.
  - **Proof:** a real-database test lists every field the portal may return and fails when another appears, and checks that costs, margins, suppliers, codes, notes, evidence, providers, other staff names, unshared updates and photos never reach the client.
  - Still to come: WhatsApp notices once the tenant's templates are approved; a per-document share choice beyond the agreement, approved designs and handover packs; client payment by card from the portal (a pay link shows when the accounting invoice has one); the vendor portal on the same pattern.

### 6.23 Vendor portal
- **Access:** OTP per vendor contact, scoped to their RFQs and POs.
- **Content:** RFQ response (price, lead time, alternates), PO view/acknowledge (per line, dates), dispatch notes (ASN), invoice upload, payment status.
- **Rules:** a vendor never sees another vendor, the project value or the client identity beyond the delivery address.

### 6.24 Notifications
- **Records:** notification_rules (event → audience → channels → template → quiet hours), notifications (per recipient and channel), delivery_attempts (provider receipt), templates (per language, per channel), preferences, device endpoints, digests.
- **Flow:** outbox event → rule match → recipient resolution **within the tenant context** → in-app always + email/WhatsApp/push per rule and preference → delivery receipt → retry with backoff → dead-letter with an alert to the admin.
- **Reminders:** scheduled per tenant: due today, overdue, decision pending, SLA about to breach, hold review, document expiry, report missing. A tenant enumerator runs as a `SECURITY DEFINER` function, then each tenant's reminders run in its own RLS context. This fixes the current bug.
- **Rules:**
  - Idempotency key per event + recipient + channel.
  - Quiet hours are respected, except for critical items.
  - A "delivery verified" state is shown only with a provider receipt.
  - WhatsApp to clients uses approved templates only.
- **Default event matrix (tenant-editable):**

  | Event | Who | Channels |
  | --- | --- | --- |
  | New enquiry / takeover / SLA breach | owner, queue, Sales manager | in-app, push, WhatsApp (staff) |
  | Quote needs QS / returned / approved | QS / preparer | in-app, email |
  | Quote issued | client | email + WhatsApp link to portal |
  | Client accepted / rejected | Sales, account manager | in-app, push |
  | Deal submitted / Finance returned / verified | Finance / submitter / Owner | in-app, email |
  | Project opened | PM, project members | in-app, email |
  | Approval requested (any) | approver | in-app, push, daily digest |
  | Task assigned / due / overdue / blocked | owner, PM | in-app, push, digest |
  | Material sign-off requested | client | portal + WhatsApp/email |
  | PO sent / acknowledged / late | vendor / buyer | vendor: WhatsApp/email; buyer: in-app |
  | Receipt pending QC / QC failed | QC / buyer, PM | in-app |
  | WO released / stale drawing / QC failed | factory lead / PM | in-app, push |
  | Daily report missing / incident | supervisor / PM | push |
  | Snag assigned / ready for review | owner / reviewer | in-app, push |
  | Payment request / receipt verified | client / client + Finance | email/WhatsApp + portal |
  | Handover ready / accepted | client / PM, Owner | portal + email / in-app |
  | Vendor document expiring | buyer, Finance | in-app, email |

### 6.25 Integrations
One adapter interface per capability. States: **Not configured → Connected → Delivery verified (date)**. A test action produces a real receipt.

| Capability | Provider | Direction and notes |
| --- | --- | --- |
| Email | Mailgun (exists); SES optional | out: templates, receipts, bounces → contact point flagged |
| WhatsApp | Meta Cloud API (Embedded Signup exists) | out: templates; in: messages → CRM conversation; status webhooks; the 24-hour session rule is respected |
| Push | Expo | device registration exists; invalid tokens pruned |
| Calendar | Google (exists), Microsoft later | site visits, client meetings; free/busy |
| Lead ads | Meta Lead Ads, PlyLeads | in → intake events; field mapping per form |
| Payments | Stripe / Network International / Telr (UAE), Razorpay (IN) | payment link → webhook → receipt `recorded`, then Finance verifies (never auto-verified) |
| Accounting | Zoho Books, QuickBooks Online | out: suppliers, supplier bills (matched to orders and receipts), supplier payments, credit and debit notes, client invoices and receipts, per buying company and tax code; in: payment status; a reconciliation job flags differences; Wodana stays the source of truth |
| Storage | S3-compatible | per-tenant prefix, malware scan, signed URLs |
| E-sign | native in P3 (§0.7 R8); DocuSign/Zoho Sign optional | proposals, agreements, change requests, handover |

**Built — accounting sync (Settings → Accounting; Business → Finance → Accounting):**
- **Setup:** each company posts to one connected QuickBooks or Zoho Books account from a start date. Its item for invoice lines, expense account for bills, the accounts supplier payments come from and client payments go into, its petty cash expense account and the account petty cash is paid from, and a tax code for each rate it uses are chosen from the accounting system's own lists.
- **Postings:** every document gets an outbox posting — tax invoices, credit notes (after their invoice), finance-verified client payments on invoiced milestones, approved supplier bills, each supplier payment allocation (after its bill), and petty cash once reimbursed (an expense from the petty cash account, for the company that contracted the project). A payment reversed after posting gets a void; one reversed before it's posted is cancelled.
- **Sending:** the integration worker leases due postings for five minutes, oldest document first, each after what it depends on was sent, and reports back.
  - A missing mapping (item, account, a taxed rate's code) blocks the posting with what to choose; posting the wrong tax is never an option.
  - Contacts are found by name or created, then remembered.
  - QuickBooks requests carry the posting id, so a retry never creates a duplicate; on Zoho a retry first looks for what the posting may already have created (its number, or the marker in a payment's reference).
  - Retryable failures back off (1 minute doubling to 6 hours, 8 tries); others wait for someone to retry.
  - A provider total that differs from Wodana's is flagged.
  - People who manage accounting hear once when a posting needs them. The connection can't change once documents were posted to it.

Edge cases: provider down (queue and retry, visible status); token revoked (connection falls to "Needs attention", admin alerted); webhook replay or out-of-order (idempotent, ordered by provider timestamp); a WhatsApp number not on WhatsApp (fallback to email/SMS).

### 6.26 AI
- **Gateway** (Python service): provider abstraction (Gemini now; Claude/OpenAI swappable), prompt registry with versions, `ai_runs` (model, prompt version, tokens, cost, latency), a per-tenant budget and rate limit (Redis), PII minimization, and "record content is data, not instructions" guarding.
- **Suggestion primitive:** evidence + proposed diff + confidence → human accept, edit or reject. Accepting runs the owning module's normal command (validated, permissioned, audited). AI never approves, sends, prices, releases, pays or publishes.
- **Features (in order):**
  1. Quote draft from requirements, measurements and catalog.
  2. Quote check.
  3. Catalog import mapping.
  4. Requirements extraction from site-visit notes, voice and photos.
  5. Next action and risk summary per deal and project.
  6. Daily report draft from photos and voice.
  7. Weekly client update draft.
  8. Enquiry first-response draft.
  9. Natural-language search ("kitchens waiting for material").

### 6.27 Home, search and reports
- **Home = my next actions** (derived, not typed): approvals waiting for me, tasks due or overdue, blocked items I own, client decisions overdue, SLA timers, incidents. Each item has a reason, a date and a do-it button.
- **Search (`⌘K`):** customers, enquiries, deals, projects, quotes, POs, WOs, items, people; permission-filtered.
- **Reports** (each reconciles to its list): lead source/channel/owner/SLA; funnel conversion and time per stage; pipeline value; quote win rate; receivables ageing; project portfolio (stage, promise risk, margin); purchasing (open POs, late deliveries, vendor scorecard); factory (throughput, QC rejects); site (reports compliance, snags). All can be exported to CSV.

### 6.28 HRMS (kept, narrow)
Attendance, leave and calendars stay. People appear in planning only as **availability** (leave blocks assignment and bookings). Private personnel data never enters project views.

HR in a fit-out firm covers four groups: studio staff (hours per project against design fees), site teams (check-in at the site, day cost to the project), factory (shifts, hours per work order) and subcontracted labour (headcount by trade, site access lists). Build order: **H1** make it work ✔ → **H2** crews and workers without logins, crew attendance charged to the project → **H3** documents with expiry and site access lists → **H4** studio timesheets, capacity and leave in planning → **H5** payroll export from the region pack.

**Built (H1) — People: Attendance · Leave · Team · People; Settings → Attendance & leave:**
- **Works on day one:** the first use makes the workspace's calendar (its time zone and its country's working week, 09:00–18:00), the attendance rules and three leave types (Annual — limited, Sick — unlimited, Unpaid — unlimited and unpaid), and enrols every active member from the day they joined. Nothing is overwritten later.
- **Access:** every member uses their own attendance and leave whatever their role; being someone's manager (or the fallback approver) is the right to decide for them; `hrms.manage` runs HR. HR can switch a person off (not tracked).
- **Calendars** are edited with their version: name, time zone, working week and hours change from now on; sessions and leave keep the calendar they were made with, and plans read the default calendar. Calendars are never deleted.
- **Holidays** are named ranges (up to 31 days, never overlapping on a calendar). The database keeps the calendar's list of days off from them. A holiday announced after leave was booked gives those days back; leave left with no days is withdrawn or cancelled, and the person is told.
- **Leave types** are limited (a yearly allowance, per-person overrides) or unlimited, paid or unpaid.
- **Approvals:** a person's manager while active, else the fallback approver, else everyone who manages HR — never the person themself.
- **Notices:** leave to approve (approver, in-app and email), approved or not approved (the person, in-app and email), cancellation to approve and its outcome, a holiday changing booked leave, attendance to review (an exception at check-in, a correction, a missing check-out) and its outcome, and "You're still checked in" an hour after the working day should have ended (once per session, in-app and email; nothing is closed automatically).
- **Team day:** each person's day says whether it's a working day, where they are while checked in, and the leave type when on leave.

**Built (H2) — crews and workers without logins (backend; screens follow):**
- HR keeps **crews** (a trade, optionally the subcontractor who provides them and a lead) and **workers** (a trade, a code, a phone, and optionally their own day rate). Day rates are pay: only people who run HR or see project costs see them.
- A **crew day** is marked by the crew's lead or the project's managers and site supervisors: who was there (a whole day, half a day, absent), overtime hours, a note. It's a draft until submitted with one group photo and the phone's position against the project's site boundary; a missing photo, a position away from the site, a site without a boundary or a day marked afterwards needs a reason. Nobody can be marked for more than a day in total across crews and places.
- Someone other than the person who marked it (the project's managers, or HR for the workshop) approves it or sends it back with what to change — enforced in the database. Approving fixes each worker's day rate (their own, else their trade's on that day) and the day can no longer change.
- **Cost:** each approved crew day is a labour cost of its project at those rates; the named people replace the site report's headcount for their trades that day, so nothing is counted twice. Overtime hours are kept for payroll.
- Notices: a crew day to approve (the project's managers), approved or sent back (who marked it).

**Built (H3) — documents and site access (backend; screens follow):**
- **Documents** per employee or worker: identity, work permit, residence, licence, insurance, safety induction, medical or other; a number, issue and expiry dates, a scan (PDF or image up to 10 MB) and a note. HR keeps them; a person sees their own; the audit notes a number changed without keeping it. Status on the workspace's today: valid, expiring (within 30 days) or expired.
- The workspace chooses which kinds a person needs **on site** (Settings → Attendance & leave → Rules).
- **Site access** per project: crews (all their active workers), workers and staff added by the project's managers (supervisors see it). Each person is cleared when every required kind has a document that hasn't expired; the list shows who is and what's missing or expired, with the numbers security asks for.
- A crew day with someone present who isn't cleared needs a reason.
- **Reminders** once per document and expiry: 30 days before to HR (in-app and email) and the employee; on expiry to HR and, for a worker, their crew's lead.

**Built (H4) — studio timesheets, utilisation and leave in planning (backend; screens follow):**
- People log hours per day against a project they're on and its stage, or internal work, a week at a time (the workspace's first day of the week); days that haven't happened and days before joining are refused, at most 24 hours a day. The week is submitted and approved or sent back by their manager — never by themself (database-enforced) — and an approved week can't change. Notices: to approve (manager), approved or sent back (the person).
- A project's approved hours by person and stage (its managers, and people who run projects or see costs); utilisation per person over a period: approved project hours over the hours their calendar expects less leave, internal hours apart.
- **Planning:** open work shows when its assignee is away on approved leave within its dates — the dates only, never the kind of leave.

**Built (H5) — payroll inputs (backend; screens follow):** for a month, per employee: scheduled days, days and hours worked, hours beyond the day, paid and unpaid leave, days away without leave and items still to review; per crew worker: days on approved crew days, overtime hours and the amount at their fixed rates (per currency). As CSV (UTF-8, ISO dates, decimal points) for the payroll provider. HR only; nothing here pays anyone.

### 6.29 Staff mobile (Expo)
- **Tabs:** Today · Tasks · Capture (+) · Inbox · Me.
- **Actions:** respond to enquiries (call/WhatsApp/note), site visit (measurements, photos, markup), task progress (qty + photo), daily report, receive delivery (PO or site), raise/close snag, handover walk-through, approvals (approve or return with reason), attendance.
- **Offline:** an encrypted local outbox with a stable operation ID per command. On reconnect: apply, or show a per-field conflict. Approvals, payments and gate decisions are never queued offline; they need to be online.
- **Parity:** tokens generated from web tokens, checked in CI; same terminology and permissions from the server.

### 6.30 Logistics: shipments, itinerary and site deliveries
- **Purpose:** know where every physical thing is, and who must act when it moves: globally for operations and per project for the PM and client. This replaces the inline `Order.shipments` JSON, and factory dispatches (§6.16) become shipments of kind `factory_dispatch`. There is one tracking model for everything that moves.
- **Records:**

  | Table | Key columns |
  | --- | --- |
  | `shipments` | `reference (SHP-…), kind (supplier_inbound / factory_dispatch / transfer / site_delivery / return / client_supplied), status, carrier_id, tracking_ref, tracking_url, planned_ship, planned_arrival, actual_arrival, project_ids (derived from lines), owner_member_id` |
  | `shipment_stops` (itinerary) | `sequence, location (supplier / warehouse / factory / site / client address), planned_arrive, planned_depart, actual_arrive, actual_depart, contact, access_notes, status` |
  | `shipment_lines` | `po_line_id / production_lot_id / stock_movement_id, variant, qty, unit, drop_stop_id` (which stop it is unloaded at) |
  | `shipment_events` | status timeline: `booked, picked_up, in_transit, at_customs, arrived, delivered, partially_delivered, delayed (new ETA + reason), exception, cancelled` with source (staff/vendor portal/driver mobile/carrier API) |
  | `proof_of_delivery` | per stop: receiver name, signature, photos, accepted/rejected qty per line → creates the goods receipt / site delivery records |
  | `site_delivery_windows` | per site: allowed days/hours, lift booking, parking/permit needs, client presence required |
  | `carriers` | own fleet or 3PL; vehicle and driver contacts |
- **States:** `planned → booked → picked_up → in_transit → (at_customs) → arrived → delivered | partially_delivered`, plus `delayed`, `exception` and `cancelled`.
- **Auto-assigned tasks** (to the responsible project role; falls back to the ops queue):

  | Trigger | Task | Owner |
  | --- | --- | --- |
  | Shipment planned to site | "Confirm site access for <date>" + client decision request (portal: confirm presence/lift/parking) | Account manager |
  | Arrival at warehouse | "Receive SHP-…" (with QC if required) | Storekeeper |
  | Stop at site | "Receive at site" (POD on mobile) | Site supervisor |
  | Delivered + accepted | Existing install task becomes startable (readiness updates) | Installer / site lead |
  | ETA moves later | "Expedite / replan" + planning impact shown | Buyer / PM |
  | Exception (damaged, wrong, lost) | "Resolve exception": claim, return, or snag | Buyer / QC |
- **Views:**
  - **Global:** the Logistics page (under Operations) with grid, board by status and **day timeline** ("arriving today / this week / late"), filtered by project, vendor, destination or carrier.
  - **Project level:** a *Deliveries* section in the project (itinerary timeline per shipment, what arrives where and when, what is blocked by it).
  - **Client portal:** a client-safe delivery schedule (date window, what arrives, what we need from you: access, presence, lift). No supplier names or costs.
  - **Mobile:** scan the shipment or lot **QR** to mark picked up, delivered or POD.
- **Tracking sources:** staff update, vendor portal (ASN, dispatch), driver on mobile, carrier tracking URL; carrier API adapters later (Aramex/DHL/local 3PL) through §6.25.
- **Edge cases:**
  - One PO split into several shipments; one truck carrying many POs and projects (multi-stop route: warehouse → site A → site B).
  - Partial delivery at a stop.
  - Damaged in transit: carrier claim + return/rework + snag.
  - Wrong address: re-route with a new stop.
  - Client not available: reschedule, redelivery cost as a cost entry and optionally chargeable.
  - Customs hold on imports: documents checklist; duties and clearing become cost entries on the landed cost.
  - Lost shipment: exception, then replacement PO line.
  - Returns to supplier or factory.
  - A delay ripples as a **risk** on dependent tasks (the PM applies date changes; nothing moves silently).
  - A delivery outside the site window: warning before booking.
- **Landed cost:** freight, customs and handling on a shipment are allocated to its lines (by value, weight or qty; tenant setting). This updates moving-average cost and project cost.
- **Tests:** POD creates receipts exactly once; multi-stop line conservation (Σ dropped = Σ loaded); delay creates exactly one expediting task; the client projection hides supplier and cost.

### 6.30a Company gallery (brochure)
A branded, shareable catalog of the firm's work, edited by the owner and opened by one link (`/gallery/{link}`); also linked from the client portal while published.
- **Content:** services and products (from the catalog with pictures and prices, or typed), recent projects (a picture wall each), client feedback with ratings, about and contact; the section order and visibility are the owner's.
- **Browsing:** Pinterest-like: search first, filter chips (types and the firm's labels), a masonry wall of pictures, a detail view with previous/next and "More like this"; projects open as their own picture wall with no prices.
- **My list → enquiry:** visitors add items to a list kept on their device and send it through the firm's own published enquiry form; the picked items are added to the enquiry's summary and it arrives in Sales like any enquiry (assignment notifications, duplicates, returning customers). Source and channel can be set for gallery enquiries.
- **Branding and style:** the tenant logo and brand colour (accent), one of the 12 styles for fonts and paper; "Powered by Wodana" only in the footer.
- **What visitors see:** starting prices, descriptions, My list and enquiries, search, chips and contact buttons each switch on or off.
- **Rules:** only a published gallery is readable, by its link (security-definer lookup); links are unique across tenants; publishing needs a published enquiry form; public pictures only for visible items; a gallery with My list off takes no enquiries.
- **Notifications:** gallery published (in-app to managers); gallery enquiries follow the enquiry intake's notifications.

### 6.31 Document builder (PDF and other formats) — built last, used everywhere
- **Purpose:** one engine for every document, with brand- and entity-aware templates that a tenant admin can adjust without code. Until it ships, R1 uses the existing quotation print.
- **Document types:**
  - **Sales:** quote (design/main/variation), BOQ, agreement.
  - **Finance:** proforma, tax invoice, receipt, credit note, statement of account, payment request.
  - **Purchasing and logistics:** RFQ, PO, goods receipt note, delivery note / packing list, shipment label (QR).
  - **Factory and quality:** work-order traveller / job card, QC checklist.
  - **Site and client:** material sign-off sheet, daily report, client progress report, snag report, handover pack, warranty certificate.
- **Template model:** a versioned layout of **blocks** (header/letterhead, party blocks, meta grid, line table with column picker and grouping, subtotal/tax/total, payment schedule, terms with variables `{{client.name}}`, images grid, drawings, signature/stamp, QR, notes, page break), bound to a **typed data contract** per document type. Contracts have separate *internal* and *client* field sets, so a client document can't include cost or margin.
- **Formats:**
  - PDF at A4, Letter or A3, portrait or landscape;
  - thermal labels (100×150 mm, 4×6");
  - HTML preview;
  - XLSX/CSV for tabular documents (BOQ, PO lines, statements).

  Bilingual English/Arabic with RTL, embedded fonts, running header/footer, page numbers, repeated table headers, rows kept together, "Draft" / "Superseded" watermarks.
- **Rendering:** HTML/CSS → PDF via headless Chromium in a worker (queued, cached by template version + data hash). Large packs (handover) are merged from parts.
- **Rules:**
  - An issued document stores the rendered file + template version + data hash, so a re-download is byte-identical and history never re-renders.
  - A tax invoice follows the region pack (UAE FTA: "Tax Invoice", TRN, per-line VAT; validated before any compliance claim).
- **Builder UI:** document type → template gallery → toggle/reorder blocks, pick columns, edit terms → **live preview with a real record** → publish as a new version (old documents keep theirs).
- **Edge cases:** very long tables; missing logo or image (placeholder, never a failed render); Arabic shaping; 200+ page handover packs; e-sign placeholders.
- **Tests:** golden-file PDFs per template; the client contract field whitelist; identical output on re-download.

### 6.32 Small features that make the product feel solid (added to modules as they ship)
Each is small, reusable and built once in the platform or design system.

| Feature | Where | Why it matters |
| --- | --- | --- |
| **Record chips with hover preview** (PRJ-42, Q-118 rev 3, PO-77) | everywhere | connected navigation without opening pages |
| **@mentions in comments** → notification + optional task | all comments | replaces WhatsApp "please check" |
| **Watch / follow a record** | all records | get updates without being the owner |
| **Quick create from `⌘K`** ("task for PRJ-42 to Ali due Fri") | global | 2-second capture |
| **Snooze a next action** (with reason and date) | Home | a clean Home without losing items |
| **Pinned projects and recently viewed** | sidebar / `⌘K` | fast return |
| **Badge counts** on Approvals, Tasks due and Inbox | sidebar | know what's waiting |
| **Server-side draft autosave** + "Saved" indicator + unsaved-changes guard | all forms | no lost work, no localStorage drafts |
| **Double-submit protection** (buttons disable until the server answers; idempotency key) | all actions | no duplicate records |
| **Undo for reversible actions** (reassign, move on board, archive) for 10 s, done as a compensating command | lists and boards | fearless editing |
| **Field-level history** ("changed by Sara · 2 h ago") | inspectors | trust and audit |
| **Relative dates with exact time on hover; working-day due dates** | everywhere | clarity |
| **Paste or drag screenshots and files; photo markup** | comments, snags, site | fast evidence |
| **QR on lots, shipments and stock locations; scan on mobile** | factory, logistics, inventory | fast, error-free moves |
| **CSV export on every grid; import on key grids** (with review) | grids | no lock-in; bulk work |
| **Saved views with shareable links** | grids | a team works the same queue |
| **Calendar subscription (ICS)** for my tasks and site visits | Calendar | shows in Google/Outlook |
| **Daily digest** (email/WhatsApp) of my due items and approvals | notifications | no missed work |
| **Error ID shown to the user** + "copy for support" | error states | fast support |
| **Session-expiry warning** before logout | global | no lost input |
| **Nightly invariant check** (quantities, money, orphan links) → admin report | platform | problems found before customers notice |
| **Per-tenant feature flags and a UAT clone** | control plane | safe rollout |
| **Status/maintenance banner** from the control plane | global | honest communication |

---

## 7. Cross-cutting edge cases (apply to every module)

| Case | Rule |
| --- | --- |
| Double click / retry / network replay | `Idempotency-Key` per command; same key returns the same result; a different payload with the same key returns 409 |
| Two users edit the same record | `expectedVersion`; 409 with the latest version and a field-level diff in the UI |
| Concurrent quantity/money writes | row locks in a fixed order (project → package → task → allocation); tested with parallel requests |
| Permission changes while a screen is open | the server rechecks on every command; the UI shows 403 with the reason and refreshes |
| Record deleted | nothing with history is deleted: `archived_at` + reason; drafts with no history can be deleted |
| User deactivated | offboarding reassignment is mandatory; their past actions keep their name |
| Tenant suspended | writes blocked with a banner; exports allowed; portals show a maintenance notice |
| Time zones | business dates in the workspace timezone through one helper; timestamps in UTC; the portal shows the client's local time |
| Currency | document currency + base currency + rate snapshot; no silent conversion |
| Rounding | decimal only; per-line rounding to 2 dp (tenant setting); totals from rounded lines |
| Files | max size per plan; resumable upload; malware scan before availability; images get thumbnails; checksums prevent duplicates |
| Long text / names | wrap in grids with a tooltip and expand; never truncate business terms silently |
| Empty / loading / error / denied | a shared component for each state, required on every page (lint check on route files) |
| Language | English first; strings externalized; RTL-safe layout; Arabic later without refactors |
| Audit | every command writes activity (human readable) + security audit (who, what, from where) |
| Data export | a tenant can export everything (CSV + files) at any time; erasure is a separate privacy action |
| Backups | nightly full + WAL; restore tested before go-live and monthly |
| Observability | structured logs with correlation ID; error tracking; slow-query log; alerts on outbox lag and failed deliveries |

### 7a. Edge-case catalogue per engine and module (6 Oct)
Each row becomes an automated test in its phase: a domain unit test, a real-Postgres integration test, or an e2e smoke step. The ID goes in the test name. A phase is not done until its rows pass. International by default: every date rule uses the workspace time zone and working week, and every amount uses the document currency with the region pack's tax and rounding.

**E1 Job record**

| ID | Case | Expected | Phase |
| --- | --- | --- | --- |
| E1-1 | The same person enquires twice through different channels (form + WhatsApp + phone) | Matched by normalised phone or email (region phone format); one job, both touchpoints linked; a possible match shown for confirmation, never merged silently | P2 |
| E1-2 | A returning client starts a new job after handover | New job under the same client; history visible; warranty items of the old job untouched | P2 |
| E1-3 | Lead lost, then the client comes back | Reopen with a reason; the old loss stays in the history and reports | P2 |
| E1-4 | Job owner deactivated mid-job | Reassignment is required before deactivation; their past actions keep their name | P2 |
| E1-5 | Two people edit the same job | Version check; the second save gets 409 with the field diff | P1 |
| E1-6 | Client name or phone edited by sales after Qualified | Blocked (locked fields); edit request goes to an admin | P2 |

**E2 Steps**

| ID | Case | Expected | Phase |
| --- | --- | --- | --- |
| E2-1 | Enquiry type changed after steps started | Steps recomputed from facts; completed facts carry over; dropped steps archived with a reason | P3 |
| E2-2 | A gate's evidence is removed (payment proof deleted) | The step reopens; later steps that depended on it are flagged, not silently undone | P3 |
| E2-3 | Firm edits a type's steps while jobs are running | Running jobs keep their version; new jobs use the new version; an explicit "move to new version" exists | P3 |
| E2-4 | Deadline falls on a weekend or holiday | Moved to the next working day of the workspace calendar | P3 |
| E2-5 | Step skipped by a manager | Allowed only where the type marks it optional; reason recorded | P3 |

**E3 Approvals**

| ID | Case | Expected | Phase |
| --- | --- | --- | --- |
| E3-1 | Approver on leave | Delegate or the next approver after the escalation time; recorded who approved for whom | P3 |
| E3-2 | Requester is also the approver | Separation of duties: skipped to the next approver; waiver only if the firm allows and recorded | P3 |
| E3-3 | Amount changes after the first approval | Approvals reset when the change crosses a threshold or exceeds the tolerance | P3 |
| E3-4 | Policy edited while requests are pending | Pending requests keep their policy version | P3 |
| E3-5 | Quote expires during approval | Approval blocked; extend validity (approved) or re-issue | P3 |
| E3-6 | Two approvers act at the same moment | One decision wins (row lock); the other sees the final state | P3 |

**E4 Reminders and notifications**

| ID | Case | Expected | Phase |
| --- | --- | --- | --- |
| E4-1 | Consent withdrawn mid-reminder sequence | Next send on that channel stops; fallback channel only if consented | P5 |
| E4-2 | Action done between schedule and send | The send is cancelled (re-check before send) | P5 |
| E4-3 | Quiet hours in the recipient's time zone | Held until the window opens; critical items follow the firm's rule | P5 |
| E4-4 | WhatsApp template rejected or outside the 24-hour window | Fallback to email, then push; failure visible on the health page | P5 |
| E4-5 | Duplicate events (retry/replay) | One notification (idempotency key per event and recipient) | P5 |
| E4-6 | Third reminder unanswered | Escalation to the owner's manager or the firm owner, once | P5 |
| E4-7 | Recipient has no email or phone | In-app only; the owner is told the contact is unreachable | P5 |

**E5 Documents and decisions**

| ID | Case | Expected | Phase |
| --- | --- | --- | --- |
| E5-1 | Client changes a material after the list is locked | New ledger version with price and time impact → change request; procurement uses the locked version until approved | P4 |
| E5-2 | "I never said that" | Ledger shows who, when, source (portal, meeting, WhatsApp), evidence and the client's confirmation | P4 |
| E5-3 | Same file uploaded twice | Checksum match → link to the existing version | P1 |
| E5-4 | A document shared with the client is replaced | The client sees the new version with a "changed" marker; the old one stays in history | P4 |
| E5-5 | Huge or unsupported file; image without preview | Size limit per plan; placeholder card, never a broken render | P1 |
| E5-6 | Fit check fails (item larger than the measured access) | Warning on approval and a block on ordering until overridden with a reason | P4 |

**E6 Conversations**

| ID | Case | Expected | Phase |
| --- | --- | --- | --- |
| E6-1 | Internal note posted in a client-visible thread | Notes never reach the portal; the composer shows which audience it posts to | P2 |
| E6-2 | Message from an unknown number | Inbox intake (sales admin), File into job or New enquiry | P2 |
| E6-3 | Client replies to an old template after the job moved on | Lands in the job's conversation, routed to the current stage owner | P5 |
| E6-4 | A staff member loses access to a job | Their inbox no longer shows its threads; history keeps their messages | P2 |

**E7 Wodana Books**

| ID | Case | Expected | Phase |
| --- | --- | --- | --- |
| E7-1 | Partial payments against one milestone | Milestone shows paid/left; receipts post separately; AR ageing per remaining amount | P6 |
| E7-2 | Overpayment | Credit on the client account; applied to the next milestone or refunded with approval | P6 |
| E7-3 | Refund after project closed | Reopens the period only if it is open; otherwise posted in the current period with a reference | P6 |
| E7-4 | VAT/GST rate changes mid-project | Each invoice uses the rate in force on its tax point; quotes show the change | P6 |
| E7-5 | Invoice in a foreign currency | Rate snapshot at posting; realised FX difference at receipt | P6 |
| E7-6 | Posting into a closed period | Blocked; correction goes to the open period | P6 |
| E7-7 | Issued e-invoice needs correction | Credit note, never an edit; numbering gap-free | P6 |
| E7-8 | Card statement line matches two expenses | Suggested match only; a person confirms; no double posting | P6 |
| E7-9 | Rounding across 200 lines | Line rounding per region pack; totals from rounded lines; trial balance balances to the cent | P6 |

**E8 Woddy**

| ID | Case | Expected | Phase |
| --- | --- | --- | --- |
| E8-1 | AI reads a payment proof with a different amount than the milestone | Proposes the read amount with confidence and the source; Finance confirms | P3 |
| E8-2 | Model unavailable or over the firm's budget | Feature degrades to manual; no blocked work | P5 |
| E8-3 | User without permission asks Woddy to act | Woddy uses the user's permissions only | P5 |
| E8-4 | Answer without a citation | Not shown; "I couldn't find this in the job" | P5 |

**Modules**

| ID | Case | Expected | Phase |
| --- | --- | --- | --- |
| M-1 | Supplier delivers short or damaged | Partial receipt; reject with photo; PO stays open for the rest; client ETA updates | P7 |
| M-2 | Supplier changes the price on the bill | Variance check against the PO; over tolerance → approval; item cost updated | P7 |
| M-3 | Stock reserved for a job is used for another | Blocked unless the reservation is released with a reason | P7 |
| M-4 | Offline daily report syncs a day later | Keeps its own date; photos first; conflicts per field | P5 |
| M-5 | Change request approved after procurement started | Impact on open POs listed; handover date recalculated | P4 |
| M-6 | Warranty claim after the warranty end | Shown as chargeable; manager decides | P8 |
| M-7 | Client portal opened by a second contact of the same client | Sees only what that contact's role allows | P4 |
| M-8 | Vendor bank details changed | Payments blocked until a second person approves the change | P7 |
| M-9 | Quote number collision across entities | Sequence per entity and type; prefix/suffix from settings | P3 |
| M-10 | Workspace changes its time zone | Business dates keep their calendar day; timestamps re-render | P1 |

**International clean-up (found in the P0 scan):** the legacy project-execution document still falls back to AED for order currency (`execution.domain.ts`). It is removed when procurement moves to tables in P7.

---

## 8. Engineering rules and schema conventions

1. **Tables hold business truth.** JSON only for immutable snapshots, provider payloads and configuration definitions. ADR-0001 in M0; lint flags new JSON array columns.
2. Money `numeric(20,4)` + decimal.js; quantities `numeric(18,4)`; never `number` for money, never `::float`.
3. Every tenant table: `workspace_id NOT NULL`, **forced RLS**, composite FKs including `workspace_id`, `created_at`, `updated_at`, `created_by`, `version`. A CI test fails if any table with `workspace_id` lacks forced RLS. No migration disables RLS.
4. Every command: typed DTO, idempotency key, expected version, one transaction, one outbox event, one activity row. No `command(action)` switchboards and no `@Body() unknown`.
5. A module writes only its own tables; cross-module effects use events or a published interface. Import cycles fail lint.
6. References come from `document_sequences` (per workspace, per type). No `max()+1`.
7. One `today(workspace)` helper for business dates.
8. Tenant differences live in templates and configuration; `grep -ri palm src/` returns only fixtures.
9. Tests per module: domain unit tests + real-Postgres integration (allow, deny, cross-tenant, replay, stale version, concurrency) + a contract test for each client projection.
10. Contracts live in `packages/contracts` and are imported by package name in web and mobile.
11. Files under 600 lines; services under 800; one module in flight; PRs reviewable in one sitting.
12. Docs: this file + ADRs. No new dated notes.

**Table disposition summary:**
- **Keep/harden:** identity, workspace, control plane, CRM, HRMS, discovery, catalog records, notifications, integrations, `ai_suggestions`.
- **Replace JSON:** `commercial_cases.content` → deals/quotes/rounds/receipts/approvals; `project_execution.content` → projects/stages/packages/tasks/materials/POs/receipts/stock/WOs/reports/snags/handover.
- **Drop after cutover:** `job_identities*`, `job_manual_stage*`, `one_tree_*`, `crm_project_links`, `project_warehouse_stock`, `project_stock_transfers`, `project_stock_commands`, `project_factory_*`, `project_approval_queue` logic, Palm route code.

---

## 9. Build order, migration and cutover

**Module definition of done** (every module includes its notifications: events, recipients and channels, with tenant-branded email through the shared layout and the tenant logo as the only brand source; all labels go in `en.json`; every screen is checked left-to-right and right-to-left): migration with forced RLS · typed API + OpenAPI · idempotent versioned commands · outbox events · projections · contracts · seed fixture · tests per §8.9 · backfill + reconciliation report (or approved reset) · feature flag · UI (after the backend is done) · Palm check · old path removed.

| # | Module | Depends on | Size |
| --- | --- | --- | --- |
| M0 | Foundation: cleanup, rewrite `CLAUDE.md`, ADR-0001, decimal, `today()`, module template, RLS CI test, outbox consumer groups + DLQ, sequences service, lint rules | — | M |
| M1 | Platform: approvals engine + policies, comments, attachments, activity, workflow templates (routes as data), permission seed, security fixes | M0 | M |
| M1b | Sign-in & onboarding: identifier-first entry, staff email+password+MFA, workspace picker, client/vendor mobile + WhatsApp OTP, typed onboarding flows (§6.2) | M1 | M |
| M2 | Control plane completion (domains, lifecycle, support sessions) | M1 | M |
| M3 | Catalog, measurements & pricing: typed attributes, item types, variants, BoM with formulas, units/conversions, waste rules, price methods with breakdown, import review (§6.4) | M1 | L |
| M4 | CRM hardening (PLM items, Won event, takeover/SLA verified) | M1 | S |
| M5 | Discovery + Design (spaces tree, requirements, site visit, deliverables, publications) | M1, M3 | M |
| M6 | Quotation + Agreements/Receivables + Deal approval + `OpenProjectFromDeal` | M3–M5 | L |
| M7 | Projects + Planning + Tasks (one task system, templates, readiness, CPM, board) | M6 | L |
| M8 | Materials & sign-off, Suppliers, Purchasing | M7 | L |
| M9 | Receiving, Inventory, Payables | M8 | L |
| M9b | Logistics: shipments, itinerary, POD, site delivery windows, landed cost, auto-assigned tasks (§6.30) | M9 | M |
| M10 | Factory (dispatch uses M9b shipments) | M8, M9b | L |
| M11 | Site, Quality, Handover, Aftercare, Change orders | M7–M10 | L |
| M12 | Finance (invoices, cost ledger, wallet, postings) | M6, M9 | M |
| M13 | Notifications service (+ reminders fix migrated) | M1 (starts early; each module registers its events) | M |
| M14 | Integrations (WhatsApp in/out, email, push, payments, lead ads, accounting, calendar) | M13 | M |
| M15 | AI gateway + features | M3, M6, M7 | M |
| M16 | Portals: client and vendor (on projections) | M6–M11 | M |
| M17 | End-to-end acceptance per route + security/recovery tests | all | M |
| M18 | Document builder: templates, blocks, formats, renderer, builder UI (§6.31) | M6–M12 contracts | M |

**Progress (kept current):**
- **Settings: done.**
  - One brand source, and the brand colour drives actions.
  - Currency and country fixed once money exists.
  - Tax rates and document numbering per legal entity.
  - Country-aware phone field; one dropdown rule; blocked saves always explained.
  - Settings labels in `en.json`.
  - Notification settings move to the notification-engine module.
- **Design system: done.**
  - Tokens (4px grid, φ rhythm, type and radius scales).
  - One palette for light and dark.
  - State illustrations.
  - Page-anatomy rule in `CLAUDE.md`.
- **AI gateway: done.** Gemini behind a per-workspace switch, usage log and validated JSON; AI always sits next to a manual path.
- **M3 Catalog: core done.** Old catalog removal is still open.
  - Typed schema (0009) and an exact core (decimal, units, formulas, waste, explainable pricing).
  - API and screen: item edit, components, price lists with QS review.
  - Import review, with AI clean-up and AI component suggestions.
  - The v1 generic catalog stays until the quotation (M6) and planning (M5/M7) rebuilds read v2; then it is deleted.
- **Open inputs:**
  - The Core Supplier List file, for supplier links.
  - Two code clashes in Palm's material list: CP 003 and PT2210.


Small features (§6.32) are built into the platform and design system in M1/U0, then used by each module as it ships.

UI integration follows each backend module in the same order (web first, then mobile), on the design-system foundation (**U0**, done once before M5's UI):
- one component library;
- lint ban on raw controls;
- token scales;
- typed API client + TanStack Query;
- shared state components;
- explicit route files instead of the catch-all;
- the sidebar: *Daily work* (Home, Inbox, Tasks, Calendar, Approvals) · *Business* (Sales, Clients, Projects) · *Operations* (Purchasing, Inventory, Factory, Logistics) · *Company* (People, Catalog, Connections, Settings).

**Rebuilt surfaces (not patched).** The owner asked for these to be redesigned from their source, because the current ones are unproductive and buggy. **Order:** quotation builder and planning with their modules; Home and Inbox **last**, after all modules exist, so they aggregate real sources:

| Surface | Rebuild |
| --- | --- |
| **Home** | One ranked **Next actions** list across modules: approvals waiting for me, overdue, due-today and blocked tasks, follow-ups, unanswered enquiries and client decisions. Each item has a reason, a date and a do-it button. No KPI tiles. |
| **Inbox** | One place for in-app notifications, @mentions and client/vendor messages, each linked to its record. It is available to every staff member, not only CRM users. |
| **Sidebar** | Follows §2: at most two levels, no duplicate destinations (one Clients, one Calendar, one Tasks), Settings as a hub, Logistics under Operations. Entries are hidden by permission and never lead to a blank page. |
| **Quotation builder** | One page:<br>• space tree on the left, line grid in the centre, summary and issues on the right;<br>• catalog picker with search;<br>• quantity from measurement formulas (§6.4), with explained price breakdowns;<br>• option groups, revision diff;<br>• one primary action per state (Submit to QS → Issue → Record acceptance);<br>• AI draft and "check my quote".<br>It replaces the ~40 `quotation-*` components. |
| **Planning (project)** | Packages linked to released scope → standard plan per package (done) → one Gantt, board and list over the same tasks, with dependencies, critical path, ripple preview and baselines. Readiness says what each task is waiting for. It replaces the 2.1k-line project workspace tab set. |

**Known tenant content in code, to move into tenant templates:** Palm's proposal artwork and terms (`apps/web/lib/commercial/proposal-reference.json`, used by `quotation-reference-template.ts` and the item letterhead) move into Palm's own document template in M18. No other tenant-identity branching remains in core logic.

**Migration per module:**
1. Add the new tables next to the old data.
2. Run an idempotent backfill from JSON with a reconciliation report (counts, money and quantity sums, orphans) on a production clone.
3. Switch writes behind a flag.
4. Keep the JSON as a read-only view until the UI moves.
5. Drop the old data.

Where the data is synthetic (D2), reset instead. Every production migration has a tested rollback (restore point + down path) and runs on the **same image** that was tested.

---

## 10. Monday release (R1)

**Principle:** ship only what is verified. Hide the rest behind capability flags. No fake data, no half-working screens.

**R1 scope (Palm):**
1. Sign-in, MFA, workspace, members/roles (Sales, Sales Admin, QS, Finance, Owner/Ops, PM), Settings basics.
2. CRM: public form/QR intake, enquiries, assignment/queue, takeover, contact actions, conversion, Pipeline, Won/Lost.
3. Quotation: design and main rounds, QS review, issue, portal acceptance, agreement + receipt, Finance verify, Owner approve → one Deal File + Project.
4. Project: overview, route stages with gates, On Hold, material-list sign-off, files, timeline.
5. Catalog (read and pick in quotes).

**Hidden in R1 (flags off):** global Purchasing/Inventory/Factory write screens, partial factory allocation, AI assistants beyond the lead summary, unconnected integrations (shown "Not configured"), HRMS if Palm isn't using it Monday.

**Weekend work (Fri–Sun), in order; stop and report if any step fails:**
1. **Freeze** `main`; create a `release/r1` branch; no new features.
2. **Security fixes (small, tested):** forced RLS on the four missing tables; remove `DISABLE ROW LEVEL SECURITY` from any migration still to run; reminder job runs per tenant context; DTO validation on the R1 commercial/project endpoints exposed to clients; timezone helper on quote validity and portal due dates.
3. **Flags:** turn off everything outside R1; the direct URL shows "not available on your plan yet", not a blank page.
4. **Run the Palm path in the browser** on a production clone, two and three people: each of the three routes; QS return; client reject; Finance return; below-floor receipt; duplicate submit; On Hold; permission denials. Record screenshots and the results.
5. **Infrastructure:**
   - production environment validated (`infra/hostinger/validate.sh`);
   - auth mode confirmed for production;
   - Mailgun sender verified with a real test email received;
   - backups on, **a restore performed and timed**;
   - error tracking and uptime alerts on.
6. **Data:** a clean Palm tenant provisioned through the control plane; Palm catalog imported (reviewed); users invited only for the named testers (operations@, cece@) unless Palm approves more.

**Go / no-go (Sunday evening; all must be yes):**
- [ ] All R1 browser scenarios pass on the release image and migrations.
- [ ] Restore from backup tested within the last 24 hours.
- [ ] No open Critical finding from §1 inside R1 scope.
- [ ] Rollback plan tested (previous image + DB restore point).
- [ ] Palm contact knows what is in R1 and what follows weekly.

**If no-go:** release R1 to Palm as **UAT on production infrastructure** (same URL, "pilot" banner, real data allowed only with Palm's consent), and fix before calling it production. This is better than a failed launch.

**After Monday:** weekly releases following §9 (M0 → M17). Each release note is one line per module row in this file.

---

## 11. Competitive position vs Dzylo

**Dzylo** ([site](https://dzylo.ai/), [procurement](https://dzylo.ai/interior/procurement-management/)) is strong on AI room-wise BOQ/quotation from prompts, RFQ to multiple suppliers over WhatsApp with item-wise comparison, POs with approvals, partial delivery tracking, inventory across sites, payables and receivables, and a client app. Its public material does not show factory/production management, BoM, 3-way invoice matching, inventory valuation or barcode movements.

**Wodana matches** on quote AI, WhatsApp RFQ, the vendor portal, POs and inventory. **Wodana wins on:**
1. **Factory to site in one system:** work orders, partial batches, QC lots, dispatch, installed ≤ delivered. Dzylo doesn't show this, and it's Palm's core.
2. **Money truth:** QS/Finance/Owner separation, verified receipts, 3-way match, and a per-project wallet with a spending guard.
3. **One task system with gates that can't be faked**, and readiness that explains "can't start because…".
4. **Next-action Home:** nobody hunts for work.
5. **Route templates (kits):** design-only, design+build, furniture, ready-made, fit-out, blank. A new firm is configuration, not code.
6. **Minimal UI:** one primary action per screen, inspector drawers, `⌘K`, inline edit; fewer screens than competitors for the same job.
7. **AI that proposes; people decide:** evidence, diff, confidence and audit on every suggestion.

---

## 12. Decisions required

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Approve this plan, R1 scope and module order | Approve |
| D2 | Is any real Palm data in production now? | If no: reset per module instead of backfill |
| D3 | R1 fallback if the go/no-go fails: pilot/UAT on production infrastructure | Yes |
| D4 | Tasks include CRM follow-ups and personal to-dos (one system) | Yes |
| D5 | Spending guard mode for Palm | Warning + Owner override first month, then strict |
| D6 | Small-team separation waivers allowed? | Yes, recorded and reported |
| D7 | UAE payment provider | Network International or Telr (confirm with Palm) |
| D8 | AI provider | Gemini behind the gateway now; switchable |
| D9 | Open Palm questions: PLM-009 (completion KPI), PLM-024 (note privacy), budget/description required, weekend roster, SLA target | Palm to answer; defaults in this plan until then |

**Maintenance rule:** when a module ships, update its row in §9 with the date, test command and result. When Palm confirms or changes something, edit this file and add an ADR. Nothing else.
