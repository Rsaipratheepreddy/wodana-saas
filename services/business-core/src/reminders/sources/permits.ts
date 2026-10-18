import { addDays } from "../../booking/booking.domain";
import { permitFor, type PermitUse } from "../../logistics/logistics.domain";
import { installationTeam } from "../../logistics/logistics.store";
import { permitRequired, readPermitFacts, type PermitOwner } from "../../logistics/permits";
import { readPermissionHolders } from "../delivery/people";
import type { Db, DueItem, ReminderSource } from "../engine/engine";
import { dayStart, encode, UUID } from "./support";

const HORIZON_DAYS = 60;
const BOOKERS = ["logistics.manage", "factory.manage"];

type Booking = { ownerType: "project" | "deal"; ownerId: string; label: string; use: PermitUse; day: string; caseId: string | null; dealOwner: string | null };

/** Delivery and installation days booked from today to the horizon: running projects whose route checks the permit, and won deals not yet delivered. */
async function bookings(db: Db, workspaceId: string, today: string, until: string): Promise<Booking[]> {
  const projects = (await db.query<{ id: string; label: string; caseId: string | null; deliveryOn: string | null; installationOn: string | null }>(
    `SELECT project.id, concat_ws(' · ', nullif(project.reference, ''), project.name) AS label, project.case_id AS "caseId",
            project.delivery_on::text AS "deliveryOn", project.installation_on::text AS "installationOn"
       FROM delivery_projects project
      WHERE project.workspace_id = $1 AND project.status = 'active'
        AND (project.delivery_on BETWEEN $2::date AND $3::date OR project.installation_on BETWEEN $2::date AND $3::date)
        AND EXISTS (SELECT 1 FROM project_stages stage, jsonb_array_elements(stage.checks) item WHERE stage.workspace_id = project.workspace_id AND stage.project_id = project.id
                     AND stage.status <> 'skipped' AND item->>'kind' = 'permit_collected')
      ORDER BY project.id`, [workspaceId, today, until])).rows;
  const deals = (await db.query<{ id: string; label: string; deliveryOn: string; owner: string | null }>(
    `SELECT deal.opportunity_id AS id, concat_ws(' · ', nullif(opportunity.reference, ''), coalesce(party.display_name, opportunity.title)) AS label,
            deal.delivery_on::text AS "deliveryOn", owner.id AS owner
       FROM crm_deal_fulfilment deal JOIN crm_opportunities opportunity ON opportunity.workspace_id = deal.workspace_id AND opportunity.id = deal.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN workspace_memberships owner ON owner.workspace_id = opportunity.workspace_id AND owner.id = opportunity.owner_membership_id AND owner.status = 'active'
      WHERE deal.workspace_id = $1 AND deal.delivery_on BETWEEN $2::date AND $3::date AND deal.cancelled_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM crm_deal_fulfilment_events event WHERE event.workspace_id = deal.workspace_id AND event.opportunity_id = deal.opportunity_id AND event.event = 'delivered')
      ORDER BY deal.opportunity_id`, [workspaceId, today, until])).rows;
  const result: Booking[] = [];
  for (const project of projects) {
    for (const [use, day] of [["delivery", project.deliveryOn], ["installation", project.installationOn]] as const) {
      if (day && day >= today && day <= until) result.push({ ownerType: "project", ownerId: project.id, label: project.label, use, day, caseId: project.caseId, dealOwner: null });
    }
  }
  for (const deal of deals) {
    if (await permitRequired(db, workspaceId, { opportunityId: deal.id })) result.push({ ownerType: "deal", ownerId: deal.id, label: deal.label, use: "delivery", day: deal.deliveryOn, caseId: null, dealOwner: deal.owner });
  }
  return result;
}

const ownerOf = (booking: Pick<Booking, "ownerType" | "ownerId">): PermitOwner => (booking.ownerType === "project" ? { projectId: booking.ownerId } : { opportunityId: booking.ownerId });

/** A project's managers and installation team (else the bookers); a deal's owner and the bookers. */
async function peopleFor(db: Db, workspaceId: string, booking: Pick<Booking, "ownerType" | "ownerId" | "dealOwner">, bookers: () => Promise<string[]>) {
  if (booking.ownerType === "project") {
    const team = (await installationTeam(db, workspaceId, booking.ownerId)).map((person) => person.membershipId);
    return team.length ? team : bookers();
  }
  return [...new Set([...(booking.dealOwner ? [booking.dealOwner] : []), ...await bookers()])];
}

/**
 * permit.expiry (critical; replaces processLogisticsAlerts): building permits (PLM-136).
 * - A booked delivery or installation day that no collected permit covers (none collected, or it ends before the
 *   day): 3 and 1 working days before and on the day, then the project manager and the owner. Done when a valid
 *   permit covers the day, or the booking moved (another day is another subject).
 * - A collected permit that ends while its work is still ahead: 3 and 1 working days before it ends and on the day.
 *   Done when a later permit renews it, the work is done or cancelled, or it ended.
 * A project's managers and installation team hear it (else the people who book logistics); a deal's owner and the bookers.
 */
export const permitExpirySource: ReminderSource = {
  kind: "permit.expiry", module: "projects", audience: "staff", critical: true, notify: "engine",
  viewPermission: "projects.view", template: { code: "reminders.permit.expiry" },
  async open(db, workspaceId, { clock, limit }) {
    const until = addDays(clock.today, HORIZON_DAYS);
    let bookerIds: string[] | null = null;
    const bookers = async () => (bookerIds ??= await readPermissionHolders(db, workspaceId, BOOKERS));
    const items: DueItem[] = [];
    for (const booking of await bookings(db, workspaceId, clock.today, until)) {
      if (items.length >= limit) break;
      if (permitFor(await readPermitFacts(db, workspaceId, ownerOf(booking)), booking.day)) continue;
      const people = await peopleFor(db, workspaceId, booking, bookers);
      items.push({
        key: `permit:${booking.ownerType}:${booking.ownerId}:${booking.use}:${booking.day}`, sourceType: "permit_booking", sourceId: `${booking.ownerType}:${booking.ownerId}:${booking.use}:${booking.day}`,
        jobSource: booking.ownerType === "project" ? { type: "project", id: booking.ownerId } : { type: "opportunity", id: booking.ownerId },
        projectId: booking.ownerType === "project" ? booking.ownerId : null, caseId: booking.caseId, partyId: null,
        ownerMembershipId: people[0] ?? null, ccMembershipIds: people.slice(1), dueAt: dayStart(booking.day, clock),
        title: booking.use === "installation" ? "Building permit for the installation" : "Building permit for the delivery", context: booking.label,
        href: booking.ownerType === "project" ? `/workspace/projects/${encode(booking.ownerId)}` : `/workspace/crm/opportunities?record=${encode(booking.ownerId)}`, variables: {},
      });
    }
    const permits = (await db.query<{ id: string; projectId: string | null; opportunityId: string | null; validTo: string; number: string; label: string; caseId: string | null; dealOwner: string | null }>(
      `SELECT permit.id, permit.project_id AS "projectId", permit.opportunity_id AS "opportunityId", permit.valid_to::text AS "validTo", permit.permit_number AS number,
              coalesce(concat_ws(' · ', nullif(project.reference, ''), project.name), concat_ws(' · ', nullif(opportunity.reference, ''), coalesce(party.display_name, opportunity.title))) AS label,
              project.case_id AS "caseId", owner.id AS "dealOwner"
         FROM building_permits permit
         LEFT JOIN delivery_projects project ON project.workspace_id = permit.workspace_id AND project.id = permit.project_id
         LEFT JOIN crm_opportunities opportunity ON opportunity.workspace_id = permit.workspace_id AND opportunity.id = permit.opportunity_id
         LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
         LEFT JOIN workspace_memberships owner ON owner.workspace_id = opportunity.workspace_id AND owner.id = opportunity.owner_membership_id AND owner.status = 'active'
        WHERE permit.workspace_id = $1 AND permit.status = 'collected' AND permit.valid_to BETWEEN $2::date AND $3::date
        ORDER BY permit.valid_to, permit.id LIMIT $4`, [workspaceId, clock.today, addDays(clock.today, 30), limit])).rows;
    const open = await renewalsOpen(db, workspaceId, permits.map((permit) => permit.id), clock.today);
    for (const permit of permits) {
      if (!open.has(permit.id) || items.length >= limit) continue;
      const booking = permit.projectId ? { ownerType: "project" as const, ownerId: permit.projectId, dealOwner: null } : { ownerType: "deal" as const, ownerId: permit.opportunityId!, dealOwner: permit.dealOwner };
      const people = await peopleFor(db, workspaceId, booking, bookers);
      items.push({
        key: `permit_renewal:${permit.id}`, sourceType: "building_permit", sourceId: permit.id,
        jobSource: permit.projectId ? { type: "project", id: permit.projectId } : { type: "opportunity", id: permit.opportunityId! },
        projectId: permit.projectId, caseId: permit.caseId, partyId: null, ownerMembershipId: people[0] ?? null, ccMembershipIds: people.slice(1),
        dueAt: dayStart(permit.validTo, clock), title: `Building permit ${permit.number} ends`.trim(), context: permit.label,
        href: permit.projectId ? `/workspace/projects/${encode(permit.projectId)}` : `/workspace/crm/opportunities?record=${encode(permit.opportunityId!)}`, variables: {},
      });
    }
    return items;
  },
  async stillOpen(db, workspaceId, keys, at) {
    const today = at?.today ?? new Date().toISOString().slice(0, 10);
    const open = new Set<string>();
    const renewals = keys.filter((key) => key.startsWith("permit_renewal:")).map((key) => key.slice("permit_renewal:".length)).filter((id) => UUID.test(id));
    for (const id of await renewalsOpen(db, workspaceId, renewals, today)) open.add(`permit_renewal:${id}`);
    for (const key of keys) {
      const [prefix, ownerType, ownerId, use, day] = key.split(":");
      if (prefix !== "permit" || !UUID.test(ownerId ?? "") || (ownerType !== "project" && ownerType !== "deal") || (use !== "delivery" && use !== "installation")) continue;
      if (!day || day < today) continue;
      const booked = ownerType === "project"
        ? (await db.query(`SELECT 1 FROM delivery_projects WHERE workspace_id = $1 AND id = $2 AND status = 'active' AND ${use === "delivery" ? "delivery_on" : "installation_on"} = $3::date`,
            [workspaceId, ownerId, day])).rowCount
        : (await db.query(`SELECT 1 FROM crm_deal_fulfilment deal WHERE deal.workspace_id = $1 AND deal.opportunity_id = $2 AND deal.delivery_on = $3::date AND deal.cancelled_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM crm_deal_fulfilment_events event WHERE event.workspace_id = deal.workspace_id AND event.opportunity_id = deal.opportunity_id AND event.event = 'delivered')`,
            [workspaceId, ownerId, day])).rowCount;
      if (!booked) continue;
      if (!permitFor(await readPermitFacts(db, workspaceId, ownerType === "project" ? { projectId: ownerId } : { opportunityId: ownerId }), day)) open.add(key);
    }
    return open;
  },
};

/** Of these collected permits, the ones still ending ahead of their work: not ended, not renewed by a later one, work still to come. */
async function renewalsOpen(db: Db, workspaceId: string, ids: readonly string[], today: string): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = (await db.query<{ id: string; projectId: string | null; opportunityId: string | null; validTo: string }>(
    `SELECT permit.id, permit.project_id AS "projectId", permit.opportunity_id AS "opportunityId", permit.valid_to::text AS "validTo"
       FROM building_permits permit LEFT JOIN delivery_projects project ON project.workspace_id = permit.workspace_id AND project.id = permit.project_id
      WHERE permit.workspace_id = $1 AND permit.id = ANY($2::uuid[]) AND permit.status = 'collected' AND permit.valid_to >= $3::date
        AND (project.status IN ('active', 'on_hold')
             OR (permit.opportunity_id IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM crm_deal_fulfilment deal WHERE deal.workspace_id = permit.workspace_id AND deal.opportunity_id = permit.opportunity_id AND deal.cancelled_at IS NOT NULL)
                 AND NOT EXISTS (SELECT 1 FROM crm_deal_fulfilment_events event WHERE event.workspace_id = permit.workspace_id AND event.opportunity_id = permit.opportunity_id AND event.event = 'delivered')))`,
    [workspaceId, ids, today])).rows;
  const open = new Set<string>();
  for (const row of rows) {
    const owner: PermitOwner = row.projectId ? { projectId: row.projectId } : { opportunityId: row.opportunityId! };
    const renewed = (await readPermitFacts(db, workspaceId, owner)).some((fact) => fact.id !== row.id && fact.status === "collected" && fact.validTo !== null && fact.validTo > row.validTo);
    if (!renewed) open.add(row.id);
  }
  return open;
}
