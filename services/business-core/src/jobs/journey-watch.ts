import type { PoolClient } from "pg";
import { readPortalSettings } from "../client-portal/portal-settings";
import { portalLink } from "../client-portal/portal-site";
import { effectivePortalBrand } from "../commercial/effective-brand";
import { queueClientPush, queueTeamPush } from "../notifications/push-templates";
import { clientLens } from "./job-journey-client";
import { loadJobJourney, type JourneyChapter } from "./job-journey";
import { jobPeople } from "./job-thread";

type Db = Pick<PoolClient, "query">;

/** The client's words for each chapter (the same as their portal). */
export const CLIENT_CHAPTER_WORDS: Record<JourneyChapter, string> = {
  win: "Getting started", design: "Your design", price: "Your quotation", make: "Making it", install: "On site", care: "Aftercare",
};
const CHAPTER_WORDS: Record<JourneyChapter, string> = { win: "Win", design: "Design", price: "Price", make: "Make", install: "Install", care: "Care" };

/**
 * §0.3 Push like a delivery app, the progress push. Each sweep looks at a batch of jobs (the ones looked at longest
 * ago first) and keeps the step each is on. When a job's step changes, the people on the job hear it on their phone
 * once ("Now: Mood boards · Design (14 of 41)"), and so does the client in their own words: when the step is theirs to
 * do, or when the job moves into a new chapter. A step that turns late tells the person who owns it, once. The first
 * look at a job only records where it is (nobody is told about the past). Every push goes through the person's
 * choices and quiet hours; the same step never sends twice.
 */
export async function watchJourneys(db: Db, workspaceId: string, options: { now?: Date; limit?: number } = {}) {
  const now = options.now ?? new Date();
  const jobs = (await db.query<{ id: string; reference: string; stepKey: string | null; chapter: JourneyChapter | null; seen: boolean }>(
    `SELECT identity.id::text, identity.reference, mark.step_key AS "stepKey", mark.chapter, mark.job_id IS NOT NULL AS seen
       FROM job_identities identity LEFT JOIN job_journey_marks mark ON mark.workspace_id = identity.workspace_id AND mark.job_id = identity.id
      WHERE identity.workspace_id = $1 AND EXISTS (SELECT 1 FROM job_identity_links link WHERE link.workspace_id = identity.workspace_id AND link.job_id = identity.id AND link.status = 'active')
      ORDER BY mark.seen_at NULLS FIRST, identity.created_at DESC LIMIT $2`, [workspaceId, options.limit ?? 40])).rows;
  const result = { looked: jobs.length, changed: 0, team: 0, client: 0, late: 0 };
  let brand: string | null = null;
  for (const job of jobs) {
    const journey = await loadJobJourney(db, workspaceId, { id: job.id, reference: job.reference });
    const step = journey.now;
    const stepKey = step?.key ?? "done";
    const chapter = step?.chapter ?? null;
    await db.query(`INSERT INTO job_journey_marks (workspace_id, job_id, step_key, chapter, seen_at) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (workspace_id, job_id) DO UPDATE SET step_key = excluded.step_key, chapter = excluded.chapter, seen_at = excluded.seen_at`, [workspaceId, job.id, stepKey, chapter, now]);
    if (!job.seen || !step) continue;
    const people = await jobPeople(db, workspaceId, job.id);
    const users = people.length ? (await db.query<{ userId: string; membershipId: string; name: string }>(
      `SELECT member.user_id::text AS "userId", member.id::text AS "membershipId", coalesce(person.display_name, person.primary_email) AS name
         FROM workspace_memberships member JOIN users person ON person.id = member.user_id WHERE member.workspace_id = $1 AND member.id = ANY($2::uuid[]) AND member.status = 'active'`,
      [workspaceId, people.map((person) => person.membershipId)])).rows : [];
    const jobName = journey.title ? `${journey.title} · ${journey.reference}` : journey.reference;
    const jobLink = `/workspace/jobs/${job.id}`;
    // A step that has turned late: its owner hears it once.
    if (step.dueAt && new Date(step.dueAt).getTime() < now.getTime()) {
      // Its owner by membership (two people may share a name); an owner known only by name, by name.
      const owner = step.ownerId
        ? users.find((user) => user.membershipId === step.ownerId) ?? (await db.query<{ userId: string; membershipId: string; name: string }>(
          `SELECT member.user_id::text AS "userId", member.id::text AS "membershipId", '' AS name FROM workspace_memberships member
            WHERE member.workspace_id = $1 AND member.id = $2 AND member.status = 'active'`, [workspaceId, step.ownerId])).rows[0]
        : users.find((user) => user.name === step.owner);
      if (owner && (await queueTeamPush(db, { workspaceId, userId: owner.userId, key: "step_late", values: { job: jobName, step: step.label, due: step.dueAt.slice(0, 10) },
        deepLink: jobLink, idempotencyKey: `push:step_late:${job.id}:${stepKey}:${owner.userId}` })).queued) result.late += 1;
    }
    if (job.stepKey === stepKey) continue;
    result.changed += 1;
    const done = journey.chapters.reduce((sum, item) => sum + item.done, 0);
    const total = journey.chapters.reduce((sum, item) => sum + item.total, 0);
    for (const user of users) {
      const sent = await queueTeamPush(db, { workspaceId, userId: user.userId, key: "job_step",
        values: { job: jobName, step: step.label, chapter: chapter ? CHAPTER_WORDS[chapter] : "", done: String(done), total: String(total) },
        deepLink: jobLink, idempotencyKey: `push:job_step:${job.id}:${stepKey}:${user.userId}` });
      if (sent.queued) result.team += 1;
    }
    // The client: when the step is theirs, or the job moves into a new chapter (in their words, never an internal step).
    const lens = clientLens(journey.steps);
    const theirs = Boolean(lens.now?.yours);
    if (!lens.now || (!theirs && job.chapter === chapter)) continue;
    const caseId = (await db.query<{ id: string }>(`SELECT record_id AS id FROM job_identity_links WHERE workspace_id = $1 AND job_id = $2 AND record_type = 'case' AND status = 'active' LIMIT 1`,
      [workspaceId, job.id])).rows[0]?.id;
    if (!caseId) continue;
    const settings = await readPortalSettings(db, workspaceId);
    if (!settings.enabled) continue;
    brand ??= (await effectivePortalBrand(db, workspaceId)).name ?? "";
    const link = await portalLink(db, workspaceId, settings.slug, `?project=${caseId}`);
    const grants = (await db.query<{ id: string }>(`SELECT id::text FROM client_portal_grants WHERE workspace_id = $1 AND case_id = $2 AND active`, [workspaceId, caseId])).rows;
    for (const grant of grants) {
      const sent = await queueClientPush(db, { workspaceId, grantId: grant.id, key: theirs ? "client_waiting" : "client_step",
        values: { brand, chapter: lens.chapter ? CLIENT_CHAPTER_WORDS[lens.chapter] : "", step: lens.now.label }, deepLink: link, idempotencyKey: `push:client:${job.id}:${stepKey}:${grant.id}` });
      if (sent.queued) result.client += 1;
    }
  }
  return result;
}
