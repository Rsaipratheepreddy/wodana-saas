import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { tellClients } from "../client-portal/portal-notices";
import { notifyUserInApp } from "../notifications/default-templates";
import { weekEnd } from "../project-core/delivery-reminders";
import { readCalendar } from "../project-core/work-calendar";
import { clientEmailNote, composeClientView, joinList } from "./daily-progress";

type Db = Pick<PoolClient, "query">;

/** Reports older than this never go out by themselves, whatever the setting (a safety net for old days). */
const AUTO_SEND_WINDOW_DAYS = 14;

/** A report's day as the client's language writes it ("29 September 2026"). */
async function longDay(db: Db, workspaceId: string, day: string) {
  const locale = (await db.query<{ locale: string }>(`SELECT default_locale AS locale FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.locale ?? "en";
  try { return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`)); }
  catch { return day; }
}

/**
 * Sends a report's day to the client: its card is composed now and kept as the immutable `client_view`, its picked
 * photos are shared, and the client is told — in the portal, by WhatsApp (wd_update_published with the portal link)
 * and by the tenant's branded email, each where the client's contacts and preferences allow (DELIVERY_ALLOWLIST
 * applies to both). Once only: a report already sent is left as it is. Returns what went out.
 */
export async function publishReport(db: Db, workspaceId: string, input: { reportId: string; userId: string; automatic: boolean }) {
  const report = (await db.query<{ projectId: string; caseId: string; reportDate: string; delivery: string; status: string }>(
    `SELECT report.project_id AS "projectId", project.case_id AS "caseId", report.report_date::text AS "reportDate", report.delivery, report.status
       FROM site_reports report JOIN delivery_projects project ON project.workspace_id = report.workspace_id AND project.id = report.project_id
      WHERE report.workspace_id = $1 AND report.id = $2 FOR UPDATE OF report`, [workspaceId, input.reportId])).rows[0];
  if (!report || report.delivery === "sent") return null;
  const view = (await composeClientView(db, workspaceId, input.reportId))!;
  const photoIds = [...(view.hero ? [view.hero.id] : []), ...view.photos.map((photo) => photo.id)];
  await db.query(
    `UPDATE site_report_photos SET shared_at = coalesce(shared_at, now()), shared_by = coalesce(shared_by, $3::uuid) WHERE workspace_id = $1 AND report_id = $2 AND id = ANY($4::uuid[])`,
    [workspaceId, input.reportId, input.userId, photoIds]);
  await db.query(
    `UPDATE site_reports SET delivery = 'sent', sent_at = now(), sent_by = $3, sent_automatically = $4, client_view = $5::jsonb, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND id = $2`, [workspaceId, input.reportId, input.userId, input.automatic, JSON.stringify(view)]);
  const told = await tellClients(db, { workspaceId, caseId: report.caseId, event: "daily_progress", recordId: input.reportId,
    title: `Progress on ${await longDay(db, workspaceId, report.reportDate)}`, note: clientEmailNote(view) });
  return { projectId: report.projectId, photos: photoIds.length, told: { queued: told.queued, reason: told.reason ?? null, channel: "channel" in told ? told.channel : null } };
}

type Settings = { hours: number | null; pending: boolean; rollup: boolean; dueTime: string };

export async function readProgressSettings(db: Db, workspaceId: string): Promise<Settings> {
  const row = (await db.query<{ hours: number | null; pending: boolean; rollup: boolean; dueTime: string }>(
    `SELECT client_update_auto_send_hours AS hours, auto_send_pending_reports AS pending, weekly_rollup AS rollup, to_char(report_due_time, 'HH24:MI') AS "dueTime"
       FROM workspace_project_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
  return row ?? { hours: null, pending: false, rollup: false, dueTime: "18:00" };
}

async function projectLeads(db: Db, workspaceId: string, projectId: string) {
  return (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND assignment.is_manager`, [workspaceId, projectId])).rows.map((row) => row.userId);
}

/**
 * D-40 for daily progress, in the reminders pass (every 15 minutes). With Settings → Projects → Client updates →
 * "Send by itself" on (after N hours):
 *   • a report approved but not sent (approved without a send decision — never one kept internal) goes to the
 *     client N hours after its approval, on behalf of whoever approved it;
 *   • with "Also reports nobody reviewed" on, a submitted report nobody reviewed goes N hours after it was
 *     submitted, as the supervisor wrote it (it still waits for the manager's approval).
 * Only running projects, only days from the last two weeks. Audited as internal and automatic; the managers hear it went.
 */
export async function processDailyProgressAutoSend(db: Db, workspaceId: string) {
  const settings = await readProgressSettings(db, workspaceId);
  if (!settings.hours) return { sent: 0 };
  const due = (await db.query<{ id: string; projectId: string; title: string; reportDate: string; status: string; onBehalfOf: string }>(
    `SELECT report.id, report.project_id AS "projectId", project.reference || ' · ' || project.name AS title, report.report_date::text AS "reportDate", report.status,
            coalesce(report.decided_by, (SELECT membership.user_id FROM project_assignments assignment
                                           JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
                                          WHERE assignment.workspace_id = report.workspace_id AND assignment.project_id = report.project_id AND assignment.active AND assignment.is_manager
                                          ORDER BY membership.user_id LIMIT 1), report.author_id) AS "onBehalfOf"
       FROM site_reports report JOIN delivery_projects project ON project.workspace_id = report.workspace_id AND project.id = report.project_id
      WHERE report.workspace_id = $1 AND report.delivery = 'pending' AND project.status = 'active'
        AND ((report.status = 'approved' AND report.decided_at <= now() - make_interval(hours => $2::int) AND report.decided_at >= now() - make_interval(days => ${AUTO_SEND_WINDOW_DAYS}))
          OR ($3::boolean AND report.status = 'submitted' AND report.submitted_at <= now() - make_interval(hours => $2::int)
              AND report.submitted_at >= now() - make_interval(days => ${AUTO_SEND_WINDOW_DAYS})))
      ORDER BY report.report_date, report.created_at LIMIT 50`, [workspaceId, settings.hours, settings.pending])).rows;
  let sent = 0;
  for (const report of due) {
    const result = await publishReport(db, workspaceId, { reportId: report.id, userId: report.onBehalfOf, automatic: true });
    if (!result) continue;
    await recordAudit(db, { workspaceId, actorUserId: null, source: "internal", action: "site.report_auto_sent", entityType: "project", entityId: report.projectId,
      after: { projectId: report.projectId, reportId: report.id, automatic: true, afterHours: settings.hours, reviewed: report.status === "approved", onBehalfOf: report.onBehalfOf,
        photos: result.photos, told: result.told } });
    const day = await longDay(db, workspaceId, report.reportDate);
    for (const userId of await projectLeads(db, workspaceId, report.projectId))
      await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "site.report_sent", eventType: "site.report_sent",
        variables: { title: report.title, clientName: "", actor: "", note: report.status === "approved"
          ? `${day}: nobody sent it within ${settings.hours} h of its approval, so it went by itself.` : `${day}: nobody reviewed it within ${settings.hours} h, so it went by itself as written.` },
        deepLink: `/workspace/projects/${report.projectId}/site?report=${report.id}`, idempotencyKey: `site.report_sent:${report.id}:${userId}` });
    sent += 1;
  }
  return { sent };
}

/**
 * The weekly roll-up (Settings → Projects → Client updates → "Weekly roll-up", off by default): on the last working
 * day of the workspace's week, from its end-of-day time, each running project whose days went to the client that
 * week gets one digest — in the portal, by WhatsApp and by branded email. Once per project and week.
 */
export async function processWeeklyRollups(db: Db, workspaceId: string) {
  const settings = await readProgressSettings(db, workspaceId);
  if (!settings.rollup) return { sent: 0 };
  const clock = (await db.query<{ today: string; minutes: number }>(
    `SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today,
            (extract(hour FROM now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC')) * 60 + extract(minute FROM now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC')))::int AS minutes
       FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
  if (!clock) return { sent: 0 };
  const [hour, minute] = settings.dueTime.split(":").map(Number);
  if (new Date(`${clock.today}T00:00:00Z`).getUTCDay() !== weekEnd(await readCalendar(db, workspaceId)) || clock.minutes < hour * 60 + minute) return { sent: 0 };
  const from = new Date(Date.parse(`${clock.today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  const projects = (await db.query<{ id: string; caseId: string; name: string }>(
    `SELECT project.id, project.case_id AS "caseId", project.name FROM delivery_projects project
      WHERE project.workspace_id = $1 AND project.status = 'active'
        AND EXISTS (SELECT 1 FROM site_reports report WHERE report.workspace_id = project.workspace_id AND report.project_id = project.id AND report.delivery = 'sent'
                     AND report.client_hidden_at IS NULL AND report.report_date BETWEEN $2::date AND $3::date)
        AND NOT EXISTS (SELECT 1 FROM site_report_rollups rollup WHERE rollup.workspace_id = project.workspace_id AND rollup.project_id = project.id AND rollup.week_ending = $3::date)`,
    [workspaceId, from, clock.today])).rows;
  let sent = 0;
  for (const project of projects) {
    const days = (await db.query<{ view: { completed?: string[]; next?: string[]; project?: { progress?: number | null } } }>(
      `SELECT client_view AS view FROM site_reports WHERE workspace_id = $1 AND project_id = $2 AND delivery = 'sent' AND client_hidden_at IS NULL AND report_date BETWEEN $3::date AND $4::date ORDER BY report_date`,
      [workspaceId, project.id, from, clock.today])).rows.map((row) => row.view);
    const completed = [...new Set(days.flatMap((day) => day.completed ?? []))];
    const next = days.at(-1)?.next ?? [];
    const progress = days.at(-1)?.project?.progress ?? null;
    const digest = [
      `This week on ${project.name}: ${days.length} day${days.length === 1 ? "" : "s"} of progress${progress !== null ? `, now ${progress}% complete` : ""}.`,
      completed.length ? `Finished this week: ${joinList(completed.slice(0, 8))}.` : "",
      next.length ? `Coming up: ${joinList(next.slice(0, 4))}.` : "",
    ].filter(Boolean).join("\n\n");
    const id = randomUUID();
    const inserted = (await db.query(
      `INSERT INTO site_report_rollups (id, workspace_id, project_id, week_ending, report_count, digest) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workspace_id, project_id, week_ending) DO NOTHING`, [id, workspaceId, project.id, clock.today, days.length, digest.slice(0, 2000)])).rowCount;
    if (!inserted) continue;
    const told = await tellClients(db, { workspaceId, caseId: project.caseId, event: "weekly_rollup", recordId: `rollup:${id}`, title: `Week ending ${await longDay(db, workspaceId, clock.today)}`,
      note: digest });
    await recordAudit(db, { workspaceId, actorUserId: null, source: "internal", action: "site.weekly_rollup_sent", entityType: "project", entityId: project.id,
      after: { projectId: project.id, rollupId: id, weekEnding: clock.today, days: days.length, told: { queued: told.queued, reason: told.reason ?? null } } });
    sent += 1;
  }
  return { sent };
}
