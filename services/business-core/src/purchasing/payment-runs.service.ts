import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp } from "../notifications/default-templates";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { currencyDecimals, firstTime } from "./orders";
import { lockSuppliers, readBills, type BillRow } from "./payables";
import { bankFile, readRunItems, readRuns, readSupplierBanks, runPayments, runReference, type PaymentRunRow, type RunItem, type SupplierBank } from "./payment-runs";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^\d{1,14}(\.\d{1,4})?$/;
const ACTIONS = ["save", "submit", "approve", "return", "paid", "cancel"] as const;
const OPEN = ["draft", "submitted", "approved"];

/**
 * Payment runs: someone who pays suppliers lists approved invoices and how much of each to pay; someone
 * else — neither who prepared it nor who started it — approves it before the money goes out; then it's
 * marked paid, which records one bank payment per supplier, company and currency into the account approved
 * with the run, allocated exactly as the run says. A submitted or approved run reserves what it pays;
 * everything is checked again at approval and when it's paid.
 */
@Injectable()
export class PaymentRunsService {
  constructor(private readonly access: WorkspaceAccessService) {}

  run(actor: RequestActor, workspaceId: string, runId: string) {
    return this.access.withPermission(actor, workspaceId, "payables.view", async (client, user) => this.detail(client, workspaceId, runId, user.userId));
  }

  command(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    const action = body.action as (typeof ACTIONS)[number];
    if (!ACTIONS.includes(action)) throw new BadRequestException("Unknown action.");
    return this.access.withAnyPermission(actor, workspaceId, ["payables.manage", "payables.approve"], async (client, user) => {
      const commandId = uuid(body.commandId, "Command");
      const id = uuid(body.id, "Payment run");
      if (!(await firstTime(client, workspaceId, commandId, id, `payables_run_${action}`, user.userId))) return this.detail(client, workspaceId, id, user.userId);
      const can = (code: string) => this.access.hasPermission(client, workspaceId, user.userId, code);
      const need = async (code: string, message: string) => { if (!(await can(code))) throw new ForbiddenException(message); };
      if (action === "save") { await need("payables.manage", "You can't prepare payment runs."); await this.save(client, workspaceId, user.userId, id, body); }
      else if (action === "submit") { await need("payables.manage", "You can't prepare payment runs."); await this.submit(client, workspaceId, user.userId, id, body); }
      else if (action === "approve") { await need("payables.approve", "You can't approve payment runs."); await this.approve(client, workspaceId, user.userId, id, body); }
      else if (action === "return") { await need("payables.approve", "You can't approve payment runs."); await this.sendBack(client, workspaceId, user.userId, id, body); }
      else if (action === "paid") { await need("payables.manage", "You can't record payments to suppliers."); await this.markPaid(client, workspaceId, user.userId, id, body); }
      else await this.cancel(client, workspaceId, user.userId, id, body);
      return this.detail(client, workspaceId, id, user.userId);
    });
  }

  /**
   * An approved run's file for the bank: one row per payment into the account approved with the run. The
   * whole account number only for people who verify bank details. Every download is audited.
   */
  file(actor: RequestActor, workspaceId: string, runId: string) {
    return this.access.withPermission(actor, workspaceId, "payables.manage", async (client, user) => {
      const run = (await readRuns(client, workspaceId, { id: uuid(runId, "Payment run") }))[0];
      if (!run) throw new NotFoundException("Payment run not found.");
      if (run.status !== "approved") throw new ConflictException("Only an approved run goes to the bank.");
      const items = await readRunItems(client, workspaceId, runId);
      const accounts = await this.checkBanks(client, workspaceId, items, true);
      const full = await this.access.hasPermission(client, workspaceId, user.userId, "vendors.approve");
      const body = bankFile(runPayments(items).map((payment) => {
        const account = accounts.get(payment.vendorId)!;
        return { supplier: payment.supplierName, accountName: account.accountName, bank: account.bankName, accountNumber: account.accountNumber, swift: account.swift,
          amount: payment.amount, currency: payment.currency, reference: runReference(run.number, payment.invoices.map((invoice) => invoice.number)) };
      }), full);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "payment_run.exported", entityType: "payment_run", entityId: runId, after: { fullNumbers: full } });
      return { body, fileName: `payment-run-${run.number}.csv` };
    });
  }

  // ---------- commands ----------

  /** A draft run, started or changed: its invoices and how much of each, never more than each can be paid now. */
  private async save(client: Db, workspaceId: string, userId: string, id: string, body: Record<string, unknown>) {
    const existing = (await client.query<{ status: string; version: number }>(`SELECT status, version FROM payment_runs WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, id])).rows[0];
    if (existing) {
      if (existing.status !== "draft") throw new ConflictException("Only a draft run changes.");
      if (body.version !== existing.version) throw new ConflictException("Someone else changed this run. Reload to see their changes.");
    }
    const note = text(body.note, 500, "Note");
    if (!Array.isArray(body.items) || !body.items.length) throw new BadRequestException("Choose the invoices to pay.");
    if (body.items.length > 500) throw new BadRequestException("A run pays up to 500 invoices.");
    const items: Array<{ invoiceId: string; amount: string }> = [];
    for (const raw of body.items as Array<Record<string, unknown>>) {
      const invoiceId = uuid(raw?.invoiceId, "Invoice");
      if (items.some((item) => item.invoiceId === invoiceId)) throw new BadRequestException("Each invoice is in a run once.");
      const bill = (await readBills(client, workspaceId, { id: invoiceId }))[0];
      if (!bill) throw new NotFoundException("Invoice not found.");
      const amount = money(raw.amount, `Amount for ${bill.number}`, bill.currency);
      checkItem(bill, amount, "0");
      items.push({ invoiceId, amount });
    }
    if (existing) {
      await client.query(`UPDATE payment_runs SET note = $3, prepared_by = $4, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, note, userId]);
      await client.query(`DELETE FROM payment_run_items WHERE workspace_id = $1 AND run_id = $2`, [workspaceId, id]);
    } else {
      // Runs are numbered across the workspace, one at a time.
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('payment_runs:' || $1::text, 0))`, [workspaceId]);
      const number = (await client.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM payment_runs WHERE workspace_id = $1`, [workspaceId])).rows[0].next;
      await client.query(`INSERT INTO payment_runs (id, workspace_id, number, note, created_by, prepared_by) VALUES ($1, $2, $3, $4, $5, $5)`, [id, workspaceId, number, note, userId]);
    }
    for (const item of items)
      await client.query(`INSERT INTO payment_run_items (id, workspace_id, run_id, invoice_id, amount) VALUES ($1, $2, $3, $4, $5)`, [randomUUID(), workspaceId, id, item.invoiceId, item.amount]);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: existing ? "payment_run.changed" : "payment_run.prepared", entityType: "payment_run", entityId: id, after: { note, items } });
  }

  /** A draft goes for approval; from now on it reserves what it pays. The approvers are told. */
  private async submit(client: Db, workspaceId: string, userId: string, id: string, body: Record<string, unknown>) {
    const run = await this.lockRun(client, workspaceId, id, body.version);
    if (run.status !== "draft") throw new ConflictException("Only a draft run is submitted.");
    const items = await this.checkItems(client, workspaceId, run);
    await this.checkBanks(client, workspaceId, items, false);
    await client.query(`UPDATE payment_runs SET status = 'submitted', submitted_at = now(), prepared_by = $3, return_note = NULL, version = version + 1 WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, id, userId]);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "payment_run.submitted", entityType: "payment_run", entityId: id, after: { totals: run.totals } });
    const actor = await this.name(client, userId);
    for (const person of new Set((await this.holders(client, workspaceId, "payables.approve")).filter((person) => person !== userId && person !== run.createdBy)))
      await notifyUserInApp(client, { workspaceId, recipientUserId: person, code: "payables.run_submitted", eventType: "payables.run_submitted",
        variables: { run: String(run.number), amount: amountText(run), actor, note: run.note }, deepLink: `/workspace/finance/runs?run=${id}`,
        idempotencyKey: `payables.run_submitted:${id}:${run.version + 1}:${person}` });
  }

  /**
   * Approved by someone other than who prepared or started it, after checking everything again: each
   * invoice can still be paid this much, and each supplier has an approved bank account with no new details
   * waiting. The account is fixed with the run; the money goes into that one only.
   */
  private async approve(client: Db, workspaceId: string, userId: string, id: string, body: Record<string, unknown>) {
    const run = await this.lockRun(client, workspaceId, id, body.version);
    if (run.status !== "submitted") throw new ConflictException("Only a submitted run is approved.");
    if (userId === run.preparedBy || userId === run.createdBy) throw new ForbiddenException("Someone other than who prepared the run approves it.");
    const items = await this.checkItems(client, workspaceId, run);
    const banks = await this.checkBanks(client, workspaceId, items, false);
    for (const [vendorId, account] of banks)
      await client.query(`UPDATE payment_run_items item SET bank_account_id = $4 FROM supplier_invoices bill
                           WHERE item.workspace_id = $1 AND item.run_id = $2 AND bill.workspace_id = item.workspace_id AND bill.id = item.invoice_id AND bill.vendor_id = $3`,
        [workspaceId, id, vendorId, account.id]);
    await client.query(`UPDATE payment_runs SET status = 'approved', approved_by = $3, approved_at = now(), version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, userId]);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "payment_run.approved", entityType: "payment_run", entityId: id,
      after: { totals: run.totals, accounts: Object.fromEntries([...banks].map(([vendorId, account]) => [vendorId, account.id])) } });
    await this.tellPreparer(client, workspaceId, run, userId, "payables.run_approved", "");
  }

  /** Sent back to draft with why, by someone who approves runs (not who prepared it); it stops reserving. */
  private async sendBack(client: Db, workspaceId: string, userId: string, id: string, body: Record<string, unknown>) {
    const run = await this.lockRun(client, workspaceId, id, body.version);
    if (!["submitted", "approved"].includes(run.status)) throw new ConflictException("Only a submitted or approved run is sent back.");
    if (userId === run.preparedBy || userId === run.createdBy) throw new ForbiddenException("Someone other than who prepared the run sends it back.");
    const note = text(body.note, 1000, "Note");
    if (!note) throw new BadRequestException("Say why it's sent back.");
    await client.query(`UPDATE payment_runs SET status = 'draft', submitted_at = NULL, approved_by = NULL, approved_at = NULL, return_note = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, id, note]);
    // The account is fixed again when it's next approved.
    await client.query(`UPDATE payment_run_items SET bank_account_id = NULL WHERE workspace_id = $1 AND run_id = $2`, [workspaceId, id]);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "payment_run.returned", entityType: "payment_run", entityId: id, before: { status: run.status }, after: { note } });
    await this.tellPreparer(client, workspaceId, run, userId, "payables.run_returned", note);
  }

  /**
   * The money went out: one bank payment per supplier, company and currency, each with its reference, into
   * the account approved with the run, allocated to its invoices exactly as the run says — all at once,
   * after checking everything again.
   */
  private async markPaid(client: Db, workspaceId: string, userId: string, id: string, body: Record<string, unknown>) {
    const run = await this.lockRun(client, workspaceId, id, body.version);
    if (run.status !== "approved") throw new ConflictException("Only an approved run is paid.");
    const paidOn = date(body.paidOn, "Paid on");
    const today = (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`,
      [workspaceId])).rows[0].today;
    if (paidOn > today) throw new BadRequestException("Mark a run paid once the money went out.");
    const items = await this.checkItems(client, workspaceId, run);
    await this.checkBanks(client, workspaceId, items, true);
    const payments = runPayments(items);
    const given = new Map((Array.isArray(body.references) ? body.references as Array<Record<string, unknown>> : [])
      .map((item) => [`${item?.vendorId}|${item?.legalEntityId}|${item?.currency}`, item?.reference]));
    const references = new Map<string, string>();
    for (const payment of payments) {
      const reference = text(given.get(payment.key), 120, "Reference");
      if (!reference) throw new BadRequestException(`Enter the bank's reference for ${payment.supplierName}.`);
      const taken = [...references].some(([key, value]) => key.startsWith(`${payment.vendorId}|`) && value.toLowerCase() === reference.toLowerCase())
        || Boolean((await client.query(`SELECT 1 FROM supplier_payments WHERE workspace_id = $1 AND vendor_id = $2 AND lower(btrim(reference)) = lower($3) AND status = 'recorded'`,
          [workspaceId, payment.vendorId, reference])).rowCount);
      if (taken) throw new ConflictException(`A payment with reference ${reference} is already recorded for ${payment.supplierName}.`);
      references.set(payment.key, reference);
    }
    const account = new Map(items.map((item) => [item.bill.vendorId, item.bankAccountId]));
    for (const payment of payments) {
      const paymentId = randomUUID();
      await client.query(
        `INSERT INTO supplier_payments (id, workspace_id, vendor_id, legal_entity_id, paid_on, currency, amount, method, reference, bank_account_id, run_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'bank', $8, $9, $10, $11)`,
        [paymentId, workspaceId, payment.vendorId, payment.legalEntityId, paidOn, payment.currency, payment.amount, references.get(payment.key), account.get(payment.vendorId), id, userId]);
      for (const invoice of payment.invoices)
        await client.query(`INSERT INTO supplier_payment_allocations (id, workspace_id, payment_id, invoice_id, amount, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
          [randomUUID(), workspaceId, paymentId, invoice.invoiceId, invoice.amount, userId]);
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "supplier_payment.recorded", entityType: "supplier_payment", entityId: paymentId,
        after: { vendorId: payment.vendorId, legalEntityId: payment.legalEntityId, currency: payment.currency, paidOn, amount: payment.amount, method: "bank",
          reference: references.get(payment.key), runId: id, allocations: payment.invoices.map(({ invoiceId, amount }) => ({ invoiceId, amount })) } });
    }
    await client.query(`UPDATE payment_runs SET status = 'paid', paid_by = $3, paid_at = now(), paid_on = $4, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, userId, paidOn]);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "payment_run.paid", entityType: "payment_run", entityId: id, after: { paidOn, payments: payments.length, totals: run.totals } });
    await this.tellPreparer(client, workspaceId, run, userId, "payables.run_paid", paidOn);
  }

  /** Cancelled with why before it's paid; it stops reserving. */
  private async cancel(client: Db, workspaceId: string, userId: string, id: string, body: Record<string, unknown>) {
    const run = await this.lockRun(client, workspaceId, id, body.version);
    if (!OPEN.includes(run.status)) throw new ConflictException(run.status === "paid" ? "A paid run isn't cancelled; reverse its payments instead." : "This run is already cancelled.");
    const reason = text(body.reason, 500, "Reason");
    if (!reason) throw new BadRequestException("Say why it's cancelled.");
    await client.query(`UPDATE payment_runs SET status = 'cancelled', cancel_reason = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, reason]);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "payment_run.cancelled", entityType: "payment_run", entityId: id, before: { status: run.status }, after: { reason } });
  }

  // ---------- reads ----------

  private async detail(client: Db, workspaceId: string, runId: string, userId: string) {
    const run = (await readRuns(client, workspaceId, { id: runId }))[0];
    if (!run) throw new NotFoundException("Payment run not found.");
    const items = await readRunItems(client, workspaceId, runId);
    const banks = await readSupplierBanks(client, workspaceId, items.map((item) => item.bill.vendorId));
    const paid = new Map((await client.query<{ key: string; id: string; reference: string; status: string }>(
      `SELECT vendor_id || '|' || legal_entity_id || '|' || currency AS key, id, reference, status FROM supplier_payments WHERE workspace_id = $1 AND run_id = $2`, [workspaceId, runId])).rows
      .map((row) => [row.key, row]));
    const canManage = await this.access.hasPermission(client, workspaceId, userId, "payables.manage");
    const canApprove = await this.access.hasPermission(client, workspaceId, userId, "payables.approve");
    const someoneElse = userId !== run.preparedBy && userId !== run.createdBy;
    return {
      run,
      items: items.map(({ id, invoiceId, amount, bill }) => ({ id, invoiceId, amount, number: bill.number, vendorId: bill.vendorId, supplierName: bill.supplierName, legalEntityId: bill.legalEntityId,
        companyName: bill.companyName, currency: bill.currency, invoiceDate: bill.invoiceDate, dueDate: bill.dueDate, status: bill.status, payable: bill.payable,
        // What it could take in this run: what it can be paid now, plus what this run itself reserves.
        available: bill.status !== "approved" ? "0.0000" : Dec.of(bill.payable).add(["submitted", "approved"].includes(run.status) ? amount : "0").toFixed(4) })),
      payments: runPayments(items).map((payment) => {
        const bank = banks.get(payment.vendorId);
        const fixed = items.find((item) => item.bill.vendorId === payment.vendorId)?.bankAccountId ?? null;
        const recorded = paid.get(payment.key);
        return { ...payment, reference: recorded?.reference ?? runReference(run.number, payment.invoices.map((invoice) => invoice.number)), paymentId: recorded?.id ?? null,
          bank: bank?.approved ? { bankName: bank.approved.bankName, last4: bank.approved.accountNumber.replace(/\s+/g, "").slice(-4) } : null,
          bankChangePending: bank?.pending ?? false,
          // Approved into one account, and the supplier's approved account is another one now.
          bankChanged: run.status === "approved" && fixed !== null && fixed !== (bank?.approved?.id ?? null) };
      }),
      canManage, canApprove,
      canEdit: canManage && run.status === "draft",
      canApproveThis: canApprove && run.status === "submitted" && someoneElse,
      canReturn: canApprove && ["submitted", "approved"].includes(run.status) && someoneElse,
      canPay: canManage && run.status === "approved",
      canDownload: canManage && run.status === "approved",
      canCancel: (canManage || canApprove) && OPEN.includes(run.status),
    };
  }

  // ---------- helpers ----------

  private async lockRun(client: Db, workspaceId: string, id: string, version: unknown): Promise<PaymentRunRow> {
    await client.query(`SELECT 1 FROM payment_runs WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, id]);
    const run = (await readRuns(client, workspaceId, { id }))[0];
    if (!run) throw new NotFoundException("Payment run not found.");
    if (version !== run.version) throw new ConflictException("Someone else changed this run. Reload to see their changes.");
    return run;
  }

  /**
   * Locks the run's suppliers (in one stable order) and checks each invoice again under the locks: still
   * approved, and no more than it can be paid now plus what this run itself reserves.
   */
  private async checkItems(client: Db, workspaceId: string, run: PaymentRunRow) {
    const listed = await readRunItems(client, workspaceId, run.id);
    if (!listed.length) throw new BadRequestException("Choose the invoices to pay.");
    await lockSuppliers(client, workspaceId, listed.map((item) => item.bill.vendorId));
    const items = await readRunItems(client, workspaceId, run.id);
    const reserving = ["submitted", "approved"].includes(run.status);
    for (const item of items) checkItem(item.bill, item.amount, reserving ? item.amount : "0");
    return items;
  }

  /**
   * Each supplier in the run is paid by bank into an approved account, and none has new bank details
   * waiting. Once the run is approved (`fixed`), the account approved with it must still be the one.
   */
  private async checkBanks(client: Db, workspaceId: string, items: RunItem[], fixed: boolean) {
    const banks = await readSupplierBanks(client, workspaceId, items.map((item) => item.bill.vendorId));
    const accounts = new Map<string, NonNullable<SupplierBank["approved"]>>();
    for (const item of items) {
      if (accounts.has(item.bill.vendorId)) continue;
      const bank = banks.get(item.bill.vendorId);
      if (bank?.pending) throw new ConflictException(`New bank details for ${item.bill.supplierName} are waiting for approval; decide them first.`);
      if (!bank?.approved) throw new ConflictException(`${item.bill.supplierName} has no approved bank account.`);
      if (fixed && item.bankAccountId !== bank.approved.id) throw new ConflictException(`${item.bill.supplierName}'s bank account changed since the run was approved; send it back.`);
      accounts.set(item.bill.vendorId, bank.approved);
    }
    return accounts;
  }

  private async tellPreparer(client: Db, workspaceId: string, run: PaymentRunRow, userId: string, code: string, note: string) {
    if (run.preparedBy === userId) return;
    await notifyUserInApp(client, { workspaceId, recipientUserId: run.preparedBy, code, eventType: code,
      variables: { run: String(run.number), amount: amountText(run), actor: await this.name(client, userId), note: note.slice(0, 480) }, deepLink: `/workspace/finance/runs?run=${run.id}`,
      idempotencyKey: `${code}:${run.id}:${run.version + 1}` });
  }

  private async name(client: Db, userId: string) {
    return (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [userId])).rows[0]?.name ?? "Someone";
  }

  private async holders(client: Db, workspaceId: string, code: string) {
    return (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
         JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
         JOIN role_permissions granted ON granted.role_id = effective_role.role_id
         JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = $2
        WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId, code])).rows.map((row) => row.userId);
  }
}

/** An invoice can be paid this much in a run: it's approved, and it's no more than it can be paid now plus what the run itself reserves on it. */
function checkItem(bill: BillRow, amount: string, own: string) {
  if (bill.status === "cancelled") throw new ConflictException(`Invoice ${bill.number} was cancelled; take it out of the run.`);
  if (bill.status !== "approved") throw new ConflictException(`Invoice ${bill.number} isn't approved.`);
  if (Dec.of(amount).cmp(0) <= 0) throw new BadRequestException(`Enter what's paid on ${bill.number}.`);
  const available = Dec.of(bill.payable).add(own);
  if (Dec.of(amount).cmp(available) > 0) throw new ConflictException(`Invoice ${bill.number} has ${(available.isNegative() ? Dec.ZERO : available).toFixed(currencyDecimals(bill.currency))} to pay now.`);
}

/** A run's total per currency ("AED 1,050.00 + USD 20.00"). */
function amountText(run: PaymentRunRow) {
  return run.totals.map((total) => `${total.currency} ${Dec.of(total.amount).toFixed(currencyDecimals(total.currency))}`).join(" + ");
}

function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} is not valid.`);
  return value;
}

function text(value: unknown, max: number, label: string) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new BadRequestException(`${label} is not valid.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new BadRequestException(`${label} is too long (up to ${max} characters).`);
  return trimmed;
}

/** An amount of money in the currency's own minor units (no more decimals than it uses). */
function money(value: unknown, label: string, currency: string) {
  const textValue = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!NUMBER.test(textValue)) throw new BadRequestException(`${label} must be a number with up to 4 decimals.`);
  if (Dec.of(textValue).round(currencyDecimals(currency)).cmp(textValue) !== 0) throw new BadRequestException(`${label} has more decimals than ${currency} uses.`);
  return textValue;
}

function date(value: unknown, label: string) {
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} must be a date.`);
  return value;
}
