import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp } from "../notifications/default-templates";
import { event as boqEvent } from "../project-core/project-scope";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { currencyDecimals, ensurePurchasingSettings, orderEvent, readOrder, readOrderLines, readOrders, type OrderDetail } from "./orders";
import {
  RECEIVABLE, outstanding, placesFor, readLocations, readReceipt, readReceiptLines, readReceipts, receivable, receivedStatus, resolvePlace, type ReceiptLine,
} from "./receiving";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^\d{1,14}(\.\d{1,4})?$/;

/**
 * Goods arriving against purchase orders. Whoever receives counts what came and where it went; when the
 * firm inspects deliveries, everything waits until someone else accepts or rejects it (with the reason).
 * Accepted goods complete the order's lines; rejected goods are still owed by the supplier.
 */
@Injectable()
export class ReceivingService {
  constructor(private readonly access: WorkspaceAccessService) {}

  /** What's expected, what's waiting for inspection and what arrived lately. */
  deliveries(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["purchasing.view", "stock.receive", "stock.inspect"], async (client, user) => {
      const open = (await readOrders(client, workspaceId)).filter((order) => (RECEIVABLE as readonly string[]).includes(order.status));
      const left = open.length ? (await client.query<{ orderId: string; lines: number }>(
        `SELECT line.order_id AS "orderId", count(*)::int AS lines FROM purchase_order_lines line
           LEFT JOIN LATERAL (SELECT coalesce(sum(accepted + pending), 0) AS arrived FROM goods_receipt_lines WHERE workspace_id = line.workspace_id AND order_line_id = line.id) got ON true
          WHERE line.workspace_id = $1 AND line.order_id = ANY($2::uuid[]) AND got.arrived < line.quantity GROUP BY line.order_id`,
        [workspaceId, open.map((order) => order.id)])).rows : [];
      const deliverTo = new Map((await client.query<{ id: string; deliverTo: string }>(`SELECT id, deliver_to AS "deliverTo" FROM purchase_orders WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
        [workspaceId, open.map((order) => order.id)])).rows.map((row) => [row.id, row.deliverTo]));
      const expected = open.map((order) => ({ ...order, deliverTo: deliverTo.get(order.id) ?? "site", linesLeft: left.find((row) => row.orderId === order.id)?.lines ?? 0 }))
        .filter((order) => order.linesLeft > 0)
        .sort((a, b) => (a.promisedDate ?? a.expectedDate ?? "9999").localeCompare(b.promisedDate ?? b.expectedDate ?? "9999"));
      return {
        expected,
        inspection: await readReceipts(client, workspaceId, { pending: true }),
        received: await readReceipts(client, workspaceId, { pending: false, limit: 100 }),
        locations: await readLocations(client, workspaceId),
        ...(await this.rights(client, workspaceId, user.userId)),
        userId: user.userId,
      };
    });
  }

  /** Everything the receive form needs for one order: what's left on each line, where it can go and the rules. */
  receiving(actor: RequestActor, workspaceId: string, orderId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["purchasing.manage", "stock.receive"], async (client) => {
      const order = await readOrder(client, workspaceId, orderId);
      if (!order) throw new NotFoundException("Order not found.");
      const settings = await ensurePurchasingSettings(client, workspaceId);
      const lines = (await readOrderLines(client, workspaceId, orderId)).map((line) => ({
        ...line, outstanding: outstanding(line).toString(), receivable: receivable(line, settings.receiveTolerancePercent).toString(),
      }));
      return { order, lines, ...(await placesFor(client, workspaceId, orderId, order.deliverTo)),
        requireInspection: settings.requireInspection, receiveTolerancePercent: settings.receiveTolerancePercent };
    });
  }

  receipt(actor: RequestActor, workspaceId: string, receiptId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["purchasing.view", "stock.receive", "stock.inspect"], async (client, user) => this.detail(client, workspaceId, receiptId, user.userId));
  }

  /**
   * Records a delivery against an order: how much of each line arrived and where. Nothing beyond what's
   * still to come (plus the allowed over-delivery) can be received. Receiving again with the same id changes nothing.
   */
  receive(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, ["purchasing.manage", "stock.receive"], async (client, user) => {
      const id = uuid(body.id, "Receipt");
      if ((await client.query(`SELECT 1 FROM goods_receipts WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rowCount) return this.detail(client, workspaceId, id, user.userId);
      const orderId = uuid(body.orderId, "Order");
      const order = await readOrder(client, workspaceId, orderId, true);
      if (!order) throw new NotFoundException("Order not found.");
      if (!(RECEIVABLE as readonly string[]).includes(order.status))
        throw new ConflictException(order.status === "approved" ? "Send the order to the supplier before receiving against it." : order.status === "received" ? "Everything on this order has arrived." : "This order isn't open for deliveries.");
      const settings = await ensurePurchasingSettings(client, workspaceId);
      const orderLines = await readOrderLines(client, workspaceId, orderId);
      const receivedOn = date(body.receivedOn, "Received on");
      if ((await client.query<{ future: boolean }>(`SELECT $1::date > current_date + 1 AS future`, [receivedOn])).rows[0].future) throw new BadRequestException("Goods can't be received in the future.");
      const projectIds = [...new Set(orderLines.map((line) => line.projectId).filter((value): value is string => Boolean(value)))];
      const location = await resolvePlace(client, workspaceId, typeof body.place === "string" ? body.place : "", projectIds, randomUUID);
      if (!location) throw new BadRequestException("Choose where the goods arrived.");

      if (!Array.isArray(body.lines) || !body.lines.length) throw new BadRequestException("Enter what arrived.");
      const seen = new Set<string>();
      const lines: Array<{ orderLineId: string; description: string; received: string; accepted: string; rejected: string; pending: string; rejectReason: string }> = [];
      for (const raw of body.lines) {
        const input = (raw ?? {}) as Record<string, unknown>;
        const line = orderLines.find((item) => item.id === input.orderLineId);
        if (!line) throw new BadRequestException("A line isn't on this order.");
        if (seen.has(line.id)) throw new BadRequestException(`${line.description} is entered twice.`);
        seen.add(line.id);
        const received = quantity(input.received, `${line.description}: received`);
        if (Dec.of(received).isZero()) continue;
        const most = receivable(line, settings.receiveTolerancePercent);
        if (Dec.of(received).cmp(most) > 0)
          throw new BadRequestException(most.isZero() ? `${line.description} has fully arrived.` : `${line.description}: at most ${most.toString()} ${line.unit} can arrive.`);
        let accepted = "0", rejected = "0", pending = received, rejectReason = "";
        if (!settings.requireInspection) {
          ({ accepted, rejected, rejectReason } = split(line.description, received, input));
          pending = "0";
        }
        lines.push({ orderLineId: line.id, description: line.description, received, accepted, rejected, pending, rejectReason });
      }
      if (!lines.length) throw new BadRequestException("Enter what arrived.");

      // Receipts are numbered across the workspace, one at a time.
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('goods_receipts:' || $1::text, 0))`, [workspaceId]);
      const number = (await client.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM goods_receipts WHERE workspace_id = $1`, [workspaceId])).rows[0].next;
      await client.query(
        `INSERT INTO goods_receipts (id, workspace_id, number, order_id, location_id, received_on, received_by, delivery_note, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, workspaceId, number, orderId, location.id, receivedOn, user.userId, text(body.deliveryNote, 120, "Delivery note"), text(body.notes, 2000, "Notes")]);
      for (const line of lines)
        await client.query(
          `INSERT INTO goods_receipt_lines (id, workspace_id, receipt_id, order_line_id, received, accepted, rejected, pending, reject_reason) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [randomUUID(), workspaceId, id, line.orderLineId, line.received, line.accepted, line.rejected, line.pending, line.rejectReason]);

      await this.settle(client, workspaceId, order);
      await orderEvent(client, workspaceId, orderId, "received", { receipt: number, location: location.name, lines: lines.length, inspection: settings.requireInspection }, user.userId);
      await this.booked(client, workspaceId, order, lines, user.userId);
      const pending = lines.some((line) => Dec.of(line.pending).cmp(0) > 0);
      if (pending) await this.tell(client, workspaceId, order, id, "purchasing.inspection_needed", await this.inspectors(client, workspaceId), user.userId, location.name);
      else await this.tell(client, workspaceId, order, id, "purchasing.received", [order.createdBy], user.userId, location.name);
      await this.rejectedNotice(client, workspaceId, order, id, lines, user.userId);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "goods_receipt.received", entityType: "goods_receipt", entityId: id,
        after: { number, orderId, location: location.id, receivedOn, lines } });
      return this.detail(client, workspaceId, id, user.userId);
    });
  }

  /** Someone other than the receiver accepts or rejects everything waiting on a receipt. */
  inspect(actor: RequestActor, workspaceId: string, receiptId: string, body: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, ["stock.inspect", "purchasing.approve"], async (client, user) => {
      await client.query(`SELECT 1 FROM goods_receipts WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, receiptId]);
      const receipt = await readReceipt(client, workspaceId, receiptId);
      if (!receipt) throw new NotFoundException("Receipt not found.");
      if (receipt.inspectedAt) {
        if ((await client.query(`SELECT 1 FROM goods_receipts WHERE workspace_id = $1 AND id = $2 AND inspected_by = $3`, [workspaceId, receiptId, user.userId])).rowCount)
          return this.detail(client, workspaceId, receiptId, user.userId);
        throw new ConflictException("This delivery has already been inspected.");
      }
      if (receipt.receivedBy === user.userId) throw new ForbiddenException("Someone else inspects goods you received.");
      const order = (await readOrder(client, workspaceId, receipt.orderId, true))!;
      const waiting = (await readReceiptLines(client, workspaceId, receiptId)).filter((line) => Dec.of(line.pending).cmp(0) > 0);
      if (!waiting.length) throw new ConflictException("Nothing on this delivery is waiting for inspection.");
      const inputs = Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>) : [];
      const results: Array<ReceiptLine & { take: string; refuse: string; reason: string }> = [];
      for (const line of waiting) {
        const input = inputs.find((item) => item?.id === line.id);
        if (!input) throw new BadRequestException(`Say how much of ${line.description} is accepted.`);
        const { accepted, rejected, rejectReason } = split(line.description, line.pending, input);
        results.push({ ...line, take: accepted, refuse: rejected, reason: rejectReason });
      }
      for (const line of results)
        await client.query(
          `UPDATE goods_receipt_lines SET accepted = accepted + $3, rejected = rejected + $4, pending = 0,
                  reject_reason = CASE WHEN $4::numeric > 0 THEN $5 ELSE reject_reason END WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, line.id, line.take, line.refuse, line.reason]);
      await client.query(`UPDATE goods_receipts SET inspected_by = $3, inspected_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, receiptId, user.userId]);
      await this.settle(client, workspaceId, order);
      const settled = results.map((line) => ({ orderLineId: line.orderLineId, description: line.description, accepted: line.take, rejected: line.refuse, rejectReason: line.reason }));
      await orderEvent(client, workspaceId, order.id, "inspected", { receipt: receipt.number, accepted: settled.filter((line) => Dec.of(line.accepted).cmp(0) > 0).length,
        rejected: settled.filter((line) => Dec.of(line.rejected).cmp(0) > 0).length }, user.userId);
      await this.booked(client, workspaceId, order, settled, user.userId);
      await this.tell(client, workspaceId, order, receiptId, "purchasing.received", [order.createdBy, receipt.receivedBy], user.userId, receipt.locationName);
      await this.rejectedNotice(client, workspaceId, order, receiptId, settled, user.userId, [receipt.receivedBy]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "goods_receipt.inspected", entityType: "goods_receipt", entityId: receiptId, after: { lines: settled } });
      return this.detail(client, workspaceId, receiptId, user.userId);
    });
  }

  // ---------- helpers ----------
  private async detail(client: Db, workspaceId: string, receiptId: string, userId: string) {
    const receipt = await readReceipt(client, workspaceId, receiptId);
    if (!receipt) throw new NotFoundException("Receipt not found.");
    const rights = await this.rights(client, workspaceId, userId);
    return { receipt, lines: await readReceiptLines(client, workspaceId, receiptId), ...rights,
      canInspectThis: rights.canInspect && !receipt.inspectedAt && Dec.of(receipt.pending).cmp(0) > 0 && receipt.receivedBy !== userId };
  }

  private async rights(client: Db, workspaceId: string, userId: string) {
    const has = (code: string) => this.access.hasPermission(client, workspaceId, userId, code);
    return { canReceive: (await has("purchasing.manage")) || (await has("stock.receive")), canInspect: (await has("stock.inspect")) || (await has("purchasing.approve")) };
  }

  /** Moves the order to partly received or received from what has arrived on its lines. */
  private async settle(client: Db, workspaceId: string, order: OrderDetail) {
    const next = receivedStatus(await readOrderLines(client, workspaceId, order.id), true);
    if (next && next !== order.status && order.status !== "closed")
      await client.query(`UPDATE purchase_orders SET status = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, order.id, next]);
  }

  /** Accepted goods for a bought scope line show in its history. */
  private async booked(client: Db, workspaceId: string, order: OrderDetail, lines: Array<{ orderLineId: string; accepted: string }>, userId: string) {
    const orderLines = await readOrderLines(client, workspaceId, order.id);
    for (const line of lines) {
      const source = orderLines.find((item) => item.id === line.orderLineId);
      if (source?.boqLineId && source.projectId && Dec.of(line.accepted).cmp(0) > 0)
        await boqEvent(client, workspaceId, source.projectId, source.boqLineId, "received", { order: order.number, quantity: Dec.of(line.accepted).toString(), unit: source.unit }, null, userId);
    }
  }

  private async rejectedNotice(client: Db, workspaceId: string, order: OrderDetail, receiptId: string, lines: Array<{ description: string; rejected: string; rejectReason: string }>,
    actorId: string, also: string[] = []) {
    const rejected = lines.filter((line) => Dec.of(line.rejected).cmp(0) > 0);
    if (!rejected.length) return;
    const note = rejected.map((line) => `${line.description} ${Dec.of(line.rejected).toString()}: ${line.rejectReason}`).join("; ").slice(0, 480);
    await this.tell(client, workspaceId, order, receiptId, "purchasing.rejected", [order.createdBy, order.submittedBy, ...also], actorId, note);
  }

  /** People who can inspect deliveries. */
  private async inspectors(client: Db, workspaceId: string) {
    return (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
         JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
         JOIN role_permissions granted ON granted.role_id = effective_role.role_id
         JOIN permissions permission ON permission.id = granted.permission_id AND permission.code IN ('stock.inspect', 'purchasing.approve')
        WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows.map((row) => row.userId);
  }

  private async tell(client: Db, workspaceId: string, order: OrderDetail, receiptId: string, code: string, userIds: Array<string | null>, actorId: string, note: string) {
    const actor = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [actorId])).rows[0]?.name ?? "Someone";
    const amount = `${order.currency} ${Dec.of(order.total).toFixed(currencyDecimals(order.currency))}`;
    const variables = { order: order.number, supplier: order.supplierName, amount, actor, note };
    for (const userId of new Set(userIds.filter((id): id is string => Boolean(id) && id !== actorId)))
      await notifyUserInApp(client, { workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink: `/workspace/purchasing/deliveries?receipt=${receiptId}`,
        idempotencyKey: `${code}:${receiptId}:${userId}` });
  }
}

/** Splits what's being settled into accepted and rejected; a rejection needs its reason. */
function split(description: string, total: string, input: Record<string, unknown>) {
  const rejected = input.rejected === undefined || input.rejected === null || input.rejected === "" ? "0" : quantity(input.rejected, `${description}: rejected`);
  const accepted = input.accepted === undefined || input.accepted === null || input.accepted === "" ? Dec.of(total).sub(rejected).toString() : quantity(input.accepted, `${description}: accepted`);
  if (Dec.of(accepted).isNegative() || Dec.of(accepted).add(rejected).cmp(total) !== 0)
    throw new BadRequestException(`${description}: accepted and rejected add up to ${Dec.of(total).toString()}.`);
  const rejectReason = text(input.rejectReason, 500, "Reason");
  if (Dec.of(rejected).cmp(0) > 0 && !rejectReason) throw new BadRequestException(`Say why ${description} was rejected.`);
  return { accepted, rejected, rejectReason: Dec.of(rejected).cmp(0) > 0 ? rejectReason : "" };
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

function quantity(value: unknown, label: string) {
  const textValue = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!NUMBER.test(textValue)) throw new BadRequestException(`${label} must be a number with up to 4 decimals.`);
  return textValue;
}

function date(value: unknown, label: string) {
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} must be a date.`);
  return value;
}
