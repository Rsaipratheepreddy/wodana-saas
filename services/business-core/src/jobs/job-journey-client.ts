import type { PoolClient } from "pg";
import { loadJobJourney, type JourneyChapter, type JourneyStep } from "./job-journey";

type Db = Pick<PoolClient, "query">;

/**
 * §0.3 P5: the client's lens on the job's journey (the same steps as the staff map, in the client's words). Internal
 * steps (assignment, intro outcome, QS, margin, release, reviews) are left out; what the client does is marked as
 * theirs. Nothing internal ever shows: no costs, margins, internal names of steps or other clients.
 */
export type ClientJourneyStep = { key: string; chapter: JourneyChapter; label: string; state: JourneyStep["state"]; yours: boolean; at: string | null; dueAt: string | null };
export type ClientJourney = {
  chapter: JourneyChapter | null;
  /** What is happening now, in the client's words: theirs to do, or what the team is doing. */
  now: { label: string; yours: boolean; dueAt: string | null } | null;
  next: ClientJourneyStep[];
  steps: ClientJourneyStep[];
  progress: { done: number; total: number };
};

/** The client's words for each step key; a key not listed is internal and never shown. */
const CLIENT_STEPS: Record<string, { label: string; yours?: boolean }> = {
  proposal_1: { label: "Design proposal shared with you" },
  proposal_1_accepted: { label: "You accept the design proposal", yours: true },
  design_fee: { label: "Design fee paid", yours: true },
  "design:inspiration": { label: "Inspiration week", yours: true },
  "design:kickoff": { label: "Kick-off meeting" },
  "design:site_visit": { label: "Site measure" },
  "design:moodboards": { label: "Mood boards to choose from", yours: true },
  "design:space_planning": { label: "Space planning" },
  "design:concepts": { label: "2D design" },
  "design:renders": { label: "3D renders" },
  "design:material_selection": { label: "Material selection" },
  "design:samples": { label: "Samples" },
  "design:final_render": { label: "Final render" },
  "design:approval": { label: "You approve the design", yours: true },
  quotation_sent: { label: "Your quotation" },
  quotation_accepted: { label: "You sign the quotation", yours: true },
  agreement: { label: "Payment agreement", yours: true },
  upfront: { label: "First payment", yours: true },
  project: { label: "Your project starts" },
  material_list: { label: "Material list to confirm", yours: true },
  drawings: { label: "Drawings to sign", yours: true },
  factory: { label: "Made for you" },
  install: { label: "Delivery and installation" },
  site_reports: { label: "Daily updates from site" },
  snagging: { label: "Final touches" },
  handover: { label: "You accept the handover", yours: true },
  warranty: { label: "Warranty" },
};

export function clientLens(steps: JourneyStep[]): ClientJourney {
  const internalNow = steps.find((step) => step.state === "now") ?? null;
  const shown = steps.filter((step) => CLIENT_STEPS[step.key] && step.state !== "skipped")
    .map((step): ClientJourneyStep => ({ key: step.key, chapter: step.chapter, label: CLIENT_STEPS[step.key].label, state: step.state, yours: Boolean(CLIENT_STEPS[step.key].yours),
      at: step.doneAt, dueAt: step.dueAt }));
  // The client's "now": the internal step now when they would recognise it, else the next step they would.
  const nowIndex = internalNow ? steps.indexOf(internalNow) : -1;
  const current = nowIndex < 0 ? null : shown.find((step) => steps.findIndex((item) => item.key === step.key) >= nowIndex && step.state !== "done") ?? null;
  const after = current ? shown.filter((step) => step.state !== "done" && step.key !== current.key && steps.findIndex((item) => item.key === step.key) > steps.findIndex((item) => item.key === current.key)) : [];
  return {
    chapter: internalNow?.chapter ?? null,
    now: current ? { label: current.label, yours: current.yours && current.key === internalNow?.key, dueAt: current.dueAt } : null,
    next: after.slice(0, 3),
    steps: shown,
    progress: { done: shown.filter((step) => step.state === "done").length, total: shown.length },
  };
}

/** The client's lens for a Planning case's job, or null when the case has no job yet. */
export async function readClientJourney(db: Db, workspaceId: string, caseId: string): Promise<ClientJourney | null> {
  const job = (await db.query<{ id: string; reference: string }>(
    `SELECT identity.id::text, identity.reference FROM job_identity_links link
       JOIN job_identities identity ON identity.workspace_id = link.workspace_id AND identity.id = link.job_id
      WHERE link.workspace_id = $1 AND link.record_type = 'case' AND link.record_id = $2 AND link.status = 'active' LIMIT 1`, [workspaceId, caseId])).rows[0];
  if (!job) return null;
  return clientLens((await loadJobJourney(db, workspaceId, job)).steps);
}
