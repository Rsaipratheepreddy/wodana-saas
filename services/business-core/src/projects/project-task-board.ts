import { BadRequestException } from "@nestjs/common";
import type { HrmsContext } from "../hrms/hrms-access.service";

export type TaskBoardStatus = "planned" | "in_progress" | "blocked" | "on_hold" | "awaiting_inspection" | "completed" | "cancelled";
export type TaskBoardRow = {
  id: string;
  projectId: string;
  projectName: string;
  projectReference: string;
  clientName: string;
  title: string;
  area: string;
  packageName: string;
  location: "site" | "factory" | "office";
  status: TaskBoardStatus;
  priority: "normal" | "high" | "urgent";
  ownerId: string;
  ownerName: string;
  assigneeCount: number;
  start: string;
  end: string;
  quantity: number;
  approved: number;
  unit: string;
  /** First missing start condition, or the recorded blocker. Empty when nothing is known to be missing. */
  waitingFor: string;
  overdue: boolean;
};
export type TaskBoardPage = {
  rows: TaskBoardRow[];
  nextCursor: string | null;
  counts: Partial<Record<TaskBoardStatus, number>>;
  memberId: string;
  canManage: boolean;
  projects: { id: string; name: string }[];
  members: { id: string; name: string }[];
};

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const STATUSES: TaskBoardStatus[] = ["planned", "in_progress", "blocked", "on_hold", "awaiting_inspection", "completed", "cancelled"];
const PAGE_SIZE = 200;

export function parseTaskBoardQuery(input: Record<string, unknown>) {
  const value = (key: string) => (typeof input[key] === "string" ? String(input[key]).trim() : "");
  const view = value("view") || "mine";
  const statuses = value("status") ? value("status").split(",") : [];
  const due = value("due");
  const query = {
    view, statuses, due,
    projectId: value("projectId"),
    ownerId: value("ownerId"),
    location: value("location"),
    priority: value("priority"),
    q: value("q").slice(0, 120),
    cursor: value("cursor"),
  };
  if (!["mine", "team", "all"].includes(view)) throw new BadRequestException("Choose mine, team or all.");
  if (statuses.some((status) => !STATUSES.includes(status as TaskBoardStatus))) throw new BadRequestException("Choose a valid task status.");
  if (due && !["overdue", "today", "week"].includes(due)) throw new BadRequestException("Choose a valid due filter.");
  if (query.projectId && !UUID.test(query.projectId)) throw new BadRequestException("Choose a valid project.");
  if (query.ownerId && query.ownerId !== "unassigned" && !UUID.test(query.ownerId)) throw new BadRequestException("Choose a valid owner.");
  if (query.location && !["site", "factory", "office"].includes(query.location)) throw new BadRequestException("Choose a valid location.");
  if (query.priority && !["normal", "high", "urgent"].includes(query.priority)) throw new BadRequestException("Choose a valid priority.");
  let after: [string, string, string] | null = null;
  if (query.cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(query.cursor, "base64url").toString()) as unknown;
      if (!Array.isArray(decoded) || decoded.length !== 3 || !decoded.every((part) => typeof part === "string")) throw new Error();
      after = decoded as [string, string, string];
    } catch {
      throw new BadRequestException("The page cursor is invalid.");
    }
  }
  return { ...query, after };
}

/**
 * Cross-project task board over project_tasks. Visibility matches the project list: managers see
 * every active project, everyone else only projects they are assigned to. Status changes use the
 * project's own task_status command, which remains the authority for start conditions.
 */
export async function readTaskBoard(ctx: HrmsContext, input: Record<string, unknown>): Promise<TaskBoardPage> {
  const query = parseTaskBoardQuery(input);
  const canManage = ctx.permissions.has("projects.manage");
  const filters = `
    WITH authorized AS (
      SELECT project.id, project.name, workspace.default_timezone AS timezone,
        coalesce(execution.content->'controls'->>'reference', '') AS reference,
        coalesce((execution.content->'controls'->>'onHold')::boolean, false) AS on_hold,
        coalesce(party.display_name, '') AS client_name
      FROM delivery_projects project
      JOIN workspaces workspace ON workspace.id = project.workspace_id
      LEFT JOIN project_execution execution ON execution.workspace_id = project.workspace_id AND execution.project_id = project.id
      LEFT JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
      LEFT JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
      LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
      WHERE project.workspace_id = $1 AND project.status <> 'archived'
        AND ($3 OR EXISTS (SELECT 1 FROM project_assignments assignment
          WHERE assignment.workspace_id = project.workspace_id AND assignment.project_id = project.id
            AND assignment.membership_id = $2 AND assignment.active))
    ), candidates AS (
      SELECT task.*, project.name AS project_name, project.reference, project.client_name, project.on_hold,
        (now() AT TIME ZONE project.timezone)::date AS today
      FROM project_tasks task
      JOIN authorized project ON project.id = task.project_id
      WHERE task.workspace_id = $1
        AND ($4 <> 'mine' OR task.owner_id = $2::text OR $2::text = ANY(task.assignee_ids))
        AND ($4 <> 'team' OR EXISTS (SELECT 1 FROM project_assignments assignment
          WHERE assignment.workspace_id = task.workspace_id AND assignment.project_id = task.project_id
            AND assignment.membership_id = $2 AND assignment.active))
        AND ($5 = '' OR task.project_id::text = $5)
        AND ($6 = '' OR ($6 = 'unassigned' AND task.owner_id = '') OR task.owner_id = $6 OR $6 = ANY(task.assignee_ids))
        AND ($7 = '' OR task.location = $7)
        AND ($8 = '' OR task.priority = $8)
        AND ($9 = '' OR strpos(lower(concat_ws(' ', task.title, task.area, task.package, project.name, project.client_name, project.reference)), lower($9)) > 0)
        AND NOT EXISTS (SELECT 1 FROM project_tasks child WHERE child.project_id = task.project_id AND child.parent_id = task.id)
    ), dated AS (
      SELECT * FROM candidates
      WHERE $10 = ''
        OR ($10 = 'overdue' AND end_date < today AND status NOT IN ('completed', 'cancelled'))
        OR ($10 = 'today' AND end_date = today)
        OR ($10 = 'week' AND end_date BETWEEN today AND today + 6)
    )`;
  const shared = [ctx.workspaceId, ctx.membershipId, canManage, query.view, query.projectId, query.ownerId, query.location, query.priority, query.q, query.due];

  const rows = await ctx.client.query<TaskBoardRow & { sortDue: string }>(
    `${filters}
    SELECT task.id, task.project_id AS "projectId", task.project_name AS "projectName", task.reference AS "projectReference",
      task.client_name AS "clientName", task.title, task.area, task.package AS "packageName", task.location, task.status,
      task.priority, task.owner_id AS "ownerId", coalesce(owner_user.display_name, '') AS "ownerName",
      cardinality(task.assignee_ids) AS "assigneeCount",
      coalesce(task.start_date::text, '') AS start, coalesce(task.end_date::text, '') AS "end",
      task.quantity::float8 AS quantity, task.approved::float8 AS approved, task.unit,
      CASE
        WHEN task.status IN ('completed', 'cancelled') THEN ''
        WHEN task.status IN ('blocked', 'on_hold') THEN coalesce(nullif(task.blocker, ''), 'Reason not recorded')
        WHEN task.on_hold THEN 'Project on hold'
        WHEN task.status <> 'planned' THEN ''
        WHEN task.owner_id = '' THEN 'Owner'
        WHEN EXISTS (SELECT 1 FROM project_task_dependencies dependency
          JOIN project_tasks predecessor ON predecessor.project_id = dependency.project_id AND predecessor.id = dependency.predecessor_id
          WHERE dependency.project_id = task.project_id AND dependency.task_id = task.id
            AND predecessor.status NOT IN ('completed', 'cancelled')) THEN 'Earlier task'
        WHEN NOT task.ready_scope THEN 'Scope confirmation'
        WHEN NOT task.ready_access THEN 'Site access'
        WHEN NOT task.ready_materials THEN 'Materials'
        WHEN task.location <> 'office' AND task.drawing_id = '' THEN 'Approved drawing'
        ELSE ''
      END AS "waitingFor",
      (task.end_date < task.today AND task.status NOT IN ('completed', 'cancelled')) AS overdue,
      coalesce(task.end_date::text, '9999-12-31') AS "sortDue"
    FROM dated task
    LEFT JOIN workspace_memberships owner_member ON owner_member.workspace_id = task.workspace_id
      AND owner_member.id::text = task.owner_id AND owner_member.status = 'active'
    LEFT JOIN users owner_user ON owner_user.id = owner_member.user_id
    WHERE (cardinality($11::text[]) = 0 OR task.status = ANY($11::text[]))
      AND ($12::text IS NULL OR (coalesce(task.end_date::text, '9999-12-31'), task.project_id::text, task.id) > ($12::text, $13::text, $14::text))
    ORDER BY coalesce(task.end_date::text, '9999-12-31'), task.project_id::text, task.id
    LIMIT ${PAGE_SIZE + 1}`,
    [...shared, query.statuses, ...(query.after ?? [null, null, null])],
  );
  const counts = await ctx.client.query<{ status: TaskBoardStatus; count: number }>(
    `${filters} SELECT status, count(*)::int AS count FROM dated GROUP BY status`,
    shared,
  );
  const projects = await ctx.client.query<{ id: string; name: string }>(
    `SELECT project.id, project.name FROM delivery_projects project
     WHERE project.workspace_id = $1 AND project.status <> 'archived'
       AND ($3 OR EXISTS (SELECT 1 FROM project_assignments assignment
         WHERE assignment.workspace_id = project.workspace_id AND assignment.project_id = project.id
           AND assignment.membership_id = $2 AND assignment.active))
     ORDER BY project.name, project.id`,
    [ctx.workspaceId, ctx.membershipId, canManage],
  );
  // Only people on projects the viewer can see, so filter options never disclose other assignments.
  const members = await ctx.client.query<{ id: string; name: string }>(
    `SELECT DISTINCT member.id, account.display_name AS name
     FROM workspace_memberships member JOIN users account ON account.id = member.user_id
     WHERE member.workspace_id = $1 AND member.status = 'active'
       AND (member.id = $2 OR EXISTS (SELECT 1 FROM project_assignments assignment
         WHERE assignment.workspace_id = $1 AND assignment.project_id = ANY($3::uuid[])
           AND assignment.membership_id = member.id AND assignment.active))
     ORDER BY name, member.id`,
    [ctx.workspaceId, ctx.membershipId, projects.rows.map((project) => project.id)],
  );

  const visible = rows.rows.slice(0, PAGE_SIZE);
  const last = visible.at(-1);
  return {
    rows: visible.map(({ sortDue: _sortDue, ...row }) => row),
    nextCursor: rows.rows.length > PAGE_SIZE && last
      ? Buffer.from(JSON.stringify([last.end || "9999-12-31", last.projectId, last.id])).toString("base64url")
      : null,
    counts: Object.fromEntries(counts.rows.map((row) => [row.status, row.count])),
    memberId: ctx.membershipId,
    canManage,
    projects: projects.rows,
    members: members.rows,
  };
}
