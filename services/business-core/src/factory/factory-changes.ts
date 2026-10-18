import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp } from "../notifications/default-templates";
import { plain, readWorkOrders } from "./factory";

type Db = Pick<PoolClient, "query">;

/**
 * After a variation: the project's open work orders whose scope line was removed, or now holds less than
 * its work orders — the factory managers hear once per variation. Those work orders stop until they're
 * brought back within the line.
 */
export async function tellScopeChanges(db: Db, workspaceId: string, projectId: string, actorId: string, key: string) {
  const affected = (await readWorkOrders(db, workspaceId)).filter((order) => order.projectId === projectId && ["planned", "released", "in_production", "on_hold"].includes(order.status)
    && (order.lineStatus === "omitted" || Dec.of(order.scopeOver).cmp(0) > 0));
  if (!affected.length) return 0;
  const managers = (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = effective_role.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'factory.manage'
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows.map((row) => row.userId).filter((id) => id !== actorId);
  const actor = (await db.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [actorId])).rows[0]?.name ?? "";
  let sent = 0;
  for (const lineId of new Set(affected.map((order) => order.boqLineId))) {
    const orders = affected.filter((order) => order.boqLineId === lineId).sort((a, b) => a.number - b.number);
    const first = orders[0];
    const numbers = orders.map((order) => `WO-${String(order.number).padStart(4, "0")}`).join(", ");
    const note = first.lineStatus === "omitted" ? `removed from the scope; ${numbers} can't go on.` : `${plain(first.scopeOver)} ${first.unit} more on ${numbers} than the line now needs.`.replace("  ", " ");
    for (const userId of managers) {
      const result = await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "factory.scope_changed", eventType: "factory.scope_changed",
        variables: { order: numbers, item: first.title, project: `${first.projectReference} · ${first.projectName}`, actor, note },
        deepLink: `/workspace/factory/orders?order=${first.id}`, idempotencyKey: `factory.scope_changed:${key}:${lineId}:${userId}` });
      if (result.queued) sent += 1;
    }
  }
  return sent;
}
