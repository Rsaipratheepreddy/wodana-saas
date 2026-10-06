import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { INSTALLATION_ROLE, installationRoles } from "../project-core/project-installation";
import type { StageCheck } from "../project-core/project-checks";
import { readCalendar } from "../project-core/work-calendar";
import { KIND_LABEL, permitAlert, permitCollected, permitFor, slotKey, type LogisticsKind, type PermitUse, type Slot } from "./logistics.domain";
import { permitRequired, readPermitFacts, type PermitOwner } from "./permits";

type Db = Pick<PoolClient, "query">;

export type Named = { id: string; name: string };
export type Crew = {
  assignmentId: string | null; version: number; people: Array<Named & { lead: boolean }>; crew: Named | null; vehicle: Named | null; driver: Named | null; note: string;
};
export type SlotView = Slot & Crew & { status: string };

/** Projects whose bookings show: running, paused or finished (cancelled and archived ones don't hold anyone). */
const PROJECT_STATUSES = ["active", "on_hold", "completed"];

/**
 * Every booked span overlapping [from, to): a project's delivery, installation and factory slot days, planned permit
 * collections, production work orders on their planned days, and won deals' deliveries (orders with no project), each
 * with who and what goes on it. The days are read from their source records; the crew, vehicle and driver from the
 * booking's assignment.
 */
export async function readSlots(db: Db, workspaceId: string, from: string, to: string, filter: { projectId?: string; opportunityId?: string } = {}): Promise<SlotView[]> {
  const rows = (await db.query<{
    kind: LogisticsKind; projectId: string | null; opportunityId: string | null; workOrderId: string | null; permitId: string | null; start: string; end: string; project: string; status: string;
    assignmentId: string | null; version: number | null; crewId: string | null; crewName: string | null; vehicleId: string | null; vehicleName: string | null;
    driverId: string | null; driverName: string | null; note: string | null; people: Array<Named & { lead: boolean }>;
  }>(
    `WITH booked AS (
       SELECT 'delivery'::text AS kind, project.id AS project_id, NULL::uuid AS opportunity_id, NULL::uuid AS work_order_id, NULL::uuid AS permit_id,
              project.delivery_on AS start_on, project.delivery_on AS end_on, project.status::text AS status
         FROM delivery_projects project WHERE project.workspace_id = $1 AND project.status = ANY($4::text[]) AND project.delivery_on IS NOT NULL
       UNION ALL
       SELECT 'installation', project.id, NULL, NULL, NULL, project.installation_on, project.installation_on, project.status::text
         FROM delivery_projects project WHERE project.workspace_id = $1 AND project.status = ANY($4::text[]) AND project.installation_on IS NOT NULL
       UNION ALL
       SELECT 'factory_slot', project.id, NULL, NULL, NULL, project.factory_slot_on, project.factory_slot_on, project.status::text
         FROM delivery_projects project WHERE project.workspace_id = $1 AND project.status = ANY($4::text[]) AND project.factory_slot_on IS NOT NULL
       UNION ALL
       SELECT 'permit', permit.project_id, permit.opportunity_id, NULL, permit.id, permit.collect_on, permit.collect_on, permit.status
         FROM building_permits permit LEFT JOIN delivery_projects project ON project.workspace_id = permit.workspace_id AND project.id = permit.project_id
        WHERE permit.workspace_id = $1 AND permit.status = 'planned' AND (permit.project_id IS NULL OR project.status = ANY($4::text[]))
       UNION ALL
       SELECT 'production', wo.project_id, NULL, wo.id, NULL, coalesce(wo.planned_start, wo.planned_end), coalesce(wo.planned_end, wo.planned_start), wo.status::text
         FROM work_orders wo WHERE wo.workspace_id = $1 AND wo.status NOT IN ('cancelled', 'short_closed') AND coalesce(wo.planned_start, wo.planned_end) IS NOT NULL
       UNION ALL
       SELECT 'delivery', NULL, deal.opportunity_id, NULL, NULL, deal.delivery_on, deal.delivery_on,
              CASE WHEN EXISTS (SELECT 1 FROM crm_deal_fulfilment_events event WHERE event.workspace_id = deal.workspace_id AND event.opportunity_id = deal.opportunity_id
                                 AND event.event = 'delivered') THEN 'delivered' ELSE 'booked' END
         FROM crm_deal_fulfilment deal WHERE deal.workspace_id = $1 AND deal.delivery_on IS NOT NULL AND deal.cancelled_at IS NULL
     )
     SELECT booked.kind, booked.project_id AS "projectId", booked.opportunity_id AS "opportunityId", booked.work_order_id AS "workOrderId", booked.permit_id AS "permitId",
            booked.start_on::text AS start, booked.end_on::text AS "end", booked.status,
            coalesce(concat_ws(' · ', nullif(project.reference, ''), project.name), concat_ws(' · ', nullif(opportunity.reference, ''), coalesce(party.display_name, opportunity.title))) AS project,
            assignment.id AS "assignmentId", assignment.version, assignment.note, crew.id AS "crewId", crew.name AS "crewName",
            vehicle.id AS "vehicleId", vehicle.name AS "vehicleName", driver.id AS "driverId", driver.name AS "driverName",
            coalesce((SELECT jsonb_agg(jsonb_build_object('id', worker.id, 'name', worker.name, 'lead', person.lead) ORDER BY person.lead DESC, lower(worker.name), worker.id)
                        FROM logistics_assignment_people person JOIN hrms_workers worker ON worker.workspace_id = person.workspace_id AND worker.id = person.worker_id
                       WHERE person.workspace_id = assignment.workspace_id AND person.assignment_id = assignment.id), '[]'::jsonb) AS people
       FROM booked
       LEFT JOIN delivery_projects project ON project.workspace_id = $1 AND project.id = booked.project_id
       LEFT JOIN crm_opportunities opportunity ON opportunity.workspace_id = $1 AND opportunity.id = booked.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN logistics_assignments assignment ON assignment.workspace_id = $1 AND assignment.kind = booked.kind
            AND assignment.project_id IS NOT DISTINCT FROM booked.project_id AND assignment.opportunity_id IS NOT DISTINCT FROM booked.opportunity_id
            AND assignment.work_order_id IS NOT DISTINCT FROM booked.work_order_id AND assignment.permit_id IS NOT DISTINCT FROM booked.permit_id
       LEFT JOIN hrms_crews crew ON crew.workspace_id = assignment.workspace_id AND crew.id = assignment.crew_id
       LEFT JOIN logistics_vehicles vehicle ON vehicle.workspace_id = assignment.workspace_id AND vehicle.id = assignment.vehicle_id
       LEFT JOIN hrms_workers driver ON driver.workspace_id = assignment.workspace_id AND driver.id = assignment.driver_worker_id
      WHERE booked.start_on < $3::date AND booked.end_on >= $2::date AND ($5::uuid IS NULL OR booked.project_id = $5) AND ($6::uuid IS NULL OR booked.opportunity_id = $6)
      ORDER BY booked.start_on, booked.kind, 9, booked.project_id, booked.opportunity_id`,
    [workspaceId, from, to, PROJECT_STATUSES, filter.projectId ?? null, filter.opportunityId ?? null])).rows;
  return rows.map((row) => ({
    key: slotKey(row.kind, row), kind: row.kind, projectId: row.projectId, opportunityId: row.opportunityId, workOrderId: row.workOrderId, permitId: row.permitId,
    project: row.project, start: row.start, end: row.end, status: row.status,
    workerIds: row.people.map((person) => person.id), driverId: row.driverId, vehicleId: row.vehicleId,
    assignmentId: row.assignmentId, version: Number(row.version ?? 0), people: row.people,
    crew: row.crewId ? { id: row.crewId, name: row.crewName ?? "" } : null,
    vehicle: row.vehicleId ? { id: row.vehicleId, name: row.vehicleName ?? "" } : null,
    driver: row.driverId ? { id: row.driverId, name: row.driverName ?? "" } : null,
    note: row.note ?? "",
  }));
}

/** Whether a booking's permit is needed and whether one covers its day (PLM-136), for the calendar and the record. */
export async function permitStatus(db: Db, workspaceId: string, owner: PermitOwner, day: string | null) {
  const required = await permitRequired(db, workspaceId, owner);
  const facts = await readPermitFacts(db, workspaceId, owner);
  const covering = day ? permitFor(facts, day) : null;
  return { required, covered: Boolean(covering), validTo: covering?.validTo ?? null, collected: facts.some((item) => item.status === "collected") };
}

/**
 * A project's delivery and installation crews (who goes, the vehicle and driver) and its building permit: whether the
 * route needs one, whether permits cover the delivery and installation days (or one is valid today), and until when.
 */
export async function readInstallationCrew(db: Db, workspaceId: string, projectId: string) {
  const project = (await db.query<{ deliveryOn: string | null; installationOn: string | null; today: string }>(
    `SELECT project.delivery_on::text AS "deliveryOn", project.installation_on::text AS "installationOn",
            (now() AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date::text AS today
       FROM delivery_projects project JOIN workspaces workspace ON workspace.id = project.workspace_id WHERE project.workspace_id = $1 AND project.id = $2`,
    [workspaceId, projectId])).rows[0];
  const days = [project?.deliveryOn, project?.installationOn].filter((day): day is string => Boolean(day)).sort();
  const slots = days.length ? await readSlots(db, workspaceId, days[0], new Date(Date.parse(`${days.at(-1)}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10), { projectId }) : [];
  const crewOf = (kind: LogisticsKind): Crew | null => {
    const slot = slots.find((item) => item.kind === kind);
    return slot ? { assignmentId: slot.assignmentId, version: slot.version, people: slot.people, crew: slot.crew, vehicle: slot.vehicle, driver: slot.driver, note: slot.note } : null;
  };
  const facts = await readPermitFacts(db, workspaceId, { projectId });
  const today = project?.today ?? new Date().toISOString().slice(0, 10);
  const firstDay = days[0] ?? null;
  const covering = firstDay ? permitFor(facts, firstDay) : facts.filter((item) => item.status === "collected" && item.validTo && item.validTo >= today)
    .sort((a, b) => b.validTo!.localeCompare(a.validTo!))[0] ?? null;
  const planned = facts.find((item) => item.status === "planned") ?? null;
  return {
    deliveryCrew: crewOf("delivery"), installationCrew: crewOf("installation"),
    permit: { required: await permitRequired(db, workspaceId, { projectId }), valid: permitCollected(facts, [project?.deliveryOn ?? null, project?.installationOn ?? null], today),
      validTo: covering?.validTo ?? null, collectOn: planned?.collectOn ?? null, plannedId: planned?.id ?? null, collected: facts.some((item) => item.status === "collected") },
  };
}

/** One line for a notice: who goes (the lead first), the vehicle and the driver. */
export function crewLine(crew: Pick<Crew, "people" | "vehicle" | "driver" | "crew">) {
  const people = crew.people.map((person) => (person.lead ? `${person.name} (lead)` : person.name));
  return [
    crew.crew ? `Crew: ${crew.crew.name}${people.length ? ` (${people.join(", ")})` : ""}.` : people.length ? `Crew: ${people.join(", ")}.` : "",
    crew.vehicle ? `Vehicle: ${crew.vehicle.name}.` : "",
    crew.driver ? `Driver: ${crew.driver.name}.` : "",
  ].filter(Boolean).join(" ");
}

/** The project's managers and its installation team (the roles owning its delivery and installation stages). */
export async function installationTeam(db: Db, workspaceId: string, projectId: string) {
  const stages = (await db.query<{ status: string; ownerRole: string | null; checks: StageCheck[] }>(
    `SELECT status, owner_role AS "ownerRole", checks FROM project_stages WHERE workspace_id = $1 AND project_id = $2 ORDER BY position`, [workspaceId, projectId])).rows;
  const roles = [...new Set([...installationRoles(stages), INSTALLATION_ROLE])];
  return (await db.query<{ membershipId: string; userId: string }>(
    `SELECT DISTINCT assignment.membership_id AS "membershipId", membership.user_id AS "userId" FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
      WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND (assignment.is_manager OR assignment.role_keys && $3::varchar[])
      ORDER BY 2`, [workspaceId, projectId, roles])).rows;
}

/** People holding any of the permissions (the bookers, when a project names nobody). */
export async function permissionHolders(db: Db, workspaceId: string, codes: string[]) {
  return (await db.query<{ userId: string }>(
    `SELECT DISTINCT membership.user_id AS "userId" FROM workspace_memberships membership
       JOIN effective_member_roles assigned ON assigned.membership_id = membership.id AND assigned.workspace_id = membership.workspace_id
       JOIN role_permissions granted ON granted.role_id = assigned.role_id JOIN permissions permission ON permission.id = granted.permission_id AND permission.code = ANY($2::text[])
      WHERE membership.workspace_id = $1 AND membership.status = 'active' ORDER BY 1`, [workspaceId, codes])).rows.map((row) => row.userId);
}

/** Tells each person once per key, in the app and by email (unless `inAppOnly`). */
export async function tell(db: Db, input: { workspaceId: string; users: string[]; code: string; variables: Record<string, string>; deepLink: string; key: string; inAppOnly?: boolean }) {
  let sent = 0;
  // Keys hold at most 160 characters: a long one is hashed (the same record and day give the same key).
  const key = input.key.length > 90 ? `logistics:${createHash("sha256").update(input.key).digest("hex").slice(0, 40)}` : input.key;
  for (const userId of [...new Set(input.users)]) {
    const message = { workspaceId: input.workspaceId, recipientUserId: userId, code: input.code, eventType: input.code, variables: input.variables, deepLink: input.deepLink };
    const result = await notifyUserInApp(db, { ...message, idempotencyKey: `${key}:${userId}` });
    if (!input.inAppOnly) await queueUserEmail(db, { ...message, idempotencyKey: `${key}:${userId}:email` });
    if (result.queued) sent++;
  }
  return sent;
}

export async function permitWarningDays(db: Db, workspaceId: string) {
  const row = (await db.query<{ days: number; version: number }>(`SELECT permit_warning_days AS days, version FROM workspace_logistics_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
  return { days: Number(row?.days ?? 3), version: Number(row?.version ?? 0) };
}

const formatDay = (day: string, locale: string) => {
  try { return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${day}T00:00:00Z`)); } catch { return day; }
};

/**
 * The daily pass for one workspace (inside its tenant transaction), PLM-136: for each running project whose route checks
 * the building permit, and each won deal delivered without a project where the firm asks for one, with a delivery or
 * installation day booked, its people hear when the permit ends before the first day it should cover, or when there is
 * still none for it the firm's working days before (3 by default). A project's managers and installation team hear
 * it (else the bookers); a deal's owner and the bookers. Each alert is keyed by its record, use and day (and the permit
 * that ends), so a rerun never sends twice and a moved day alerts again.
 */
export async function processLogisticsAlerts(db: Db, workspaceId: string) {
  const facts = (await db.query<{ today: string; locale: string }>(
    `SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today, coalesce(nullif(default_locale, ''), 'en') AS locale FROM workspaces WHERE id = $1`,
    [workspaceId])).rows[0];
  if (!facts) return { sent: 0 };
  const projects = (await db.query<{ id: string; label: string; deliveryOn: string | null; installationOn: string | null }>(
    `SELECT project.id, concat_ws(' · ', nullif(project.reference, ''), project.name) AS label, project.delivery_on::text AS "deliveryOn", project.installation_on::text AS "installationOn"
       FROM delivery_projects project
      WHERE project.workspace_id = $1 AND project.status = 'active' AND (project.delivery_on >= $2::date OR project.installation_on >= $2::date)
        AND EXISTS (SELECT 1 FROM project_stages stage, jsonb_array_elements(stage.checks) item WHERE stage.workspace_id = project.workspace_id AND stage.project_id = project.id
                     AND stage.status <> 'skipped' AND item->>'kind' = 'permit_collected')
      ORDER BY project.id`, [workspaceId, facts.today])).rows;
  const deals = (await db.query<{ id: string; label: string; deliveryOn: string; ownerId: string | null }>(
    `SELECT deal.opportunity_id AS id, concat_ws(' · ', nullif(opportunity.reference, ''), coalesce(party.display_name, opportunity.title)) AS label, deal.delivery_on::text AS "deliveryOn",
            owner.user_id AS "ownerId"
       FROM crm_deal_fulfilment deal JOIN crm_opportunities opportunity ON opportunity.workspace_id = deal.workspace_id AND opportunity.id = deal.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN workspace_memberships owner ON owner.workspace_id = opportunity.workspace_id AND owner.id = opportunity.owner_membership_id AND owner.status = 'active'
      WHERE deal.workspace_id = $1 AND deal.delivery_on >= $2::date AND deal.cancelled_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM crm_deal_fulfilment_events event WHERE event.workspace_id = deal.workspace_id AND event.opportunity_id = deal.opportunity_id AND event.event = 'delivered')
      ORDER BY deal.opportunity_id`, [workspaceId, facts.today])).rows;
  if (!projects.length && !deals.length) return { sent: 0 };
  const calendar = await readCalendar(db, workspaceId);
  const warning = await permitWarningDays(db, workspaceId);
  let bookers: string[] | null = null;
  const bookersOf = async () => (bookers ??= await permissionHolders(db, workspaceId, ["logistics.manage", "factory.manage"]));
  let sent = 0;
  const raise = async (owner: PermitOwner, label: string, days: Array<{ use: PermitUse; day: string | null }>, users: string[], deepLink: string) => {
    const alert = permitAlert({ days, today: facts.today, permits: await readPermitFacts(db, workspaceId, owner), warningDays: warning.days, calendar });
    if (!alert) return;
    const id = owner.projectId ?? owner.opportunityId;
    const variables = { project: label, what: alert.use === "installation" ? "the installation" : "the delivery", date: formatDay(alert.day, facts.locale),
      until: alert.kind === "expiring" ? formatDay(alert.until, facts.locale) : "" };
    sent += await tell(db, { workspaceId, users, code: alert.kind === "expiring" ? "logistics.permit_expiring" : "logistics.permit_missing", variables, deepLink,
      key: alert.kind === "expiring" ? `logistics:permit-expiring:${id}:${alert.use}:${alert.day}:${alert.permitId}` : `logistics:permit-missing:${id}:${alert.use}:${alert.day}` });
  };
  for (const project of projects) {
    let users = (await installationTeam(db, workspaceId, project.id)).map((person) => person.userId);
    if (!users.length) users = await bookersOf();
    await raise({ projectId: project.id }, project.label, [{ use: "delivery", day: project.deliveryOn }, { use: "installation", day: project.installationOn }], users,
      `/workspace/projects/${project.id}`);
  }
  for (const deal of deals) {
    if (!(await permitRequired(db, workspaceId, { opportunityId: deal.id }))) continue;
    await raise({ opportunityId: deal.id }, deal.label, [{ use: "delivery", day: deal.deliveryOn }], [...(deal.ownerId ? [deal.ownerId] : []), ...await bookersOf()],
      `/workspace/crm/opportunities?record=${deal.id}`);
  }
  return { sent };
}

export const kindLabel = (kind: LogisticsKind) => KIND_LABEL[kind];
