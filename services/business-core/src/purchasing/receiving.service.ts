import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp } from "../notifications/default-templates";
import { move, stockFromReceipt } from "../inventory/stock";
import { event as boqEvent } from "../project-core/project-scope";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { currencyDecimals, ensurePurchasingSettings, firstTime, orderEvent, readOrder, readOrderLines, readOrders, type OrderDetail } from "./orders";
import {
  RECEIVABLE, REJECT_KINDS, outstanding, placesFor, readLocations, readReceipt, readReceiptLines, readReceipts, receivable, resolvePlace, settleOrder, type ReceiptLine, type RejectKind,
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
      // Lines still to come count credits, returns to be replaced and reversed receipts, as the order does.
      const left: Array<{ orderId: string; lines: number }> = [];
      for (const order of open) left.push({ orderId: order.id, lines: (await readOrderLines(client, workspaceId, order.id)).filter((line) => outstanding(line).cmp(0) > 0).length });
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
      if (!(await firstTime(client, workspaceId, id, id, "receive", user.userId))) return this.detail(client, workspaceId, id, user.userId);
      const orderId = uuid(body.orderId, "Order");
      const order = await readOrder(client, workspaceId, orderId, true);
      if (!order) throw new NotFoundException("Order not found.");
      if (!(RECEIVABLE as readonly string[]).includes(order.status))
        throw new ConflictException(order.status === "approved" ? "Send the order to the supplier before receiving against it." : order.status === "received" ? "Everything on this order has arrived." : "This order isn't open for deliveries.");
      const settings = await ensurePurchasingSettings(client, workspaceId);
      const orderLines = await readOrderLines(client, workspaceId, orderId);
      const receivedOn = date(body.receivedOn, "Received on");
      // "Today" is the firm's today, in its time zone.
      if ((await client.query<{ future: boolean }>(
        `SELECT $2::date > (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date AS future FROM workspaces WHERE id = $1`, [workspaceId, receivedOn])).rows[0].future)
        throw new BadRequestException("Goods can't be received in the future.");
      const projectIds = [...new Set(orderLines.map((line) => line.projectId).filter((value): value is string => Boolean(value)))];
      const location = await resolvePlace(client, workspaceId, typeof body.place === "string" ? body.place : "", projectIds, randomUUID);
      if (!location) throw new BadRequestException("Choose where the goods arrived.");

      if (!Array.isArray(body.lines) || !body.lines.length) throw new BadRequestException("Enter what arrived.");
      const seen = new Set<string>();
      const lines: Array<{ id: string; orderLineId: string; description: string; unit: string; received: string; accepted: string; rejected: string; pending: string;
        rejectReason: string; rejectKind: RejectKind | null; noted: string | null }> = [];
      for (const raw of body.lines) {
        const input = (raw ?? {}) as Record<string, unknown>;
        const line = orderLines.find((item) => item.id === input.orderLineId);
        if (!line) throw new BadRequestException("A line isn't on this order.");
        // A project's site holds only that project's goods; another project's lines go to their own site or a store.
        if (location.kind === "site" && line.projectId && line.projectId !== location.projectId)
          throw new BadRequestException(`${line.description} is for ${line.projectReference}; receive it at its own site or a store.`);
        if (seen.has(line.id)) throw new BadRequestException(`${line.description} is entered twice.`);
        seen.add(line.id);
        const received = quantity(input.received, `${line.description}: received`);
        if (Dec.of(received).isZero()) continue;
        const most = receivable(line, settings.receiveTolerancePercent);
        if (Dec.of(received).cmp(most) > 0)
          throw new BadRequestException(most.isZero() ? `${line.description} has fully arrived.` : `${line.description}: at most ${most.toString()} ${line.unit} can arrive.`);
        const noted = input.noted === undefined || input.noted === null || input.noted === "" ? null : quantity(input.noted, `${line.description}: on the delivery note`);
        let accepted = "0", rejected = "0", pending = received, rejectReason = "", rejectKind: RejectKind | null = null;
        if (!settings.requireInspection) {
          ({ accepted, rejected, rejectReason, rejectKind } = split(line.description, received, input));
          pending = "0";
        }
        lines.push({ id: randomUUID(), orderLineId: line.id, description: line.description, unit: line.unit, received, accepted, rejected, pending, rejectReason, rejectKind, noted });
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
          `INSERT INTO goods_receipt_lines (id, workspace_id, receipt_id, order_line_id, received, accepted, rejected, pending, reject_reason, reject_kind, noted, inspected_by, inspected_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [line.id, workspaceId, id, line.orderLineId, line.received, line.accepted, line.rejected, line.pending, line.rejectReason, line.rejectKind, line.noted, null, null]);

      await settleOrder(client, workspaceId, orderId);
      await stockFromReceipt(client, workspaceId, { receiptId: id, lines: lines.map((line) => ({ receiptLineId: line.id, accepted: line.accepted })), actorId: user.userId });
      await orderEvent(client, workspaceId, orderId, "received", { receipt: number, location: location.name, lines: lines.length, inspection: settings.requireInspection }, user.userId);
      await this.booked(client, workspaceId, order, lines, user.userId);
      const pending = lines.some((line) => Dec.of(line.pending).cmp(0) > 0);
      if (pending) await this.tell(client, workspaceId, order, id, "purchasing.inspection_needed", await this.inspectors(client, workspaceId), user.userId, location.name);
      else await this.tell(client, workspaceId, order, id, "purchasing.received", [order.createdBy], user.userId, location.name);
      await this.rejectedNotice(client, workspaceId, order, id, lines, user.userId);
      // Less arrived than the supplier's delivery note says: the buyer claims the rest.
      const missing = lines.filter((line) => line.noted !== null && Dec.of(line.noted).cmp(line.received) > 0)
        .map((line) => `${line.description}: ${Dec.of(line.noted!).sub(line.received).toString()} ${line.unit} missing (note ${Dec.of(line.noted!).toString()}, arrived ${Dec.of(line.received).toString()})`);
      if (missing.length) await this.tell(client, workspaceId, order, id, "purchasing.missing", [order.createdBy, order.submittedBy], user.userId, missing.join("; ").slice(0, 480));
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "goods_receipt.received", entityType: "goods_receipt", entityId: id,
        after: { number, orderId, location: location.id, receivedOn, lines } });
      return this.detail(client, workspaceId, id, user.userId);
    });
  }

  /**
   * Someone other than the receiver accepts or rejects what's waiting, line by line: the lines given are
   * settled now, the rest keep waiting. The delivery counts as inspected once nothing waits.
   */
  inspect(actor: RequestActor, workspaceId: string, receiptId: string, body: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, ["stock.inspect", "purchasing.approve"], async (client, user) => {
      await client.query(`SELECT 1 FROM goods_receipts WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, receiptId]);
      const receipt = await readReceipt(client, workspaceId, receiptId);
      if (!receipt) throw new NotFoundException("Receipt not found.");
      if (receipt.reversedAt) throw new ConflictException("This delivery was reversed.");
      if (receipt.receivedBy === user.userId) throw new ForbiddenException("Someone else inspects goods you received.");
      const order = (await readOrder(client, workspaceId, receipt.orderId, true))!;
      const lines = await readReceiptLines(client, workspaceId, receiptId);
      const inputs = Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>).filter((item) => item && typeof item === "object") : [];
      if (!inputs.length) throw new BadRequestException("Choose what you inspected.");
      const results: Array<ReceiptLine & { take: string; refuse: string; reason: string; kind: RejectKind | null }> = [];
      for (const input of inputs) {
        const line = lines.find((item) => item.id === input.id);
        if (!line) throw new BadRequestException("A line isn't on this delivery.");
        // Inspecting the same line again (a retry) changes nothing.
        if (Dec.of(line.pending).isZero()) continue;
        const { accepted, rejected, rejectReason, rejectKind } = split(line.description, line.pending, input);
        results.push({ ...line, take: accepted, refuse: rejected, reason: rejectReason, kind: rejectKind });
      }
      if (!results.length) return this.detail(client, workspaceId, receiptId, user.userId);
      for (const line of results)
        await client.query(
          `UPDATE goods_receipt_lines SET accepted = accepted + $3, rejected = rejected + $4, pending = 0, inspected_by = $6, inspected_at = now(),
                  reject_reason = CASE WHEN $4::numeric > 0 THEN $5 ELSE reject_reason END, reject_kind = CASE WHEN $4::numeric > 0 THEN $7 ELSE reject_kind END
            WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, line.id, line.take, line.refuse, line.reason, user.userId, line.kind]);
      const done = lines.every((line) => Dec.of(line.pending).isZero() || results.some((item) => item.id === line.id));
      if (done) await client.query(`UPDATE goods_receipts SET inspected_by = $3, inspected_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, receiptId, user.userId]);
      await settleOrder(client, workspaceId, order.id);
      await stockFromReceipt(client, workspaceId, { receiptId, lines: results.map((line) => ({ receiptLineId: line.id, accepted: line.take })), actorId: user.userId });
      const settled = results.map((line) => ({ orderLineId: line.orderLineId, description: line.description, accepted: line.take, rejected: line.refuse, rejectReason: line.reason, rejectKind: line.kind }));
      await orderEvent(client, workspaceId, order.id, "inspected", { receipt: receipt.number, done, accepted: settled.filter((line) => Dec.of(line.accepted).cmp(0) > 0).length,
        rejected: settled.filter((line) => Dec.of(line.rejected).cmp(0) > 0).length }, user.userId);
      await this.booked(client, workspaceId, order, settled, user.userId);
      const pass = createHash("sha256").update(results.map((line) => line.id).sort().join(",")).digest("hex").slice(0, 16);
      await this.tell(client, workspaceId, order, receiptId, "purchasing.received", [order.createdBy, receipt.receivedBy], user.userId, receipt.locationName, pass);
      await this.rejectedNotice(client, workspaceId, order, receiptId, settled, user.userId, [receipt.receivedBy], pass);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "goods_receipt.inspected", entityType: "goods_receipt", entityId: receiptId, after: { lines: settled } });
      return this.detail(client, workspaceId, receiptId, user.userId);
    });
  }

  /**
   * Reverses a delivery entered by mistake: it stops counting, its accepted goods come back out of stock
   * where they went in, and the order's status follows. Not once goods from it went back to the supplier,
   * nor on a closed order. The right delivery is then received again.
   */
  reverse(actor: RequestActor, workspaceId: string, receiptId: string, body: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, ["purchasing.manage", "stock.receive"], async (client, user) => {
      await client.query(`SELECT 1 FROM goods_receipts WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, receiptId]);
      const current = await this.detail(client, workspaceId, receiptId, user.userId);
      if (current.receipt.reversedAt) return current;
      if (!current.canReverseThis) {
        if (current.lines.some((line) => Dec.of(line.returnedRejected).add(line.returnedAccepted).cmp(0) > 0)) throw new ConflictException("Goods from this delivery are going back to the supplier.");
        throw new ForbiddenException(current.canReceive ? "A buyer reverses a delivery someone has inspected." : "You can't reverse deliveries.");
      }
      const reason = text(body.reason, 500, "Reason");
      if (!reason) throw new BadRequestException("Say what was wrong with this delivery.");
      const order = (await readOrder(client, workspaceId, current.receipt.orderId, true))!;
      // Take out exactly what this delivery put into stock.
      const batchId = randomUUID();
      const today = (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].today;
      const posted = (await client.query<{ itemId: string; locationId: string; projectId: string | null; quantity: string; receiptLineId: string }>(
        `SELECT movement.item_id AS "itemId", movement.location_id AS "locationId", movement.project_id AS "projectId", movement.quantity::text AS quantity, movement.receipt_line_id AS "receiptLineId"
           FROM stock_movements movement JOIN goods_receipt_lines line ON line.workspace_id = movement.workspace_id AND line.id = movement.receipt_line_id
          WHERE movement.workspace_id = $1 AND line.receipt_id = $2 AND movement.kind = 'receive'`, [workspaceId, receiptId])).rows;
      for (const movement of posted) {
        try {
          await move(client, workspaceId, { batchId, itemId: movement.itemId, locationId: movement.locationId, projectId: movement.projectId, kind: "reverse",
            quantity: Dec.of(movement.quantity).neg().toString(), forProjectId: movement.projectId, receiptLineId: movement.receiptLineId, reason, movedOn: today, actorId: user.userId });
        } catch (error) {
          if (error instanceof ConflictException) throw new ConflictException("Some of these goods were already used or moved. Bring them back to where they arrived first.");
          throw error;
        }
      }
      await client.query(`UPDATE goods_receipts SET reversed_at = now(), reversed_by = $3, reverse_reason = $4 WHERE workspace_id = $1 AND id = $2`, [workspaceId, receiptId, user.userId, reason]);
      await settleOrder(client, workspaceId, order.id);
      for (const line of current.lines)
        if (line.boqLineId && line.projectId && Dec.of(line.accepted).cmp(0) > 0)
          await boqEvent(client, workspaceId, line.projectId, line.boqLineId, "receipt_reversed", { order: order.number, quantity: Dec.of(line.accepted).toString(), unit: line.unit, reason }, null, user.userId);
      await orderEvent(client, workspaceId, order.id, "receipt_reversed", { receipt: current.receipt.number, reason }, user.userId);
      await this.tell(client, workspaceId, order, receiptId, "purchasing.receipt_reversed", [order.createdBy, current.receipt.receivedBy], user.userId, reason);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "goods_receipt.reversed", entityType: "goods_receipt", entityId: receiptId, after: { reason, stock: posted.length } });
      return this.detail(client, workspaceId, receiptId, user.userId);
    });
  }

  // ---------- helpers ----------
  private async detail(client: Db, workspaceId: string, receiptId: string, userId: string) {
    const receipt = await readReceipt(client, workspaceId, receiptId);
    if (!receipt) throw new NotFoundException("Receipt not found.");
    const rights = await this.rights(client, workspaceId, userId);
    const lines = await readReceiptLines(client, workspaceId, receiptId);
    const order = (await client.query<{ status: string }>(`SELECT status FROM purchase_orders WHERE workspace_id = $1 AND id = $2`, [workspaceId, receipt.orderId])).rows[0];
    const live = !receipt.reversedAt && order?.status !== "closed" && order?.status !== "cancelled";
    const returnable = lines.some((line) => Dec.of(line.rejected).sub(line.returnedRejected).cmp(0) > 0 || Dec.of(line.accepted).sub(line.returnedAccepted).cmp(0) > 0);
    const returned = lines.some((line) => Dec.of(line.returnedRejected).add(line.returnedAccepted).cmp(0) > 0);
    const inspectedAny = lines.some((line) => line.inspectedByName !== null);
    return { receipt, lines, ...rights,
      canInspectThis: rights.canInspect && live && Dec.of(receipt.pending).cmp(0) > 0 && receipt.receivedBy !== userId,
      canReturnThis: rights.canBuy && live && returnable,
      // A wrong receipt is reversed by a buyer, or by its receiver before anyone has inspected it; never once goods went back.
      canReverseThis: live && !returned && (rights.canBuy || (rights.canReceive && receipt.receivedBy === userId && !inspectedAny)) };
  }

  private async rights(client: Db, workspaceId: string, userId: string) {
    const has = (code: string) => this.access.hasPermission(client, workspaceId, userId, code);
    const canBuy = await has("purchasing.manage");
    return { canBuy, canReceive: canBuy || (await has("stock.receive")), canInspect: (await has("stock.inspect")) || (await has("purchasing.approve")) };
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

  private async rejectedNotice(client: Db, workspaceId: string, order: OrderDetail, receiptId: string, lines: Array<{ description: string; rejected: string; rejectReason: string; rejectKind: RejectKind | null }>,
    actorId: string, also: string[] = [], pass = "") {
    const rejected = lines.filter((line) => Dec.of(line.rejected).cmp(0) > 0);
    if (!rejected.length) return;
    const note = rejected.map((line) => `${line.description} ${Dec.of(line.rejected).toString()} (${KIND_WORDS[line.rejectKind ?? "other"]}): ${line.rejectReason}`).join("; ").slice(0, 480);
    await this.tell(client, workspaceId, order, receiptId, "purchasing.rejected", [order.createdBy, order.submittedBy, ...also], actorId, note, pass);
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

  /** Tells people about a delivery; `pass` tells one inspection pass apart from the next on the same delivery. */
  private async tell(client: Db, workspaceId: string, order: OrderDetail, receiptId: string, code: string, userIds: Array<string | null>, actorId: string, note: string, pass = "") {
    const actor = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [actorId])).rows[0]?.name ?? "Someone";
    const amount = `${order.currency} ${Dec.of(order.total).toFixed(currencyDecimals(order.currency))}`;
    const variables = { order: order.number, supplier: order.supplierName, amount, actor, note };
    for (const userId of new Set(userIds.filter((id): id is string => Boolean(id) && id !== actorId)))
      await notifyUserInApp(client, { workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink: `/workspace/purchasing/deliveries?receipt=${receiptId}`,
        idempotencyKey: `${code}:${receiptId}${pass ? `:${pass}` : ""}:${userId}` });
  }
}

const KIND_WORDS: Record<RejectKind, string> = { damaged: "damaged", defective: "defective", wrong_item: "wrong item", wrong_spec: "not to spec", other: "other" };

/** Splits what's being settled into accepted and rejected; a rejection needs what was wrong and a note. */
function split(description: string, total: string, input: Record<string, unknown>): { accepted: string; rejected: string; rejectReason: string; rejectKind: RejectKind | null } {
  const rejected = input.rejected === undefined || input.rejected === null || input.rejected === "" ? "0" : quantity(input.rejected, `${description}: rejected`);
  const accepted = input.accepted === undefined || input.accepted === null || input.accepted === "" ? Dec.of(total).sub(rejected).toString() : quantity(input.accepted, `${description}: accepted`);
  if (Dec.of(accepted).isNegative() || Dec.of(accepted).add(rejected).cmp(total) !== 0)
    throw new BadRequestException(`${description}: accepted and rejected add up to ${Dec.of(total).toString()}.`);
  const rejectReason = text(input.rejectReason, 500, "Reason");
  if (Dec.of(rejected).isZero()) return { accepted, rejected, rejectReason: "", rejectKind: null };
  if (!(REJECT_KINDS as readonly string[]).includes(String(input.rejectKind))) throw new BadRequestException(`Say what was wrong with ${description}.`);
  if (!rejectReason) throw new BadRequestException(`Say why ${description} was rejected.`);
  return { accepted, rejected, rejectReason, rejectKind: input.rejectKind as RejectKind };
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
