import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { readInvoiceLines, readInvoices, readMilestonePaid, withBalances } from "../receivables/receivables";
import { grantFor, type DecisionContext } from "./portal-decisions";
import { attach, ownUploads, readAttachments, type ClientFile } from "./portal-files";
import { caseTeam, caseTitle, tellClients, tellStaff } from "./portal-notices";
import type { PortalSettings } from "./portal-settings";

type Db = Pick<PoolClient, "query">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type CaseRow = { caseId: string; projectId: string | null; currency: string | null };

type Milestone = { id: string; title: string; amount: string; currency: string | null; dueDate: string | null; payUrl: string | null };
type Notice = { id: string; paymentId: string; status: "submitted" | "recorded" | "not_received"; paidOn: string; reference: string; amount: string | null; note: string;
  reason: string; at: string };

async function milestones(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<Milestone>(
    `SELECT id, title, amount::text AS amount, nullif(currency, '') AS currency, due_date::text AS "dueDate", detail->'invoice'->>'paymentUrl' AS "payUrl"
       FROM commercial_payments WHERE workspace_id = $1 AND case_id = $2 AND amount > 0 ORDER BY sort_order`, [workspaceId, caseId])).rows;
}

async function notices(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<Notice>(
    `SELECT id, payment_id AS "paymentId", status, paid_on::text AS "paidOn", reference, amount::text AS amount, note, decision_note AS reason, created_at AS at
       FROM client_portal_payment_notices WHERE workspace_id = $1 AND case_id = $2 ORDER BY created_at DESC`, [workspaceId, caseId])).rows
    .map((notice) => ({ ...notice, at: new Date(notice.at).toISOString() }));
}

/**
 * The client's payments, one row per milestone (plan §6.22): what it is, when it's due, its amount and invoice,
 * what's been received, and whether it's paid, due, overdue, being checked (the client reported paying) or upcoming.
 * Overdue first. Receipts are what finance verified; a client's report is shown as theirs until finance checks it.
 */
export async function readPayments(db: Db, workspaceId: string, row: CaseRow, settings: PortalSettings, today: string) {
  const amounts = settings.invoiceAmounts;
  const show = (value: string | number | null) => (amounts && value !== null ? Dec.of(value).toFixed(4) : null);
  const plan = await milestones(db, workspaceId, row.caseId);
  const paid = await readMilestonePaid(db, workspaceId, plan.map((milestone) => ({ caseId: row.caseId, paymentId: milestone.id })));
  const receipts = (await db.query<{ id: string; paymentId: string; amount: string; receivedOn: string | null }>(
    `SELECT receipt.id, allocation.payment_id AS "paymentId", allocation.amount::text AS amount,
            left(coalesce(receipt.detail->>'verifiedAt', receipt.detail->>'reportedAt', ''), 10) AS "receivedOn"
       FROM commercial_allocations allocation
       JOIN commercial_receipts receipt ON receipt.workspace_id = allocation.workspace_id AND receipt.case_id = allocation.case_id AND receipt.id = allocation.receipt_id
      WHERE allocation.workspace_id = $1 AND allocation.case_id = $2 AND receipt.status = 'finance_verified' AND allocation.detail->>'reversedAt' IS NULL
      ORDER BY 4, 1`, [workspaceId, row.caseId])).rows;
  // A receipt finance recorded but hasn't verified yet: the client's payment is received and being confirmed.
  const pending = new Set((await db.query<{ paymentId: string }>(
    `SELECT DISTINCT payment_id AS "paymentId" FROM commercial_receipts WHERE workspace_id = $1 AND case_id = $2 AND status IN ('reported', 'provider_confirmed')`,
    [workspaceId, row.caseId])).rows.map((item) => item.paymentId));
  const invoices = row.projectId ? await withBalances(db, workspaceId, await readInvoices(db, workspaceId, { projectId: row.projectId }), today) : [];
  const live = new Map(invoices.filter((invoice) => invoice.status === "issued").map((invoice) => [invoice.paymentId, invoice]));
  const reports = await notices(db, workspaceId, row.caseId);
  const proofs = await readAttachments(db, workspaceId, row.caseId, ["payment"]);
  const currency = row.currency ?? plan.find((milestone) => milestone.currency)?.currency ?? invoices[0]?.currency ?? null;
  const list = plan.map((milestone) => {
    const received = paid.get(`${row.caseId}|${milestone.id}`) ?? Dec.ZERO;
    const invoice = live.get(milestone.id);
    const settled = received.cmp(milestone.amount) >= 0;
    const report = reports.find((notice) => notice.paymentId === milestone.id) ?? null;
    const dueDate = invoice?.dueDate ?? milestone.dueDate;
    // Only an issued invoice is due or late; a milestone without one is still upcoming.
    const state = settled ? "paid"
      : pending.has(milestone.id) ? "received"
      : report?.status === "submitted" ? "checking"
      : received.cmp(0) > 0 ? "part_paid"
      : invoice ? (invoice.overdue ? "overdue" : "due") : "upcoming";
    return {
      id: milestone.id, title: milestone.title, amount: show(milestone.amount), paid: show(received.toFixed(4)),
      left: show(settled ? "0" : Dec.of(milestone.amount).sub(received).toFixed(4)), dueDate,
      status: state as "paid" | "received" | "checking" | "part_paid" | "overdue" | "due" | "upcoming",
      invoice: invoice ? { id: invoice.id, number: invoice.number, issueDate: invoice.issueDate } : null,
      receipts: receipts.filter((receipt) => receipt.paymentId === milestone.id).map((receipt) => ({ id: receipt.id, amount: show(receipt.amount), receivedOn: receipt.receivedOn || null })),
      // A pay link only when one exists and something is still owed.
      payUrl: !settled && milestone.payUrl && /^https:\/\//.test(milestone.payUrl) ? milestone.payUrl : null,
      report: report ? { id: report.id, status: report.status, paidOn: report.paidOn, reference: report.reference, amount: show(report.amount), at: report.at,
        // Why finance couldn't find it is written for the client.
        reason: report.status === "not_received" ? report.reason : "", files: proofs.get(`payment:${report.id}`) ?? [] } : null,
      // Something to pay and nothing being checked: the client can say they've paid.
      canReport: !settled && !pending.has(milestone.id) && report?.status !== "submitted" && Boolean(invoice || milestone.dueDate),
    };
  });
  const order = (status: string) => (status === "overdue" ? 0 : 1);
  // What's paid and what's left across the plan, exact to the cent; only when the tenant shows amounts.
  const sum = (pick: (item: (typeof list)[number]) => string | null) => list.reduce((total, item) => total.add(pick(item) ?? "0"), Dec.ZERO).toFixed(4);
  const totals = amounts ? { paid: sum((item) => item.paid), left: sum((item) => item.left) } : null;
  return { currency, showAmounts: amounts, totals, milestones: list.map((item, index) => ({ item, index })).sort((a, b) => order(a.item.status) - order(b.item.status) || a.index - b.index)
    .map(({ item }) => item) };
}

export type PortalPayments = Awaited<ReturnType<typeof readPayments>>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "I've paid": the client says when they paid a milestone, with the bank reference and proof (a photo or PDF). It is
 * their report, not a receipt: finance and the project's managers are told, check it against the bank, and record the
 * receipt or say it wasn't received. One open report per milestone.
 */
export async function reportPayment(ctx: DecisionContext, body: Record<string, unknown>) {
  const { grant, row } = await grantFor(ctx, body.caseId, "payments");
  const paymentId = typeof body.paymentId === "string" ? body.paymentId.slice(0, 80) : "";
  const milestone = (await milestones(ctx.db, ctx.workspaceId, row.caseId)).find((item) => item.id === paymentId);
  if (!milestone) throw new NotFoundException("This payment isn't on your plan any more.");
  const paidOn = typeof body.paidOn === "string" && DATE.test(body.paidOn) ? body.paidOn : "";
  if (!paidOn) throw new BadRequestException("Say when you paid.");
  if (paidOn > ctx.today) throw new BadRequestException("The payment date can't be in the future.");
  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  if (reference.length > 120) throw new BadRequestException("Keep the reference under 120 characters.");
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > 1000) throw new BadRequestException("Keep the note under 1000 characters.");
  let amount: string | null = null;
  if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
    const raw = String(body.amount).trim();
    if (!/^\d{1,14}(\.\d{1,4})?$/.test(raw) || Dec.of(raw).cmp(0) <= 0) throw new BadRequestException("Enter the amount you paid.");
    amount = raw;
  }
  const files = await ownUploads(ctx.db, ctx.workspaceId, ctx.contact, row.caseId, body.uploadIds, 5);
  if (!reference && !files.length) throw new BadRequestException("Add the bank reference or a photo of the receipt.");
  await ctx.db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`portal-payment:${ctx.workspaceId}:${row.caseId}:${paymentId}`]);
  const paid = (await readMilestonePaid(ctx.db, ctx.workspaceId, [{ caseId: row.caseId, paymentId }])).get(`${row.caseId}|${paymentId}`) ?? Dec.ZERO;
  if (paid.cmp(milestone.amount) >= 0) throw new ConflictException("This payment is already received. Thank you.");
  const open = (await ctx.db.query(`SELECT 1 FROM client_portal_payment_notices WHERE workspace_id = $1 AND case_id = $2 AND payment_id = $3 AND status = 'submitted'`,
    [ctx.workspaceId, row.caseId, paymentId])).rowCount;
  if (open) throw new ConflictException("Your team is already checking a payment you reported on this. You'll hear back soon.");
  const id = randomUUID();
  const currency = milestone.currency ?? row.currency;
  await ctx.db.query(
    `INSERT INTO client_portal_payment_notices (workspace_id, id, case_id, payment_id, grant_id, amount, currency, paid_on, reference, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [ctx.workspaceId, id, row.caseId, paymentId, grant.id, amount, currency, paidOn, reference, note]);
  await attach(ctx.db, ctx.workspaceId, { caseId: row.caseId, grantId: grant.id, kind: "payment", targetId: id, files });
  const facts = await caseTitle(ctx.db, ctx.workspaceId, row.caseId);
  await tellStaff(ctx.db, { workspaceId: ctx.workspaceId, recipients: await caseTeam(ctx.db, ctx.workspaceId, row.caseId, ["finance", "managers"]), code: "payment.client_reported",
    variables: { title: facts.title, clientName: facts.clientName, actor: grant.name, milestone: milestone.title, amount: `${currency ?? ""} ${amount ?? milestone.amount}`.trim(),
      paidOn, reference: reference || "—", note: note.slice(0, 480) },
    deepLink: `/workspace/pre-projects/cases/${row.caseId}/payment-plan?payment=${encodeURIComponent(paymentId)}`, key: id, email: true });
  return { ok: true, reportId: id, entity: { type: "pre_project_case", id: row.caseId }, audit: { paymentId, reportId: id, paidOn, files: files.length } };
}

/** A tax invoice as the client may print it: theirs, as issued, with what's paid on it. Nothing internal (who issued it). */
export async function invoiceDocument(db: Db, workspaceId: string, row: CaseRow, invoiceId: string, today: string) {
  if (!UUID.test(invoiceId) || !row.projectId) throw new NotFoundException("Invoice not found.");
  const invoice = (await withBalances(db, workspaceId, await readInvoices(db, workspaceId, { id: invoiceId }), today))[0];
  if (!invoice || invoice.caseId !== row.caseId || invoice.projectId !== row.projectId) throw new NotFoundException("Invoice not found.");
  return {
    number: invoice.number, issueDate: invoice.issueDate, dueDate: invoice.dueDate, currency: invoice.currency, milestone: invoice.milestoneTitle, reference: invoice.projectReference,
    company: { name: invoice.companyName, address: invoice.companyAddress, taxNumber: invoice.companyTaxNumber },
    customer: { name: invoice.customerName, address: invoice.customerAddress, taxNumber: invoice.customerTaxNumber },
    lines: (await readInvoiceLines(db, workspaceId, invoice.id)).map((line) => ({ description: line.description, taxRate: line.taxRate, net: line.net, tax: line.tax, total: line.total })),
    net: invoice.net, tax: invoice.tax, total: invoice.total, paid: invoice.paid, balance: invoice.balance, note: invoice.note,
    status: (invoice.status === "credited" ? "credited" : Dec.of(invoice.balance).cmp(0) <= 0 ? "paid" : invoice.overdue ? "overdue" : "due") as "credited" | "paid" | "overdue" | "due",
    credit: invoice.status === "credited" ? { number: invoice.creditNoteNumber, on: invoice.creditedOn } : null,
  };
}

/** A receipt as the client may print it: a payment finance verified on one of their milestones. */
export async function receiptDocument(db: Db, workspaceId: string, row: CaseRow, receiptId: string) {
  const receipt = (await db.query<{ id: string; paymentId: string; title: string; amount: string; currency: string; receivedOn: string | null }>(
    `SELECT receipt.id, receipt.payment_id AS "paymentId", payment.title, allocation.amount::text AS amount, receipt.currency,
            left(coalesce(receipt.detail->>'verifiedAt', receipt.detail->>'reportedAt', ''), 10) AS "receivedOn"
       FROM commercial_receipts receipt
       JOIN commercial_allocations allocation ON allocation.workspace_id = receipt.workspace_id AND allocation.case_id = receipt.case_id AND allocation.receipt_id = receipt.id
        AND allocation.detail->>'reversedAt' IS NULL
       JOIN commercial_payments payment ON payment.workspace_id = receipt.workspace_id AND payment.case_id = receipt.case_id AND payment.id = receipt.payment_id
      WHERE receipt.workspace_id = $1 AND receipt.case_id = $2 AND receipt.id = $3 AND receipt.status = 'finance_verified' LIMIT 1`,
    [workspaceId, row.caseId, receiptId.slice(0, 80)])).rows[0];
  if (!receipt) throw new NotFoundException("Receipt not found.");
  const invoice = row.projectId ? (await readInvoices(db, workspaceId, { projectId: row.projectId })).find((item) => item.paymentId === receipt.paymentId && item.status === "issued") : undefined;
  const company = (await db.query<{ name: string }>(
    `SELECT coalesce(branding.display_name, workspace.name) AS name FROM workspaces workspace LEFT JOIN tenant_login_branding branding ON branding.workspace_id = workspace.id
      WHERE workspace.id = $1`, [workspaceId])).rows[0]?.name ?? "";
  return { id: receipt.id, milestone: receipt.title, amount: receipt.amount, currency: receipt.currency, receivedOn: receipt.receivedOn || null,
    invoiceNumber: invoice?.number ?? null, company: invoice?.companyName || company, customer: invoice?.customerName ?? null };
}

// ---------- the team's side ----------

export type StaffNotice = Notice & { caseId: string; grantName: string; milestone: string | null; currency: string | null; files: ClientFile[]; decidedBy: string | null;
  decidedAt: string | null; version: number };

/** The payments clients reported on a case (newest first), with their proof, for finance on the case's payments. */
export async function readCaseNotices(db: Db, workspaceId: string, caseId: string): Promise<StaffNotice[]> {
  const rows = (await db.query<Omit<StaffNotice, "files">>(
    `SELECT notice.id, notice.case_id AS "caseId", notice.payment_id AS "paymentId", notice.status, notice.paid_on::text AS "paidOn", notice.reference,
            notice.amount::text AS amount, notice.currency, notice.note, notice.decision_note AS reason, notice.created_at AS at, notice.version,
            coalesce(grant_row.confirmed_name, grant_row.name) AS "grantName", payment.title AS milestone, person.display_name AS "decidedBy", notice.decided_at AS "decidedAt"
       FROM client_portal_payment_notices notice
       JOIN client_portal_grants grant_row ON grant_row.workspace_id = notice.workspace_id AND grant_row.id = notice.grant_id
       LEFT JOIN commercial_payments payment ON payment.workspace_id = notice.workspace_id AND payment.case_id = notice.case_id AND payment.id = notice.payment_id
       LEFT JOIN users person ON person.id = notice.decided_by
      WHERE notice.workspace_id = $1 AND notice.case_id = $2 ORDER BY notice.created_at DESC`, [workspaceId, caseId])).rows;
  const proofs = await readAttachments(db, workspaceId, caseId, ["payment"]);
  return rows.map((row) => ({ ...row, at: new Date(row.at).toISOString(), decidedAt: row.decidedAt ? new Date(row.decidedAt).toISOString() : null,
    files: proofs.get(`payment:${row.id}`) ?? [] }));
}

/**
 * Finance closes a client's payment report: "recorded" once the receipt is in the ledger (the milestone has a receipt),
 * or "not received" with a reason the client reads. Version-checked; the client is told by email.
 */
export async function decideNotice(db: Db, workspaceId: string, userId: string, noticeId: string, body: Record<string, unknown>) {
  if (!UUID.test(noticeId)) throw new NotFoundException("Payment report not found.");
  const notice = (await db.query<{ caseId: string; paymentId: string; status: string; version: number; title: string | null }>(
    `SELECT notice.case_id AS "caseId", notice.payment_id AS "paymentId", notice.status, notice.version, payment.title
       FROM client_portal_payment_notices notice
       LEFT JOIN commercial_payments payment ON payment.workspace_id = notice.workspace_id AND payment.case_id = notice.case_id AND payment.id = notice.payment_id
      WHERE notice.workspace_id = $1 AND notice.id = $2 FOR UPDATE OF notice`, [workspaceId, noticeId])).rows[0];
  if (!notice) throw new NotFoundException("Payment report not found.");
  const decision = body.decision === "recorded" || body.decision === "not_received" ? body.decision : null;
  if (!decision) throw new BadRequestException("Say whether the payment was recorded or not received.");
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > 1000) throw new BadRequestException("Keep the note under 1000 characters.");
  if (notice.status === decision) return { caseId: notice.caseId, changed: false };
  if (notice.status !== "submitted") throw new ConflictException("Someone already closed this report. Reload to see it.");
  if (body.version !== notice.version) throw new ConflictException("This report changed. Reload to see it.");
  if (decision === "not_received" && !note) throw new BadRequestException("Tell the client why: what couldn't be found.");
  if (decision === "recorded" && !(await db.query(`SELECT 1 FROM commercial_receipts WHERE workspace_id = $1 AND case_id = $2 AND payment_id = $3 AND status <> 'rejected'`,
    [workspaceId, notice.caseId, notice.paymentId])).rowCount)
    throw new ConflictException("Record the receipt on this milestone first, then mark the report as recorded.");
  await db.query(`UPDATE client_portal_payment_notices SET status = $3, decision_note = $4, decided_by = $5, decided_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, noticeId, decision, note, userId]);
  await tellClients(db, { workspaceId, caseId: notice.caseId, event: "payment_checked", recordId: `payment:${noticeId}`, title: notice.title ?? "",
    note: decision === "recorded" ? `We received your payment for ${notice.title ?? "your milestone"}. Thank you.`
      : `We couldn't find your payment for ${notice.title ?? "your milestone"} yet: ${note}` });
  return { caseId: notice.caseId, changed: true };
}
