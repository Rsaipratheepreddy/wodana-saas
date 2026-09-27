import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { averageCost, move } from "../inventory/stock";
import { orderEvent, readOrderLines } from "../purchasing/orders";
import { outstanding } from "../purchasing/receiving";
import { workEvent } from "./project-work";

type Db = Pick<PoolClient, "query">;
type Draft = { id: string; number: string; kind: "order" | "request" };

/**
 * What stands between a project and closing it. The first five must be settled by a person before it
 * completes or is cancelled; open work and unsent orders must be settled before it completes, and are
 * cancelled with it; its stock kept elsewhere becomes free stock either way.
 */
export type CloseOut = {
  /** Sent orders the supplier still owes this project goods on: cancel the rest with the supplier, or receive it. */
  owedOrders: Array<{ id: string; number: string; supplierName: string; lines: number }>;
  /** Orders and price requests not sent yet that also carry other projects' lines: take this project's lines off. */
  sharedDrafts: Draft[];
  /** Deliveries whose goods for this project wait for inspection. */
  inspections: Array<{ id: string; number: number; orderNumber: string }>;
  /** Moves on the way carrying this project's stock, or to or from its site. */
  moves: Array<{ id: string; number: number }>;
  /** Anything still at the project's site. */
  siteStock: Array<{ itemName: string; unit: string; quantity: string; locationName: string }>;
  /** Work not finished or cancelled. */
  openWork: number;
  /** Orders and price requests for this project only that were never sent. */
  drafts: Draft[];
  /** The project's stock kept elsewhere. */
  heldStock: Array<{ itemId: string; itemName: string; unit: string; quantity: string; locationId: string; locationName: string }>;
};

export async function readCloseOut(db: Db, workspaceId: string, projectId: string): Promise<CloseOut> {
  const orders = (await db.query<{ id: string; number: string; status: string; supplierName: string; shared: boolean }>(
    `SELECT purchase.id, purchase.number, purchase.status, vendor.display_name AS "supplierName",
            EXISTS (SELECT 1 FROM purchase_order_lines other WHERE other.workspace_id = purchase.workspace_id AND other.order_id = purchase.id
                       AND other.project_id IS DISTINCT FROM $2::uuid) AS shared
       FROM purchase_orders purchase JOIN workspace_vendors vendor ON vendor.workspace_id = purchase.workspace_id AND vendor.id = purchase.vendor_id
      WHERE purchase.workspace_id = $1 AND purchase.status NOT IN ('closed', 'cancelled', 'received')
        AND EXISTS (SELECT 1 FROM purchase_order_lines line WHERE line.workspace_id = purchase.workspace_id AND line.order_id = purchase.id AND line.project_id = $2)
      ORDER BY purchase.number`, [workspaceId, projectId])).rows;
  const owedOrders: CloseOut["owedOrders"] = [];
  for (const order of orders.filter((row) => ["sent", "confirmed", "partly_received"].includes(row.status))) {
    const lines = (await readOrderLines(db, workspaceId, order.id)).filter((line) => line.projectId === projectId && !outstanding(line).isZero()).length;
    if (lines) owedOrders.push({ id: order.id, number: order.number, supplierName: order.supplierName, lines });
  }
  const unsent = orders.filter((row) => ["draft", "pending_approval", "approved"].includes(row.status));
  const requests = (await db.query<{ id: string; number: number; shared: boolean }>(
    `SELECT request.id, request.number,
            EXISTS (SELECT 1 FROM price_request_lines other WHERE other.workspace_id = request.workspace_id AND other.request_id = request.id
                       AND other.project_id IS DISTINCT FROM $2::uuid) AS shared
       FROM price_requests request
      WHERE request.workspace_id = $1 AND request.status = 'open'
        AND EXISTS (SELECT 1 FROM price_request_lines line WHERE line.workspace_id = request.workspace_id AND line.request_id = request.id AND line.project_id = $2)
      ORDER BY request.number`, [workspaceId, projectId])).rows;
  const drafts = (shared: boolean): Draft[] => [
    ...unsent.filter((row) => row.shared === shared).map((row) => ({ id: row.id, number: row.number, kind: "order" as const })),
    ...requests.filter((row) => row.shared === shared).map((row) => ({ id: row.id, number: String(row.number), kind: "request" as const })),
  ];
  const inspections = (await db.query<{ id: string; number: number; orderNumber: string }>(
    `SELECT DISTINCT receipt.id, receipt.number, purchase.number AS "orderNumber"
       FROM goods_receipt_lines got
       JOIN goods_receipts receipt ON receipt.workspace_id = got.workspace_id AND receipt.id = got.receipt_id
       JOIN purchase_order_lines line ON line.workspace_id = got.workspace_id AND line.id = got.order_line_id
       JOIN purchase_orders purchase ON purchase.workspace_id = receipt.workspace_id AND purchase.id = receipt.order_id
      WHERE got.workspace_id = $1 AND line.project_id = $2 AND got.pending > 0 AND receipt.reversed_at IS NULL
      ORDER BY receipt.number`, [workspaceId, projectId])).rows;
  const moves = (await db.query<{ id: string; number: number }>(
    `SELECT transfer.id, transfer.number FROM stock_transfers transfer
      WHERE transfer.workspace_id = $1 AND transfer.status = 'in_transit'
        AND (EXISTS (SELECT 1 FROM stock_transfer_lines line WHERE line.workspace_id = transfer.workspace_id AND line.transfer_id = transfer.id AND line.project_id = $2)
             OR EXISTS (SELECT 1 FROM stock_locations place WHERE place.workspace_id = transfer.workspace_id AND place.project_id = $2
                           AND place.id IN (transfer.from_location_id, transfer.to_location_id)))
      ORDER BY transfer.number`, [workspaceId, projectId])).rows;
  const stock = (await db.query<{ itemId: string; itemName: string; unit: string; quantity: string; locationId: string; locationName: string; atSite: boolean }>(
    `SELECT balance.item_id AS "itemId", item.name AS "itemName", item.unit, balance.on_hand::text AS quantity, place.id AS "locationId", place.name AS "locationName",
            place.project_id IS NOT DISTINCT FROM $2::uuid AS "atSite"
       FROM stock_balances balance
       JOIN stock_items item ON item.workspace_id = balance.workspace_id AND item.id = balance.item_id
       JOIN stock_locations place ON place.workspace_id = balance.workspace_id AND place.id = balance.location_id
      WHERE balance.workspace_id = $1 AND balance.on_hand > 0 AND (balance.project_id = $2 OR place.project_id = $2)
      ORDER BY item.name, place.name`, [workspaceId, projectId])).rows;
  const openWork = (await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM work_items WHERE workspace_id = $1 AND project_id = $2 AND status NOT IN ('done', 'cancelled')`, [workspaceId, projectId])).rows[0].count;
  return {
    owedOrders, sharedDrafts: drafts(true), inspections, moves,
    siteStock: stock.filter((row) => row.atSite).map(({ itemName, unit, quantity, locationName }) => ({ itemName, unit, quantity, locationName })),
    openWork, drafts: drafts(false),
    heldStock: stock.filter((row) => !row.atSite).map(({ atSite: _atSite, ...row }) => row),
  };
}

/** What a person must settle first, in words, for the refusal message. Empty when nothing stands in the way. */
export function closeOutBlockers(closeOut: CloseOut, completing: boolean) {
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  return [
    ...closeOut.owedOrders.map((order) => `${order.number} is still owed goods`),
    ...closeOut.sharedDrafts.map((draft) => `${draft.kind === "order" ? draft.number : `Price request ${draft.number}`} also has other projects' lines`),
    ...closeOut.inspections.map((receipt) => `delivery ${receipt.number} (${receipt.orderNumber}) waits for inspection`),
    ...closeOut.moves.map((transfer) => `move ${transfer.number} is on its way`),
    ...(closeOut.siteStock.length ? [`${plural(closeOut.siteStock.length, "item is", "items are")} still at the site`] : []),
    ...(completing && closeOut.openWork ? [`${plural(closeOut.openWork, "piece of work is", "pieces of work are")} open`] : []),
    ...(completing ? closeOut.drafts.map((draft) => `${draft.kind === "order" ? draft.number : `Price request ${draft.number}`} was never sent`) : []),
  ];
}

/**
 * Settles what closing does by itself: unsent orders and price requests are cancelled (only when the
 * project is cancelled; completing refuses them), open work is cancelled, the running sprint closes,
 * the project's stock kept elsewhere becomes free stock at the cost it has, and its site stops being a
 * place stock is kept.
 */
export async function settleCloseOut(db: Db, input: { workspaceId: string; projectId: string; reference: string; closeOut: CloseOut; why: string; actorId: string; today: string }) {
  const { workspaceId, projectId, closeOut, actorId } = input;
  const reason = input.why.slice(0, 500);
  for (const draft of closeOut.drafts) {
    if (draft.kind === "order") {
      await db.query(`UPDATE purchase_orders SET status = 'cancelled', cancelled_at = now(), cancel_reason = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, draft.id, reason]);
      await orderEvent(db, workspaceId, draft.id, "cancelled", { reason, project: input.reference }, actorId);
    } else {
      await db.query(`UPDATE price_requests SET status = 'cancelled', cancel_reason = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, draft.id, reason]);
    }
  }
  const open = (await db.query<{ id: string; status: string }>(
    `UPDATE work_items item SET status = 'cancelled', version = item.version + 1, updated_at = now()
       FROM work_items before WHERE before.workspace_id = item.workspace_id AND before.id = item.id
        AND item.workspace_id = $1 AND item.project_id = $2 AND item.status NOT IN ('done', 'cancelled')
     RETURNING item.id, before.status`, [workspaceId, projectId])).rows;
  for (const item of open) await workEvent(db, workspaceId, item.id, "status", { from: item.status, to: "cancelled", because: reason }, actorId);
  const sprint = (await db.query<{ id: string }>(`SELECT id FROM work_sprints WHERE workspace_id = $1 AND project_id = $2 AND status = 'active'`, [workspaceId, projectId])).rows[0];
  if (sprint) {
    await db.query(
      `UPDATE work_sprint_commitments commitment SET outcome = CASE WHEN item.status = 'done' THEN 'done' ELSE 'removed' END, decided_at = now()
         FROM work_items item WHERE item.workspace_id = commitment.workspace_id AND item.id = commitment.item_id
          AND commitment.workspace_id = $1 AND commitment.sprint_id = $2 AND commitment.outcome = 'open'`, [workspaceId, sprint.id]);
    await db.query(`UPDATE work_sprints SET status = 'closed', closed_at = now(), closed_by = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, sprint.id, actorId]);
  }
  const batchId = randomUUID();
  for (const held of closeOut.heldStock) {
    const cost = await averageCost(db, workspaceId, held.itemId, held.locationId, projectId);
    const base = { batchId, itemId: held.itemId, locationId: held.locationId, kind: "release" as const, forProjectId: projectId, reason, movedOn: input.today, actorId,
      unitCost: cost?.unitCost, currency: cost?.currency };
    await move(db, workspaceId, { ...base, projectId, quantity: `-${held.quantity}` });
    await move(db, workspaceId, { ...base, projectId: null, quantity: held.quantity });
  }
  await db.query(`UPDATE stock_locations SET active = false WHERE workspace_id = $1 AND project_id = $2 AND active`, [workspaceId, projectId]);
  return { cancelledDrafts: closeOut.drafts.length, cancelledWork: open.length, sprintClosed: Boolean(sprint), releasedStock: closeOut.heldStock.length };
}
