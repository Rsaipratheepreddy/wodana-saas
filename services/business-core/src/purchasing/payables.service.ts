import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp } from "../notifications/default-templates";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { currencyDecimals, ensurePurchasingSettings, firstTime } from "./orders";
import {
  lockSuppliers, matchBill, priceBillLine, readBillLines, readBills, readDebitNotes, readInvoiceable, readPayments, readRetentions, readSupplierBalances, retentionByProject, type BillRow,
} from "./payables";
import { readRuns } from "./payment-runs";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^\d{1,14}(\.\d{1,4})?$/;
const CURRENCY = /^[A-Z]{3}$/;
export const PAYMENT_METHODS = ["bank", "cheque", "cash", "card", "other"] as const;
const ACTIONS = ["save", "submit", "approve", "cancel", "release", "pay", "allocate", "reverse"] as const;
/** Orders a supplier can invoice: placed ones (approved and on), including closed and cancelled ones that received goods. */
const UNPLACED = ["draft", "pending_approval"];

/**
 * Payables: suppliers' invoices entered against order lines and matched three ways (ordered, received,
 * invoiced), held for someone else's approval when they don't match, and paid — in full, in part, or in
 * advance on an order — never beyond what's payable now (what's owed, less retention held until handover
 * and what payment runs reserve). Every change to one supplier's money runs one at a time.
 */
@Injectable()
export class PayablesService {
  constructor(private readonly access: WorkspaceAccessService, @Optional() private readonly storage?: BrandAssetStorageService) {}

  overview(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "payables.view", async (client, user) => ({
      bills: await readBills(client, workspaceId),
      payments: await readPayments(client, workspaceId),
      suppliers: await readSupplierBalances(client, workspaceId),
      runs: await readRuns(client, workspaceId),
      runsRequired: (await ensurePurchasingSettings(client, workspaceId)).paymentRunsRequired,
      // Who an invoice or payment can be for, and which company it's to.
      vendors: (await client.query<{ id: string; name: string; currency: string | null }>(
        `SELECT id, display_name AS name, default_currency AS currency FROM workspace_vendors WHERE workspace_id = $1 AND status <> 'archived' ORDER BY display_name LIMIT 2000`, [workspaceId])).rows,
      companies: (await client.query<{ id: string; name: string; currency: string }>(
        `SELECT id, display_name AS name, base_currency AS currency FROM legal_entities WHERE workspace_id = $1 AND archived_at IS NULL ORDER BY display_name`, [workspaceId])).rows,
      ...(await this.rights(client, workspaceId, user.userId)),
    }));
  }

  bill(actor: RequestActor, workspaceId: string, billId: string) {
    return this.access.withPermission(actor, workspaceId, "payables.view", async (client, user) => this.billDetail(client, workspaceId, billId, user.userId));
  }

  supplier(actor: RequestActor, workspaceId: string, vendorId: string) {
    return this.access.withPermission(actor, workspaceId, "payables.view", async (client, user) => this.supplierDetail(client, workspaceId, vendorId, user.userId));
  }

  /** An order's lines as its supplier may still invoice them, to start an invoice from. */
  invoiceable(actor: RequestActor, workspaceId: string, orderId: string) {
    return this.access.withPermission(actor, workspaceId, "payables.view", async (client) => {
      const order = (await client.query<{ id: string; number: string; vendorId: string; legalEntityId: string; currency: string; status: string; creditDays: number | null }>(
        `SELECT id, number, vendor_id AS "vendorId", legal_entity_id AS "legalEntityId", currency, status, credit_days AS "creditDays" FROM purchase_orders WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, orderId])).rows[0];
      if (!order) throw new NotFoundException("Order not found.");
      return { order, lines: await readInvoiceable(client, workspaceId, orderId) };
    });
  }

  command(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    const action = body.action as (typeof ACTIONS)[number];
    if (!ACTIONS.includes(action)) throw new BadRequestException("Unknown action.");
    return this.access.withPermission(actor, workspaceId, action === "approve" || action === "release" ? "payables.approve" : "payables.manage", async (client, user) => {
      const commandId = uuid(body.commandId, "Command");
      const payment = ["pay", "allocate", "reverse"].includes(action);
      const entityId = uuid(payment ? (action === "pay" ? body.id : body.paymentId) : body.id, payment ? "Payment" : "Invoice");
      const view = () => payment ? this.paymentDetail(client, workspaceId, entityId, user.userId) : this.billDetail(client, workspaceId, entityId, user.userId);
      if (!(await firstTime(client, workspaceId, commandId, entityId, `payables_${action}`, user.userId))) return view();
      if (action === "save") await this.save(client, workspaceId, user.userId, entityId, body);
      else if (action === "submit") await this.submit(client, workspaceId, user.userId, entityId, body);
      else if (action === "approve") await this.approve(client, workspaceId, user.userId, entityId, body);
      else if (action === "cancel") await this.cancel(client, workspaceId, user.userId, entityId, body);
      else if (action === "release") await this.release(client, workspaceId, user.userId, entityId, body);
      else if (action === "pay") await this.pay(client, workspaceId, user.userId, entityId, body);
      else if (action === "allocate") await this.allocateMore(client, workspaceId, user.userId, entityId, body);
      else await this.reverse(client, workspaceId, user.userId, entityId, body);
      return view();
    });
  }

  /** The supplier's invoice document (a PDF or photo), while the invoice can still change or has none yet. */
  async uploadFile(actor: RequestActor, workspaceId: string, billId: string, file?: ReferenceUpload) {
    const prepared = await prepareReferenceUpload(file);
    if (!prepared.mimeType.startsWith("image/") && prepared.mimeType !== "application/pdf") throw new BadRequestException("Choose a PDF or a photo.");
    const storage = this.storage;
    if (!storage) throw new ConflictException("Files can't be stored here yet.");
    return this.access.withPermission(actor, workspaceId, "payables.manage", async (client, user) => {
      const bill = (await client.query<{ status: string; fileSha: string | null }>(
        `SELECT status, file_sha256 AS "fileSha" FROM supplier_invoices WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, uuid(billId, "Invoice")])).rows[0];
      if (!bill) throw new NotFoundException("Invoice not found.");
      if (bill.fileSha === prepared.digest) return this.billDetail(client, workspaceId, billId, user.userId);
      if (bill.status === "cancelled" || (bill.status === "approved" && bill.fileSha)) throw new ConflictException("The document of an approved or cancelled invoice doesn't change.");
      const key = `payables/${workspaceId}/${billId}/${prepared.digest}`;
      await storage.put(key, prepared.body, prepared.mimeType);
      await client.query(`UPDATE supplier_invoices SET file_name = $3, file_type = $4, file_key = $5, file_sha256 = $6, version = version + 1 WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, billId, prepared.name.slice(0, 255), prepared.mimeType, key, prepared.digest]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "supplier_invoice.document", entityType: "supplier_invoice", entityId: billId, after: { name: prepared.name, sha256: prepared.digest } });
      return this.billDetail(client, workspaceId, billId, user.userId);
    });
  }

  file(actor: RequestActor, workspaceId: string, billId: string) {
    return this.access.withPermission(actor, workspaceId, "payables.view", async (client) => {
      const row = (await client.query<{ key: string | null; type: string | null }>(`SELECT file_key AS key, file_type AS type FROM supplier_invoices WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, uuid(billId, "Invoice")])).rows[0];
      if (!row?.key || !row.type || !this.storage) throw new NotFoundException("Document not found.");
      const stored = await this.storage.read(row.key).catch(() => null);
      if (!stored) throw new NotFoundException("Document not found.");
      return { body: stored.body, contentType: row.type };
    });
  }

  // ---------- invoices ----------

  /** A draft invoice, entered or changed; changing a held one puts it back to draft. */
  private async save(client: Db, workspaceId: string, userId: string, id: string, body: Record<string, unknown>) {
    const vendorId = uuid(body.vendorId, "Supplier");
    await this.serialize(client, workspaceId, vendorId);
    const existing = (await client.query<{ status: string; version: number; vendorId: string }>(
      `SELECT status, version, vendor_id AS "vendorId" FROM supplier_invoices WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, id])).rows[0];
    if (existing) {
      if (existing.vendorId !== vendorId) await this.serialize(client, workspaceId, existing.vendorId);
      if (!["draft", "held"].includes(existing.status)) throw new ConflictException("An approved or cancelled invoice doesn't change; cancel it and enter it again.");
      if (body.version !== existing.version) throw new ConflictException("Someone else changed this invoice. Reload to see their changes.");
    }
    const legalEntityId = uuid(body.legalEntityId, "Company");
    if (!(await client.query(`SELECT 1 FROM workspace_vendors WHERE workspace_id = $1 AND id = $2`, [workspaceId, vendorId])).rowCount) throw new NotFoundException("Supplier not found.");
    if (!(await client.query(`SELECT 1 FROM legal_entities WHERE workspace_id = $1 AND id = $2`, [workspaceId, legalEntityId])).rowCount) throw new NotFoundException("Company not found.");
    const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";
    if (!CURRENCY.test(currency)) throw new BadRequestException("Choose the invoice's currency.");
    const number = text(body.number, 80, "Invoice number");
    if (!number) throw new BadRequestException("Enter the supplier's invoice number.");
    const today = await this.today(client, workspaceId);
    const invoiceDate = date(body.invoiceDate, "Invoice date");
    if (invoiceDate > today) throw new BadRequestException("An invoice date can't be in the future.");
    const dueDate = body.dueDate === undefined || body.dueDate === null || body.dueDate === "" ? null : date(body.dueDate, "Due date");
    if (dueDate && dueDate < invoiceDate) throw new BadRequestException("The due date can't be before the invoice date.");
    const statedTotal = body.statedTotal === undefined || body.statedTotal === null || body.statedTotal === "" ? null : money(body.statedTotal, "Invoice total", currency);
    const duplicate = (await client.query<{ id: string }>(
      `SELECT id FROM supplier_invoices WHERE workspace_id = $1 AND vendor_id = $2 AND lower(btrim(number)) = lower(btrim($3)) AND status <> 'cancelled' AND id <> $4`,
      [workspaceId, vendorId, number, id])).rows[0];
    if (duplicate) throw new ConflictException(`Invoice ${number} from this supplier is already entered.`);
    if (!Array.isArray(body.lines) || !body.lines.length) throw new BadRequestException("Add the invoice's lines.");
    if (body.lines.length > 200) throw new BadRequestException("An invoice has up to 200 lines.");
    const lines = [];
    for (const raw of body.lines as Array<Record<string, unknown>>) {
      const quantity = amount(raw?.quantity, "Quantity");
      if (Dec.of(quantity).cmp(0) <= 0) throw new BadRequestException("Each line needs a quantity above zero.");
      const unitPrice = amount(raw.unitPrice, "Price");
      const taxRate = amount(raw.taxRate ?? "0", "Tax rate");
      if (Dec.of(taxRate).cmp(100) > 0) throw new BadRequestException("A tax rate is at most 100%.");
      let orderLineId: string | null = null, projectId: string | null = null, description = text(raw.description, 500, "Description");
      if (raw.orderLineId) {
        orderLineId = uuid(raw.orderLineId, "Order line");
        const ordered = (await client.query<{ description: string; projectId: string | null; vendorId: string; legalEntityId: string; currency: string; status: string; number: string }>(
          `SELECT line.description, line.project_id AS "projectId", purchase.vendor_id AS "vendorId", purchase.legal_entity_id AS "legalEntityId", purchase.currency, purchase.status, purchase.number
             FROM purchase_order_lines line JOIN purchase_orders purchase ON purchase.workspace_id = line.workspace_id AND purchase.id = line.order_id
            WHERE line.workspace_id = $1 AND line.id = $2`, [workspaceId, orderLineId])).rows[0];
        if (!ordered) throw new NotFoundException("Order line not found.");
        if (ordered.vendorId !== vendorId) throw new BadRequestException(`${ordered.number} is another supplier's order.`);
        if (ordered.legalEntityId !== legalEntityId) throw new BadRequestException(`${ordered.number} was placed by another company.`);
        if (ordered.currency !== currency) throw new BadRequestException(`${ordered.number} is in ${ordered.currency}.`);
        if (UNPLACED.includes(ordered.status)) throw new ConflictException(`${ordered.number} isn't placed yet.`);
        description ||= ordered.description;
        projectId = ordered.projectId;
      } else {
        if (!description) throw new BadRequestException("Describe each line that isn't on an order.");
        if (raw.projectId) {
          projectId = uuid(raw.projectId, "Project");
          if (!(await client.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rowCount) throw new NotFoundException("Project not found.");
        }
      }
      lines.push({ orderLineId, projectId, description, quantity, unitPrice, taxRate, ...priceBillLine({ quantity, unitPrice, taxRate }, currency) });
    }
    const net = lines.reduce((sum, line) => sum.add(line.net), Dec.ZERO), tax = lines.reduce((sum, line) => sum.add(line.tax), Dec.ZERO);
    const values = [workspaceId, id, vendorId, legalEntityId, number, invoiceDate, dueDate, currency, net.toFixed(4), tax.toFixed(4), net.add(tax).toFixed(4), statedTotal];
    if (existing) {
      await client.query(
        `UPDATE supplier_invoices SET vendor_id = $3, legal_entity_id = $4, number = $5, invoice_date = $6, due_date = $7, currency = $8, net = $9, tax = $10, total = $11, stated_total = $12,
                status = 'draft', hold_reasons = '', version = version + 1 WHERE workspace_id = $1 AND id = $2`, values);
      await client.query(`DELETE FROM supplier_invoice_lines WHERE workspace_id = $1 AND invoice_id = $2`, [workspaceId, id]);
    } else {
      await client.query(
        `INSERT INTO supplier_invoices (workspace_id, id, vendor_id, legal_entity_id, number, invoice_date, due_date, currency, net, tax, total, stated_total, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`, [...values, userId]);
    }
    for (const [position, line] of lines.entries())
      await client.query(
        `INSERT INTO supplier_invoice_lines (id, workspace_id, invoice_id, position, order_line_id, project_id, description, quantity, unit_price, tax_rate, net, tax, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [randomUUID(), workspaceId, id, position, line.orderLineId, line.projectId, line.description, line.quantity, line.unitPrice, line.taxRate, line.net, line.tax, line.total]);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: existing ? "supplier_invoice.changed" : "supplier_invoice.entered", entityType: "supplier_invoice", entityId: id,
      after: { number, vendorId, legalEntityId, currency, invoiceDate, dueDate, statedTotal, total: net.add(tax).toFixed(4), lines: lines.length } });
  }

  /**
   * A draft goes for matching: approved at once when it matches its orders and receipts, else held with
   * why for someone else to approve. Advances paid on its orders are put against it once it's approved.
   */
  private async submit(client: Db, workspaceId: string, userId: string, id: string, body: Record<string, unknown>) {
    const bill = await this.lockBill(client, workspaceId, id, body.version);
    if (bill.status !== "draft") throw new ConflictException("Only a draft invoice is submitted.");
    if (!(await client.query(`SELECT 1 FROM supplier_invoice_lines WHERE workspace_id = $1 AND invoice_id = $2`, [workspaceId, id])).rowCount) throw new BadRequestException("Add the invoice's lines.");
    // Without a due date the order's credit days (else the supplier's) set it.
    const due = bill.dueDate ?? (await client.query<{ due: string | null }>(
      `SELECT ($3::date + coalesce(
                (SELECT max(purchase.credit_days) FROM supplier_invoice_lines line
                   JOIN purchase_order_lines ordered ON ordered.workspace_id = line.workspace_id AND ordered.id = line.order_line_id
                   JOIN purchase_orders purchase ON purchase.workspace_id = ordered.workspace_id AND purchase.id = ordered.order_id
                  WHERE line.workspace_id = $1 AND line.invoice_id = $2),
                (SELECT credit_days FROM workspace_vendors WHERE workspace_id = $1 AND id = $4)))::text AS due`,
      [workspaceId, id, bill.invoiceDate, bill.vendorId])).rows[0].due;
    const settings = await ensurePurchasingSettings(client, workspaceId);
    const reasons = await matchBill(client, workspaceId, { id, total: bill.total, statedTotal: bill.statedTotal, currency: bill.currency }, settings.invoiceTolerancePercent);
    let retention: Array<{ projectId: string | null; amount: string }> = [];
    if (!reasons.length) {
      await client.query(`UPDATE supplier_invoices SET status = 'approved', approved_at = now(), hold_reasons = '', due_date = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, id, due]);
      retention = await this.holdRetention(client, workspaceId, id, bill.currency);
      await this.applyAdvances(client, workspaceId, id, userId);
    } else {
      const holdReasons = reasons.join("\n").slice(0, 2000);
      await client.query(`UPDATE supplier_invoices SET status = 'held', hold_reasons = $3, due_date = $4, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, holdReasons, due]);
      const actor = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [userId])).rows[0]?.name ?? "Someone";
      const amount = `${bill.currency} ${Dec.of(bill.total).toFixed(currencyDecimals(bill.currency))}`;
      for (const person of new Set((await this.holders(client, workspaceId, ["payables.approve"])).filter((person) => person !== bill.createdBy && person !== userId)))
        await notifyUserInApp(client, { workspaceId, recipientUserId: person, code: "payables.held", eventType: "payables.held",
          variables: { supplier: bill.supplierName, invoice: bill.number, amount, actor, note: holdReasons.slice(0, 480) },
          deepLink: `/workspace/finance/bills?bill=${id}`, idempotencyKey: `payables.held:${id}:${bill.version + 1}:${person}` });
    }
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "supplier_invoice.submitted", entityType: "supplier_invoice", entityId: id,
      after: { status: reasons.length ? "held" : "approved", reasons, dueDate: due, retention } });
  }

  /** A held invoice approved anyway, by someone other than who entered it, with why. */
  private async approve(client: Db, workspaceId: string, userId: string, id: string, body: Record<string, unknown>) {
    const bill = await this.lockBill(client, workspaceId, id, body.version);
    if (bill.status !== "held") throw new ConflictException("Only a held invoice needs approval.");
    if (bill.createdBy === userId) throw new ForbiddenException("Someone other than who entered the invoice approves it.");
    const note = text(body.note, 1000, "Note");
    if (!note) throw new BadRequestException("Say why it's approved.");
    await client.query(`UPDATE supplier_invoices SET status = 'approved', approved_by = $3, approved_at = now(), approval_note = $4, version = version + 1 WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, id, userId, note]);
    const retention = await this.holdRetention(client, workspaceId, id, bill.currency);
    await this.applyAdvances(client, workspaceId, id, userId);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "supplier_invoice.approved", entityType: "supplier_invoice", entityId: id,
      after: { note, reasons: bill.holdReasons, retention } });
  }

  /** Cancelled with why — a wrong entry, or an invoice the supplier replaces. Not while payments are on it. */
  private async cancel(client: Db, workspaceId: string, userId: string, id: string, body: Record<string, unknown>) {
    const bill = await this.lockBill(client, workspaceId, id, body.version);
    if (bill.status === "cancelled") throw new ConflictException("This invoice is already cancelled.");
    const reason = text(body.reason, 500, "Reason");
    if (!reason) throw new BadRequestException("Say why it's cancelled.");
    if (Dec.of(bill.paid).cmp(0) > 0) throw new ConflictException("Payments are on this invoice; reverse them first.");
    if (Dec.of(bill.reserved).cmp(0) > 0) throw new ConflictException("It's in a payment run; take it out of the run first.");
    await client.query(`UPDATE supplier_invoices SET status = 'cancelled', cancel_reason = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, reason]);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "supplier_invoice.cancelled", entityType: "supplier_invoice", entityId: id, before: { status: bill.status }, after: { reason } });
  }

  /**
   * Retention released by someone who approves payables, with why — before the handover (the work was done
   * early) or after it (the defects period ended), all or part of what one project's lines hold back. The
   * rest is released on its own once the client accepted the project's handover.
   */
  private async release(client: Db, workspaceId: string, userId: string, id: string, body: Record<string, unknown>) {
    const bill = await this.lockBill(client, workspaceId, id, body.version);
    if (bill.status !== "approved") throw new ConflictException("Only an approved invoice holds retention.");
    const projectId = body.projectId === undefined || body.projectId === null || body.projectId === "" ? null : uuid(body.projectId, "Project");
    const retention = (await readRetentions(client, workspaceId, id)).find((row) => row.projectId === projectId);
    if (!retention || Dec.of(retention.held).cmp(0) <= 0) throw new ConflictException("Nothing is held back for that project on this invoice.");
    const reason = text(body.reason, 500, "Reason");
    if (!reason) throw new BadRequestException("Say why it's released.");
    const places = currencyDecimals(bill.currency);
    const amount = body.amount === undefined || body.amount === null || body.amount === "" ? Dec.of(retention.held).toFixed(places) : money(body.amount, "Amount", bill.currency);
    if (Dec.of(amount).cmp(0) <= 0) throw new BadRequestException("Enter what's released.");
    if (Dec.of(amount).cmp(retention.held) > 0) throw new ConflictException(`Only ${Dec.of(retention.held).toFixed(places)} is held back for that project.`);
    await client.query(`INSERT INTO supplier_retention_releases (id, workspace_id, retention_id, invoice_id, amount, automatic, reason, released_by) VALUES ($1, $2, $3, $4, $5, false, $6, $7)`,
      [randomUUID(), workspaceId, retention.id, id, amount, reason, userId]);
    await client.query(`UPDATE supplier_invoices SET version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "supplier_invoice.retention_released", entityType: "supplier_invoice", entityId: id,
      before: { held: retention.held }, after: { projectId, amount, reason } });
    const actor = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [userId])).rows[0]?.name ?? "Someone";
    const released = `${bill.currency} ${Dec.of(amount).toFixed(places)}`;
    const note = `${bill.number}: ${released}${retention.projectReference ? ` (${retention.projectReference})` : ""} released by ${actor}: ${reason}`.slice(0, 480);
    for (const person of new Set((await this.holders(client, workspaceId, ["payables.manage"])).filter((person) => person !== userId)))
      await notifyUserInApp(client, { workspaceId, recipientUserId: person, code: "payables.retention_released", eventType: "payables.retention_released",
        variables: { supplier: bill.supplierName, invoice: bill.number, amount: released, actor, note },
        deepLink: `/workspace/finance/bills?bill=${id}`, idempotencyKey: `payables.retention_released:${id}:${bill.version + 1}:${person}` });
  }

  /**
   * What an invoice holds back, fixed as it's approved: each order line takes its order's retention then (a
   * snapshot later terms never change), and the amounts per project are recorded. Returns them.
   */
  private async holdRetention(client: Db, workspaceId: string, billId: string, currency: string) {
    await client.query(
      `UPDATE supplier_invoice_lines line SET retention_percent = purchase.retention_percent
         FROM purchase_order_lines ordered JOIN purchase_orders purchase ON purchase.workspace_id = ordered.workspace_id AND purchase.id = ordered.order_id
        WHERE line.workspace_id = $1 AND line.invoice_id = $2 AND ordered.workspace_id = line.workspace_id AND ordered.id = line.order_line_id`, [workspaceId, billId]);
    const held = retentionByProject(await readBillLines(client, workspaceId, billId), currency);
    for (const part of held)
      await client.query(`INSERT INTO supplier_invoice_retentions (id, workspace_id, invoice_id, project_id, amount) VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), workspaceId, billId, part.projectId, part.amount]);
    return held;
  }

  // ---------- payments ----------

  /**
   * A payment made to a supplier: by bank only into their approved account; an advance names its order.
   * It can go against approved invoices at once, or be allocated later.
   */
  private async pay(client: Db, workspaceId: string, userId: string, id: string, body: Record<string, unknown>) {
    const vendorId = uuid(body.vendorId, "Supplier");
    await this.serialize(client, workspaceId, vendorId);
    if ((await client.query(`SELECT 1 FROM supplier_payments WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rowCount) return;
    const legalEntityId = uuid(body.legalEntityId, "Company");
    if (!(await client.query(`SELECT 1 FROM workspace_vendors WHERE workspace_id = $1 AND id = $2`, [workspaceId, vendorId])).rowCount) throw new NotFoundException("Supplier not found.");
    if (!(await client.query(`SELECT 1 FROM legal_entities WHERE workspace_id = $1 AND id = $2`, [workspaceId, legalEntityId])).rowCount) throw new NotFoundException("Company not found.");
    const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";
    if (!CURRENCY.test(currency)) throw new BadRequestException("Choose the payment's currency.");
    const paidOn = date(body.paidOn, "Paid on");
    if (paidOn > (await this.today(client, workspaceId))) throw new BadRequestException("Record a payment once it's made.");
    const total = money(body.amount, "Amount", currency);
    if (Dec.of(total).cmp(0) <= 0) throw new BadRequestException("Enter what was paid.");
    const method = body.method as (typeof PAYMENT_METHODS)[number];
    if (!PAYMENT_METHODS.includes(method)) throw new BadRequestException("Say how it was paid.");
    const reference = text(body.reference, 120, "Reference");
    if (reference && (await client.query(
      `SELECT 1 FROM supplier_payments WHERE workspace_id = $1 AND vendor_id = $2 AND lower(btrim(reference)) = lower($3) AND status = 'recorded'`, [workspaceId, vendorId, reference])).rowCount)
      throw new ConflictException(`A payment with reference ${reference} is already recorded for this supplier.`);
    let bankAccountId: string | null = null;
    if (method === "bank") {
      bankAccountId = (await client.query<{ id: string }>(
        `SELECT id FROM vendor_bank_accounts WHERE workspace_id = $1 AND vendor_id = $2 AND status = 'approved' AND ($3::uuid IS NULL OR id = $3) ORDER BY decided_at DESC LIMIT 1`,
        [workspaceId, vendorId, body.bankAccountId ? uuid(body.bankAccountId, "Bank account") : null])).rows[0]?.id ?? null;
      if (!bankAccountId) throw new ConflictException("This supplier has no approved bank account. Approve their bank details before paying by bank.");
    }
    let orderId: string | null = null;
    if (body.orderId) {
      orderId = uuid(body.orderId, "Order");
      const order = (await client.query<{ vendorId: string; legalEntityId: string; currency: string; status: string; number: string }>(
        `SELECT vendor_id AS "vendorId", legal_entity_id AS "legalEntityId", currency, status, number FROM purchase_orders WHERE workspace_id = $1 AND id = $2`, [workspaceId, orderId])).rows[0];
      if (!order) throw new NotFoundException("Order not found.");
      if (order.vendorId !== vendorId || order.legalEntityId !== legalEntityId || order.currency !== currency)
        throw new BadRequestException(`An advance on ${order.number} is paid by its company to its supplier in ${order.currency}.`);
      if ([...UNPLACED, "cancelled"].includes(order.status)) throw new ConflictException(`${order.number} isn't a placed order.`);
    }
    // Where invoices are paid only through approved runs, only an advance on an order is recorded directly.
    if ((await ensurePurchasingSettings(client, workspaceId)).paymentRunsRequired && (!orderId || (Array.isArray(body.allocations) && body.allocations.length)))
      throw new ConflictException("Invoices are paid through an approved payment run; only an advance on an order is recorded here.");
    await client.query(
      `INSERT INTO supplier_payments (id, workspace_id, vendor_id, legal_entity_id, paid_on, currency, amount, method, reference, order_id, bank_account_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, workspaceId, vendorId, legalEntityId, paidOn, currency, total, method, reference, orderId, bankAccountId, userId]);
    const allocated = await this.allocate(client, workspaceId, userId, id, body.allocations ?? []);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "supplier_payment.recorded", entityType: "supplier_payment", entityId: id,
      after: { vendorId, legalEntityId, currency, paidOn, amount: total, method, reference, orderId, allocations: allocated } });
  }

  private async allocateMore(client: Db, workspaceId: string, userId: string, id: string, body: Record<string, unknown>) {
    const payment = (await client.query<{ vendorId: string }>(`SELECT vendor_id AS "vendorId" FROM supplier_payments WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
    if (!payment) throw new NotFoundException("Payment not found.");
    await this.serialize(client, workspaceId, payment.vendorId);
    const allocated = await this.allocate(client, workspaceId, userId, id, body.allocations);
    if (!allocated.length) throw new BadRequestException("Choose the invoices it pays.");
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "supplier_payment.allocated", entityType: "supplier_payment", entityId: id, after: { allocations: allocated } });
  }

  /** A payment that didn't happen after all (a bounced cheque, a returned transfer), with why. Its invoices are owed again. */
  private async reverse(client: Db, workspaceId: string, userId: string, id: string, body: Record<string, unknown>) {
    const payment = (await client.query<{ vendorId: string; status: string }>(`SELECT vendor_id AS "vendorId", status FROM supplier_payments WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
    if (!payment) throw new NotFoundException("Payment not found.");
    await this.serialize(client, workspaceId, payment.vendorId);
    if (payment.status !== "recorded") throw new ConflictException("This payment is already reversed.");
    const reason = text(body.reason, 500, "Reason");
    if (!reason) throw new BadRequestException("Say why it's reversed.");
    await client.query(`UPDATE supplier_payments SET status = 'reversed', reverse_reason = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, reason]);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "supplier_payment.reversed", entityType: "supplier_payment", entityId: id, after: { reason } });
  }

  /**
   * Puts a payment against approved invoices of its supplier, company and currency: never more than an
   * invoice can be paid now (what's left, less retention held and what payment runs reserve) or the
   * payment has left, and an advance only against its own order's invoices.
   */
  private async allocate(client: Db, workspaceId: string, userId: string, paymentId: string, raw: unknown) {
    if (!Array.isArray(raw)) throw new BadRequestException("Allocations are not valid.");
    const payment = (await readPayments(client, workspaceId, { id: paymentId }))[0];
    if (payment.status !== "recorded") throw new ConflictException("A reversed payment isn't allocated.");
    let left = Dec.of(payment.unallocated);
    const done: Array<{ invoiceId: string; amount: string }> = [];
    for (const item of raw as Array<Record<string, unknown>>) {
      const invoiceId = uuid(item?.invoiceId, "Invoice");
      const part = money(item.amount, "Amount", payment.currency);
      if (Dec.of(part).cmp(0) <= 0) continue;
      const bill = (await readBills(client, workspaceId, { id: invoiceId }))[0];
      if (!bill) throw new NotFoundException("Invoice not found.");
      if (bill.status !== "approved") throw new ConflictException(`Invoice ${bill.number} isn't approved.`);
      if (bill.vendorId !== payment.vendorId || bill.legalEntityId !== payment.legalEntityId || bill.currency !== payment.currency)
        throw new BadRequestException(`Invoice ${bill.number} is for another supplier, company or currency.`);
      if (payment.orderNumber && !bill.orders.includes(payment.orderNumber)) throw new ConflictException(`This advance was paid on ${payment.orderNumber}; it goes only to that order's invoices.`);
      const places = currencyDecimals(bill.currency);
      if (Dec.of(part).cmp(bill.payable) > 0) throw new ConflictException(`Invoice ${bill.number} has ${Dec.of(bill.payable).toFixed(places)} left to pay${[
        Dec.of(bill.retentionHeld).cmp(0) > 0 ? `; ${Dec.of(bill.retentionHeld).toFixed(places)} retention is held` : "",
        Dec.of(bill.reserved).cmp(0) > 0 ? `; ${Dec.of(bill.reserved).toFixed(places)} is in a payment run` : ""].join("")}.`);
      if (Dec.of(part).cmp(left) > 0) throw new ConflictException(`Only ${left.toFixed(places)} of this payment is left to allocate.`);
      await client.query(`INSERT INTO supplier_payment_allocations (id, workspace_id, payment_id, invoice_id, amount, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), workspaceId, paymentId, invoiceId, part, userId]);
      left = left.sub(part);
      done.push({ invoiceId, amount: part });
    }
    return done;
  }

  /** Advances paid on an invoice's orders go against what it can be paid now (never its retention), oldest first, as far as they reach. */
  private async applyAdvances(client: Db, workspaceId: string, billId: string, userId: string) {
    const bill = (await readBills(client, workspaceId, { id: billId }))[0];
    if (!bill.orders.length) return;
    const advances = (await readPayments(client, workspaceId, { vendorId: bill.vendorId }))
      .filter((payment) => payment.status === "recorded" && payment.orderNumber && bill.orders.includes(payment.orderNumber) && payment.legalEntityId === bill.legalEntityId
        && payment.currency === bill.currency && Dec.of(payment.unallocated).cmp(0) > 0)
      .sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.id.localeCompare(b.id));
    let balance = Dec.of(bill.payable);
    for (const advance of advances) {
      if (balance.cmp(0) <= 0) break;
      const part = Dec.of(advance.unallocated).cmp(balance) < 0 ? Dec.of(advance.unallocated) : balance;
      await client.query(`INSERT INTO supplier_payment_allocations (id, workspace_id, payment_id, invoice_id, amount, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), workspaceId, advance.id, billId, part.toFixed(4), userId]);
      await recordAudit(client, { workspaceId, actorUserId: userId, action: "supplier_payment.allocated", entityType: "supplier_payment", entityId: advance.id,
        after: { allocations: [{ invoiceId: billId, amount: part.toFixed(4) }], advance: true } });
      balance = balance.sub(part);
    }
  }

  // ---------- reads ----------

  private async billDetail(client: Db, workspaceId: string, billId: string, userId: string) {
    const bill = (await readBills(client, workspaceId, { id: billId }))[0];
    if (!bill) throw new NotFoundException("Invoice not found.");
    const rights = await this.rights(client, workspaceId, userId);
    const runsRequired = (await ensurePurchasingSettings(client, workspaceId)).paymentRunsRequired;
    const retentions = await readRetentions(client, workspaceId, billId);
    return {
      bill, lines: await readBillLines(client, workspaceId, billId), payments: await readPayments(client, workspaceId, { invoiceId: billId }), retentions, ...rights,
      canEdit: rights.canManage && ["draft", "held"].includes(bill.status),
      canApproveThis: rights.canApprove && bill.status === "held" && bill.createdBy !== userId,
      canCancel: rights.canManage && bill.status !== "cancelled" && Dec.of(bill.paid).isZero() && Dec.of(bill.reserved).isZero(),
      // Where invoices are paid only through runs, an invoice isn't paid from here.
      canPay: rights.canManage && !runsRequired && bill.status === "approved" && Dec.of(bill.payable).cmp(0) > 0,
      canRelease: rights.canApprove && bill.status === "approved" && retentions.some((row) => Dec.of(row.held).cmp(0) > 0),
    };
  }

  private async paymentDetail(client: Db, workspaceId: string, paymentId: string, userId: string) {
    const payment = (await readPayments(client, workspaceId, { id: paymentId }))[0];
    if (!payment) throw new NotFoundException("Payment not found.");
    return { payment, ...(await this.rights(client, workspaceId, userId)) };
  }

  private async supplierDetail(client: Db, workspaceId: string, vendorId: string, userId: string) {
    const supplier = (await client.query<{ id: string; name: string; creditDays: number | null; paymentTerms: string | null }>(
      `SELECT id, display_name AS name, credit_days AS "creditDays", payment_terms AS "paymentTerms" FROM workspace_vendors WHERE workspace_id = $1 AND id = $2`, [workspaceId, vendorId])).rows[0];
    if (!supplier) throw new NotFoundException("Supplier not found.");
    const bank = (await client.query<{ id: string; bankName: string; last4: string; currency: string | null }>(
      `SELECT id, bank_name AS "bankName", right(account_number, 4) AS last4, currency FROM vendor_bank_accounts
        WHERE workspace_id = $1 AND vendor_id = $2 AND status = 'approved' ORDER BY decided_at DESC LIMIT 1`, [workspaceId, vendorId])).rows[0] ?? null;
    const bankChangePending = Boolean((await client.query(`SELECT 1 FROM vendor_bank_accounts WHERE workspace_id = $1 AND vendor_id = $2 AND status = 'pending'`, [workspaceId, vendorId])).rowCount);
    const orders = (await client.query<{ id: string; number: string; legalEntityId: string; currency: string; status: string; total: string }>(
      `SELECT id, number, legal_entity_id AS "legalEntityId", currency, status, total::text AS total FROM purchase_orders
        WHERE workspace_id = $1 AND vendor_id = $2 AND status <> ALL($3::text[]) ORDER BY created_at DESC LIMIT 200`, [workspaceId, vendorId, [...UNPLACED, "cancelled"]])).rows;
    return {
      supplier: { ...supplier, bank, bankChangePending }, orders,
      balances: await readSupplierBalances(client, workspaceId, vendorId),
      bills: await readBills(client, workspaceId, { vendorId }),
      payments: await readPayments(client, workspaceId, { vendorId }),
      debitNotes: await readDebitNotes(client, workspaceId, vendorId),
      runsRequired: (await ensurePurchasingSettings(client, workspaceId)).paymentRunsRequired,
      ...(await this.rights(client, workspaceId, userId)),
    };
  }

  // ---------- helpers ----------

  private async lockBill(client: Db, workspaceId: string, id: string, version: unknown): Promise<BillRow & { holdReasons: string }> {
    const vendor = (await client.query<{ vendorId: string }>(`SELECT vendor_id AS "vendorId" FROM supplier_invoices WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
    if (!vendor) throw new NotFoundException("Invoice not found.");
    await this.serialize(client, workspaceId, vendor.vendorId);
    await client.query(`SELECT 1 FROM supplier_invoices WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, id]);
    const bill = (await readBills(client, workspaceId, { id }))[0];
    if (version !== bill.version) throw new ConflictException("Someone else changed this invoice. Reload to see their changes.");
    return bill;
  }

  /** One supplier's invoices and payments change one at a time, so matching, balances and runs see each other. */
  private async serialize(client: Db, workspaceId: string, vendorId: string) {
    await lockSuppliers(client, workspaceId, [vendorId]);
  }

  private async rights(client: Db, workspaceId: string, userId: string) {
    return {
      canManage: await this.access.hasPermission(client, workspaceId, userId, "payables.manage"),
      canApprove: await this.access.hasPermission(client, workspaceId, userId, "payables.approve"),
    };
  }

  private async today(client: Db, workspaceId: string) {
    return (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].today;
  }

  private async holders(client: Db, workspaceId: string, codes: string[]) {
    return (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
         JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
         JOIN role_permissions granted ON granted.role_id = effective_role.role_id
         JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = ANY($2::text[])
        WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId, codes])).rows.map((row) => row.userId);
  }
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

function amount(value: unknown, label: string) {
  const textValue = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!NUMBER.test(textValue)) throw new BadRequestException(`${label} must be a number with up to 4 decimals.`);
  return textValue;
}

/** An amount of money in the currency's own minor units (no more decimals than it uses). */
function money(value: unknown, label: string, currency: string) {
  const textValue = amount(value, label);
  const places = currencyDecimals(currency);
  if (Dec.of(textValue).round(places).cmp(textValue) !== 0) throw new BadRequestException(`${label} has more decimals than ${currency} uses.`);
  return textValue;
}

function date(value: unknown, label: string) {
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} must be a date.`);
  return value;
}
