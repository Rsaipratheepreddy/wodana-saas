import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { renderBrandedEmail } from "../email/branded-email";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { event as boqEvent } from "../project-core/project-scope";
import { clientChoicesSignedOff } from "../project-core/project-materials";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import {
  DELIVER_TO, SHIPMENT_STATUSES, currencyDecimals, defaultTaxRate, ensurePurchasingSettings, firstTime, linesNeededBy, nextOrderNumber, packQuantity, orderEvent, orderTotals, priceLine, readNeeds, readOrder,
  readOrderEvents, readOrderLines, readOrders, readShipments, type OrderDetail, type OrderLine,
} from "./orders";
import { readBills } from "./payables";
import { closeSettledBlockers, readLineBlockers } from "./purchasing-blockers";
import { outstanding, readReceipts, settleOrder } from "./receiving";
import { describeShort, fundsShort, type FundsShort } from "./spending-guard";
import { readReturns } from "./returns.service";
import { contractPrice } from "./supplier-controls.service";
import { PAYMENT_TERMS, percent, readSupplier, retentionPercent, type Supplier } from "./suppliers";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^\d{1,14}(\.\d{1,4})?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NO_VENDOR = "00000000-0000-4000-8000-000000000000";

type LineInput = {
  id: string; source: "material" | "line" | "free"; materialItemId: string | null; boqLineId: string | null; projectId: string | null;
  description: string; specification: string; quantity: string; unit: string; unitPrice: string; discountPercent: string; taxRate: string;
  /** A line on another order this one replaces (that supplier didn't deliver it). */
  replacesLineId: string | null;
  /** The stock item a free line restocks (its goods arrive as that item). */
  stockItemId: string | null;
};

/**
 * Purchase orders, from what projects need to order through approval, sending and the supplier's
 * confirmation. The person who raises an order never approves it; an approved order that changes goes
 * back through approval with a frozen copy of what was approved. Every line says what it's for.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(private readonly access: WorkspaceAccessService, @Optional() private readonly email?: TransactionalEmailService) {}

  /** What running projects still need to order, and whether each can be ordered yet. */
  needs(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "purchasing.view", async (client, user) => {
      const settings = await ensurePurchasingSettings(client, workspaceId);
      return { needs: await readNeeds(client, workspaceId, settings.requireMaterialSignoff), settings, ...(await this.rights(client, workspaceId, user.userId)) };
    });
  }

  list(actor: RequestActor, workspaceId: string) {
    return this.access.withPermission(actor, workspaceId, "purchasing.view", async (client, user) => ({
      orders: await readOrders(client, workspaceId), settings: await ensurePurchasingSettings(client, workspaceId), ...(await this.rights(client, workspaceId, user.userId)),
    }));
  }

  get(actor: RequestActor, workspaceId: string, orderId: string) {
    return this.access.withPermission(actor, workspaceId, "purchasing.view", async (client, user) => this.detail(client, workspaceId, orderId, user.userId));
  }

  settings(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["workspace.settings.manage", "purchasing.view"], async (client, user) => ({
      settings: await ensurePurchasingSettings(client, workspaceId),
      canManage: await this.access.hasPermission(client, workspaceId, user.userId, "workspace.settings.manage"),
      currency: (await client.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency ?? null,
    }));
  }

  saveSettings(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "workspace.settings.manage", async (client, user) => {
      const current = await ensurePurchasingSettings(client, workspaceId);
      if (body.version !== current.version) throw new ConflictException("Someone else changed these settings. Reload to see their changes.");
      // Left out, it keeps what's set; null or empty means no approval.
      const threshold = body.approvalThreshold === undefined ? current.approvalThreshold
        : body.approvalThreshold === null || body.approvalThreshold === "" ? null : String(body.approvalThreshold);
      if (threshold !== null && !NUMBER.test(threshold)) throw new BadRequestException("Enter the amount from which orders need approval, or leave it empty.");
      const flag = (key: "requireMaterialSignoff" | "requireApprovedSupplier" | "requireInspection" | "requireSitePhoto" | "paymentRunsRequired") => (body[key] === undefined ? current[key] : body[key] === true);
      const tolerance = body.receiveTolerancePercent === undefined ? current.receiveTolerancePercent : String(body.receiveTolerancePercent || "0");
      if (!NUMBER.test(tolerance) || Dec.of(tolerance).cmp(50) > 0) throw new BadRequestException("Over-delivery is a percentage from 0 to 50.");
      const adjustLimit = body.stockAdjustApprovalValue === undefined ? current.stockAdjustApprovalValue
        : body.stockAdjustApprovalValue === null || body.stockAdjustApprovalValue === "" ? null : String(body.stockAdjustApprovalValue);
      if (adjustLimit !== null && !NUMBER.test(adjustLimit)) throw new BadRequestException("Enter the value above which stock corrections need approval, or leave it empty.");
      const ahead = body.orderAheadDays === undefined ? current.orderAheadDays : Number(body.orderAheadDays);
      if (!Number.isInteger(ahead) || ahead < 0 || ahead > 365) throw new BadRequestException("Order ahead is a whole number of days, from 0 to 365.");
      const invoiceTolerance = body.invoiceTolerancePercent === undefined ? current.invoiceTolerancePercent : String(body.invoiceTolerancePercent || "0");
      if (!NUMBER.test(invoiceTolerance) || Dec.of(invoiceTolerance).cmp(50) > 0) throw new BadRequestException("Invoice price tolerance is a percentage from 0 to 50.");
      const guard = body.spendingGuard === undefined ? current.spendingGuard : String(body.spendingGuard);
      if (!["off", "warn", "strict"].includes(guard)) throw new BadRequestException("Choose how orders beyond a project's money are handled.");
      await client.query(`UPDATE workspace_purchasing_settings SET approval_threshold = $2, require_material_signoff = $3, require_approved_supplier = $4, require_inspection = $5,
        receive_tolerance_percent = $6, require_site_photo = $8, stock_adjust_approval_value = $9, order_ahead_days = $10, invoice_tolerance_percent = $11, spending_guard = $12,
        payment_runs_required = $13, version = version + 1, updated_by = $7, updated_at = now()
        WHERE workspace_id = $1`,
        [workspaceId, threshold, flag("requireMaterialSignoff"), flag("requireApprovedSupplier"), flag("requireInspection"), tolerance, user.userId, flag("requireSitePhoto"), adjustLimit, ahead,
          invoiceTolerance, guard, flag("paymentRunsRequired")]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "purchasing.settings_changed", entityType: "workspace", entityId: workspaceId, before: current, after: body });
      return ensurePurchasingSettings(client, workspaceId);
    });
  }

  /** A new draft order to one supplier, usually from selected needs. Creating it again with the same id changes nothing. */
  create(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "purchasing.manage", async (client, user) => {
      const id = uuid(body.id, "Order");
      if (!(await firstTime(client, workspaceId, id, id, "create_order", user.userId))) return this.detail(client, workspaceId, id, user.userId);
      const supplier = await this.supplier(client, workspaceId, body.vendorId);
      const legalEntityId = await this.company(client, workspaceId, supplier, body.legalEntityId);
      const currency = supplier.currency ?? (await client.query<{ currency: string }>(`SELECT base_currency AS currency FROM legal_entities WHERE workspace_id = $1 AND id = $2`, [workspaceId, legalEntityId])).rows[0].currency;
      await this.createDraft(client, workspaceId, user.userId, { id, supplier, legalEntityId, currency, lines: body.lines, header: this.header(body) });
      return this.detail(client, workspaceId, id, user.userId);
    });
  }

  command(actor: RequestActor, workspaceId: string, orderId: string, body: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, ["purchasing.manage", "purchasing.approve"], async (client, user) => {
      // A command sent again with the same id returns the order as it is now.
      const commandId = body.commandId === undefined || body.commandId === null ? null : uuid(body.commandId, "Command");
      if (commandId && !(await firstTime(client, workspaceId, commandId, orderId, String(body.action ?? ""), user.userId)))
        return { ...(await this.detail(client, workspaceId, orderId, user.userId)), email: null };
      const order = await readOrder(client, workspaceId, orderId, true);
      if (!order) throw new NotFoundException("Order not found.");
      if (body.version !== order.version) throw new ConflictException("Someone else changed this order. Reload to see their changes.");
      const action = String(body.action ?? "");
      const can = async (code: string) => this.access.hasPermission(client, workspaceId, user.userId, code);
      const need = async (code: string, message: string) => { if (!(await can(code))) throw new ForbiddenException(message); };
      const status = (...allowed: string[]) => { if (!allowed.includes(order.status)) throw new ConflictException(statusMessage(order.status)); };
      const set = (sql: string, values: unknown[]) => client.query(`UPDATE purchase_orders SET ${sql}, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, orderId, ...values]);
      let audit: Record<string, unknown> = {};
      let email: { to: string; message: string } | null = null;
      let reordered: string | null = null;

      if (action === "save") {
        await need("purchasing.manage", "You can't change purchase orders.");
        status("draft");
        const supplier = await this.supplier(client, workspaceId, order.vendorId, true);
        const legalEntityId = body.legalEntityId === undefined ? order.legalEntityId : await this.company(client, workspaceId, supplier, body.legalEntityId);
        if (legalEntityId !== order.legalEntityId) throw new ConflictException("The buying company can't change once the order has its number. Cancel it and raise a new one.");
        const header = this.header(body, order);
        const terms = this.terms(body, order);
        const lines = body.lines === undefined ? null : await this.lines(client, workspaceId, body.lines, { tax: await defaultTaxRate(client, workspaceId, order.legalEntityId),
          discount: supplier.deal === "discount" ? supplier.dealPercent ?? "0" : "0", vendorId: order.vendorId, currency: order.currency });
        await set(`deliver_to = $3, delivery_address = $4, expected_date = $5, notes = $6, payment_terms = $7, advance_percent = $8, credit_days = $9, terms_note = $10, retention_percent = $11`,
          [header.deliverTo, header.deliveryAddress, header.expectedDate, header.notes, terms.paymentTerms, terms.advancePercent, terms.creditDays, terms.termsNote, terms.retentionPercent]);
        if (lines) {
          await this.writeLines(client, workspaceId, orderId, lines, order.currency);
          // An override was for the order as it was.
          if (order.fundsOverrideReason) await set(`funds_override_by = NULL, funds_override_at = NULL, funds_override_reason = NULL`, []);
        }
        audit = { header, terms, lines: lines?.length };
      } else if (action === "submit") {
        await need("purchasing.manage", "You can't raise purchase orders.");
        status("draft");
        await this.checkReady(client, workspaceId, order);
        // Ordering more than the project needs says why, once.
        const over = await this.overOrdered(client, workspaceId, orderId);
        const overReason = text(body.overReason, 500, "Reason") || order.overReason || "";
        if (over.length && !overReason)
          throw new ConflictException(`${over.map((line) => `${line.description}: ${line.over} ${line.unit}`.trim()).join(", ")} more than needed. Say why to order more.`);
        if (over.length && overReason !== order.overReason) await set(`over_reason = $3`, [overReason]);
        await this.goesAheadOnHold(client, workspaceId, order, body, user.userId, set);
        const settings = await ensurePurchasingSettings(client, workspaceId);
        await this.guardFunds(client, workspaceId, order, settings.spendingGuard, user.userId);
        const home = (await client.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency;
        const needsApproval = settings.approvalThreshold !== null && (order.currency !== home || Dec.of(order.total).cmp(settings.approvalThreshold) >= 0);
        if (needsApproval) {
          await set(`status = 'pending_approval', submitted_by = $3`, [user.userId]);
          await orderEvent(client, workspaceId, orderId, "submitted", { total: order.total, currency: order.currency }, user.userId);
          await this.tellApprovers(client, workspaceId, order, user.userId);
        } else {
          await set(`status = 'approved', submitted_by = $3, approved_at = now(), approved_by = NULL`, [user.userId]);
          await orderEvent(client, workspaceId, orderId, "approved", { policy: "under_threshold", threshold: settings.approvalThreshold }, user.userId);
        }
        audit = { needsApproval };
      } else if (action === "approve" || action === "return") {
        await need("purchasing.approve", "You can't approve purchase orders.");
        status("pending_approval");
        if (order.createdBy === user.userId || order.submittedBy === user.userId) throw new ForbiddenException("Someone else approves an order you raised.");
        const note = text(body.note, 500, "Note");
        if (action === "return" && !note) throw new BadRequestException("Say what needs to change.");
        if (action === "approve") {
          await this.checkReady(client, workspaceId, order);
          // A project put on hold after the buyer submitted: someone says why it still goes ahead.
          await this.goesAheadOnHold(client, workspaceId, order, body, user.userId, set);
          // The money may have changed since it was submitted.
          await this.guardFunds(client, workspaceId, order, (await ensurePurchasingSettings(client, workspaceId)).spendingGuard, user.userId);
          await set(`status = 'approved', approved_at = now(), approved_by = $3`, [user.userId]);
        } else await set(`status = 'draft', submitted_by = NULL`, []);
        await orderEvent(client, workspaceId, orderId, action === "approve" ? "approved" : "returned", { note }, user.userId);
        await this.tell(client, workspaceId, order, action === "approve" ? "purchasing.approved" : "purchasing.returned", [order.createdBy, order.submittedBy], user.userId, note);
        audit = { note };
      } else if (action === "override_funds") {
        await need("projects.funds_override", "Only someone who may override the money in hand lets this order go ahead.");
        status("draft", "pending_approval");
        const reason = text(body.reason, 500, "Reason");
        if (!reason) throw new BadRequestException("Say why this order goes ahead beyond the money in hand.");
        const short = await fundsShort(client, workspaceId, orderId);
        if (!short.length) throw new ConflictException("The projects on this order have the money for it.");
        await set(`funds_override_by = $3, funds_override_at = now(), funds_override_reason = $4`, [user.userId, reason]);
        await orderEvent(client, workspaceId, orderId, "funds_override", { reason, short: describeShort(short) }, user.userId);
        await this.tell(client, workspaceId, order, "purchasing.over_funds", [order.createdBy, order.submittedBy, ...await this.moneyPeople(client, workspaceId, short)], user.userId,
          `${describeShort(short)}. Approved to go ahead: ${reason}`.slice(0, 480));
        audit = { reason, short };
      } else if (action === "ask_funds") {
        await need("purchasing.manage", "You can't raise purchase orders.");
        status("draft", "pending_approval");
        const short = await fundsShort(client, workspaceId, orderId);
        if (!short.length) throw new ConflictException("The projects on this order have the money for it.");
        const note = text(body.note, 500, "Note");
        const holders = (await client.query<{ userId: string }>(
          `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
             JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
             JOIN role_permissions granted ON granted.role_id = effective_role.role_id
             JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'projects.funds_override'
            WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows.map((row) => row.userId);
        if (!holders.filter((id) => id !== user.userId).length) throw new ConflictException("Nobody else here may let an order go ahead beyond the money in hand.");
        await set(`notes = notes`, []);
        await orderEvent(client, workspaceId, orderId, "funds_asked", { note, short: describeShort(short) }, user.userId);
        await this.tell(client, workspaceId, { ...order, version: order.version + 1 }, "purchasing.funds_blocked", holders, user.userId,
          [describeShort(short), note].filter(Boolean).join(". ").slice(0, 480));
        audit = { note, short };
      } else if (action === "send") {
        await need("purchasing.manage", "You can't send purchase orders.");
        status("approved");
        await this.notHeld(client, workspaceId, order);
        await this.goesAheadOnHold(client, workspaceId, order, body, user.userId, set);
        const to = body.to === null || body.to === undefined || body.to === "" ? null : text(body.to, 320, "Email");
        if (to && !EMAIL.test(to)) throw new BadRequestException("Enter the supplier's email.");
        await set(`status = 'sent', sent_at = now(), sent_to = $3`, [to]);
        await orderEvent(client, workspaceId, orderId, "sent", { to }, user.userId);
        // Bought scope lines are now ordered: their history says so.
        for (const line of await readOrderLines(client, workspaceId, orderId))
          if (line.boqLineId && line.projectId) await boqEvent(client, workspaceId, line.projectId, line.boqLineId, "ordered", { order: order.number, quantity: line.quantity, unit: line.unit }, null, user.userId);
        if (to) email = { to, message: text(body.message, 2000, "Message") };
        audit = { to };
      } else if (action === "confirm") {
        // The supplier's confirmation: by when, and for each line how much and by when if it differs.
        await need("purchasing.manage", "You can't record supplier confirmations.");
        status("sent", "confirmed", "partly_received");
        const reference = text(body.supplierReference, 120, "Supplier reference");
        const lines = await readOrderLines(client, workspaceId, orderId);
        const given = Array.isArray(body.lines) ? body.lines as Array<Record<string, unknown>> : [];
        const confirmed: Array<{ description: string; promisedDate: string | null; confirmedQuantity: string | null; short: boolean }> = [];
        for (const raw of given) {
          const line = lines.find((item) => item.id === raw?.lineId);
          if (!line) throw new BadRequestException("A line isn't on this order.");
          const promisedDate = date(raw.promisedDate, `${line.description}: promised date`);
          const confirmedQuantity = raw.confirmedQuantity === undefined || raw.confirmedQuantity === null || raw.confirmedQuantity === "" ? null : amount(raw.confirmedQuantity, `${line.description}: confirmed`);
          const ordered = Dec.of(line.quantity).sub(line.cancelled);
          if (confirmedQuantity !== null && Dec.of(confirmedQuantity).cmp(ordered) > 0) throw new BadRequestException(`${line.description}: the supplier can't confirm more than was ordered.`);
          await client.query(`UPDATE purchase_order_lines SET promised_date = $3, confirmed_quantity = $4 WHERE workspace_id = $1 AND id = $2`, [workspaceId, line.id, promisedDate, confirmedQuantity]);
          confirmed.push({ description: line.description, promisedDate, confirmedQuantity, short: confirmedQuantity !== null && Dec.of(confirmedQuantity).cmp(ordered) < 0 });
        }
        const lineDates = confirmed.map((line) => line.promisedDate).filter((value): value is string => Boolean(value)).sort();
        const promised = body.promisedDate === undefined ? lineDates[0] ?? order.promisedDate : date(body.promisedDate, "Promised date");
        await set(`status = CASE WHEN status = 'sent' THEN 'confirmed' ELSE status END, confirmed_at = coalesce(confirmed_at, now()), promised_date = $3, supplier_reference = $4`, [promised, reference]);
        await orderEvent(client, workspaceId, orderId, "confirmed", { promisedDate: promised, supplierReference: reference, lines: confirmed }, user.userId);
        audit = { promised, reference, lines: confirmed };
      } else if (action === "chase") {
        // A late order chased: what the supplier said, and their new date for everything still to come.
        await need("purchasing.manage", "You can't chase orders.");
        status("sent", "confirmed", "partly_received");
        const note = text(body.note, 500, "Note");
        if (!note) throw new BadRequestException("Say what the supplier said.");
        const promised = date(body.promisedDate, "New date");
        if (promised) {
          // The new date is for what's late now; lines promised later keep their own date.
          const today = (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`,
            [workspaceId])).rows[0].today;
          const lines = await readOrderLines(client, workspaceId, orderId);
          for (const line of lines)
            if (outstanding(line).cmp(0) > 0 && (!line.due || line.due < today))
              await client.query(`UPDATE purchase_order_lines SET promised_date = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, line.id, promised]);
          await set(`promised_date = CASE WHEN promised_date IS NULL OR promised_date < $3::date THEN $3::date ELSE promised_date END`, [promised]);
        } else await set(`notes = notes`, []);
        await orderEvent(client, workspaceId, orderId, "chased", { note, promisedDate: promised }, user.userId);
        audit = { note, promised };
      } else if (action === "continue_on_hold") {
        // The supplier is on hold: someone who approves orders says this order continues anyway, and why.
        await need("purchasing.approve", "Someone who approves orders decides this.");
        status("approved", "sent", "confirmed", "partly_received");
        const supplier = await readSupplier(client, workspaceId, order.vendorId);
        if (!supplier || (supplier.approval !== "on_hold" && supplier.approval !== "not_approved")) throw new ConflictException("The supplier isn't on hold.");
        const note = text(body.note, 500, "Note");
        if (!note) throw new BadRequestException("Say why this order continues.");
        await set(`continue_on_hold_by = $3, continue_on_hold_at = now(), continue_on_hold_note = $4`, [user.userId, note]);
        await orderEvent(client, workspaceId, orderId, "continued_on_hold", { note }, user.userId);
        audit = { note };
      } else if (action === "offer_alternate") {
        // The supplier offers something else for a line (another make, finish or size): recorded, then decided by someone else.
        await need("purchasing.manage", "You can't change purchase orders.");
        status("approved", "sent", "confirmed", "partly_received");
        const line = (await readOrderLines(client, workspaceId, orderId)).find((item) => item.id === body.lineId);
        if (!line) throw new BadRequestException("A line isn't on this order.");
        if (outstanding(line).isZero()) throw new ConflictException(`Nothing more of ${line.description} is still to come.`);
        if (line.alternateStatus === "offered") throw new ConflictException(`An alternative for ${line.description} is already waiting for a decision.`);
        const description = text(body.description, 500, "Alternative");
        if (!description) throw new BadRequestException("Say what the supplier offers instead.");
        const specification = text(body.specification, 1000, "Specification");
        const price = body.unitPrice === undefined || body.unitPrice === null || body.unitPrice === "" ? null : amount(body.unitPrice, "Price");
        const note = text(body.note, 500, "Note");
        if (!note) throw new BadRequestException("Say why the supplier offers it.");
        await client.query(
          `UPDATE purchase_order_lines SET alternate_status = 'offered', alternate_description = $3, alternate_specification = $4, alternate_unit_price = $5, alternate_note = $6,
                  alternate_offered_by = $7, alternate_decided_by = NULL WHERE workspace_id = $1 AND id = $2`, [workspaceId, line.id, description, specification, price, note, user.userId]);
        await set(`notes = notes`, []);
        await orderEvent(client, workspaceId, orderId, "alternate_offered", { item: line.description, alternative: description, specification, unitPrice: price, note }, user.userId);
        await this.tell(client, workspaceId, order, "purchasing.alternate_offered", (await this.approvers(client, workspaceId)), user.userId, `${line.description} → ${description}: ${note}`.slice(0, 480));
        audit = { line: line.id, description, specification, price, note };
      } else if (action === "decide_alternate") {
        // Someone other than whoever recorded it takes or refuses the supplier's alternative.
        await need("purchasing.approve", "You can't decide on alternatives.");
        const line = (await readOrderLines(client, workspaceId, orderId)).find((item) => item.id === body.lineId);
        if (!line || line.alternateStatus !== "offered") throw new ConflictException("No alternative is waiting for a decision on that line.");
        if (line.alternateOfferedBy === user.userId) throw new ForbiddenException("Someone else decides on an alternative you recorded.");
        const decision = body.decision === "accept" ? "accepted" : body.decision === "reject" ? "rejected" : null;
        if (!decision) throw new BadRequestException("Take or refuse the alternative.");
        const note = text(body.note, 500, "Note");
        if (decision === "rejected" && !note) throw new BadRequestException("Say why it's refused.");
        if (decision === "accepted") {
          // A material the client chooses changes only through the client: its list is updated and signed off first.
          if (line.materialItemId) {
            const material = (await client.query<{ specification: string; name: string; clientChoice: boolean; projectId: string }>(
              `SELECT specification, name, client_choice AS "clientChoice", project_id AS "projectId" FROM project_material_items WHERE workspace_id = $1 AND id = $2`, [workspaceId, line.materialItemId])).rows[0];
            const same = (a: string, b: string) => a.trim().toLocaleLowerCase().replace(/\s+/g, " ") === b.trim().toLocaleLowerCase().replace(/\s+/g, " ");
            if (material?.clientChoice && (!same(material.specification, line.alternateSpecification) || !(await clientChoicesSignedOff(client, workspaceId, material.projectId))))
              throw new ConflictException(`The client chooses ${material.name}: change it on the material list and get their sign-off first.`);
          }
          const price = line.alternateUnitPrice ?? line.unitPrice;
          if (Dec.of(price).cmp(line.unitPrice) > 0) throw new ConflictException("The alternative costs more; change the order to take it.");
          const amounts = priceLine({ quantity: line.quantity, unitPrice: price, discountPercent: line.discountPercent, taxRate: line.taxRate }, currencyDecimals(order.currency));
          await client.query(
            `UPDATE purchase_order_lines SET original_description = description, original_specification = specification, description = alternate_description,
                    specification = alternate_specification, unit_price = $3, net = $4, tax = $5, total = $6, alternate_status = 'accepted', alternate_decided_by = $7
              WHERE workspace_id = $1 AND id = $2`, [workspaceId, line.id, price, amounts.net, amounts.tax, amounts.total, user.userId]);
          await this.refreshTotals(client, workspaceId, orderId, order.currency);
        } else {
          await client.query(`UPDATE purchase_order_lines SET alternate_status = 'rejected', alternate_decided_by = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, line.id, user.userId]);
        }
        await set(`notes = notes`, []);
        await orderEvent(client, workspaceId, orderId, decision === "accepted" ? "alternate_accepted" : "alternate_rejected", { item: line.description, alternative: line.alternateDescription, note }, user.userId);
        await this.tell(client, workspaceId, order, "purchasing.alternate_decided", [order.createdBy, line.alternateOfferedBy], user.userId,
          decision === "accepted" ? `${line.alternateDescription} taken` : `${line.alternateDescription} refused: ${note}`);
        audit = { line: line.id, decision, note };
      } else if (action === "cancel_line") {
        // The rest of one line won't come: cancelled with the reason, and optionally ordered from another supplier.
        await need("purchasing.manage", "You can't change purchase orders.");
        status("sent", "confirmed", "partly_received");
        const lines = await readOrderLines(client, workspaceId, orderId);
        const line = lines.find((item) => item.id === body.lineId);
        if (!line) throw new BadRequestException("A line isn't on this order.");
        const left = outstanding(line);
        const quantity = body.quantity === undefined || body.quantity === null || body.quantity === "" ? left.toString() : amount(body.quantity, "Quantity");
        if (Dec.of(quantity).cmp(0) <= 0 || Dec.of(quantity).cmp(left) > 0)
          throw new ConflictException(left.isZero() ? `Nothing more of ${line.description} is still to come.` : `At most ${left.toString()} ${line.unit} of ${line.description} is still to come.`);
        const reason = text(body.reason, 500, "Reason");
        if (!reason) throw new BadRequestException(`Say why the rest of ${line.description} won't come.`);
        const arrived = (await client.query(`SELECT 1 FROM goods_receipts WHERE workspace_id = $1 AND order_id = $2 AND reversed_at IS NULL LIMIT 1`, [workspaceId, orderId])).rowCount;
        const everything = lines.every((item) => (item.id === line.id ? Dec.of(item.cancelled).add(quantity) : Dec.of(item.cancelled)).cmp(item.quantity) === 0);
        if (!arrived && everything) throw new ConflictException("Nothing on this order would come; cancel the order instead.");
        await client.query(`UPDATE purchase_order_lines SET cancelled_quantity = cancelled_quantity + $3, cancel_reason = $4 WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, line.id, quantity, reason]);
        await set(`notes = notes`, []);
        await orderEvent(client, workspaceId, orderId, "line_cancelled", { description: line.description, quantity, unit: line.unit, reason }, user.userId);
        await settleOrder(client, workspaceId, orderId);
        if (body.reorderVendorId) {
          const supplier = await this.supplier(client, workspaceId, body.reorderVendorId);
          if (supplier.id === order.vendorId) throw new BadRequestException("Choose another supplier to order it from.");
          const legalEntityId = await this.company(client, workspaceId, supplier, order.legalEntityId);
          const currency = supplier.currency ?? (await client.query<{ currency: string }>(`SELECT base_currency AS currency FROM legal_entities WHERE workspace_id = $1 AND id = $2`, [workspaceId, legalEntityId])).rows[0].currency;
          reordered = randomUUID();
          await this.createDraft(client, workspaceId, user.userId, { id: reordered, supplier, legalEntityId, currency, from: { replaces: order.number },
            header: { deliverTo: order.deliverTo, deliveryAddress: order.deliveryAddress, expectedDate: order.expectedDate, notes: "" },
            lines: [{ source: line.source, materialItemId: line.materialItemId, boqLineId: line.boqLineId, projectId: line.projectId, description: line.description,
              specification: line.specification, quantity, unit: line.unit, replacesLineId: line.id, stockItemId: line.stockItemId }] });
        }
        audit = { line: line.id, quantity, reason, reordered };
      } else if (action === "change") {
        await need("purchasing.manage", "You can't change purchase orders.");
        status("approved", "sent", "confirmed");
        const reason = text(body.reason, 500, "Reason");
        if (!reason) throw new BadRequestException("Say what's changing.");
        const lines = await readOrderLines(client, workspaceId, orderId);
        await client.query(`INSERT INTO purchase_order_revisions (workspace_id, order_id, revision, snapshot, reason, created_by) VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
          [workspaceId, orderId, order.revision, JSON.stringify({ order, lines }), reason, user.userId]);
        await set(`status = 'draft', revision = revision + 1, approved_at = NULL, approved_by = NULL, submitted_by = NULL`, []);
        await orderEvent(client, workspaceId, orderId, "changing", { reason, revision: order.revision + 1, was: order.status }, user.userId);
        audit = { reason, revision: order.revision + 1 };
      } else if (action === "close") {
        await need("purchasing.manage", "You can't close purchase orders.");
        status("partly_received", "received");
        const reason = text(body.reason, 500, "Reason");
        const lines = await readOrderLines(client, workspaceId, orderId);
        if (lines.some((line) => Dec.of(line.pending).cmp(0) > 0)) throw new ConflictException("Some goods are still waiting for inspection.");
        if ((await client.query(`SELECT 1 FROM supplier_returns WHERE workspace_id = $1 AND order_id = $2 AND status = 'open'`, [workspaceId, orderId])).rowCount)
          throw new ConflictException("Goods are still waiting to go back to the supplier.");
        const short = lines.some((line) => Dec.of(line.accepted).add(line.credited).add(line.cancelled).cmp(line.quantity) < 0);
        if (short && !reason) throw new BadRequestException("Say why the rest won't come.");
        await set(`status = 'closed', closed_at = now(), close_reason = $3`, [reason || null]);
        await orderEvent(client, workspaceId, orderId, "closed", { reason, short }, user.userId);
        audit = { reason, short };
      } else if (action === "cancel") {
        await need("purchasing.manage", "You can't cancel purchase orders.");
        status("draft", "pending_approval", "approved", "sent", "confirmed");
        const reason = text(body.reason, 500, "Reason");
        if (!reason) throw new BadRequestException("Say why the order is cancelled.");
        await set(`status = 'cancelled', cancelled_at = now(), cancel_reason = $3`, [reason]);
        await orderEvent(client, workspaceId, orderId, "cancelled", { reason, was: order.status }, user.userId);
        audit = { reason };
      } else if (action === "track") {
        // A shipment the buyer follows inside the order: who carries it, its tracking, when it ships and arrives.
        await need("purchasing.manage", "You can't follow shipments.");
        status("approved", "sent", "confirmed", "partly_received");
        audit = await this.track(client, workspaceId, order, body, user.userId);
        await set(`notes = notes`, []);
      } else {
        throw new BadRequestException("Unknown action.");
      }
      // Work waiting on a line that won't come any more (or came) isn't blocked by it now.
      if (["cancel", "cancel_line", "close"].includes(action)) await closeSettledBlockers(client, workspaceId, { orderId }, user.userId);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `purchase_order.${action}`, entityType: "purchase_order", entityId: orderId, after: audit });
      const detail = await this.detail(client, workspaceId, orderId, user.userId);
      return { ...detail, email, reordered };
    }).then(async (result) => {
      // The supplier's email goes out once the order is saved as sent.
      if (!result.email) return { ...result, delivery: null };
      const delivery = await this.emailSupplier(workspaceId, result, result.email.to, result.email.message);
      await this.access.withAnyPermission(actor, workspaceId, ["purchasing.manage"], (client, user) =>
        orderEvent(client, workspaceId, orderId, delivery === "sent" ? "emailed" : "email_not_sent", { to: result.email!.to, status: delivery }, user.userId));
      return { ...result, delivery };
    });
  }

  /**
   * Writes a draft order: numbered by the buying company, the supplier's terms, and lines checked for
   * what they're for (the supplier's discount and the company's tax when a line doesn't say).
   */
  async createDraft(client: Db, workspaceId: string, userId: string, input: { id: string; supplier: Supplier; legalEntityId: string; currency: string; lines: unknown;
    header: { deliverTo: string; deliveryAddress: string; expectedDate: string | null; notes: string }; from?: Record<string, unknown> }) {
    const { id, supplier, legalEntityId, currency, header } = input;
    const tax = await defaultTaxRate(client, workspaceId, legalEntityId);
    const discount = supplier.deal === "discount" ? supplier.dealPercent ?? "0" : "0";
    const lines = await this.lines(client, workspaceId, input.lines, { tax, discount, vendorId: supplier.id, currency });
    const number = await nextOrderNumber(client, workspaceId, legalEntityId);
    await client.query(
      `INSERT INTO purchase_orders (id, workspace_id, number, legal_entity_id, vendor_id, currency, payment_terms, advance_percent, credit_days, terms_note, deliver_to, delivery_address,
                                    expected_date, notes, created_by, retention_percent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [id, workspaceId, number, legalEntityId, supplier.id, currency, supplier.paymentTerms, supplier.advancePercent, supplier.creditDays, supplier.termsNote,
        header.deliverTo, header.deliveryAddress, header.expectedDate, header.notes, userId, supplier.retentionPercent]);
    await this.writeLines(client, workspaceId, id, lines, currency);
    await orderEvent(client, workspaceId, id, "created", { number, lines: lines.length, ...(input.from ?? {}) }, userId);
    await recordAudit(client, { workspaceId, actorUserId: userId, action: "purchase_order.created", entityType: "purchase_order", entityId: id, after: { number, vendorId: supplier.id, lines: lines.length, ...(input.from ?? {}) } });
    return { number, lines };
  }

  /** The same checks as an order's lines, for another purchasing step (a price request). */
  async checkLines(client: Db, workspaceId: string, value: unknown, currency: string) {
    return this.lines(client, workspaceId, value, { tax: "0", discount: "0", vendorId: NO_VENDOR, currency });
  }

  /** A supplier that can take orders (not archived), for another purchasing step. */
  async orderableSupplier(client: Db, workspaceId: string, vendorId: string) { return this.supplier(client, workspaceId, vendorId); }

  /** The buying company for a supplier, checked. */
  async buyingCompany(client: Db, workspaceId: string, supplier: Supplier, value: unknown) { return this.company(client, workspaceId, supplier, value); }

  // ---------- helpers ----------
  private async detail(client: Db, workspaceId: string, orderId: string, userId: string) {
    const order = await readOrder(client, workspaceId, orderId);
    if (!order) throw new NotFoundException("Order not found.");
    const supplier = await readSupplier(client, workspaceId, order.vendorId);
    const rights = await this.rights(client, workspaceId, userId);
    const lines = await readOrderLines(client, workspaceId, orderId);
    return {
      order, lines, events: await readOrderEvents(client, workspaceId, orderId),
      receipts: await readReceipts(client, workspaceId, { orderId }),
      returns: await readReturns(client, workspaceId, orderId),
      revisions: (await client.query<{ revision: number; reason: string; at: string; byName: string }>(
        `SELECT revision.revision, revision.reason, revision.created_at AS at, person.display_name AS "byName" FROM purchase_order_revisions revision JOIN users person ON person.id = revision.created_by
          WHERE revision.workspace_id = $1 AND revision.order_id = $2 ORDER BY revision.revision`, [workspaceId, orderId])).rows,
      supplier: supplier ? { id: supplier.id, name: supplier.name, email: supplier.email, phone: supplier.phone, contactName: supplier.contactName, approval: supplier.approval, deal: supplier.deal, dealPercent: supplier.dealPercent } : null,
      ...rights,
      canApproveThis: rights.canApprove && order.status === "pending_approval" && order.createdBy !== userId && order.submittedBy !== userId,
      me: userId,
      supplierHold: supplier && (supplier.approval === "on_hold" || supplier.approval === "not_approved") && ["approved", "sent", "confirmed", "partly_received"].includes(order.status)
        ? { approval: supplier.approval, note: supplier.approvalNote } : null,
      overOrdered: ["draft", "pending_approval"].includes(order.status) ? await this.overOrdered(client, workspaceId, orderId) : [],
      packs: await this.packs(client, workspaceId, order),
      contracts: await this.contracts(client, workspaceId, order),
      neededBy: await this.neededBy(client, workspaceId, lines),
      ...(await this.funds(client, workspaceId, order, userId)),
      shipments: await readShipments(client, workspaceId, orderId),
      /** Its projects on hold now, while it isn't placed or going ahead anyway. */
      holdProjects: order.holdOverrideAt || !["draft", "pending_approval", "approved"].includes(order.status) ? [] : await this.projectsOnHold(client, workspaceId, orderId),
      /** The supplier's invoices for it and how they matched (for people who see supplier bills). */
      bills: await this.access.hasPermission(client, workspaceId, userId, "payables.view")
        ? (await readBills(client, workspaceId, { orderId })).map((bill) => ({ id: bill.id, number: bill.number, invoiceDate: bill.invoiceDate, status: bill.status, holdReasons: bill.holdReasons,
          total: bill.total, balance: bill.balance, currency: bill.currency })) : null,
      /** Work on its projects waiting for its lines. */
      blockers: await readLineBlockers(client, workspaceId, { orderId }),
    };
  }

  /** While an order isn't placed: the projects it would take beyond their money in hand, and who may let it go ahead. */
  private async funds(client: Db, workspaceId: string, order: OrderDetail, userId: string) {
    const guard = (await ensurePurchasingSettings(client, workspaceId)).spendingGuard;
    const open = guard !== "off" && ["draft", "pending_approval"].includes(order.status);
    return { spendingGuard: guard, fundsShort: open ? await fundsShort(client, workspaceId, order.id) : [],
      canOverrideFunds: open && await this.access.hasPermission(client, workspaceId, userId, "projects.funds_override") };
  }

  /** When each line's goods are needed on its project, from the plan (lines with no date are left out). */
  private async neededBy(client: Db, workspaceId: string, lines: OrderLine[]) {
    return linesNeededBy(client, workspaceId, lines);
  }

  private async rights(client: Db, workspaceId: string, userId: string) {
    return {
      canBuy: await this.access.hasPermission(client, workspaceId, userId, "purchasing.manage"),
      canApprove: await this.access.hasPermission(client, workspaceId, userId, "purchasing.approve"),
      canReceive: await this.access.hasPermission(client, workspaceId, userId, "purchasing.manage") || await this.access.hasPermission(client, workspaceId, userId, "stock.receive"),
    };
  }

  private async supplier(client: Db, workspaceId: string, value: unknown, allowArchived = false): Promise<Supplier> {
    const supplier = await readSupplier(client, workspaceId, uuid(value, "Supplier"));
    if (!supplier) throw new BadRequestException("Choose a supplier.");
    if (supplier.status === "archived" && !allowArchived) throw new ConflictException(`${supplier.name} is archived.`);
    return supplier;
  }

  /** The buying company: the one given, or the supplier's only company, or the workspace's only company. */
  private async company(client: Db, workspaceId: string, supplier: Supplier, value: unknown) {
    const companies = (await client.query<{ id: string; name: string }>(`SELECT id, display_name AS name FROM legal_entities WHERE workspace_id = $1 AND status = 'active'`, [workspaceId])).rows;
    const id = typeof value === "string" && UUID.test(value) ? value : supplier.entityIds.length === 1 ? supplier.entityIds[0] : companies.length === 1 ? companies[0].id : null;
    const company = companies.find((item) => item.id === id);
    if (!company) throw new BadRequestException("Choose which of your companies is buying.");
    if (supplier.entityIds.length && !supplier.entityIds.includes(company.id)) throw new BadRequestException(`${company.name} doesn't buy from ${supplier.name}. Add it to the supplier first.`);
    return company.id;
  }

  private header(body: Record<string, unknown>, current?: OrderDetail) {
    const deliverTo = body.deliverTo === undefined ? current?.deliverTo ?? "site" : oneOf(body.deliverTo, DELIVER_TO, "Delivery");
    return {
      deliverTo,
      deliveryAddress: body.deliveryAddress === undefined ? current?.deliveryAddress ?? "" : text(body.deliveryAddress, 500, "Address"),
      expectedDate: body.expectedDate === undefined ? current?.expectedDate ?? null : date(body.expectedDate, "Needed by"),
      notes: body.notes === undefined ? current?.notes ?? "" : text(body.notes, 2000, "Notes"),
    };
  }

  private terms(body: Record<string, unknown>, current: OrderDetail) {
    const paymentTerms = body.paymentTerms === undefined ? current.paymentTerms : oneOf(body.paymentTerms, PAYMENT_TERMS, "Payment terms");
    const advancePercent = paymentTerms === "split" ? percent(body.advancePercent ?? current.advancePercent, "The advance") : null;
    const days = paymentTerms === "credit" ? Number(body.creditDays ?? current.creditDays) : null;
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) throw new BadRequestException("Credit is a whole number of days, from 1 to 365.");
    return { paymentTerms, advancePercent, creditDays: days, termsNote: body.termsNote === undefined ? current.termsNote : text(body.termsNote, 500, "Terms note"),
      retentionPercent: body.retentionPercent === undefined ? current.retentionPercent : retentionPercent(body.retentionPercent) };
  }

  /**
   * Checks each line and says what it's for. A material or scope line must belong to a running project;
   * its description, unit and (from the supplier's catalog price) price are filled in when left out.
   */
  private async lines(client: Db, workspaceId: string, value: unknown, defaults: { tax: string; discount: string; vendorId: string; currency: string }): Promise<LineInput[]> {
    if (!Array.isArray(value) || !value.length) throw new BadRequestException("Add at least one line.");
    if (value.length > 300) throw new BadRequestException("An order has up to 300 lines.");
    const seen = new Set<string>();
    const out: LineInput[] = [];
    for (const [index, raw] of value.entries()) {
      const input = (raw ?? {}) as Record<string, unknown>;
      const id = typeof input.id === "string" && UUID.test(input.id) ? input.id : randomUUID();
      if (seen.has(id)) throw new BadRequestException("Two lines have the same id.");
      seen.add(id);
      const source = oneOf(input.source ?? "free", ["material", "line", "free"] as const, "Line");
      let origin: { projectId: string; title: string; detail: string; unit: string; catalogItemId: string | null } | null = null;
      if (source === "material") {
        origin = (await client.query<{ projectId: string; title: string; detail: string; unit: string; catalogItemId: string | null }>(
          `SELECT item.project_id AS "projectId", item.name AS title, concat_ws(' · ', nullif(item.code, ''), nullif(item.specification, '')) AS detail, item.unit, item.catalog_item_id AS "catalogItemId"
             FROM project_material_items item JOIN delivery_projects project ON project.workspace_id = item.workspace_id AND project.id = item.project_id
            WHERE item.workspace_id = $1 AND item.id = $2 AND project.status IN ('active', 'on_hold')`, [workspaceId, uuid(input.materialItemId, "Material")])).rows[0] ?? null;
        if (!origin) throw new BadRequestException(`Line ${index + 1}: that material isn't on a running project's list.`);
      } else if (source === "line") {
        origin = (await client.query<{ projectId: string; title: string; detail: string; unit: string; catalogItemId: string | null }>(
          `SELECT line.project_id AS "projectId", line.title, line.description AS detail, line.unit, line.catalog_item_id AS "catalogItemId"
             FROM project_boq_lines line JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
            WHERE line.workspace_id = $1 AND line.id = $2 AND line.status = 'active' AND project.status IN ('active', 'on_hold')`, [workspaceId, uuid(input.boqLineId, "Scope line")])).rows[0] ?? null;
        if (!origin) throw new BadRequestException(`Line ${index + 1}: that item isn't in a running project's scope.`);
      }
      let projectId = origin?.projectId ?? null;
      if (source === "free" && input.projectId) {
        projectId = uuid(input.projectId, "Project");
        if (!(await client.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 AND status IN ('active', 'on_hold')`, [workspaceId, projectId])).rowCount)
          throw new BadRequestException(`Line ${index + 1}: choose a running project.`);
      }
      // Restocking free stock: the line names the stock item it refills, in that item's name and unit.
      let stockItemId: string | null = null;
      if (source === "free" && input.stockItemId) {
        if (projectId) throw new BadRequestException(`Line ${index + 1}: restocking is for free stock, not a project.`);
        const item = (await client.query<{ id: string; name: string; unit: string }>(`SELECT id, name, unit FROM stock_items WHERE workspace_id = $1 AND id = $2 AND active`,
          [workspaceId, uuid(input.stockItemId, "Stock item")])).rows[0];
        if (!item) throw new BadRequestException(`Line ${index + 1}: that stock item isn't kept.`);
        origin = { projectId: "", title: item.name, detail: "", unit: item.unit, catalogItemId: null };
        stockItemId = item.id;
      }
      const description = text(input.description, 500, "Description") || origin?.title || "";
      if (!description) throw new BadRequestException(`Line ${index + 1}: say what's being ordered.`);
      const quantity = amount(input.quantity, `Line ${index + 1}: quantity`);
      if (Dec.of(quantity).cmp(0) <= 0) throw new BadRequestException(`Line ${index + 1}: order more than zero.`);
      let unitPrice = input.unitPrice === undefined || input.unitPrice === null || input.unitPrice === "" ? null : amount(input.unitPrice, `Line ${index + 1}: price`);
      // A valid rate contract's price first, then the supplier's catalog price.
      if (unitPrice === null && origin?.catalogItemId && defaults.vendorId !== NO_VENDOR)
        unitPrice = (await contractPrice(client, workspaceId, defaults.vendorId, origin.catalogItemId, defaults.currency))?.unitPrice ?? null;
      if (unitPrice === null && origin?.catalogItemId)
        unitPrice = (await client.query<{ cost: string }>(
          `SELECT cost::text AS cost FROM catalog_supplier_links WHERE workspace_id = $1 AND item_id = $2 AND vendor_id = $3 AND cost IS NOT NULL AND currency = $4 ORDER BY preferred DESC, updated_at DESC LIMIT 1`,
          [workspaceId, origin.catalogItemId, defaults.vendorId, defaults.currency])).rows[0]?.cost ?? null;
      const discountPercent = input.discountPercent === undefined || input.discountPercent === null || input.discountPercent === "" ? defaults.discount : amount(input.discountPercent, `Line ${index + 1}: discount`);
      if (Dec.of(discountPercent).cmp(100) >= 0) throw new BadRequestException(`Line ${index + 1}: the discount is under 100%.`);
      const taxRate = input.taxRate === undefined || input.taxRate === null || input.taxRate === "" ? defaults.tax : amount(input.taxRate, `Line ${index + 1}: tax`);
      if (Dec.of(taxRate).cmp(100) > 0) throw new BadRequestException(`Line ${index + 1}: tax is at most 100%.`);
      out.push({ id, source, materialItemId: source === "material" ? input.materialItemId as string : null, boqLineId: source === "line" ? input.boqLineId as string : null, projectId,
        description, specification: text(input.specification, 1000, "Specification") || (input.specification === undefined ? origin?.detail ?? "" : ""),
        quantity, unit: this.unit(text(input.unit, 40, "Unit"), origin, index), unitPrice: unitPrice ?? "0", discountPercent, taxRate,
        replacesLineId: typeof input.replacesLineId === "string" && UUID.test(input.replacesLineId) ? input.replacesLineId : null, stockItemId });
    }
    return out;
  }

  /**
   * Writes an order's lines in place. A line with deliveries or returns against it stays (it can't be
   * removed, pointed at something else or change unit) and can't be ordered below what has arrived.
   */
  /** A material or scope line is ordered in its own unit, so what's needed and what's ordered add up. */
  private unit(given: string, origin: { title: string; unit: string } | null, index: number) {
    if (!origin || !origin.unit.trim()) return given;
    if (given && given.toLocaleLowerCase() !== origin.unit.trim().toLocaleLowerCase()) throw new BadRequestException(`Line ${index + 1}: order ${origin.title} in ${origin.unit}.`);
    return origin.unit;
  }

  /** Lines under a valid rate contract with this supplier: its reference and price, and whether the line costs more. */
  private async contracts(client: Db, workspaceId: string, order: OrderDetail) {
    const rows = (await client.query<{ lineId: string; unitPrice: string; catalogItemId: string | null }>(
      `SELECT line.id AS "lineId", line.unit_price::text AS "unitPrice", coalesce(material.catalog_item_id, scope.catalog_item_id) AS "catalogItemId"
         FROM purchase_order_lines line
         LEFT JOIN project_material_items material ON material.workspace_id = line.workspace_id AND material.id = line.material_item_id
         LEFT JOIN project_boq_lines scope ON scope.workspace_id = line.workspace_id AND scope.id = line.boq_line_id
        WHERE line.workspace_id = $1 AND line.order_id = $2`, [workspaceId, order.id])).rows;
    const out: Array<{ lineId: string; reference: string; unitPrice: string; above: boolean }> = [];
    for (const row of rows.filter((item) => item.catalogItemId)) {
      const contract = await contractPrice(client, workspaceId, order.vendorId, row.catalogItemId!, order.currency);
      if (contract) out.push({ lineId: row.lineId, reference: contract.reference, unitPrice: contract.unitPrice, above: Dec.of(row.unitPrice).cmp(contract.unitPrice) > 0 });
    }
    return out;
  }

  /**
   * The supplier's pack size and minimum for lines from their catalog (a valid rate contract's own
   * first), with the quantity that fits when the line doesn't.
   */
  private async packs(client: Db, workspaceId: string, order: OrderDetail) {
    const rows = (await client.query<{ lineId: string; quantity: string; catalogItemId: string; packSize: string | null; minimum: string | null }>(
      `SELECT line.id AS "lineId", line.quantity::text AS quantity, coalesce(material.catalog_item_id, scope.catalog_item_id) AS "catalogItemId",
              link.pack_size::text AS "packSize", link.minimum_order::text AS minimum
         FROM purchase_order_lines line
         LEFT JOIN project_material_items material ON material.workspace_id = line.workspace_id AND material.id = line.material_item_id
         LEFT JOIN project_boq_lines scope ON scope.workspace_id = line.workspace_id AND scope.id = line.boq_line_id
         LEFT JOIN LATERAL (SELECT pack_size, minimum_order FROM catalog_supplier_links link
                             WHERE link.workspace_id = line.workspace_id AND link.item_id = coalesce(material.catalog_item_id, scope.catalog_item_id) AND link.vendor_id = $3
                             ORDER BY link.preferred DESC, link.updated_at DESC LIMIT 1) link ON true
        WHERE line.workspace_id = $1 AND line.order_id = $2 AND coalesce(material.catalog_item_id, scope.catalog_item_id) IS NOT NULL`, [workspaceId, order.id, order.vendorId])).rows;
    const plain = (value: string | null) => (value === null || Dec.of(value).isZero() ? null : Dec.of(value).toString());
    const out: Array<{ lineId: string; packSize: string | null; minimum: string | null; suggested: string }> = [];
    for (const row of rows) {
      const contract = await contractPrice(client, workspaceId, order.vendorId, row.catalogItemId, order.currency);
      const packSize = plain(contract?.packSize ?? row.packSize), minimum = plain(contract?.minimum ?? row.minimum);
      if (!packSize && !minimum) continue;
      const suggested = packQuantity(row.quantity, packSize, minimum);
      if (Dec.of(suggested).cmp(row.quantity) !== 0) out.push({ lineId: row.lineId, packSize, minimum, suggested });
    }
    return out;
  }

  /** Lines on this order that take a project past what it needs, by how much. */
  private async overOrdered(client: Db, workspaceId: string, orderId: string) {
    const lines = (await readOrderLines(client, workspaceId, orderId)).filter((line) => line.source !== "free" && line.projectId);
    const needs: Awaited<ReturnType<typeof readNeeds>> = [];
    for (const projectId of new Set(lines.map((line) => line.projectId!))) needs.push(...await readNeeds(client, workspaceId, false, projectId));
    return lines.flatMap((line) => {
      const need = needs.find((item) => item.source === line.source && item.sourceId === (line.materialItemId ?? line.boqLineId));
      if (!need || need.remaining === null || Dec.of(need.remaining).cmp(0) >= 0) return [];
      return [{ lineId: line.id, description: line.description, unit: line.unit, over: Dec.of(need.remaining).neg().toString() }];
    });
  }

  private async writeLines(client: Db, workspaceId: string, orderId: string, lines: LineInput[], currency: string) {
    const decimals = currencyDecimals(currency);
    const existing = new Map((await readOrderLines(client, workspaceId, orderId)).map((line) => [line.id, line]));
    const used = new Set((await client.query<{ id: string }>(
      `SELECT line.id FROM purchase_order_lines line WHERE line.workspace_id = $1 AND line.order_id = $2
          AND (EXISTS (SELECT 1 FROM goods_receipt_lines got WHERE got.workspace_id = line.workspace_id AND got.order_line_id = line.id)
            OR EXISTS (SELECT 1 FROM supplier_return_lines back WHERE back.workspace_id = line.workspace_id AND back.order_line_id = line.id))`, [workspaceId, orderId])).rows.map((row) => row.id));
    const keep = new Set(lines.map((line) => line.id));
    for (const [id, line] of existing) {
      if (keep.has(id)) continue;
      if (used.has(id)) throw new ConflictException(`${line.description} has deliveries against it and stays on the order; change its quantity instead.`);
      await client.query(`DELETE FROM purchase_order_lines WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
    }
    const priced = lines.map((line) => ({ line, amounts: priceLine(line, decimals) }));
    for (const [position, { line, amounts }] of priced.entries()) {
      const before = existing.get(line.id);
      if (before && used.has(line.id)) {
        if (before.source !== line.source || before.materialItemId !== line.materialItemId || before.boqLineId !== line.boqLineId || before.unit.toLocaleLowerCase() !== line.unit.toLocaleLowerCase())
          throw new ConflictException(`${before.description} has deliveries against it; it can't be changed to something else or another unit.`);
        const arrived = Dec.of(before.accepted).add(before.pending);
        if (Dec.of(line.quantity).cmp(arrived) < 0) throw new ConflictException(`${before.description}: ${arrived.toString()} ${before.unit} has already arrived; order at least that.`);
      }
      // A restock line keeps the stock item it refills while it stays a free line for no project, in that item's unit.
      const stockItemId = line.source === "free" && !line.projectId ? line.stockItemId ?? (before?.unit.toLocaleLowerCase() === line.unit.toLocaleLowerCase() ? before?.stockItemId ?? null : null) : null;
      const values = [line.id, workspaceId, orderId, position, line.projectId, line.source, line.materialItemId, line.boqLineId, line.description, line.specification, line.quantity, line.unit,
        line.unitPrice, line.discountPercent, line.taxRate, amounts.net, amounts.tax, amounts.total, line.replacesLineId ?? before?.replacesLineId ?? null, stockItemId];
      // A new line never takes an id already used elsewhere.
      if (!before && (await client.query(`SELECT 1 FROM purchase_order_lines WHERE workspace_id = $1 AND id = $2`, [workspaceId, line.id])).rowCount) values[0] = randomUUID();
      if (before)
        await client.query(
          `UPDATE purchase_order_lines SET position = $4, project_id = $5, source = $6, material_item_id = $7, boq_line_id = $8, description = $9, specification = $10, quantity = $11,
                  unit = $12, unit_price = $13, discount_percent = $14, tax_rate = $15, net = $16, tax = $17, total = $18, replaces_line_id = $19, stock_item_id = $20
            WHERE id = $1 AND workspace_id = $2 AND order_id = $3`, values);
      else
        await client.query(
          `INSERT INTO purchase_order_lines (id, workspace_id, order_id, position, project_id, source, material_item_id, boq_line_id, description, specification, quantity, unit, unit_price,
                                             discount_percent, tax_rate, net, tax, total, replaces_line_id, stock_item_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`, values);
    }
    const totals = orderTotals(priced.map((item) => item.amounts), decimals);
    await client.query(`UPDATE purchase_orders SET subtotal = $3, discount_total = $4, tax_total = $5, total = $6 WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, orderId, totals.subtotal, totals.discountTotal, totals.taxTotal, totals.total]);
  }

  /** What must be true before an order goes out: priced lines, an approved supplier and signed-off material lists. */
  private async checkReady(client: Db, workspaceId: string, order: OrderDetail) {
    const settings = await ensurePurchasingSettings(client, workspaceId);
    const lines = await readOrderLines(client, workspaceId, order.id);
    if (!lines.length) throw new ConflictException("Add at least one line.");
    const unpriced = lines.find((line) => Dec.of(line.unitPrice).isZero());
    if (unpriced) throw new ConflictException(`Enter a price for ${unpriced.description}.`);
    const supplier = await readSupplier(client, workspaceId, order.vendorId);
    if (!supplier || supplier.status === "archived") throw new ConflictException("The supplier is archived.");
    if (settings.requireApprovedSupplier && supplier.approval !== "approved") throw new ConflictException(`${supplier.name} isn't approved as a supplier yet.`);
    if (settings.requireMaterialSignoff) {
      // Only materials the client chooses wait for their sign-off.
      const chosen = (await client.query<{ projectId: string; reference: string }>(
        `SELECT DISTINCT line.project_id AS "projectId", project.reference FROM purchase_order_lines line
           JOIN project_material_items item ON item.workspace_id = line.workspace_id AND item.id = line.material_item_id
           JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
          WHERE line.workspace_id = $1 AND line.order_id = $2 AND item.client_choice`, [workspaceId, order.id])).rows;
      for (const { projectId, reference } of chosen)
        if (!(await clientChoicesSignedOff(client, workspaceId, projectId))) throw new ConflictException(`The client hasn't signed off ${reference}'s material list yet.`);
    }
  }

  /** The projects on an order that are on hold now. */
  private async projectsOnHold(client: Db, workspaceId: string, orderId: string) {
    return (await client.query<{ id: string; reference: string }>(
      `SELECT DISTINCT project.id, project.reference FROM purchase_order_lines line
         JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
        WHERE line.workspace_id = $1 AND line.order_id = $2 AND project.status = 'on_hold' ORDER BY project.reference`, [workspaceId, orderId])).rows;
  }

  /**
   * Hold means hold: an order for a project on hold goes ahead only when someone who buys or approves says
   * why (once per order; the reason is kept on it and the projects' managers hear).
   */
  private async goesAheadOnHold(client: Db, workspaceId: string, order: OrderDetail, body: Record<string, unknown>, userId: string,
    set: (sql: string, values: unknown[]) => Promise<unknown>) {
    if (order.holdOverrideAt) return;
    const held = await this.projectsOnHold(client, workspaceId, order.id);
    if (!held.length) return;
    const reason = text(body.holdReason, 500, "Reason");
    const names = held.map((project) => project.reference).join(", ");
    if (!reason) throw new ConflictException(`${names} ${held.length === 1 ? "is" : "are"} on hold. Say why this order goes ahead anyway.`);
    await set(`hold_override_by = $3, hold_override_at = now(), hold_override_reason = $4`, [userId, reason]);
    await orderEvent(client, workspaceId, order.id, "hold_override", { reason, projects: held.map((project) => project.reference) }, userId);
    await this.tell(client, workspaceId, order, "purchasing.hold_override", await this.projectManagers(client, workspaceId, held.map((project) => project.id)), userId,
      `${names}: ${reason}`.slice(0, 480));
  }

  /** The active managers of these projects. */
  private async projectManagers(client: Db, workspaceId: string, projectIds: string[]) {
    if (!projectIds.length) return [];
    return (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
         JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
        WHERE assignment.workspace_id = $1 AND assignment.project_id = ANY($2::uuid[]) AND assignment.active AND assignment.is_manager`, [workspaceId, projectIds])).rows.map((row) => row.userId);
  }

  /**
   * Adds or updates a shipment on an order (version-checked when it exists). An expected arrival that
   * moves later, or a shipment marked delayed, tells the buyer and the projects' managers once per date.
   */
  private async track(client: Db, workspaceId: string, order: OrderDetail, body: Record<string, unknown>, userId: string) {
    const id = uuid(body.shipmentId, "Shipment");
    const existing = (await client.query<{ status: string; eta: string | null; version: number; orderId: string }>(
      `SELECT status, eta::text AS eta, version, order_id AS "orderId" FROM purchase_order_shipments WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, id])).rows[0];
    if (existing && existing.orderId !== order.id) throw new BadRequestException("That shipment is on another order.");
    if (existing && body.shipmentVersion !== existing.version) throw new ConflictException("Someone else changed this shipment. Reload to see their changes.");
    const carrier = text(body.carrier, 120, "Carrier");
    const trackingRef = text(body.trackingRef, 120, "Tracking reference");
    const trackingUrl = text(body.trackingUrl, 500, "Tracking link");
    if (trackingUrl && !/^https?:\/\/\S+$/i.test(trackingUrl)) throw new BadRequestException("The tracking link starts with https://.");
    const shipStatus = oneOf(body.status ?? existing?.status ?? "booked", SHIPMENT_STATUSES, "Shipment status");
    const shippedOn = date(body.shippedOn, "Shipped on");
    const eta = date(body.eta, "Expected on");
    if (eta && shippedOn && eta < shippedOn) throw new BadRequestException("It can't arrive before it ships.");
    if (!carrier && !trackingRef && !eta) throw new BadRequestException("Add the carrier, the tracking reference or when it arrives.");
    const note = text(body.note, 500, "Note");
    if (shipStatus === "delayed" && !note && !eta) throw new BadRequestException("Say why it's delayed, or when it now arrives.");
    if (existing)
      await client.query(`UPDATE purchase_order_shipments SET carrier = $3, tracking_ref = $4, tracking_url = $5, status = $6, shipped_on = $7, eta = $8, note = $9, updated_by = $10,
          version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, carrier, trackingRef, trackingUrl, shipStatus, shippedOn, eta, note, userId]);
    else
      await client.query(`INSERT INTO purchase_order_shipments (id, workspace_id, order_id, carrier, tracking_ref, tracking_url, status, shipped_on, eta, note, created_by, updated_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`, [id, workspaceId, order.id, carrier, trackingRef, trackingUrl, shipStatus, shippedOn, eta, note, userId]);
    await orderEvent(client, workspaceId, order.id, existing ? "shipment_updated" : "shipment_added", { carrier, trackingRef, status: shipStatus, eta, was: existing?.eta ?? null, note }, userId);
    const later = Boolean(eta && existing?.eta && eta > existing.eta);
    if (later || (shipStatus === "delayed" && existing?.status !== "delayed")) {
      const projects = (await client.query<{ id: string }>(`SELECT DISTINCT project_id AS id FROM purchase_order_lines WHERE workspace_id = $1 AND order_id = $2 AND project_id IS NOT NULL`,
        [workspaceId, order.id])).rows.map((row) => row.id);
      await this.tell(client, workspaceId, order, "purchasing.shipment_late", [order.createdBy, order.submittedBy, ...await this.projectManagers(client, workspaceId, projects)], userId,
        [eta ? `now arrives ${eta}${existing?.eta ? ` (was ${existing.eta})` : ""}` : "delayed", note].filter(Boolean).join(": ").slice(0, 480), false, `${id}:${eta ?? shipStatus}`);
    }
    return { shipmentId: id, carrier, trackingRef, status: shipStatus, eta, was: existing?.eta ?? null };
  }

  /** An order with a supplier on hold waits until someone who approves orders says it continues. */
  async notHeld(client: Db, workspaceId: string, order: OrderDetail) {
    const supplier = await readSupplier(client, workspaceId, order.vendorId);
    if (supplier && (supplier.approval === "on_hold" || supplier.approval === "not_approved") && !order.continuedAt)
      throw new ConflictException(`${supplier.name} is on hold. Someone who approves orders decides whether this order continues.`);
  }

  /** Recomputes an order's totals from its lines' own rounded amounts. */
  private async refreshTotals(client: Db, workspaceId: string, orderId: string, currency: string) {
    const decimals = currencyDecimals(currency);
    const totals = orderTotals((await readOrderLines(client, workspaceId, orderId)).map((line) => priceLine(line, decimals)), decimals);
    await client.query(`UPDATE purchase_orders SET subtotal = $3, discount_total = $4, tax_total = $5, total = $6 WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, orderId, totals.subtotal, totals.discountTotal, totals.taxTotal, totals.total]);
  }

  private async approvers(client: Db, workspaceId: string) {
    return (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
         JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
         JOIN role_permissions granted ON granted.role_id = effective_role.role_id
         JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'purchasing.approve'
        WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows.map((row) => row.userId);
  }

  /**
   * The spending guard on placing an order: off lets it through; warn lets it through, records it and tells
   * the projects' managers and cost managers; strict stops it unless someone who may override approved it.
   */
  private async guardFunds(client: Db, workspaceId: string, order: OrderDetail, guard: "off" | "warn" | "strict", actorId: string) {
    if (guard === "off") return;
    const short = await fundsShort(client, workspaceId, order.id);
    if (!short.length) return;
    if (guard === "strict" && !order.fundsOverrideReason)
      throw new ConflictException(`Not enough money in hand. ${describeShort(short)}. Ask someone who may override to let it go ahead.`);
    if (guard === "warn") {
      await orderEvent(client, workspaceId, order.id, "over_funds", { short: describeShort(short) }, actorId);
      await this.tell(client, workspaceId, order, "purchasing.over_funds", await this.moneyPeople(client, workspaceId, short), actorId, describeShort(short).slice(0, 480));
    }
  }

  /** The managers of the projects short of money, and the people who manage costs. */
  private async moneyPeople(client: Db, workspaceId: string, short: FundsShort[]) {
    return (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
        WHERE membership.workspace_id = $1 AND membership.status = 'active' AND (
          EXISTS (SELECT 1 FROM project_assignments assignment WHERE assignment.workspace_id = membership.workspace_id AND assignment.membership_id = membership.id
                   AND assignment.project_id = ANY($2::uuid[]) AND assignment.active AND assignment.is_manager)
          OR EXISTS (SELECT 1 FROM effective_member_roles effective_role JOIN role_permissions granted ON granted.role_id = effective_role.role_id
                      JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'commercial.costs.manage'
                     WHERE effective_role.membership_id = membership.id))`, [workspaceId, short.map((item) => item.projectId)])).rows.map((row) => row.userId);
  }

  private async tellApprovers(client: Db, workspaceId: string, order: OrderDetail, actorId: string) {
    const approvers = (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
         JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
         JOIN role_permissions granted ON granted.role_id = effective_role.role_id
         JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'purchasing.approve'
        WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows;
    await this.tell(client, workspaceId, order, "purchasing.approval_needed", approvers.map((row) => row.userId), actorId, "", true);
  }

  private async tell(client: Db, workspaceId: string, order: OrderDetail, code: string, userIds: Array<string | null>, actorId: string, note: string, email = false, once?: string) {
    const actor = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [actorId])).rows[0]?.name ?? "Someone";
    const amount = `${order.currency} ${Dec.of(order.total).toFixed(currencyDecimals(order.currency))}`;
    const variables = { order: order.number, supplier: order.supplierName, amount, actor, note };
    for (const userId of new Set(userIds.filter((id): id is string => Boolean(id) && id !== actorId))) {
      const message = { workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink: `/workspace/purchasing/orders?order=${order.id}` };
      const key = `${code}:${order.id}:${once ?? order.version}:${userId}`.slice(0, 200);
      await notifyUserInApp(client, { ...message, idempotencyKey: key });
      if (email) await queueUserEmail(client, { ...message, idempotencyKey: `${key}:email` });
    }
  }

  /** The order, in the firm's branded email, to the supplier. Returns how it went; never throws. */
  private async emailSupplier(workspaceId: string, detail: Awaited<ReturnType<OrdersService["detail"]>>, to: string, message: string) {
    if (!this.email) return "not_configured";
    try {
      const { order, lines } = detail;
      const decimals = currencyDecimals(order.currency);
      const money = (value: string) => `${order.currency} ${Dec.of(value).toFixed(decimals)}`;
      const brand = await this.email.brand({ workspaceId });
      const paragraphs = [
        ...(message ? [message] : []),
        ...lines.map((line) => `${line.description}${line.specification ? ` (${line.specification})` : ""}: ${Dec.of(line.quantity).toString()} ${line.unit} × ${money(line.unitPrice)}${Dec.of(line.discountPercent).isZero() ? "" : ` less ${Dec.of(line.discountPercent).toString()}%`} = ${money(line.net)}`),
        `Total ${money(order.total)}${Dec.of(order.taxTotal).isZero() ? "" : ` including tax ${money(order.taxTotal)}`}.`,
        ...(order.expectedDate ? [`Needed by ${order.expectedDate}.`] : []),
        ...(order.deliveryAddress ? [`Deliver to: ${order.deliveryAddress}`] : []),
        `Please confirm this order and your delivery date. Order ${order.number} from ${order.companyName}.`,
      ];
      const { html, text: plain } = renderBrandedEmail({ brand, preheader: `Purchase order ${order.number}`, heading: `Purchase order ${order.number}`, paragraphs });
      const result = await this.email.send({ to, subject: `Purchase order ${order.number} · ${order.companyName}`, text: plain, html, fromName: brand.name });
      return result.status;
    } catch (error) {
      this.logger.error(`Couldn't email purchase order ${detail.order.number}: ${(error as Error).message}`);
      return "failed";
    }
  }
}

function statusMessage(status: string) {
  return status === "cancelled" ? "The order is cancelled." : status === "pending_approval" ? "The order is waiting for approval." : status === "draft" ? "The order is still a draft."
    : status === "partly_received" || status === "received" ? "Goods have arrived on this order; it can only be closed now."
    : status === "closed" ? "The order is closed." : "The order has moved on; reload to see it.";
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

function date(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} must be a date.`);
  return value;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (!options.includes(value as T)) throw new BadRequestException(`${label} is not valid.`);
  return value as T;
}
