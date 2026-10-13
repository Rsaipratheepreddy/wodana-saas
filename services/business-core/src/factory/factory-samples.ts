import type { PoolClient } from "pg";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-061: samples the design team asks the factory for (a veneer control sample before the client chooses materials).
 * A request is a task for the factory with the day it's needed: before the material selection appointment when one is
 * booked. The factory marks it ready and the person who asked (and the case's designer) hear it. It shows in the
 * Factory and on the case and its project.
 */
export const SAMPLE_STATUSES = ["requested", "ready", "cancelled"] as const;
export type SampleStatus = (typeof SAMPLE_STATUSES)[number];

export type SampleRequest = {
  id: string; number: number; caseId: string; caseReference: string | null; clientName: string; projectId: string | null; projectReference: string | null;
  title: string; note: string; dueOn: string; status: SampleStatus; requestedBy: string; requestedByName: string; requestedAt: string;
  readyNote: string; readyByName: string | null; readyAt: string | null; cancelReason: string; version: number;
  /** The day of the case's material selection appointment, when one is booked. */
  appointmentOn: string | null;
};

/** "SR-0007". */
export const sampleNumber = (number: number) => `SR-${String(number).padStart(4, "0")}`;

/** Why a due day can't be used: in the past, or not before a material selection appointment still to come. Null when it's fine. */
export function sampleDueProblem(dueOn: string, today: string, appointmentOn: string | null) {
  if (dueOn < today) return "The sample can't be due in the past.";
  if (appointmentOn && appointmentOn > today && dueOn >= appointmentOn) return `The sample is needed before the material selection on ${appointmentOn}.`;
  return null;
}

/** The day a new request is due by default: the day before the appointment still to come (today at the earliest), else a week from today. */
export function suggestedDue(today: string, appointmentOn: string | null) {
  const shift = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
  if (appointmentOn && appointmentOn > today) return shift(appointmentOn, -1) < today ? today : shift(appointmentOn, -1);
  return shift(today, 7);
}

const APPOINTMENT_DAY = (alias: string, caseColumn = "case_id") => `(SELECT (appointment.starts_at AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date::text
    FROM design_journey_stages stage
    JOIN crm_appointments appointment ON appointment.workspace_id = stage.workspace_id AND appointment.activity_id = stage.activity_id
    JOIN workspaces workspace ON workspace.id = stage.workspace_id
   WHERE stage.workspace_id = ${alias}.workspace_id AND stage.case_id = ${alias}.${caseColumn} AND stage.stage IN ('material_selection', 'samples')
     AND appointment.attendance_status <> 'cancelled' LIMIT 1)`;

/** The case's material selection appointment day (in the workspace's time zone), when one is booked. */
export async function appointmentDay(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ day: string | null }>(`SELECT ${APPOINTMENT_DAY("pre_case", "id")} AS day FROM pre_project_cases pre_case WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`,
    [workspaceId, caseId])).rows[0]?.day ?? null;
}

/** Requests, open first by the day they're due: one case's, or every one the factory has. */
export async function readSamples(db: Db, workspaceId: string, filter: { caseId?: string | null; id?: string } = {}): Promise<SampleRequest[]> {
  return (await db.query<SampleRequest>(
    `SELECT sample.id, sample.number, sample.case_id AS "caseId", opportunity.reference AS "caseReference", coalesce(party.display_name, opportunity.title) AS "clientName",
            project.id AS "projectId", project.reference AS "projectReference", sample.title, sample.note, sample.due_on::text AS "dueOn", sample.status,
            sample.requested_by AS "requestedBy", requester.display_name AS "requestedByName", sample.requested_at AS "requestedAt", sample.ready_note AS "readyNote",
            ready.display_name AS "readyByName", sample.ready_at AS "readyAt", sample.cancel_reason AS "cancelReason", sample.version,
            ${APPOINTMENT_DAY("sample")} AS "appointmentOn"
       FROM sample_requests sample
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = sample.workspace_id AND pre_case.id = sample.case_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN LATERAL (SELECT started.id, started.reference FROM delivery_projects started
                           WHERE started.workspace_id = sample.workspace_id AND started.case_id = sample.case_id AND started.started_at IS NOT NULL
                           ORDER BY started.started_at DESC LIMIT 1) project ON true
       JOIN users requester ON requester.id = sample.requested_by
       LEFT JOIN users ready ON ready.id = sample.ready_by
      WHERE sample.workspace_id = $1 AND ($2::uuid IS NULL OR sample.case_id = $2) AND ($3::uuid IS NULL OR sample.id = $3)
      ORDER BY sample.status = 'requested' DESC, sample.due_on, sample.number DESC LIMIT 300`,
    [workspaceId, filter.caseId ?? null, filter.id ?? null])).rows;
}

/** What the sample is for, in a notice: the project's number or the case's, and the client. */
export const sampleFor = (sample: Pick<SampleRequest, "projectReference" | "caseReference" | "clientName">) =>
  [sample.projectReference ?? sample.caseReference, sample.clientName].filter(Boolean).join(" · ");

/** The people who make samples: whoever runs the factory, and the factory lead on the case or its project. */
export async function sampleMakers(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles effective_role ON effective_role.membership_id = membership.id
       JOIN role_permissions granted ON granted.role_id = effective_role.role_id
       JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = 'factory.manage'
      WHERE membership.workspace_id = $1 AND membership.status = 'active'
     UNION
     SELECT DISTINCT membership.user_id FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.active AND 'factory_lead' = ANY(assignment.role_keys)
        AND (assignment.case_id = $2 OR assignment.project_id IN (SELECT id FROM delivery_projects WHERE workspace_id = $1 AND case_id = $2))`,
    [workspaceId, caseId])).rows.map((row) => row.userId);
}

/** The people who hear it's ready: whoever asked, and the case's designer (the dedicated designer, or the designer named on the case or its project). */
export async function sampleDesigners(db: Db, workspaceId: string, caseId: string, requestedBy: string) {
  const designers = (await db.query<{ userId: string }>(
    `SELECT membership.user_id AS "userId" FROM pre_project_cases pre_case
       JOIN crm_opportunity_designer designer ON designer.workspace_id = pre_case.workspace_id AND designer.opportunity_id = pre_case.opportunity_id
       JOIN workspace_memberships membership ON membership.workspace_id = designer.workspace_id AND membership.id = designer.membership_id AND membership.status = 'active'
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2
     UNION
     SELECT membership.user_id FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.active AND 'designer' = ANY(assignment.role_keys)
        AND (assignment.case_id = $2 OR assignment.project_id IN (SELECT id FROM delivery_projects WHERE workspace_id = $1 AND case_id = $2))`,
    [workspaceId, caseId])).rows.map((row) => row.userId);
  return [...new Set([requestedBy, ...designers])];
}

/** Tells people about a sample (in the app, and by email unless it's only a reminder). Never the person who acted; once per key and person. */
export async function tellSample(db: Db, input: {
  workspaceId: string; code: "factory.sample_requested" | "factory.sample_ready" | "factory.sample_due"; sample: SampleRequest; users: string[]; actorUserId: string | null;
  key: string; note?: string; email: boolean; deepLink: string; date: string;
}) {
  const actor = input.actorUserId ? (await db.query<{ name: string }>(`SELECT display_name AS name FROM users WHERE id = $1`, [input.actorUserId])).rows[0]?.name ?? "" : "";
  const variables = { sample: `${sampleNumber(input.sample.number)} ${input.sample.title}`, project: sampleFor(input.sample), date: input.date, actor, note: input.note ?? "" };
  let sent = 0;
  for (const userId of new Set(input.users.filter((id) => id !== input.actorUserId))) {
    const message = { workspaceId: input.workspaceId, recipientUserId: userId, code: input.code, eventType: input.code, variables, deepLink: input.deepLink };
    const result = await notifyUserInApp(db, { ...message, idempotencyKey: `${input.code}:${input.key}:${userId}` });
    if (input.email) await queueUserEmail(db, { ...message, idempotencyKey: `${input.code}:${input.key}:${userId}:email` });
    if (result.queued) sent += 1;
  }
  return sent;
}

/** Days the way the workspace writes them. */
export async function workspaceDayText(db: Db, workspaceId: string, day: string) {
  const locale = (await db.query<{ locale: string | null }>(`SELECT default_locale AS locale FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.locale || "en";
  try { return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${day}T00:00:00Z`)); } catch { return day; }
}

/** The daily run: a sample due today (or late) and still not ready reminds the factory once. */
export async function remindSamplesDue(db: Db, workspaceId: string, today: string) {
  const due = (await db.query<{ id: string }>(
    `SELECT id FROM sample_requests WHERE workspace_id = $1 AND status = 'requested' AND due_on <= $2::date AND due_notified_on IS NULL FOR UPDATE`, [workspaceId, today])).rows;
  let sent = 0;
  for (const row of due) {
    const [sample] = await readSamples(db, workspaceId, { id: row.id });
    if (!sample) continue;
    sent += await tellSample(db, { workspaceId, code: "factory.sample_due", sample, users: await sampleMakers(db, workspaceId, sample.caseId), actorUserId: null, key: sample.id,
      email: false, deepLink: `/workspace/factory/samples?sample=${sample.id}`, date: await workspaceDayText(db, workspaceId, sample.dueOn) });
    await db.query(`UPDATE sample_requests SET due_notified_on = $3 WHERE workspace_id = $1 AND id = $2`, [workspaceId, row.id, today]);
  }
  return sent;
}
