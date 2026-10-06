import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { averageCost, move } from "../inventory/stock";
import { processStockLevels } from "../inventory/stock-levels";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { permissionHolders } from "../project-core/project-release";
import { dealRule, opportunityOfCase, opportunityOfProject, type DealRule } from "./fulfilment-rules";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-125: stock held and taken out by the events of a deal's path, in the background of the command that caused the
 * event (same tenant transaction). Every step is idempotent per event: a reservation is one row per source line
 * (an accepted quotation line, a supplier order's received line, a work order's material), so replays, retries and a
 * second acceptance never hold or take twice.
 *   - A deal's goods (paths A, B, C) are a soft hold on free stock; taking them writes 'sale' movements out of free
 *     stock (at average cost), and a cancellation or refund writes them back as 'sale_return' where they left.
 *   - Production materials (paths D, E) use the existing ownership model: booking production allocates free stock to
 *     the project, starting production issues it to the work order, and a cancellation releases what wasn't used.
 * Too little in stock never stops the sale or the production: what's missing is recorded on the reservation and the
 * people who keep stock hear at once. Shopify and other channels follow through `publishStockChange` (PLM-086).
 */

export type Reservation = {
  id: string; source: "quote_line" | "supplier_receipt" | "work_order_material"; itemId: string; itemName: string; unit: string; locationId: string | null;
  locationName: string | null; quantity: string; status: "reserved" | "deducted" | "released"; deducted: string; returned: string; reason: string;
  reservedAt: string; deductedAt: string | null; releasedAt: string | null; workOrderId: string | null;
};

export async function readReservations(db: Db, workspaceId: string, filter: { opportunityId?: string; projectId?: string }): Promise<Reservation[]> {
  return (await db.query<Reservation>(
    `SELECT held.id, held.source, held.item_id AS "itemId", item.name AS "itemName", item.unit, held.location_id AS "locationId", place.name AS "locationName",
            held.quantity::text AS quantity, held.status, held.deducted::text AS deducted, held.returned::text AS returned, held.reason, held.reserved_at AS "reservedAt",
            held.deducted_at AS "deductedAt", held.released_at AS "releasedAt", held.work_order_id AS "workOrderId"
       FROM stock_reservations held
       JOIN stock_items item ON item.workspace_id = held.workspace_id AND item.id = held.item_id
       LEFT JOIN stock_locations place ON place.workspace_id = held.workspace_id AND place.id = held.location_id
      WHERE held.workspace_id = $1 AND ($2::uuid IS NULL OR held.opportunity_id = $2) AND ($3::uuid IS NULL OR held.project_id = $3)
      ORDER BY held.reserved_at, item.name`, [workspaceId, filter.opportunityId ?? null, filter.projectId ?? null])).rows;
}

/** What a reservation is short of: asked less what was taken (only once it was taken). */
export function shortOf(reservation: Pick<Reservation, "status" | "quantity" | "deducted">) {
  if (reservation.status !== "deducted") return "0";
  const short = Dec.of(reservation.quantity).sub(reservation.deducted);
  return short.cmp(0) > 0 ? short.toString() : "0";
}

/**
 * Where to take free stock from, in order: the place it's held at, then each kind's default place, then the place
 * with the most. Never a project's site.
 */
export async function freeStockPlaces(db: Db, workspaceId: string, itemId: string, preferred: string | null) {
  return (await db.query<{ locationId: string; onHand: string }>(
    `SELECT balance.location_id AS "locationId", balance.on_hand::text AS "onHand"
       FROM stock_balances balance JOIN stock_locations place ON place.workspace_id = balance.workspace_id AND place.id = balance.location_id
      WHERE balance.workspace_id = $1 AND balance.item_id = $2 AND balance.project_id IS NULL AND balance.on_hand > 0 AND place.kind <> 'site' AND place.active
      ORDER BY (balance.location_id = $3::uuid) DESC NULLS LAST, place.is_default DESC, balance.on_hand DESC, place.name
      FOR UPDATE OF balance`, [workspaceId, itemId, preferred])).rows;
}

async function today(db: Db, workspaceId: string) {
  return (await db.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`,
    [workspaceId])).rows[0].today;
}

async function dealTitle(db: Db, workspaceId: string, opportunityId: string) {
  return (await db.query<{ title: string; ownerId: string | null }>(
    `SELECT concat_ws(' · ', opportunity.reference, coalesce(party.display_name, opportunity.title)) AS title, owner.user_id AS "ownerId"
       FROM crm_opportunities opportunity
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN workspace_memberships owner ON owner.workspace_id = opportunity.workspace_id AND owner.id = opportunity.owner_membership_id AND owner.status = 'active'
      WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`, [workspaceId, opportunityId])).rows[0] ?? { title: "", ownerId: null };
}

/**
 * The hook other sales channels follow (PLM-086, Shopify): one outbox event per change of free stock, naming the items.
 * A channel adapter (none yet) reads what's free now and updates its listings; nothing here depends on it.
 */
export async function publishStockChange(db: Db, workspaceId: string, itemIds: string[], cause: string, actorUserId: string | null) {
  const items = [...new Set(itemIds)];
  if (!items.length) return;
  const eventId = randomUUID();
  await db.query(
    `INSERT INTO outbox_events (id, workspace_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1, $2, 'workspace', $2, 'inventory.stock_changed.v1', $3::jsonb)`,
    [eventId, workspaceId, JSON.stringify({ schemaVersion: 1, eventId, workspaceId, aggregateType: "workspace", aggregateId: workspaceId, actorUserId,
      occurredAt: new Date().toISOString(), correlationId: eventId, causationId: null, data: { itemIds: items, cause } })]);
}

/** Tells the people who keep stock (and those set to hear about it) that a sale or production found too little. */
async function tellShort(db: Db, workspaceId: string, input: { key: string; item: string; deal: string; note: string; actorUserId: string | null; deepLink: string }) {
  const people = await permissionHolders(db, workspaceId, ["stock.manage", "stock.alerts"]);
  for (const userId of new Set(people.map((person) => person.userId))) {
    if (userId === input.actorUserId) continue;
    const message = { workspaceId, recipientUserId: userId, code: "stock.sale_short", eventType: "stock.sale_short", variables: { item: input.item, deal: input.deal, note: input.note },
      deepLink: input.deepLink };
    const key = `stock.sale_short:${input.key}:${userId}`.slice(0, 200);
    await notifyUserInApp(db, { ...message, idempotencyKey: key });
    await queueUserEmail(db, { ...message, idempotencyKey: `${key}:email` });
  }
}

/** The quotation a deal's goods come from: the accepted one, else the latest still on the table. */
async function dealQuote(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ id: string; number: number }>(
    `SELECT id, number FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND kind = 'quotation' AND status NOT IN ('superseded', 'withdrawn', 'declined')
      ORDER BY (status = 'accepted') DESC, number DESC LIMIT 1`, [workspaceId, caseId])).rows[0] ?? null;
}

/**
 * Quote approved (accepted, or marked client approved on the deal): every stocked item on the quotation is held for
 * the deal, when its path holds stock then. A later accepted revision replaces what the earlier one held.
 */
export async function reserveForDeal(db: Db, workspaceId: string, input: { opportunityId: string; caseId?: string | null; quoteId?: string | null; actorUserId: string | null }) {
  const rule = await dealRule(db, workspaceId, input.opportunityId);
  if (!rule || rule.reserveOn !== "quote_accepted" || rule.cancelledAt) return 0;
  return holdQuoteLines(db, workspaceId, rule, input);
}

async function holdQuoteLines(db: Db, workspaceId: string, rule: DealRule, input: { opportunityId: string; caseId?: string | null; quoteId?: string | null; actorUserId: string | null }) {
  const caseId = input.caseId ?? rule.caseId;
  if (!caseId) return 0;
  const quote = input.quoteId ? { id: input.quoteId } : await dealQuote(db, workspaceId, caseId);
  if (!quote) return 0;
  await db.query(`SELECT 1 FROM crm_opportunities WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, input.opportunityId]);
  // Lines of another quotation that are still only held give way to this one.
  const replaced = await db.query<{ itemId: string }>(
    `UPDATE stock_reservations SET status = 'released', released_at = now(), reason = 'Replaced by another quotation'
      WHERE workspace_id = $1 AND opportunity_id = $2 AND source = 'quote_line' AND status = 'reserved' AND source_key NOT LIKE $3 RETURNING item_id AS "itemId"`,
    [workspaceId, input.opportunityId, `${caseId}:${quote.id}:%`]);
  const lines = (await db.query<{ lineId: string; itemId: string; quantity: string; title: string }>(
    `SELECT line.id AS "lineId", stock.id AS "itemId", line.quantity::text AS quantity, line.title
       FROM commercial_quote_lines line
       JOIN commercial_quotes quote ON quote.workspace_id = line.workspace_id AND quote.case_id = line.case_id AND quote.id = line.quote_id
       JOIN stock_items stock ON stock.workspace_id = line.workspace_id AND stock.catalog_item_id = line.catalog_item_id AND stock.active
      WHERE line.workspace_id = $1 AND line.case_id = $2 AND line.quote_id = $3 AND line.kind = 'item' AND line.quantity > 0
        AND (line.optional IS NOT TRUE OR line.id IN (SELECT jsonb_array_elements_text(coalesce(quote.detail->'clientDecision'->'selectedOptionLineIds', '[]'::jsonb))))
      ORDER BY line.sort_order`, [workspaceId, caseId, quote.id])).rows;
  const held: string[] = [];
  for (const line of lines) {
    const inserted = await db.query(
      `INSERT INTO stock_reservations (id, workspace_id, source, source_key, opportunity_id, item_id, location_id, quantity, reason) VALUES ($1, $2, 'quote_line', $3, $4, $5, $6, $7, $8)
       ON CONFLICT (workspace_id, source, source_key) DO NOTHING`,
      [randomUUID(), workspaceId, `${caseId}:${quote.id}:${line.lineId}`, input.opportunityId, line.itemId, rule.takeFromLocationId, line.quantity, line.title.slice(0, 500)]);
    if (inserted.rowCount) held.push(line.itemId);
  }
  if (!held.length && !replaced.rowCount) return 0;
  const items = [...held, ...replaced.rows.map((row) => row.itemId)];
  await recordAudit(db, { workspaceId, actorUserId: input.actorUserId, source: input.actorUserId ? "user" : "internal", action: "stock.reserved_for_deal",
    entityType: "crm_opportunity", entityId: input.opportunityId, after: { quoteId: quote.id, lines: held.length, released: replaced.rowCount ?? 0 } });
  // Held stock is no longer free: it may now be low.
  await processStockLevels(db, workspaceId, [...new Set(items)]);
  await publishStockChange(db, workspaceId, items, "reserved", input.actorUserId);
  return held.length;
}

/**
 * Takes a deal's held goods out of free stock when its path says this event takes them (Won for A and B, collection or
 * delivery for C). Goods the path holds at the quotation but that weren't held yet are held first.
 */
export async function takeForDeal(db: Db, workspaceId: string, input: { opportunityId: string; event: "won" | "fulfilled"; actorUserId: string | null }) {
  const rule = await dealRule(db, workspaceId, input.opportunityId);
  if (!rule || rule.status !== "won" || rule.deductOn !== input.event || rule.cancelledAt) return 0;
  if (rule.reserveOn === "quote_accepted") await holdQuoteLines(db, workspaceId, rule, { opportunityId: input.opportunityId, actorUserId: input.actorUserId });
  const held = (await db.query<{ id: string; itemId: string; itemName: string; unit: string; locationId: string | null; quantity: string }>(
    `SELECT held.id, held.item_id AS "itemId", item.name AS "itemName", item.unit, held.location_id AS "locationId", held.quantity::text AS quantity
       FROM stock_reservations held JOIN stock_items item ON item.workspace_id = held.workspace_id AND item.id = held.item_id
      WHERE held.workspace_id = $1 AND held.opportunity_id = $2 AND held.status = 'reserved' AND held.source IN ('quote_line', 'supplier_receipt')
      ORDER BY held.reserved_at FOR UPDATE OF held`, [workspaceId, input.opportunityId])).rows;
  if (!held.length) return 0;
  const deal = await dealTitle(db, workspaceId, input.opportunityId);
  const movedOn = await today(db, workspaceId);
  const short: string[] = [];
  for (const reservation of held) {
    let left = Dec.of(reservation.quantity);
    let first: string | null = null;
    for (const place of await freeStockPlaces(db, workspaceId, reservation.itemId, reservation.locationId)) {
      if (left.cmp(0) <= 0) break;
      const take = left.cmp(place.onHand) < 0 ? left : Dec.of(place.onHand);
      const cost = await averageCost(db, workspaceId, reservation.itemId, place.locationId, null);
      await move(db, workspaceId, { batchId: reservation.id, itemId: reservation.itemId, locationId: place.locationId, projectId: null, kind: "sale",
        quantity: take.neg().toString(), reason: `Sold · ${deal.title}`.slice(0, 500), movedOn, actorId: input.actorUserId ?? await systemActor(db, workspaceId),
        unitCost: cost?.unitCost, currency: cost?.currency, reservationId: reservation.id });
      first ??= place.locationId;
      left = left.sub(take);
    }
    const taken = Dec.of(reservation.quantity).sub(left);
    await db.query(`UPDATE stock_reservations SET status = 'deducted', deducted = $3, deducted_at = now(), location_id = coalesce(location_id, $4) WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, reservation.id, taken.toString(), first]);
    if (left.cmp(0) > 0) {
      short.push(`${reservation.itemName}: ${left.toString()} ${reservation.unit}`.trim());
      await tellShort(db, workspaceId, { key: reservation.id, item: reservation.itemName, deal: deal.title, actorUserId: input.actorUserId,
        note: `${left.toString()} ${reservation.unit} short of ${Dec.of(reservation.quantity).toString()} ${reservation.unit}.`.replace(/\s+\./g, "."),
        deepLink: `/workspace/crm/opportunities?record=${input.opportunityId}` });
    }
  }
  const items = held.map((row) => row.itemId);
  await recordAudit(db, { workspaceId, actorUserId: input.actorUserId, source: input.actorUserId ? "user" : "internal", action: "stock.taken_for_deal",
    entityType: "crm_opportunity", entityId: input.opportunityId, after: { event: input.event, lines: held.length, short } });
  await processStockLevels(db, workspaceId, [...new Set(items)]);
  await publishStockChange(db, workspaceId, items, "sold", input.actorUserId);
  return held.length;
}

/** Commands run by the system use the deal's owner, else the workspace's first owner, as the movement's actor. */
async function systemActor(db: Db, workspaceId: string) {
  return (await db.query<{ userId: string }>(
    `SELECT membership.user_id AS "userId" FROM workspace_memberships membership WHERE membership.workspace_id = $1 AND membership.status = 'active'
      ORDER BY membership.created_at LIMIT 1`, [workspaceId])).rows[0].userId;
}

/**
 * Path C: a supplier order raised for a deal is received (each accepted delivery, also after inspection, holds once). Its goods are booked into stock where they arrived (the
 * receipt does that) and held for the deal until they go out to the client; the deal's owner hears they're in.
 */
export async function holdReceivedForDeals(db: Db, workspaceId: string, input: { receiptId: string; actorUserId: string }) {
  const lines = (await db.query<{ receiptLineId: string; opportunityId: string; itemId: string; locationId: string; quantity: string; title: string; createdBy: string }>(
    `SELECT movement.id AS "receiptLineId", ordered.opportunity_id AS "opportunityId", movement.item_id AS "itemId", movement.location_id AS "locationId",
            movement.quantity::text AS quantity, ordered.description AS title, purchase.created_by AS "createdBy"
       FROM goods_receipt_lines received
       JOIN purchase_order_lines ordered ON ordered.workspace_id = received.workspace_id AND ordered.id = received.order_line_id
       JOIN purchase_orders purchase ON purchase.workspace_id = ordered.workspace_id AND purchase.id = ordered.order_id
       JOIN stock_movements movement ON movement.workspace_id = received.workspace_id AND movement.receipt_line_id = received.id AND movement.kind = 'receive'
      WHERE received.workspace_id = $1 AND received.receipt_id = $2 AND ordered.opportunity_id IS NOT NULL`, [workspaceId, input.receiptId])).rows;
  const byDeal = new Map<string, typeof lines>();
  for (const line of lines) byDeal.set(line.opportunityId, [...(byDeal.get(line.opportunityId) ?? []), line]);
  let held = 0;
  for (const [opportunityId, rows] of byDeal) {
    const rule = await dealRule(db, workspaceId, opportunityId);
    if (!rule || rule.reserveOn !== "supplier_received" || rule.cancelledAt) continue;
    const added: typeof rows = [];
    for (const line of rows) {
      const inserted = await db.query(
        `INSERT INTO stock_reservations (id, workspace_id, source, source_key, opportunity_id, item_id, location_id, quantity, reason) VALUES ($1, $2, 'supplier_receipt', $3, $4, $5, $6, $7, $8)
         ON CONFLICT (workspace_id, source, source_key) DO NOTHING`,
        [randomUUID(), workspaceId, line.receiptLineId, opportunityId, line.itemId, line.locationId, line.quantity, line.title.slice(0, 500)]);
      if (inserted.rowCount) added.push(line);
    }
    if (!added.length) continue;
    held += added.length;
    const deal = await dealTitle(db, workspaceId, opportunityId);
    await recordAudit(db, { workspaceId, actorUserId: input.actorUserId, action: "stock.received_for_deal", entityType: "crm_opportunity", entityId: opportunityId,
      after: { receiptId: input.receiptId, lines: added.length } });
    const items = added.map((line) => line.title).slice(0, 3).join(", ");
    for (const userId of new Set([deal.ownerId, ...added.map((line) => line.createdBy)].filter((id): id is string => Boolean(id)))) {
      if (userId === input.actorUserId) continue;
      const message = { workspaceId, recipientUserId: userId, code: "fulfilment.order_arrived", eventType: "fulfilment.order_arrived", variables: { deal: deal.title, items },
        deepLink: `/workspace/crm/opportunities?record=${opportunityId}` };
      const key = `fulfilment.order_arrived:${input.receiptId}:${opportunityId}:${userId}`;
      await notifyUserInApp(db, { ...message, idempotencyKey: key });
      await queueUserEmail(db, { ...message, idempotencyKey: `${key}:email` });
    }
    await publishStockChange(db, workspaceId, added.map((line) => line.itemId), "received_for_deal", input.actorUserId);
  }
  return held;
}

/** A work order's materials and how much of each was already issued to it. */
async function materialsLeft(db: Db, workspaceId: string, filter: { projectId?: string; workOrderId?: string }) {
  return (await db.query<{ id: string; workOrderId: string; projectId: string; itemId: string; itemName: string; unit: string; quantity: string; issued: string }>(
    `SELECT material.id, work.id AS "workOrderId", work.project_id AS "projectId", material.item_id AS "itemId", item.name AS "itemName", item.unit, material.quantity::text AS quantity,
            coalesce((SELECT sum(-movement.quantity) FROM stock_movements movement WHERE movement.workspace_id = material.workspace_id AND movement.work_order_material_id = material.id), 0)::text AS issued
       FROM work_order_materials material
       JOIN work_orders work ON work.workspace_id = material.workspace_id AND work.id = material.work_order_id
       JOIN stock_items item ON item.workspace_id = material.workspace_id AND item.id = material.item_id
      WHERE material.workspace_id = $1 AND material.status = 'active' AND work.status NOT IN ('cancelled', 'ready', 'short_closed')
        AND ($2::uuid IS NULL OR work.project_id = $2) AND ($3::uuid IS NULL OR work.id = $3)
      ORDER BY work.number, material.id`, [workspaceId, filter.projectId ?? null, filter.workOrderId ?? null])).rows;
}

/**
 * Paths D and E: production booked (the factory slot) holds the work orders' materials for the project, from free
 * stock, by giving it to the project (the existing allocate movements). What the project already holds counts first.
 */
export async function reserveForProduction(db: Db, workspaceId: string, input: { projectId: string; actorUserId: string }) {
  const opportunityId = await opportunityOfProject(db, workspaceId, input.projectId);
  if (!opportunityId) return 0;
  const rule = await dealRule(db, workspaceId, opportunityId);
  if (!rule || rule.reserveOn !== "production_booked" || rule.cancelledAt) return 0;
  const movedOn = await today(db, workspaceId);
  const deal = await dealTitle(db, workspaceId, opportunityId);
  let held = 0;
  const items: string[] = [];
  const owned = new Map<string, Dec>();
  for (const material of await materialsLeft(db, workspaceId, { projectId: input.projectId })) {
    if ((await db.query(`SELECT 1 FROM stock_reservations WHERE workspace_id = $1 AND source = 'work_order_material' AND source_key = $2`, [workspaceId, material.id])).rowCount) continue;
    // Stock the project already holds of this item covers its materials first (shared across its work orders).
    if (!owned.has(material.itemId)) owned.set(material.itemId, Dec.of((await db.query<{ total: string }>(
      `SELECT coalesce(sum(on_hand), 0)::text AS total FROM stock_balances WHERE workspace_id = $1 AND item_id = $2 AND project_id = $3`,
      [workspaceId, material.itemId, input.projectId])).rows[0].total));
    const have = owned.get(material.itemId)!;
    let left = Dec.of(material.quantity).sub(material.issued);
    const covered = left.cmp(have) < 0 ? left : have;
    owned.set(material.itemId, have.sub(covered));
    left = left.sub(covered);
    if (left.cmp(0) <= 0) continue;
    const id = randomUUID();
    let taken = Dec.ZERO;
    let first: string | null = null;
    const places = await freeStockPlaces(db, workspaceId, material.itemId, null);
    for (const place of places) {
      if (left.cmp(0) <= 0) break;
      const take = left.cmp(place.onHand) < 0 ? left : Dec.of(place.onHand);
      const cost = await averageCost(db, workspaceId, material.itemId, place.locationId, null);
      const actorId = input.actorUserId;
      await move(db, workspaceId, { batchId: id, itemId: material.itemId, locationId: place.locationId, projectId: null, kind: "allocate", quantity: take.neg().toString(),
        forProjectId: input.projectId, reason: "Held for production", unitCost: cost?.unitCost, currency: cost?.currency, movedOn, actorId });
      await move(db, workspaceId, { batchId: id, itemId: material.itemId, locationId: place.locationId, projectId: input.projectId, kind: "allocate", quantity: take.toString(),
        forProjectId: input.projectId, reason: "Held for production", unitCost: cost?.unitCost, currency: cost?.currency, movedOn, actorId });
      first ??= place.locationId;
      taken = taken.add(take);
      left = left.sub(take);
    }
    if (taken.cmp(0) > 0) {
      await db.query(
        `INSERT INTO stock_reservations (id, workspace_id, source, source_key, opportunity_id, project_id, work_order_id, work_order_material_id, item_id, location_id, quantity, reason)
         VALUES ($1, $2, 'work_order_material', $3, $4, $5, $6, $7, $8, $9, $10, 'Held for production')`,
        [id, workspaceId, material.id, opportunityId, input.projectId, material.workOrderId, material.id, material.itemId, first, taken.toString()]);
      held += 1;
      items.push(material.itemId);
    }
    if (left.cmp(0) > 0) await tellShort(db, workspaceId, { key: `${material.id}:booked`, item: material.itemName, deal: deal.title, actorUserId: input.actorUserId,
      note: `${left.toString()} ${material.unit} more is needed for production; order it or count what's there.`.replace(/\s+more/, " more"),
      deepLink: `/workspace/projects/${input.projectId}` });
  }
  if (held) {
    await recordAudit(db, { workspaceId, actorUserId: input.actorUserId, action: "stock.reserved_for_production", entityType: "project", entityId: input.projectId, after: { materials: held } });
    await processStockLevels(db, workspaceId, [...new Set(items)]);
    await publishStockChange(db, workspaceId, items, "reserved", input.actorUserId);
  }
  return held;
}

/**
 * Paths D and E: production started takes the work order's materials out (issued to the work order, as the factory
 * issues them by hand), from what the project holds; what's missing is said, never blocking the start.
 */
export async function useForProduction(db: Db, workspaceId: string, input: { workOrderId: string; actorUserId: string }) {
  const work = (await db.query<{ projectId: string }>(`SELECT project_id AS "projectId" FROM work_orders WHERE workspace_id = $1 AND id = $2`, [workspaceId, input.workOrderId])).rows[0];
  if (!work) return 0;
  const opportunityId = await opportunityOfProject(db, workspaceId, work.projectId);
  if (!opportunityId) return 0;
  const rule = await dealRule(db, workspaceId, opportunityId);
  if (!rule || rule.deductOn !== "production_started" || rule.cancelledAt) return 0;
  const movedOn = await today(db, workspaceId);
  const deal = await dealTitle(db, workspaceId, opportunityId);
  let used = 0;
  const items: string[] = [];
  for (const material of await materialsLeft(db, workspaceId, { workOrderId: input.workOrderId })) {
    let left = Dec.of(material.quantity).sub(material.issued);
    if (left.cmp(0) <= 0) continue;
    const reserved = (await db.query<{ locationId: string | null }>(
      `SELECT location_id AS "locationId" FROM stock_reservations WHERE workspace_id = $1 AND source = 'work_order_material' AND source_key = $2 AND status = 'reserved' FOR UPDATE`,
      [workspaceId, material.id])).rows[0];
    const places = (await db.query<{ locationId: string; onHand: string }>(
      `SELECT balance.location_id AS "locationId", balance.on_hand::text AS "onHand" FROM stock_balances balance
         JOIN stock_locations place ON place.workspace_id = balance.workspace_id AND place.id = balance.location_id
        WHERE balance.workspace_id = $1 AND balance.item_id = $2 AND balance.project_id = $3 AND balance.on_hand > 0 AND place.kind <> 'site'
        ORDER BY (balance.location_id = $4::uuid) DESC NULLS LAST, (place.kind = 'factory') DESC, balance.on_hand DESC FOR UPDATE OF balance`,
      [workspaceId, material.itemId, work.projectId, reserved?.locationId ?? null])).rows;
    const batchId = randomUUID();
    for (const place of places) {
      if (left.cmp(0) <= 0) break;
      const take = left.cmp(place.onHand) < 0 ? left : Dec.of(place.onHand);
      await move(db, workspaceId, { batchId, itemId: material.itemId, locationId: place.locationId, projectId: work.projectId, kind: "issue", quantity: take.neg().toString(),
        forProjectId: work.projectId, workOrderId: input.workOrderId, workOrderMaterialId: material.id, reason: "Production started", movedOn, actorId: input.actorUserId });
      left = left.sub(take);
    }
    const issued = Dec.of(material.quantity).sub(material.issued).sub(left);
    if (reserved) await db.query(`UPDATE stock_reservations SET status = 'deducted', deducted = least(quantity, $3::numeric), deducted_at = now() WHERE workspace_id = $1 AND source = 'work_order_material' AND source_key = $2`,
      [workspaceId, material.id, issued.toString()]);
    if (issued.cmp(0) > 0) { used += 1; items.push(material.itemId); }
    if (left.cmp(0) > 0) await tellShort(db, workspaceId, { key: `${material.id}:started`, item: material.itemName, deal: deal.title, actorUserId: input.actorUserId,
      note: `Production started ${left.toString()} ${material.unit} short.`.replace(/\s+short/, " short"), deepLink: `/workspace/factory?workOrder=${input.workOrderId}` });
  }
  if (used) {
    await recordAudit(db, { workspaceId, actorUserId: input.actorUserId, action: "stock.used_for_production", entityType: "work_order", entityId: input.workOrderId, after: { materials: used } });
    await processStockLevels(db, workspaceId, [...new Set(items)]);
  }
  return used;
}

/**
 * Cancel or refund (PLM-109): everything still held for the deal is released, goods it took go back where they left
 * (as 'sale_return'), and production materials held but not used go back to free stock. Materials already used in
 * production stay used. Idempotent: a released reservation is never released again.
 */
export async function releaseForDeal(db: Db, workspaceId: string, input: { opportunityId: string; reason: string; actorUserId: string | null }) {
  const rows = (await db.query<{ id: string; source: string; itemId: string; status: string; projectId: string | null; locationId: string | null; deducted: string; quantity: string }>(
    `SELECT id, source, item_id AS "itemId", status, project_id AS "projectId", location_id AS "locationId", deducted::text AS deducted, quantity::text AS quantity
       FROM stock_reservations WHERE workspace_id = $1 AND opportunity_id = $2 AND status <> 'released' ORDER BY reserved_at FOR UPDATE`,
    [workspaceId, input.opportunityId])).rows;
  if (!rows.length) return 0;
  const movedOn = await today(db, workspaceId);
  const actorId = input.actorUserId ?? await systemActor(db, workspaceId);
  for (const row of rows) {
    let returned = "0";
    if (row.source !== "work_order_material" && row.status === "deducted") {
      // Back where each part left, at the cost it left with.
      const sold = (await db.query<{ locationId: string; quantity: string; unitCost: string | null; currency: string | null }>(
        `SELECT location_id AS "locationId", sum(-quantity)::text AS quantity, max(unit_cost)::text AS "unitCost", max(currency) AS currency FROM stock_movements
          WHERE workspace_id = $1 AND reservation_id = $2 AND kind = 'sale' GROUP BY location_id`, [workspaceId, row.id])).rows;
      for (const part of sold) {
        if (Dec.of(part.quantity).cmp(0) <= 0) continue;
        await move(db, workspaceId, { batchId: row.id, itemId: row.itemId, locationId: part.locationId, projectId: null, kind: "sale_return", quantity: part.quantity,
          reason: `Back from a cancelled sale: ${input.reason}`.slice(0, 500), movedOn, actorId, unitCost: part.unitCost, currency: part.unitCost ? part.currency : null,
          reservationId: row.id });
      }
      returned = row.deducted;
    } else if (row.source === "work_order_material" && row.status === "reserved" && row.projectId && row.locationId) {
      // Held for production and not used: the project gives it back to free stock (what it still has there).
      const have = Dec.of((await db.query<{ onHand: string }>(
        `SELECT coalesce(on_hand, 0)::text AS "onHand" FROM stock_balances WHERE workspace_id = $1 AND item_id = $2 AND location_id = $3 AND project_id = $4 FOR UPDATE`,
        [workspaceId, row.itemId, row.locationId, row.projectId])).rows[0]?.onHand ?? "0");
      const back = Dec.of(row.quantity).cmp(have) < 0 ? Dec.of(row.quantity) : have;
      if (back.cmp(0) > 0) {
        const cost = await averageCost(db, workspaceId, row.itemId, row.locationId, row.projectId);
        await move(db, workspaceId, { batchId: row.id, itemId: row.itemId, locationId: row.locationId, projectId: row.projectId, kind: "release", quantity: back.neg().toString(),
          forProjectId: row.projectId, reason: input.reason.slice(0, 500), movedOn, actorId, unitCost: cost?.unitCost, currency: cost?.currency });
        await move(db, workspaceId, { batchId: row.id, itemId: row.itemId, locationId: row.locationId, projectId: null, kind: "release", quantity: back.toString(),
          forProjectId: row.projectId, reason: input.reason.slice(0, 500), movedOn, actorId, unitCost: cost?.unitCost, currency: cost?.currency });
      }
    }
    if (row.source === "work_order_material" && row.status === "deducted") continue;
    await db.query(`UPDATE stock_reservations SET status = 'released', released_at = now(), returned = $3, reason = $4 WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, row.id, returned, input.reason.slice(0, 500)]);
  }
  const items = rows.map((row) => row.itemId);
  await recordAudit(db, { workspaceId, actorUserId: input.actorUserId, source: input.actorUserId ? "user" : "internal", action: "stock.released_for_deal",
    entityType: "crm_opportunity", entityId: input.opportunityId, after: { reason: input.reason, lines: rows.length } });
  await processStockLevels(db, workspaceId, [...new Set(items)]);
  await publishStockChange(db, workspaceId, items, "released", input.actorUserId);
  return rows.length;
}

/** Quote accepted on a case: holds the deal's goods (the case's deal, when it has one). */
export async function reserveForAcceptedQuote(db: Db, workspaceId: string, input: { caseId: string; quoteId?: string | null; actorUserId: string | null }) {
  const opportunityId = await opportunityOfCase(db, workspaceId, input.caseId);
  if (!opportunityId) return 0;
  return reserveForDeal(db, workspaceId, { opportunityId, caseId: input.caseId, quoteId: input.quoteId ?? null, actorUserId: input.actorUserId });
}
