import type { PoolClient } from "pg";
import { notifyUserInApp } from "../notifications/default-templates";
import { readCalendar, workdays } from "../project-core/work-calendar";

type Db = Pick<PoolClient, "query">;

/**
 * The daily look at sites, in one workspace's tenant transaction. While site work is running on a
 * project and the day is worked: from 19:00 in the workspace's time zone, the site supervisor is
 * reminded when nobody has submitted today's report; and the project manager hears when yesterday (a
 * worked day) ended without one. Once per project and day.
 */
export async function processSiteReports(db: Db, workspaceId: string) {
  const now = (await db.query<{ today: string; hour: number }>(
    `SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today,
            extract(hour FROM now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::int AS hour FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
  if (!now) return { sent: 0 };
  const math = workdays(await readCalendar(db, workspaceId));
  const yesterday = new Date(Date.parse(`${now.today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  // Site work starts by itself with the first delivery to the project's site (or its first report).
  await db.query(
    `UPDATE delivery_projects project SET site_started_on = first.day
       FROM (SELECT location.project_id AS "projectId", min(movement.moved_on) AS day
               FROM stock_movements movement JOIN stock_locations location ON location.workspace_id = movement.workspace_id AND location.id = movement.location_id AND location.kind = 'site'
              WHERE movement.workspace_id = $1 AND movement.quantity > 0 AND location.project_id IS NOT NULL GROUP BY location.project_id) first
      WHERE project.workspace_id = $1 AND project.id = first."projectId" AND project.status = 'active' AND project.site_started_on IS NULL AND first.day <= $2::date`,
    [workspaceId, now.today]);
  const projects = (await db.query<{ id: string; title: string; clientName: string; started: string; finished: string | null }>(
    `SELECT project.id, project.reference || ' · ' || project.name AS title, coalesce(party.display_name, opportunity.title) AS "clientName",
            project.site_started_on::text AS started, project.site_finished_on::text AS finished
       FROM delivery_projects project
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
      WHERE project.workspace_id = $1 AND project.status = 'active' AND project.site_started_on IS NOT NULL AND project.site_started_on <= $2::date
        AND (project.site_finished_on IS NULL OR project.site_finished_on >= $3::date)`, [workspaceId, now.today, yesterday])).rows;
  let sent = 0;
  const people = async (projectId: string, supervisor: boolean) => (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND (CASE WHEN $3 THEN 'site_supervisor' = ANY(assignment.role_keys) ELSE assignment.is_manager END)`,
    [workspaceId, projectId, supervisor])).rows.map((row) => row.userId);
  const reported = async (projectId: string, day: string) => Boolean((await db.query(
    `SELECT 1 FROM site_reports WHERE workspace_id = $1 AND project_id = $2 AND report_date = $3 AND status IN ('submitted', 'approved') LIMIT 1`, [workspaceId, projectId, day])).rowCount);
  for (const project of projects) {
    const running = (day: string) => day >= project.started && (!project.finished || day <= project.finished) && math.isWorking(day);
    if (now.hour >= 19 && running(now.today) && !(await reported(project.id, now.today)))
      for (const userId of await people(project.id, true)) {
        const result = await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "site.report_missing", eventType: "site.report_missing",
          variables: { title: project.title, clientName: project.clientName, actor: "", note: "" }, deepLink: `/workspace/projects/${project.id}/site`,
          idempotencyKey: `site.report_missing:${project.id}:${now.today}:${userId}` });
        if (result.queued) sent += 1;
      }
    if (running(yesterday) && !(await reported(project.id, yesterday)))
      for (const userId of await people(project.id, false)) {
        const result = await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "site.report_overdue", eventType: "site.report_overdue",
          variables: { title: project.title, clientName: project.clientName, actor: "", note: `Nobody submitted a report for ${yesterday}.` }, deepLink: `/workspace/projects/${project.id}/site`,
          idempotencyKey: `site.report_overdue:${project.id}:${yesterday}:${userId}` });
        if (result.queued) sent += 1;
      }
  }
  return { sent };
}

/**
 * Warranties ending within 30 days: the project's account manager and project manager hear once per
 * project and end date — a chance for a last check or a care plan.
 */
export async function processWarrantyExpiry(db: Db, workspaceId: string) {
  const today = (await db.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.today;
  if (!today) return { sent: 0 };
  const ending = (await db.query<{ projectId: string; title: string; endsOn: string; items: number }>(
    `SELECT item.project_id AS "projectId", project.reference || ' · ' || project.name AS title, item.ends_on::text AS "endsOn", count(*)::int AS items
       FROM warranty_items item JOIN delivery_projects project ON project.workspace_id = item.workspace_id AND project.id = item.project_id
      WHERE item.workspace_id = $1 AND item.months > 0 AND item.ends_on BETWEEN $2::date AND $2::date + 30 AND project.status IN ('active', 'completed')
      GROUP BY item.project_id, project.reference, project.name, item.ends_on`, [workspaceId, today])).rows;
  let sent = 0;
  for (const group of ending) {
    const people = (await db.query<{ userId: string }>(
      `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
         JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
        WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND (assignment.is_manager OR 'account_manager' = ANY(assignment.role_keys))`,
      [workspaceId, group.projectId])).rows.map((row) => row.userId);
    for (const userId of people) {
      const result = await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "warranty.expiring", eventType: "warranty.expiring",
        variables: { title: group.title, clientName: "", actor: "", note: `${group.items} item${group.items === 1 ? "'s" : "s'"} warranty ends on ${group.endsOn}.` },
        deepLink: `/workspace/projects/${group.projectId}/handover?view=warranty`, idempotencyKey: `warranty.expiring:${group.projectId}:${group.endsOn}:${userId}` });
      if (result.queued) sent += 1;
    }
  }
  return { sent };
}
