import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

export type SiteToday = {
  projectId: string; reference: string; name: string;
  /** My report for today, if I've started one. */
  report: { id: string; status: "draft" | "submitted" | "approved" | "returned" } | null;
  /** Orders delivering to the site and moves on their way to it that are due today or earlier. */
  arriving: number;
  /** Open snags on the project given to me. */
  snags: number;
};

/**
 * The phone's "My sites today": each running project I'm on whose site work runs today, with my report for
 * the day, what's due to arrive and the snags given to me. The workspace's clock (the hour, and when the day's
 * report is due: Settings → Projects, 18:00 by default) comes along.
 */
export async function readSitesToday(db: Db, workspaceId: string, userId: string) {
  const clock = (await db.query<{ today: string; hour: number; dueTime: string }>(
    `SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today,
            extract(hour FROM now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::int AS hour,
            coalesce((SELECT to_char(report_due_time, 'HH24:MI') FROM workspace_project_settings WHERE workspace_id = workspaces.id), '18:00') AS "dueTime"
       FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
  const sites = (await db.query<SiteToday>(
    `SELECT project.id AS "projectId", project.reference, project.name,
            (SELECT jsonb_build_object('id', report.id, 'status', report.status) FROM site_reports report
              WHERE report.workspace_id = project.workspace_id AND report.project_id = project.id AND report.report_date = $3::date AND report.author_id = $2) AS report,
            ((SELECT count(DISTINCT purchase.id) FROM purchase_orders purchase JOIN purchase_order_lines line ON line.workspace_id = purchase.workspace_id AND line.order_id = purchase.id
               WHERE purchase.workspace_id = project.workspace_id AND line.project_id = project.id AND purchase.deliver_to = 'site'
                 AND purchase.status IN ('sent', 'confirmed', 'partly_received') AND coalesce(line.promised_date, purchase.promised_date, purchase.expected_date) <= $3::date)
             + (SELECT count(*) FROM stock_transfers transfer JOIN stock_locations place ON place.workspace_id = transfer.workspace_id AND place.id = transfer.to_location_id
                 WHERE transfer.workspace_id = project.workspace_id AND transfer.status = 'in_transit' AND place.kind = 'site' AND place.project_id = project.id))::int AS arriving,
            (SELECT count(*)::int FROM work_items snag WHERE snag.workspace_id = project.workspace_id AND snag.project_id = project.id AND snag.type = 'snag'
               AND snag.status NOT IN ('done', 'cancelled') AND snag.assignee_membership_id = membership.id) AS snags
       FROM delivery_projects project
       JOIN workspace_memberships membership ON membership.workspace_id = project.workspace_id AND membership.user_id = $2 AND membership.status = 'active'
       JOIN project_assignments assignment ON assignment.workspace_id = project.workspace_id AND assignment.project_id = project.id AND assignment.membership_id = membership.id AND assignment.active
      WHERE project.workspace_id = $1 AND project.status = 'active' AND project.site_started_on <= $3::date AND (project.site_finished_on IS NULL OR project.site_finished_on >= $3::date)
      ORDER BY project.reference`, [workspaceId, userId, clock.today])).rows;
  return { today: clock.today, hour: clock.hour, dueTime: clock.dueTime, sites };
}
