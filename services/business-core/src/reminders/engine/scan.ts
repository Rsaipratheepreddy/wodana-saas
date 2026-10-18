import { randomUUID } from "node:crypto";
import { recordAudit } from "../../audit/record-audit";
import type { JobLineageLink } from "../../jobs/job-lineage";
import { REMINDER_KIND_INFO, type ReminderKind } from "../reminders-contract";
import type { EngineContext } from "./context";
import type { Db, DueItem, ReminderSource, StillOpenAt } from "./engine";
import { inSavepoint, messageOf } from "./savepoint";

/** At most this many items per source per scan; the rest are picked up as the first ones close. */
export const SCAN_LIMIT = 500;

export type ScanResult = { sources: number; opened: number; changed: number; closed: number; errors: string[] };

const jobKey = (link: JobLineageLink) => `${link.type}:${link.type === "quote" ? `${link.caseId}:` : ""}${link.id}`;

/** The Job of each item: its own record's link, else its project's, else its case's (job_identity_links). */
async function resolveJobs(db: Db, workspaceId: string, items: readonly DueItem[]): Promise<Map<string, string | null>> {
  const candidates = new Map<string, string[]>();
  for (const item of items) {
    const keys = [item.jobSource ? jobKey(item.jobSource) : null, item.projectId ? `project:${item.projectId}` : null, item.caseId ? `case:${item.caseId}` : null]
      .filter((key): key is string => Boolean(key));
    candidates.set(item.key, keys);
  }
  const all = [...new Set([...candidates.values()].flat())];
  const found = all.length ? new Map((await db.query<{ key: string; jobId: string }>(
    `SELECT source_key AS key, job_id AS "jobId" FROM job_identity_links WHERE workspace_id = $1 AND status = 'active' AND source_key = ANY($2::text[])`,
    [workspaceId, all])).rows.map((row) => [row.key, row.jobId])) : new Map<string, string>();
  return new Map([...candidates].map(([key, keys]) => [key, keys.map((candidate) => found.get(candidate)).find(Boolean) ?? null]));
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** Writes or refreshes one subject. A moved due moment (or a subject that reopens) starts a new due revision. */
async function upsertSubject(db: Db, ctx: EngineContext, source: ReminderSource, item: DueItem, jobId: string | null): Promise<"opened" | "changed" | null> {
  const row = (await db.query<{ inserted: boolean }>(
    `INSERT INTO reminder_subjects AS subject (workspace_id, kind, source_key, source_type, source_id, job_id, project_id, case_id, party_id, audience, critical,
       owner_membership_id, cc_membership_ids, title, context, href, variables, due_at, checked_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::uuid[], $14, $15, $16, $17::jsonb, $18, $19, $19, $19)
     ON CONFLICT (workspace_id, kind, source_key) DO UPDATE SET
       source_type = EXCLUDED.source_type, source_id = EXCLUDED.source_id, job_id = EXCLUDED.job_id, project_id = EXCLUDED.project_id,
       case_id = EXCLUDED.case_id, party_id = EXCLUDED.party_id, critical = EXCLUDED.critical, owner_membership_id = EXCLUDED.owner_membership_id,
       cc_membership_ids = EXCLUDED.cc_membership_ids, title = EXCLUDED.title, context = EXCLUDED.context, href = EXCLUDED.href, variables = EXCLUDED.variables,
       due_at = EXCLUDED.due_at, checked_at = EXCLUDED.checked_at, updated_at = EXCLUDED.updated_at,
       due_revision = subject.due_revision + CASE WHEN subject.due_at IS DISTINCT FROM EXCLUDED.due_at OR subject.status IN ('done', 'cancelled') THEN 1 ELSE 0 END,
       reminders_sent = CASE WHEN subject.due_at IS DISTINCT FROM EXCLUDED.due_at OR subject.status IN ('done', 'cancelled') THEN 0 ELSE subject.reminders_sent END,
       escalation_level = CASE WHEN subject.due_at IS DISTINCT FROM EXCLUDED.due_at OR subject.status IN ('done', 'cancelled') THEN 0 ELSE subject.escalation_level END,
       status = CASE WHEN subject.status IN ('done', 'cancelled') THEN 'open' ELSE subject.status END,
       snoozed_until = CASE WHEN subject.status IN ('done', 'cancelled') THEN NULL ELSE subject.snoozed_until END,
       snooze_reason = CASE WHEN subject.status IN ('done', 'cancelled') THEN NULL ELSE subject.snooze_reason END,
       snoozed_by = CASE WHEN subject.status IN ('done', 'cancelled') THEN NULL ELSE subject.snoozed_by END,
       done_at = NULL, done_reason = NULL,
       version = subject.version + 1
     WHERE subject.status IN ('done', 'cancelled')
        OR (subject.due_at, subject.owner_membership_id, subject.cc_membership_ids, subject.title, subject.context, subject.href, subject.variables,
            subject.job_id, subject.project_id, subject.case_id, subject.party_id, subject.critical, subject.source_type, subject.source_id)
           IS DISTINCT FROM
           (EXCLUDED.due_at, EXCLUDED.owner_membership_id, EXCLUDED.cc_membership_ids, EXCLUDED.title, EXCLUDED.context, EXCLUDED.href, EXCLUDED.variables,
            EXCLUDED.job_id, EXCLUDED.project_id, EXCLUDED.case_id, EXCLUDED.party_id, EXCLUDED.critical, EXCLUDED.source_type, EXCLUDED.source_id)
     RETURNING (xmax = 0) AS inserted`,
    [ctx.workspaceId, source.kind, clip(item.key, 200), item.sourceType, clip(item.sourceId, 200), jobId, item.projectId, item.caseId, item.partyId,
      source.audience, source.critical, item.ownerMembershipId, [...new Set(item.ccMembershipIds.filter((id) => id && id !== item.ownerMembershipId))],
      clip(item.title.trim() || "Reminder", 300), clip(item.context, 500), clip(item.href, 500), JSON.stringify(item.variables), item.dueAt, ctx.now])).rows[0];
  if (!row) return null;
  return row.inserted ? "opened" : "changed";
}

/**
 * Closes subjects whose record no longer needs anything (the source's done predicate said so): their planned steps
 * are skipped as done. Audited (the engine audits only closures and escalations).
 */
export async function closeSubjects(db: Db, workspaceId: string, kind: ReminderKind, keys: readonly string[], now: Date, reason: "record" | "source_gone" | "cancelled" = "record"): Promise<number> {
  if (!keys.length) return 0;
  const closed = (await db.query<{ id: string; title: string; sourceKey: string }>(
    `UPDATE reminder_subjects SET status = $5, done_at = $4, done_reason = $6, snoozed_until = NULL, snooze_reason = NULL, snoozed_by = NULL,
            version = version + 1, updated_at = $4
      WHERE workspace_id = $1 AND kind = $2 AND source_key = ANY($3::text[]) AND status IN ('open', 'snoozed')
      RETURNING id, title, source_key AS "sourceKey"`,
    [workspaceId, kind, keys, now, reason === "cancelled" ? "cancelled" : "done", reason])).rows;
  if (!closed.length) return 0;
  await db.query(
    `UPDATE reminder_steps SET state = 'skipped', skip_reason = 'done', hold_reason = NULL, held_until = NULL, version = version + 1, updated_at = $3
      WHERE workspace_id = $1 AND subject_id = ANY($2::uuid[]) AND state IN ('planned', 'held')`,
    [workspaceId, closed.map((row) => row.id), now]);
  for (const subject of closed) {
    await recordAudit(db, { workspaceId, actorUserId: null, source: "internal", action: "reminders.subject_closed.v1", entityType: "reminder_subject", entityId: subject.id,
      after: { kind, sourceKey: subject.sourceKey, title: subject.title, reason } });
  }
  return closed.length;
}

/** Of these subjects' keys, the ones the source says are done (re-checked before a send and before My day shows them). */
export async function doneKeys(db: Db, workspaceId: string, source: ReminderSource, keys: readonly string[], at?: StillOpenAt): Promise<string[]> {
  if (!keys.length) return [];
  const open = await source.stillOpen(db, workspaceId, keys, at);
  return keys.filter((key) => !open.has(key));
}

/**
 * The scan (at most every five minutes per workspace): each source lists what is due; new items become subjects,
 * changed ones are refreshed, and open subjects the source no longer lists are closed when its done predicate agrees
 * (one past the source's limit stays open). One failing source never stops the others or closes its subjects.
 */
export async function scanSources(db: Db, ctx: EngineContext, options: { limit?: number } = {}): Promise<ScanResult> {
  const result: ScanResult = { sources: 0, opened: 0, changed: 0, closed: 0, errors: [] };
  const limit = options.limit ?? SCAN_LIMIT;
  for (const source of [...ctx.sources.values()].sort((left, right) => left.kind.localeCompare(right.kind))) {
    // A kind whose rule is off still lists its items in My day; only critical kinds can't be off.
    try {
      await inSavepoint(db, async () => {
        const listed = await source.open(db, ctx.workspaceId, { clock: ctx.clock, now: ctx.now, limit });
        const items = [...new Map(listed.filter((item) => item.key && item.dueAt instanceof Date && !Number.isNaN(item.dueAt.getTime())).map((item) => [item.key, item])).values()].slice(0, limit);
        const jobs = await resolveJobs(db, ctx.workspaceId, items);
        for (const item of items) {
          const outcome = await upsertSubject(db, ctx, source, item, jobs.get(item.key) ?? null);
          if (outcome) result[outcome] += 1;
        }
        const missing = (await db.query<{ key: string }>(
          `SELECT source_key AS key FROM reminder_subjects WHERE workspace_id = $1 AND kind = $2 AND status IN ('open', 'snoozed') AND NOT (source_key = ANY($3::text[]))`,
          [ctx.workspaceId, source.kind, items.map((item) => clip(item.key, 200))])).rows.map((row) => row.key);
        result.closed += await closeSubjects(db, ctx.workspaceId, source.kind, await doneKeys(db, ctx.workspaceId, source, missing, { now: ctx.now, today: ctx.clock.today }), ctx.now);
      });
      result.sources += 1;
    } catch (error) {
      result.errors.push(`${source.kind}: ${messageOf(error)}`);
    }
  }
  return result;
}

/** Tells open screens (My day, Home, the bell) that reminders changed; they re-read through their own APIs. */
export async function emitRemindersChanged(db: Db, workspaceId: string, now: Date) {
  const eventId = randomUUID();
  await db.query(
    `INSERT INTO outbox_events (id, workspace_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1, $2, 'reminder_subjects', $2, 'reminders.changed.v1', $3::jsonb)`,
    [eventId, workspaceId, JSON.stringify({ schemaVersion: 1, eventId, workspaceId, aggregateType: "reminder_subjects", aggregateId: workspaceId, actorUserId: null,
      occurredAt: now.toISOString(), correlationId: eventId, causationId: null, data: {} })]);
}

export const isEngineSource = (source: ReminderSource) => REMINDER_KIND_INFO[source.kind].notify === "engine";
