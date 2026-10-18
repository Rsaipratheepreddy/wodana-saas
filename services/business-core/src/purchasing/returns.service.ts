import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { renderBrandedEmail } from "../email/branded-email";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { move } from "../inventory/stock";
import { notifyUserInApp } from "../notifications/default-templates";
import { event as boqEvent } from "../project-core/project-scope";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { currencyDecimals, firstTime, orderEvent, readOrder, readOrderLines, type OrderDetail } from "./orders";
import { REJECT_KINDS, readReceipt, readReceiptLines, settleOrder, type RejectKind } from "./receiving";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^\d{1,14}(\.\d{1,4})?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KIND_WORDS: Record<RejectKind, string> = { damaged: "damaged", defective: "defective", wrong_item: "wrong item", wrong_spec: "not to specification", other: "other" };

export type SupplierReturnRow = {
  id: string; number: number; orderId: string; orderNumber: string; supplierName: string; locationName: string; outcome: "replace" | "credit"; status: "open" | "sent" | "cancelled";
  note: string; createdByName: string; createdAt: string; sentOn: string | null; sentByName: string | null; cancelReason: string | null; version: number; lines: number; credit: string | null; currency: string;
};

const RETURN_SELECT = `SELECT back.id, back.number, back.order_id AS "orderId", purchase.number AS "orderNumber", vendor.display_name AS "supplierName", location.name AS "locationName",
  back.outcome, back.status, back.note, creator.display_name AS "createdByName", back.created_at AS "createdAt", back.sent_on::text AS "sentOn", sender.display_name AS "sentByName",
  back.cancel_reason AS "cancelReason", back.version, purchase.currency,
  (SELECT count(*)::int FROM supplier_return_lines line WHERE line.workspace_id = back.workspace_id AND line.return_id = back.id) AS lines,
  (SELECT sum(line.credit_amount + coalesce(line.credit_tax, 0))::text FROM supplier_return_lines line WHERE line.workspace_id = back.workspace_id AND line.return_id = back.id) AS credit
  FROM supplier_returns back
  JOIN purchase_orders purchase ON purchase.workspace_id = back.workspace_id AND purchase.id = back.order_id
  JOIN workspace_vendors vendor ON vendor.workspace_id = purchase.workspace_id AND vendor.id = purchase.vendor_id
  JOIN stock_locations location ON location.workspace_id = back.workspace_id AND location.id = back.location_id
  JOIN users creator ON creator.id = back.created_by
  LEFT JOIN users sender ON sender.id = back.sent_by`;

export async function readReturns(db: Pick<Db, "query">, workspaceId: string, orderId?: string): Promise<SupplierReturnRow[]> {
  return (await db.query<SupplierReturnRow>(`${RETURN_SELECT} WHERE back.workspace_id = $1 ${orderId ? "AND back.order_id = $2" : ""}
    ORDER BY (back.status = 'open') DESC, back.number DESC LIMIT 500`, orderId ? [workspaceId, orderId] : [workspaceId])).rows;
}

/**
 * Goods going back to the supplier: what was rejected at delivery, or accepted and found wrong later
 * (damaged, defective, the wrong item, not to specification). The supplier either sends them again —
 * they're owed once more — or credits them, and they're no longer owed. Accepted goods leave stock
 * when the supplier collects them.
 */
@Injectable()
export class SupplierReturnsService {
  private readonly logger = new Logger(SupplierReturnsService.name);

  constructor(private readonly access: WorkspaceAccessService, @Optional() private readonly email?: TransactionalEmailService) {}

  list(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["purchasing.view", "stock.receive"], async (client, user) => ({
      returns: await readReturns(client, workspaceId), ...(await this.rights(client, workspaceId, user.userId)),
    }));
  }

  get(actor: RequestActor, workspaceId: string, returnId: string) {
    return this.access.withAnyPermission(actor, workspaceId, ["purchasing.view", "stock.receive"], async (client, user) => this.detail(client, workspaceId, returnId, user.userId));
  }

  /** Raises a return from one delivery. Raising it again with the same id changes nothing. */
  create(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "purchasing.manage", async (client, user) => {
      const id = uuid(body.id, "Return");
      if (!(await firstTime(client, workspaceId, id, id, "create_return", user.userId))) return { ...(await this.detail(client, workspaceId, id, user.userId)), email: null };
      const receiptId = uuid(body.receiptId, "Delivery");
      await client.query(`SELECT 1 FROM goods_receipts WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, receiptId]);
      const receipt = await readReceipt(client, workspaceId, receiptId);
      if (!receipt) throw new NotFoundException("Delivery not found.");
      if (receipt.reversedAt) throw new ConflictException("This delivery was reversed.");
      const order = (await readOrder(client, workspaceId, receipt.orderId, true))!;
      if (order.status === "closed" || order.status === "cancelled") throw new ConflictException("The order is closed.");
      const outcome = body.outcome === "replace" || body.outcome === "credit" ? body.outcome : null;
      if (!outcome) throw new BadRequestException("Say whether the supplier replaces the goods or credits them.");
      const to = body.send === true ? text(body.to, 320, "Email") : "";
      if (to && !EMAIL.test(to)) throw new BadRequestException("Enter the supplier's email.");
      const receiptLines = await readReceiptLines(client, workspaceId, receiptId);
      const orderLines = await readOrderLines(client, workspaceId, order.id);
      if (!Array.isArray(body.lines) || !body.lines.length) throw new BadRequestException("Choose what goes back.");
      const seen = new Set<string>();
      const lines: Array<{ receiptLineId: string; orderLineId: string; source: "rejected" | "accepted"; quantity: string; kind: RejectKind; reason: string; credit: string | null; creditTax: string | null;
        description: string; unit: string }> = [];
      const creditedBefore = new Map<string, Dec>();
      for (const raw of body.lines as Array<Record<string, unknown>>) {
        const line = receiptLines.find((item) => item.id === raw?.receiptLineId);
        if (!line) throw new BadRequestException("A line isn't on this delivery.");
        const source = raw.source === "accepted" ? "accepted" : raw.source === "rejected" ? "rejected" : null;
        if (!source) throw new BadRequestException(`Say whether ${line.description} was rejected or accepted.`);
        if (seen.has(`${line.id}:${source}`)) throw new BadRequestException(`${line.description} is on the return twice.`);
        seen.add(`${line.id}:${source}`);
        const quantity = amount(raw.quantity, `${line.description}: quantity`);
        if (Dec.of(quantity).isZero()) continue;
        const left = source === "rejected" ? Dec.of(line.rejected).sub(line.returnedRejected) : Dec.of(line.accepted).sub(line.returnedAccepted);
        if (Dec.of(quantity).cmp(left) > 0) throw new ConflictException(left.isZero() ? `No ${source} ${line.description} is left to return.` : `At most ${left.toString()} ${line.unit} of ${line.description} can go back.`);
        const kind = (raw.reasonKind ?? (source === "rejected" ? line.rejectKind : null)) as RejectKind | null;
        if (!kind || !(REJECT_KINDS as readonly string[]).includes(kind)) throw new BadRequestException(`Say what's wrong with ${line.description}.`);
        const reason = text(raw.reason, 500, "Reason") || (source === "rejected" ? line.rejectReason : "");
        if (!reason) throw new BadRequestException(`Say why ${line.description} goes back.`);
        const ordered = orderLines.find((item) => item.id === line.orderLineId)!;
        let credit: string | null = null, creditTax: string | null = null;
        if (outcome === "credit" && !Dec.of(ordered.quantity).isZero()) {
          // Each credit is the line's share up to now less what was credited before, so partial credits add up to the line exactly.
          if (!creditedBefore.has(ordered.id)) creditedBefore.set(ordered.id, Dec.of((await client.query<{ quantity: string }>(
            `SELECT coalesce(sum(line.quantity), 0)::text AS quantity FROM supplier_return_lines line JOIN supplier_returns back ON back.workspace_id = line.workspace_id AND back.id = line.return_id
              WHERE line.workspace_id = $1 AND line.order_line_id = $2 AND back.outcome = 'credit' AND back.status <> 'cancelled'`, [workspaceId, ordered.id])).rows[0].quantity));
          const before = creditedBefore.get(ordered.id)!;
          const share = (total: string, units: Dec) => Dec.of(total).mul(units).div(ordered.quantity).round(currencyDecimals(order.currency));
          credit = share(ordered.net, before.add(quantity)).sub(share(ordered.net, before)).toFixed(4);
          creditTax = share(ordered.tax, before.add(quantity)).sub(share(ordered.tax, before)).toFixed(4);
          creditedBefore.set(ordered.id, before.add(quantity));
        }
        lines.push({ receiptLineId: line.id, orderLineId: line.orderLineId, source, quantity, kind, reason, credit, creditTax, description: line.description, unit: line.unit });
      }
      if (!lines.length) throw new BadRequestException("Choose what goes back.");
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('supplier_returns:' || $1::text, 0))`, [workspaceId]);
      const number = (await client.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM supplier_returns WHERE workspace_id = $1`, [workspaceId])).rows[0].next;
      const note = text(body.note, 2000, "Note");
      await client.query(`INSERT INTO supplier_returns (id, workspace_id, number, order_id, location_id, outcome, note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, workspaceId, number, order.id, receipt.locationId, outcome, note, user.userId]);
      for (const line of lines)
        await client.query(
          `INSERT INTO supplier_return_lines (id, workspace_id, return_id, receipt_line_id, order_line_id, source, quantity, reason_kind, reason, credit_amount, credit_tax)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [randomUUID(), workspaceId, id, line.receiptLineId, line.orderLineId, line.source, line.quantity, line.kind, line.reason, line.credit, line.creditTax]);
      // Credited goods stop being owed now; goods to be replaced are owed again once they've gone back.
      await settleOrder(client, workspaceId, order.id);
      await orderEvent(client, workspaceId, order.id, "return_raised", { return: number, outcome, receipt: receipt.number, lines: lines.length }, user.userId);
      const summary = lines.map((line) => `${line.description} ${Dec.of(line.quantity).toString()} ${line.unit} (${KIND_WORDS[line.kind]})`).join("; ");
      await this.tell(client, workspaceId, order, id, [order.createdBy, order.submittedBy], user.userId, summary.slice(0, 480));
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "supplier_return.raised", entityType: "supplier_return", entityId: id, after: { number, outcome, lines } });
      return { ...(await this.detail(client, workspaceId, id, user.userId)), email: to ? { to, lines, number, outcome, note, order } : null };
    }).then(async (result) => {
      if (!result.email) return { ...result, delivery: null };
      const delivery = await this.emailSupplier(workspaceId, result.email);
      await this.access.withPermission(actor, workspaceId, "purchasing.manage", (client, user) =>
        orderEvent(client, workspaceId, result.email!.order.id, delivery === "sent" ? "return_emailed" : "return_email_not_sent", { to: result.email!.to, status: delivery }, user.userId));
      return { ...result, delivery };
    }).then(({ email: _email, ...rest }) => rest);
  }

  /** The supplier collected the goods (accepted goods leave stock), or the return is cancelled before that. */
  command(actor: RequestActor, workspaceId: string, returnId: string, body: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, ["purchasing.manage", "stock.receive"], async (client, user) => {
      const commandId = body.commandId === undefined || body.commandId === null ? null : uuid(body.commandId, "Command");
      if (commandId && !(await firstTime(client, workspaceId, commandId, returnId, String(body.action ?? ""), user.userId))) return this.detail(client, workspaceId, returnId, user.userId);
      await client.query(`SELECT 1 FROM supplier_returns WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, returnId]);
      const current = (await client.query<{ status: string; version: number; orderId: string; locationId: string; number: number; outcome: string }>(
        `SELECT status, version, order_id AS "orderId", location_id AS "locationId", number, outcome FROM supplier_returns WHERE workspace_id = $1 AND id = $2`, [workspaceId, returnId])).rows[0];
      if (!current) throw new NotFoundException("Return not found.");
      const action = String(body.action ?? "");
      if (current.status !== "open") {
        if ((action === "sent" && current.status === "sent") || (action === "cancel" && current.status === "cancelled")) return this.detail(client, workspaceId, returnId, user.userId);
        throw new ConflictException(current.status === "sent" ? "These goods have already gone back." : "This return was cancelled.");
      }
      if (body.version !== current.version) throw new ConflictException("Someone else changed this return. Reload to see their changes.");
      const order = (await readOrder(client, workspaceId, current.orderId, true))!;
      if (action === "sent") {
        const sentOn = body.sentOn ? date(body.sentOn, "Date") : await this.today(client, workspaceId);
        const lines = await this.lines(client, workspaceId, returnId);
        const batchId = randomUUID();
        // Accepted goods leave stock from where their delivery put them.
        for (const line of lines.filter((item) => item.source === "accepted")) {
          // What went into stock for this delivery line, in stock units: the same share comes back out.
          const posted = (await client.query<{ itemId: string; projectId: string | null; quantity: string; accepted: string }>(
            `SELECT movement.item_id AS "itemId", movement.project_id AS "projectId", movement.quantity::text AS quantity, received.accepted::text AS accepted
               FROM stock_movements movement JOIN goods_receipt_lines received ON received.workspace_id = movement.workspace_id AND received.id = movement.receipt_line_id
              WHERE movement.workspace_id = $1 AND movement.receipt_line_id = $2 AND movement.kind = 'receive' LIMIT 1`, [workspaceId, line.receiptLineId])).rows[0];
          if (!posted) continue;
          const perUnit = Dec.of(posted.accepted).isZero() ? Dec.of(1) : Dec.of(posted.quantity).div(posted.accepted);
          try {
            await move(client, workspaceId, { batchId, itemId: posted.itemId, locationId: current.locationId, projectId: posted.projectId, kind: "supplier_return",
              quantity: Dec.of(line.quantity).mul(perUnit).round(4).neg().toString(), forProjectId: posted.projectId, supplierReturnId: returnId, reason: line.reason, movedOn: sentOn, actorId: user.userId });
          } catch (error) {
            if (error instanceof ConflictException) throw new ConflictException(`${line.description} isn't at the place it arrived any more. Bring it back first.`);
            throw error;
          }
          if (line.boqLineId && line.projectId)
            await boqEvent(client, workspaceId, line.projectId, line.boqLineId, "returned", { order: order.number, quantity: Dec.of(line.quantity).toString(), unit: line.unit, outcome: current.outcome }, null, user.userId);
        }
        await client.query(`UPDATE supplier_returns SET status = 'sent', sent_on = $3, sent_by = $4, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, returnId, sentOn, user.userId]);
        await settleOrder(client, workspaceId, order.id);
        await orderEvent(client, workspaceId, order.id, "return_sent", { return: current.number, sentOn }, user.userId);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "supplier_return.sent", entityType: "supplier_return", entityId: returnId, after: { sentOn } });
      } else if (action === "cancel") {
        if (!(await this.access.hasPermission(client, workspaceId, user.userId, "purchasing.manage"))) throw new ConflictException("A buyer cancels returns.");
        const reason = text(body.reason, 500, "Reason");
        if (!reason) throw new BadRequestException("Say why the return is cancelled.");
        await client.query(`UPDATE supplier_returns SET status = 'cancelled', cancel_reason = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, returnId, reason]);
        await settleOrder(client, workspaceId, order.id);
        await orderEvent(client, workspaceId, order.id, "return_cancelled", { return: current.number, reason }, user.userId);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "supplier_return.cancelled", entityType: "supplier_return", entityId: returnId, after: { reason } });
      } else throw new BadRequestException("Unknown action.");
      return this.detail(client, workspaceId, returnId, user.userId);
    });
  }

  // ---------- helpers ----------
  private async detail(client: Db, workspaceId: string, returnId: string, userId: string) {
    const row = (await client.query<SupplierReturnRow>(`${RETURN_SELECT} WHERE back.workspace_id = $1 AND back.id = $2`, [workspaceId, returnId])).rows[0];
    if (!row) throw new NotFoundException("Return not found.");
    const rights = await this.rights(client, workspaceId, userId);
    return { return: row, lines: await this.lines(client, workspaceId, returnId), ...rights,
      canSendThis: row.status === "open" && (rights.canBuy || rights.canReceive), canCancelThis: row.status === "open" && rights.canBuy };
  }

  private async lines(client: Db, workspaceId: string, returnId: string) {
    return (await client.query<{ id: string; receiptLineId: string; receiptNumber: number; description: string; unit: string; source: "rejected" | "accepted"; quantity: string;
      reasonKind: RejectKind; reason: string; creditAmount: string | null; creditTax: string | null; boqLineId: string | null; projectId: string | null; projectReference: string | null }>(
      `SELECT line.id, line.receipt_line_id AS "receiptLineId", receipt.number AS "receiptNumber", ordered.description, ordered.unit, line.source, line.quantity::text AS quantity,
              line.reason_kind AS "reasonKind", line.reason, line.credit_amount::text AS "creditAmount", line.credit_tax::text AS "creditTax", ordered.boq_line_id AS "boqLineId", ordered.project_id AS "projectId",
              project.reference AS "projectReference"
         FROM supplier_return_lines line
         JOIN purchase_order_lines ordered ON ordered.workspace_id = line.workspace_id AND ordered.id = line.order_line_id
         JOIN goods_receipt_lines got ON got.workspace_id = line.workspace_id AND got.id = line.receipt_line_id
         JOIN goods_receipts receipt ON receipt.workspace_id = got.workspace_id AND receipt.id = got.receipt_id
         LEFT JOIN delivery_projects project ON project.workspace_id = ordered.workspace_id AND project.id = ordered.project_id
        WHERE line.workspace_id = $1 AND line.return_id = $2 ORDER BY ordered.position, line.id`, [workspaceId, returnId])).rows;
  }

  private async rights(client: Db, workspaceId: string, userId: string) {
    const canBuy = await this.access.hasPermission(client, workspaceId, userId, "purchasing.manage");
    return { canBuy, canReceive: canBuy || (await this.access.hasPermission(client, workspaceId, userId, "stock.receive")) };
  }

  private async today(client: Db, workspaceId: string) {
    return (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].today;
  }

  private async tell(client: Db, workspaceId: string, order: OrderDetail, returnId: string, userIds: Array<string | null>, actorId: string, note: string) {
    const actor = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [actorId])).rows[0]?.name ?? "Someone";
    const amount = `${order.currency} ${Dec.of(order.total).toFixed(currencyDecimals(order.currency))}`;
    for (const userId of new Set(userIds.filter((id): id is string => Boolean(id) && id !== actorId)))
      await notifyUserInApp(client, { workspaceId, recipientUserId: userId, code: "purchasing.supplier_return", eventType: "purchasing.supplier_return",
        variables: { order: order.number, supplier: order.supplierName, amount, actor, note }, deepLink: `/workspace/purchasing/deliveries?return=${returnId}`,
        idempotencyKey: `purchasing.supplier_return:${returnId}:${userId}` });
  }

  /** The return note, in the firm's branded email, to the supplier. Returns how it went; never throws. */
  private async emailSupplier(workspaceId: string, input: { to: string; number: number; outcome: string; note: string; order: OrderDetail;
    lines: Array<{ description: string; quantity: string; unit: string; kind: RejectKind; reason: string }> }) {
    if (!this.email) return "not_configured";
    try {
      const brand = await this.email.brand({ workspaceId });
      const heading = `Return ${input.number} on order ${input.order.number}`;
      const paragraphs = [
        ...(input.note ? [input.note] : []),
        ...input.lines.map((line) => `${line.description}: ${Dec.of(line.quantity).toString()} ${line.unit}, ${KIND_WORDS[line.kind]}: ${line.reason}`),
        input.outcome === "replace" ? "Please collect these goods and send replacements." : "Please collect these goods and send us a credit note.",
      ];
      const { html, text: plain } = renderBrandedEmail({ brand, preheader: heading, heading, paragraphs });
      return (await this.email.send({ to: input.to, subject: `${heading} · ${input.order.companyName}`, text: plain, html, fromName: brand.name })).status;
    } catch (error) {
      this.logger.error(`Couldn't email return ${input.number}: ${(error as Error).message}`);
      return "failed";
    }
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

function date(value: unknown, label: string) {
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} must be a date.`);
  return value;
}
