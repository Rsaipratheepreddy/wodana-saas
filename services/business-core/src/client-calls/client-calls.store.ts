import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { caseFacts } from "../design/design-journey.store";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { endOfWorkingDay, startOfWorkingDay, workspaceClock, type Clock } from "../team-calendars/workspace-clock";
import { FREQUENCY_LABEL, nextCallDay, planChange, type Frequency, type Mode } from "./client-calls.domain";

type Db = Pick<PoolClient, "query">;
const CALL_MINUTES = 30;

export type ClientCallsRow = {
  caseId: string; frequency: Frequency; mode: Mode; ownerId: string | null; startedFrom: string; nextActivityId: string | null; nextOn: string | null; callsBooked: number; version: number;
};

export async function readClientCalls(db: Db, workspaceId: string, caseId: string, lock = false): Promise<ClientCallsRow | null> {
  const row = (await db.query<ClientCallsRow>(
    `SELECT case_id AS "caseId", frequency, mode, owner_membership_id AS "ownerId", started_from AS "startedFrom", next_activity_id AS "nextActivityId",
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

/**
 * PLM-046 portal mode: instead of a call, the Account Manager is reminded on `day` to post a progress update to the
 * client portal. A task in their name, due by the end of that working day; the notice goes out on the day itself.
 */
async function remindUpdate(db: Db, workspaceId: string, caseId: string, ownerId: string, day: string, clock: Clock, userId: string | null) {
  const facts = await caseFacts(db, workspaceId, caseId);
  if (!facts) return null;
  const activity = (await db.query<{ id: string }>(
    `INSERT INTO crm_activities (workspace_id, party_id, lead_id, opportunity_id, type, interaction_direction, title, owner_membership_id, priority, due_at, is_next_action, customer_visible, created_by)
     VALUES ($1, $2, $3, $4, 'task'::crm_activity_type, 'internal', $5, $6, 'normal', $7, false, false, $8) RETURNING id`,
    [workspaceId, facts.partyId, facts.leadId, facts.opportunityId, `Post a progress update · ${facts.clientName}`.slice(0, 240), ownerId, endOfWorkingDay(day, clock), userId])).rows[0];
  await db.query(`UPDATE client_update_calls SET next_activity_id = $3, next_on = $4, updated_at = now() WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId, activity.id, day]);
  return { activityId: activity.id };
}

/** The next call, or the next reminder to post an update, on `day`. */
function planNext(db: Db, workspaceId: string, caseId: string, mode: Mode, ownerId: string, day: string, clock: Clock, userId: string | null) {
  return mode === "portal" ? remindUpdate(db, workspaceId, caseId, ownerId, day, clock, userId) : bookCall(db, workspaceId, caseId, ownerId, day, clock, userId);
}

async function ownerUser(db: Db, workspaceId: string, membershipId: string) {
  return (await db.query<{ userId: string }>(`SELECT user_id AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = $2 AND status = 'active'`, [workspaceId, membershipId])).rows[0]?.userId ?? null;
}

/** Where the Account Manager posts the update: the running project's updates, else the case. */
async function updatesLink(db: Db, workspaceId: string, caseId: string) {
  const project = (await db.query<{ id: string }>(
    `SELECT id FROM delivery_projects WHERE workspace_id = $1 AND case_id = $2 AND started_at IS NOT NULL AND status IN ('active', 'on_hold') ORDER BY started_at DESC LIMIT 1`,
    [workspaceId, caseId])).rows[0];
  return project ? `/workspace/projects/${project.id}/updates` : `/workspace/pre-projects/cases/${caseId}/overview`;
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
export async function startClientCalls(db: Db, workspaceId: string, caseId: string, source: "design_approval" | "estimate_accepted" | "manual", userId: string | null,
  frequency: Exclude<Frequency, "off"> = "weekly", mode: Mode = "call") {
  const facts = await caseFacts(db, workspaceId, caseId);
  if (!facts) return null;
  const created = (await db.query(
    `INSERT INTO client_update_calls (workspace_id, case_id, frequency, mode, owner_membership_id, started_from, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (workspace_id, case_id) DO NOTHING`, [workspaceId, caseId, frequency, mode, facts.accountManagerId, source, userId])).rowCount;
  if (!created) return readClientCalls(db, workspaceId, caseId);
  const clock = await workspaceClock(db, workspaceId);
  const day = nextCallDay(clock.today, clock.today, frequency, clock);
  const owner = facts.accountManagerId;
  const booked = owner && mode === "call" ? await bookCall(db, workspaceId, caseId, owner, day, clock, userId) : null;
  const planned = owner && mode === "portal" ? await remindUpdate(db, workspaceId, caseId, owner, day, clock, userId) : booked;
  await recordAudit(db, { workspaceId, actorUserId: userId, action: "client_calls.started.v1", entityType: "pre_project_case", entityId: caseId,
    after: { source, frequency, mode, ownerMembershipId: facts.accountManagerId, firstCall: booked?.startsAt ?? null, firstUpdateDue: mode === "portal" && planned ? day : null } });
  const recipient = booked && owner ? await ownerUser(db, workspaceId, owner) : null;
  if (booked && recipient) {
    const message = { workspaceId, recipientUserId: recipient, code: "client_calls.booked", eventType: "client_calls.booked",
      variables: { clientName: booked.clientName, frequency: FREQUENCY_LABEL[frequency], when: formatWhen(booked.startsAt, clock) }, deepLink: `/workspace/pre-projects/cases/${caseId}/overview` };
    await notifyUserInApp(db, { ...message, idempotencyKey: `client-calls:${caseId}:started:${recipient}` });
    await queueUserEmail(db, { ...message, idempotencyKey: `client-calls:${caseId}:started:${recipient}:email` });
  }
  return readClientCalls(db, workspaceId, caseId);
}

/** Cancels what is planned ahead: the booked call still to come, or the pending reminder to post an update. */
async function cancelUpcoming(db: Db, workspaceId: string, row: ClientCallsRow) {
  if (!row.nextActivityId) return;
  await db.query(
    `UPDATE crm_activities activity SET status = 'cancelled', completion_outcome = 'Client updates changed', version = activity.version + 1
      WHERE activity.workspace_id = $1 AND activity.id = $2 AND activity.status = 'pending'
        AND (activity.type = 'task' OR EXISTS (SELECT 1 FROM crm_appointments appointment WHERE appointment.workspace_id = activity.workspace_id
                                                 AND appointment.activity_id = activity.id AND appointment.starts_at > now()))`, [workspaceId, row.nextActivityId]);
}

/**
 * Changes how a job's client updates run: by call or by a progress update in the client portal, and how often. Off
 * cancels what is planned ahead; turning them on, or going from calls to portal updates (or back), cancels the planned
 * one and plans the next from today; between weekly, fortnightly and monthly in the same mode the planned one stays and
 * the one after follows the new rhythm. Version-checked (0 when the job has none yet); audited, with who chose it (the
 * team, or the client in the portal, who has no user and is recorded by the portal command).
 */
export async function setClientCalls(db: Db, workspaceId: string, caseId: string, input: { frequency: Frequency; mode?: Mode }, version: number, userId: string | null,
  by: "team" | "client" = "team") {
  const before = await readClientCalls(db, workspaceId, caseId, true);
  if ((before?.version ?? 0) !== version) return { conflict: true as const, changed: false };
  const { frequency } = input;
  const mode = input.mode ?? before?.mode ?? "call";
  const source = by === "client" ? "client_portal" as const : "user" as const;
  if (!before) {
    if (frequency !== "off") await startClientCalls(db, workspaceId, caseId, "manual", userId, frequency, mode);
    else {
      const facts = await caseFacts(db, workspaceId, caseId);
      await db.query(`INSERT INTO client_update_calls (workspace_id, case_id, frequency, mode, owner_membership_id, started_from, created_by, updated_by) VALUES ($1, $2, 'off', $3, $4, 'manual', $5, $5)`,
        [workspaceId, caseId, mode, facts?.accountManagerId ?? null, userId]);
      await recordAudit(db, { workspaceId, actorUserId: userId, source, action: "client_calls.frequency_changed.v1", entityType: "pre_project_case", entityId: caseId, before: null, after: { frequency, mode, by } });
    }
    return { conflict: false as const, changed: true };
  }
  const plan = planChange(before, { mode, frequency });
  if (!plan.changed) return { conflict: false as const, changed: false };
  await db.query(`UPDATE client_update_calls SET frequency = $3, mode = $4, updated_by = $5, updated_at = now(), version = version + 1 WHERE workspace_id = $1 AND case_id = $2`,
    [workspaceId, caseId, frequency, mode, userId]);
  if (plan.cancel) {
    await cancelUpcoming(db, workspaceId, before);
    await db.query(`UPDATE client_update_calls SET next_activity_id = NULL, next_on = NULL WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId]);
  }
  if (plan.plan && frequency !== "off") {
    const facts = await caseFacts(db, workspaceId, caseId);
    const owner = facts?.accountManagerId ?? before.ownerId;
    if (owner) {
      const clock = await workspaceClock(db, workspaceId);
      await db.query(`UPDATE client_update_calls SET owner_membership_id = $3 WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId, owner]);
      await planNext(db, workspaceId, caseId, mode, owner, nextCallDay(clock.today, clock.today, frequency, clock), clock, userId);
    }
  }
  await recordAudit(db, { workspaceId, actorUserId: userId, source, action: before.mode !== mode ? "client_calls.mode_changed.v1" : "client_calls.frequency_changed.v1",
    entityType: "pre_project_case", entityId: caseId, before: { frequency: before.frequency, mode: before.mode }, after: { frequency, mode, by } });
  return { conflict: false as const, changed: true };
}

/**
 * The daily pass for one workspace. Calls: every job with calls on whose booked call is done, cancelled or past gets
 * its next call, one interval after the last planned day, on a working day ahead. Portal updates: a reminder is
 * closed when an update was shared with the client since it was set; one done, cancelled or past gets the next on the
 * same rhythm; and on its day the Account Manager is told (in the app and by email, once per job and day). The Account
 * Manager is read again each time, so a job handed to someone else plans with them. Idempotent: a job whose next call or
 * reminder is still ahead is left alone.
 */
export async function processClientCalls(db: Db, workspaceId: string) {
  if (!(await db.query(`SELECT 1 FROM client_update_calls WHERE workspace_id = $1 AND frequency <> 'off' LIMIT 1`, [workspaceId])).rowCount) return { booked: 0 };
  // An update shared with the client since the reminder was set closes it.
  await db.query(
    `UPDATE crm_activities activity SET status = 'completed', completed_at = now(), completion_outcome = 'Progress update shared', version = activity.version + 1
       FROM client_update_calls calls
      WHERE calls.workspace_id = $1 AND calls.mode = 'portal' AND calls.frequency <> 'off'
        AND activity.workspace_id = calls.workspace_id AND activity.id = calls.next_activity_id AND activity.type = 'task' AND activity.status = 'pending'
        AND EXISTS (SELECT 1 FROM delivery_projects project JOIN project_status_updates shared ON shared.workspace_id = project.workspace_id AND shared.project_id = project.id
                     WHERE project.workspace_id = calls.workspace_id AND project.case_id = calls.case_id AND shared.shared_at > activity.created_at)`, [workspaceId]);
  const due = (await db.query<{ caseId: string }>(
    `SELECT calls.case_id AS "caseId" FROM client_update_calls calls
       JOIN pre_project_cases pre_case ON pre_case.workspace_id = calls.workspace_id AND pre_case.id = calls.case_id AND pre_case.status <> 'cancelled'
       LEFT JOIN crm_activities activity ON activity.workspace_id = calls.workspace_id AND activity.id = calls.next_activity_id
       LEFT JOIN crm_appointments appointment ON appointment.workspace_id = calls.workspace_id AND appointment.activity_id = calls.next_activity_id
      WHERE calls.workspace_id = $1 AND calls.frequency <> 'off'
        AND (activity.id IS NULL OR activity.status <> 'pending' OR coalesce(appointment.ends_at, activity.due_at) < now())
        AND NOT EXISTS (SELECT 1 FROM delivery_projects project WHERE project.workspace_id = pre_case.workspace_id AND project.case_id = pre_case.id AND project.status IN ('completed', 'cancelled', 'archived'))
      ORDER BY calls.case_id FOR UPDATE OF calls`, [workspaceId])).rows;
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
    if (await planNext(db, workspaceId, caseId, row.mode, owner, day, clock, null)) booked++;
  }
  await tellUpdatesDue(db, workspaceId, clock);
  return { booked };
}

/** On the day a portal update is due, the Account Manager hears it: in the app and by email, once per job and day. */
async function tellUpdatesDue(db: Db, workspaceId: string, clock: Clock) {
  const today = (await db.query<{ caseId: string; frequency: Exclude<Frequency, "off">; ownerId: string; day: string }>(
    `SELECT calls.case_id AS "caseId", calls.frequency, activity.owner_membership_id AS "ownerId", calls.next_on::text AS day FROM client_update_calls calls
       JOIN crm_activities activity ON activity.workspace_id = calls.workspace_id AND activity.id = calls.next_activity_id AND activity.status = 'pending'
      WHERE calls.workspace_id = $1 AND calls.mode = 'portal' AND calls.frequency <> 'off' AND calls.next_on = $2::date`, [workspaceId, clock.today])).rows;
  for (const row of today) {
    const [userId, facts] = [await ownerUser(db, workspaceId, row.ownerId), await caseFacts(db, workspaceId, row.caseId)];
    if (!userId || !facts) continue;
    const message = { workspaceId, recipientUserId: userId, code: "client_calls.portal_update_due", eventType: "client_calls.portal_update_due",
      variables: { clientName: facts.clientName, frequency: FREQUENCY_LABEL[row.frequency], when: formatDay(row.day, clock) }, deepLink: await updatesLink(db, workspaceId, row.caseId) };
    await notifyUserInApp(db, { ...message, idempotencyKey: `client-calls:${row.caseId}:portal-update:${row.day}` });
    await queueUserEmail(db, { ...message, idempotencyKey: `client-calls:${row.caseId}:portal-update:${row.day}:email` });
  }
}

function formatDay(day: string, clock: Clock) {
  const options: Intl.DateTimeFormatOptions = { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" };
  const at = new Date(`${day}T12:00:00Z`);
  try { return new Intl.DateTimeFormat(clock.locale, options).format(at); } catch { return new Intl.DateTimeFormat("en", options).format(at); }
}

/** The job's client updates as the case shows them: by call or in the portal, how often, the next one and with whom. */
export async function clientCallsView(db: Db, workspaceId: string, caseId: string) {
  const row = await readClientCalls(db, workspaceId, caseId);
  const facts = await caseFacts(db, workspaceId, caseId);
  const ownerId = row?.ownerId ?? facts?.accountManagerId ?? null;
  const owner = ownerId ? (await db.query<{ name: string }>(
    `SELECT person.display_name AS name FROM workspace_memberships member JOIN users person ON person.id = member.user_id WHERE member.workspace_id = $1 AND member.id = $2`, [workspaceId, ownerId])).rows[0] : null;
  const next = row?.nextActivityId ? (await db.query<{ startsAt: Date; status: string }>(
    `SELECT coalesce(appointment.starts_at, activity.due_at) AS "startsAt", activity.status::text AS status FROM crm_activities activity
       LEFT JOIN crm_appointments appointment ON appointment.workspace_id = activity.workspace_id AND appointment.activity_id = activity.id
      WHERE activity.workspace_id = $1 AND activity.id = $2`, [workspaceId, row.nextActivityId])).rows[0] : null;
  return {
    caseId, frequency: row?.frequency ?? "off", mode: row?.mode ?? "call", started: Boolean(row), startedFrom: row?.startedFrom ?? null, version: row?.version ?? 0, ownerName: owner?.name ?? null,
    hasOwner: Boolean(ownerId), next: next && next.status === "pending" ? { activityId: row!.nextActivityId, startsAt: new Date(next.startsAt).toISOString(), on: row!.nextOn } : null,
  };
}
