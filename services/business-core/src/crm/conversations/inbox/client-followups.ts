import type { PoolClient } from "pg";
import { partyOfCase, recordClientMessageSkipped, sendClientEvent, type ClientMessageResult } from "./client-messages";

type Db = Pick<PoolClient, "query">;
type Config = { get(key: string): unknown };
const DAY = 86_400_000;

/** How the follow-ups are timed (Settings → Inbox → Client messages → Timing). */
export type FollowUpSettings = { quietDays: number; quietSecondDays: number | null; quoteDays: number; reviewUrl: string | null; version: number };
export const DEFAULT_FOLLOW_UPS: FollowUpSettings = { quietDays: 3, quietSecondDays: null, quoteDays: 3, reviewUrl: null, version: 0 };

export async function readFollowUpSettings(db: Db, workspaceId: string): Promise<FollowUpSettings> {
  const row = (await db.query<{ quietDays: number; quietSecondDays: number | null; quoteDays: number; reviewUrl: string | null; version: number }>(
    `SELECT quiet_followup_days AS "quietDays", quiet_followup_second_days AS "quietSecondDays", quote_followup_days AS "quoteDays",
            review_url AS "reviewUrl", followups_version AS version
       FROM crm_inbox_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
  return row ? { ...row, version: Number(row.version) } : DEFAULT_FOLLOW_UPS;
}

/**
 * Which quiet-enquiry follow-up is due: the client hasn't answered our last message (at `lastOutboundAt`) for the
 * gap of the next follow-up (the first gap, then the longer second one when the firm turned it on). Null when none.
 */
export function quietFollowUpDue(input: { lastOutboundAt: Date | null; lastInboundAt: Date | null; sent: number; now: Date; settings: Pick<FollowUpSettings, "quietDays" | "quietSecondDays"> }) {
  const { lastOutboundAt, lastInboundAt, sent, now, settings } = input;
  if (!lastOutboundAt || (lastInboundAt && lastInboundAt >= lastOutboundAt)) return null;
  const gaps = [settings.quietDays, ...(settings.quietSecondDays ? [settings.quietSecondDays] : [])];
  if (sent >= gaps.length) return null;
  // A conversation that went quiet long ago isn't picked up again.
  if (now.getTime() - lastOutboundAt.getTime() > 60 * DAY) return null;
  return now.getTime() - lastOutboundAt.getTime() >= gaps[sent] * DAY ? sent + 1 : null;
}

/** A client message in a savepoint: one that can't be written never undoes the change that caused it. */
async function quietly(db: Db, work: () => Promise<ClientMessageResult | null>) {
  await db.query("SAVEPOINT crm_client_follow_up");
  try {
    const result = await work();
    await db.query("RELEASE SAVEPOINT crm_client_follow_up");
    return result;
  } catch {
    await db.query("ROLLBACK TO SAVEPOINT crm_client_follow_up");
    return null;
  }
}

/** A visit or meeting booked (or moved) with a client: they get its confirmation, once per time it is set for. */
export function confirmAppointment(db: Db, workspaceId: string, activityId: string, options: { config?: Config; actorUserId?: string | null } = {}) {
  return quietly(db, async () => {
    const row = (await db.query<{ id: string; startsAt: Date; partyId: string | null; leadId: string | null }>(
      `SELECT appointment.id, appointment.starts_at AS "startsAt", activity.lead_id AS "leadId",
              COALESCE(activity.party_id, (SELECT party.id FROM crm_parties party WHERE party.workspace_id = appointment.workspace_id
                 AND party.id::text = appointment.attendee_party_ids->>0)) AS "partyId"
         FROM crm_appointments appointment
         JOIN crm_activities activity ON activity.workspace_id = appointment.workspace_id AND activity.id = appointment.activity_id
        WHERE appointment.workspace_id = $1 AND appointment.activity_id = $2 AND activity.type = 'meeting' AND activity.status = 'pending'
          AND appointment.attendance_status = 'scheduled' AND appointment.starts_at > now()`, [workspaceId, activityId])).rows[0];
    if (!row?.partyId) return null;
    const recordKey = `${row.id}:${new Date(row.startsAt).getTime()}`;
    const result = await sendClientEvent(db, { workspaceId, event: "crm.meeting.booked", partyId: row.partyId, leadId: row.leadId, recordKey, record: { appointmentId: row.id }, config: options.config, actorUserId: options.actorUserId });
    if (!result.sent) await recordClientMessageSkipped(db, workspaceId, "crm.meeting.booked", recordKey, result, false);
    return result;
  });
}

/** A won deal: the client is thanked and told what happens next, once per opportunity. */
export function thankForDeal(db: Db, workspaceId: string, opportunityId: string, options: { config?: Config; actorUserId?: string | null } = {}) {
  return quietly(db, async () => {
    const row = (await db.query<{ partyId: string | null; leadId: string | null }>(
      `SELECT party_id AS "partyId", lead_id AS "leadId" FROM crm_opportunities WHERE workspace_id = $1 AND id = $2 AND status = 'won'`, [workspaceId, opportunityId])).rows[0];
    if (!row?.partyId) return null;
    const result = await sendClientEvent(db, { workspaceId, event: "crm.opportunity.won", partyId: row.partyId, leadId: row.leadId, recordKey: opportunityId, config: options.config, actorUserId: options.actorUserId });
    if (!result.sent) await recordClientMessageSkipped(db, workspaceId, "crm.opportunity.won", opportunityId, result, false);
    return result;
  });
}

/** Handover accepted or the project completed (whichever comes first): thanks, with the review link when the firm set one. */
export function thankForHandover(db: Db, workspaceId: string, projectId: string, options: { config?: Config; actorUserId?: string | null } = {}) {
  return quietly(db, async () => {
    const project = (await db.query<{ caseId: string | null }>(`SELECT case_id AS "caseId" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0];
    if (!project?.caseId) return null;
    const owner = await partyOfCase(db, workspaceId, project.caseId);
    if (!owner.partyId) return null;
    const result = await sendClientEvent(db, { workspaceId, event: "project.handover_thanks", partyId: owner.partyId, leadId: owner.leadId, recordKey: projectId, record: { projectId }, config: options.config, actorUserId: options.actorUserId });
    if (!result.sent) await recordClientMessageSkipped(db, workspaceId, "project.handover_thanks", projectId, result, false);
    return result;
  });
}

/**
 * The time-based client messages, run by the worker's due-work pass (at most every two minutes per workspace):
 * the day-before visit reminder and the nudge on an enquiry that went quiet (the quotation follow-up is the reminder
 * engine's client.quote_decision). Each stops by itself (the visit moved or was cancelled, the client replied) and goes once.
 */
export async function runClientFollowUps(db: Db, workspaceId: string, options: { config?: Config; now?: Date } = {}) {
  const now = options.now ?? new Date();
  await db.query(
    `INSERT INTO crm_inbox_settings (workspace_id, followups_checked_at) VALUES ($1, now())
     ON CONFLICT (workspace_id) DO UPDATE SET followups_checked_at = now()`, [workspaceId]);
  const connected = await db.query(`SELECT 1 FROM integration_connections WHERE workspace_id = $1 AND provider = 'whatsapp' AND status = 'connected' LIMIT 1`, [workspaceId]);
  const sent = { reminders: 0, quiet: 0 };
  if (!connected.rowCount) return sent;
  const settings = await readFollowUpSettings(db, workspaceId);
  const count = (result: ClientMessageResult | null) => (result?.sent && !result.duplicate ? 1 : 0);

  // The day before a visit booked at least a day ahead (a visit booked for tomorrow just had its confirmation).
  const visits = await db.query<{ id: string; startsAt: Date; partyId: string | null; leadId: string | null }>(
    `SELECT appointment.id, appointment.starts_at AS "startsAt", activity.lead_id AS "leadId",
            COALESCE(activity.party_id, (SELECT party.id FROM crm_parties party WHERE party.workspace_id = appointment.workspace_id
               AND party.id::text = appointment.attendee_party_ids->>0)) AS "partyId"
       FROM crm_appointments appointment
       JOIN crm_activities activity ON activity.workspace_id = appointment.workspace_id AND activity.id = appointment.activity_id
      WHERE appointment.workspace_id = $1 AND activity.type = 'meeting' AND activity.status = 'pending' AND appointment.attendance_status = 'scheduled'
        AND appointment.starts_at > $2::timestamptz + interval '1 hour' AND appointment.starts_at <= $2::timestamptz + interval '24 hours'
        AND appointment.created_at <= appointment.starts_at - interval '24 hours'
      ORDER BY appointment.starts_at LIMIT 50`, [workspaceId, now]);
  for (const visit of visits.rows) {
    if (!visit.partyId) continue;
    sent.reminders += count(await quietly(db, () => sendClientEvent(db, { workspaceId, event: "crm.meeting.reminder", partyId: visit.partyId, leadId: visit.leadId,
      recordKey: `${visit.id}:${new Date(visit.startsAt).getTime()}`, record: { appointmentId: visit.id }, config: options.config })));
  }

  // An open enquiry whose client hasn't answered our last WhatsApp message.
  const quiet = await db.query<{ leadId: string; partyId: string; lastOutboundAt: Date | null; lastInboundAt: Date | null; sent: number }>(
    `SELECT lead.id AS "leadId", lead.party_id AS "partyId",
            (SELECT max(message.created_at) FROM crm_messages message WHERE message.workspace_id = chat.workspace_id AND message.conversation_id = chat.id AND message.direction = 'outbound') AS "lastOutboundAt",
            (SELECT max(message.created_at) FROM crm_messages message WHERE message.workspace_id = chat.workspace_id AND message.conversation_id = chat.id AND message.direction = 'inbound') AS "lastInboundAt",
            (SELECT count(*)::int FROM crm_messages message WHERE message.workspace_id = lead.workspace_id AND message.metadata->>'automatic' = 'crm.enquiry.quiet'
                AND message.metadata->>'eventKey' LIKE 'crm.enquiry.quiet:' || lead.id::text || ':%') AS sent
       FROM crm_leads lead
       JOIN LATERAL (SELECT chat.id, chat.workspace_id FROM crm_conversations chat WHERE chat.workspace_id = lead.workspace_id AND chat.party_id = lead.party_id AND chat.channel = 'whatsapp'
                      ORDER BY chat.last_message_at DESC NULLS LAST LIMIT 1) chat ON true
      WHERE lead.workspace_id = $1 AND lead.party_id IS NOT NULL AND lead.status IN ('new', 'attempting_contact', 'connected', 'nurturing')
      LIMIT 200`, [workspaceId]);
  for (const lead of quiet.rows) {
    const next = quietFollowUpDue({ lastOutboundAt: lead.lastOutboundAt ? new Date(lead.lastOutboundAt) : null, lastInboundAt: lead.lastInboundAt ? new Date(lead.lastInboundAt) : null, sent: lead.sent, now, settings });
    if (!next) continue;
    sent.quiet += count(await quietly(db, () => sendClientEvent(db, { workspaceId, event: "crm.enquiry.quiet", partyId: lead.partyId, leadId: lead.leadId,
      recordKey: `${lead.leadId}:${next}`, config: options.config,
      // A nudge is a reminder: it takes the client's one reminder of the day (a payment or decision reminder wins it first).
      gate: { key: `crm.enquiry.quiet:${lead.leadId}:${next}`, priority: 3 } })));
  }
  return sent;
}
