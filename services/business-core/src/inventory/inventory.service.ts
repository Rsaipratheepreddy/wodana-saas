import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp } from "../notifications/default-templates";
import { readLocations, type StockLocation } from "../purchasing/receiving";
import { tellMaterialsReady } from "../purchasing/materials-ready";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { holdsAny, STOCK_COST_READERS } from "../workspaces/money-visibility";
import { likePattern, searchTerms } from "../search/search-terms";
import { raiseSnag } from "../project-core/project-work";
import { assertTransferCleared } from "../factory/factory-inspections";
import { reworkFromSite } from "../factory/factory-rework";
import { averageCost, move, onHand, readMovements, readStock, readStockItems, readTransfer, readTransfers, stockItemFor } from "./stock";
import { processStockLevels, readReorderPoints } from "./stock-levels";

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

  /**
   * Stock of the items whose name or code (or their catalog item's) holds every word searched (Woddy's stock
   * questions): per place, what's on hand as free stock, what deals hold of it, what's free, and what projects own;
   * with the reorder point's low flag. Items with nothing on hand are listed too.
   */
  lookup(actor: RequestActor, workspaceId: string, query: { search: string; limit?: number }) {
    return this.access.withAnyPermission(actor, workspaceId, VIEW, async (client) => {
      const terms = searchTerms(query.search);
      if (!terms.length) throw new BadRequestException("Say which item.");
      const values: unknown[] = [workspaceId, likePattern(query.search.trim())];
      const where = terms.map((term) => {
        values.push(term);
        const at = `$${values.length}`;
        return `(item.name ILIKE ${at} OR item.code ILIKE ${at} OR coalesce(product.name, '') ILIKE ${at} OR coalesce(product.code, '') ILIKE ${at})`;
      });
      values.push(Math.min(Math.max(query.limit ?? 8, 1), 20));
      const items = (await client.query<{ id: string; code: string; name: string; unit: string; catalogItemId: string | null }>(
        `SELECT item.id, item.code, item.name, item.unit, item.catalog_item_id AS "catalogItemId"
           FROM stock_items item
           LEFT JOIN catalog_items product ON product.workspace_id = item.workspace_id AND product.id = item.catalog_item_id
          WHERE item.workspace_id = $1 AND item.active AND ${where.join(" AND ")}
          ORDER BY (item.name ILIKE $2) DESC, item.name, item.code LIMIT $${values.length}`, values)).rows;
      if (!items.length) return { items: [] };
      const ids = items.map((item) => item.id);
      const places = (await client.query<{ itemId: string; locationId: string | null; locationName: string | null; onHand: string; held: string; forProjects: string }>(
        `WITH free AS (SELECT item_id, location_id, sum(on_hand) AS on_hand FROM stock_balances WHERE workspace_id = $1 AND item_id = ANY($2::uuid[]) AND project_id IS NULL GROUP BY 1, 2),
              owned AS (SELECT item_id, location_id, sum(on_hand) AS on_hand FROM stock_balances WHERE workspace_id = $1 AND item_id = ANY($2::uuid[]) AND project_id IS NOT NULL GROUP BY 1, 2),
              held AS (SELECT item_id, location_id, sum(quantity) AS quantity FROM stock_reservations
                        WHERE workspace_id = $1 AND item_id = ANY($2::uuid[]) AND status = 'reserved' AND project_id IS NULL GROUP BY 1, 2),
              keys AS (SELECT item_id, location_id FROM free UNION SELECT item_id, location_id FROM owned UNION SELECT item_id, location_id FROM held)
         SELECT keys.item_id AS "itemId", keys.location_id AS "locationId", location.name AS "locationName",
                coalesce(free.on_hand, 0)::numeric(18, 4)::text AS "onHand", coalesce(held.quantity, 0)::numeric(18, 4)::text AS held,
                coalesce(owned.on_hand, 0)::numeric(18, 4)::text AS "forProjects"
           FROM keys
           LEFT JOIN free ON free.item_id = keys.item_id AND free.location_id IS NOT DISTINCT FROM keys.location_id
           LEFT JOIN owned ON owned.item_id = keys.item_id AND owned.location_id IS NOT DISTINCT FROM keys.location_id
           LEFT JOIN held ON held.item_id = keys.item_id AND held.location_id IS NOT DISTINCT FROM keys.location_id
           LEFT JOIN stock_locations location ON location.workspace_id = $1 AND location.id = keys.location_id
          ORDER BY location.name NULLS LAST`, [workspaceId, ids])).rows;
      const points = await readReorderPoints(client, workspaceId, ids);
      return {
        items: items.map((item) => {
          const rows = places.filter((place) => place.itemId === item.id);
          const sum = (pick: (row: (typeof rows)[number]) => string) => rows.reduce((total, row) => total.add(pick(row)), Dec.ZERO);
          const onHand = sum((row) => row.onHand), held = sum((row) => row.held);
          const reorder = points.filter((point) => point.itemId === item.id);
          return {
            ...item,
            onHand: onHand.toString(), held: held.toString(), free: onHand.sub(held).toString(), forProjects: sum((row) => row.forProjects).toString(),
            places: rows.filter((row) => !Dec.of(row.onHand).isZero() || !Dec.of(row.held).isZero() || !Dec.of(row.forProjects).isZero()).map((row) => ({
              place: row.locationName, onHand: Dec.of(row.onHand).toString(), held: Dec.of(row.held).toString(), free: Dec.of(row.onHand).sub(row.held).toString(), forProjects: Dec.of(row.forProjects).toString(),
            })),
            reorderPoints: reorder.map((point) => ({ place: point.locationName, reorderAt: Dec.of(point.reorderAt).toString(), onOrder: Dec.of(point.onOrder).toString(), low: point.low, short: point.short })),
            low: reorder.length ? reorder.some((point) => point.low) : null,
          };
        }),
      };
    });
  }

  movements(actor: RequestActor, workspaceId: string, query: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, VIEW, async (client, user) => {
      const movements = await readMovements(client, workspaceId, {
        itemId: optionalUuid(query.itemId, "Item") ?? undefined, locationId: optionalUuid(query.locationId, "Place") ?? undefined, projectId: optionalUuid(query.projectId, "Project") ?? undefined,
      });
      // QA-006: what each movement cost only for the people who see stock costs.
      const canSeeCosts = await holdsAny(client, this.access, workspaceId, user.userId, STOCK_COST_READERS);
      return { movements: canSeeCosts ? movements : movements.map((movement) => ({ ...movement, unitCost: null, currency: null })), canSeeCosts };
    });
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
          const result = await this.countWith(client, workspaceId, user.userId, { batchId, itemId, location, owner, counted, reason, movedOn });
          audit = { counted, was: result.was, difference: result.difference, owner, reason, pending: result.pending };
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
            // What comes back is valued at what it was last issued at.
            const issuedAt = (await client.query<{ unitCost: string | null; currency: string | null }>(
              `SELECT unit_cost::text AS "unitCost", currency FROM stock_movements WHERE workspace_id = $1 AND item_id = $2 AND for_project_id = $3 AND kind = 'issue' AND unit_cost IS NOT NULL
                ORDER BY seq DESC LIMIT 1`, [workspaceId, itemId, fromProject])).rows[0];
            await move(client, workspaceId, { ...base, itemId, projectId: owner, kind: "return", quantity, forProjectId: fromProject, reason, unitCost: issuedAt?.unitCost, currency: issuedAt?.currency });
            audit = { quantity, owner, fromProject, reason };
          } else if (action === "allocate") {
            if (owner) throw new ConflictException("That stock is already for a project.");
            const project = await this.runningProject(client, workspaceId, body.forProjectId, false);
            takes(quantity);
            // Stock changes owner at the cost it has.
            const cost = await averageCost(client, workspaceId, itemId, location.id, null);
            await move(client, workspaceId, { ...base, itemId, projectId: null, kind: "allocate", quantity: Dec.of(quantity).neg().toString(), forProjectId: project, reason, unitCost: cost?.unitCost, currency: cost?.currency });
            await move(client, workspaceId, { ...base, itemId, projectId: project, kind: "allocate", quantity, forProjectId: project, reason, unitCost: cost?.unitCost, currency: cost?.currency });
            audit = { quantity, project };
          } else if (action === "release") {
            if (!owner) throw new ConflictException("That's already free stock.");
            takes(quantity);
            const cost = await averageCost(client, workspaceId, itemId, location.id, owner);
            await move(client, workspaceId, { ...base, itemId, projectId: owner, kind: "release", quantity: Dec.of(quantity).neg().toString(), forProjectId: owner, reason, unitCost: cost?.unitCost, currency: cost?.currency });
            await move(client, workspaceId, { ...base, itemId, projectId: null, kind: "release", quantity, forProjectId: owner, reason, unitCost: cost?.unitCost, currency: cost?.currency });
            audit = { quantity, owner };
          } else throw new BadRequestException("Unknown action.");
        }
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: `stock.${action}`, entityType: "stock_item", entityId: itemId, after: { batchId, location: location.id, ...audit } });
      // Free stock taken below its reorder point tells the people who keep and buy it straight away.
      await processStockLevels(client, workspaceId, [itemId]);
      // Stock given to a project counts as in: it may complete what the project buys (PLM-074).
      const givenTo = action === "issue" ? audit.forProjectId : action === "allocate" ? audit.project : null;
      if (typeof givenTo === "string") await tellMaterialsReady(client, workspaceId, [givenTo], user.userId);
      return this.state(client, workspaceId, user.userId);
    });
  }

  /**
   * A count inside a command already running (the stock count, a linked stock sheet): what's there becomes
   * the counted quantity by an adjustment with its reason, or waits for someone else's approval when the
   * correction is worth more than the workspace's limit. Stock that comes in can carry its cost; stock that
   * goes out leaves at its average cost when asked. The caller audits it.
   */
  async countWith(client: Db, workspaceId: string, userId: string, input: {
    batchId: string; itemId: string; location: StockLocation; owner: string | null; counted: string; reason: string; movedOn: string;
    /** The ledger's reason (a count says "Count: <reason>"). */
    movementReason?: string; unitCost?: string | null; costOut?: boolean;
  }) {
    const { batchId, itemId, location, owner, counted, reason } = input;
    const have = await onHand(client, workspaceId, itemId, location.id, owner);
    const difference = Dec.of(counted).sub(have);
    let pending = false;
    if (!difference.isZero()) {
      if (!reason) throw new BadRequestException("Say why the count is different.");
      // A correction worth more than the workspace's limit waits for someone else's approval.
      const average = await averageCost(client, workspaceId, itemId, location.id, owner);
      const worth = average ? difference.abs().mul(average.unitCost).round(4) : Dec.of(0);
      const limit = (await client.query<{ limit: string | null }>(`SELECT stock_adjust_approval_value::text AS "limit" FROM workspace_purchasing_settings WHERE workspace_id = $1`,
        [workspaceId])).rows[0]?.limit ?? null;
      if (limit !== null && worth.cmp(limit) > 0) {
        pending = true;
        await client.query(
          `INSERT INTO stock_adjustment_requests (id, workspace_id, item_id, location_id, project_id, counted, difference, value, reason, requested_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [batchId, workspaceId, itemId, location.id, owner, counted, difference.toString(), worth.toFixed(4), reason, userId]);
        const item = (await client.query<{ name: string; unit: string }>(`SELECT name, unit FROM stock_items WHERE workspace_id = $1 AND id = $2`, [workspaceId, itemId])).rows[0];
        await this.tell(client, workspaceId, "stock.adjustment_needs_approval", await this.holders(client, workspaceId, ["stock.adjust"]), userId, `${batchId}:approval`,
          { transfer: "", from: "", to: location.name, note: `${counted} ${item.unit} of ${item.name} (was ${have.toString()}): ${reason}` }, null);
      } else {
        const incoming = difference.cmp(0) > 0;
        const cost = incoming ? (input.unitCost ? { unitCost: input.unitCost, currency: await this.currency(client, workspaceId) } : null) : input.costOut ? average : null;
        await move(client, workspaceId, { batchId, locationId: location.id, movedOn: input.movedOn, actorId: userId, itemId, projectId: owner, kind: "adjust", quantity: difference.toString(),
          forProjectId: owner, reason: input.movementReason ?? `Count: ${reason}`, unitCost: cost?.currency ? cost.unitCost : null, currency: cost?.currency ?? null });
        await this.tellAdjusters(client, workspaceId, userId, batchId, location.name, `${incoming ? "+" : ""}${difference.toString()} · ${reason}`);
      }
    }
    return { was: have.toString(), difference: difference.toString(), pending };
  }

  /** Today in the workspace's time zone (a command already running). */
  todayIn(client: Db, workspaceId: string) { return this.today(client, workspaceId); }

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
      // PLM-150: goods a work order made go to site from that work order, once their last design inspection passed (a replay is recorded once).
      const replay = typeof body.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)
        && Boolean((await client.query(`SELECT 1 FROM stock_transfers WHERE workspace_id = $1 AND id = $2`, [workspaceId, body.id])).rowCount);
      if (!replay) await assertTransferCleared(client, workspaceId, { fromLocationId: body.fromLocationId, toLocationId: body.toLocationId, lines: body.lines });
      return this.sendWith(client, workspaceId, user.userId, body);
    });
  }

  /** Sends a move inside a command already running (the factory sending made goods to site); replayed safely by its id. */
  async sendWith(client: Db, workspaceId: string, userId: string, body: Record<string, unknown>) {
    const user = { userId };
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
    await processStockLevels(client, workspaceId, [...new Set(lines.map((line) => line.itemId))]);
    await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "stock.transfer_sent", entityType: "stock_transfer", entityId: id, after: { number, from: from.id, to: to.id, lines } });
    return this.transferDetail(client, workspaceId, id, user.userId);
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
        // Goods that arrived but are refused there (damaged, wrong, not to spec) go straight back on a return trip.
        const refused: Array<{ itemId: string; itemName: string; unit: string; projectId: string | null; quantity: string; reason: string }> = [];
        for (const line of lines) {
          const input = inputs.find((item) => item?.id === line.id);
          const received = input ? amount(input.received, `${line.itemName}: arrived`) : line.quantity;
          if (Dec.of(received).cmp(line.quantity) > 0) throw new BadRequestException(`${line.itemName}: more arrived than was sent.`);
          const lossReason = text(input?.lossReason, 500, "Reason");
          if (Dec.of(received).cmp(line.quantity) < 0) {
            if (!lossReason) throw new BadRequestException(`Say what happened to the rest of ${line.itemName}.`);
            short.push(`${line.itemName} ${Dec.of(line.quantity).sub(received).toString()}: ${lossReason}`);
          }
          const rejected = input?.rejected === undefined || input.rejected === null || input.rejected === "" ? "0" : amount(input.rejected, `${line.itemName}: refused`);
          const rejectReason = text(input?.rejectReason, 500, "Reason");
          if (Dec.of(rejected).cmp(received) > 0) throw new BadRequestException(`${line.itemName}: more is refused than arrived.`);
          if (Dec.of(rejected).cmp(0) > 0 && !rejectReason) throw new BadRequestException(`Say why ${line.itemName} is refused.`);
          if (Dec.of(rejected).cmp(0) > 0) refused.push({ itemId: line.itemId, itemName: line.itemName, unit: line.unit, projectId: line.projectId, quantity: rejected, reason: rejectReason });
          await client.query(`UPDATE stock_transfer_lines SET received = $3, loss_reason = $4, rejected = $5, reject_reason = $6 WHERE workspace_id = $1 AND id = $2`,
            [workspaceId, line.id, received, Dec.of(received).cmp(line.quantity) < 0 ? lossReason : "", rejected, Dec.of(rejected).cmp(0) > 0 ? rejectReason : ""]);
          if (Dec.of(received).cmp(0) > 0) {
            const sent = await this.sentCost(client, workspaceId, transferId, line.itemId, line.projectId);
            await move(client, workspaceId, { batchId: transferId, itemId: line.itemId, locationId: transfer.toLocationId, projectId: line.projectId, kind: "transfer_in", quantity: Dec.of(received).toString(),
              forProjectId: line.projectId, transferId, movedOn: receivedOn, actorId: user.userId, unitCost: sent?.unitCost, currency: sent?.currency });
          }
        }
        await client.query(`UPDATE stock_transfers SET status = 'received', received_on = $3, received_by = $4 WHERE workspace_id = $1 AND id = $2`, [workspaceId, transferId, receivedOn, user.userId]);
        // Goods that didn't arrive whole at a project's site become a snag on the project, so they're followed up.
        const site = (await client.query<{ projectId: string | null; workOrderId: string | null }>(
          `SELECT place.project_id AS "projectId", moved.work_order_id AS "workOrderId" FROM stock_transfers moved
             JOIN stock_locations place ON place.workspace_id = moved.workspace_id AND place.id = moved.to_location_id
            WHERE moved.workspace_id = $1 AND moved.id = $2`, [workspaceId, transferId])).rows[0];
        if (short.length && site?.projectId) {
          const made = site.workOrderId ? (await client.query<{ packageId: string | null; boqLineId: string }>(
            `SELECT package_id AS "packageId", boq_line_id AS "boqLineId" FROM work_orders WHERE workspace_id = $1 AND id = $2`, [workspaceId, site.workOrderId])).rows[0] : null;
          await raiseSnag(client, workspaceId, { projectId: site.projectId, title: `Move ${transfer.number} arrived short`, description: short.join("\n"), severity: "major", source: "delivery",
            packageId: made?.packageId ?? null, boqLineId: made?.boqLineId ?? null, actorId: user.userId });
        }
        if (short.length) await this.tell(client, workspaceId, "stock.transfer_short", [transfer.sentBy], user.userId, `${transferId}:short`,
          { transfer: String(transfer.number), from: transfer.fromName, to: transfer.toName, note: short.join("; ").slice(0, 480) }, transferId);
        let returnId: string | null = null;
        if (refused.length) {
          // The refused goods leave where they arrived on a return trip to where they came from, tied to this move.
          const reasons = refused.map((line) => `${line.itemName} ${Dec.of(line.quantity).toString()} ${line.unit}: ${line.reason}`.replace(/\s+:/, ":")).join("; ");
          returnId = randomUUID();
          await this.sendWith(client, workspaceId, user.userId, { id: returnId, fromLocationId: transfer.toLocationId, toLocationId: transfer.fromLocationId, sentOn: receivedOn,
            note: `Refused at ${transfer.toName}: ${reasons}`.slice(0, 500), lines: refused.map((line) => ({ itemId: line.itemId, projectId: line.projectId, quantity: line.quantity })) });
          await client.query(`UPDATE stock_transfers SET returned_from_id = $3, work_order_id = $4 WHERE workspace_id = $1 AND id = $2`, [workspaceId, returnId, transferId, site?.workOrderId ?? null]);
          await this.tell(client, workspaceId, "stock.transfer_rejected", [transfer.sentBy], user.userId, `${transferId}:rejected`,
            { transfer: String(transfer.number), from: transfer.fromName, to: transfer.toName, note: reasons.slice(0, 480) }, transferId);
          if (site?.projectId) {
            const made = site.workOrderId ? (await client.query<{ packageId: string | null; boqLineId: string; number: number }>(
              `SELECT package_id AS "packageId", boq_line_id AS "boqLineId", number FROM work_orders WHERE workspace_id = $1 AND id = $2`, [workspaceId, site.workOrderId])).rows[0] : null;
            await raiseSnag(client, workspaceId, { projectId: site.projectId, title: `Move ${transfer.number}: goods refused at site`, description: reasons, severity: "major", source: "delivery",
              packageId: made?.packageId ?? null, boqLineId: made?.boqLineId ?? null, actorId: user.userId });
          }
          // Made goods refused at site are made again: their work order goes back into production for that much.
          if (site?.workOrderId) {
            const quantity = refused.reduce((total, line) => total.add(line.quantity), Dec.ZERO).toString();
            await reworkFromSite(client, workspaceId, { workOrderId: site.workOrderId, quantity, reason: refused.map((line) => line.reason).join("; "), dispatchId: transferId, returnId, actorId: user.userId });
          }
        }
        // A return trip bringing refused made goods back: they're taken back into production (remade and checked again), so they don't count twice.
        const back = (await client.query<{ returnedFromId: string | null; workOrderId: string | null; number: number | null }>(
          `SELECT moved.returned_from_id AS "returnedFromId", moved.work_order_id AS "workOrderId", made.number FROM stock_transfers moved
             LEFT JOIN work_orders made ON made.workspace_id = moved.workspace_id AND made.id = moved.work_order_id WHERE moved.workspace_id = $1 AND moved.id = $2`, [workspaceId, transferId])).rows[0];
        if (back?.returnedFromId && back.workOrderId)
          for (const line of (await readTransfer(client, workspaceId, transferId))!.lines)
            if (line.received && Dec.of(line.received).cmp(0) > 0)
              await move(client, workspaceId, { batchId: randomUUID(), itemId: line.itemId, locationId: transfer.toLocationId, projectId: line.projectId, kind: "adjust",
                quantity: Dec.of(line.received).neg().toString(), forProjectId: line.projectId, reason: `Back into production for rework on WO-${String(back.number).padStart(4, "0")}`,
                movedOn: receivedOn, actorId: user.userId });
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "stock.transfer_received", entityType: "stock_transfer", entityId: transferId, after: { receivedOn, short, refused, returnId } });
      } else if (action === "cancel") {
        if (!(await this.access.hasPermission(client, workspaceId, user.userId, "stock.manage"))) throw new ForbiddenException("You can't cancel moves.");
        if (transfer.returnedFromId && transfer.workOrderId) throw new ConflictException("Refused made goods go back to the factory to be made again; receive this trip when it arrives.");
        const reason = required(body.reason, 500, "Say why the move is cancelled.");
        const today = await this.today(client, workspaceId);
        for (const line of lines) {
          const sent = await this.sentCost(client, workspaceId, transferId, line.itemId, line.projectId);
          await move(client, workspaceId, { batchId: transferId, itemId: line.itemId, locationId: transfer.fromLocationId, projectId: line.projectId, kind: "transfer_in", quantity: line.quantity,
            forProjectId: line.projectId, transferId, reason, movedOn: today, actorId: user.userId, unitCost: sent?.unitCost, currency: sent?.currency });
        }
        await client.query(`UPDATE stock_transfers SET status = 'cancelled', cancel_reason = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, transferId, reason]);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "stock.transfer_cancelled", entityType: "stock_transfer", entityId: transferId, after: { reason } });
      } else throw new BadRequestException("Unknown action.");
      return this.transferDetail(client, workspaceId, transferId, user.userId);
    });
  }

  /**
   * Sets, changes or removes an item's reorder point (at one place, or every place together): the free stock
   * at or below which it's low, what to order then and from whom. Version-checked; replayed safely by its id.
   */
  setReorderPoint(actor: RequestActor, workspaceId: string, body: Record<string, unknown>) {
    return this.access.withAnyPermission(actor, workspaceId, ["stock.manage", "stock.adjust"], async (client, user) => {
      const id = uuid(body.id, "Reorder point");
      const existing = (await client.query<{ itemId: string; locationId: string | null; version: number }>(
        `SELECT item_id AS "itemId", location_id AS "locationId", version FROM stock_reorder_points WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, id])).rows[0];
      if (existing && body.version !== existing.version) throw new ConflictException("Someone else changed this reorder point. Reload to see their change.");
      if (body.remove === true) {
        if (!existing) return this.state(client, workspaceId, user.userId);
        await client.query(`DELETE FROM stock_reorder_points WHERE workspace_id = $1 AND id = $2`, [workspaceId, id]);
        await recordAudit(client, { workspaceId, actorUserId: user.userId, action: "stock.reorder_point_removed", entityType: "stock_item", entityId: existing.itemId, before: existing });
        return this.state(client, workspaceId, user.userId);
      }
      const itemId = existing?.itemId ?? await this.item(client, workspaceId, body.itemId);
      const locationId = existing ? existing.locationId : body.locationId ? (await this.location(client, workspaceId, body.locationId)).id : null;
      const reorderAt = amount(body.reorderAt, "Reorder at");
      const reorderQuantity = body.reorderQuantity === undefined || body.reorderQuantity === null || body.reorderQuantity === "" ? null : amount(body.reorderQuantity, "Order");
      if (reorderQuantity !== null && Dec.of(reorderQuantity).isZero()) throw new BadRequestException("Order more than zero, or leave it empty.");
      const vendorId = optionalUuid(body.vendorId, "Supplier");
      if (vendorId && !(await client.query(`SELECT 1 FROM workspace_vendors WHERE workspace_id = $1 AND id = $2 AND status <> 'archived'`, [workspaceId, vendorId])).rowCount)
        throw new BadRequestException("Choose a supplier that isn't archived.");
      if (existing)
        await client.query(`UPDATE stock_reorder_points SET reorder_at = $3, reorder_quantity = $4, vendor_id = $5, updated_by = $6, version = version + 1, updated_at = now()
          WHERE workspace_id = $1 AND id = $2`, [workspaceId, id, reorderAt, reorderQuantity, vendorId, user.userId]);
      else {
        const clash = (await client.query(`SELECT 1 FROM stock_reorder_points WHERE workspace_id = $1 AND item_id = $2 AND location_id IS NOT DISTINCT FROM $3::uuid`,
          [workspaceId, itemId, locationId])).rowCount;
        if (clash) throw new ConflictException("This item already has a reorder point there. Change that one.");
        await client.query(`INSERT INTO stock_reorder_points (id, workspace_id, item_id, location_id, reorder_at, reorder_quantity, vendor_id, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, workspaceId, itemId, locationId, reorderAt, reorderQuantity, vendorId, user.userId]);
      }
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: existing ? "stock.reorder_point_changed" : "stock.reorder_point_set", entityType: "stock_item", entityId: itemId,
        after: { locationId, reorderAt, reorderQuantity, vendorId } });
      // Already short when it's set: the people who keep and buy stock hear now, not tomorrow.
      await processStockLevels(client, workspaceId, [itemId]);
      return this.state(client, workspaceId, user.userId);
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

  /** A stock correction waiting for approval: someone other than whoever counted applies it or refuses it (with why). */
  decideAdjustment(actor: RequestActor, workspaceId: string, requestId: string, body: Record<string, unknown>) {
    return this.access.withPermission(actor, workspaceId, "stock.adjust", async (client, user) => {
      const request = (await client.query<{ itemId: string; locationId: string; projectId: string | null; difference: string; reason: string; status: string; requestedBy: string }>(
        `SELECT item_id AS "itemId", location_id AS "locationId", project_id AS "projectId", difference::text AS difference, reason, status, requested_by AS "requestedBy"
           FROM stock_adjustment_requests WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, uuid(requestId, "Correction")])).rows[0];
      if (!request) throw new NotFoundException("Correction not found.");
      if (request.status !== "pending") throw new ConflictException("This correction is already decided.");
      if (request.requestedBy === user.userId) throw new ForbiddenException("Someone else approves a correction you counted.");
      const approve = body.action === "approve";
      if (!approve && body.action !== "reject") throw new BadRequestException("Unknown action.");
      const note = text(body.note, 500, "Note");
      if (!approve && !note) throw new BadRequestException("Say why it's refused.");
      if (approve)
        await move(client, workspaceId, { batchId: randomUUID(), itemId: request.itemId, locationId: request.locationId, projectId: request.projectId, kind: "adjust", quantity: request.difference,
          forProjectId: request.projectId, reason: `Count: ${request.reason}`, movedOn: await this.today(client, workspaceId), actorId: user.userId });
      await client.query(`UPDATE stock_adjustment_requests SET status = $3, decided_by = $4, decided_at = now(), decision_note = $5 WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, requestId, approve ? "approved" : "rejected", user.userId, note]);
      await recordAudit(client, { workspaceId, actorUserId: user.userId, action: approve ? "stock.adjustment_approved" : "stock.adjustment_rejected", entityType: "stock_item", entityId: request.itemId,
        after: { requestId, note } });
      return this.state(client, workspaceId, user.userId);
    });
  }

  // ---------- helpers ----------
  /** The cost a move's line left with (in the workspace's currency), so it arrives carrying the same. */
  private async sentCost(client: Db, workspaceId: string, transferId: string, itemId: string, projectId: string | null) {
    return (await client.query<{ unitCost: string; currency: string }>(
      `SELECT unit_cost::text AS "unitCost", currency FROM stock_movements WHERE workspace_id = $1 AND transfer_id = $2 AND item_id = $3 AND project_id IS NOT DISTINCT FROM $4::uuid
          AND kind = 'transfer_out' AND unit_cost IS NOT NULL ORDER BY seq LIMIT 1`, [workspaceId, transferId, itemId, projectId])).rows[0] ?? null;
  }

  private async firstTime(client: Db, workspaceId: string, id: string, action: string, actorId: string) {
    return Boolean((await client.query(`INSERT INTO stock_commands (workspace_id, id, action, actor_id) VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, id) DO NOTHING`,
      [workspaceId, id, action.slice(0, 24), actorId])).rowCount);
  }

  private async state(client: Db, workspaceId: string, userId: string) {
    // QA-006: what stock is worth (valuation, average cost, a correction's value) only for the people who see stock costs.
    const canSeeCosts = await holdsAny(client, this.access, workspaceId, userId, STOCK_COST_READERS);
    const state = await this.stockState(client, workspaceId, userId);
    return canSeeCosts ? { ...state, canSeeCosts }
      : { ...state, canSeeCosts, rows: state.rows.map((row) => ({ ...row, value: null, averageCost: null })), pendingAdjustments: state.pendingAdjustments.map((request) => ({ ...request, value: null })) };
  }

  private async stockState(client: Db, workspaceId: string, userId: string) {
    return {
      rows: await readStock(client, workspaceId),
      // Every item kept, so a list imported without quantities shows (at nothing on hand).
      items: await readStockItems(client, workspaceId),
      locations: await readLocations(client, workspaceId),
      projects: (await client.query<{ id: string; reference: string; name: string }>(
        `SELECT id, reference, name FROM delivery_projects WHERE workspace_id = $1 AND status IN ('active', 'on_hold') ORDER BY reference`, [workspaceId])).rows,
      inTransit: (await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM stock_transfers WHERE workspace_id = $1 AND status = 'in_transit'`, [workspaceId])).rows[0].count,
      pendingAdjustments: (await client.query<{ id: string; itemName: string; unit: string; locationName: string; projectReference: string | null; counted: string; difference: string; value: string;
        reason: string; requestedBy: string; requestedByName: string; requestedAt: string }>(
        `SELECT request.id, item.name AS "itemName", item.unit, location.name AS "locationName", project.reference AS "projectReference", request.counted::text AS counted,
                request.difference::text AS difference, request.value::text AS value, request.reason, request.requested_by AS "requestedBy", person.display_name AS "requestedByName",
                request.requested_at AS "requestedAt"
           FROM stock_adjustment_requests request
           JOIN stock_items item ON item.workspace_id = request.workspace_id AND item.id = request.item_id
           JOIN stock_locations location ON location.workspace_id = request.workspace_id AND location.id = request.location_id
           LEFT JOIN delivery_projects project ON project.workspace_id = request.workspace_id AND project.id = request.project_id
           JOIN users person ON person.id = request.requested_by
          WHERE request.workspace_id = $1 AND request.status = 'pending' ORDER BY request.requested_at`, [workspaceId])).rows,
      me: userId,
      currency: (await client.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency ?? "",
      reorderPoints: await readReorderPoints(client, workspaceId),
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

  private async currency(client: Db, workspaceId: string) {
    return (await client.query<{ currency: string | null }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency ?? null;
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
