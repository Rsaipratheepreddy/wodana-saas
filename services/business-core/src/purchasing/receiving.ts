import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { readOrderLines } from "./orders";

type Db = Pick<PoolClient, "query">;

export const LOCATION_KINDS = ["warehouse", "factory", "site", "other"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

/** Orders goods can arrive against: sent to the supplier and not yet complete. */
export const RECEIVABLE = ["sent", "confirmed", "partly_received"] as const;

export type StockLocation = {
  id: string; kind: LocationKind; name: string; projectId: string | null; projectReference: string | null; address: string; isDefault: boolean; active: boolean;
};

/** Places stock is kept, the open ones unless asked for all. */
export async function readLocations(db: Db, workspaceId: string, all = false): Promise<StockLocation[]> {
  return (await db.query<StockLocation>(
    `SELECT location.id, location.kind, location.name, location.project_id AS "projectId", project.reference AS "projectReference", location.address, location.is_default AS "isDefault", location.active
       FROM stock_locations location LEFT JOIN delivery_projects project ON project.workspace_id = location.workspace_id AND project.id = location.project_id
      WHERE location.workspace_id = $1 AND (location.active OR $2) ORDER BY array_position(ARRAY['site', 'warehouse', 'factory', 'other'], location.kind::text), location.name`, [workspaceId, all])).rows;
}

/**
 * Where goods can be received for an order: the site of each of its projects, the default warehouse and
 * factory (made the first time they're used), and any other place the firm keeps stock. A key is a
 * location id, or `site:<project>`, `warehouse` or `factory` for one that doesn't exist yet.
 */
export type Place = { key: string; kind: LocationKind; name: string | null; projectReference: string | null };

export async function placesFor(db: Db, workspaceId: string, orderId: string, deliverTo: string) {
  const locations = await readLocations(db, workspaceId);
  const projects = (await db.query<{ id: string; reference: string }>(
    `SELECT DISTINCT project.id, project.reference FROM purchase_order_lines line JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
      WHERE line.workspace_id = $1 AND line.order_id = $2 ORDER BY project.reference`, [workspaceId, orderId])).rows;
  const places: Place[] = projects.map((project) => {
    const site = locations.find((location) => location.kind === "site" && location.projectId === project.id);
    return { key: site?.id ?? `site:${project.id}`, kind: "site", name: site?.name ?? null, projectReference: project.reference };
  });
  for (const kind of ["warehouse", "factory"] as const) {
    const ofKind = locations.filter((location) => location.kind === kind);
    if (!ofKind.length) places.push({ key: kind, kind, name: null, projectReference: null });
    for (const location of ofKind) places.push({ key: location.id, kind, name: location.name, projectReference: null });
  }
  for (const location of locations.filter((item) => item.kind === "other")) places.push({ key: location.id, kind: "other", name: location.name, projectReference: null });
  const preferred = deliverTo === "site" && projects.length === 1 ? places[0]
    : places.find((place) => place.kind === (deliverTo === "factory" ? "factory" : "warehouse") && (place.name === null || locations.some((item) => item.id === place.key && item.isDefault)))
      ?? places.find((place) => place.kind === (deliverTo === "factory" ? "factory" : "warehouse"));
  return { places, defaultPlace: preferred?.key ?? places[0]?.key ?? null };
}

/** Turns a place key into a location, creating a project's site or the default warehouse or factory the first time. */
export async function resolvePlace(db: Db, workspaceId: string, key: string, projectIds: string[], newId: () => string): Promise<StockLocation | null> {
  const siteMatch = /^site:([0-9a-f-]{36})$/i.exec(key);
  if (siteMatch) {
    const projectId = siteMatch[1];
    if (!projectIds.includes(projectId)) return null;
    await db.query(
      `INSERT INTO stock_locations (id, workspace_id, kind, name, project_id)
       SELECT $3, $1, 'site', project.reference || ' · ' || project.name, project.id FROM delivery_projects project WHERE project.workspace_id = $1 AND project.id = $2
       ON CONFLICT (workspace_id, project_id) WHERE kind = 'site' DO NOTHING`, [workspaceId, projectId, newId()]);
    return (await readLocations(db, workspaceId)).find((location) => location.kind === "site" && location.projectId === projectId) ?? null;
  }
  if (key === "warehouse" || key === "factory") {
    const existing = (await readLocations(db, workspaceId)).filter((location) => location.kind === key);
    if (existing.length) return existing.find((location) => location.isDefault) ?? existing[0];
    await db.query(`INSERT INTO stock_locations (id, workspace_id, kind, name, is_default) VALUES ($3, $1, $2::varchar, initcap($2::varchar), true) ON CONFLICT DO NOTHING`, [workspaceId, key, newId()]);
    return (await readLocations(db, workspaceId)).find((location) => location.kind === key) ?? null;
  }
  const location = (await readLocations(db, workspaceId)).find((item) => item.id === key) ?? null;
  // A site belongs to its project: goods for another project's order don't go there.
  if (location?.kind === "site" && !projectIds.includes(location.projectId!)) return null;
  return location;
}

export type Receipt = {
  id: string; number: number; orderId: string; orderNumber: string; supplierName: string; locationId: string; locationName: string; locationKind: LocationKind;
  receivedOn: string; receivedBy: string; receivedByName: string; deliveryNote: string; notes: string; inspectedByName: string | null; inspectedAt: string | null;
  received: string; accepted: string; rejected: string; pending: string; createdAt: string;
  /** Short against the supplier's delivery note. */
  missing: string;
  reversedAt: string | null; reversedByName: string | null; reverseReason: string | null;
};

export const REJECT_KINDS = ["damaged", "defective", "wrong_item", "wrong_spec", "other"] as const;
export type RejectKind = (typeof REJECT_KINDS)[number];

const RECEIPT_SELECT = `SELECT receipt.id, receipt.number, receipt.order_id AS "orderId", purchase.number AS "orderNumber", vendor.display_name AS "supplierName",
  receipt.location_id AS "locationId", location.name AS "locationName", location.kind AS "locationKind", receipt.received_on::text AS "receivedOn",
  receipt.received_by AS "receivedBy", receiver.display_name AS "receivedByName", receipt.delivery_note AS "deliveryNote", receipt.notes,
  inspector.display_name AS "inspectedByName", receipt.inspected_at AS "inspectedAt", receipt.created_at AS "createdAt",
  totals.received::text AS received, totals.accepted::text AS accepted, totals.rejected::text AS rejected, totals.pending::text AS pending, totals.missing::text AS missing,
  receipt.reversed_at AS "reversedAt", reverser.display_name AS "reversedByName", receipt.reverse_reason AS "reverseReason"
  FROM goods_receipts receipt
  JOIN purchase_orders purchase ON purchase.workspace_id = receipt.workspace_id AND purchase.id = receipt.order_id
  JOIN workspace_vendors vendor ON vendor.workspace_id = purchase.workspace_id AND vendor.id = purchase.vendor_id
  JOIN stock_locations location ON location.workspace_id = receipt.workspace_id AND location.id = receipt.location_id
  JOIN users receiver ON receiver.id = receipt.received_by
  LEFT JOIN users inspector ON inspector.id = receipt.inspected_by
  LEFT JOIN users reverser ON reverser.id = receipt.reversed_by
  JOIN LATERAL (SELECT sum(received) AS received, sum(accepted) AS accepted, sum(rejected) AS rejected, sum(pending) AS pending,
                       sum(greatest(coalesce(noted, received) - received, 0)) AS missing
                  FROM goods_receipt_lines WHERE workspace_id = receipt.workspace_id AND receipt_id = receipt.id) totals ON true`;

export async function readReceipts(db: Db, workspaceId: string, filter: { orderId?: string; pending?: boolean; limit?: number } = {}): Promise<Receipt[]> {
  const where = ["receipt.workspace_id = $1"];
  const values: unknown[] = [workspaceId];
  if (filter.orderId) { values.push(filter.orderId); where.push(`receipt.order_id = $${values.length}`); }
  // Waiting for inspection means a live receipt with something still pending; a reversed one never waits.
  if (filter.pending !== undefined) where.push(filter.pending ? "totals.pending > 0 AND receipt.reversed_at IS NULL" : "(totals.pending = 0 OR receipt.reversed_at IS NOT NULL)");
  return (await db.query<Receipt>(`${RECEIPT_SELECT} WHERE ${where.join(" AND ")} ORDER BY receipt.received_on DESC, receipt.number DESC LIMIT ${filter.limit ?? 200}`, values)).rows;
}

export async function readReceipt(db: Db, workspaceId: string, receiptId: string) {
  return (await db.query<Receipt>(`${RECEIPT_SELECT} WHERE receipt.workspace_id = $1 AND receipt.id = $2`, [workspaceId, receiptId])).rows[0];
}

export type ReceiptLine = {
  id: string; orderLineId: string; description: string; specification: string; unit: string; projectReference: string | null; boqLineId: string | null; projectId: string | null;
  received: string; accepted: string; rejected: string; pending: string; rejectReason: string; rejectKind: RejectKind | null; noted: string | null;
  inspectedByName: string | null;
  /** Already going back to the supplier (not cancelled), from what was rejected and from what was accepted. */
  returnedRejected: string; returnedAccepted: string;
};

export async function readReceiptLines(db: Db, workspaceId: string, receiptId: string): Promise<ReceiptLine[]> {
  return (await db.query<ReceiptLine>(
    `SELECT received.id, received.order_line_id AS "orderLineId", line.description, line.specification, line.unit, project.reference AS "projectReference",
            line.boq_line_id AS "boqLineId", line.project_id AS "projectId", received.received::text AS received, received.accepted::text AS accepted,
            received.rejected::text AS rejected, received.pending::text AS pending, received.reject_reason AS "rejectReason", received.reject_kind AS "rejectKind",
            received.noted::text AS noted, inspector.display_name AS "inspectedByName",
            coalesce(back.rejected, 0)::numeric(18, 4)::text AS "returnedRejected", coalesce(back.accepted, 0)::numeric(18, 4)::text AS "returnedAccepted"
       FROM goods_receipt_lines received
       LEFT JOIN users inspector ON inspector.id = received.inspected_by
       LEFT JOIN LATERAL (SELECT sum(item.quantity) FILTER (WHERE item.source = 'rejected') AS rejected, sum(item.quantity) FILTER (WHERE item.source = 'accepted') AS accepted
                            FROM supplier_return_lines item JOIN supplier_returns sent ON sent.workspace_id = item.workspace_id AND sent.id = item.return_id
                           WHERE item.workspace_id = received.workspace_id AND item.receipt_line_id = received.id AND sent.status <> 'cancelled') back ON true
       JOIN purchase_order_lines line ON line.workspace_id = received.workspace_id AND line.id = received.order_line_id
       LEFT JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
      WHERE received.workspace_id = $1 AND received.receipt_id = $2 ORDER BY line.position, line.id`, [workspaceId, receiptId])).rows;
}

type Owed = { quantity: string; accepted: string; pending: string; credited?: string; cancelled?: string };

/**
 * Still to come on a line: ordered less what was cancelled, credited, accepted or is waiting for inspection.
 * Rejected goods, and goods returned to be replaced, are still owed.
 */
export function outstanding(line: Owed) {
  const left = Dec.of(line.quantity).sub(line.cancelled ?? "0").sub(line.credited ?? "0").sub(line.accepted).sub(line.pending);
  return left.cmp(0) > 0 ? left : Dec.of(0);
}

/** The most that can arrive now on a line: what's still to come plus the allowed over-delivery on the whole line. */
export function receivable(line: Owed, tolerancePercent: string) {
  // The allowance applies to what's still ordered, after any part of the line was cancelled.
  const ceiling = Dec.of(line.quantity).sub(line.cancelled ?? "0").mul(Dec.of(100).add(tolerancePercent)).div(100);
  const left = ceiling.sub(line.credited ?? "0").sub(line.accepted).sub(line.pending).floor(4);
  return left.cmp(0) > 0 ? left : Dec.of(0);
}

/** An order's status from what has arrived: received once every line's quantity is accepted or waiting for inspection. */
export function receivedStatus(lines: Owed[], arrivedAny: boolean) {
  if (lines.length && lines.every((line) => outstanding(line).isZero())) return "received" as const;
  return arrivedAny ? ("partly_received" as const) : null;
}

/**
 * Moves an open order to partly received or received from what has arrived on its lines; when nothing
 * counts any more (a receipt reversed), it goes back to confirmed or sent. Closed and cancelled orders stay.
 */
export async function settleOrder(db: Db, workspaceId: string, orderId: string) {
  const order = (await db.query<{ status: string; confirmed: boolean }>(
    `SELECT status, confirmed_at IS NOT NULL AS confirmed FROM purchase_orders WHERE workspace_id = $1 AND id = $2`, [workspaceId, orderId])).rows[0];
  if (!order || !["sent", "confirmed", "partly_received", "received"].includes(order.status)) return;
  const arrived = Boolean((await db.query(`SELECT 1 FROM goods_receipts WHERE workspace_id = $1 AND order_id = $2 AND reversed_at IS NULL LIMIT 1`, [workspaceId, orderId])).rowCount);
  const next = receivedStatus(await readOrderLines(db, workspaceId, orderId), arrived) ?? (order.confirmed ? "confirmed" : "sent");
  if (next !== order.status)
    await db.query(`UPDATE purchase_orders SET status = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, orderId, next]);
}
