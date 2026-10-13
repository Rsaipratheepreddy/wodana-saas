import type { PoolClient } from "pg";
import type { JourneyStage, JourneyTask } from "../design/design-journey.domain";
import { formatDay } from "../design/design-journey.store";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { INSTALLATION_ROLE, installationRoles, readInstallation } from "../project-core/project-installation";
import type { StageCheck } from "../project-core/project-checks";
import { permitStatus, readSlots } from "../logistics/logistics.store";
import { workspaceClock, type Clock } from "./workspace-clock";
import { ALERT_LOOKBACK_DAYS, BOOKING_LABEL, plusDays, type BookingKind, type Team, type TeamEntry } from "./team-calendars.domain";

type Db = Pick<PoolClient, "query">;

const caseLink = (caseId: string, section = "overview") => `/workspace/pre-projects/cases/${caseId}/${section}`;

/**
 * One source of the design calendar: a kind of record read for [from, to) as entries. PLM-152: the calendar is the
 * sources listed in DESIGN_CALENDAR_SOURCES, so a new kind of design work (factory inspections) is one more source here.
 */
export type DesignCalendarSource = (db: Db, workspaceId: string, from: string, to: string, clock: Clock) => Promise<TeamEntry[]>;

const clientOf = `LEFT JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id`;

/** Render and 2D time booked by the designers (PLM-090). */
const renderBookings: DesignCalendarSource = async (db, workspaceId, from, to, clock) => {
  const rows = (await db.query<{ id: string; caseId: string; kind: BookingKind; note: string; startsOn: string; dueOn: string; days: number; status: string; version: number; assigneeName: string | null; clientName: string }>(
    `SELECT booking.id, booking.case_id AS "caseId", booking.kind, booking.note, booking.starts_on::text AS "startsOn", booking.due_on::text AS "dueOn", booking.days,
            booking.status, booking.version, person.display_name AS "assigneeName", coalesce(party.display_name, opportunity.title, '') AS "clientName"
       FROM design_work_bookings booking
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = booking.workspace_id AND pre_case.id = booking.case_id
       ${clientOf}
       LEFT JOIN workspace_memberships member ON member.workspace_id = booking.workspace_id AND member.id = booking.assignee_membership_id
       LEFT JOIN users person ON person.id = member.user_id
      WHERE booking.workspace_id = $1 AND booking.status <> 'cancelled' AND booking.starts_on < $3::date AND booking.due_on >= $2::date
      ORDER BY booking.starts_on, booking.id`, [workspaceId, from, to])).rows;
  return rows.map((row) => ({
    key: `booking:${row.id}`, kind: row.kind, recordId: row.id, subject: row.clientName, detail: row.note || null, start: row.startsOn, end: row.dueOn, allDay: true,
    days: Number(row.days), status: row.status, overdue: row.status === "booked" && row.dueOn < clock.today, ownerName: row.assigneeName, href: caseLink(row.caseId), version: Number(row.version),
  }));
};

/** The deadline of each design step in progress (kick-offs, concepts, renders, samples…), with its owner. */
const stageDeadlines: DesignCalendarSource = async (db, workspaceId, from, to, clock) => {
  const rows = (await db.query<{ caseId: string; stage: JourneyStage; dueOn: string; overdue: boolean; ownerName: string | null; clientName: string }>(
    `SELECT stage.case_id AS "caseId", stage.stage, to_char(stage.due_at AT TIME ZONE $4, 'YYYY-MM-DD') AS "dueOn", stage.due_at < now() AS overdue,
            person.display_name AS "ownerName", coalesce(party.display_name, opportunity.title, '') AS "clientName"
       FROM design_journey_stages stage
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = stage.workspace_id AND pre_case.id = stage.case_id
       ${clientOf}
       LEFT JOIN workspace_memberships member ON member.workspace_id = stage.workspace_id AND member.id = stage.owner_membership_id
       LEFT JOIN users person ON person.id = member.user_id
      WHERE stage.workspace_id = $1 AND stage.status = 'active' AND stage.due_at IS NOT NULL
        AND (stage.due_at AT TIME ZONE $4)::date >= $2::date AND (stage.due_at AT TIME ZONE $4)::date < $3::date
      ORDER BY stage.due_at, stage.case_id`, [workspaceId, from, to, clock.timeZone])).rows;
  return rows.map((row) => ({
    key: `deadline:${row.caseId}:${row.stage}`, kind: "design_deadline", recordId: row.caseId, subject: row.clientName, detail: row.stage, start: row.dueOn, end: row.dueOn, allDay: true,
    days: null, status: "active", overdue: row.overdue, ownerName: row.ownerName, href: caseLink(row.caseId),
  }));
};

/** PLM-152: the work inside a step with its own deadline (the design site measure, the sample collection, the team to allocate). */
const taskDeadlines: DesignCalendarSource = async (db, workspaceId, from, to, clock) => {
  const rows = (await db.query<{ caseId: string; task: JourneyTask; dueOn: string; overdue: boolean; ownerName: string | null; clientName: string }>(
    `SELECT task.case_id AS "caseId", task.task, to_char(task.due_at AT TIME ZONE $4, 'YYYY-MM-DD') AS "dueOn", task.due_at < now() AS overdue,
            person.display_name AS "ownerName", coalesce(party.display_name, opportunity.title, '') AS "clientName"
       FROM design_journey_tasks task
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = task.workspace_id AND pre_case.id = task.case_id
       ${clientOf}
       LEFT JOIN workspace_memberships member ON member.workspace_id = task.workspace_id AND member.id = task.owner_membership_id
       LEFT JOIN users person ON person.id = member.user_id
      WHERE task.workspace_id = $1 AND task.status = 'open' AND task.due_at IS NOT NULL
        AND (task.due_at AT TIME ZONE $4)::date >= $2::date AND (task.due_at AT TIME ZONE $4)::date < $3::date
      ORDER BY task.due_at, task.case_id`, [workspaceId, from, to, clock.timeZone])).rows;
  return rows.map((row) => ({
    key: `task:${row.caseId}:${row.task}`, kind: "design_deadline", recordId: row.caseId, subject: row.clientName, detail: row.task, start: row.dueOn, end: row.dueOn, allDay: true,
    days: null, status: "active", overdue: row.overdue, ownerName: row.ownerName, href: caseLink(row.caseId, row.task === "site_measure" ? "site" : "overview"),
  }));
};

/**
 * Appointments on a job with a design journey kept by its designer or a design-step owner: kick-offs, site visits and
 * site measures, sample meetings and the material selection appointment, presentations booked as meetings.
 */
const designAppointments: DesignCalendarSource = async (db, workspaceId, from, to, clock) => {
  const rows = (await db.query<{ activityId: string; caseId: string; title: string; status: string; startsAt: Date; endsAt: Date; ownerName: string | null; clientName: string }>(
    `SELECT activity.id AS "activityId", pre_case.id AS "caseId", activity.title, activity.status::text AS status, appointment.starts_at AS "startsAt", appointment.ends_at AS "endsAt",
            person.display_name AS "ownerName", coalesce(party.display_name, opportunity.title, '') AS "clientName"
       FROM crm_appointments appointment
       JOIN crm_activities activity ON activity.workspace_id = appointment.workspace_id AND activity.id = appointment.activity_id
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = activity.workspace_id AND pre_case.opportunity_id = activity.opportunity_id
       JOIN design_journeys journey ON journey.workspace_id = pre_case.workspace_id AND journey.case_id = pre_case.id
       ${clientOf}
       LEFT JOIN workspace_memberships member ON member.workspace_id = activity.workspace_id AND member.id = activity.owner_membership_id
       LEFT JOIN users person ON person.id = member.user_id
      WHERE appointment.workspace_id = $1 AND activity.status <> 'cancelled'
        AND appointment.starts_at < ($3::date::timestamp AT TIME ZONE $4) AND appointment.ends_at > ($2::date::timestamp AT TIME ZONE $4)
        AND (EXISTS (SELECT 1 FROM design_journey_stages stage WHERE stage.workspace_id = activity.workspace_id AND stage.case_id = pre_case.id
                      AND (stage.activity_id = activity.id OR stage.owner_membership_id = activity.owner_membership_id))
             OR EXISTS (SELECT 1 FROM design_journey_tasks task WHERE task.workspace_id = activity.workspace_id AND task.case_id = pre_case.id AND task.activity_id = activity.id)
             OR EXISTS (SELECT 1 FROM crm_opportunity_designer designer WHERE designer.workspace_id = activity.workspace_id AND designer.opportunity_id = activity.opportunity_id
                      AND designer.membership_id = activity.owner_membership_id))
      ORDER BY appointment.starts_at, activity.id`, [workspaceId, from, to, clock.timeZone])).rows;
  return rows.map((row) => ({
    key: `appointment:${row.activityId}`, kind: "appointment", recordId: row.activityId, subject: row.clientName, detail: row.title, start: new Date(row.startsAt).toISOString(),
    end: new Date(row.endsAt).toISOString(), allDay: false, days: null, status: row.status, overdue: false, ownerName: row.ownerName, href: caseLink(row.caseId),
  }));
};

/** Rounds shown to clients (concepts, renders), at the time they were presented. */
const designPresentations: DesignCalendarSource = async (db, workspaceId, from, to, clock) => {
  const rows = (await db.query<{ id: string; caseId: string; stage: JourneyStage; round: number; status: string; presentedAt: Date; ownerName: string | null; clientName: string }>(
    `SELECT presentation.id, presentation.case_id AS "caseId", presentation.stage, presentation.round, presentation.status, presentation.presented_at AS "presentedAt",
            person.display_name AS "ownerName", coalesce(party.display_name, opportunity.title, '') AS "clientName"
       FROM design_presentations presentation
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = presentation.workspace_id AND pre_case.id = presentation.case_id
       ${clientOf}
       LEFT JOIN users person ON person.id = presentation.presented_by
      WHERE presentation.workspace_id = $1 AND presentation.status NOT IN ('draft', 'withdrawn') AND presentation.presented_at IS NOT NULL
        AND presentation.presented_at >= ($2::date::timestamp AT TIME ZONE $4) AND presentation.presented_at < ($3::date::timestamp AT TIME ZONE $4)
      ORDER BY presentation.presented_at, presentation.id`, [workspaceId, from, to, clock.timeZone])).rows;
  return rows.map((row) => {
    const start = new Date(row.presentedAt);
    return {
      key: `presentation:${row.id}`, kind: "presentation" as const, recordId: row.id, subject: row.clientName, detail: `${row.stage}:${row.round}`, start: start.toISOString(),
      end: new Date(start.getTime() + 30 * 60_000).toISOString(), allDay: false, days: null, status: row.status, overdue: false, ownerName: row.ownerName, href: caseLink(row.caseId, "designs"),
    };
  });
};

/** The design calendar's sources, in the order their entries are listed. */
export const DESIGN_CALENDAR_SOURCES: readonly DesignCalendarSource[] = [renderBookings, stageDeadlines, taskDeadlines, designAppointments, designPresentations];

/**
 * The design team's calendar for [from, to) (PLM-090, PLM-152): who is working on what and every deadline — render and 2D
 * time, kick-offs, concepts, renders, site measures, samples and sample meetings — with what is overdue. One view for the
 * lead designer; there is no separate director view.
 */
export async function readDesignEntries(db: Db, workspaceId: string, from: string, to: string, clock: Clock, sources: readonly DesignCalendarSource[] = DESIGN_CALENDAR_SOURCES): Promise<TeamEntry[]> {
  const entries: TeamEntry[] = [];
  for (const source of sources) entries.push(...await source(db, workspaceId, from, to, clock));
  return entries;
}

const OPEN_ORDER = ["planned", "released", "in_production", "on_hold"];

/**
 * The factory and logistics calendar for [from, to): work orders on their planned days, factory slots, deliveries,
 * installations and planned building-permit collections, each with who goes on it (HRMS workers by name, the vehicle
 * and the driver).
 */
export async function readLogisticsEntries(db: Db, workspaceId: string, from: string, to: string, clock: Clock): Promise<TeamEntry[]> {
  const entries: TeamEntry[] = [];
  const orders = (await db.query<{ id: string; number: number; title: string; status: string; startOn: string; endOn: string; projectId: string; project: string; ownerName: string | null }>(
    `SELECT wo.id, wo.number, wo.title, wo.status, coalesce(wo.planned_start, wo.planned_end)::text AS "startOn", coalesce(wo.planned_end, wo.planned_start)::text AS "endOn",
            wo.project_id AS "projectId", concat_ws(' · ', nullif(project.reference, ''), project.name) AS project, center.name AS "ownerName"
       FROM work_orders wo
       JOIN delivery_projects project ON project.workspace_id = wo.workspace_id AND project.id = wo.project_id
       LEFT JOIN workcenters center ON center.workspace_id = wo.workspace_id AND center.id = wo.workcenter_id
      WHERE wo.workspace_id = $1 AND wo.status NOT IN ('cancelled', 'short_closed') AND coalesce(wo.planned_start, wo.planned_end) IS NOT NULL
        AND coalesce(wo.planned_start, wo.planned_end) < $3::date AND coalesce(wo.planned_end, wo.planned_start) >= $2::date
      ORDER BY coalesce(wo.planned_start, wo.planned_end), wo.number`, [workspaceId, from, to])).rows;
  for (const row of orders) entries.push({
    key: `work-order:${row.id}`, kind: "production", recordId: row.id, subject: row.project, detail: `WO-${String(row.number).padStart(4, "0")} ${row.title}`,
    start: row.startOn, end: row.endOn, allDay: true, days: null, status: row.status, overdue: OPEN_ORDER.includes(row.status) && row.endOn < clock.today,
    ownerName: row.ownerName, href: `/workspace/factory/orders?order=${row.id}`,
  });
  const projects = (await db.query<{ id: string; project: string; deliveryOn: string | null; installationOn: string | null; slotOn: string | null; status: string }>(
    `SELECT project.id, concat_ws(' · ', nullif(project.reference, ''), project.name) AS project, project.delivery_on::text AS "deliveryOn",
            project.installation_on::text AS "installationOn", project.factory_slot_on::text AS "slotOn", project.status
       FROM delivery_projects project
      WHERE project.workspace_id = $1 AND project.status IN ('active', 'on_hold', 'completed')
        AND ((project.delivery_on >= $2::date AND project.delivery_on < $3::date) OR (project.installation_on >= $2::date AND project.installation_on < $3::date)
          OR (project.factory_slot_on >= $2::date AND project.factory_slot_on < $3::date))
      ORDER BY project.reference, project.id`, [workspaceId, from, to])).rows;
  const inRange = (day: string | null) => Boolean(day && day >= from && day < to);
  for (const project of projects) {
    // Late is read from the records (goods arrived, installation signed off) only for days already past.
    const past = [project.deliveryOn, project.installationOn].some((day) => day && day < clock.today);
    const installation = past && project.status !== "completed" ? await readInstallation(db, workspaceId, project.id) : null;
    const href = `/workspace/projects/${project.id}`;
    if (inRange(project.slotOn)) entries.push({ key: `factory-slot:${project.id}`, kind: "factory_slot", recordId: project.id, subject: project.project, detail: null,
      start: project.slotOn!, end: project.slotOn, allDay: true, days: null, status: project.status, overdue: false, ownerName: null, href });
    if (inRange(project.deliveryOn)) entries.push({ key: `delivery:${project.id}`, kind: "delivery", recordId: project.id, subject: project.project, detail: null,
      start: project.deliveryOn!, end: project.deliveryOn, allDay: true, days: null, status: installation?.delivery ?? (project.status === "completed" ? "delivered" : "booked"),
      overdue: Boolean(installation && installation.delivery !== "delivered" && project.deliveryOn! < clock.today), ownerName: null, href });
    if (inRange(project.installationOn)) entries.push({ key: `installation:${project.id}`, kind: "installation", recordId: project.id, subject: project.project, detail: null,
      start: project.installationOn!, end: project.installationOn, allDay: true, days: null, status: installation?.installation ?? (project.status === "completed" ? "done" : "not_started"),
      overdue: Boolean(installation?.late), ownerName: null, href });
  }
  // Who goes on each booking (PLM-135), the planned permit collections, deals delivered without a project, and whether
  // each delivery and installation has its building permit (PLM-136).
  const slots = await readSlots(db, workspaceId, from, to);
  const dealHref = (id: string) => `/workspace/crm/opportunities?record=${id}`;
  for (const slot of slots.filter((item) => item.kind === "permit")) entries.push({ key: slot.key, kind: "permit", recordId: slot.permitId!, subject: slot.project, detail: null,
    start: slot.start, end: slot.end, allDay: true, days: null, status: "planned", overdue: slot.start < clock.today, ownerName: null,
    href: slot.projectId ? `/workspace/projects/${slot.projectId}` : dealHref(slot.opportunityId!) });
  for (const slot of slots.filter((item) => item.kind === "delivery" && !item.projectId)) entries.push({ key: slot.key, kind: "delivery", recordId: slot.opportunityId!, subject: slot.project,
    detail: null, start: slot.start, end: slot.end, allDay: true, days: null, status: slot.status, overdue: slot.status !== "delivered" && slot.start < clock.today, ownerName: null,
    href: dealHref(slot.opportunityId!) });
  const bySlot = new Map(slots.map((slot) => [slot.key, slot]));
  for (const entry of entries) {
    const slot = bySlot.get(entry.key);
    if (!slot) continue;
    entry.projectId = slot.projectId ?? undefined; entry.opportunityId = slot.opportunityId ?? undefined; entry.workOrderId = slot.workOrderId; entry.permitId = slot.permitId;
    entry.crew = { people: slot.people, crew: slot.crew, vehicle: slot.vehicle, driver: slot.driver, note: slot.note, version: slot.version };
    // The lead names the entry when nobody else does (a work order's workcenter stays its owner).
    entry.ownerName ??= slot.people.find((person) => person.lead)?.name ?? null;
    if ((entry.kind === "delivery" || entry.kind === "installation") && !["delivered", "done", "completed"].includes(entry.status)) {
      const status = await permitStatus(db, workspaceId, slot.projectId ? { projectId: slot.projectId } : { opportunityId: slot.opportunityId! }, slot.start);
      if (status.required) entry.permit = { covered: status.covered, validTo: status.validTo };
    }
  }
  return entries;
}

export function readEntries(db: Db, workspaceId: string, team: Team, from: string, to: string, clock: Clock) {
  return team === "design" ? readDesignEntries(db, workspaceId, from, to, clock) : readLogisticsEntries(db, workspaceId, from, to, clock);
}

export type TeamTarget = { connectionId: string | null; calendarId: string | null; version: number };

export async function readTargets(db: Db, workspaceId: string): Promise<Record<Team, TeamTarget>> {
  const rows = (await db.query<{ team: Team; connectionId: string | null; calendarId: string | null; version: number }>(
    `SELECT team, connection_id AS "connectionId", calendar_id AS "calendarId", version FROM workspace_team_calendars WHERE workspace_id = $1`, [workspaceId])).rows;
  const of = (team: Team) => { const row = rows.find((item) => item.team === team); return { connectionId: row?.connectionId ?? null, calendarId: row?.connectionId ? row.calendarId : null, version: row?.version ?? 0 }; };
  return { design: of("design"), logistics: of("logistics") };
}

export async function bookingDefaults(db: Db, workspaceId: string) {
  const row = (await db.query<{ renderDays: number; drawingDays: number; visualiserRoleCode: string | null; version: number }>(
    `SELECT render_days AS "renderDays", drawing_days AS "drawingDays", visualiser_role_code AS "visualiserRoleCode", version FROM workspace_design_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
  return { renderDays: Number(row?.renderDays ?? 5), drawingDays: Number(row?.drawingDays ?? 3), visualiserRoleCode: row?.visualiserRoleCode ?? "visualiser", version: Number(row?.version ?? 0) };
}

async function usersOf(db: Db, workspaceId: string, memberships: Array<string | null | undefined>) {
  const ids = [...new Set(memberships.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return [];
  return (await db.query<{ userId: string }>(`SELECT DISTINCT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active' ORDER BY 1`,
    [workspaceId, ids])).rows.map((row) => row.userId);
}

/** The people on a project in these roles (and its managers). */
async function projectPeople(db: Db, workspaceId: string, projectId: string, roles: string[]) {
  return (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND (assignment.is_manager OR assignment.role_keys && $3::varchar[])
      ORDER BY 1`, [workspaceId, projectId, roles])).rows.map((row) => row.userId);
}

/** People holding a permission (the factory, when a project names nobody to tell). */
async function permitted(db: Db, workspaceId: string, code: string) {
  return (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles assigned ON assigned.membership_id = membership.id AND assigned.workspace_id = membership.workspace_id
       JOIN role_permissions granted ON granted.role_id = assigned.role_id JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = $2
      WHERE membership.workspace_id = $1 AND membership.status = 'active' ORDER BY 1`, [workspaceId, code])).rows.map((row) => row.userId);
}

async function tell(db: Db, workspaceId: string, users: string[], code: string, variables: Record<string, string>, deepLink: string, key: string) {
  let sent = 0;
  for (const userId of users) {
    const result = await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink, idempotencyKey: `${key}:${userId}` });
    await queueUserEmail(db, { workspaceId, recipientUserId: userId, code, eventType: code, variables, deepLink, idempotencyKey: `${key}:${userId}:email` });
    if (result.queued) sent++;
  }
  return sent;
}

/**
 * The daily pass for one workspace (inside its tenant transaction). Render and 2D time past its day tells the designer
 * who booked it, the case's designer and its owner, once per due day. Production past its planned end tells the
 * project's managers and factory lead (else the factory); a delivery or installation past its day and not done tells
 * the project's managers and installation team. Each alert is keyed by its record and due day, so a rerun or a missed
 * day never sends twice, and a moved day alerts again when that one passes too.
 */
export async function processTeamCalendarDeadlines(db: Db, workspaceId: string) {
  const clock = await workspaceClock(db, workspaceId);
  const since = plusDays(clock.today, -ALERT_LOOKBACK_DAYS);
  let sent = 0;
  const late = (await db.query<{ id: string; caseId: string; kind: BookingKind; dueOn: string; bookedBy: string | null; designerId: string | null; ownerId: string | null; person: string; clientName: string }>(
    `SELECT booking.id, booking.case_id AS "caseId", booking.kind, booking.due_on::text AS "dueOn",
            (SELECT member.id FROM workspace_memberships member WHERE member.workspace_id = booking.workspace_id AND member.user_id = booking.booked_by LIMIT 1) AS "bookedBy",
            designer.membership_id AS "designerId", opportunity.owner_membership_id AS "ownerId", coalesce(person.display_name, '') AS person,
            coalesce(party.display_name, opportunity.title, '') AS "clientName"
       FROM design_work_bookings booking
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = booking.workspace_id AND pre_case.id = booking.case_id
       LEFT JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN crm_opportunity_designer designer ON designer.workspace_id = opportunity.workspace_id AND designer.opportunity_id = opportunity.id
       LEFT JOIN workspace_memberships assignee ON assignee.workspace_id = booking.workspace_id AND assignee.id = booking.assignee_membership_id
       LEFT JOIN users person ON person.id = assignee.user_id
      WHERE booking.workspace_id = $1 AND booking.status = 'booked' AND booking.due_on < $2::date AND booking.due_on >= $3::date
        AND booking.overdue_notified_on IS DISTINCT FROM booking.due_on
      ORDER BY booking.due_on, booking.id FOR UPDATE OF booking`, [workspaceId, clock.today, since])).rows;
  for (const row of late) {
    const users = await usersOf(db, workspaceId, [row.bookedBy, row.designerId, row.ownerId]);
    sent += await tell(db, workspaceId, users, "design.work_overdue",
      { kind: BOOKING_LABEL[row.kind], clientName: row.clientName, person: row.person, due: formatDay(row.dueOn, clock.locale) }, caseLink(row.caseId), `design-work:${row.id}:${row.dueOn}:overdue`);
    await db.query(`UPDATE design_work_bookings SET overdue_notified_on = due_on WHERE workspace_id = $1 AND id = $2`, [workspaceId, row.id]);
  }
  const orders = (await db.query<{ id: string; number: number; title: string; dueOn: string; projectId: string; project: string }>(
    `SELECT wo.id, wo.number, wo.title, wo.planned_end::text AS "dueOn", wo.project_id AS "projectId", concat_ws(' · ', nullif(project.reference, ''), project.name) AS project
       FROM work_orders wo JOIN delivery_projects project ON project.workspace_id = wo.workspace_id AND project.id = wo.project_id
      WHERE wo.workspace_id = $1 AND wo.status = ANY($4::text[]) AND wo.planned_end < $2::date AND wo.planned_end >= $3::date AND project.status IN ('active', 'on_hold')
      ORDER BY wo.planned_end, wo.number`, [workspaceId, clock.today, since, OPEN_ORDER])).rows;
  let factory: string[] | null = null;
  for (const order of orders) {
    let users = await projectPeople(db, workspaceId, order.projectId, ["factory_lead"]);
    if (!users.length) users = factory ??= await permitted(db, workspaceId, "factory.manage");
    sent += await tell(db, workspaceId, users, "logistics.overdue", { what: `WO-${String(order.number).padStart(4, "0")} ${order.title}`, project: order.project, due: formatDay(order.dueOn, clock.locale) },
      `/workspace/factory/orders?order=${order.id}`, `logistics:work-order:${order.id}:${order.dueOn}`);
  }
  const projects = (await db.query<{ id: string; project: string; deliveryOn: string | null; installationOn: string | null }>(
    `SELECT project.id, concat_ws(' · ', nullif(project.reference, ''), project.name) AS project, project.delivery_on::text AS "deliveryOn", project.installation_on::text AS "installationOn"
       FROM delivery_projects project
      WHERE project.workspace_id = $1 AND project.status = 'active'
        AND ((project.delivery_on < $2::date AND project.delivery_on >= $3::date) OR (project.installation_on < $2::date AND project.installation_on >= $3::date))
      ORDER BY project.reference, project.id`, [workspaceId, clock.today, since])).rows;
  for (const project of projects) {
    const installation = await readInstallation(db, workspaceId, project.id);
    const stages = (await db.query<{ status: string; ownerRole: string | null; checks: StageCheck[] }>(
      `SELECT status, owner_role AS "ownerRole", checks FROM project_stages WHERE workspace_id = $1 AND project_id = $2 ORDER BY position`, [workspaceId, project.id])).rows;
    const users = await projectPeople(db, workspaceId, project.id, [...new Set([...installationRoles(stages), INSTALLATION_ROLE])]);
    const link = `/workspace/projects/${project.id}`;
    if (project.deliveryOn && project.deliveryOn < clock.today && project.deliveryOn >= since && installation.delivery !== "delivered")
      sent += await tell(db, workspaceId, users, "logistics.overdue", { what: "Delivery", project: project.project, due: formatDay(project.deliveryOn, clock.locale) }, link, `logistics:delivery:${project.id}:${project.deliveryOn}`);
    if (project.installationOn && project.installationOn >= since && installation.late)
      sent += await tell(db, workspaceId, users, "logistics.overdue", { what: "Installation", project: project.project, due: formatDay(project.installationOn, clock.locale) }, link, `logistics:installation:${project.id}:${project.installationOn}`);
  }
  return { sent };
}
