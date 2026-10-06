import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { caseFacts } from "../design/design-journey.store";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { startOfWorkingDay, workspaceClock, type Clock } from "../team-calendars/workspace-clock";
import { FREQUENCY_LABEL, nextCallDay, type Frequency } from "./client-calls.domain";

type Db = Pick<PoolClient, "query">;
const CALL_MINUTES = 30;

export type ClientCallsRow = {
  caseId: string; frequency: Frequency; ownerId: string | null; startedFrom: string; nextActivityId: string | null; nextOn: string | null; callsBooked: number; version: number;
};

export async function readClientCalls(db: Db, workspaceId: string, caseId: string, lock = false): Promise<ClientCallsRow | null> {
  const row = (await db.query<ClientCallsRow>(
    `SELECT case_id AS "caseId", frequency, owner_membership_id AS "ownerId", started_from AS "startedFrom", next_activity_id AS "nextActivityId",
            next_on::text AS "nextOn", calls_booked AS "callsBooked", version
       FROM client_update_calls WHERE workspace_id = $1 AND case_id = $2${lock ? " FOR UPDATE" : ""}`, [workspaceId, caseId])).rows[0];
  return row ? { ...row, callsBooked: Number(row.callsBooked), version: Number(row.version) } : null;
}

/**
 * Books one client update call on `day` in the Account Manager's calendar: a call activity with its appointment, at the
 * start of the firm's working day, or the first free half hour after it that day (the Account Manager's other
 * appointments are kept). Returns the activity and the instant.
 */
async function bookCall(db: Db, workspaceId: string, caseId: string, ownerId: string, day: string, clock: Clock, userId: string | null) {
  const facts = await caseFacts(db, workspaceId, caseId);
  if (!facts) return null;
  const opening = startOfWorkingDay(day, clock);
  let startsAt = opening;
  for (let step = 0; step < 16; step++) {
    const candidate = new Date(opening.getTime() + step * CALL_MINUTES * 60_000);
    const busy = (await db.query(
      `SELECT 1 FROM crm_appointments appointment JOIN crm_activities activity ON activity.workspace_id = appointment.workspace_id AND activity.id = appointment.activity_id
        WHERE appointment.workspace_id = $1 AND activity.status = 'pending' AND (activity.owner_membership_id = $2 OR appointment.attendee_membership_ids ? $2::text)
          AND tstzrange(appointment.starts_at, appointment.ends_at) && tstzrange($3::timestamptz, $4::timestamptz) LIMIT 1`,
      [workspaceId, ownerId, candidate.toISOString(), new Date(candidate.getTime() + CALL_MINUTES * 60_000).toISOString()])).rowCount;
    if (!busy) { startsAt = candidate; break; }
  }
  const endsAt = new Date(startsAt.getTime() + CALL_MINUTES * 60_000);
  const activity = (await db.query<{ id: string }>(
    `INSERT INTO crm_activities (workspace_id, party_id, lead_id, opportunity_id, type, interaction_direction, title, owner_membership_id, priority, due_at, is_next_action, customer_visible, created_by)
     VALUES ($1, $2, $3, $4, 'call'::crm_activity_type, 'outbound', $5, $6, 'normal', $7, false, false, $8) RETURNING id`,
    [workspaceId, facts.partyId, facts.leadId, facts.opportunityId, `Client update call · ${facts.clientName}`.slice(0, 240), ownerId, startsAt, userId])).rows[0];
  await db.query(
    `INSERT INTO crm_appointments (workspace_id, activity_id, starts_at, ends_at, timezone, attendee_party_ids, attendee_membership_ids) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [workspaceId, activity.id, startsAt, endsAt, clock.timeZone, JSON.stringify([facts.partyId]), JSON.stringify([ownerId])]);
  await db.query(
    `UPDATE client_update_calls SET next_activity_id = $3, next_on = $4, calls_booked = calls_booked + 1, updated_at = now() WHERE workspace_id = $1 AND case_id = $2`,
    [workspaceId, caseId, activity.id, day]);
  return { activityId: activity.id, startsAt, clientName: facts.clientName };
}

function formatWhen(at: Date, clock: Clock) {
  const options: Intl.DateTimeFormatOptions = { timeZone: clock.timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
  try { return new Intl.DateTimeFormat(clock.locale, options).format(at); } catch { return new Intl.DateTimeFormat("en", options).format(at); }
}

/**
 * Offers and books the recurring client update call when a job reaches the point it starts from: the design approval,
 * or the accepted estimate for a job without design. Weekly by default, in the Account Manager's calendar; they hear it
 * and can change how often or turn it off on the case. Idempotent: a job that already has its calls keeps them.
 */
export async function startClientCalls(db: Db, workspaceId: string, caseId: string, source: "design_approval" | "estimate_accepted" | "manual", userId: string | null, frequency: Exclude<Frequency, "off"> = "weekly") {
  const facts = await caseFacts(db, workspaceId, caseId);
  if (!facts) return null;
  const created = (await db.query(
    `INSERT INTO client_update_calls (workspace_id, case_id, frequency, owner_membership_id, started_from, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (workspace_id, case_id) DO NOTHING`, [workspaceId, caseId, frequency, facts.accountManagerId, source, userId])).rowCount;
  if (!created) return readClientCalls(db, workspaceId, caseId);
  const clock = await workspaceClock(db, workspaceId);
  const booked = facts.accountManagerId ? await bookCall(db, workspaceId, caseId, facts.accountManagerId, nextCallDay(clock.today, clock.today, frequency, clock), clock, userId) : null;
  await recordAudit(db, { workspaceId, actorUserId: userId, action: "client_calls.started.v1", entityType: "pre_project_case", entityId: caseId,
    after: { source, frequency, ownerMembershipId: facts.accountManagerId, firstCall: booked?.startsAt ?? null } });
  if (booked && facts.accountManagerId) {
    const owner = (await db.query<{ userId: string }>(`SELECT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, facts.accountManagerId])).rows[0];
    if (owner) {
      const message = { workspaceId, recipientUserId: owner.userId, code: "client_calls.booked", eventType: "client_calls.booked",
        variables: { clientName: booked.clientName, frequency: FREQUENCY_LABEL[frequency], when: formatWhen(booked.startsAt, clock) }, deepLink: `/workspace/pre-projects/cases/${caseId}/overview` };
      await notifyUserInApp(db, { ...message, idempotencyKey: `client-calls:${caseId}:started:${owner.userId}` });
      await queueUserEmail(db, { ...message, idempotencyKey: `client-calls:${caseId}:started:${owner.userId}:email` });
    }
  }
  return readClientCalls(db, workspaceId, caseId);
}

/** Cancels the booked call still ahead (calls turned off, or the Account Manager changed). */
async function cancelUpcoming(db: Db, workspaceId: string, row: ClientCallsRow) {
  if (!row.nextActivityId) return;
  await db.query(
    `UPDATE crm_activities activity SET status = 'cancelled', completion_outcome = 'Client update calls changed', version = activity.version + 1
       FROM crm_appointments appointment
      WHERE activity.workspace_id = $1 AND activity.id = $2 AND activity.status = 'pending'
        AND appointment.workspace_id = activity.workspace_id AND appointment.activity_id = activity.id AND appointment.starts_at > now()`, [workspaceId, row.nextActivityId]);
}

/**
 * Changes how often a job's client update calls run. Off cancels the call still ahead; turning them on (or on for the
 * first time) books the next one; between weekly, fortnightly and monthly the booked call stays and the one after
 * follows the new rhythm. Version-checked (0 when the job has none yet); audited.
 */
export async function setClientCallFrequency(db: Db, workspaceId: string, caseId: string, frequency: Frequency, version: number, userId: string) {
  const before = await readClientCalls(db, workspaceId, caseId, true);
  if ((before?.version ?? 0) !== version) return { conflict: true as const };
  if (!before) {
    if (frequency !== "off") await startClientCalls(db, workspaceId, caseId, "manual", userId, frequency);
    else {
      const facts = await caseFacts(db, workspaceId, caseId);
      await db.query(`INSERT INTO client_update_calls (workspace_id, case_id, frequency, owner_membership_id, started_from, created_by, updated_by) VALUES ($1, $2, 'off', $3, 'manual', $4, $4)`,
        [workspaceId, caseId, facts?.accountManagerId ?? null, userId]);
      await recordAudit(db, { workspaceId, actorUserId: userId, action: "client_calls.frequency_changed.v1", entityType: "pre_project_case", entityId: caseId, before: null, after: { frequency } });
    }
    return { conflict: false as const };
  }
  if (before.frequency === frequency) return { conflict: false as const };
  await db.query(`UPDATE client_update_calls SET frequency = $3, updated_by = $4, updated_at = now(), version = version + 1 WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId, frequency, userId]);
  if (frequency === "off") {
    await cancelUpcoming(db, workspaceId, before);
    await db.query(`UPDATE client_update_calls SET next_activity_id = NULL, next_on = NULL WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId]);
  } else if (before.frequency === "off") {
    const facts = await caseFacts(db, workspaceId, caseId);
    const owner = facts?.accountManagerId ?? before.ownerId;
    if (owner) {
      const clock = await workspaceClock(db, workspaceId);
      await db.query(`UPDATE client_update_calls SET owner_membership_id = $3 WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId, owner]);
      await bookCall(db, workspaceId, caseId, owner, nextCallDay(clock.today, clock.today, frequency, clock), clock, userId);
    }
  }
  await recordAudit(db, { workspaceId, actorUserId: userId, action: "client_calls.frequency_changed.v1", entityType: "pre_project_case", entityId: caseId,
    before: { frequency: before.frequency }, after: { frequency } });
  return { conflict: false as const };
}

/**
 * The daily pass for one workspace: every job with calls on whose booked call is done, cancelled or past gets its next
 * call, one interval after the last planned day, on a working day ahead. The Account Manager is read again each time,
 * so a job handed to someone else books with them. Idempotent: a job whose next call is still ahead is left alone.
 */
export async function processClientCalls(db: Db, workspaceId: string) {
  const due = (await db.query<{ caseId: string }>(
    `SELECT calls.case_id AS "caseId" FROM client_update_calls calls
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = calls.workspace_id AND pre_case.id = calls.case_id AND pre_case.status <> 'cancelled'
       LEFT JOIN crm_activities activity ON activity.workspace_id = calls.workspace_id AND activity.id = calls.next_activity_id
       LEFT JOIN crm_appointments appointment ON appointment.workspace_id = calls.workspace_id AND appointment.activity_id = calls.next_activity_id
      WHERE calls.workspace_id = $1 AND calls.frequency <> 'off'
        AND (activity.id IS NULL OR activity.status <> 'pending' OR coalesce(appointment.ends_at, activity.due_at) < now())
        AND NOT EXISTS (SELECT 1 FROM delivery_projects project WHERE project.workspace_id = pre_case.workspace_id AND project.case_id = pre_case.id AND project.status IN ('completed', 'cancelled', 'archived'))
      ORDER BY calls.case_id FOR UPDATE OF calls`, [workspaceId])).rows;
  if (!due.length) return { booked: 0 };
  const clock = await workspaceClock(db, workspaceId);
  let booked = 0;
  for (const { caseId } of due) {
    const row = await readClientCalls(db, workspaceId, caseId);
    if (!row || row.frequency === "off") continue;
    const facts = await caseFacts(db, workspaceId, caseId);
    const owner = facts?.accountManagerId ?? row.ownerId;
    if (!owner) continue;
    if (owner !== row.ownerId) await db.query(`UPDATE client_update_calls SET owner_membership_id = $3 WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId, owner]);
    const day = nextCallDay(row.nextOn ?? clock.today, clock.today, row.frequency, clock);
    if (await bookCall(db, workspaceId, caseId, owner, day, clock, null)) booked++;
  }
  return { booked };
}

/** The job's calls as the case shows them: how often, the next call and with whom. */
export async function clientCallsView(db: Db, workspaceId: string, caseId: string) {
  const row = await readClientCalls(db, workspaceId, caseId);
  const facts = await caseFacts(db, workspaceId, caseId);
  const ownerId = row?.ownerId ?? facts?.accountManagerId ?? null;
  const owner = ownerId ? (await db.query<{ name: string }>(
    `SELECT person.display_name AS name FROM workspace_memberships member JOIN users person ON person.id = member.user_id WHERE member.workspace_id = $1 AND member.id = $2`, [workspaceId, ownerId])).rows[0] : null;
  const next = row?.nextActivityId ? (await db.query<{ startsAt: Date; status: string }>(
    `SELECT appointment.starts_at AS "startsAt", activity.status::text AS status FROM crm_activities activity
       JOIN crm_appointments appointment ON appointment.workspace_id = activity.workspace_id AND appointment.activity_id = activity.id
      WHERE activity.workspace_id = $1 AND activity.id = $2`, [workspaceId, row.nextActivityId])).rows[0] : null;
  return {
    caseId, frequency: row?.frequency ?? "off", started: Boolean(row), startedFrom: row?.startedFrom ?? null, version: row?.version ?? 0, ownerName: owner?.name ?? null,
    hasOwner: Boolean(ownerId), next: next && next.status === "pending" ? { activityId: row!.nextActivityId, startsAt: new Date(next.startsAt).toISOString() } : null,
  };
}
