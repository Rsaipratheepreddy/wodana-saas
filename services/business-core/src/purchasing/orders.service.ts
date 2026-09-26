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
import { materialsSignedOff } from "../project-core/project-materials";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import {
  DELIVER_TO, currencyDecimals, defaultTaxRate, ensurePurchasingSettings, nextOrderNumber, orderEvent, orderTotals, priceLine, readNeeds, readOrder, readOrderEvents, readOrderLines,
  readOrders, type OrderDetail, type OrderLine,
} from "./orders";
import { PAYMENT_TERMS, percent, readSupplier, type Supplier } from "./suppliers";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^\d{1,14}(\.\d{1,4})?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type LineInput = {
  id: string; source: "material" | "line" | "free"; materialItemId: string | null; boqLineId: string | null; projectId: string | null;
  description: string; specification: string; quantity: string; unit: string; unitPrice: string; discountPercent: string; taxRate: string;
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
      const threshold = body.approvalThreshold === null || body.approvalThreshold === "" ? null : String(body.approvalThreshold ?? current.approvalThreshold ?? "");
      if (threshold !== null && !NUMBER.test(threshold)) throw new BadRequestException("Enter the amount from which orders need approval, or leave it empty.");
      const flag = (key: "requireMaterialSignoff" | "requireApprovedSupplier") => (body[key] === undefined ? current[key] : body[key] === true);
      await client.query(`UPDATE workspace_purchasing_settings SET approval_threshold = $2, require_material_signoff = $3, require_approved_supplier = $4, version = version + 1, updated_by = $5, updated_at = now()
        WHERE workspace_id = $1`, [workspaceId, threshold, flag("requireMaterialSignoff"), flag("requireApprovedSupplier"), user.userId]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "purchasing.settings_changed", entityType: "workspace", entityId: workspaceId, before: current, after: body });
      return ensurePurchasingSettings(client, workspaceId);
    });
  }

  /** A new draft order to one supplier, usually from selected needs. Creating it again with the same id changes nothing. */
  create(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "purchasing.manage", async (client, user) => {
      const id = uuid(body.id, "Order");
      if ((await client.query(`SELECT 1 FROM purchase_orders WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rowCount) return this.detail(client, workspaceId, id, user.userId);
      const supplier = await this.supplier(client, workspaceId, body.vendorId);
      const legalEntityId = await this.company(client, workspaceId, supplier, body.legalEntityId);
      const currency = supplier.currency ?? (await client.query<{ currency: string }>(`SELECT base_currency AS currency FROM legal_entities WHERE workspace_id = $1 AND id = $2`, [workspaceId, legalEntityId])).rows[0].currency;
      const tax = await defaultTaxRate(client, workspaceId, legalEntityId);
      const discount = supplier.deal === "discount" ? supplier.dealPercent ?? "0" : "0";
      const lines = await this.lines(client, workspaceId, body.lines, { tax, discount, vendorId: supplier.id, currency });
      const header = this.header(body);
      const number = await nextOrderNumber(client, workspaceId, legalEntityId);
      await client.query(
        `INSERT INTO purchase_orders (id, workspace_id, number, legal_entity_id, vendor_id, currency, payment_terms, advance_percent, credit_days, terms_note, deliver_to, delivery_address,
                                      expected_date, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [id, workspaceId, number, legalEntityId, supplier.id, currency, supplier.paymentTerms, supplier.advancePercent, supplier.creditDays, supplier.termsNote,
          header.deliverTo, header.deliveryAddress, header.expectedDate, header.notes, user.userId]);
      await this.writeLines(client, workspaceId, id, lines, currency);
      await orderEvent(client, workspaceId, id, "created", { number, lines: lines.length }, user.userId);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "purchase_order.created", entityType: "purchase_order", entityId: id, after: { number, vendorId: supplier.id, lines: lines.length } });
      return this.detail(client, workspaceId, id, user.userId);
    });
  }

  command(actor: RequestActor, workspaceId: string, orderId: string, body: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, ["purchasing.manage", "purchasing.approve"], async (client, user) => {
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
        await set(`deliver_to = $3, delivery_address = $4, expected_date = $5, notes = $6, payment_terms = $7, advance_percent = $8, credit_days = $9, terms_note = $10`,
          [header.deliverTo, header.deliveryAddress, header.expectedDate, header.notes, terms.paymentTerms, terms.advancePercent, terms.creditDays, terms.termsNote]);
        if (lines) await this.writeLines(client, workspaceId, orderId, lines, order.currency);
        audit = { header, terms, lines: lines?.length };
      } else if (action === "submit") {
        await need("purchasing.manage", "You can't raise purchase orders.");
        status("draft");
        await this.checkReady(client, workspaceId, order);
        const settings = await ensurePurchasingSettings(client, workspaceId);
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
          await set(`status = 'approved', approved_at = now(), approved_by = $3`, [user.userId]);
        } else await set(`status = 'draft', submitted_by = NULL`, []);
        await orderEvent(client, workspaceId, orderId, action === "approve" ? "approved" : "returned", { note }, user.userId);
        await this.tell(client, workspaceId, order, action === "approve" ? "purchasing.approved" : "purchasing.returned", [order.createdBy, order.submittedBy], user.userId, note);
        audit = { note };
      } else if (action === "send") {
        await need("purchasing.manage", "You can't send purchase orders.");
        status("approved");
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
        await need("purchasing.manage", "You can't record supplier confirmations.");
        status("sent", "confirmed");
        const promised = date(body.promisedDate, "Promised date");
        const reference = text(body.supplierReference, 120, "Supplier reference");
        await set(`status = 'confirmed', confirmed_at = coalesce(confirmed_at, now()), promised_date = $3, supplier_reference = $4`, [promised, reference]);
        await orderEvent(client, workspaceId, orderId, "confirmed", { promisedDate: promised, supplierReference: reference }, user.userId);
        audit = { promised, reference };
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
      } else if (action === "cancel") {
        await need("purchasing.manage", "You can't cancel purchase orders.");
        status("draft", "pending_approval", "approved", "sent", "confirmed");
        const reason = text(body.reason, 500, "Reason");
        if (!reason) throw new BadRequestException("Say why the order is cancelled.");
        await set(`status = 'cancelled', cancelled_at = now(), cancel_reason = $3`, [reason]);
        await orderEvent(client, workspaceId, orderId, "cancelled", { reason, was: order.status }, user.userId);
        audit = { reason };
      } else {
        throw new BadRequestException("Unknown action.");
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `purchase_order.${action}`, entityType: "purchase_order", entityId: orderId, after: audit });
      const detail = await this.detail(client, workspaceId, orderId, user.userId);
      return { ...detail, email };
    }).then(async (result) => {
      // The supplier's email goes out once the order is saved as sent.
      if (!result.email) return { ...result, delivery: null };
      const delivery = await this.emailSupplier(workspaceId, result, result.email.to, result.email.message);
      await this.access.withAnyPermission(actor, workspaceId, ["purchasing.manage"], (client, user) =>
        orderEvent(client, workspaceId, orderId, delivery === "sent" ? "emailed" : "email_not_sent", { to: result.email!.to, status: delivery }, user.userId));
      return { ...result, delivery };
    });
  }

  // ---------- helpers ----------
  private async detail(client: Db, workspaceId: string, orderId: string, userId: string) {
    const order = await readOrder(client, workspaceId, orderId);
    if (!order) throw new NotFoundException("Order not found.");
    const supplier = await readSupplier(client, workspaceId, order.vendorId);
    const rights = await this.rights(client, workspaceId, userId);
    return {
      order, lines: await readOrderLines(client, workspaceId, orderId), events: await readOrderEvents(client, workspaceId, orderId),
      revisions: (await client.query<{ revision: number; reason: string; at: string; byName: string }>(
        `SELECT revision.revision, revision.reason, revision.created_at AS at, person.display_name AS "byName" FROM purchase_order_revisions revision JOIN users person ON person.id = revision.created_by
          WHERE revision.workspace_id = $1 AND revision.order_id = $2 ORDER BY revision.revision`, [workspaceId, orderId])).rows,
      supplier: supplier ? { id: supplier.id, name: supplier.name, email: supplier.email, phone: supplier.phone, contactName: supplier.contactName, approval: supplier.approval, deal: supplier.deal, dealPercent: supplier.dealPercent } : null,
      ...rights,
      canApproveThis: rights.canApprove && order.status === "pending_approval" && order.createdBy !== userId && order.submittedBy !== userId,
    };
  }

  private async rights(client: Db, workspaceId: string, userId: string) {
    return {
      canBuy: await this.access.hasPermission(client, workspaceId, userId, "purchasing.manage"),
      canApprove: await this.access.hasPermission(client, workspaceId, userId, "purchasing.approve"),
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
    return { paymentTerms, advancePercent, creditDays: days, termsNote: body.termsNote === undefined ? current.termsNote : text(body.termsNote, 500, "Terms note") };
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
      const description = text(input.description, 500, "Description") || origin?.title || "";
      if (!description) throw new BadRequestException(`Line ${index + 1}: say what's being ordered.`);
      const quantity = amount(input.quantity, `Line ${index + 1}: quantity`);
      if (Dec.of(quantity).cmp(0) <= 0) throw new BadRequestException(`Line ${index + 1}: order more than zero.`);
      let unitPrice = input.unitPrice === undefined || input.unitPrice === null || input.unitPrice === "" ? null : amount(input.unitPrice, `Line ${index + 1}: price`);
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
        quantity, unit: text(input.unit, 40, "Unit") || origin?.unit || "", unitPrice: unitPrice ?? "0", discountPercent, taxRate });
    }
    return out;
  }

  private async writeLines(client: Db, workspaceId: string, orderId: string, lines: LineInput[], currency: string) {
    const decimals = currencyDecimals(currency);
    await client.query(`DELETE FROM purchase_order_lines WHERE workspace_id = $1 AND order_id = $2`, [workspaceId, orderId]);
    const priced = lines.map((line) => ({ line, amounts: priceLine(line, decimals) }));
    for (const [position, { line, amounts }] of priced.entries())
      await client.query(
        `INSERT INTO purchase_order_lines (id, workspace_id, order_id, position, project_id, source, material_item_id, boq_line_id, description, specification, quantity, unit, unit_price,
                                           discount_percent, tax_rate, net, tax, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [line.id, workspaceId, orderId, position, line.projectId, line.source, line.materialItemId, line.boqLineId, line.description, line.specification, line.quantity, line.unit,
          line.unitPrice, line.discountPercent, line.taxRate, amounts.net, amounts.tax, amounts.total]);
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
      const projects = new Map(lines.filter((line: OrderLine) => line.source !== "free" && line.projectId).map((line) => [line.projectId!, line.projectReference]));
      for (const [projectId, reference] of projects)
        if (!(await materialsSignedOff(client, workspaceId, projectId))) throw new ConflictException(`The client hasn't signed off ${reference}'s material list yet.`);
    }
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

  private async tell(client: Db, workspaceId: string, order: OrderDetail, code: string, userIds: Array<string | null>, actorId: string, note: string, email = false) {
    const actor = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [actorId])).rows[0]?.name ?? "Someone";
    const amount = `${order.currency} ${Dec.of(order.total).toFixed(currencyDecimals(order.currency))}`;
    const variables = { order: order.number, supplier: order.supplierName, amount, actor, note };
    for (const userId of new Set(userIds.filter((id): id is string => Boolean(id) && id !== actorId))) {
      const message = { workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink: `/workspace/purchasing/orders?order=${order.id}` };
      const key = `${code}:${order.id}:${order.version}:${userId}`;
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
