import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import {
  activePolicyVersions, amendApprovalAmount, approvalStatus, canDecideApproval, cancelApproval, decideApproval, ensureDefaultPolicy, requestApproval,
} from "../approvals/approval-engine";
import { selectPolicy } from "../approvals/approval-policy";
import { Dec } from "../catalog-core/decimal";
import { commercialRepository } from "../commercial/commercial-repository";
import type { CommercialData } from "../commercial/commercial.types";
import { checkTaxNumber, readTaxNumberRule } from "../purchasing/tax-registration";
import { currencyDecimals } from "../purchasing/orders";
import { acceptedScope } from "../quotation/quotation-builder.service";
import {
  APPROVAL_KIND, email, expectedRefundOn, FINANCE_ACTIONS, INVOICE_KINDS, invoiceAmounts, isOpen, MATERIAL_LOCATIONS, money, netOfTax, nextStatus, oneOf,
  optionalMoney, optionalUuid, quantity, REQUEST_KINDS, refundTotal, requestReference, text, uuid,
  type FinanceAction, type InvoiceKind, type LineInput, type MaterialLocation, type RequestKind,
} from "./finance-requests";
import { applyFinanceRequestDecision } from "./finance-request-approval";
import { addEvent, recordOnLinkedRecords, requestLink, tellRequest } from "./finance-request-notices";
import { cancelDealOnFullRefund } from "../fulfilment/deal-cancel";
import {
  KIND_NAME, moneyText, present, readEvents, readFiles, readLines, readPaymentMethods, readRequests, readSettings, today, type RequestRow,
} from "./finance-requests.store";

type Db = PoolClient;

/** Who acts, in which workspace, and what they may do (the service passes the workspace access check). */
export type Ctx = { workspaceId: string; userId: string; can: (permission: string) => Promise<boolean> };

export const RAISE = "finance_requests.raise";
export const MANAGE = "finance_requests.manage";
const ACTIONS = ["submit", "resubmit", ...FINANCE_ACTIONS, "update", "decide"] as const;
type Action = (typeof ACTIONS)[number];

// ---------------------------------------------------------------- reads

/** The board: Finance sees every request, everyone else their own (raised, or theirs as salesperson). */
export async function readBoard(db: Db, ctx: Ctx) {
  const finance = await ctx.can(MANAGE);
  const canRaise = await ctx.can(RAISE);
  if (!finance && !canRaise) throw new ForbiddenException("You don't have access to finance requests.");
  const settings = await readSettings(db, ctx.workspaceId);
  const rows = await readRequests(db, ctx.workspaceId, finance ? {} : { mine: ctx.userId });
  return {
    requests: rows.map((row) => ({ ...present(row, finance), expectedRefundOn: refundDay(row) })),
    canManage: finance, canRaise, me: ctx.userId,
    settings: { financeInboxSet: Boolean(settings.financeInbox) },
  };
}

/** One request with its lines, files, history and approval, for whoever may read it. */
export async function readDetail(db: Db, ctx: Ctx, id: string) {
  const row = (await readRequests(db, ctx.workspaceId, { id: uuid(id, "Request") }))[0];
  if (!row) throw new NotFoundException("Request not found.");
  const finance = await ctx.can(MANAGE);
  const kind = APPROVAL_KIND[row.kind];
  const approval = kind ? await approvalStatus(db, ctx.workspaceId, kind, row.id) : null;
  const eligibility = approval?.status === "pending" ? await canDecideApproval(db, ctx.workspaceId, approval.id, ctx.userId) : null;
  const mine = row.requestedBy === ctx.userId || row.salespersonId === ctx.userId;
  // Approvers read what they decide, and what they already decided.
  const approver = Boolean(eligibility?.canDecide) || Boolean(kind && (await db.query(
    `SELECT 1 FROM approval_decisions decision JOIN approval_requests item ON item.workspace_id = decision.workspace_id AND item.id = decision.request_id
      WHERE decision.workspace_id = $1 AND item.subject_kind = $2 AND item.subject_id = $3 AND (decision.decided_by = $4 OR decision.on_behalf_of = $4) LIMIT 1`,
    [ctx.workspaceId, kind, row.id, ctx.userId])).rowCount);
  if (!finance && !mine && !approver) throw new NotFoundException("Request not found.");
  const method = row.paymentMethodId ? (await readPaymentMethods(db, ctx.workspaceId)).find((item) => item.id === row.paymentMethodId) ?? null : null;
  return {
    request: { ...present(row, finance), expectedRefundOn: refundDay(row) },
    lines: await readLines(db, ctx.workspaceId, row.id), files: await readFiles(db, ctx.workspaceId, row.id), events: await readEvents(db, ctx.workspaceId, row.id),
    approval, canDecide: Boolean(eligibility?.canDecide && eligibility.via !== "waiver"),
    guidance: row.kind === "refund" ? method?.refundGuidance ?? "" : "",
    canManage: finance, canResubmit: row.status === "needs_info" && row.requestedBy === ctx.userId,
    canAttach: finance || (mine && isOpen(row.status)),
  };
}

/** A refund's expected day: its method's days (kept from when it was raised) after approval, or after submission until then. */
function refundDay(row: RequestRow) {
  if (row.kind !== "refund" || row.status === "rejected") return null;
  return expectedRefundOn(row.refundFrom, row.refundDays);
}

// ---------------------------------------------------------------- commands

/** One command, once by its id: raise, answer, Finance's moves and fields, or an approval decision. Returns the request's id. */
export async function runCommand(db: Db, ctx: Ctx, body: Record<string, unknown>) {
  const action = oneOf(body.action, ACTIONS, "Unknown action.") as Action;
  const id = uuid(body.id, "Request");
  if (!(await firstTime(db, ctx, uuid(body.commandId, "Command"), id, action))) return id;
  if (action === "submit") await submit(db, ctx, id, body);
  else if (action === "resubmit") await resubmit(db, ctx, id, body);
  else if (action === "update") await update(db, ctx, id, body);
  else if (action === "decide") await decide(db, ctx, id, body);
  else await move(db, ctx, id, action, body);
  return id;
}

async function submit(db: Db, ctx: Ctx, id: string, body: Record<string, unknown>) {
  if (!(await ctx.can(RAISE)) && !(await ctx.can(MANAGE))) throw new ForbiddenException("You can't raise finance requests.");
  if ((await db.query(`SELECT 1 FROM finance_requests WHERE workspace_id = $1 AND id = $2`, [ctx.workspaceId, id])).rowCount) return;
  const kind = oneOf(body.kind, REQUEST_KINDS, "Choose an invoice, a refund or a payable.");
  const fields = await parseFields(db, ctx, kind, body, "manual", id);
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended('finance-request-number:' || $1::text, 0))`, [ctx.workspaceId]);
  const number = (await db.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM finance_requests WHERE workspace_id = $1`, [ctx.workspaceId])).rows[0].next;
  await insertRequest(db, ctx.workspaceId, id, number, kind, "manual", ctx.userId, "new", fields);
  await afterRaise(db, ctx.workspaceId, id, ctx.userId, "submitted");
}

/**
 * The request as it goes in, once its fields are checked: its row and lines, its approval when a policy covers
 * it, the first line of its history, the client's, deal's and project's history, and the notices.
 */
export async function insertRequest(db: Db, workspaceId: string, id: string, number: number, kind: RequestKind, source: "manual" | "stage", requesterId: string,
  status: "new" | "needs_info", fields: Fields) {
  const { lines, ...columns } = fields;
  const keys = Object.keys(columns);
  await db.query(
    `INSERT INTO finance_requests (id, workspace_id, number, kind, source, requested_by, status, ${keys.map(snake).join(", ")})
     VALUES ($1, $2, $3, $4, $5, $6, $7, ${keys.map((_, index) => `$${index + 8}`).join(", ")})`,
    [id, workspaceId, number, kind, source, requesterId, status, ...keys.map((key) => columns[key as keyof typeof columns])]);
  await writeLines(db, workspaceId, id, lines);
}

export async function afterRaise(db: Db, workspaceId: string, id: string, actorId: string | null, notice: "submitted" | "answered", note = "") {
  const request = (await readRequests(db, workspaceId, { id }))[0];
  await askApproval(db, workspaceId, request, request.requestedBy);
  const eventId = await addEvent(db, workspaceId, id, { kind: notice === "submitted" ? "submitted" : "resubmitted", to: request.status, note, actorId });
  await recordAudit(db, { workspaceId, actorUserId: actorId, source: actorId ? "user" : "internal", action: notice === "submitted" ? "finance_request.submitted" : "finance_request.resubmitted",
    entityType: "finance_request", entityId: id, after: auditable(request) });
  if (notice === "submitted") await recordOnLinkedRecords(db, workspaceId, request, "finance_request_raised", actorId);
  if (request.status === "needs_info") await tellRequest(db, workspaceId, id, "needs_info", null, note, eventId);
  else await tellRequest(db, workspaceId, id, notice, actorId, note || request.remarks || request.reason, eventId);
}

/** Its requester answers Finance (or an approver who sent it back): the fields again, and what changed. */
async function resubmit(db: Db, ctx: Ctx, id: string, body: Record<string, unknown>) {
  const row = await lock(db, ctx.workspaceId, id, body.version);
  if (row.requestedBy !== ctx.userId) throw new ForbiddenException("Only who raised it sends it again.");
  if (row.status !== "needs_info") throw new ConflictException("Finance hasn't asked for anything on this request.");
  // A person answers, so the rules for a person's request apply (the client's email, a company's tax number).
  const fields = await parseFields(db, ctx, row.kind, body, "manual", id);
  const { lines, ...columns } = fields;
  const keys = Object.keys(columns);
  const status = row.handledBy ? "in_progress" : "new";
  await db.query(`UPDATE finance_requests SET ${keys.map((key, index) => `${snake(key)} = $${index + 4}`).join(", ")}, status = $3, version = version + 1, updated_at = now()
    WHERE workspace_id = $1 AND id = $2`, [ctx.workspaceId, id, status, ...keys.map((key) => columns[key as keyof typeof columns])]);
  await db.query(`DELETE FROM finance_request_lines WHERE workspace_id = $1 AND request_id = $2`, [ctx.workspaceId, id]);
  await writeLines(db, ctx.workspaceId, id, lines);
  await afterRaise(db, ctx.workspaceId, id, ctx.userId, "answered", text(body.note, 2000, "What changed"));
}

/** Finance moves it: in progress, back to the requester with what's missing, done (approved first, when it needed it) or rejected with why. */
async function move(db: Db, ctx: Ctx, id: string, action: FinanceAction, body: Record<string, unknown>) {
  if (!(await ctx.can(MANAGE))) throw new ForbiddenException("Only Finance changes a request's status.");
  const row = await lock(db, ctx.workspaceId, id, body.version);
  const to = nextStatus(row.status, action);
  const note = text(body.note, 1000, "Note");
  if ((action === "ask" || action === "reject") && !note) throw new BadRequestException(action === "ask" ? "Say what's missing." : "Say why it's rejected.");
  const kind = APPROVAL_KIND[row.kind];
  if (action === "done" && kind) {
    const approval = await approvalStatus(db, ctx.workspaceId, kind, row.id);
    if (approval && approval.status === "pending") throw new ConflictException(`It's waiting for approval${approval.waitingFor.length ? ` from ${approval.waitingFor.join(", ")}` : ""}.`);
    if (approval && approval.status !== "approved" && approval.status !== "cancelled") throw new ConflictException("It isn't approved.");
  }
  const reference = action === "done" && body.financeReference !== undefined ? text(body.financeReference, 120, "Reference") : null;
  const closing = action === "done" || action === "reject";
  await db.query(
    `UPDATE finance_requests SET status = $3, handled_by = coalesce(handled_by, $4), finance_reference = coalesce($5, finance_reference),
       closed_by = CASE WHEN $6 THEN $4::uuid ELSE closed_by END, closed_at = CASE WHEN $6 THEN now() ELSE closed_at END,
       close_note = CASE WHEN $6 THEN $7 ELSE close_note END, version = version + 1, updated_at = now()
     WHERE workspace_id = $1 AND id = $2`, [ctx.workspaceId, id, to, ctx.userId, reference, closing, note]);
  if (action === "reject" && kind) await cancelApproval(db, { workspaceId: ctx.workspaceId, kind, subjectId: id, actorUserId: ctx.userId, reason: `Rejected by Finance: ${note}` });
  const eventId = await addEvent(db, ctx.workspaceId, id, { kind: action === "ask" ? "needs_info" : action === "done" ? "done" : action === "reject" ? "rejected" : "status",
    from: row.status, to, note, actorId: ctx.userId });
  await recordAudit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: `finance_request.${action}`, entityType: "finance_request", entityId: id,
    before: { status: row.status }, after: { status: to, note, financeReference: reference } });
  if (action === "done") await recordOnLinkedRecords(db, ctx.workspaceId, row, "finance_request_done", ctx.userId);
  // PLM-125: a refund of the whole deal cancels its order, so what it holds and took goes back to stock.
  if (action === "done" && row.kind === "refund" && row.opportunityId)
    await cancelDealOnFullRefund(db, ctx.workspaceId, { opportunityId: row.opportunityId, total: row.total, currency: row.currency, reference: row.reference, actorUserId: ctx.userId });
  if (action === "reject") await recordOnLinkedRecords(db, ctx.workspaceId, row, "finance_request_rejected", ctx.userId);
  if (action === "ask") await tellRequest(db, ctx.workspaceId, id, "needs_info", ctx.userId, note, eventId);
  if (action === "done") await tellRequest(db, ctx.workspaceId, id, "done", ctx.userId, [note, reference ? `Reference ${reference}` : ""].filter(Boolean).join(" · "), eventId);
  if (action === "reject") await tellRequest(db, ctx.workspaceId, id, "rejected", ctx.userId, note, eventId);
}

/** Finance's own fields, whatever the status: the accounting reference (e.g. QuickBooks), internal notes, the statement check. */
async function update(db: Db, ctx: Ctx, id: string, body: Record<string, unknown>) {
  if (!(await ctx.can(MANAGE))) throw new ForbiddenException("Only Finance changes these.");
  const row = await lock(db, ctx.workspaceId, id, body.version);
  const reference = body.financeReference === undefined ? row.financeReference : text(body.financeReference, 120, "Reference");
  const note = body.internalNote === undefined ? row.internalNote : text(body.internalNote, 4000, "Internal note");
  let statement = row.statementAmount;
  if (body.statementAmount !== undefined) {
    if (row.kind !== "payable" || !row.paidOnStatement) throw new BadRequestException("Only a payable paid on the monthly statement is checked against it.");
    statement = optionalMoney(body.statementAmount, "Amount on the statement", row.currency);
  }
  await db.query(
    `UPDATE finance_requests SET finance_reference = $3, internal_note = $4, statement_amount = $5::numeric,
       statement_checked_at = CASE WHEN $5::numeric IS NULL THEN NULL WHEN statement_amount IS DISTINCT FROM $5::numeric THEN now() ELSE statement_checked_at END,
       statement_checked_by = CASE WHEN $5::numeric IS NULL THEN NULL WHEN statement_amount IS DISTINCT FROM $5::numeric THEN $6::uuid ELSE statement_checked_by END,
       version = version + 1, updated_at = now()
     WHERE workspace_id = $1 AND id = $2`, [ctx.workspaceId, id, reference, note, statement, ctx.userId]);
  await recordAudit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "finance_request.updated", entityType: "finance_request", entityId: id,
    before: { financeReference: row.financeReference, statementAmount: row.statementAmount, internalNoteChanged: false },
    after: { financeReference: reference, statementAmount: statement, internalNoteChanged: note !== row.internalNote } });
}

/** An approver decides on the request itself: the engine checks who may, then the request follows. */
async function decide(db: Db, ctx: Ctx, id: string, body: Record<string, unknown>) {
  const row = (await readRequests(db, ctx.workspaceId, { id }))[0];
  const kind = row ? APPROVAL_KIND[row.kind] : null;
  if (!row || !kind) throw new NotFoundException("Nothing is waiting for approval here.");
  const decision = oneOf(body.decision, ["approve", "return", "reject"] as const, "Approve, send back or reject.");
  const status = await decideApproval(db, { workspaceId: ctx.workspaceId, kind, subjectId: id, deciderUserId: ctx.userId, decision, note: text(body.note, 1000, "Note") || null,
    expectedVersion: typeof body.approvalVersion === "number" ? body.approvalVersion : null, commandId: typeof body.commandId === "string" ? body.commandId : null });
  await applyFinanceRequestDecision(db, ctx.workspaceId, status, decision, ctx.userId, text(body.note, 1000, "Note") || null);
}

/**
 * A refund or payable goes to the approval engine when one of its policies covers the amount (the product
 * default covers every amount; a firm that sets a minimum lets smaller ones through). An invoice needs none.
 */
export async function askApproval(db: Db, workspaceId: string, request: RequestRow, requesterId: string) {
  const kind = APPROVAL_KIND[request.kind];
  if (!kind) return null;
  await ensureDefaultPolicy(db, workspaceId, kind);
  if (!selectPolicy(await activePolicyVersions(db, workspaceId, kind), request.total, request.currency)) return null;
  const who = request.kind === "payable" ? request.supplierName : request.clientName;
  const title = `${request.reference} · ${KIND_NAME[request.kind]} · ${who ?? ""}`.slice(0, 300);
  // Already approved (Finance asked for more afterwards): it stays approved unless the amount moves past the policy's tolerance.
  const latest = await approvalStatus(db, workspaceId, kind, request.id);
  if (latest?.status === "approved")
    return (await amendApprovalAmount(db, { workspaceId, kind, subjectId: request.id, amount: request.total, currency: request.currency, actorUserId: requesterId,
      title, href: requestLink(request.id) })).status;
  return requestApproval(db, { workspaceId, kind, subjectId: request.id, title, href: requestLink(request.id), amount: request.total, currency: request.currency,
    requesterUserId: requesterId });
}

// ---------------------------------------------------------------- fields

export type Fields = { lines: Array<LineInput & { amount: string }>; [column: string]: unknown };
const snake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/** Everything a request says, checked against the records it points to. Links fill each other (project → deal → client). */
export async function parseFields(db: Db, ctx: Pick<Ctx, "workspaceId" | "userId">, kind: RequestKind, body: Record<string, unknown>, source: "manual" | "stage", requestId: string | null = null): Promise<Fields> {
  const workspaceId = ctx.workspaceId;
  const link = await links(db, workspaceId, { partyId: optionalUuid(body.partyId, "Client"), opportunityId: optionalUuid(body.opportunityId, "Deal"), projectId: optionalUuid(body.projectId, "Project") });
  const currency = typeof body.currency === "string" && /^[A-Z]{3}$/.test(body.currency) ? body.currency : null;
  if (!currency) throw new BadRequestException("Choose the currency.");
  const remarks = text(body.remarks, 2000, "Remarks");
  const common = { partyId: link.partyId, opportunityId: link.opportunityId, projectId: link.projectId, caseId: link.caseId, salespersonId: link.salespersonId, currency, remarks };
  if (kind === "payable") return { ...common, ...(await payableFields(db, workspaceId, body, currency, link.projectId)) };
  if (!link.party) throw new BadRequestException("Choose the client from your clients.");
  const clientEmail = email(body.clientEmail, "Client email");
  if (kind === "refund") {
    const fields = await refundFields(db, workspaceId, body, currency);
    await assertRefundable(db, workspaceId, link, currency, fields.totalAmount, requestId);
    return { ...common, ...fields, clientEmail };
  }
  if (!clientEmail && source === "manual") throw new BadRequestException("Add the client's email: the invoice and its reminders are sent to it.");
  let clientTaxNumber = text(body.clientTaxNumber, 120, "Client tax number");
  if (clientTaxNumber) clientTaxNumber = checkTaxNumber(clientTaxNumber, await readTaxNumberRule(db, workspaceId));
  if (!clientTaxNumber && link.party.type === "organization" && source === "manual") throw new BadRequestException("A company client needs its tax registration number.");
  return { ...common, clientEmail, clientTaxNumber, ...(await invoiceFields(db, workspaceId, body, currency, link)) };
}

type Links = Awaited<ReturnType<typeof links>>;
async function links(db: Db, workspaceId: string, input: { partyId: string | null; opportunityId: string | null; projectId: string | null }) {
  let { partyId, opportunityId } = input;
  let caseId: string | null = null;
  if (input.projectId) {
    const project = (await db.query<{ caseId: string; opportunityId: string }>(
      `SELECT project.case_id AS "caseId", pre_case.opportunity_id AS "opportunityId" FROM delivery_projects project
         JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
        WHERE project.workspace_id = $1 AND project.id = $2`, [workspaceId, input.projectId])).rows[0];
    if (!project) throw new NotFoundException("Project not found.");
    if (opportunityId && opportunityId !== project.opportunityId) throw new BadRequestException("This project belongs to another deal.");
    opportunityId = project.opportunityId; caseId = project.caseId;
  }
  let opportunity: { partyId: string; ownerId: string | null; legalEntityId: string | null } | null = null;
  if (opportunityId) {
    opportunity = (await db.query<{ partyId: string; ownerId: string | null; legalEntityId: string | null }>(
      `SELECT opportunity.party_id AS "partyId", owner.user_id AS "ownerId", opportunity.legal_entity_id AS "legalEntityId" FROM crm_opportunities opportunity
         LEFT JOIN workspace_memberships owner ON owner.id = opportunity.owner_membership_id AND owner.status = 'active'
        WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`, [workspaceId, opportunityId])).rows[0] ?? null;
    if (!opportunity) throw new NotFoundException("Deal not found.");
    if (partyId && partyId !== opportunity.partyId) throw new BadRequestException("This deal is another client's.");
    partyId = opportunity.partyId;
    caseId ??= (await db.query<{ id: string }>(`SELECT id FROM pre_project_cases WHERE workspace_id = $1 AND opportunity_id = $2 ORDER BY created_at LIMIT 1`, [workspaceId, opportunityId])).rows[0]?.id ?? null;
  }
  let party: { type: string; status: string; ownerId: string | null } | null = null;
  if (partyId) {
    party = (await db.query<{ type: string; status: string; ownerId: string | null }>(
      `SELECT party.type::text AS type, party.status::text AS status, owner.user_id AS "ownerId" FROM crm_parties party
         LEFT JOIN workspace_memberships owner ON owner.id = party.owner_membership_id AND owner.status = 'active'
        WHERE party.workspace_id = $1 AND party.id = $2`, [workspaceId, partyId])).rows[0] ?? null;
    if (!party) throw new NotFoundException("Client not found.");
    if (party.status !== "active") throw new BadRequestException("Choose an active client.");
  }
  return { partyId, opportunityId, projectId: input.projectId, caseId, party, legalEntityId: opportunity?.legalEntityId ?? null,
    // The salesperson is the deal's owner (their commission), else the client's.
    salespersonId: opportunity?.ownerId ?? party?.ownerId ?? null };
}

/** The company's current tax rates (its region decides the tax's name); null when none are set. */
export async function entityTax(db: Db, workspaceId: string, legalEntityId: string) {
  const entity = (await db.query<{ countryCode: string; currency: string; status: string }>(
    `SELECT country_code AS "countryCode", base_currency AS currency, status::text AS status FROM legal_entities WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, legalEntityId])).rows[0];
  if (!entity || entity.status !== "active") throw new BadRequestException("Choose an active company.");
  const rates = (await db.query<{ code: string; label: string; rate: string; isDefault: boolean }>(
    `SELECT rate.code, rate.label, rate.rate::text AS rate, rate.is_default AS "isDefault" FROM tax_rates rate
       JOIN tax_profiles profile ON profile.id = rate.tax_profile_id
      WHERE rate.workspace_id = $1 AND profile.legal_entity_id = $2 AND rate.effective_to IS NULL AND profile.status = 'active' AND profile.effective_to IS NULL
      ORDER BY rate.is_default DESC, rate.label`, [workspaceId, legalEntityId])).rows.map((rate) => ({ ...rate, rate: Dec.of(rate.rate).toString() }));
  const label = (await db.query<{ label: string | null }>(
    `SELECT configuration->'tax'->>'label' AS label FROM tenant_setup_profiles WHERE kind = 'region' AND code = $1 ORDER BY version DESC LIMIT 1`, [entity.countryCode])).rows[0]?.label;
  return { currency: entity.currency.trim(), taxLabel: label || "Tax", rates };
}

async function invoiceFields(db: Db, workspaceId: string, body: Record<string, unknown>, currency: string, link: Links) {
  const invoiceKind = oneOf(body.invoiceKind ?? "standard", INVOICE_KINDS, "Choose what kind of invoice it is.") as InvoiceKind;
  const legalEntityId = uuid(body.legalEntityId, "Company");
  const tax = await entityTax(db, workspaceId, legalEntityId);
  if (!tax.rates.length) throw new BadRequestException("Set this company's tax rates in Settings → Tax and numbering first.");
  const rate = body.taxCode ? tax.rates.find((item) => item.code === body.taxCode) : tax.rates.find((item) => item.isDefault) ?? tax.rates[0];
  if (!rate) throw new BadRequestException("Choose one of the company's tax rates.");
  // A payment stage of the deal: its title is kept as it was.
  let stage: { id: string; title: string } | null = null;
  if (body.paymentStageId) {
    const stages = link.caseId ? await paymentStages(db, workspaceId, link.caseId) : [];
    const found = stages.find((item) => item.id === body.paymentStageId);
    if (!found) throw new BadRequestException("Choose a payment stage of this deal.");
    stage = { id: found.id, title: found.title };
  }
  let quoteId: string | null = null;
  if (body.quoteId) {
    if (!link.caseId || !(await db.query(`SELECT 1 FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, link.caseId, String(body.quoteId)])).rowCount)
      throw new BadRequestException("Choose a quote of this deal.");
    quoteId = String(body.quoteId);
  }
  const lines = parseLines(body.lines, currency, true);
  const amounts = invoiceAmounts(lines, rate.rate, currency);
  if (Dec.of(amounts.net).cmp(0) <= 0) throw new BadRequestException("The invoice must come to more than zero before tax.");
  const contractReference = text(body.contractReference, 200, "Contract or letterhead reference");
  if (invoiceKind === "progress" && (!link.projectId || !contractReference)) throw new BadRequestException("A progress invoice names its project and its contract or letterhead reference.");
  const orderNumber = text(body.orderNumber, 80, "Order number");
  const orderGross = invoiceKind === "web_order" ? money(body.orderGross, "Order total", currency) : null;
  const method = await paymentMethod(db, workspaceId, body);
  if (invoiceKind === "web_order" && (!orderNumber || !method.label)) throw new BadRequestException("A web order needs its order number and how it was paid.");
  return {
    legalEntityId, invoiceKind, quoteId, paymentStageId: stage?.id ?? null, paymentStageTitle: stage?.title ?? "", paymentTerms: text(body.paymentTerms, 1000, "Payment terms"),
    contractReference, orderNumber: invoiceKind === "web_order" ? orderNumber : "", orderGross, paymentMethodId: method.id, paymentMethod: method.label,
    taxCode: rate.code, taxLabel: tax.taxLabel, taxRate: rate.rate, netAmount: amounts.net, taxAmount: amounts.tax, totalAmount: amounts.total, lines: amounts.lines,
  };
}

/**
 * QA-012: a refund gives back money the client paid. What can still be refunded is what Finance verified as received
 * from them in the request's currency (on its deal, else on all their deals), less the refunds already asked for and
 * not rejected; a refund beyond it is refused before it reaches approval, with what was received.
 */
async function assertRefundable(db: Db, workspaceId: string, link: Links, currency: string, total: string, requestId: string | null) {
  const scope = link.opportunityId ? { cases: "pre_case.opportunity_id = $2", requests: "request.opportunity_id = $2", id: link.opportunityId, what: "on this deal" }
    : link.caseId ? { cases: "pre_case.id = $2", requests: "request.case_id = $2", id: link.caseId, what: "on this deal" }
    : { cases: "opportunity.party_id = $2", requests: "request.party_id = $2", id: link.partyId!, what: "from this client" };
  const row = (await db.query<{ received: string; asked: string }>(
    `SELECT coalesce((SELECT sum(receipt.amount) FROM commercial_receipts receipt
                        JOIN pre_project_cases pre_case ON pre_case.workspace_id = receipt.workspace_id AND pre_case.id = receipt.case_id
                        JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
                       WHERE receipt.workspace_id = $1 AND ${scope.cases} AND receipt.status = 'finance_verified' AND btrim(receipt.currency) = $3), 0)::text AS received,
            coalesce((SELECT sum(request.total_amount) FROM finance_requests request
                       WHERE request.workspace_id = $1 AND ${scope.requests} AND request.kind = 'refund' AND request.status <> 'rejected' AND request.currency = $3
                         AND request.id IS DISTINCT FROM $4::uuid), 0)::text AS asked`,
    [workspaceId, scope.id, currency, requestId])).rows[0];
  const left = Dec.of(row.received).sub(row.asked);
  if (Dec.of(total).cmp(left) <= 0) return;
  if (Dec.of(row.received).isZero()) throw new BadRequestException(`Nothing has been received ${scope.what} in ${currency} yet, so there is nothing to refund.`);
  throw new BadRequestException(`A refund can't be more than was received: ${moneyText(row.received, currency)} came in ${scope.what}`
    + `${Dec.of(row.asked).isZero() ? "" : ` and ${moneyText(row.asked, currency)} is already asked back`}, so at most ${moneyText(left.cmp(0) > 0 ? left.toString() : "0", currency)} can be refunded.`);
}

async function refundFields(db: Db, workspaceId: string, body: Record<string, unknown>, currency: string) {
  const invoiceNumber = text(body.invoiceNumber, 80, "Invoice number");
  if (!invoiceNumber) throw new BadRequestException("Add the number of the client's invoice.");
  const reason = text(body.reason, 2000, "Reason");
  if (!reason) throw new BadRequestException("Say why the client is refunded.");
  const lines = parseLines(body.lines, currency, false).map((line) => ({ ...line, amount: line.unitPrice }));
  const method = await paymentMethod(db, workspaceId, body);
  if (!method.label) throw new BadRequestException("Choose the refund method.");
  // Bank details only when the method needs them; never kept otherwise.
  const bankDetails = method.needsBankDetails ? text(body.bankDetails, 1000, "Bank details") : "";
  if (method.needsBankDetails && !bankDetails) throw new BadRequestException("Add the client's bank details: this method is refunded by bank transfer.");
  const legalEntityId = optionalUuid(body.legalEntityId, "Company");
  // PLM-109: the expected date follows the chosen method's days, kept on the request so a later settings change never moves it.
  return { invoiceNumber, reason, paymentMethodId: method.id, paymentMethod: method.label, bankDetails, refundDays: method.refundDays, legalEntityId,
    totalAmount: refundTotal(lines, currency), lines };
}

async function payableFields(db: Db, workspaceId: string, body: Record<string, unknown>, currency: string, projectId: string | null) {
  const vendorId = uuid(body.vendorId, "Supplier");
  const vendor = (await db.query<{ taxNumber: string | null; archived: boolean }>(
    `SELECT tax_registration_number AS "taxNumber", archived_at IS NOT NULL OR status = 'archived' AS archived FROM workspace_vendors WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, vendorId])).rows[0];
  if (!vendor) throw new BadRequestException("Choose the supplier from your suppliers.");
  if (vendor.archived) throw new BadRequestException("This supplier is archived.");
  const supplierReference = text(body.supplierReference, 120, "Supplier quote or invoice number");
  if (!supplierReference) throw new BadRequestException("Add the supplier's quote or invoice number.");
  const totalAmount = money(body.totalAmount, "Full amount", currency);
  const payNowAmount = money(body.payNowAmount, "Amount to pay now", currency);
  if (Dec.of(payNowAmount).cmp(totalAmount) > 0) throw new BadRequestException("Pay now can't be more than the full amount.");
  const authorisedBy = uuid(body.authorisedBy, "Authorised by");
  if (!(await db.query(`SELECT 1 FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, authorisedBy])).rowCount)
    throw new BadRequestException("Choose who authorised it from your team.");
  const materialLocation = oneOf(body.materialLocation, MATERIAL_LOCATIONS, "Say where the material is needed.") as MaterialLocation;
  if (materialLocation === "project" && !projectId) throw new BadRequestException("Choose the project the material is for.");
  const legalEntityId = uuid(body.legalEntityId, "Paying company");
  await entityTax(db, workspaceId, legalEntityId);
  return {
    vendorId, supplierReference, totalAmount, payNowAmount, authorisedBy, materialLocation, legalEntityId, supplierTaxNumber: vendor.taxNumber ?? "",
    paymentTerms: text(body.paymentTerms, 1000, "Payment terms"), paidOnStatement: body.paidOnStatement === true, lines: [],
  };
}

async function paymentMethod(db: Db, workspaceId: string, body: Record<string, unknown>) {
  const id = optionalUuid(body.paymentMethodId, "Payment method");
  if (id) {
    const method = (await readPaymentMethods(db, workspaceId)).find((item) => item.id === id);
    if (!method) throw new BadRequestException("Choose one of the payment methods.");
    return { id, label: method.label, needsBankDetails: method.needsBankDetails, refundDays: method.refundDays };
  }
  return { id: null, label: text(body.paymentMethod, 80, "Payment method"), needsBankDetails: false, refundDays: null };
}

function parseLines(value: unknown, currency: string, signed: boolean): LineInput[] {
  if (!Array.isArray(value) || !value.length) throw new BadRequestException("Add at least one line.");
  if (value.length > 200) throw new BadRequestException("Up to 200 lines.");
  return value.map((raw, index) => {
    const line = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const description = text(line.description, 500, `Line ${index + 1}`);
    if (!description) throw new BadRequestException(`Describe line ${index + 1}.`);
    const negative = signed && typeof line.unitPrice === "string" && line.unitPrice.trim().startsWith("-");
    const unitPrice = money(negative ? String(line.unitPrice).trim().slice(1) : line.unitPrice, `Line ${index + 1}'s amount`, currency);
    return { description, quantity: quantity(line.quantity, `Line ${index + 1}'s quantity`), unitPrice: negative ? Dec.of(unitPrice).neg().toFixed(4) : unitPrice };
  });
}

async function writeLines(db: Db, workspaceId: string, requestId: string, lines: Array<LineInput & { amount: string }>) {
  for (const [position, line] of lines.entries())
    await db.query(`INSERT INTO finance_request_lines (id, workspace_id, request_id, position, description, quantity, unit_price, amount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), workspaceId, requestId, position, line.description, line.quantity, line.unitPrice, line.amount]);
}

// ---------------------------------------------------------------- what the form offers

/** The deal's payment stages (its payment terms), with what the client pays at each. */
export async function paymentStages(db: Db, workspaceId: string, caseId: string) {
  const loaded = await commercialRepository.load(db, workspaceId, caseId);
  const data = loaded?.content as Partial<CommercialData> | undefined;
  return (data?.payments ?? []).map((payment) => {
    const currency = (payment.currency ?? "").trim();
    return { id: payment.id, title: payment.title, trigger: payment.trigger ?? "", dueDate: payment.dueDate || null, currency,
      amount: Dec.of(payment.amount ?? 0).round(currencyDecimals(currency || "USD")).toFixed(4), legalEntityId: payment.legalEntityId ?? null };
  });
}

/** A quote's lines as the client agreed them, before tax: each line's net, and the quote's discounts as one line. */
export async function quoteLines(db: Db, workspaceId: string, caseId: string, quoteId: string) {
  const scope = await acceptedScope(db, workspaceId, caseId, quoteId);
  const lines = scope.lines.filter((line) => line.kind !== "heading" && Dec.of(line.net).cmp(0) !== 0)
    .map((line) => ({ description: [line.title, line.quantity && line.unit ? `${Dec.of(line.quantity).toString()} ${line.unit}` : ""].filter(Boolean).join(" · ").slice(0, 500),
      quantity: "1", unitPrice: Dec.of(line.net).toFixed(4) }));
  const sum = lines.reduce((total, line) => total.add(line.unitPrice), Dec.ZERO);
  const difference = Dec.of(scope.pricing.net).sub(sum);
  if (!difference.isZero()) lines.push({ description: "Discount", quantity: "1", unitPrice: difference.toFixed(4) });
  return { currency: scope.quote.currency, lines, net: Dec.of(scope.pricing.net).toFixed(4) };
}

// ---------------------------------------------------------------- helpers

async function lock(db: Db, workspaceId: string, id: string, version: unknown) {
  await db.query(`SELECT 1 FROM finance_requests WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, id]);
  const row = (await readRequests(db, workspaceId, { id }))[0];
  if (!row) throw new NotFoundException("Request not found.");
  if (version !== row.version) throw new ConflictException("This request changed elsewhere. Reload to see it.");
  return row;
}

async function firstTime(db: Db, ctx: Ctx, commandId: string, entityId: string, action: string) {
  return Boolean((await db.query(
    `INSERT INTO finance_request_commands (workspace_id, id, entity_id, action, actor_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (workspace_id, id) DO NOTHING`,
    [ctx.workspaceId, commandId, entityId, action, ctx.userId])).rowCount);
}

/** What the audit keeps of a request: its facts, never the client's bank details or Finance's notes. */
function auditable(row: RequestRow) {
  return { reference: row.reference, kind: row.kind, status: row.status, partyId: row.partyId, opportunityId: row.opportunityId, projectId: row.projectId, vendorId: row.vendorId,
    legalEntityId: row.legalEntityId, currency: row.currency, net: row.net, tax: row.tax, total: row.total, payNow: row.payNow, taxRate: row.taxRate,
    invoiceKind: row.invoiceKind, paymentStageId: row.paymentStageId, quoteId: row.quoteId, invoiceNumber: row.invoiceNumber, supplierReference: row.supplierReference,
    hasBankDetails: row.bankDetails.length > 0 };
}

export { today };
