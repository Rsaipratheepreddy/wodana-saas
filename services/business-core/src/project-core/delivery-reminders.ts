import type { PoolClient } from "pg";
import { tellClients } from "../client-portal/portal-notices";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { readProject } from "./project-core.store";
import { readMilestones } from "./project-milestones";
import { readSignals } from "./project-signals";
import { noticeStageReady } from "./project-stage-watch";
import { readCalendar, workdays, type WorkCalendar } from "./work-calendar";

type Db = Pick<PoolClient, "query">;

/** Working days a material list waits with the client before the first reminder, and between reminders after. */
const MATERIALS_FIRST = 3;
const MATERIALS_EVERY = 5;
/** Milestones due within this many days (or past) and not invoiced are sent to the people who invoice, and the project manager. */
const MILESTONE_AHEAD = 3;

type Clock = { today: string; locale: string; calendar: WorkCalendar };

async function clock(db: Db, workspaceId: string): Promise<Clock | null> {
  const row = (await db.query<{ today: string; locale: string }>(
    `SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today, coalesce(default_locale, 'en') AS locale FROM workspaces WHERE id = $1`,
    [workspaceId])).rows[0];
  return row ? { ...row, calendar: await readCalendar(db, workspaceId) } : null;
}

async function running(db: Db, workspaceId: string) {
  return (await db.query<{ id: string }>(`SELECT id FROM delivery_projects WHERE workspace_id = $1 AND status = 'active' AND started_at IS NOT NULL ORDER BY reference`, [workspaceId])).rows
    .map((row) => row.id);
}

/** The people on a project: its managers, and (when asked) the account manager. */
async function people(db: Db, workspaceId: string, projectId: string, accountManager: boolean) {
  return (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND (assignment.is_manager OR ($3 AND 'account_manager' = ANY(assignment.role_keys)))`,
    [workspaceId, projectId, accountManager])).rows.map((row) => row.userId);
}

/** The last working day of the workspace's week (Friday for Monday–Friday, Thursday for Sunday–Thursday). */
export function weekEnd(calendar: WorkCalendar) {
  const days = new Set(calendar.workingDays.length ? calendar.workingDays : [1, 2, 3, 4, 5]);
  const rest = [0, 1, 2, 3, 4, 5, 6].find((day) => !days.has(day));
  if (rest === undefined) return 5;
  for (let back = 1; back <= 7; back++) { const day = (rest - back + 7) % 7; if (days.has(day)) return day; }
  return 5;
}

/**
 * The week on each running project, on the last working day of the workspace's week: open work, what's late or
 * blocked, open snags, orders late and site reports missing, read from the records. The project manager hears
 * it in the app and by email, once a week.
 */
export async function processWeeklySummaries(db: Db, workspaceId: string) {
  const now = await clock(db, workspaceId);
  if (!now || new Date(`${now.today}T00:00:00Z`).getUTCDay() !== weekEnd(now.calendar)) return { sent: 0 };
  let sent = 0;
  for (const projectId of await running(db, workspaceId)) {
    const project = await readProject(db, workspaceId, projectId);
    if (!project) continue;
    const signals = await readSignals(db, workspaceId, project);
    const parts = [
      `${signals.work.open} open`,
      signals.work.late ? `${signals.work.late} late` : "",
      signals.work.blocked ? `${signals.work.blocked} blocked` : "",
      signals.work.openSnags ? `${signals.work.openSnags} snag${signals.work.openSnags === 1 ? "" : "s"} open` : "",
      signals.lateOrders.length ? `${signals.lateOrders.length} order${signals.lateOrders.length === 1 ? "" : "s"} late` : "",
      signals.reportsMissing.length ? `${signals.reportsMissing.length} site report${signals.reportsMissing.length === 1 ? "" : "s"} missing` : "",
      signals.decisions.length ? `${signals.decisions.length} waiting on the client` : "",
    ].filter(Boolean);
    const note = signals.work.late || signals.work.blocked || signals.lateOrders.length || signals.reportsMissing.length ? parts.join(" · ") : `${parts.join(" · ")} · nothing late`;
    for (const userId of await people(db, workspaceId, projectId, false)) {
      const message = { workspaceId, recipientUserId: userId, code: "project.weekly_summary", eventType: "project.weekly_summary",
        variables: { title: `${project.reference} · ${project.name}`, clientName: project.clientName, actor: "", note }, deepLink: `/workspace/projects/${projectId}` };
      const key = `project.weekly_summary:${projectId}:${now.today}:${userId}`;
      const result = await notifyUserInApp(db, { ...message, idempotencyKey: key });
      await queueUserEmail(db, { ...message, idempotencyKey: `${key}:email` });
      if (result.queued) sent += 1;
    }
  }
  return { sent };
}

/** Stages whose checks became true through another module (orders, the factory, the portal): their owners hear they can finish. */
export async function processStagesReady(db: Db, workspaceId: string) {
  let sent = 0;
  for (const projectId of await running(db, workspaceId)) sent += await noticeStageReady(db, workspaceId, projectId, null);
  return { sent };
}

/**
 * A material list left with the client: after 3 working days its decision-makers are reminded in the portal (and by
 * WhatsApp or email), and the account manager and project manager hear how long it has waited; again every 5
 * working days while it stays unanswered.
 */
export async function processMaterialsWaiting(db: Db, workspaceId: string) {
  const now = await clock(db, workspaceId);
  if (!now) return { sent: 0 };
  const math = workdays(now.calendar);
  const lists = (await db.query<{ projectId: string; caseId: string; title: string; number: number; sentOn: string }>(
    `SELECT project.id AS "projectId", project.case_id AS "caseId", project.reference || ' · ' || project.name AS title, revision.number,
            (revision.sent_at AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date::text AS "sentOn"
       FROM project_material_revisions revision
       JOIN delivery_projects project ON project.workspace_id = revision.workspace_id AND project.id = revision.project_id
       JOIN workspaces workspace ON workspace.id = revision.workspace_id
      WHERE revision.workspace_id = $1 AND revision.status = 'sent' AND project.status = 'active'
        AND revision.number = (SELECT max(latest.number) FROM project_material_revisions latest WHERE latest.workspace_id = revision.workspace_id AND latest.project_id = revision.project_id)`,
    [workspaceId])).rows;
  let sent = 0;
  for (const list of lists) {
    let waited = 0;
    for (let day = math.next(list.sentOn); day <= now.today && waited < 400; day = math.next(day)) waited += 1;
    if (waited < MATERIALS_FIRST) continue;
    const round = Math.floor((waited - MATERIALS_FIRST) / MATERIALS_EVERY);
    await tellClients(db, { workspaceId, caseId: list.caseId, event: "decision_waiting", recordId: `materials:${list.projectId}:${list.number}:reminder:${round}`, title: `Material list R${list.number}` });
    const note = `R${list.number} has been with the client for ${waited} working day${waited === 1 ? "" : "s"}.`;
    for (const userId of await people(db, workspaceId, list.projectId, true)) {
      const result = await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "project.materials_waiting", eventType: "project.materials_waiting",
        variables: { title: list.title, clientName: "", actor: "", note }, deepLink: `/workspace/projects/${list.projectId}/scope?view=materials`,
        idempotencyKey: `project.materials_waiting:${list.projectId}:${list.number}:${round}:${userId}` });
      if (result.queued) sent += 1;
    }
  }
  return { sent };
}

/**
 * Milestones falling due (within 3 days, or past) that nobody has invoiced: the people who keep receivables and the
 * project manager hear once per milestone and due date.
 */
export async function processMilestonesDue(db: Db, workspaceId: string) {
  const now = await clock(db, workspaceId);
  if (!now) return { sent: 0 };
  const horizon = new Date(Date.parse(`${now.today}T00:00:00Z`) + MILESTONE_AHEAD * 86_400_000).toISOString().slice(0, 10);
  const finance = (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = effective_role.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'receivables.manage'
      WHERE membership.workspace_id = $1 AND membership.status = 'active'`, [workspaceId])).rows.map((row) => row.userId);
  let sent = 0;
  for (const projectId of await running(db, workspaceId)) {
    const project = await readProject(db, workspaceId, projectId);
    if (!project) continue;
    const due = (await readMilestones(db, workspaceId, project)).milestones.filter((milestone) => milestone.state === "to_invoice" && milestone.dueDate && milestone.dueDate <= horizon);
    if (!due.length) continue;
    const recipients = [...new Set([...finance, ...(await people(db, workspaceId, projectId, false))])];
    for (const milestone of due) {
      const note = `${milestone.title}: ${milestone.currency} ${milestone.amount}, ${milestone.dueDate! < now.today ? "was due" : "due"} ${milestone.dueDate}.`;
      for (const userId of recipients) {
        const result = await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "project.milestone_due", eventType: "project.milestone_due",
          variables: { title: `${project.reference} · ${project.name}`, clientName: project.clientName, actor: "", note }, deepLink: `/workspace/projects/${projectId}/money?view=client`,
          idempotencyKey: `project.milestone_due:${milestone.id}:${milestone.dueDate}:${userId}` });
        if (result.queued) sent += 1;
      }
    }
  }
  return { sent };
}
