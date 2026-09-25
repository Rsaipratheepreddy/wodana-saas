import type { PoolClient } from "pg";
type HomeOverviewItem = { id: string; title: string; detail: string; href: string; date: string | null };
type HomeOverview = {
  sections: { sales: boolean; planning: boolean; projects: boolean };
  metrics: { myFollowUps: number | null; planningCases: number | null; activeProjects: number | null; myProjectTasks: number | null };
  sales: HomeOverviewItem[]; planning: HomeOverviewItem[]; projects: HomeOverviewItem[]; tasks: HomeOverviewItem[];
};

type Row = { id: string; title: string; detail: string; date: Date | string | null; total: number; projectId?: string; location?: string };
type Access = { sales: boolean; planning: boolean; projects: boolean; manageProjects: boolean };
const date = (value: Row["date"]) => value instanceof Date ? value.toISOString() : value ? String(value) : null;
const count = (rows: Row[]) => Number(rows[0]?.total ?? 0);
const items = (rows: Row[], href: (row: Row) => string): HomeOverviewItem[] => rows.map(row => ({
  id: row.id, title: row.title, detail: row.detail, date: date(row.date), href: href(row),
}));

/** All queries run inside the caller's tenant RLS transaction and return only actionable, bounded summaries. */
export async function readHomeOverview(client: Pick<PoolClient, "query">, workspaceId: string, membershipId: string, access: Access): Promise<HomeOverview> {
  const result: HomeOverview = {
    sections: { sales: access.sales, planning: access.planning, projects: access.projects },
    metrics: { myFollowUps: access.sales ? 0 : null, planningCases: access.planning ? 0 : null, activeProjects: access.projects ? 0 : null, myProjectTasks: access.projects ? 0 : null },
    sales: [], planning: [], projects: [], tasks: [],
  };
  if (access.sales) {
    const rows = (await client.query<Row>(`SELECT activity.id,activity.title,
        CASE WHEN activity.due_at < now() THEN 'Overdue follow-up' ELSE 'Follow-up' END AS detail,
        activity.due_at AS date,count(*) OVER()::int AS total
      FROM crm_activities activity
      WHERE activity.workspace_id=$1 AND activity.owner_membership_id=$2 AND activity.status='pending' AND activity.type<>'note'
      ORDER BY activity.due_at ASC NULLS LAST,activity.id LIMIT 5`, [workspaceId, membershipId])).rows;
    result.metrics.myFollowUps = count(rows);
    result.sales = items(rows, row => `/workspace/crm/follow-ups?record=${encodeURIComponent(row.id)}`);
  }
  if (access.planning) {
    const rows = (await client.query<Row>(`SELECT case_record.id,opportunity.title,
        party.display_name AS detail,case_record.updated_at AS date,count(*) OVER()::int AS total
      FROM pre_project_cases case_record
      JOIN crm_opportunities opportunity ON opportunity.workspace_id=case_record.workspace_id AND opportunity.id=case_record.opportunity_id
      JOIN crm_parties party ON party.workspace_id=opportunity.workspace_id AND party.id=opportunity.party_id
      WHERE case_record.workspace_id=$1 AND case_record.status IN ('draft','active','on_hold')
        AND (case_record.owner_membership_id=$2 OR opportunity.owner_membership_id=$2 OR EXISTS (
          SELECT 1 FROM project_assignments assignment WHERE assignment.workspace_id=case_record.workspace_id
          AND assignment.case_id=case_record.id AND assignment.membership_id=$2 AND assignment.active))
      ORDER BY case_record.updated_at DESC,case_record.id LIMIT 5`, [workspaceId, membershipId])).rows;
    result.metrics.planningCases = count(rows);
    result.planning = items(rows, row => `/workspace/pre-projects/cases/${encodeURIComponent(row.id)}/overview`);
  }
  if (access.projects) {
    const visible = `project.workspace_id=$1 AND project.status='active' AND ($3::boolean OR EXISTS (
      SELECT 1 FROM project_assignments assignment WHERE assignment.workspace_id=project.workspace_id
      AND assignment.project_id=project.id AND assignment.membership_id=$2 AND assignment.active))`;
    const projects = (await client.query<Row>(`SELECT project.id,project.name AS title,
        coalesce(execution.content->>'phase','planning') AS detail,project.created_at AS date,count(*) OVER()::int AS total
      FROM delivery_projects project
      LEFT JOIN project_execution execution ON execution.workspace_id=project.workspace_id AND execution.project_id=project.id
      WHERE ${visible}
      ORDER BY project.created_at DESC,project.id LIMIT 5`, [workspaceId, membershipId, access.manageProjects])).rows;
    result.metrics.activeProjects = count(projects);
    result.projects = items(projects, row => `/workspace/projects/${encodeURIComponent(row.id)}/overview`);
    const tasks = (await client.query<Row>(`SELECT task.value->>'id' AS id,task.value->>'title' AS title,
        project.name AS detail,nullif(task.value->>'end','') AS date,project.id AS "projectId",
        task.value->>'location' AS location,count(*) OVER()::int AS total
      FROM delivery_projects project
      JOIN project_execution execution ON execution.workspace_id=project.workspace_id AND execution.project_id=project.id
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(execution.content->'tasks')='array'
        THEN execution.content->'tasks' ELSE '[]'::jsonb END) task(value)
      WHERE ${visible} AND (task.value->>'ownerId'=$2::text OR coalesce(task.value->'assigneeIds','[]'::jsonb) ? $2::text)
        AND task.value->>'status' NOT IN ('completed','cancelled')
      ORDER BY nullif(task.value->>'end','') ASC NULLS LAST,project.id,task.value->>'id' LIMIT 5`,
      [workspaceId, membershipId, access.manageProjects])).rows;
    result.metrics.myProjectTasks = count(tasks);
    result.tasks = items(tasks, row => `/workspace/tasks?projectId=${encodeURIComponent(row.projectId ?? '')}&taskId=${encodeURIComponent(row.id)}`);
  }
  return result;
}
