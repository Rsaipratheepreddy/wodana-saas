import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { convert, STANDARD_UNITS, type ItemConversion, type Unit } from "../catalog-core/units";

type Db = Pick<PoolClient, "query">;

export const MOVEMENT_KINDS = ["receive", "issue", "return", "transfer_out", "transfer_in", "allocate", "release", "adjust", "supplier_return", "reverse", "produce"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/** Items without a catalog item are told apart by their name and unit. */
export function normalKey(name: string, unit: string) {
  return `${name.trim().toLocaleLowerCase().replace(/\s+/g, " ")}|${unit.trim().toLocaleLowerCase()}`.slice(0, 300);
}

/** The stock item for something bought: its catalog item when it has one in the same unit, otherwise by name and unit. Made on first use. */
export async function stockItemFor(db: Db, workspaceId: string, input: { catalogItemId: string | null; name: string; unit: string; code?: string }) {
  let catalogItemId = input.catalogItemId;
  if (catalogItemId) {
    const catalog = (await db.query<{ name: string; unit: string; label: string | null; code: string }>(
      `SELECT item.name, item.unit_code AS unit, unit.label, item.code FROM catalog_items item
         LEFT JOIN catalog_units unit ON unit.workspace_id = item.workspace_id AND unit.code = item.unit_code
        WHERE item.workspace_id = $1 AND item.id = $2`, [workspaceId, catalogItemId])).rows[0];
    // The catalog's unit, by its code ("sqm") or its label ("m²"); bought in another unit keeps it apart, so quantities never mix units.
    const same = (unit: string | null) => Boolean(unit) && unit!.trim().toLocaleLowerCase() === input.unit.trim().toLocaleLowerCase();
    if (!catalog || (input.unit.trim() && !same(catalog.unit) && !same(catalog.label))) catalogItemId = null;
    else {
      await db.query(
        `INSERT INTO stock_items (id, workspace_id, catalog_item_id, name, unit, code, normal_key) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (workspace_id, catalog_item_id) WHERE catalog_item_id IS NOT NULL DO NOTHING`,
        [randomUUID(), workspaceId, catalogItemId, catalog.name, catalog.label || catalog.unit, catalog.code ?? "", normalKey(catalog.name, catalog.label || catalog.unit)]);
      return (await db.query<{ id: string }>(`SELECT id FROM stock_items WHERE workspace_id = $1 AND catalog_item_id = $2`, [workspaceId, catalogItemId])).rows[0].id;
    }
  }
  const key = normalKey(input.name, input.unit);
  await db.query(
    `INSERT INTO stock_items (id, workspace_id, name, unit, code, normal_key) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (workspace_id, normal_key) WHERE catalog_item_id IS NULL DO NOTHING`,
    [randomUUID(), workspaceId, input.name.trim().slice(0, 240), input.unit.trim().slice(0, 40), (input.code ?? "").slice(0, 80), key]);
  return (await db.query<{ id: string }>(`SELECT id FROM stock_items WHERE workspace_id = $1 AND catalog_item_id IS NULL AND normal_key = $2`, [workspaceId, key])).rows[0].id;
}

/** Common ways people write units, mapped to the catalog's codes. */
const UNIT_ALIASES: Record<string, string> = {
  "m²": "sqm", m2: "sqm", "sq m": "sqm", "sq.m": "sqm", "ft²": "sqft", ft2: "sqft", "sq ft": "sqft", "sq.ft": "sqft", "m³": "cum", m3: "cum",
  nos: "pcs", no: "pcs", "no.": "pcs", pc: "pcs", piece: "pcs", pieces: "pcs", ltr: "l", litre: "l", liter: "l", kgs: "kg", rm: "m", "r.m": "m", rmt: "m",
};

/** The catalog's code for a unit as written (its code, its label, or a common way of writing it), or null. */
async function unitCode(db: Db, workspaceId: string, written: string): Promise<{ code: string | null; units: Unit[] }> {
  const custom = (await db.query<Unit>(`SELECT code, label, kind, to_base::text AS "toBase" FROM catalog_units WHERE workspace_id = $1`, [workspaceId])).rows;
  const units = [...STANDARD_UNITS, ...custom.filter((unit) => !STANDARD_UNITS.some((standard) => standard.code === unit.code))];
  const value = written.trim().toLocaleLowerCase();
  const found = [...custom, ...units].find((unit) => unit.code.toLocaleLowerCase() === value || unit.label.toLocaleLowerCase() === value);
  return { code: found?.code ?? UNIT_ALIASES[value] ?? null, units };
}

/**
 * The stock item for goods bought in one unit and kept in the catalog item's unit (bought in boxes,
 * stocked in pieces), with how many stock units one bought unit is. Without a catalog item, or when
 * the units can't be converted, the goods are kept as bought (factor 1).
 */
export async function stockItemInCatalogUnit(db: Db, workspaceId: string, input: { catalogItemId: string | null; name: string; unit: string; code?: string }) {
  if (input.catalogItemId && input.unit.trim()) {
    const catalog = (await db.query<{ unit: string }>(`SELECT unit_code AS unit FROM catalog_items WHERE workspace_id = $1 AND id = $2`, [workspaceId, input.catalogItemId])).rows[0];
    const { code, units } = await unitCode(db, workspaceId, input.unit);
    if (catalog && code && code !== catalog.unit) {
      const conversions = (await db.query<ItemConversion>(`SELECT from_unit AS "from", to_unit AS "to", factor::text AS factor FROM catalog_item_conversions WHERE workspace_id = $1 AND item_id = $2`,
        [workspaceId, input.catalogItemId])).rows;
      try {
        const factor = convert("1", code, catalog.unit, units, conversions);
        // An empty unit means "the catalog item's own unit".
        return { itemId: await stockItemFor(db, workspaceId, { ...input, unit: "" }), factor };
      } catch { /* units that can't be converted keep the goods as bought */ }
    }
    if (catalog && code === catalog.unit) return { itemId: await stockItemFor(db, workspaceId, { ...input, unit: "" }), factor: Dec.of(1) };
  }
  return { itemId: await stockItemFor(db, workspaceId, input), factor: Dec.of(1) };
}

export type Movement = {
  batchId: string; itemId: string; locationId: string; projectId: string | null; kind: MovementKind; quantity: string; forProjectId?: string | null;
  unitCost?: string | null; currency?: string | null; receiptLineId?: string | null; transferId?: string | null; supplierReturnId?: string | null; reason?: string; movedOn: string; actorId: string;
  workOrderId?: string | null; workOrderMaterialId?: string | null;
};

/** Writes one movement; the database keeps the balance and refuses to go below zero. */
export async function move(db: Db, workspaceId: string, movement: Movement) {
  try {
    await db.query(
      `INSERT INTO stock_movements (id, workspace_id, batch_id, item_id, location_id, project_id, kind, quantity, for_project_id, unit_cost, currency, receipt_line_id, transfer_id,
                                   supplier_return_id, reason, moved_on, actor_id, work_order_id, work_order_material_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [randomUUID(), workspaceId, movement.batchId, movement.itemId, movement.locationId, movement.projectId, movement.kind, movement.quantity, movement.forProjectId ?? null,
        movement.unitCost ?? null, movement.unitCost ? movement.currency ?? null : null, movement.receiptLineId ?? null, movement.transferId ?? null, movement.supplierReturnId ?? null,
        movement.reason ?? "", movement.movedOn, movement.actorId, movement.workOrderId ?? null, movement.workOrderMaterialId ?? null]);
  } catch (error) {
    if ((error as { constraint?: string }).constraint === "stock_balances_not_negative") throw new ConflictException("There isn't that much in stock there.");
    throw error;
  }
}

/**
 * An amount in the workspace's currency: as it is, or converted at the latest rate on or before the day
 * (either direction of the pair). Null when there's no rate to use.
 */
export async function inWorkspaceCurrency(db: Db, workspaceId: string, amount: Dec, currency: string, onDay: string) {
  const home = (await db.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency;
  if (!home) return null;
  if (currency === home) return { amount, currency: home };
  const rate = (await db.query<{ rate: string; direct: boolean }>(
    `SELECT rate::text AS rate, base_currency = $2 AS direct FROM exchange_rates
      WHERE workspace_id = $1 AND ((base_currency = $2 AND quote_currency = $3) OR (base_currency = $3 AND quote_currency = $2)) AND rate > 0
        AND effective_at < ($4::date + 1)
      ORDER BY effective_at DESC LIMIT 1`, [workspaceId, currency, home, onDay])).rows[0];
  if (!rate) return null;
  return { amount: rate.direct ? amount.mul(rate.rate) : amount.div(rate.rate), currency: home };
}

/** The average cost of one item, place and owner now (in the workspace's currency), or null when it has none. */
export async function averageCost(db: Db, workspaceId: string, itemId: string, locationId: string, projectId: string | null) {
  const row = (await db.query<{ onHand: string; value: string; currency: string }>(
    `SELECT balance.on_hand::text AS "onHand", balance.value::text AS value, workspace.default_currency AS currency
       FROM stock_balances balance JOIN workspaces workspace ON workspace.id = balance.workspace_id
      WHERE balance.workspace_id = $1 AND balance.item_id = $2 AND balance.location_id = $3 AND balance.project_id IS NOT DISTINCT FROM $4::uuid`,
    [workspaceId, itemId, locationId, projectId])).rows[0];
  if (!row || Dec.of(row.onHand).cmp(0) <= 0) return null;
  return { unitCost: Dec.of(row.value).div(row.onHand).round(4).toFixed(4), currency: row.currency };
}

/** What's on hand for one item, place and owner, locked for the rest of the command. */
export async function onHand(db: Db, workspaceId: string, itemId: string, locationId: string, projectId: string | null) {
  const row = (await db.query<{ onHand: string }>(
    `SELECT on_hand::text AS "onHand" FROM stock_balances WHERE workspace_id = $1 AND item_id = $2 AND location_id = $3 AND project_id IS NOT DISTINCT FROM $4::uuid FOR UPDATE`,
    [workspaceId, itemId, locationId, projectId])).rows[0];
  return Dec.of(row?.onHand ?? "0");
}

export type StockRow = {
  itemId: string; itemName: string; itemCode: string; unit: string; catalogItemId: string | null; locationId: string; locationName: string; locationKind: string;
  projectId: string | null; projectReference: string | null; projectName: string | null; onHand: string; updatedAt: string;
  /** Value at moving average cost, and that average, in the workspace's currency. */
  value: string; averageCost: string | null; currency: string;
};

export async function readStock(db: Db, workspaceId: string, filter: { projectId?: string } = {}): Promise<StockRow[]> {
  const values: unknown[] = [workspaceId];
  const where = ["balance.workspace_id = $1", "balance.on_hand > 0"];
  if (filter.projectId) { values.push(filter.projectId); where.push(`balance.project_id = $${values.length}`); }
  return (await db.query<StockRow>(
    `SELECT item.id AS "itemId", item.name AS "itemName", item.code AS "itemCode", item.unit, item.catalog_item_id AS "catalogItemId",
            location.id AS "locationId", location.name AS "locationName", location.kind AS "locationKind",
            project.id AS "projectId", project.reference AS "projectReference", project.name AS "projectName", balance.on_hand::text AS "onHand", balance.updated_at AS "updatedAt",
            balance.value::text AS value, CASE WHEN balance.on_hand > 0 THEN round(balance.value / balance.on_hand, 4)::text END AS "averageCost", workspace.default_currency AS currency
       FROM stock_balances balance
       JOIN workspaces workspace ON workspace.id = balance.workspace_id
       JOIN stock_items item ON item.workspace_id = balance.workspace_id AND item.id = balance.item_id
       JOIN stock_locations location ON location.workspace_id = balance.workspace_id AND location.id = balance.location_id
       LEFT JOIN delivery_projects project ON project.workspace_id = balance.workspace_id AND project.id = balance.project_id
      WHERE ${where.join(" AND ")}
      ORDER BY item.name, location.name, project.reference NULLS FIRST LIMIT 5000`, values)).rows;
}

export type MovementRow = {
  id: string; batchId: string; kind: MovementKind; quantity: string; itemId: string; itemName: string; unit: string; locationName: string; projectReference: string | null;
  forProjectReference: string | null; reason: string; movedOn: string; byName: string; at: string; receiptNumber: number | null; orderNumber: string | null; transferNumber: number | null;
  returnNumber: number | null;
  /** The work order that made it, for goods made in the factory. */
  workOrderNumber: number | null;
  /** What the movement was worth: its quantity at its cost (in the workspace's currency), when it has one. */
  unitCost: string | null; currency: string | null;
};

export async function readMovements(db: Db, workspaceId: string, filter: { itemId?: string; locationId?: string; projectId?: string; limit?: number } = {}): Promise<MovementRow[]> {
  const values: unknown[] = [workspaceId];
  const where = ["movement.workspace_id = $1"];
  if (filter.itemId) { values.push(filter.itemId); where.push(`movement.item_id = $${values.length}`); }
  if (filter.locationId) { values.push(filter.locationId); where.push(`movement.location_id = $${values.length}`); }
  if (filter.projectId) { values.push(filter.projectId); where.push(`(movement.project_id = $${values.length} OR movement.for_project_id = $${values.length})`); }
  return (await db.query<MovementRow>(
    `SELECT movement.id, movement.batch_id AS "batchId", movement.kind, movement.quantity::text AS quantity, item.id AS "itemId", item.name AS "itemName", item.unit,
            location.name AS "locationName", owner.reference AS "projectReference", booked.reference AS "forProjectReference", movement.reason, movement.moved_on::text AS "movedOn",
            person.display_name AS "byName", movement.created_at AS at, receipt.number AS "receiptNumber", coalesce(purchase.number, returned.number) AS "orderNumber", transfer.number AS "transferNumber",
            back.number AS "returnNumber", made.number AS "workOrderNumber", movement.unit_cost::text AS "unitCost", movement.currency
       FROM stock_movements movement
       JOIN stock_items item ON item.workspace_id = movement.workspace_id AND item.id = movement.item_id
       JOIN stock_locations location ON location.workspace_id = movement.workspace_id AND location.id = movement.location_id
       JOIN users person ON person.id = movement.actor_id
       LEFT JOIN delivery_projects owner ON owner.workspace_id = movement.workspace_id AND owner.id = movement.project_id
       LEFT JOIN delivery_projects booked ON booked.workspace_id = movement.workspace_id AND booked.id = movement.for_project_id
       LEFT JOIN goods_receipt_lines received ON received.workspace_id = movement.workspace_id AND received.id = movement.receipt_line_id
       LEFT JOIN goods_receipts receipt ON receipt.workspace_id = received.workspace_id AND receipt.id = received.receipt_id
       LEFT JOIN purchase_orders purchase ON purchase.workspace_id = receipt.workspace_id AND purchase.id = receipt.order_id
       LEFT JOIN stock_transfers transfer ON transfer.workspace_id = movement.workspace_id AND transfer.id = movement.transfer_id
       LEFT JOIN supplier_returns back ON back.workspace_id = movement.workspace_id AND back.id = movement.supplier_return_id
       LEFT JOIN purchase_orders returned ON returned.workspace_id = back.workspace_id AND returned.id = back.order_id
       LEFT JOIN work_orders made ON made.workspace_id = movement.workspace_id AND made.id = movement.work_order_id
      WHERE ${where.join(" AND ")}
      ORDER BY movement.seq DESC LIMIT ${filter.limit ?? 500}`, values)).rows;
}

export type TransferRow = {
  id: string; number: number; status: "in_transit" | "received" | "cancelled"; fromLocationId: string; fromName: string; toLocationId: string; toName: string; note: string;
  sentOn: string; sentBy: string; sentByName: string; receivedOn: string | null; receivedByName: string | null; cancelReason: string | null; lines: number; short: boolean;
};

const TRANSFER_SELECT = `SELECT transfer.id, transfer.number, transfer.status, transfer.from_location_id AS "fromLocationId", origin.name AS "fromName",
  transfer.to_location_id AS "toLocationId", destination.name AS "toName", transfer.note, transfer.sent_on::text AS "sentOn", transfer.sent_by AS "sentBy",
  sender.display_name AS "sentByName", transfer.received_on::text AS "receivedOn", receiver.display_name AS "receivedByName", transfer.cancel_reason AS "cancelReason",
  (SELECT count(*)::int FROM stock_transfer_lines line WHERE line.workspace_id = transfer.workspace_id AND line.transfer_id = transfer.id) AS lines,
  EXISTS (SELECT 1 FROM stock_transfer_lines line WHERE line.workspace_id = transfer.workspace_id AND line.transfer_id = transfer.id AND line.received < line.quantity) AS short
  FROM stock_transfers transfer
  JOIN stock_locations origin ON origin.workspace_id = transfer.workspace_id AND origin.id = transfer.from_location_id
  JOIN stock_locations destination ON destination.workspace_id = transfer.workspace_id AND destination.id = transfer.to_location_id
  JOIN users sender ON sender.id = transfer.sent_by
  LEFT JOIN users receiver ON receiver.id = transfer.received_by`;

export async function readTransfers(db: Db, workspaceId: string): Promise<TransferRow[]> {
  return (await db.query<TransferRow>(`${TRANSFER_SELECT} WHERE transfer.workspace_id = $1 ORDER BY (transfer.status = 'in_transit') DESC, transfer.number DESC LIMIT 500`, [workspaceId])).rows;
}

export async function readTransfer(db: Db, workspaceId: string, transferId: string) {
  const transfer = (await db.query<TransferRow>(`${TRANSFER_SELECT} WHERE transfer.workspace_id = $1 AND transfer.id = $2`, [workspaceId, transferId])).rows[0];
  if (!transfer) return null;
  const lines = (await db.query<{ id: string; itemId: string; itemName: string; unit: string; projectId: string | null; projectReference: string | null; quantity: string; received: string | null; lossReason: string }>(
    `SELECT line.id, item.id AS "itemId", item.name AS "itemName", item.unit, line.project_id AS "projectId", project.reference AS "projectReference",
            line.quantity::text AS quantity, line.received::text AS received, line.loss_reason AS "lossReason"
       FROM stock_transfer_lines line
       JOIN stock_items item ON item.workspace_id = line.workspace_id AND item.id = line.item_id
       LEFT JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
      WHERE line.workspace_id = $1 AND line.transfer_id = $2 ORDER BY item.name, line.id`, [workspaceId, transferId])).rows;
  return { transfer, lines };
}

/**
 * Puts accepted goods from a delivery into stock at the place they arrived, for the project their order
 * line is for (free stock when none), at the line's price. Work bought as a service isn't stock.
 */
export async function stockFromReceipt(db: Db, workspaceId: string, input: { receiptId: string; lines: Array<{ receiptLineId: string; accepted: string }>; actorId: string }) {
  const receipt = (await db.query<{ locationId: string; receivedOn: string; currency: string }>(
    `SELECT receipt.location_id AS "locationId", receipt.received_on::text AS "receivedOn", purchase.currency
       FROM goods_receipts receipt JOIN purchase_orders purchase ON purchase.workspace_id = receipt.workspace_id AND purchase.id = receipt.order_id
      WHERE receipt.workspace_id = $1 AND receipt.id = $2`, [workspaceId, input.receiptId])).rows[0];
  if (!receipt) return;
  const batchId = randomUUID();
  for (const line of input.lines) {
    if (Dec.of(line.accepted).cmp(0) <= 0) continue;
    const origin = (await db.query<{ projectId: string | null; name: string; unit: string; code: string; catalogItemId: string | null; supply: string | null; quantity: string; net: string }>(
      `SELECT ordered.project_id AS "projectId", coalesce(material.name, scope.title, ordered.description) AS name, ordered.unit, coalesce(material.code, '') AS code,
              coalesce(material.catalog_item_id, scope.catalog_item_id) AS "catalogItemId", package.supply, ordered.quantity::text AS quantity, ordered.net::text AS net
         FROM goods_receipt_lines received
         JOIN purchase_order_lines ordered ON ordered.workspace_id = received.workspace_id AND ordered.id = received.order_line_id
         LEFT JOIN project_material_items material ON material.workspace_id = ordered.workspace_id AND material.id = ordered.material_item_id
         LEFT JOIN project_boq_lines scope ON scope.workspace_id = ordered.workspace_id AND scope.id = ordered.boq_line_id
         LEFT JOIN project_packages package ON package.workspace_id = scope.workspace_id AND package.id = scope.package_id
        WHERE received.workspace_id = $1 AND received.id = $2`, [workspaceId, line.receiptLineId])).rows[0];
    if (!origin || origin.supply === "subcontract" || origin.supply === "site_work") continue;
    // Bought in one unit, kept in the catalog item's (boxes in, pieces kept): the quantity converts and the cost follows.
    const { itemId, factor } = await stockItemInCatalogUnit(db, workspaceId, { catalogItemId: origin.catalogItemId, name: origin.name, unit: origin.unit, code: origin.code });
    // The line's net price per stock unit, in the workspace's currency (at the rate on the day it arrived).
    const cost = Dec.of(origin.quantity).isZero() ? null : await inWorkspaceCurrency(db, workspaceId, Dec.of(origin.net).div(origin.quantity).div(factor), receipt.currency, receipt.receivedOn);
    const unitCost = cost ? cost.amount.round(4).toFixed(4) : null;
    await move(db, workspaceId, { batchId, itemId, locationId: receipt.locationId, projectId: origin.projectId, kind: "receive", quantity: Dec.of(line.accepted).mul(factor).round(4).toString(),
      forProjectId: origin.projectId, unitCost, currency: cost ? cost.currency : null, receiptLineId: line.receiptLineId, movedOn: receipt.receivedOn, actorId: input.actorId });
  }
}
