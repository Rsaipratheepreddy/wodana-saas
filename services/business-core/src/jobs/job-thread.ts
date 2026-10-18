import { BadRequestException, UnprocessableEntityException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { notifyUserInApp } from "../notifications/default-templates";
import { queueTeamPush } from "../notifications/push-templates";
import { readCaseTeam } from "../project-core/project-team";

type Db = Pick<PoolClient, "query">;

/**
 * §0.3, the job's team thread: one conversation per job for the people working it (never the client). Messages may
 * mention team members (each hears it in the app, linked to the thread); the job's own events appear as lines, once
 * each. Messages are rows; nothing is kept in JSON.
 */
export type ThreadMessage = { id: string; kind: "message" | "event"; author: { id: string; name: string } | null; body: string; mentions: string[]; eventCode: string | null;
  at: string; mine: boolean };
export type JobThread = { messages: ThreadMessage[]; people: Array<{ membershipId: string; name: string; role: string | null }>; unread: number; lastReadAt: string | null };

const MAX_BODY = 4000;

/** The job a record belongs to (a case, project, opportunity or lead), or null. */
export async function jobOfRecord(db: Db, workspaceId: string, record: { type: string; id: string }) {
  return (await db.query<{ jobId: string }>(
    `SELECT job_id::text AS "jobId" FROM job_identity_links WHERE workspace_id = $1 AND record_type = $2 AND record_id = $3 AND status = 'active' LIMIT 1`,
    [workspaceId, record.type, record.id])).rows[0]?.jobId ?? null;
}

/** Adds one of the job's events to its thread as a line (once per event and record); nothing when the record has no job. */
export async function postJobEvent(db: Db, workspaceId: string, input: { record: { type: string; id: string }; code: string; ref: string; body: string }) {
  const jobId = await jobOfRecord(db, workspaceId, input.record);
  if (!jobId) return null;
  await db.query(
    `INSERT INTO job_messages (workspace_id, id, job_id, kind, body, event_code, event_ref, created_at) VALUES ($1, $2, $3, 'event', $4, $5, $6, clock_timestamp())
     ON CONFLICT (workspace_id, job_id, event_code, event_ref) WHERE kind = 'event' AND event_ref IS NOT NULL DO NOTHING`,
    [workspaceId, randomUUID(), jobId, input.body.slice(0, MAX_BODY), input.code.slice(0, 60), input.ref.slice(0, 160)]);
  return jobId;
}

/** The people who may be mentioned on a job: its team by role, and the opportunity's owner. */
export async function jobPeople(db: Db, workspaceId: string, jobId: string) {
  const caseId = (await db.query<{ id: string }>(`SELECT record_id::text AS id FROM job_identity_links WHERE workspace_id = $1 AND job_id = $2 AND record_type = 'case' AND status = 'active' LIMIT 1`,
    [workspaceId, jobId])).rows[0]?.id;
  const team = caseId ? (await readCaseTeam(db, workspaceId, caseId)).filter((entry) => entry.member) : [];
  const owner = (await db.query<{ membershipId: string; name: string }>(
    `SELECT member.id AS "membershipId", coalesce(person.display_name, person.primary_email) AS name FROM job_identity_links link
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = link.workspace_id AND opportunity.id::text = link.record_id
       JOIN workspace_memberships member ON member.workspace_id = opportunity.workspace_id AND member.id = opportunity.owner_membership_id AND member.status = 'active'
       JOIN users person ON person.id = member.user_id
      WHERE link.workspace_id = $1 AND link.job_id = $2 AND link.record_type = 'opportunity' AND link.status = 'active' LIMIT 1`, [workspaceId, jobId])).rows[0];
  const list = new Map<string, { membershipId: string; name: string; role: string | null }>();
  for (const entry of team) {
    const known = list.get(entry.member!.membershipId);
    list.set(entry.member!.membershipId, { membershipId: entry.member!.membershipId, name: entry.member!.name, role: known?.role ? `${known.role} · ${entry.label}` : entry.label });
  }
  if (owner && !list.has(owner.membershipId)) list.set(owner.membershipId, { ...owner, role: null });
  return [...list.values()];
}

export async function readThread(db: Db, workspaceId: string, jobId: string, userId: string): Promise<JobThread> {
  const rows = (await db.query<{ id: string; kind: "message" | "event"; authorId: string | null; authorName: string | null; body: string; mentions: string[]; eventCode: string | null; at: Date }>(
    `SELECT message.id, message.kind, message.author_user_id AS "authorId", coalesce(person.display_name, person.primary_email) AS "authorName", message.body,
            message.mentions::text[] AS mentions, message.event_code AS "eventCode", message.created_at AS at
       FROM job_messages message LEFT JOIN users person ON person.id = message.author_user_id
      WHERE message.workspace_id = $1 AND message.job_id = $2 AND message.deleted_at IS NULL ORDER BY message.created_at DESC, message.id DESC LIMIT 200`, [workspaceId, jobId])).rows.reverse();
  const read = (await db.query<{ at: Date }>(`SELECT last_read_at AS at FROM job_message_reads WHERE workspace_id = $1 AND job_id = $2 AND user_id = $3`, [workspaceId, jobId, userId])).rows[0]?.at ?? null;
  const unread = rows.filter((row) => row.authorId !== userId && (!read || new Date(row.at).getTime() > new Date(read).getTime())).length;
  return {
    messages: rows.map((row) => ({ id: row.id, kind: row.kind, author: row.authorId ? { id: row.authorId, name: row.authorName ?? "" } : null, body: row.body, mentions: row.mentions ?? [],
      eventCode: row.eventCode, at: new Date(row.at).toISOString(), mine: row.authorId === userId })),
    people: await jobPeople(db, workspaceId, jobId), unread, lastReadAt: read ? new Date(read).toISOString() : null,
  };
}

/**
 * Posts a message (the id the client sends makes a retry return the same message). Mentions must be people on the
 * job; each hears it in the app with a link to the thread. The author's own read marker moves past it.
 */
export async function postMessage(db: Db, workspaceId: string, jobId: string, author: { userId: string; name: string }, input: { id?: unknown; body?: unknown; mentions?: unknown }) {
  const id = typeof input.id === "string" && /^[0-9a-f-]{36}$/i.test(input.id) ? input.id.toLowerCase() : null;
  if (!id) throw new BadRequestException("Send a message id.");
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) throw new UnprocessableEntityException("Write a message.");
  if (body.length > MAX_BODY) throw new UnprocessableEntityException("Keep a message under 4,000 characters.");
  const existing = (await db.query<{ id: string }>(`SELECT id FROM job_messages WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])).rows[0];
  if (existing) return { id, replayed: true };
  const team = await jobPeople(db, workspaceId, jobId);
  const mentions = [...new Set(Array.isArray(input.mentions) ? input.mentions.filter((value): value is string => typeof value === "string") : [])];
  if (mentions.some((membershipId) => !team.some((person) => person.membershipId === membershipId))) throw new UnprocessableEntityException("Mention people on this job.");
  await db.query(`INSERT INTO job_messages (workspace_id, id, job_id, kind, author_user_id, body, mentions, created_at) VALUES ($1, $2, $3, 'message', $4, $5, $6::uuid[], clock_timestamp())`,
    [workspaceId, id, jobId, author.userId, body, mentions]);
  await markRead(db, workspaceId, jobId, author.userId);
  const reference = (await db.query<{ reference: string }>(`SELECT reference FROM job_identities WHERE workspace_id = $1 AND id = $2`, [workspaceId, jobId])).rows[0]?.reference ?? "";
  const users = mentions.length ? (await db.query<{ userId: string }>(`SELECT user_id::text AS "userId" FROM workspace_memberships WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
    [workspaceId, mentions])).rows.map((row) => row.userId).filter((userId) => userId !== author.userId) : [];
  for (const userId of users) {
    await notifyUserInApp(db, { workspaceId, recipientUserId: userId, code: "job.mentioned", eventType: "job.mentioned", variables: { author: author.name, job: reference, text: body.slice(0, 200) },
      deepLink: `/workspace/jobs/${jobId}?tab=team`, idempotencyKey: `job.mentioned:${id}:${userId}` });
    // §0.3: and on their phone, worded by the firm (Setup → Push notifications), with a Reply button.
    await queueTeamPush(db, { workspaceId, userId, key: "mention", values: { author: author.name, job: reference, text: body.slice(0, 140) },
      deepLink: `/workspace/team-chat?job=${jobId}`, idempotencyKey: `push:mention:${id}:${userId}` });
  }
  return { id, replayed: false, told: users.length };
}

export async function markRead(db: Db, workspaceId: string, jobId: string, userId: string) {
  await db.query(
    `INSERT INTO job_message_reads (workspace_id, job_id, user_id, last_read_at) VALUES ($1, $2, $3, clock_timestamp())
     ON CONFLICT (workspace_id, job_id, user_id) DO UPDATE SET last_read_at = greatest(job_message_reads.last_read_at, excluded.last_read_at)`, [workspaceId, jobId, userId]);
}
