import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp } from "../notifications/default-templates";

type Db = Pick<PoolClient, "query">;

/**
 * A variation that reduces or removes scope lines can leave orders for more than the scope now needs. The
 * people who buy hear which lines are over-ordered and on which orders, once per variation, so they can
 * cancel the rest with the supplier or keep it as stock. Orders are read, never changed here.
 */
export async function tellBuyersOverOrdered(db: Db, workspaceId: string, project: { id: string; reference: string; name: string }, seal: { id: string; label: string }, actorUserId: string) {
  const lines = (await db.query<{ id: string; title: string; unit: string; quantity: string; status: string; ordered: string; orders: string[]; orderIds: string[] }>(
    `SELECT line.id, line.title, line.unit, line.quantity::text AS quantity, line.status,
            coalesce(sum(ordered.quantity - ordered.cancelled_quantity), 0)::text AS ordered,
            array_remove(array_agg(DISTINCT purchase.number), NULL) AS orders, array_remove(array_agg(DISTINCT purchase.id::text), NULL) AS "orderIds"
       FROM project_boq_lines line
       JOIN project_boq_events changed ON changed.workspace_id = line.workspace_id AND changed.line_id = line.id AND changed.seal_id = $3 AND changed.kind IN ('reduced', 'omitted')
       JOIN purchase_order_lines ordered ON ordered.workspace_id = line.workspace_id AND ordered.boq_line_id = line.id
       JOIN purchase_orders purchase ON purchase.workspace_id = ordered.workspace_id AND purchase.id = ordered.order_id
        AND purchase.status IN ('approved', 'sent', 'confirmed', 'partly_received', 'received')
      WHERE line.workspace_id = $1 AND line.project_id = $2
      GROUP BY line.id, line.title, line.unit, line.quantity, line.status`, [workspaceId, project.id, seal.id])).rows;
  const over = lines.filter((line) => Dec.of(line.ordered).cmp(line.status === "omitted" ? "0" : line.quantity) > 0);
  if (!over.length) return 0;
  const note = over.map((line) => `${line.title}: ${Dec.of(line.ordered).toString()} ${line.unit} ordered (${line.orders.join(", ")}), ${line.status === "omitted" ? "0" : Dec.of(line.quantity).toString()} now needed`)
    .join("; ").slice(0, 480);
  const buyers = (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = effective_role.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'purchasing.manage'
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows.map((row) => row.userId).filter((id) => id !== actorUserId);
  const orderIds = [...new Set(over.flatMap((line) => line.orderIds))];
  let sent = 0;
  for (const userId of buyers) {
    const result = await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "project.over_ordered", eventType: "project.over_ordered",
      variables: { title: `${project.reference} · ${project.name}`, clientName: "", actor: seal.label, note },
      deepLink: orderIds.length === 1 ? `/workspace/purchasing/orders?order=${orderIds[0]}` : `/workspace/purchasing/orders?project=${project.id}`,
      idempotencyKey: `project.over_ordered:${seal.id}:${userId}` });
    if (result.queued) sent += 1;
  }
  return sent;
}
