import { ConflictException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import type { JourneyView } from "./job-journey";
import { jobPeople, postMessage } from "./job-thread";

type Db = Pick<PoolClient, "query">;

/**
 * §0.3 P11: suggestions inside a job's step now. Optional and never in the way: with AI off for the workspace there are
 * none, and a step works the same without them. Each one says where it comes from and how sure it is; a person uses it
 * with one click or dismisses it. They are rows in `ai_suggestions` (about the job), so each decision is kept.
 *  - A late step with a named owner: nudge them in the job's team chat (an @mention, so they hear it in the app).
 *  - A step waiting on the client: a drafted reminder the person copies and sends themselves (nothing goes to the client).
 */
export type JobSuggestion = {
  id: string; kind: "nudge_owner" | "client_reminder"; title: string; text: string; source: string; confidence: number; version: number;
  action: { type: "thread_message"; body: string; mentions: string[] } | { type: "copy"; body: string };
};
type Candidate = Omit<JobSuggestion, "id" | "version"> & { key: string };

const DAY = 24 * 60 * 60 * 1000;
/** A stable uuid from a hash, so the same suggestion for the same step is stored once. */
const uuidOf = (hex: string) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";

export async function aiEnabled(db: Db, workspaceId: string) {
  return (await db.query<{ enabled: boolean }>(`SELECT enabled FROM workspace_ai_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.enabled === true;
}

/** The suggestions the step now calls for (pure: from the journey, the people on the job and today). */
export function candidates(journey: Pick<JourneyView, "jobId" | "client" | "now">, people: Array<{ membershipId: string; name: string }>, today: Date): Candidate[] {
  const now = journey.now;
  if (!now) return [];
  const due = now.dueAt ? new Date(now.dueAt) : null;
  const late = due ? Math.floor((today.getTime() - due.getTime()) / DAY) : 0;
  const out: Candidate[] = [];
  const owner = now.owner ? people.find((person) => person.name === now.owner) : undefined;
  if (late >= 1 && owner) out.push({
    key: `${journey.jobId}:${now.key}:nudge_owner:${now.dueAt}`, kind: "nudge_owner", title: `Nudge ${owner.name}`,
    text: `${now.label} is ${late === 1 ? "1 day" : `${late} days`} past its date. Send ${firstName(owner.name)} a note in the job chat?`,
    source: "The step's due date and owner", confidence: 0.9,
    action: { type: "thread_message", body: `@${owner.name} ${now.label} is ${late === 1 ? "1 day" : `${late} days`} late. Can you update it today?`, mentions: [owner.membershipId] },
  });
  if (now.lane === "client") {
    const name = firstName(journey.client) || "there";
    out.push({
      key: `${journey.jobId}:${now.key}:client_reminder`, kind: "client_reminder", title: "Remind the client",
      text: `A short reminder about "${now.label}", ready to copy into WhatsApp or email.`,
      source: "The step waiting on the client", confidence: late >= 1 ? 0.8 : 0.6,
      action: { type: "copy", body: `Hi ${name}, a quick reminder about ${now.label.toLowerCase()}. It's ready for you in your portal. Let us know if anything is unclear.` },
    });
  }
  return out;
}

const projection = `id::text, title, suggestion_text AS text, proposed_diff AS diff, provenance, status, version`;
type Row = { id: string; title: string; text: string; diff: Array<{ kind: JobSuggestion["kind"]; action: JobSuggestion["action"] }>; provenance: { source?: string; confidence?: number }; status: string; version: number };
const shape = (row: Row): JobSuggestion => ({ id: row.id, kind: row.diff[0]?.kind ?? "nudge_owner", title: row.title, text: row.text, action: row.diff[0]?.action,
  source: row.provenance.source ?? "", confidence: Number(row.provenance.confidence ?? 0), version: row.version } as JobSuggestion);

/** The step now's suggestions still open (stored once per step and kind); none when AI is off. */
export async function readJobSuggestions(db: Db, workspaceId: string, journey: JourneyView, userId: string, today = new Date()): Promise<JobSuggestion[]> {
  if (!(await aiEnabled(db, workspaceId))) return [];
  const wanted = candidates(journey, await jobPeople(db, workspaceId, journey.jobId), today);
  const hashes: string[] = [];
  for (const candidate of wanted) {
    const hash = createHash("sha256").update(candidate.key).digest("hex");
    hashes.push(hash);
    await db.query(
      `INSERT INTO ai_suggestions (workspace_id, request_id, request_hash, entity_type, entity_id, title, suggestion_text, evidence, proposed_diff, provenance, created_by)
       VALUES ($1, $2, $3, 'job', $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10) ON CONFLICT (workspace_id, request_id) DO NOTHING`,
      [workspaceId, uuidOf(hash), hash, journey.jobId, candidate.title.slice(0, 200), candidate.text,
        JSON.stringify([{ label: "Step", value: journey.now?.label ?? "" }, ...(journey.now?.dueAt ? [{ label: "Due", value: journey.now.dueAt }] : [])]),
        JSON.stringify([{ kind: candidate.kind, action: candidate.action }]), JSON.stringify({ source: candidate.source, confidence: candidate.confidence, model: null, rule: candidate.kind }), userId]);
  }
  if (!hashes.length) return [];
  const rows = (await db.query<Row>(`SELECT ${projection} FROM ai_suggestions WHERE workspace_id = $1 AND entity_type = 'job' AND entity_id = $2 AND request_hash = ANY($3::text[]) AND status = 'pending'
    ORDER BY created_at`, [workspaceId, journey.jobId, hashes])).rows;
  return rows.map(shape);
}

/**
 * A person uses or dismisses a suggestion (version-checked; deciding again the same way returns the same answer).
 * Using a nudge posts it to the job's team chat as that person, once.
 */
export async function decideJobSuggestion(db: Db, workspaceId: string, jobId: string, person: { userId: string; name: string }, id: string, input: { action?: unknown; version?: unknown }) {
  const action = input.action === "use" ? "accepted" : input.action === "dismiss" ? "rejected" : null;
  if (!action || !Number.isSafeInteger(input.version)) throw new ConflictException("Use or dismiss the suggestion you saw.");
  const row = (await db.query<Row>(`SELECT ${projection} FROM ai_suggestions WHERE workspace_id = $1 AND id = $2 AND entity_type = 'job' AND entity_id = $3 FOR UPDATE`, [workspaceId, id, jobId])).rows[0];
  if (!row) throw new NotFoundException("Suggestion not found.");
  if (row.status !== "pending") {
    if (row.status === action) return shape(row);
    throw new ConflictException("Someone already decided this suggestion.");
  }
  if (row.version !== input.version) throw new ConflictException("This suggestion changed. Reload to see it.");
  const suggestion = shape(row);
  if (action === "accepted" && suggestion.action?.type === "thread_message") {
    const messageId = uuidOf(createHash("sha256").update(`suggestion:${id}`).digest("hex"));
    await postMessage(db, workspaceId, jobId, person, { id: messageId, body: suggestion.action.body, mentions: suggestion.action.mentions });
  }
  const updated = (await db.query<Row>(`UPDATE ai_suggestions SET status = $3, decided_by = $4, decided_at = clock_timestamp(), version = version + 1
     WHERE workspace_id = $1 AND id = $2 AND version = $5 RETURNING ${projection}`, [workspaceId, id, action, person.userId, row.version])).rows[0];
  await recordAudit(db, { workspaceId, actorUserId: person.userId, action: action === "accepted" ? "ai.suggestion.accepted.v1" : "ai.suggestion.rejected.v1",
    entityType: "ai_suggestion", entityId: id, after: { jobId, kind: suggestion.kind, status: action } });
  return shape(updated);
}
