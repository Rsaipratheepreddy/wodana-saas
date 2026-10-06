import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp } from "../notifications/default-templates";

type Db = Pick<PoolClient, "query">;

/**
 * Made goods rejected at site go back into production: the work order counts that much as not passed (so
 * it's made and checked again, never counted twice) and a ready work order is back in production. A
 * work order that was closed short leaves the quantity to plan again from To make. The factory lead, the
 * project's manager and the people who run the factory hear.
 */
export async function reworkFromSite(db: Db, workspaceId: string, input: {
  workOrderId: string; quantity: string; reason: string; dispatchId: string; returnId: string | null; actorId: string;
}) {
  const order = (await db.query<{ id: string; number: number; title: string; status: string; projectId: string; project: string }>(
    `SELECT wo.id, wo.number, wo.title, wo.status, wo.project_id AS "projectId", project.reference || ' · ' || project.name AS project
       FROM work_orders wo JOIN delivery_projects project ON project.workspace_id = wo.workspace_id AND project.id = wo.project_id
      WHERE wo.workspace_id = $1 AND wo.id = $2 FOR UPDATE OF wo`, [workspaceId, input.workOrderId])).rows[0];
  if (!order || Dec.of(input.quantity).cmp(0) <= 0) return null;
  const id = randomUUID();
  await db.query(`INSERT INTO work_order_reworks (id, workspace_id, work_order_id, quantity, reason, source, dispatch_id, return_id, created_by) VALUES ($1, $2, $3, $4, $5, 'site', $6, $7, $8)`,
    [id, workspaceId, order.id, input.quantity, input.reason.slice(0, 500), input.dispatchId, input.returnId, input.actorId]);
  if (order.status === "ready")
    await db.query(`UPDATE work_orders SET status = 'in_production', ready_at = NULL, ready_on = NULL, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, order.id]);
  else await db.query(`UPDATE work_orders SET version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, order.id]);
  await db.query(`INSERT INTO work_order_events (id, workspace_id, work_order_id, kind, detail, actor_id) VALUES ($1, $2, $3, 'reworked', $4::jsonb, $5)`,
    [randomUUID(), workspaceId, order.id, JSON.stringify({ quantity: input.quantity, reason: input.reason, source: "site", dispatchId: input.dispatchId, returnId: input.returnId }), input.actorId]);
  const people = (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
      WHERE membership.workspace_id = $1 AND membership.status = 'active' AND (
        EXISTS (SELECT 1 FROM project_assignments assignment WHERE assignment.workspace_id = membership.workspace_id AND assignment.membership_id = membership.id
                 AND assignment.project_id = $2 AND assignment.active AND (assignment.is_manager OR assignment.role_keys && ARRAY['factory_lead']::varchar[]))
        OR EXISTS (SELECT 1 FROM effective_member_roles effective_role JOIN role_permissions granted ON granted.role_id = effective_role.role_id
                    JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'factory.manage'
                   WHERE effective_role.membership_id = membership.id))`, [workspaceId, order.projectId])).rows.map((row) => row.userId);
  const reference = `WO-${String(order.number).padStart(4, "0")}`;
  const actor = (await db.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [input.actorId])).rows[0]?.name ?? "";
  for (const userId of people.filter((person) => person !== input.actorId))
    await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "factory.rework", eventType: "factory.rework",
      variables: { order: reference, item: order.title, project: order.project, actor, note: `${Dec.of(input.quantity).toString()} rejected at site: ${input.reason}`.slice(0, 480) },
      deepLink: `/workspace/factory/orders?order=${order.id}`, idempotencyKey: `factory.rework:${id}:${userId}` });
  return { id, reference, reopened: order.status === "ready" };
}
