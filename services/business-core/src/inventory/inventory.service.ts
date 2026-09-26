import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp } from "../notifications/default-templates";
import { readLocations, type StockLocation } from "../purchasing/receiving";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { move, onHand, readMovements, readStock, readTransfer, readTransfers, stockItemFor } from "./stock";

type Db = PoolClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER = /^\d{1,14}(\.\d{1,4})?$/;
const VIEW = ["stock.view", "stock.manage", "stock.adjust", "stock.receive", "purchasing.view"];
const PLACE_KINDS = ["warehouse", "factory", "other"] as const;

/**
 * Stock by place and owner. Goods for a project stay that project's; free stock can be reserved for a
 * project (and released), issued to one, and moved between places — out when sent, in when it arrives,
 * and anything lost on the way says why. Counting corrects stock with the reason. Every change is a
 * movement in the ledger; the balance can never go below zero.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly access: WorkspaceAccessService) {}

  stock(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, VIEW, async (client, user) => this.state(client, workspaceId, user.userId));
  }

  movements(actor: RequestActor, workspaceId: string, query: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, VIEW, async (client) => ({
      movements: await readMovements(client, workspaceId, {
        itemId: optionalUuid(query.itemId, "Item") ?? undefined, locationId: optionalUuid(query.locationId, "Place") ?? undefined, projectId: optionalUuid(query.projectId, "Project") ?? undefined,
      }),
    }));
  }

  /**
   * One stock change, replayed safely by its id: issue to a project, return from one, reserve free stock
   * for a project or release it, count, or add stock that isn't in the system yet.
   */
  command(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, ["stock.manage", "stock.adjust"], async (client, user) => {
      const batchId = uuid(body.id, "Change");
      const action = String(body.action ?? "");
      // Each change runs once: a retry (or the same change sent twice at once) returns stock as it is.
      if (!(await this.firstTime(client, workspaceId, batchId, action, user.userId))) return this.state(client, workspaceId, user.userId);
      const need = async (code: string, message: string) => { if (!(await this.access.hasPermission(client, workspaceId, user.userId, code))) throw new ForbiddenException(message); };
      const movedOn = body.movedOn ? date(body.movedOn, "Date") : await this.today(client, workspaceId);
      const reason = text(body.reason, 500, "Reason");
      const location = await this.location(client, workspaceId, body.locationId);
      const base = { batchId, locationId: location.id, movedOn, actorId: user.userId };
      let audit: Record<string, unknown> = {};
      let itemId: string;

      if (action === "add") {
        await need("stock.adjust", "You can't add stock.");
        itemId = typeof body.itemId === "string" ? await this.item(client, workspaceId, body.itemId)
          : await stockItemFor(client, workspaceId, { catalogItemId: optionalUuid(body.catalogItemId, "Catalog item"), name: required(body.name, 240, "Say what the item is."), unit: text(body.unit, 40, "Unit") });
        const owner = await this.runningProject(client, workspaceId, body.projectId, true);
        const quantity = amount(body.quantity, "Quantity");
        if (Dec.of(quantity).isZero()) throw new BadRequestException("Add more than zero.");
        if (!reason) throw new BadRequestException("Say where this stock comes from.");
        const unitCost = body.unitCost === undefined || body.unitCost === null || body.unitCost === "" ? null : amount(body.unitCost, "Cost");
        const currency = unitCost ? (await client.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency ?? null : null;
        await move(client, workspaceId, { ...base, itemId, projectId: owner, kind: "adjust", quantity, forProjectId: owner, unitCost: currency ? unitCost : null, currency, reason });
        audit = { quantity, owner, reason, unitCost };
      } else {
        itemId = await this.item(client, workspaceId, body.itemId);
        const owner = await this.owner(client, workspaceId, body.projectId);
        const have = await onHand(client, workspaceId, itemId, location.id, owner);
        const takes = (quantity: string) => { if (Dec.of(quantity).cmp(have) > 0) throw new ConflictException(`Only ${have.toString()} there.`); };
        if (action === "count") {
          await need("stock.adjust", "You can't correct stock.");
          const counted = amount(body.counted, "Counted");
          const difference = Dec.of(counted).sub(have);
          if (!difference.isZero()) {
            if (!reason) throw new BadRequestException("Say why the count is different.");
            await move(client, workspaceId, { ...base, itemId, projectId: owner, kind: "adjust", quantity: difference.toString(), forProjectId: owner, reason: `Count: ${reason}` });
            await this.tellAdjusters(client, workspaceId, user.userId, batchId, location.name, `${difference.cmp(0) > 0 ? "+" : ""}${difference.toString()} · ${reason}`);
          }
          audit = { counted, was: have.toString(), difference: difference.toString(), owner, reason };
        } else {
          await need("stock.manage", "You can't move stock.");
          const quantity = amount(body.quantity, "Quantity");
          if (Dec.of(quantity).isZero()) throw new BadRequestException("Enter more than zero.");
          if (action === "issue") {
            const forProjectId = owner ?? await this.runningProject(client, workspaceId, body.forProjectId, false);
            if (owner && body.forProjectId && body.forProjectId !== owner) throw new ConflictException("That stock is reserved for another project. Release it first.");
            takes(quantity);
            await move(client, workspaceId, { ...base, itemId, projectId: owner, kind: "issue", quantity: Dec.of(quantity).neg().toString(), forProjectId, reason });
            audit = { quantity, owner, forProjectId, reason };
          } else if (action === "return") {
            const fromProject = await this.runningProject(client, workspaceId, body.forProjectId, false);
            if (!reason) throw new BadRequestException("Say why it's coming back.");
            await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('stock-returns:' || $1::text || ':' || $2::text, 0))`, [itemId, fromProject]);
            // Only what was issued to the project (and not already taken back) can come back from it.
            const issued = Dec.of((await client.query<{ net: string }>(
              `SELECT coalesce(sum(-quantity) FILTER (WHERE kind = 'issue'), 0) - coalesce(sum(quantity) FILTER (WHERE kind = 'return'), 0) AS net
                 FROM stock_movements WHERE workspace_id = $1 AND item_id = $2 AND for_project_id = $3 AND kind IN ('issue', 'return')`, [workspaceId, itemId, fromProject])).rows[0].net);
            if (Dec.of(quantity).cmp(issued) > 0) throw new ConflictException(issued.cmp(0) > 0 ? `Only ${issued.toString()} was issued to that project.` : "None of this was issued to that project.");
            await move(client, workspaceId, { ...base, itemId, projectId: owner, kind: "return", quantity, forProjectId: fromProject, reason });
            audit = { quantity, owner, fromProject, reason };
          } else if (action === "allocate") {
            if (owner) throw new ConflictException("That stock is already for a project.");
            const project = await this.runningProject(client, workspaceId, body.forProjectId, false);
            takes(quantity);
            await move(client, workspaceId, { ...base, itemId, projectId: null, kind: "allocate", quantity: Dec.of(quantity).neg().toString(), forProjectId: project, reason });
            await move(client, workspaceId, { ...base, itemId, projectId: project, kind: "allocate", quantity, forProjectId: project, reason });
            audit = { quantity, project };
          } else if (action === "release") {
            if (!owner) throw new ConflictException("That's already free stock.");
            takes(quantity);
            await move(client, workspaceId, { ...base, itemId, projectId: owner, kind: "release", quantity: Dec.of(quantity).neg().toString(), forProjectId: owner, reason });
            await move(client, workspaceId, { ...base, itemId, projectId: null, kind: "release", quantity, forProjectId: owner, reason });
            audit = { quantity, owner };
          } else throw new BadRequestException("Unknown action.");
        }
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `stock.${action}`, entityType: "stock_item", entityId: itemId, after: { batchId, location: location.id, ...audit } });
      return this.state(client, workspaceId, user.userId);
    });
  }

  transfers(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, VIEW, async (client, user) => ({
      transfers: await readTransfers(client, workspaceId), locations: await readLocations(client, workspaceId), ...(await this.rights(client, workspaceId, user.userId)),
    }));
  }

  transfer(actor: RequestActor, workspaceId: string, transferId: string) {
    return this.access.withAnyPermission(actor, workspaceId, VIEW, async (client, user) => this.transferDetail(client, workspaceId, transferId, user.userId));
  }

  /** Sends stock from one place to another: it leaves now and arrives when the other end receives it. */
  send(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "stock.manage", async (client, user) => {
      const id = uuid(body.id, "Move");
      if (!(await this.firstTime(client, workspaceId, id, "send", user.userId))) return this.transferDetail(client, workspaceId, id, user.userId);
      const from = await this.location(client, workspaceId, body.fromLocationId);
      const to = await this.location(client, workspaceId, body.toLocationId);
      if (from.id === to.id) throw new BadRequestException("Choose another place to move it to.");
      if (!Array.isArray(body.lines) || !body.lines.length) throw new BadRequestException("Choose what to move.");
      if (body.lines.length > 200) throw new BadRequestException("A move has up to 200 lines.");
      const sentOn = body.sentOn ? date(body.sentOn, "Date") : await this.today(client, workspaceId);
      const seen = new Set<string>();
      const lines: Array<{ id: string; itemId: string; projectId: string | null; quantity: string }> = [];
      for (const raw of body.lines as Array<Record<string, unknown>>) {
        const itemId = await this.item(client, workspaceId, raw?.itemId);
        const projectId = await this.owner(client, workspaceId, raw?.projectId);
        const key = `${itemId}:${projectId ?? ""}`;
        if (seen.has(key)) throw new BadRequestException("The same stock is on the move twice.");
        seen.add(key);
        const quantity = amount(raw?.quantity, "Quantity");
        if (Dec.of(quantity).isZero()) continue;
        if (to.kind === "site" && projectId && to.projectId !== projectId) throw new BadRequestException("Stock for one project can't go to another project's site.");
        const have = await onHand(client, workspaceId, itemId, from.id, projectId);
        if (Dec.of(quantity).cmp(have) > 0) throw new ConflictException(`Only ${have.toString()} of one item at ${from.name}.`);
        lines.push({ id: randomUUID(), itemId, projectId, quantity });
      }
      if (!lines.length) throw new BadRequestException("Choose what to move.");
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('stock_transfers:' || $1::text, 0))`, [workspaceId]);
      const number = (await client.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM stock_transfers WHERE workspace_id = $1`, [workspaceId])).rows[0].next;
      await client.query(`INSERT INTO stock_transfers (id, workspace_id, number, from_location_id, to_location_id, note, sent_on, sent_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, workspaceId, number, from.id, to.id, text(body.note, 500, "Note"), sentOn, user.userId]);
      for (const line of lines) {
        await client.query(`INSERT INTO stock_transfer_lines (id, workspace_id, transfer_id, item_id, project_id, quantity) VALUES ($1, $2, $3, $4, $5, $6)`,
          [line.id, workspaceId, id, line.itemId, line.projectId, line.quantity]);
        await move(client, workspaceId, { batchId: id, itemId: line.itemId, locationId: from.id, projectId: line.projectId, kind: "transfer_out", quantity: Dec.of(line.quantity).neg().toString(),
          forProjectId: line.projectId, transferId: id, movedOn: sentOn, actorId: user.userId });
      }
      const receivers = await this.holders(client, workspaceId, ["stock.receive", "stock.manage"]);
      await this.tell(client, workspaceId, "stock.transfer_sent", receivers, user.userId, `${id}:sent`, { transfer: String(number), from: from.name, to: to.name, note: "" }, id);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "stock.transfer_sent", entityType: "stock_transfer", entityId: id, after: { number, from: from.id, to: to.id, lines } });
      return this.transferDetail(client, workspaceId, id, user.userId);
    });
  }

  /** Receives a move where it arrived (anything short says why), or cancels it and puts everything back. */
  transferCommand(actor: RequestActor, workspaceId: string, transferId: string, body: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, ["stock.manage", "stock.receive"], async (client, user) => {
      await client.query(`SELECT 1 FROM stock_transfers WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, transferId]);
      const current = await readTransfer(client, workspaceId, transferId);
      if (!current) throw new NotFoundException("Move not found.");
      const { transfer, lines } = current;
      const action = String(body.action ?? "");
      if (transfer.status !== "in_transit") {
        if ((action === "receive" && transfer.status === "received") || (action === "cancel" && transfer.status === "cancelled")) return this.transferDetail(client, workspaceId, transferId, user.userId);
        throw new ConflictException(transfer.status === "received" ? "This move has already arrived." : "This move was cancelled.");
      }
      if (action === "receive") {
        const receivedOn = body.receivedOn ? date(body.receivedOn, "Date") : await this.today(client, workspaceId);
        const inputs = Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>) : [];
        const short: string[] = [];
        for (const line of lines) {
          const input = inputs.find((item) => item?.id === line.id);
          const received = input ? amount(input.received, `${line.itemName}: arrived`) : line.quantity;
          if (Dec.of(received).cmp(line.quantity) > 0) throw new BadRequestException(`${line.itemName}: more arrived than was sent.`);
          const lossReason = text(input?.lossReason, 500, "Reason");
          if (Dec.of(received).cmp(line.quantity) < 0) {
            if (!lossReason) throw new BadRequestException(`Say what happened to the rest of ${line.itemName}.`);
            short.push(`${line.itemName} ${Dec.of(line.quantity).sub(received).toString()}: ${lossReason}`);
          }
          await client.query(`UPDATE stock_transfer_lines SET received = $3, loss_reason = $4 WHERE workspace_id = $1 AND id = $2`, [workspaceId, line.id, received, Dec.of(received).cmp(line.quantity) < 0 ? lossReason : ""]);
          if (Dec.of(received).cmp(0) > 0)
            await move(client, workspaceId, { batchId: transferId, itemId: line.itemId, locationId: transfer.toLocationId, projectId: line.projectId, kind: "transfer_in", quantity: Dec.of(received).toString(),
              forProjectId: line.projectId, transferId, movedOn: receivedOn, actorId: user.userId });
        }
        await client.query(`UPDATE stock_transfers SET status = 'received', received_on = $3, received_by = $4 WHERE workspace_id = $1 AND id = $2`, [workspaceId, transferId, receivedOn, user.userId]);
        if (short.length) await this.tell(client, workspaceId, "stock.transfer_short", [transfer.sentBy], user.userId, `${transferId}:short`,
          { transfer: String(transfer.number), from: transfer.fromName, to: transfer.toName, note: short.join("; ").slice(0, 480) }, transferId);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "stock.transfer_received", entityType: "stock_transfer", entityId: transferId, after: { receivedOn, short } });
      } else if (action === "cancel") {
        if (!(await this.access.hasPermission(client, workspaceId, user.userId, "stock.manage"))) throw new ForbiddenException("You can't cancel moves.");
        const reason = required(body.reason, 500, "Say why the move is cancelled.");
        const today = await this.today(client, workspaceId);
        for (const line of lines)
          await move(client, workspaceId, { batchId: transferId, itemId: line.itemId, locationId: transfer.fromLocationId, projectId: line.projectId, kind: "transfer_in", quantity: line.quantity,
            forProjectId: line.projectId, transferId, reason, movedOn: today, actorId: user.userId });
        await client.query(`UPDATE stock_transfers SET status = 'cancelled', cancel_reason = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, transferId, reason]);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "stock.transfer_cancelled", entityType: "stock_transfer", entityId: transferId, after: { reason } });
      } else throw new BadRequestException("Unknown action.");
      return this.transferDetail(client, workspaceId, transferId, user.userId);
    });
  }

  /** Adds or changes a place where stock is kept. A project's site is made by its first delivery. */
  saveLocation(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, ["stock.manage", "workspace.settings.manage"], async (client, user) => {
      const id = uuid(body.id, "Place");
      const existing = (await client.query<{ kind: string; active: boolean }>(`SELECT kind, active FROM stock_locations WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, id])).rows[0];
      const name = required(body.name, 160, "Name the place.");
      const address = text(body.address, 500, "Address");
      const active = body.active !== false;
      if (existing?.kind === "site") {
        await client.query(`UPDATE stock_locations SET name = $3, address = $4 WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, name, address]);
      } else {
        const kind = existing?.kind ?? String(body.kind ?? "");
        if (!(PLACE_KINDS as readonly string[]).includes(kind)) throw new BadRequestException("Choose a warehouse, the factory or another place.");
        if (!active && (await client.query(`SELECT 1 FROM stock_balances WHERE workspace_id = $1 AND location_id = $2 AND on_hand > 0 LIMIT 1`, [workspaceId, id])).rowCount)
          throw new ConflictException("Move the stock out before closing this place.");
        const isDefault = active && body.isDefault === true;
        if (isDefault) await client.query(`UPDATE stock_locations SET is_default = false WHERE workspace_id = $1 AND kind = $2 AND id <> $3`, [workspaceId, kind, id]);
        await client.query(
          `INSERT INTO stock_locations (id, workspace_id, kind, name, address, is_default, active) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address, is_default = EXCLUDED.is_default, active = EXCLUDED.active`,
          [id, workspaceId, kind, name, address, isDefault, active]);
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: existing ? "stock.location_changed" : "stock.location_added", entityType: "stock_location", entityId: id,
        after: { name, address, active } });
      return { locations: await readLocations(client, workspaceId, true) };
    });
  }

  locations(actor: RequestActor, workspaceId: string) {
    return this.access.withAnyPermission(actor, workspaceId, [...VIEW, "workspace.settings.manage"], async (client, user) => ({
      locations: await readLocations(client, workspaceId, true),
      canManage: (await this.access.hasPermission(client, workspaceId, user.userId, "stock.manage")) || (await this.access.hasPermission(client, workspaceId, user.userId, "workspace.settings.manage")),
    }));
  }

  // ---------- helpers ----------
  private async firstTime(client: Db, workspaceId: string, id: string, action: string, actorId: string) {
    return Boolean((await client.query(`INSERT INTO stock_commands (workspace_id, id, action, actor_id) VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, id) DO NOTHING`,
      [workspaceId, id, action.slice(0, 24), actorId])).rowCount);
  }

  private async state(client: Db, workspaceId: string, userId: string) {
    return {
      rows: await readStock(client, workspaceId),
      locations: await readLocations(client, workspaceId),
      projects: (await client.query<{ id: string; reference: string; name: string }>(
        `SELECT id, reference, name FROM delivery_projects WHERE workspace_id = $1 AND status IN ('active', 'on_hold') ORDER BY reference`, [workspaceId])).rows,
      inTransit: (await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM stock_transfers WHERE workspace_id = $1 AND status = 'in_transit'`, [workspaceId])).rows[0].count,
      ...(await this.rights(client, workspaceId, userId)),
    };
  }

  private async transferDetail(client: Db, workspaceId: string, transferId: string, userId: string) {
    const detail = await readTransfer(client, workspaceId, transferId);
    if (!detail) throw new NotFoundException("Move not found.");
    const rights = await this.rights(client, workspaceId, userId);
    return { ...detail, ...rights, canReceiveThis: rights.canReceive && detail.transfer.status === "in_transit", canCancelThis: rights.canManage && detail.transfer.status === "in_transit" };
  }

  private async rights(client: Db, workspaceId: string, userId: string) {
    const has = (code: string) => this.access.hasPermission(client, workspaceId, userId, code);
    const canManage = await has("stock.manage");
    return { canManage, canAdjust: await has("stock.adjust"), canReceive: canManage || (await has("stock.receive")) };
  }

  private async today(client: Db, workspaceId: string) {
    return (await client.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].today;
  }

  private async location(client: Db, workspaceId: string, value: unknown): Promise<StockLocation> {
    const location = (await readLocations(client, workspaceId)).find((item) => item.id === uuid(value, "Place"));
    if (!location) throw new BadRequestException("Choose a place where stock is kept.");
    return location;
  }

  private async item(client: Db, workspaceId: string, value: unknown) {
    const id = uuid(value, "Item");
    if (!(await client.query(`SELECT 1 FROM stock_items WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rowCount) throw new BadRequestException("Choose an item.");
    return id;
  }

  /** Whose stock a balance is: a project's (any status, it may still hold stock), or free stock. */
  private async owner(client: Db, workspaceId: string, value: unknown) {
    if (value === null || value === undefined || value === "") return null;
    const id = uuid(value, "Project");
    if (!(await client.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rowCount) throw new BadRequestException("Choose a project.");
    return id;
  }

  private async runningProject(client: Db, workspaceId: string, value: unknown, optional: true): Promise<string | null>;
  private async runningProject(client: Db, workspaceId: string, value: unknown, optional: false): Promise<string>;
  private async runningProject(client: Db, workspaceId: string, value: unknown, optional: boolean) {
    if (optional && (value === null || value === undefined || value === "")) return null;
    const id = uuid(value, "Project");
    if (!(await client.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 AND status IN ('active', 'on_hold')`, [workspaceId, id])).rowCount)
      throw new BadRequestException("Choose a running project.");
    return id;
  }

  private async holders(client: Db, workspaceId: string, codes: string[]) {
    return (await client.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
         JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
         JOIN role_permissions granted ON granted.role_id = effective_role.role_id
         JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = ANY($2::text[])
        WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId, codes])).rows.map((row) => row.userId);
  }

  private async tellAdjusters(client: Db, workspaceId: string, actorId: string, batchId: string, place: string, note: string) {
    await this.tell(client, workspaceId, "stock.adjusted", await this.holders(client, workspaceId, ["stock.adjust"]), actorId, `${batchId}:adjusted`, { transfer: "", from: "", to: place, note }, null);
  }

  private async tell(client: Db, workspaceId: string, code: string, userIds: string[], actorId: string, key: string, variables: Record<string, string>, transferId: string | null) {
    const actor = (await client.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [actorId])).rows[0]?.name ?? "Someone";
    for (const userId of new Set(userIds.filter((id) => id !== actorId)))
      await notifyUserInApp(client, { workspaceId, recipientUserId: userId, code, eventType: code, variables: { ...variables, actor },
        deepLink: transferId ? `/workspace/inventory/moves?move=${transferId}` : "/workspace/inventory", idempotencyKey: `${code}:${key}:${userId}`.slice(0, 160) });
  }
}

function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new BadRequestException(`${label} is not valid.`);
  return value;
}

function optionalUuid(value: unknown, label: string) {
  return value === undefined || value === null || value === "" ? null : uuid(value, label);
}

function text(value: unknown, max: number, label: string) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new BadRequestException(`${label} is not valid.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new BadRequestException(`${label} is too long (up to ${max} characters).`);
  return trimmed;
}

function required(value: unknown, max: number, message: string) {
  const result = text(value, max, "Text");
  if (!result) throw new BadRequestException(message);
  return result;
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
