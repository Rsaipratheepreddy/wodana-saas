import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { LINE_RECEIVED } from "../purchasing/orders";

type Db = Pick<PoolClient, "query">;

/**
 * A reorder point: free stock of an item at one place (or at every place together) at or below it is low.
 * Free stock is what isn't a project's (reserved stock already belongs to its project). What's on open
 * restock orders for the item counts as coming.
 */
export type ReorderPoint = {
  id: string; itemId: string; itemName: string; itemCode: string; unit: string; locationId: string | null; locationName: string | null;
  reorderAt: string; reorderQuantity: string | null; vendorId: string | null; vendorName: string | null;
  /** Free stock now, and still to come on placed restock orders. */
  free: string; onOrder: string;
  /** At or below the point; short when even what's coming doesn't lift it above. */
  low: boolean; short: boolean; lowSince: string | null; version: number;
};

export async function readReorderPoints(db: Db, workspaceId: string, itemIds: string[] | null = null): Promise<ReorderPoint[]> {
  const rows = (await db.query<Omit<ReorderPoint, "low" | "short">>(
    `SELECT point.id, point.item_id AS "itemId", item.name AS "itemName", item.code AS "itemCode", item.unit, point.location_id AS "locationId", location.name AS "locationName",
            point.reorder_at::text AS "reorderAt", point.reorder_quantity::text AS "reorderQuantity", point.vendor_id AS "vendorId", vendor.display_name AS "vendorName",
            coalesce((SELECT sum(balance.on_hand) FROM stock_balances balance
                       WHERE balance.workspace_id = point.workspace_id AND balance.item_id = point.item_id AND balance.project_id IS NULL
                         AND (point.location_id IS NULL OR balance.location_id = point.location_id)), 0)::numeric(18, 4)::text AS free,
            coalesce((SELECT sum(greatest(line.quantity - line.cancelled_quantity - coalesce(back.credited, 0) - (coalesce(received.accepted, 0) - coalesce(back."returnedAccepted", 0))
                                          - coalesce(received.pending, 0), 0))
                        FROM purchase_order_lines line JOIN purchase_orders purchase ON purchase.workspace_id = line.workspace_id AND purchase.id = line.order_id
                        ${LINE_RECEIVED}
                       WHERE line.workspace_id = point.workspace_id AND line.stock_item_id = point.item_id
                         AND purchase.status IN ('approved', 'sent', 'confirmed', 'partly_received')), 0)::numeric(18, 4)::text AS "onOrder",
            point.low_since AS "lowSince", point.version
       FROM stock_reorder_points point
       JOIN stock_items item ON item.workspace_id = point.workspace_id AND item.id = point.item_id
       LEFT JOIN stock_locations location ON location.workspace_id = point.workspace_id AND location.id = point.location_id
       LEFT JOIN workspace_vendors vendor ON vendor.workspace_id = point.workspace_id AND vendor.id = point.vendor_id
      WHERE point.workspace_id = $1 AND ($2::uuid[] IS NULL OR point.item_id = ANY($2::uuid[]))
      ORDER BY item.name, location.name NULLS FIRST`, [workspaceId, itemIds])).rows;
  return rows.map((row) => ({ ...row, ...stockLevel(row.free, row.onOrder, row.reorderAt) }));
}

/** Low at or below the point; short when what's coming doesn't lift it above either. */
export function stockLevel(free: string, onOrder: string, reorderAt: string) {
  return { low: Dec.of(free).cmp(reorderAt) <= 0, short: Dec.of(free).add(onOrder).cmp(reorderAt) <= 0 };
}

/**
 * Tells the people who keep and buy stock when an item goes short (low, with nothing coming to lift it),
 * once each time it goes short — in the app and by email — and forgets it once it's back above. Runs in the
 * daily purchasing run and right after a change that takes free stock out (only those items).
 */
export async function processStockLevels(db: Db, workspaceId: string, itemIds: string[] | null = null) {
  const points = await readReorderPoints(db, workspaceId, itemIds);
  if (!points.length) return 0;
  let sent = 0;
  let people: string[] | null = null;
  for (const point of points) {
    if (!point.short) {
      if (point.lowSince) await db.query(`UPDATE stock_reorder_points SET low_since = NULL WHERE workspace_id = $1 AND id = $2`, [workspaceId, point.id]);
      continue;
    }
    if (point.lowSince) continue;
    const since = (await db.query<{ since: string }>(`UPDATE stock_reorder_points SET low_since = now(), alerted_at = now() WHERE workspace_id = $1 AND id = $2 RETURNING low_since::text AS since`,
      [workspaceId, point.id])).rows[0].since;
    people ??= (await db.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
         JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
         JOIN role_permissions granted ON granted.role_id = effective_role.role_id
         JOIN permissions permission ON permission.id = granted.permission_id AND permission.code IN ('stock.manage', 'purchasing.manage')
        WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows.map((row) => row.userId);
    const unit = (value: string) => `${Dec.of(value).toString()} ${point.unit}`.trim();
    const place = point.locationName ?? "all places";
    const note = `${unit(point.free)} free at ${place}, reorder at ${unit(point.reorderAt)}${point.reorderQuantity ? `; order ${unit(point.reorderQuantity)}` : ""}${point.vendorName ? ` from ${point.vendorName}` : ""}.`;
    for (const userId of people) {
      const message = { workspaceId, recipientUserId: userId, code: "stock.low", eventType: "stock.low", variables: { item: point.itemName, place, note },
        deepLink: `/workspace/inventory?view=low&item=${point.itemId}` };
      const key = `stock.low:${point.id}:${since}:${userId}`.slice(0, 200);
      const result = await notifyUserInApp(db, { ...message, idempotencyKey: key });
      await queueUserEmail(db, { ...message, idempotencyKey: `${key}:email` });
      if (result.queued) sent += 1;
    }
  }
  return sent;
}
