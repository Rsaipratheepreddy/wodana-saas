import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

export const WORK_TYPES = ["task", "blocker", "client_request", "snag"] as const;
export const WORK_STATUSES = ["todo", "in_progress", "in_review", "done", "cancelled"] as const;
export const WORK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type WorkType = (typeof WORK_TYPES)[number];
export type WorkStatus = (typeof WORK_STATUSES)[number];
export const OPEN = (status: WorkStatus) => status !== "done" && status !== "cancelled";

export type WorkRef = { id: string; number: number; title: string; type: WorkType; status: WorkStatus };
export type WorkItem = {
  id: string; projectId: string; number: number; type: WorkType; parentId: string | null; packageId: string | null; boqLineId: string | null; stageId: string | null; sprintId: string | null;
  title: string; status: WorkStatus; priority: (typeof WORK_PRIORITIES)[number]; assigneeId: string | null; assigneeName: string | null;
  startDate: string | null; dueDate: string | null; baselineStart: string | null; baselineDue: string | null; completedAt: string | null; createdBy: string; version: number;
  /** The package's materials must be there when it starts: purchasing counts back from its start. */
  needsMaterials: boolean;
  subtasks: number; subtasksDone: number; comments: number;
  /** What it's waiting on: a predecessor not yet finished (finish-to-start) or not yet started (start-to-start). */
  blockedBy: WorkRef[];
};

const ITEM_SELECT = `SELECT item.id, item.project_id AS "projectId", item.number, item.type, item.parent_id AS "parentId", item.package_id AS "packageId",
  item.boq_line_id AS "boqLineId", item.stage_id AS "stageId", item.sprint_id AS "sprintId", item.title, item.status, item.priority, item.assignee_membership_id AS "assigneeId",
  coalesce(assignee.display_name, assignee.primary_email) AS "assigneeName", item.start_date::text AS "startDate", item.due_date::text AS "dueDate",
  item.baseline_start::text AS "baselineStart", item.baseline_due::text AS "baselineDue", item.completed_at AS "completedAt", item.created_by AS "createdBy", item.version,
  item.needs_materials AS "needsMaterials",
  (SELECT count(*)::int FROM work_items child WHERE child.workspace_id = item.workspace_id AND child.parent_id = item.id AND child.status <> 'cancelled') AS subtasks,
  (SELECT count(*)::int FROM work_items child WHERE child.workspace_id = item.workspace_id AND child.parent_id = item.id AND child.status = 'done') AS "subtasksDone",
  (SELECT count(*)::int FROM work_item_comments comment WHERE comment.workspace_id = item.workspace_id AND comment.work_item_id = item.id) AS comments,
  coalesce((SELECT jsonb_agg(jsonb_build_object('id', before.id, 'number', before.number, 'title', before.title, 'type', before.type, 'status', before.status) ORDER BY before.number)
     FROM work_item_links link JOIN work_items before ON before.workspace_id = link.workspace_id AND before.id = link.predecessor_id
    WHERE link.workspace_id = item.workspace_id AND link.successor_id = item.id
      AND ((link.kind = 'fs' AND before.status NOT IN ('done', 'cancelled')) OR (link.kind = 'ss' AND before.status = 'todo'))), '[]'::jsonb) AS "blockedBy"
  FROM work_items item
  LEFT JOIN workspace_memberships membership ON membership.workspace_id = item.workspace_id AND membership.id = item.assignee_membership_id
  LEFT JOIN users assignee ON assignee.id = membership.user_id`;

export async function readItems(db: Db, workspaceId: string, projectId: string): Promise<WorkItem[]> {
  return (await db.query<WorkItem>(`${ITEM_SELECT} WHERE item.workspace_id = $1 AND item.project_id = $2 ORDER BY item.number`, [workspaceId, projectId])).rows;
}

export async function readItem(db: Db, workspaceId: string, itemId: string, lock = false): Promise<WorkItem | undefined> {
  if (lock) await db.query(`SELECT 1 FROM work_items WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, itemId]);
  return (await db.query<WorkItem>(`${ITEM_SELECT} WHERE item.workspace_id = $1 AND item.id = $2`, [workspaceId, itemId])).rows[0];
}

export type MyWorkItem = WorkItem & { projectReference: string; projectName: string };

/** Open work across the projects the person can see: theirs, or everyone's. */
export async function readOpenWork(db: Db, workspaceId: string, membershipId: string | null, input: { all: boolean; mine: boolean }): Promise<MyWorkItem[]> {
  return (await db.query<MyWorkItem>(
    `SELECT listed.*, project.reference AS "projectReference", project.name AS "projectName"
       FROM (${ITEM_SELECT} WHERE item.workspace_id = $1 AND item.status NOT IN ('done', 'cancelled')
               AND ($4::boolean IS FALSE OR item.assignee_membership_id = $2)) listed
       JOIN delivery_projects project ON project.workspace_id = $1 AND project.id = listed."projectId"
      WHERE project.status IN ('active', 'on_hold')
        AND ($3 OR EXISTS (SELECT 1 FROM project_assignments assignment WHERE assignment.workspace_id = project.workspace_id
                             AND assignment.project_id = project.id AND assignment.membership_id = $2 AND assignment.active))
      ORDER BY listed."dueDate" NULLS LAST, CASE listed.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, project.reference, listed.number
      LIMIT 500`, [workspaceId, membershipId, input.all, input.mine])).rows;
}

export type ActivityEntry =
  | { id: string; kind: "comment"; body: string; by: string; at: string }
  | { id: string; kind: string; detail: Record<string, unknown>; by: string; at: string };

/** An item's comments and changes, oldest first. */
export async function readActivity(db: Db, workspaceId: string, itemId: string): Promise<ActivityEntry[]> {
  return (await db.query<ActivityEntry>(
    `SELECT * FROM (
       SELECT comment.id, 'comment' AS kind, comment.body, NULL::jsonb AS detail, person.display_name AS by, comment.created_at AS at
         FROM work_item_comments comment JOIN users person ON person.id = comment.author_id
        WHERE comment.workspace_id = $1 AND comment.work_item_id = $2
       UNION ALL
       SELECT event.id, event.kind, NULL, event.detail, person.display_name, event.at
         FROM work_item_events event JOIN users person ON person.id = event.actor_id
        WHERE event.workspace_id = $1 AND event.work_item_id = $2) entries
     ORDER BY at, id`, [workspaceId, itemId])).rows
    .map((row) => (row.kind === "comment" ? { id: row.id, kind: "comment", body: (row as { body: string }).body, by: row.by, at: row.at }
      : { id: row.id, kind: row.kind, detail: (row as { detail: Record<string, unknown> }).detail, by: row.by, at: row.at }));
}

/** What an item waits on and what waits on it, with the kind of link and the lag. */
export async function readLinks(db: Db, workspaceId: string, itemId: string) {
  const rows = (await db.query<WorkRef & { kind: "fs" | "ss"; lagDays: number; direction: "before" | "after" }>(
    `SELECT other.id, other.number, other.title, other.type, other.status, link.kind, link.lag_days AS "lagDays",
            CASE WHEN link.successor_id = $2 THEN 'before' ELSE 'after' END AS direction
       FROM work_item_links link
       JOIN work_items other ON other.workspace_id = link.workspace_id AND other.id = CASE WHEN link.successor_id = $2 THEN link.predecessor_id ELSE link.successor_id END
      WHERE link.workspace_id = $1 AND (link.successor_id = $2 OR link.predecessor_id = $2)
      ORDER BY other.number`, [workspaceId, itemId])).rows;
  return { before: rows.filter((row) => row.direction === "before").map(({ direction: _d, ...row }) => row), after: rows.filter((row) => row.direction === "after").map(({ direction: _d, ...row }) => row) };
}

/** True when linking predecessor → successor would close a loop (the successor already leads to the predecessor). */
export async function wouldCycle(db: Db, workspaceId: string, predecessorId: string, successorId: string) {
  return Boolean((await db.query(
    `WITH RECURSIVE downstream (id) AS (
       SELECT successor_id FROM work_item_links WHERE workspace_id = $1 AND predecessor_id = $2
       UNION
       SELECT link.successor_id FROM work_item_links link JOIN downstream ON link.predecessor_id = downstream.id WHERE link.workspace_id = $1)
     SELECT 1 FROM downstream WHERE id = $3 LIMIT 1`, [workspaceId, successorId, predecessorId])).rowCount);
}

export async function workEvent(db: Db, workspaceId: string, itemId: string, kind: string, detail: Record<string, unknown>, actorUserId: string) {
  await db.query(`INSERT INTO work_item_events (id, workspace_id, work_item_id, kind, detail, actor_id) VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb, $5)`,
    [workspaceId, itemId, kind, JSON.stringify(detail), actorUserId]);
}

/** Gives someone access to a project without a role, so work given to them opens for them. */
export async function ensureProjectAccess(db: Db, workspaceId: string, projectId: string, membershipId: string) {
  await db.query(
    `INSERT INTO project_assignments (workspace_id, project_id, membership_id, is_manager, active, role_keys)
     VALUES ($1, $2, $3, false, true, '{}')
     ON CONFLICT (workspace_id, project_id, membership_id) WHERE project_id IS NOT NULL DO UPDATE SET active = true`,
    [workspaceId, projectId, membershipId]);
}

/** Every dependency on the project, for scheduling. */
export async function readProjectLinks(db: Db, workspaceId: string, projectId: string) {
  return (await db.query<{ predecessorId: string; successorId: string; kind: "fs" | "ss"; lagDays: number }>(
    `SELECT predecessor_id AS "predecessorId", successor_id AS "successorId", kind, lag_days AS "lagDays" FROM work_item_links WHERE workspace_id = $1 AND project_id = $2`,
    [workspaceId, projectId])).rows;
}

export type WorkInsightRow = {
  membershipId: string | null; name: string | null; total: boolean;
  open: number; late: number; dueThisWeek: number; blocked: number;
  /** Finished in the period; of those with a due date, how many on or before it. */
  done: number; doneWithDue: number; onTime: number;
  /** Median days from starting to finishing, for work finished in the period. */
  cycleDays: number | null;
};

/**
 * Who has what across the projects someone oversees, and how work has gone over the last `days` days.
 * Dates are the workspace's calendar days; "on time" means finished on or before the due date. The
 * total row is computed on its own (never an average of people), so its median is a true median.
 */
export async function readInsights(db: Db, workspaceId: string, membershipId: string | null, all: boolean, days: number): Promise<WorkInsightRow[]> {
  return (await db.query<WorkInsightRow>(
    `WITH clock AS (
       SELECT (now() AT TIME ZONE coalesce(default_timezone, 'UTC'))::date AS today, coalesce(default_timezone, 'UTC') AS zone FROM workspaces WHERE id = $1
     ), scoped AS (
       SELECT item.assignee_membership_id, item.status, item.due_date, item.started_at, item.completed_at,
              item.status NOT IN ('done', 'cancelled') AS is_open,
              item.status = 'done' AND item.completed_at >= now() - make_interval(days => $4) AS done_recently,
              (item.completed_at AT TIME ZONE clock.zone)::date AS done_on, clock.today,
              EXISTS (SELECT 1 FROM work_item_links link JOIN work_items before ON before.workspace_id = link.workspace_id AND before.id = link.predecessor_id
                       WHERE link.workspace_id = item.workspace_id AND link.successor_id = item.id
                         AND ((link.kind = 'fs' AND before.status NOT IN ('done', 'cancelled')) OR (link.kind = 'ss' AND before.status = 'todo'))) AS is_blocked
         FROM work_items item
         JOIN delivery_projects project ON project.workspace_id = item.workspace_id AND project.id = item.project_id
         CROSS JOIN clock
        WHERE item.workspace_id = $1 AND item.status <> 'cancelled' AND project.started_at IS NOT NULL AND project.status IN ('active', 'on_hold', 'completed')
          AND ($2 OR EXISTS (SELECT 1 FROM project_assignments assignment WHERE assignment.workspace_id = project.workspace_id
                              AND assignment.project_id = project.id AND assignment.membership_id = $3 AND assignment.active))
     )
     SELECT scoped.assignee_membership_id AS "membershipId", coalesce(person.display_name, person.primary_email) AS name,
            GROUPING(scoped.assignee_membership_id) = 1 AS total,
            count(*) FILTER (WHERE is_open)::int AS open,
            count(*) FILTER (WHERE is_open AND due_date < today)::int AS late,
            count(*) FILTER (WHERE is_open AND due_date BETWEEN today AND today + 6)::int AS "dueThisWeek",
            count(*) FILTER (WHERE is_open AND is_blocked)::int AS blocked,
            count(*) FILTER (WHERE done_recently)::int AS done,
            count(*) FILTER (WHERE done_recently AND due_date IS NOT NULL)::int AS "doneWithDue",
            count(*) FILTER (WHERE done_recently AND due_date IS NOT NULL AND done_on <= due_date)::int AS "onTime",
            round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM completed_at - started_at) / 86400)
                   FILTER (WHERE done_recently AND started_at IS NOT NULL AND completed_at >= started_at))::numeric, 1)::float8 AS "cycleDays"
       FROM scoped
       LEFT JOIN workspace_memberships membership ON membership.workspace_id = $1 AND membership.id = scoped.assignee_membership_id
       LEFT JOIN users person ON person.id = membership.user_id
      GROUP BY GROUPING SETS ((scoped.assignee_membership_id, person.display_name, person.primary_email), ())
      ORDER BY GROUPING(scoped.assignee_membership_id) DESC, count(*) FILTER (WHERE is_open) DESC, name NULLS LAST`,
    [workspaceId, all, membershipId, days])).rows;
}

/**
 * How far the work is, in whole percent. A task counts once it's done; until then a task with subtasks
 * counts the share of its subtasks done. A package is the share of its tasks; the project weighs each
 * package by its value in the live scope (equally when the scope has no values), and a package with no
 * tasks yet counts as not started. With no packages, the project is the share of all its tasks. Issues
 * and cancelled work don't count. Null when there's nothing to count.
 */
export async function readProgress(db: Db, workspaceId: string, projectId: string): Promise<{ project: number | null; packages: Record<string, number> }> {
  const tasks = (await db.query<{ packageId: string | null; units: number; count: number }>(
    `SELECT task.package_id AS "packageId", sum(CASE WHEN task.status = 'done' THEN 1 WHEN sub.total > 0 THEN sub.done::float8 / sub.total ELSE 0 END)::float8 AS units, count(*)::int AS count
       FROM work_items task
       LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE child.status <> 'cancelled') AS total, count(*) FILTER (WHERE child.status = 'done') AS done
                            FROM work_items child WHERE child.workspace_id = task.workspace_id AND child.parent_id = task.id) sub ON true
      WHERE task.workspace_id = $1 AND task.project_id = $2 AND task.parent_id IS NULL AND task.type = 'task' AND task.status <> 'cancelled'
      GROUP BY task.package_id`, [workspaceId, projectId])).rows;
  const packages = (await db.query<{ id: string; value: number }>(
    `SELECT package.id, coalesce((SELECT sum(line.net) FROM project_boq_lines line WHERE line.workspace_id = package.workspace_id AND line.package_id = package.id AND line.status = 'active'), 0)::float8 AS value
       FROM project_packages package WHERE package.workspace_id = $1 AND package.project_id = $2`, [workspaceId, projectId])).rows;
  const percent = (share: number) => Math.floor(Math.round(share * 10_000) / 100);
  const share = new Map(tasks.filter((row) => row.packageId).map((row) => [row.packageId!, row.units / row.count]));
  const byPackage = Object.fromEntries([...share].filter(([id]) => packages.some((item) => item.id === id)).map(([id, value]) => [id, percent(value)]));
  if (!packages.length) {
    const count = tasks.reduce((sum, row) => sum + row.count, 0);
    return { project: count ? percent(tasks.reduce((sum, row) => sum + row.units, 0) / count) : null, packages: byPackage };
  }
  const total = packages.reduce((sum, item) => sum + item.value, 0);
  const weight = (item: { value: number }) => (total > 0 ? item.value / total : 1 / packages.length);
  return { project: percent(packages.reduce((sum, item) => sum + (share.get(item.id) ?? 0) * weight(item), 0)), packages: byPackage };
}
