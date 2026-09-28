import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/**
 * For the Projects list: per project, the open work that's late (due before today in the workspace's time
 * zone) and the open work held up by something unfinished — the numbers that say which project needs a look.
 */
export async function readAttention(db: Db, workspaceId: string, projectIds: string[]) {
  if (!projectIds.length) return new Map<string, { late: number; blocked: number }>();
  const rows = (await db.query<{ projectId: string; late: number; blocked: number }>(
    `WITH clock AS (SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date AS today FROM workspaces WHERE id = $1)
     SELECT item.project_id AS "projectId",
            count(*) FILTER (WHERE item.due_date < clock.today)::int AS late,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM work_item_links link JOIN work_items before ON before.workspace_id = link.workspace_id AND before.id = link.predecessor_id
                                            WHERE link.workspace_id = item.workspace_id AND link.successor_id = item.id
                                              AND ((link.kind = 'fs' AND before.status NOT IN ('done', 'cancelled')) OR (link.kind = 'ss' AND before.status = 'todo'))))::int AS blocked
       FROM work_items item CROSS JOIN clock
      WHERE item.workspace_id = $1 AND item.project_id = ANY($2::uuid[]) AND item.status NOT IN ('done', 'cancelled')
      GROUP BY item.project_id`, [workspaceId, projectIds])).rows;
  return new Map(rows.map((row) => [row.projectId, { late: row.late, blocked: row.blocked }]));
}
