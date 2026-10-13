import type { JobLineageLink } from "../../jobs/job-lineage";
import type { DueItem, ReminderSource } from "../engine/engine";
import { encode, idsOf, keysOf } from "./support";

const HOUR = 3_600_000;
/** Meetings that ended in the last three days are reminded; a week after, the reminder lets go. */
const OPEN_HOURS = 72;
const KEEP_HOURS = 168;

/**
 * meeting.minutes_due (PLM-153): a client meeting (a CRM meeting with its time on the calendar, not cancelled) that
 * ended without minutes. Its owner (who ran it: the designer or the Account Manager) hears after the firm's hours
 * (by default 2 and 24 hours after it ended), then their team lead and the owner. Done once the minutes are written
 * (shared or kept internal) or the meeting is cancelled.
 */
export const minutesDueSource: ReminderSource = {
  kind: "meeting.minutes_due", module: "sales", audience: "staff", critical: false, notify: "engine",
  viewPermission: "crm.activities.view", template: { code: "reminders.meeting.minutes_due" },
  async open(db, workspaceId, { now, limit }) {
    const rows = (await db.query<{ id: string; title: string; endsAt: Date; owner: string | null; leadId: string | null; opportunityId: string | null; partyId: string | null; client: string }>(
      `SELECT activity.id, activity.title, appointment.ends_at AS "endsAt", owner.id AS owner, activity.lead_id AS "leadId", activity.opportunity_id AS "opportunityId",
              party.id AS "partyId", coalesce(party.display_name, '') AS client
         FROM crm_activities activity
         JOIN crm_appointments appointment ON appointment.workspace_id = activity.workspace_id AND appointment.activity_id = activity.id
         LEFT JOIN workspace_memberships owner ON owner.workspace_id = activity.workspace_id AND owner.id = activity.owner_membership_id AND owner.status = 'active'
         LEFT JOIN crm_leads lead ON lead.workspace_id = activity.workspace_id AND lead.id = activity.lead_id
         LEFT JOIN crm_opportunities opportunity ON opportunity.workspace_id = activity.workspace_id AND opportunity.id = activity.opportunity_id
         LEFT JOIN crm_parties party ON party.workspace_id = activity.workspace_id AND party.id = coalesce(activity.party_id, lead.party_id, opportunity.party_id)
        WHERE activity.workspace_id = $1 AND activity.type = 'meeting' AND activity.status <> 'cancelled' AND coalesce(appointment.attendance_status, '') NOT IN ('cancelled', 'no_show')
          AND appointment.ends_at BETWEEN $2::timestamptz AND $3::timestamptz
          AND NOT EXISTS (SELECT 1 FROM meeting_minutes minutes WHERE minutes.workspace_id = activity.workspace_id AND minutes.activity_id = activity.id)
        ORDER BY appointment.ends_at DESC, activity.id LIMIT $4`,
      [workspaceId, new Date(now.getTime() - OPEN_HOURS * HOUR), now, limit])).rows;
    return rows.map((row): DueItem => ({
      key: `minutes:${row.id}`, sourceType: "crm_activity", sourceId: row.id, jobSource: job(row.leadId, row.opportunityId),
      projectId: null, caseId: null, partyId: row.partyId, ownerMembershipId: row.owner, ccMembershipIds: [], dueAt: new Date(row.endsAt),
      title: row.title, context: row.client, href: `/workspace/crm/follow-ups?record=${encode(row.id)}`, variables: { client: row.client },
    }));
  },
  async stillOpen(db, workspaceId, keys, at) {
    const ids = idsOf(keys, "minutes");
    if (!ids.length) return new Set();
    return keysOf("minutes", (await db.query<{ id: string }>(
      `SELECT activity.id FROM crm_activities activity
         JOIN crm_appointments appointment ON appointment.workspace_id = activity.workspace_id AND appointment.activity_id = activity.id
        WHERE activity.workspace_id = $1 AND activity.id = ANY($2::uuid[]) AND activity.type = 'meeting' AND activity.status <> 'cancelled'
          AND coalesce(appointment.attendance_status, '') NOT IN ('cancelled', 'no_show')
          AND ($3::timestamptz IS NULL OR appointment.ends_at BETWEEN $3::timestamptz - make_interval(hours => ${KEEP_HOURS}) AND $3::timestamptz)
          AND NOT EXISTS (SELECT 1 FROM meeting_minutes minutes WHERE minutes.workspace_id = activity.workspace_id AND minutes.activity_id = activity.id)`,
      [workspaceId, ids, at?.now ?? null])).rows.map((row) => row.id));
  },
};

const job = (leadId: string | null, opportunityId: string | null): JobLineageLink | null =>
  opportunityId ? { type: "opportunity", id: opportunityId } : leadId ? { type: "lead", id: leadId } : null;
