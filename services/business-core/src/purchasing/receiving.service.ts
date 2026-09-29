import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp } from "../notifications/default-templates";
import { move, readTransfers, stockFromReceipt } from "../inventory/stock";
import { closeSettledBlockers } from "./purchasing-blockers";
import { readSiteAccess } from "../site/site-access";
import { event as boqEvent } from "../project-core/project-scope";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { prepareReferenceUpload, type ReferenceUpload } from "../workspaces/reference-upload";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { currencyDecimals, ensurePurchasingSettings, firstTime, orderEvent, readOrder, readOrderLines, readOrders, type OrderDetail } from "./orders";
import {
  RECEIVABLE, REJECT_KINDS, outstanding, placesFor, readLocations, readPhotos, readReceipt, readReceiptLines, readReceipts, readUnmatched, readUnmatchedLines, receivable, resolvePlace, settleOrder,
  type ReceiptLine, type RejectKind,
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
  constructor(private readonly access: WorkspaceAccessService, @Optional() private readonly storage?: BrandAssetStorageService) {}

  /** What's expected, what's waiting for inspection and what arrived lately. */
  deliveries(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["purchasing.view", "stock.receive", "stock.inspect"], async (client, user) => {
      // Lines still to come count credits, cancellations, returns to be replaced and reversed receipts, as the order does
      // (read with the orders); an order is due when the first of those lines is.
      const open = (await readOrders(client, workspaceId)).filter((order) => (RECEIVABLE as readonly string[]).includes(order.status) && order.linesLeft > 0);
      const deliverTo = new Map((await client.query<{ id: string; deliverTo: string }>(`SELECT id, deliver_to AS "deliverTo" FROM purchase_orders WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
        [workspaceId, open.map((order) => order.id)])).rows.map((row) => [row.id, row.deliverTo]));
      const expected = open.map((order) => ({ ...order, deliverTo: deliverTo.get(order.id) ?? "site" }))
        .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
      return {
        expected,
        inspection: await readReceipts(client, workspaceId, { pending: true }),
        received: await readReceipts(client, workspaceId, { pending: false, limit: 100 }),
        unmatched: await readUnmatched(client, workspaceId, { open: true }),
        requireSitePhoto: (await ensurePurchasingSettings(client, workspaceId)).requireSitePhoto,
        locations: await readLocations(client, workspaceId),
        ...(await this.rights(client, workspaceId, user.userId)),
        userId: user.userId,
      };
    });
  }

  /**
   * What's on its way to one project's site (D-20): supplier orders delivering there with lines still to come
   * for the project, and moves (factory dispatches included) on their way to its site. Each can be received
   * where it arrives by someone who receives goods.
   */
  arrivals(actor: RequestActor, workspaceId: string, projectId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["purchasing.view", "stock.receive", "stock.view", "projects.manage", "projects.report"], async (client, user) => {
      const orders = (await readOrders(client, workspaceId)).filter((order) => (RECEIVABLE as readonly string[]).includes(order.status) && order.linesLeft > 0
        && order.projects.some((project) => project.id === projectId));
      const rows = [];
      for (const order of orders) {
        const detail = (await client.query<{ deliverTo: string }>(`SELECT deliver_to AS "deliverTo" FROM purchase_orders WHERE workspace_id = $1 AND id = $2`, [workspaceId, order.id])).rows[0];
        if (detail?.deliverTo !== "site") continue;
        const items = (await readOrderLines(client, workspaceId, order.id)).filter((line) => line.projectId === projectId && outstanding(line).cmp(0) > 0)
          .map((line) => ({ description: line.description, left: outstanding(line).toString(), unit: line.unit, due: line.due }));
        if (items.length) rows.push({ ...order, items });
      }
      const moves = (await readTransfers(client, workspaceId)).filter((move) => move.status === "in_transit" && move.toKind === "site" && move.toProjectId === projectId);
      const has = (code: string) => this.access.hasPermission(client, workspaceId, user.userId, code);
      const canReceive = (await has("purchasing.manage")) || (await has("stock.receive"));
      // Whether the client confirmed site access for each order's day (D-29), and who may move a delivery.
      const access = new Map((await readSiteAccess(client, workspaceId, projectId)).map((request) => [request.orderId, request]));
      const manager = Boolean((await client.query(
        `SELECT 1 FROM project_assignments assignment JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id
          WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND assignment.is_manager AND membership.user_id = $3`, [workspaceId, projectId, user.userId])).rowCount);
      const canArrange = (await has("purchasing.manage")) || (await has("projects.manage")) || manager;
      const today = (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].today;
      return { orders: rows.map((order) => ({ ...order, access: access.get(order.id) ?? null })), moves, canReceive, canReceiveMoves: canReceive || (await has("stock.manage")), canArrange, today };
    });
  }

  /** The active managers of the projects an order is for. */
  private async projectManagers(client: Db, workspaceId: string, orderId: string) {
    return (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
         JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
        WHERE assignment.workspace_id = $1 AND assignment.active AND assignment.is_manager
          AND assignment.project_id IN (SELECT project_id FROM purchase_order_lines WHERE workspace_id = $1 AND order_id = $2 AND project_id IS NOT NULL)`, [workspaceId, orderId])).rows.map((row) => row.userId);
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
        requireInspection: settings.requireInspection, receiveTolerancePercent: settings.receiveTolerancePercent, requireSitePhoto: settings.requireSitePhoto };
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
      await this.receiveIn(client, workspaceId, user.userId, id, body);
      return this.detail(client, workspaceId, id, user.userId);
    });
  }

  /**
   * Records one delivery against an order, received by `receiverId`: the checks, the lines, the order's
   * status, stock, history and notices. Used for deliveries and for matching goods that came without an order.
   */
  private async receiveIn(client: Db, workspaceId: string, receiverId: string, id: string, body: Record<string, unknown>) {
    const held = async (order: { vendorId: string; continuedAt: string | null }) => {
      const supplier = (await client.query<{ name: string; approval: string }>(`SELECT display_name AS name, approval FROM workspace_vendors WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, order.vendorId])).rows[0];
      if (supplier && (supplier.approval === "on_hold" || supplier.approval === "not_approved") && !order.continuedAt)
        throw new ConflictException(`${supplier.name} is on hold. Someone who approves orders decides whether this order continues.`);
    };
    const orderId = uuid(body.orderId, "Order");
    const order = await readOrder(client, workspaceId, orderId, true);
    if (!order) throw new NotFoundException("Order not found.");
    if (!(RECEIVABLE as readonly string[]).includes(order.status))
      throw new ConflictException(order.status === "approved" ? "Send the order to the supplier before receiving against it." : order.status === "received" ? "Everything on this order has arrived." : "This order isn't open for deliveries.");
    await held(order);
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
      if (line.alternateStatus === "offered") throw new ConflictException(`Decide on the supplier's alternative for ${line.description} first.`);
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
      `INSERT INTO goods_receipts (id, workspace_id, number, order_id, location_id, received_on, received_by, delivery_note, notes, handed_over_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, workspaceId, number, orderId, location.id, receivedOn, receiverId, text(body.deliveryNote, 120, "Delivery note"), text(body.notes, 2000, "Notes"), text(body.handedOverBy, 200, "Handed over by")]);
    for (const line of lines)
      await client.query(
        `INSERT INTO goods_receipt_lines (id, workspace_id, receipt_id, order_line_id, received, accepted, rejected, pending, reject_reason, reject_kind, noted, inspected_by, inspected_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [line.id, workspaceId, id, line.orderLineId, line.received, line.accepted, line.rejected, line.pending, line.rejectReason, line.rejectKind, line.noted, null, null]);

    await settleOrder(client, workspaceId, orderId);
    await stockFromReceipt(client, workspaceId, { receiptId: id, lines: lines.map((line) => ({ receiptLineId: line.id, accepted: line.accepted })), actorId: receiverId });
    // Work that waited on these goods can start.
    await closeSettledBlockers(client, workspaceId, { orderId }, receiverId);
    await orderEvent(client, workspaceId, orderId, "received", { receipt: number, location: location.name, lines: lines.length, inspection: settings.requireInspection }, receiverId);
    await this.booked(client, workspaceId, order, lines, receiverId);
    const pending = lines.some((line) => Dec.of(line.pending).cmp(0) > 0);
    if (pending) await this.tell(client, workspaceId, order, id, "purchasing.inspection_needed", await this.inspectors(client, workspaceId), receiverId, location.name);
    else await this.tell(client, workspaceId, order, id, "purchasing.received", [order.createdBy, ...await this.projectManagers(client, workspaceId, orderId)], receiverId, location.name);
    await this.rejectedNotice(client, workspaceId, order, id, lines, receiverId);
    // Less arrived than the supplier's delivery note says: the buyer claims the rest.
    const missing = lines.filter((line) => line.noted !== null && Dec.of(line.noted).cmp(line.received) > 0)
      .map((line) => `${line.description}: ${Dec.of(line.noted!).sub(line.received).toString()} ${line.unit} missing (note ${Dec.of(line.noted!).toString()}, arrived ${Dec.of(line.received).toString()})`);
    if (missing.length) await this.tell(client, workspaceId, order, id, "purchasing.missing", [order.createdBy, order.submittedBy], receiverId, missing.join("; ").slice(0, 480));
    await recordAudit(client, { workspaceId, actorUserId: receiverId, action: "goods_receipt.received", entityType: "goods_receipt", entityId: id,
      after: { number, orderId, location: location.id, receivedOn, lines } });
    return number;
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
      await closeSettledBlockers(client, workspaceId, { orderId: order.id }, user.userId);
      const settled = results.map((line) => ({ orderLineId: line.orderLineId, description: line.description, accepted: line.take, rejected: line.refuse, rejectReason: line.reason, rejectKind: line.kind }));
      await orderEvent(client, workspaceId, order.id, "inspected", { receipt: receipt.number, done, accepted: settled.filter((line) => Dec.of(line.accepted).cmp(0) > 0).length,
        rejected: settled.filter((line) => Dec.of(line.rejected).cmp(0) > 0).length }, user.userId);
      await this.booked(client, workspaceId, order, settled, user.userId);
      const pass = createHash("sha256").update(results.map((line) => line.id).sort().join(",")).digest("hex").slice(0, 16);
      await this.tell(client, workspaceId, order, receiptId, "purchasing.received", [order.createdBy, receipt.receivedBy, ...await this.projectManagers(client, workspaceId, order.id)], user.userId,
        receipt.locationName, pass);
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

  /** Adds a photo to a delivery, or to goods that came without an order. The same photo id twice changes nothing. */
  async uploadPhoto(actor: RequestActor, workspaceId: string, owner: { kind: "receipt" | "unmatched"; id: string }, photoId: string, file?: ReferenceUpload) {
    const prepared = await prepareReferenceUpload(file);
    if (!prepared.mimeType.startsWith("image/")) throw new BadRequestException("Choose a photo (JPG, PNG, WebP or HEIC).");
    const storage = this.storage;
    if (!storage) throw new ConflictException("Photos can't be stored here yet.");
    return this.access.withAnyPermission(actor, workspaceId, ["purchasing.manage", "stock.receive"], async (client, user) => {
      const id = uuid(photoId, "Photo");
      if (owner.kind === "receipt") {
        const row = (await client.query<{ reversed: boolean }>(`SELECT reversed_at IS NOT NULL AS reversed FROM goods_receipts WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, owner.id])).rows[0];
        if (!row) throw new NotFoundException("Delivery not found.");
        if (row.reversed) throw new ConflictException("This delivery was reversed.");
      } else {
        const row = (await client.query<{ status: string }>(`SELECT status FROM unmatched_deliveries WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, owner.id])).rows[0];
        if (!row) throw new NotFoundException("Delivery not found.");
        if (row.status !== "open") throw new ConflictException("These goods are already matched or sent back.");
      }
      const existing = (await client.query<{ sha256: string }>(`SELECT sha256 FROM goods_receipt_photos WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
      if (existing && existing.sha256 !== prepared.digest) throw new ConflictException("This upload id belongs to another photo.");
      if (!existing) {
        const count = (await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM goods_receipt_photos WHERE workspace_id = $1 AND ${owner.kind === "receipt" ? "receipt_id" : "unmatched_id"} = $2`,
          [workspaceId, owner.id])).rows[0].count;
        if (count >= 10) throw new BadRequestException("A delivery takes up to 10 photos.");
        const key = `purchasing/deliveries/${workspaceId}/${id}`;
        await storage.put(`${key}/original`, prepared.body, prepared.mimeType);
        if (prepared.preview) await storage.put(`${key}/preview.webp`, prepared.preview, "image/webp");
        await client.query(
          `INSERT INTO goods_receipt_photos (id, workspace_id, receipt_id, unmatched_id, original_name, mime_type, byte_size, object_key, preview_key, sha256, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [id, workspaceId, owner.kind === "receipt" ? owner.id : null, owner.kind === "unmatched" ? owner.id : null, prepared.name, prepared.mimeType, prepared.body.length,
            `${key}/original`, prepared.preview ? `${key}/preview.webp` : null, prepared.digest, user.userId]);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "goods_receipt.photo_added", entityType: owner.kind === "receipt" ? "goods_receipt" : "unmatched_delivery",
          entityId: owner.id, after: { photoId: id } });
      }
      return owner.kind === "receipt" ? this.detail(client, workspaceId, owner.id, user.userId) : this.unmatchedDetail(client, workspaceId, owner.id, user.userId);
    });
  }

  /** One delivery photo (or its preview) for someone who can see deliveries. */
  photo(actor: RequestActor, workspaceId: string, photoId: string, preview: boolean) {
    return this.access.withAnyPermission(actor, workspaceId, ["purchasing.view", "stock.receive", "stock.inspect"], async (client) => {
      const row = (await client.query<{ objectKey: string; previewKey: string | null; mimeType: string }>(
        `SELECT object_key AS "objectKey", preview_key AS "previewKey", mime_type AS "mimeType" FROM goods_receipt_photos WHERE workspace_id = $1 AND id = $2`, [workspaceId, uuid(photoId, "Photo")])).rows[0];
      if (!row || !this.storage) throw new NotFoundException("Photo not found.");
      const key = preview && row.previewKey ? row.previewKey : row.objectKey;
      const stored = await this.storage.read(key).catch(() => null);
      if (!stored) throw new NotFoundException("Photo not found.");
      return { body: stored.body, contentType: key === row.previewKey ? "image/webp" : row.mimeType };
    });
  }

  /**
   * Goods that arrived without an order: who from, where, what (as written on the note), with photos.
   * They don't count and don't enter stock until a buyer matches them to an order or sends them back.
   */
  recordUnmatched(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, ["purchasing.manage", "stock.receive"], async (client, user) => {
      const id = uuid(body.id, "Delivery");
      if (!(await firstTime(client, workspaceId, id, id, "record_unmatched", user.userId))) return this.unmatchedDetail(client, workspaceId, id, user.userId);
      const vendorId = body.vendorId ? uuid(body.vendorId, "Supplier") : null;
      if (vendorId && !(await client.query(`SELECT 1 FROM workspace_vendors WHERE workspace_id = $1 AND id = $2`, [workspaceId, vendorId])).rowCount) throw new BadRequestException("Choose a supplier.");
      const supplierName = text(body.supplierName, 200, "Supplier");
      if (!vendorId && !supplierName) throw new BadRequestException("Say who delivered the goods.");
      const receivedOn = date(body.receivedOn, "Received on");
      if ((await client.query<{ future: boolean }>(`SELECT $2::date > (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date AS future FROM workspaces WHERE id = $1`,
        [workspaceId, receivedOn])).rows[0].future) throw new BadRequestException("Goods can't be received in the future.");
      const key = typeof body.place === "string" ? body.place : "";
      const running = (await client.query<{ id: string }>(`SELECT id FROM delivery_projects WHERE workspace_id = $1 AND status IN ('active', 'on_hold')`, [workspaceId])).rows.map((row) => row.id);
      const location = await resolvePlace(client, workspaceId, key, running, randomUUID);
      if (!location) throw new BadRequestException("Choose where the goods arrived.");
      if (!Array.isArray(body.lines) || !body.lines.length) throw new BadRequestException("Say what arrived.");
      if (body.lines.length > 100) throw new BadRequestException("Up to 100 lines.");
      const lines = (body.lines as Array<Record<string, unknown>>).map((raw, index) => {
        const description = text(raw?.description, 500, "What arrived");
        if (!description) throw new BadRequestException(`Line ${index + 1}: say what arrived.`);
        const quantity = amountOf(raw?.quantity, `Line ${index + 1}: quantity`);
        if (Dec.of(quantity).isZero()) throw new BadRequestException(`Line ${index + 1}: more than zero arrived.`);
        return { description, quantity, unit: text(raw?.unit, 40, "Unit") };
      });
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('unmatched_deliveries:' || $1::text, 0))`, [workspaceId]);
      const number = (await client.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM unmatched_deliveries WHERE workspace_id = $1`, [workspaceId])).rows[0].next;
      await client.query(
        `INSERT INTO unmatched_deliveries (id, workspace_id, number, vendor_id, supplier_name, location_id, received_on, received_by, handed_over_by, delivery_note, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, workspaceId, number, vendorId, supplierName, location.id, receivedOn, user.userId, text(body.handedOverBy, 200, "Handed over by"), text(body.deliveryNote, 120, "Delivery note"),
          text(body.notes, 2000, "Notes")]);
      for (const [position, line] of lines.entries())
        await client.query(`INSERT INTO unmatched_delivery_lines (id, workspace_id, delivery_id, position, description, quantity, unit) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [randomUUID(), workspaceId, id, position, line.description, line.quantity, line.unit]);
      const supplier = vendorId ? (await client.query<{ name: string }>(`SELECT display_name AS name FROM workspace_vendors WHERE workspace_id = $1 AND id = $2`, [workspaceId, vendorId])).rows[0].name : supplierName;
      const actorName = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [user.userId])).rows[0]?.name ?? "Someone";
      for (const userId of new Set((await this.holders(client, workspaceId, ["purchasing.manage"])).filter((person) => person !== user.userId)))
        await notifyUserInApp(client, { workspaceId, recipientUserId: userId, code: "purchasing.unmatched", eventType: "purchasing.unmatched",
          variables: { supplier, actor: actorName, note: location.name }, deepLink: `/workspace/purchasing/deliveries?unmatched=${id}`, idempotencyKey: `purchasing.unmatched:${id}:${userId}` });
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "unmatched_delivery.recorded", entityType: "unmatched_delivery", entityId: id,
        after: { number, vendorId, supplierName, location: location.id, lines } });
      return this.unmatchedDetail(client, workspaceId, id, user.userId);
    });
  }

  unmatched(actor: RequestActor, workspaceId: string, deliveryId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["purchasing.view", "stock.receive"], async (client, user) => this.unmatchedDetail(client, workspaceId, deliveryId, user.userId));
  }

  /**
   * Matches goods that came without an order to an order: each line to one of its lines. They're then
   * received like any delivery (by whoever received them, with inspection, stock and notices), and
   * their photos go with the delivery. Or they're sent back, with the reason.
   */
  resolveUnmatched(actor: RequestActor, workspaceId: string, deliveryId: string, body: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, ["purchasing.manage", "stock.receive"], async (client, user) => {
      await client.query(`SELECT 1 FROM unmatched_deliveries WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, deliveryId]);
      const delivery = (await readUnmatched(client, workspaceId, { id: deliveryId }))[0];
      if (!delivery) throw new NotFoundException("Delivery not found.");
      const action = String(body.action ?? "");
      if (delivery.status !== "open") {
        if ((action === "match" && delivery.status === "matched") || (action === "return" && delivery.status === "returned")) return this.unmatchedDetail(client, workspaceId, deliveryId, user.userId);
        throw new ConflictException(delivery.status === "matched" ? "These goods are already matched to an order." : "These goods were sent back.");
      }
      const note = text(body.note, 500, "Note");
      if (action === "return") {
        if (!note) throw new BadRequestException("Say why the goods went back.");
        await client.query(`UPDATE unmatched_deliveries SET status = 'returned', resolved_by = $3, resolved_at = now(), resolution_note = $4 WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, deliveryId, user.userId, note]);
      } else if (action === "match") {
        if (!(await this.access.hasPermission(client, workspaceId, user.userId, "purchasing.manage"))) throw new ForbiddenException("A buyer matches deliveries to orders.");
        const orderId = uuid(body.orderId, "Order");
        const order = await readOrder(client, workspaceId, orderId);
        if (!order) throw new NotFoundException("Order not found.");
        if (delivery.vendorId && order.vendorId !== delivery.vendorId) throw new ConflictException(`${order.number} is with another supplier.`);
        const lines = await readUnmatchedLines(client, workspaceId, deliveryId);
        const given = Array.isArray(body.lines) ? body.lines as Array<Record<string, unknown>> : [];
        const received = new Map<string, Dec>();
        for (const line of lines) {
          const input = given.find((item) => item?.unmatchedLineId === line.id);
          if (!input) throw new BadRequestException(`Choose the order line for ${line.description}.`);
          const orderLineId = uuid(input.orderLineId, "Order line");
          received.set(orderLineId, (received.get(orderLineId) ?? Dec.of(0)).add(line.quantity));
        }
        const receiptId = randomUUID();
        await this.receiveIn(client, workspaceId, delivery.receivedBy, receiptId, { orderId, place: delivery.locationId, receivedOn: delivery.receivedOn, deliveryNote: delivery.deliveryNote,
          handedOverBy: delivery.handedOverBy, notes: [delivery.notes, note].filter(Boolean).join(" · ").slice(0, 2000),
          lines: [...received].map(([orderLineId, quantity]) => ({ orderLineId, received: quantity.toString() })) });
        await client.query(`UPDATE goods_receipt_photos SET receipt_id = $3, unmatched_id = NULL WHERE workspace_id = $1 AND unmatched_id = $2`, [workspaceId, deliveryId, receiptId]);
        await client.query(`UPDATE unmatched_deliveries SET status = 'matched', receipt_id = $3, resolved_by = $4, resolved_at = now(), resolution_note = $5 WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, deliveryId, receiptId, user.userId, note]);
      } else throw new BadRequestException("Unknown action.");
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `unmatched_delivery.${action === "match" ? "matched" : "returned"}`, entityType: "unmatched_delivery",
        entityId: deliveryId, after: { note, orderId: body.orderId ?? null } });
      return this.unmatchedDetail(client, workspaceId, deliveryId, user.userId);
    });
  }

  // ---------- helpers ----------
  private async unmatchedDetail(client: Db, workspaceId: string, deliveryId: string, userId: string) {
    const delivery = (await readUnmatched(client, workspaceId, { id: deliveryId }))[0];
    if (!delivery) throw new NotFoundException("Delivery not found.");
    const rights = await this.rights(client, workspaceId, userId);
    // Orders it could belong to: open orders with the same supplier (any open order when the supplier isn't known).
    const candidates = delivery.status !== "open" || !rights.canBuy ? [] : await Promise.resolve().then(async () => {
      const orders = (await readOrders(client, workspaceId)).filter((order) => (RECEIVABLE as readonly string[]).includes(order.status) && (!delivery.vendorId || order.vendorId === delivery.vendorId));
      const out = [];
      for (const order of orders.slice(0, 50))
        out.push({ id: order.id, number: order.number, supplierName: order.supplierName,
          lines: (await readOrderLines(client, workspaceId, order.id)).filter((line) => outstanding(line).cmp(0) > 0)
            .map((line) => ({ id: line.id, description: line.description, unit: line.unit, projectReference: line.projectReference, outstanding: outstanding(line).toString() })) });
      return out.filter((order) => order.lines.length);
    });
    return { delivery, lines: await readUnmatchedLines(client, workspaceId, deliveryId), photos: await readPhotos(client, workspaceId, { unmatchedId: deliveryId }), candidates, ...rights };
  }

  private async holders(client: Db, workspaceId: string, codes: string[]) {
    return (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
         JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
         JOIN role_permissions granted ON granted.role_id = effective_role.role_id
         JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = ANY($2::text[])
        WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId, codes])).rows.map((row) => row.userId);
  }

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
    const settings = await ensurePurchasingSettings(client, workspaceId);
    return { receipt, lines, ...rights, photos: await readPhotos(client, workspaceId, { receiptId }),
      needsPhoto: settings.requireSitePhoto && receipt.locationKind === "site" && receipt.photos === 0 && !receipt.reversedAt,
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

const amountOf = (value: unknown, label: string) => quantity(value, label);

function quantity(value: unknown, label: string) {
  const textValue = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!NUMBER.test(textValue)) throw new BadRequestException(`${label} must be a number with up to 4 decimals.`);
  return textValue;
}

function date(value: unknown, label: string) {
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} must be a date.`);
  return value;
}
