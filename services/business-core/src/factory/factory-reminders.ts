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
  const stale = await holdStaleDrawings(db, workspaceId);
  return { sent: stale + await chaseMaterials(db, workspaceId, today) };
}

/**
 * A work order whose drawing was picked from the project's designs stops when a newer revision of that
 * design comes in: released or running work goes on hold ("drawing"), so someone decides whether it goes
 * on with the new drawing; the factory lead, the project's manager and the approvers hear, once per revision.
 */
export async function holdStaleDrawings(db: Db, workspaceId: string) {
  const orders = (await db.query<{ id: string; number: number; title: string; status: string; project: string; projectId: string; actor: string; newerId: string; newer: number; reference: string }>(
    `SELECT wo.id, wo.number, wo.title, wo.status, project.reference || ' · ' || project.name AS project, wo.project_id AS "projectId",
            coalesce(wo.drawing_approved_by, wo.created_by) AS actor, newer.id AS "newerId", newer.number AS newer, wo.drawing_ref AS reference
       FROM work_orders wo
       JOIN delivery_projects project ON project.workspace_id = wo.workspace_id AND project.id = wo.project_id
       JOIN pre_project_design_versions picked ON picked.id = wo.drawing_version_id
       JOIN LATERAL (SELECT candidate.id, candidate.number FROM pre_project_design_versions candidate
                      WHERE candidate.workspace_id = wo.workspace_id AND candidate.design_id = wo.drawing_design_id AND candidate.number > picked.number
                        AND candidate.status NOT IN ('draft', 'rejected') ORDER BY candidate.number DESC LIMIT 1) newer ON true
      WHERE wo.workspace_id = $1 AND wo.status IN ('planned', 'released', 'in_production', 'on_hold') AND wo.drawing_stale_version_id IS DISTINCT FROM newer.id`, [workspaceId])).rows;
  let sent = 0;
  for (const order of orders) {
    const reason = `The drawing ${order.reference} has a newer revision (R${order.newer}).`;
    // Planned work isn't going yet: it just can't be released on the old drawing (the flag shows it).
    if (["released", "in_production"].includes(order.status))
      await db.query(`UPDATE work_orders SET status = 'on_hold', hold_kind = 'drawing', hold_reason = $3, held_from = status, version = version + 1, updated_at = now()
        WHERE workspace_id = $1 AND id = $2`, [workspaceId, order.id, reason]);
    await db.query(`UPDATE work_orders SET drawing_stale_version_id = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, order.id, order.newerId]);
    await db.query(`INSERT INTO work_order_events (id, workspace_id, work_order_id, kind, detail, actor_id) VALUES (gen_random_uuid(), $1, $2, 'drawing_stale', $3::jsonb, $4)`,
      [workspaceId, order.id, JSON.stringify({ reference: order.reference, newer: order.newer, held: ["released", "in_production"].includes(order.status) }), order.actor]);
    const people = (await db.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
        WHERE membership.workspace_id = $1 AND membership.status = 'active' AND (
          EXISTS (SELECT 1 FROM project_assignments assignment WHERE assignment.workspace_id = membership.workspace_id AND assignment.membership_id = membership.id
                   AND assignment.project_id = $2 AND assignment.active AND (assignment.is_manager OR assignment.role_keys && ARRAY['factory_lead']::varchar[]))
          OR EXISTS (SELECT 1 FROM effective_member_roles effective_role JOIN role_permissions granted ON granted.role_id = effective_role.role_id
                      JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'factory.approve'
                     WHERE effective_role.membership_id = membership.id))`, [workspaceId, order.projectId])).rows.map((row) => row.userId);
    for (const userId of people) {
      const result = await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "factory.drawing_stale", eventType: "factory.drawing_stale",
        variables: { order: `WO-${String(order.number).padStart(4, "0")}`, item: order.title, project: order.project, actor: "", note: reason },
        deepLink: `/workspace/factory/orders?order=${order.id}`, idempotencyKey: `factory.drawing_stale:${order.id}:${order.newerId}:${userId}` });
      if (result.queued) sent += 1;
    }
  }
  return sent;
}

async function chaseMaterials(db: Db, workspaceId: string, today: string) {
  const orders = (await db.query<{ id: string; number: number; title: string; projectId: string; packageId: string | null; project: string; start: string }>(
    `SELECT wo.id, wo.number, wo.title, wo.project_id AS "projectId", wo.package_id AS "packageId", project.reference || ' · ' || project.name AS project, wo.planned_start::text AS start
       FROM work_orders wo JOIN delivery_projects project ON project.workspace_id = wo.workspace_id AND project.id = wo.project_id
      WHERE wo.workspace_id = $1 AND wo.status IN ('planned', 'released') AND wo.planned_start IS NOT NULL AND wo.planned_start <= $2::date + 7 AND project.status = 'active'`,
    [workspaceId, today])).rows;
  if (!orders.length) return 0;
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
  return sent;
}
