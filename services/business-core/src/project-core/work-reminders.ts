import type { PoolClient } from "pg";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";

type Db = Pick<PoolClient, "query">;

/**
 * The daily reminders for project work, run inside one workspace's tenant transaction: the assignee
 * hears the day before an item is due; when it becomes late the assignee (in-app and email) and the
 * project manager hear once. A missed day catches up for a week. Keys make every reminder once only.
 */
export async function processWorkDeadlines(db: Db, workspaceId: string) {
  const rows = (await db.query<{ id: string; projectId: string; number: number; title: string; due: string; kind: "soon" | "late"; assignee: string | null; lead: string | null; projectTitle: string; locale: string }>(
    `WITH clock AS (
       SELECT (now() AT TIME ZONE coalesce(default_timezone, 'UTC'))::date AS today, coalesce(default_locale, 'en') AS locale FROM workspaces WHERE id = $1
     )
     SELECT item.id, item.project_id AS "projectId", item.number, item.title, item.due_date::text AS due,
            CASE WHEN item.due_date = clock.today + 1 THEN 'soon' ELSE 'late' END AS kind,
            assignee.user_id AS assignee, lead.user_id AS lead, project.reference || ' · ' || project.name AS "projectTitle", clock.locale
       FROM work_items item
       JOIN delivery_projects project ON project.workspace_id = item.workspace_id AND project.id = item.project_id
       CROSS JOIN clock
       LEFT JOIN workspace_memberships assignee ON assignee.workspace_id = item.workspace_id AND assignee.id = item.assignee_membership_id AND assignee.status = 'active'
       LEFT JOIN LATERAL (
         SELECT member.user_id FROM project_assignments assignment
           JOIN workspace_memberships member ON member.workspace_id = assignment.workspace_id AND member.id = assignment.membership_id AND member.status = 'active'
          WHERE assignment.workspace_id = project.workspace_id AND assignment.project_id = project.id AND assignment.active AND assignment.is_manager LIMIT 1) lead ON true
      WHERE item.workspace_id = $1 AND item.status NOT IN ('done', 'cancelled') AND project.status = 'active'
        AND (item.due_date = clock.today + 1 OR item.due_date BETWEEN clock.today - 7 AND clock.today - 1)`, [workspaceId])).rows;
  let sent = 0;
  for (const row of rows) {
    const day = (() => { try { return new Intl.DateTimeFormat(row.locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${row.due}T00:00:00Z`)); } catch { return row.due; } })();
    const variables = { title: row.projectTitle, task: `#${row.number} ${row.title}`, due: day };
    const deepLink = `/workspace/projects/${row.projectId}/plan?item=${row.id}`;
    const code = row.kind === "soon" ? "work.due_soon" : "work.overdue";
    const people = row.kind === "soon" ? [row.assignee] : [row.assignee, row.lead];
    for (const userId of [...new Set(people.filter((person): person is string => Boolean(person)))]) {
      const message = { workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink };
      const key = `${code}:${row.id}:${row.due}:${userId}`;
      const result = await notifyUserInApp(db, { ...message, idempotencyKey: key });
      if (code === "work.overdue" && userId === row.assignee) await queueUserEmail(db, { ...message, idempotencyKey: `${key}:email` });
      if (result.queued) sent++;
    }
  }
  return { sent };
}
