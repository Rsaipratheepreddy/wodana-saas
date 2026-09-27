import type { PoolClient } from "pg";
import { notifyUserInApp } from "../notifications/default-templates";
import { needsNotIn, readNeeds } from "../purchasing/orders";
import { materialsShort, plain, readWorkOrderMaterials } from "./factory";

type Db = Pick<PoolClient, "query">;

/**
 * The daily look ahead, in one workspace's tenant transaction: a work order that should start within a
 * week (or already should have) and still waits for materials tells the people who buy — its own
 * materials when it lists them, else its package's — once, then every week while it waits.
 */
export async function processFactoryDeadlines(db: Db, workspaceId: string) {
  const today = (await db.query<{ today: string }>(
    `SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.today;
  if (!today) return { sent: 0 };
  const orders = (await db.query<{ id: string; number: number; title: string; projectId: string; packageId: string | null; project: string; start: string }>(
    `SELECT wo.id, wo.number, wo.title, wo.project_id AS "projectId", wo.package_id AS "packageId", project.reference || ' · ' || project.name AS project, wo.planned_start::text AS start
       FROM work_orders wo JOIN delivery_projects project ON project.workspace_id = wo.workspace_id AND project.id = wo.project_id
      WHERE wo.workspace_id = $1 AND wo.status IN ('planned', 'released') AND wo.planned_start IS NOT NULL AND wo.planned_start <= $2::date + 7 AND project.status = 'active'`,
    [workspaceId, today])).rows;
  if (!orders.length) return { sent: 0 };
  const buyers = (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = effective_role.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'purchasing.manage'
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows.map((row) => row.userId);
  let sent = 0;
  for (const order of orders) {
    const materials = (await readWorkOrderMaterials(db, workspaceId, order.id)).filter((row) => row.status === "active");
    const short = materials.length ? (await materialsShort(db, workspaceId, order.id, materials)).map((row) => `${row.itemName} ${plain(row.short)} ${row.unit}`.trim())
      : needsNotIn(await readNeeds(db, workspaceId, false, order.projectId), order.packageId).map((need) => need.title);
    if (!short.length) continue;
    const week = Math.max(0, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${order.start}T00:00:00Z`) + 7 * 86_400_000) / (7 * 86_400_000)));
    const note = `${short.slice(0, 5).join(", ")}${short.length > 5 ? ` and ${short.length - 5} more` : ""}.`;
    const variables = { order: `WO-${String(order.number).padStart(4, "0")}`, item: order.title, project: order.project, actor: "", note };
    for (const userId of buyers) {
      const result = await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "factory.material_short", eventType: "factory.material_short", variables,
        deepLink: `/workspace/factory/orders?order=${order.id}`, idempotencyKey: `factory.material_short:${order.id}:${order.start}:${week}:${userId}` });
      if (result.queued) sent += 1;
    }
  }
  return { sent };
}
