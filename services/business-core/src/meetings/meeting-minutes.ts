import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-153: the minutes of a client meeting. Any meeting or call with its time on the calendar (the intro, the kick-off,
 * a site visit, a sample meeting, value engineering, a client update call...) carries one set of minutes: the text,
 * optional photos and PDFs, who wrote it, and whether the client sees it in the portal. Every save is a revision, so an
 * edit after sharing keeps what the client saw before. The client comments in the portal; the team answers there.
 */
export const MAX_MINUTES_FILES = 20;
export const MAX_MINUTES_BODY = 20000;
export const MAX_COMMENT = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The meeting the minutes belong to, with the client's case (from its deal, or its enquiry's deal) when there is one. */
export type MeetingFacts = {
  activityId: string; type: string; status: "pending" | "completed" | "cancelled"; title: string; startsAt: string | null; endsAt: string | null; timezone: string | null;
  ownerMembershipId: string | null; attendeeMembershipIds: string[]; partyId: string | null; clientName: string; caseId: string | null;
};

export async function readMeeting(db: Db, workspaceId: string, activityId: string, lock = false): Promise<MeetingFacts | null> {
  if (lock) await db.query(`SELECT 1 FROM crm_activities WHERE workspace_id = $1 AND id = $2 FOR UPDATE`, [workspaceId, activityId]);
  const row = (await db.query<MeetingFacts & { attendees: unknown }>(
    `SELECT activity.id AS "activityId", activity.type::text AS type, activity.status::text AS status, activity.title,
            appointment.starts_at AS "startsAt", appointment.ends_at AS "endsAt", appointment.timezone, activity.owner_membership_id AS "ownerMembershipId",
            coalesce(appointment.attendee_membership_ids, '[]'::jsonb) AS attendees, party.id AS "partyId", coalesce(party.display_name, '') AS "clientName",
            (SELECT pre_case.id FROM pre_project_cases pre_case
              WHERE pre_case.workspace_id = activity.workspace_id
                AND pre_case.opportunity_id = coalesce(activity.opportunity_id,
                  (SELECT deal.id FROM crm_opportunities deal WHERE deal.workspace_id = activity.workspace_id AND deal.lead_id = activity.lead_id ORDER BY deal.created_at DESC LIMIT 1))
              ORDER BY pre_case.created_at LIMIT 1) AS "caseId"
       FROM crm_activities activity
       LEFT JOIN crm_appointments appointment ON appointment.workspace_id = activity.workspace_id AND appointment.activity_id = activity.id
       LEFT JOIN crm_leads lead ON lead.workspace_id = activity.workspace_id AND lead.id = activity.lead_id
       LEFT JOIN crm_opportunities opportunity ON opportunity.workspace_id = activity.workspace_id AND opportunity.id = activity.opportunity_id
       LEFT JOIN crm_parties party ON party.workspace_id = activity.workspace_id AND party.id = coalesce(activity.party_id, lead.party_id, opportunity.party_id)
      WHERE activity.workspace_id = $1 AND activity.id = $2`, [workspaceId, activityId])).rows[0];
  if (!row) return null;
  const attendees = Array.isArray(row.attendees) ? row.attendees.filter((id): id is string => typeof id === "string") : [];
  return { ...row, attendeeMembershipIds: attendees, startsAt: row.startsAt ? new Date(row.startsAt).toISOString() : null, endsAt: row.endsAt ? new Date(row.endsAt).toISOString() : null };
}

/** Why minutes can't be written for this meeting now, or null: a meeting or call on the calendar, not cancelled, that has started. */
export function minutesProblem(meeting: Pick<MeetingFacts, "type" | "status" | "startsAt">, now: Date) {
  if (meeting.type !== "meeting" && meeting.type !== "call") return "Minutes are written for meetings and calls.";
  if (!meeting.startsAt) return "Give the meeting its time first.";
  if (meeting.status === "cancelled") return "This meeting was cancelled.";
  if (Date.parse(meeting.startsAt) > now.getTime()) return "Minutes can be written once the meeting has started.";
  return null;
}

export type MinutesInput = { minutesId: string; version: number; title: string; body: string; fileIds: string[]; shared: boolean };

/** Validates the minutes as saved: a title, the text (the minutes themselves), up to 20 files of this meeting, shared or not. */
export function parseMinutes(body: Record<string, unknown>): MinutesInput {
  const minutesId = typeof body.minutesId === "string" && UUID.test(body.minutesId) ? body.minutesId : "";
  if (!minutesId) throw new BadRequestException("The minutes aren't valid.");
  if (!Number.isInteger(body.version) || (body.version as number) < 0) throw new BadRequestException("Reload the meeting and try again.");
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) throw new BadRequestException("Give the minutes a title.");
  if (title.length > 200) throw new BadRequestException("Keep the title under 200 characters.");
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) throw new BadRequestException("Write the minutes.");
  if (text.length > MAX_MINUTES_BODY) throw new BadRequestException(`Keep the minutes under ${MAX_MINUTES_BODY} characters.`);
  const fileIds = body.fileIds === undefined ? [] : Array.isArray(body.fileIds) && body.fileIds.every((id) => typeof id === "string" && UUID.test(id)) ? [...new Set(body.fileIds as string[])] : null;
  if (!fileIds) throw new BadRequestException("The files aren't valid.");
  if (fileIds.length > MAX_MINUTES_FILES) throw new BadRequestException(`Attach up to ${MAX_MINUTES_FILES} files.`);
  if (typeof body.shared !== "boolean") throw new BadRequestException("Say whether the client sees the minutes.");
  return { minutesId, version: body.version as number, title, body: text, fileIds, shared: body.shared };
}

export type MinutesRow = {
  id: string; activityId: string; title: string; body: string; fileIds: string[]; revision: number; sharedAt: string | null; sharedRevision: number | null;
  createdBy: string; authorName: string; createdAt: string; updatedAt: string; updatedByName: string; version: number;
};

const MINUTES_SELECT = `SELECT minutes.id, minutes.activity_id AS "activityId", minutes.title, minutes.body, minutes.file_ids AS "fileIds", minutes.revision,
  minutes.shared_at AS "sharedAt", minutes.shared_revision AS "sharedRevision", minutes.created_by AS "createdBy",
  coalesce(author.display_name, author.primary_email) AS "authorName", minutes.created_at AS "createdAt", minutes.updated_at AS "updatedAt",
  coalesce(editor.display_name, editor.primary_email) AS "updatedByName", minutes.version
  FROM meeting_minutes minutes JOIN users author ON author.id = minutes.created_by JOIN users editor ON editor.id = minutes.updated_by`;

export async function readMinutes(db: Db, workspaceId: string, activityId: string, lock = false): Promise<MinutesRow | null> {
  return (await db.query<MinutesRow>(`${MINUTES_SELECT} WHERE minutes.workspace_id = $1 AND minutes.activity_id = $2 ${lock ? "FOR UPDATE OF minutes" : ""}`,
    [workspaceId, activityId])).rows[0] ?? null;
}

/**
 * Saves the minutes as a new revision (the first save creates them; the version guards two people editing at once).
 * Nothing changed is no save. Turning sharing on shares the current revision; turning it off takes them off the portal.
 */
export async function saveMinutes(db: Db, input: MinutesInput & { workspaceId: string; activityId: string; userId: string }) {
  const current = await readMinutes(db, input.workspaceId, input.activityId, true);
  if (current ? current.version !== input.version || current.id !== input.minutesId : input.version !== 0)
    throw new ConflictException("Someone else changed these minutes. Reload to see their changes.");
  if (input.fileIds.length) {
    const known = (await db.query<{ id: string }>(`SELECT id FROM meeting_minutes_files WHERE workspace_id = $1 AND activity_id = $2 AND id = ANY($3::uuid[])`,
      [input.workspaceId, input.activityId, input.fileIds])).rows.map((row) => row.id);
    if (known.length !== input.fileIds.length) throw new BadRequestException("Attach files added to this meeting.");
  }
  const wasShared = Boolean(current?.sharedAt);
  if (current && current.title === input.title && current.body === input.body && sameIds(current.fileIds, input.fileIds) && wasShared === input.shared)
    return { minutes: current, changed: false, newlyShared: false };
  const revision = (current?.revision ?? 0) + 1;
  if (!current)
    await db.query(
      `INSERT INTO meeting_minutes (id, workspace_id, activity_id, title, body, file_ids, revision, shared_at, shared_by, shared_revision, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6::uuid[], 1, CASE WHEN $7::boolean THEN now() END, CASE WHEN $7::boolean THEN $8::uuid END, CASE WHEN $7::boolean THEN 1 END, $8, $8)`,
      [input.minutesId, input.workspaceId, input.activityId, input.title, input.body, input.fileIds, input.shared, input.userId]);
  else
    await db.query(
      `UPDATE meeting_minutes SET title = $3, body = $4, file_ids = $5::uuid[], revision = $6,
              shared_at = CASE WHEN $7::boolean THEN coalesce(shared_at, now()) END, shared_by = CASE WHEN $7::boolean THEN coalesce(shared_by, $8::uuid) END,
              shared_revision = CASE WHEN $7::boolean THEN coalesce(shared_revision, $6) END,
              updated_by = $8, updated_at = now(), version = version + 1
        WHERE workspace_id = $1 AND id = $2`,
      [input.workspaceId, current.id, input.title, input.body, input.fileIds, revision, input.shared, input.userId]);
  await db.query(
    `INSERT INTO meeting_minutes_revisions (workspace_id, minutes_id, revision, title, body, file_ids, shared, created_by) VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7, $8)`,
    [input.workspaceId, input.minutesId, revision, input.title, input.body, input.fileIds, input.shared, input.userId]);
  const minutes = (await readMinutes(db, input.workspaceId, input.activityId))!;
  return { minutes, changed: true, newlyShared: input.shared && !wasShared, before: current };
}

const sameIds = (left: string[], right: string[]) => left.length === right.length && left.every((id, index) => id === right[index]);

export type MinutesRevision = { revision: number; title: string; body: string; fileIds: string[]; shared: boolean; byName: string; at: string };

/** Every saved revision, the latest first (what the team sees as the minutes' history). */
export async function readRevisions(db: Db, workspaceId: string, minutesId: string): Promise<MinutesRevision[]> {
  return (await db.query<MinutesRevision>(
    `SELECT revision.revision, revision.title, revision.body, revision.file_ids AS "fileIds", revision.shared, coalesce(person.display_name, person.primary_email) AS "byName",
            revision.created_at AS at
       FROM meeting_minutes_revisions revision JOIN users person ON person.id = revision.created_by
      WHERE revision.workspace_id = $1 AND revision.minutes_id = $2 ORDER BY revision.revision DESC`, [workspaceId, minutesId])).rows;
}

export type MinutesFile = { id: string; name: string; mimeType: string; byteSize: number; hasPreview: boolean; byName: string; at: string };

/** The files added to a meeting's minutes (the ones a revision keeps are listed by id on it). */
export async function readMeetingFiles(db: Db, workspaceId: string, activityId: string): Promise<MinutesFile[]> {
  return (await db.query<MinutesFile>(
    `SELECT file.id, file.original_name AS name, file.mime_type AS "mimeType", file.byte_size AS "byteSize", file.preview_key IS NOT NULL AS "hasPreview",
            coalesce(person.display_name, person.primary_email) AS "byName", file.created_at AS at
       FROM meeting_minutes_files file JOIN users person ON person.id = file.created_by
      WHERE file.workspace_id = $1 AND file.activity_id = $2 ORDER BY file.created_at, file.id`, [workspaceId, activityId])).rows;
}

export type MinutesComment = { id: string; at: string; text: string; fromClient: boolean; author: string };

/** The conversation on the minutes, oldest first: the client's comments (by name) and the team's replies. */
export async function readComments(db: Db, workspaceId: string, minutesId: string, team: "names" | "team" = "names"): Promise<MinutesComment[]> {
  return (await db.query<{ id: string; at: string; text: string; fromClient: boolean; clientName: string | null; staffName: string | null }>(
    `SELECT comment.id, comment.created_at AS at, comment.body AS text, comment.grant_id IS NOT NULL AS "fromClient",
            coalesce(grant_row.confirmed_name, grant_row.name) AS "clientName", coalesce(person.display_name, person.primary_email) AS "staffName"
       FROM meeting_minutes_comments comment
       LEFT JOIN client_portal_grants grant_row ON grant_row.workspace_id = comment.workspace_id AND grant_row.id = comment.grant_id
       LEFT JOIN users person ON person.id = comment.author_user_id
      WHERE comment.workspace_id = $1 AND comment.minutes_id = $2 ORDER BY comment.created_at, comment.id`, [workspaceId, minutesId])).rows
    .map((row) => ({ id: row.id, at: new Date(row.at).toISOString(), text: row.text, fromClient: row.fromClient,
      // The client reads the team as one team, never a person's name.
      author: row.fromClient ? row.clientName ?? "" : team === "names" ? row.staffName ?? "" : "" }));
}

/** A comment on shared minutes: the client's (by their portal contact) or a team reply (by a person). */
export async function addComment(db: Db, input: { workspaceId: string; minutesId: string; commentId: string; text: unknown; grant?: { id: string; caseId: string }; userId?: string }) {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) throw new BadRequestException("Write your comment.");
  if (text.length > MAX_COMMENT) throw new BadRequestException(`Keep it under ${MAX_COMMENT} characters.`);
  const shared = (await db.query(`SELECT 1 FROM meeting_minutes WHERE workspace_id = $1 AND id = $2 AND shared_at IS NOT NULL`, [input.workspaceId, input.minutesId])).rowCount;
  if (!shared) throw new NotFoundException("These minutes aren't shared.");
  await db.query(
    `INSERT INTO meeting_minutes_comments (id, workspace_id, minutes_id, case_id, grant_id, author_user_id, body) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO NOTHING`,
    [input.commentId, input.workspaceId, input.minutesId, input.grant?.caseId ?? null, input.grant?.id ?? null, input.grant ? null : input.userId ?? null, text]);
  return text;
}

/**
 * The shared minutes of a case's meetings, for the client: meetings of its deal, or of the enquiry the deal came from
 * (shared before the deal existed). The latest revision, its files, when it was first shared and whether it changed since.
 */
export async function readSharedMinutes(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ id: string; activityId: string; title: string; body: string; fileIds: string[]; meetingAt: string | null; sharedAt: string; updated: boolean; updatedAt: string }>(
    `SELECT minutes.id, minutes.activity_id AS "activityId", minutes.title, minutes.body, minutes.file_ids AS "fileIds", appointment.starts_at AS "meetingAt",
            minutes.shared_at AS "sharedAt", minutes.revision > minutes.shared_revision AS updated, minutes.updated_at AS "updatedAt"
       FROM pre_project_cases pre_case
       JOIN crm_opportunities deal ON deal.workspace_id = pre_case.workspace_id AND deal.id = pre_case.opportunity_id
       JOIN crm_activities activity ON activity.workspace_id = pre_case.workspace_id
        AND (activity.opportunity_id = deal.id OR (activity.opportunity_id IS NULL AND deal.lead_id IS NOT NULL AND activity.lead_id = deal.lead_id))
       JOIN meeting_minutes minutes ON minutes.workspace_id = activity.workspace_id AND minutes.activity_id = activity.id AND minutes.shared_at IS NOT NULL
       LEFT JOIN crm_appointments appointment ON appointment.workspace_id = activity.workspace_id AND appointment.activity_id = activity.id
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2 AND activity.status <> 'cancelled'
      ORDER BY coalesce(appointment.starts_at, minutes.shared_at) DESC, minutes.id`, [workspaceId, caseId])).rows;
}

/** Whether these shared minutes belong to the case (the client comments only on their own project's minutes). */
export async function minutesOfCase(db: Db, workspaceId: string, caseId: string, minutesId: string) {
  return (await readSharedMinutes(db, workspaceId, caseId)).find((minutes) => minutes.id === minutesId) ?? null;
}
