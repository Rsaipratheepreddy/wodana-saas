# Pre-project commercial, approvals and client portal — v1 plan

7 September 2026. Scope locked for implementation by the user. Preparation is owned by another task. This document records the intended commercial sequence; see [current implementation, verification and production boundaries](projects-delivery-verification.md) for tested behavior.

## 1. Main flow

Preparation scope/specifications → BOQ and internal costing → internally approved quotation → client reviews the issued version → accepts, requests changes or declines → agreed contract and payment schedule → verified release conditions → authorized scope handed to Projects.

Design review can run alongside commercial negotiation. An agreed consultation/design fee may occur before the main execution quotation. Each release checks its own required design, scope, contract and payment evidence; quotation acceptance alone never releases purchasing or production.

## 2. Simplify the internal navigation

Reduce the current seven Commercial & approvals destinations to five. Merge navigation, not the underlying decisions or records.

| Keep | Contents and main action |
|---|---|
| **BOQ & costing** | Scope-linked BOQ; quantities/units; direct costs, overheads, selling rates, allowances, discounts, configured taxes and margin. Action: Prepare quotation. |
| **Quotations** | Current offer, draft revision, client preview/PDF, comparison, issue status and version history. Actions: Submit for internal review; Issue to client; Create revision. |
| **Agreement & payments** | Subviews: Agreement, Payment schedule, Invoices & receipts. Contract versions/signature evidence, milestone amounts/dates, finance references and verification. |
| **Change requests** | Clarifications and requested scope/price/time changes, impact assessment, linked revisions or variations, ownership and resolution. Rename the current Variations destination. |
| **Approvals & release** | Subviews: Pending decisions, Release checklist, History. One queue linked to source records; execution release remains a separate authorized action. |

Preparation's Brief & scope, Site and Design remain outside this implementation. Files & activity remains the shared record library, with documents and comments also accessible in context.

## 3. Quotation versions: exact rules

One quotation family contains numbered issued versions and at most one working successor draft. Draft autosaves use an edit revision counter; they do not produce a new client-facing quotation number on every save.

| Event | Result |
|---|---|
| Create V1 | Draft from selected scope/specification versions and BOQ. Internal costs stay private. |
| Internal review | Named reviewer checks pricing, margin, terms, scope and approval policy. Any material edit invalidates that review. |
| Issue V1 | Freeze the complete offer and client-visible attachments. Create a version-bound client decision request. Record publication separately from message delivery. |
| Client asks for changes | Record the response on V1 and create/link one change request. V1 becomes non-actionable; the request goes to its owner. |
| Prepare V2 | Copy a frozen source into an editable successor. Show added/removed/changed lines, price and date effects. V1 stays readable. |
| Issue V2 | Repeat internal review. Atomically replace outstanding approval requests for the previous offer. Old links open history with a link to V2; they cannot accept V1. |
| Client accepts | Accept only the currently actionable, unexpired version and selected authorized approver policy. Freeze identity, exact contents, decision and time. |
| Later change | Preserve the accepted baseline. Use an amendment/variation with its own versions and approvals; do not rewrite the accepted quotation. |

The issued snapshot includes stable line IDs, descriptions, quantities, units, selling prices, discounts, tax rules/results, currency/rounding, inclusions/exclusions, assumptions, validity, payment terms, delivery commitments and referenced specification/drawing versions. Store its rendered document and content hash. Later catalog, BOQ or Preparation edits never silently change that document.

Issuance state and delivery evidence are separate: failure to send a message is not a client refusal. Retrying delivery reuses the same issue/request; it does not create V3. Record viewed/downloaded events as evidence, never approval.

Creating a draft successor does not silently withdraw an existing offer. The owner can explicitly pause/withdraw it. If the old offer is accepted while a successor is still a draft, block issuing that draft as a replacement base offer; review it as a post-acceptance amendment.

V1 client actions are **Accept quotation**, **Request changes**, and **Decline quotation**. A comment is not acceptance. Partial acceptance and client-side editing of prices/quantities are excluded initially: issue a coherent revised offer instead. Multiple proposals/options can be discussed, but only one identified offer is actionable for a given decision.

## 4. Requests and closure

Treat “close requests” as both approval-request completion and change-request resolution.

**Approval request:** Pending → Approved, Changes requested, Declined, Withdrawn, Expired or Replaced. Terminal requests are read-only. A new version gets a new request linked to the old one. Returning for revision is a normal workflow outcome, not an error. Expiry never counts as consent.

**Change request:** Open → Under review → Awaiting client/internal decision → Resolved, Declined or Withdrawn. Each request has its source version/lines, requester, owner, due date, description, attachments, impact, linked decision and closure reason.

- A clarification closes with a recorded answer and requester acknowledgement, or an explicit owner closure with reason and a reopen path; it does not manufacture a quotation revision.
- A pre-acceptance commercial change closes as applied only when its linked replacement offer is accepted and the disposition is recorded. Sending V2 alone does not close it.
- A post-acceptance change closes as applied when the required amendment/variation approvals are effective and affected records are updated. Physical delivery is tracked separately by linked execution tasks.
- If one version addresses several requests, record each as applied, declined or deferred. Unaddressed requests stay open.
- Reopening preserves previous history; duplicate requests link to the original. Declining one quotation does not automatically close the entire Pre-project.
- Closing/archiving the case requires a reason and disposition of pending requests, client access and outstanding fee/refund/contract obligations. Archiving never deletes accepted evidence or records a payment as settled.

## 5. One approval system

Approval requests point to an entity ID, immutable version/snapshot, decision type, named approver policy and expiry. BOQ internal pricing approval, client design decisions, quotation acceptance, contract execution, verified payment and execution release remain distinct facts. The Approval center and client Home are views of these same requests.

Server rules enforce who may issue, approve, record an external decision or release. Default to one designated commercial client approver; support an explicit all-required approver list where the customer needs it. Freeze that policy on issue. Changing the approver policy requires replacement, not silently ignoring a required person.

Client acceptance records the authenticated contact, granted authority, version/hash, amount/currency, decision wording, server time and audit evidence. A staff-entered decision must be labelled “Recorded on behalf of client”, reference the actual client/evidence/channel, and use a restricted permission. It must never masquerade as a portal-authenticated decision.

The final server operation rechecks version, expiry, authority, decision state and request uniqueness inside a transaction. Duplicate clicks/retries return the original result. Changes to significant approval data invalidate a pending authorization. A batch approval names every included version and permits item-level outcomes; there is no unqualified “Approve everything”.

These controls apply the separation between authentication and transaction approval described by [OWASP Transaction Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html). Showing the exact version, amount and terms before confirmation is a product decision based on that guidance.

## 6. Client portal and mobile OTP

**Entry:** company-branded link → registered mobile number with country code → OTP → authorized Pre-projects/projects → items requiring attention. Access works for a shared quotation before any execution project exists. Do not require a completed design review or a released project merely to enter the portal.

| Portal section | Client sees and does |
|---|---|
| **Home** | Pending decisions, latest replies, upcoming payments and current stage. Each action opens its source record. |
| **Designs & selections** | Only explicitly published Preparation versions; review, comment, approve or request changes. |
| **Quotations** | Current issued offer, changed-line summary, PDF, previous versions and version-specific decisions. |
| **Agreement & payments** | Agreement/signature process, milestones, issued invoices, verified receipts and upload of payment evidence. |
| **Requests & messages** | Own change requests, replies, requested information, attachments and closure history. |

Files live with their quotation/design/request and in shared document views; no second independent file repository. After handoff, the same access can show published project progress and handover decisions. Internal costs, margins, vendor rates, draft documents and private comments must be excluded from API responses and downloads, not merely hidden with CSS.

**Identity boundary:** a portal contact has explicit company/case grants and viewer/approver authority. A phone code proves access to that number, not entitlement to every customer record. Match canonical full international numbers; never authorize by the last digits alone. No public self-registration that automatically claims existing cases. Phone replacement and approver changes require verified administration and revoke old access/sessions.

**Confirmed delivery choice:** WhatsApp OTP, as requested by the user. Reuse the existing WhatsApp authentication-template route where compatible with the new portal's identity and access rules. SMS is outside the initial scope. The screen states that the code is sent through WhatsApp. Provider configuration and successful delivery must be verified before live use.

**Temporary testing choice:** use the fixed code **123456** for local/demo development, as requested by the user. Enable it only through an explicit server-side development setting that is rejected in production. The demo screen identifies test mode; it must not claim a WhatsApp message was sent. The code still requires an eligible test contact, a current challenge and its authorized company/case grants; it is not a universal account bypass. Preserve expiry, attempt limits, challenge consumption and separate action-bound approval challenges. Disable this mode before live use and generate a fresh code for each WhatsApp challenge; delivery failure must never fall back to the fixed code.

**Proposed defaults:** six-digit code, five-minute expiry, five attempts and sixty-second resend delay; single use and invalidation on replacement. Add request/verify limits across phone, company and IP, non-enumerating responses, keyed OTP protection, no code logging, secure HttpOnly sessions, CSRF protection and revocation. These defaults are product choices; the underlying short-lived, single-use, attempt-limited approach follows [OWASP OTP handling](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html#one-time-password-otp-handling-and-storage).

Login does not approve anything. Quote/variation acceptance shows an explicit confirmation and uses a fresh action-bound verification challenge; it cannot reuse the login code. The client sees what document/version/value is being accepted. Contract signing is a separate configured agreement action with its own evidence; OTP login is not labelled a signed contract. No signatures or legal certification are invented.

## 7. Agreement, payments and execution release

The agreement references the accepted offer and frozen terms. Any scope/price divergence requires a reviewed amendment. Track contract versions, parties, responsibilities, signature requirements and completion evidence.

The payment schedule records amount/basis, due date or milestone trigger and related contract version. Existing receipts and invoices remain immutable evidence when a later schedule changes. A client-uploaded bank slip is **Submitted for verification**, not **Paid**.

Use the selected Zoho Books or QuickBooks company for accounting documents and settlement. Wodana holds approval evidence, agreed schedules and external references/status. Provider confirmation or authorized finance reconciliation establishes payment; retries must not create duplicate invoices/receipts. Refunds/credits are explicit accounting actions.

Release checks the exact scope/version, necessary technical approvals, agreement and applicable verified payment conditions. Only a named authorized employee releases purchasing, production or site execution. Exceptions require a recorded authority, scope and reason. Pre-project retains the commercial history after handoff; Projects uses those linked records rather than making another contract or quotation copy.

## 8. Interface with Preparation — no overlapping implementation

Read the existing workspace/case/party identity, room IDs, scope-entry IDs and quantities/units, specification version IDs, design version IDs, attachment metadata and their approval/publication state. Capture selected versions in commercial snapshots; do not replace Preparation tables or write its design state directly.

The Preparation owner needs one shared approval adapter: request an approval for an exact design/version, receive a recorded decision, validate that version, and update its own source state. Internal Design and client portal views must use the same decision record. Do not bolt a second client-approval status onto the same design.

An upstream revision flags affected BOQ/quotation lines. Draft pricing may be explicitly refreshed with a comparison. Issued/accepted offers keep their snapshot until a controlled successor/amendment is issued. Changed fields, origin version and acknowledgement remain traceable.

## 9. Remove or defer

- Merge Contracts & terms plus Payment plan into Agreement & payments; merge approval/release navigation while preserving distinct controls and safe old-link redirects.
- Rename Variations to Change requests; use one request with a revision before acceptance or a variation after acceptance.
- Remove repeated approval screens, duplicate client/internal copies of decisions, giant status banners and free-form “mark paid/approved” shortcuts without evidence.
- Keep compact current-version tables with history behind an explicit action. Do not show draft/internal material to the client or delete obsolete versions.
- Defer AI quotation generation, package recommendation engines, editable client shopping carts, general-ledger duplication and complex signature-provider automation. The core review/revision/approval loop comes first.

## 10. Build in this order

| Order | Reviewable result |
|---|---|
| 1 | Shared commercial/version/approval contracts, portal contact grants and Preparation read adapter. Confirm one authoritative backend before migrations. |
| 2 | Basic BOQ/costing → quotation V1 → internal approval → issue → WhatsApp OTP portal (123456 in explicit local/demo mode) → client decision. One complete working path. |
| 3 | Request changes → V2 comparison/review → issue → reject stale V1 decisions → accept V2 → resolve linked requests. |
| 4 | Agreement/signature evidence, payment schedule, finance verification/accounting references and restricted client views. |
| 5 | Design approval adapter, shared approval queue, release checks, linked Projects handoff and navigation cleanup. Portal requests/threads/history span all increments. |

Existing Business Core is the proposed owner for new portal data. The [older quotation service](../../backend/app/services/quotation_service.py), [client quotation routes](../../backend/app/api/v1/client_quotes.py) and [client OTP service](../../backend/app/services/client_auth_service.py) are reuse candidates, not a verified new-portal implementation. The [current Design service](../services/business-core/src/pre-projects/design.service.ts) belongs to Preparation and must be connected through the agreed adapter. Avoid independently writable commercial state in both backends.

Before release, demonstrate: wrong-client/tenant denial; full-phone matching; OTP expiry/replay/throttling; issued snapshot immutability; stale and concurrent approval rejection; resend without duplicate requests; V2 diffs and closure; no private-cost leakage including PDFs; exact approved contract references; proof-versus-paid distinction; failed accounting retries; explicit execution release; and access/history continuity after handoff.

The user has authorized implementation of this plan, including a minimal editable quotation table inspired by the older UI, a responsive branded client portal, and workspace configuration of the logo, colours and welcome content. External message delivery is not part of the local/demo test. Provider credentials, final signer policy, accounting company mapping and client-specific commercial terms must be configured before live use; no such facts are assumed here.


## Implemented local/demo slice — 7 September 2026

- Quotations opens as a searchable status-filtered table. A row opens the exact quotation at `quotations?quote=<id>`; Back to quotations returns to the table. Creating/revising opens the new draft.
- Document builder follows the older Pages rail: clean cover, room items and visible materials, commercial summary, payment schedule, inclusions/terms, review/acceptance. Current workspace theme and gradients apply. Internal costs stay in the internal view.
- BOQ and quotation use the same commercial lines. Import reads included Preparation scope with source versions. The material editor searches current catalogs and saves selected catalog versions. AI reads a fresh complete catalog index and relevant details on each request.
- Payment schedules can be created/reused, applied or dragged onto the quotation and reordered with drag handles or buttons. Frozen accepted milestones populate Agreement & payments; their amounts cannot be edited there.
- Client mobile logins are managed in their own case-level Client portal tab. Multiple full international numbers, viewer/approver permissions, access removal and session revocation are implemented. One designated approver is selected on issue.
- Workspace portal configuration controls logo, colours and welcome content. Local/demo OTP 123456 is restricted to configured test contacts and rejected in production.
- Server-enforced draft → internal review → approval → issue → accept/request changes; issued versions are immutable. Revisions link to and close accepted change requests. Agreement evidence and verified payment references remain separate facts.

Still outside this demo slice: actual WhatsApp delivery, Zoho/QuickBooks invoice/settlement synchronisation, all-required multi-signer policies, electronic signature-provider integration, the Preparation design-approval portal adapter, and actual Projects creation. Execution readiness currently records the commercial checks plus a required technical-evidence note; it is not a verified technical release or a created project.

Validation: Business Core and web typechecks; commercial domain tests; quotation table-to-selected-builder regression tests; room/material editing and payment reorder interaction tests; Woddy context tests; API lifecycle smoke covering private projections, two phone logins with viewer isolation/revocation, OTP failures/replay, versioned cover/material/payment snapshots, revised-offer acceptance/request closure, accepted payment amount protection and receipt verification. Browser checks cover the table → builder → back path, saved cover, visible material picker and responsive document layout.

Live AI verification: the commercial assistant returned a complete answer using the fresh 10,295-record catalog index, correctly identified the selected material code/version, and flagged the two unfinished material selections. The compact index groups catalog metadata; detailed retrieval is capped at 150 records with one-hop linked references.
