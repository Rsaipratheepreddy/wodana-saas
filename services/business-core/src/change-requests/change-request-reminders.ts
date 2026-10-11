import type { PoolClient } from "pg";
import { changeReference } from "./change-request.domain";
import { noticeProjectChangeReminder } from "./change-request-notices";

type Db = Pick<PoolClient, "query">;

/** How many of the firm's reminder days have passed after `waited` days (0 before the first). */
export function changeReminderRound(waited: number, days: number[]) {
  return [...new Set(days)].filter((day) => Number.isInteger(day) && day > 0).sort((a, b) => a - b).filter((day) => waited >= day).length;
}

/**
 * A change sent to the client and not decided: after each of the firm's reminder days (Settings › Projects, default 3
 * and 7 days after it was sent) the client's decision-makers are reminded (portal + their message channel) and the
 * project manager is told. Once per change and round, from the daily run; a missed day sends the latest round only.
 * Until the reminder engine (plan §6.24a) takes it over through change-request-reminder-source.ts.
 */
export async function processChangeDecisions(db: Db, workspaceId: string) {
  const rows = (await db.query<{ id: string; projectId: string; caseId: string; number: number; title: string; currency: string; priceImpact: string; timeImpactDays: number;
    raisedBy: string | null; submittedBy: string | null; waited: number; days: number[] }>(
    `SELECT change.id, change.project_id AS "projectId", change.case_id AS "caseId", change.number, change.title, trim(change.currency) AS currency,
            change.price_impact::text AS "priceImpact", change.time_impact_days AS "timeImpactDays", change.raised_by AS "raisedBy", change.submitted_by AS "submittedBy",
            ((now() AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date
              - (change.sent_at AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date) AS waited,
            coalesce(settings.change_reminder_days, '{3,7}')::int[] AS days
       FROM change_requests change
       JOIN workspaces workspace ON workspace.id = change.workspace_id
       JOIN delivery_projects project ON project.workspace_id = change.workspace_id AND project.id = change.project_id AND project.status IN ('active', 'on_hold')
       LEFT JOIN workspace_project_settings settings ON settings.workspace_id = change.workspace_id
      WHERE change.workspace_id = $1 AND change.status = 'with_client' AND change.sent_at IS NOT NULL
      ORDER BY change.sent_at LIMIT 200`, [workspaceId])).rows;
  let sent = 0;
  for (const row of rows) {
    const round = changeReminderRound(row.waited, row.days);
    if (!round) continue;
    const told = await noticeProjectChangeReminder(db, workspaceId, { id: row.id, projectId: row.projectId, caseId: row.caseId, reference: changeReference(row.number), title: row.title,
      currency: row.currency, priceImpact: row.priceImpact, timeImpactDays: row.timeImpactDays, raisedBy: row.raisedBy, submittedBy: row.submittedBy }, round, row.waited);
    if (told.client || told.staff) {
      sent += 1;
      // Recorded once per round on the change's history (the notices themselves are keyed per round).
      await db.query(
        `INSERT INTO change_request_events (id, workspace_id, change_request_id, event, note)
         SELECT gen_random_uuid(), $1, $2, 'reminded', $3 WHERE NOT EXISTS (
           SELECT 1 FROM change_request_events WHERE workspace_id = $1 AND change_request_id = $2 AND event = 'reminded' AND note = $3)`,
        [workspaceId, row.id, `Round ${round}`]);
    }
  }
  return { sent };
}
