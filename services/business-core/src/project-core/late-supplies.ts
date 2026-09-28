import type { PoolClient } from "pg";
import { notifyUserInApp } from "../notifications/default-templates";
import { readNeeds, readOrderLines, type Need, type OrderLine } from "../purchasing/orders";
import { outstanding } from "../purchasing/receiving";
import { workEvent } from "./project-work";

type Db = Pick<PoolClient, "query">;

/**
 * A late supplier holds the site up. Each day, for every running project: when goods still owed on an order
 * were due before today — or were promised after the work that uses them must start — one blocker issue
 * "Waiting on PO-12 · veneer" is raised, given to the buyer, and it holds up the open work that needs those
 * materials; the project manager and the buyer hear it. It closes by itself once nothing late is owed.
 * Only the project's own work changes: the order is read, never touched.
 */
export async function processLateSupplies(db: Db, workspaceId: string) {
  const today = (await db.query<{ today: string }>(
    `SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.today;
  if (!today) return { raised: 0, closed: 0 };
  const pairs = (await db.query<{ orderId: string; number: string; supplier: string; buyer: string; projectId: string; title: string }>(
    `SELECT DISTINCT purchase.id AS "orderId", purchase.number, vendor.display_name AS supplier, purchase.created_by AS buyer, project.id AS "projectId",
            project.reference || ' · ' || project.name AS title
       FROM purchase_orders purchase
       JOIN workspace_vendors vendor ON vendor.workspace_id = purchase.workspace_id AND vendor.id = purchase.vendor_id
       JOIN purchase_order_lines line ON line.workspace_id = purchase.workspace_id AND line.order_id = purchase.id
       JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id AND project.status = 'active'
      WHERE purchase.workspace_id = $1 AND purchase.status IN ('sent', 'confirmed', 'partly_received')`, [workspaceId])).rows;
  // Blockers raised before whose order no longer owes anything late (received, closed or cancelled) close too.
  const open = (await db.query<{ id: string; projectId: string; originKey: string }>(
    `SELECT id, project_id AS "projectId", origin_key AS "originKey" FROM work_items
      WHERE workspace_id = $1 AND origin_key LIKE 'late-order:%' AND status NOT IN ('done', 'cancelled')`, [workspaceId])).rows;
  const needsBy = new Map<string, Need[]>();
  const needs = async (projectId: string) => {
    if (!needsBy.has(projectId)) needsBy.set(projectId, await readNeeds(db, workspaceId, false, projectId));
    return needsBy.get(projectId)!;
  };
  const late = (line: OrderLine, list: Need[]) => {
    if (!line.due || outstanding(line).cmp(0) <= 0) return false;
    const need = list.find((item) => (item.source === "material" && item.sourceId === line.materialItemId) || (item.source === "line" && item.sourceId === line.boqLineId));
    return line.due < today || Boolean(need?.neededBy && line.due > need.neededBy);
  };
  let raised = 0, closed = 0;
  const seen = new Set<string>();
  for (const pair of pairs) {
    const key = `late-order:${pair.orderId}`;
    seen.add(`${pair.projectId}:${key}`);
    const list = await needs(pair.projectId);
    const lines = (await readOrderLines(db, workspaceId, pair.orderId)).filter((line) => line.projectId === pair.projectId && late(line, list));
    const existing = open.find((item) => item.projectId === pair.projectId && item.originKey === key);
    if (!lines.length) { if (existing) { await close(db, workspaceId, existing.id, pair.buyer); closed += 1; } continue; }
    // The work waiting for those goods: open work that needs its package's materials, in the packages that use them.
    const packages = [...new Set(lines.flatMap((line) => list.filter((need) => (need.source === "material" && need.sourceId === line.materialItemId)
      || (need.source === "line" && need.sourceId === line.boqLineId)).flatMap((need) => need.packageIds)))];
    const waiting = (await db.query<{ id: string }>(
      `SELECT id FROM work_items WHERE workspace_id = $1 AND project_id = $2 AND needs_materials AND status NOT IN ('done', 'cancelled') AND type = 'task'
          AND (cardinality($3::uuid[]) = 0 OR package_id = ANY($3::uuid[]))`, [workspaceId, pair.projectId, packages])).rows.map((row) => row.id);
    let blockerId = existing?.id ?? null;
    if (!blockerId) {
      const buyer = (await db.query<{ id: string }>(`SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`, [workspaceId, pair.buyer])).rows[0]?.id ?? null;
      await db.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, pair.projectId]);
      const number = (await db.query<{ next: number }>(`SELECT coalesce(max(number), 0) + 1 AS next FROM work_items WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, pair.projectId])).rows[0].next;
      const title = `Waiting on ${pair.number} · ${lines[0].description}${lines.length > 1 ? ` and ${lines.length - 1} more` : ""}`.slice(0, 300);
      const inserted = (await db.query<{ id: string }>(
        `INSERT INTO work_items (id, workspace_id, project_id, number, type, title, description, priority, assignee_membership_id, due_date, created_by, origin_key)
         VALUES (gen_random_uuid(), $1, $2, $3, 'blocker', $4, $5, 'high', $6, $7, $8, $9)
         ON CONFLICT (workspace_id, project_id, origin_key) WHERE origin_key IS NOT NULL DO NOTHING RETURNING id`,
        [workspaceId, pair.projectId, number, title, `${pair.supplier}: ${lines.map((line) => `${line.description} due ${line.due}`).join("; ")}`.slice(0, 10000), buyer,
          lines.map((line) => line.due!).sort()[0] < today ? today : lines.map((line) => line.due!).sort()[0], pair.buyer, key])).rows[0];
      if (!inserted) continue;
      blockerId = inserted.id;
      await workEvent(db, workspaceId, blockerId, "created", { type: "blocker", origin: pair.number }, pair.buyer);
      raised += 1;
      const people = (await db.query<{ userId: string }>(
        `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
           JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
          WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND assignment.is_manager`, [workspaceId, pair.projectId])).rows.map((row) => row.userId);
      for (const userId of new Set([...people, pair.buyer]))
        await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "work.blocked", eventType: "work.blocked",
          variables: { title: pair.title, clientName: "", actor: pair.supplier, task: `#${number} ${title}`, note: `${waiting.length} task${waiting.length === 1 ? "" : "s"} wait for it` },
          deepLink: `/workspace/projects/${pair.projectId}/plan?item=${blockerId}`, idempotencyKey: `work.blocked:${key}:${pair.projectId}:${userId}` });
    }
    for (const itemId of waiting)
      await db.query(`INSERT INTO work_item_links (workspace_id, project_id, predecessor_id, successor_id, kind, lag_days, created_by) VALUES ($1, $2, $3, $4, 'fs', 0, $5)
        ON CONFLICT (workspace_id, predecessor_id, successor_id) DO NOTHING`, [workspaceId, pair.projectId, blockerId, itemId, pair.buyer]);
  }
  for (const item of open) {
    if (seen.has(`${item.projectId}:${item.originKey}`)) continue;
    const order = item.originKey.slice("late-order:".length);
    const buyer = (await db.query<{ buyer: string }>(`SELECT created_by AS buyer FROM purchase_orders WHERE workspace_id = $1 AND id::text = $2`, [workspaceId, order])).rows[0]?.buyer;
    if (!buyer) continue;
    await close(db, workspaceId, item.id, buyer);
    closed += 1;
  }
  return { raised, closed };
}

/** Nothing late is owed any more: the blocker is done, and the work it held up can go ahead. */
async function close(db: Db, workspaceId: string, itemId: string, actor: string) {
  await db.query(`UPDATE work_items SET status = 'done', completed_at = now(), version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, itemId]);
  await workEvent(db, workspaceId, itemId, "status", { to: "done", automatic: true }, actor);
}
