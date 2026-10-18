# What's left, end to end

Status as of 18 Oct 2026. Everything is local only (nothing committed, pushed or published).

## 1. Finish this round (the firm's process guide)

### 1.1 UI clean-up sessions (one at a time)

Every screen uses the shared design-system parts. Button and field sizes, padding and the gaps between buttons come from the design system only. No "text dumping": facts, approvals, states, files and actions each use their shared component.

| # | Session | Scope | Status |
|---|---|---|---|
| 1 | Design system | Button/field sizes, padding, action gaps from tokens; one calendar event chip with a straight edge (CRM + logistics calendars); rounded side sheets with a solid tab row; shared one-field reason dialog | Done (not yet checked in the browser) |
| 2 | Quotation and commercial | Quotation builder and commercial screens on shared parts; one payment-milestones editor (with "At handover"); materials shown as chips with their codes (fabric stays a material) | Done (182 of 183 tests pass; the one keyboard test was already failing; not yet checked in the browser) |
| 3 | Projects, design and portal | Planning, design, projects, site, client portal on shared parts; drawing revision screen rebuilt (approval trail instead of loose text); one failing project form test | Stopped on request, mostly done (see 1.1c) |
| 4 | CRM, workspace and pages | CRM, settings and app pages on shared parts; Area / city suggestions on the enquiry form; Proposals card shows the real quotation number; Fulfilment review; two failing CRM/flow tests | Not resumed (stopped part-way earlier) |
| 5 | Operations and finance | Purchasing, inventory, factory, finance, books, HR, logistics on shared parts (money, percent and quantity fields, review dialogs, tables) | Stopped on request: factory and inventory done (63 tests pass); the rest unfinished (see 1.1c) |

The web app compiles cleanly after the stop (0 type errors).

### 1.1c Leftovers from the stopped sessions

**Projects, design and portal** (7 one-off spots left, counted in the code after the stop):

- [ ] Error lines to replace with the shared notice:
  - pre-project/item-specification-editor.tsx:56
  - pre-project/pre-project-case-page.tsx:41
  - client-portal/forms/board-feedback.tsx:33
- [ ] Plain file pickers to replace with the shared uploader:
  - pre-project/design-actions.tsx:105
  - pre-project/site-workspace.tsx:180
- [ ] Local status chips to replace with the shared chip:
  - pre-project/revision-chips.tsx:38
  - site/report-review.tsx:94
- [ ] Check the drawing revision screen (Scope › Drawings) in the browser: approval trail, chip and button instead of loose text.
- [ ] Run the folder tests, including project-core-forms.layout.test.tsx.

**Operations and finance** (done: factory, inventory):

- [ ] Purchasing: money, percent and quantity fields; review dialogs (supplier, order, alternate item); the five shared line tables; delivery photos.
- [ ] Finance, finance requests and petty cash: shared chips (bill, run, request, claim status); review dialogs (bill, run, petty cash); link-style buttons.
- [ ] Books, HR, catalog, logistics and approvals: tax-code percent field, crew money field, file pickers, the documents confirm dialog, approval policy percent, the approvals review dialog.
- [ ] Run the folder tests.

**CRM, workspace and pages** (whole brief still to do): shared parts across CRM, settings and app pages, Area / city suggestions, the real quotation number on the Proposals card, the Fulfilment review, and the two failing CRM/flow tests.

### 1.1a Business logic still open

The guide's rules are built and tested: Lead to Won, design steps 1–11, steps 12–28, proposals linked to their quotations, and every journey step with its link and owner. Still open:

- [ ] **Fulfilment (furniture-only deals):** reported as wrong; cause not found yet. The CRM session reviews it and reports any backend rule problem.
- [ ] **Area / city suggestions:** a small backend lookup of the areas already used in each region (CRM session).
- [ ] **End-to-end proof:** run both smoke tests (palm flow and funnel) on the new rules, and re-run the 3 sandbox setup tests on their own.
- [ ] **Caveats on existing rules:** the QS margin check per item reuses the price-hold rule, and the estimate proposal reuses the existing layout (see 1.4).
- [ ] **Waiting on the firm:** six answers (see section 3), each becoming configuration.

### 1.1b Done this round (not just UI)

- Every job-journey step names its owner from the job's team, and says "No one allocated as …" when nobody holds the role.
- Proposals come from the job's sent quotations wherever the quotes change, and fill in on their own when the card opens.
- Journey steps open their exact page (Scope · Materials / Drawings / Items, Site · Items).

### 1.2 Final checks

- [ ] Look at the screens in the browser: the calendars, side sheets and the new dialogs (item plan, supplies sign-off, design check, site member on a delivery, "At handover" on payment terms, the "supplies signed off" factory setting). Check light and dark, right-to-left, and phone width.
- [ ] Run both end-to-end smoke tests (palm flow and funnel).
- [ ] Full run: backend unit and integration tests, web tests, mobile tests, and both typechecks.
- [ ] Final status.

### 1.3 Test notes to expect

- 6 permission tests fail only because of how this local database grants access, not because of the code.
- 3 sandbox setup tests (ops-sandbox-retire and ops-sandbox-scenarios) have not been re-run on their own yet.
- Some database tests time out or clash only when several sessions run tests at once. Re-run them alone; the ones re-checked so far all passed.
- 2 mobile tests need modules that aren't installed in this folder.

### 1.4 Built, with caveats

- **QS margin check per item** uses the existing price-hold rule (a line is held while its cost runs above its agreed amount). There is no separate per-item margin screen.
- **Estimate proposal** uses the existing proposal layout with the new reference ("…-EST-… rev n"), cover facts (designer, estimator, manager approval) and locked terms (only added clauses, each logged). It is not a new document engine.
- **Fabric** is a material with its code on the quotation line, not a separate column.

### 1.5 Configuration each firm sets (no code)

- Supplies signed off before a work order is released (Factory settings).
- Stage invoice requests on (Finance › Requests), so "On handover" invoices are raised.
- Auto-finish the project at full handover (project settings).
- Lead time line in the proposal letter (proposal kit).
- Discount approver role and the discount threshold (quotation settings).
- Warranty default per item kind.
- Which payment milestone falls due at handover (payment terms / templates).

## 2. Next phases (from the master plan)

| Phase | What it is | Where it stands |
|---|---|---|
| P1 · One journey engine | One flow per job from enquiry to warranty, replacing the separate stage systems; every screen reads the same "where are we / what's next" | Partly: the job journey lists every step with links and owners, but the old stage systems still run beside it |
| P2 · Job page | One page per job: a map of steps by person and chapter, a small "now" box, tabs Map · Chat · Files · Money · History | Not built |
| P3 · Setup module | The firm edits its own questions, steps, packages, forms, templates, seats, limits and numbering, with draft → publish → roll back | Pieces exist in Settings; no single versioned Setup |
| P4 · Document engine and signing | One renderer for portal view = PDF = signed copy; one-time-code signing with a certificate for every document; tracked sending (delivered, opened, signed) | Partly: some signing exists; several document engines remain |
| P5 · Client portal rebuild | A living home (Now, Needed from you, What's next, progress photos, team) with Design, Money, Documents and Chat tabs; the same in the client app | The current portal works but is section-based |
| P10 · Clean-up | Delete the old stage systems and the 7 next-action calculators; keep one source, guarded by a test | Waits for P1 |
| P11 · AI layer | AI inside each step (reads proofs, drafts quotes, voice notes to site answers), always optional, with its source and confidence; remove the assistant panel | Not started |
| P12 · Staff mobile | My day, photo-first capture offline, site measure, delivery photos, snags, review dialogs on the phone | Not started |

Suggested order: P1 → P2 → P5 → P3 → P4 → P10 → P11 → P12.

## 3. Waiting on the firm

Each answer becomes configuration, not code.

- How Full ID closes at design handover (assumed: design approval signed + thank-you).
- Furniture paths A–E: skips, joinery site visit, when shop drawings are skipped.
- Cancelled deals report.
- Commission types (sales, designer fee, referral).
- Spam enquiries that had no chat.
- Catalogue link for the online store.
