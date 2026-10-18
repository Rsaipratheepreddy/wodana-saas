import type { PoolClient } from "pg";
import { completeStage } from "./design-journey.store";
import type { JourneyStage } from "./design-journey.domain";

type Db = Pick<PoolClient, "query">;

/** Stages whose work is design deliverables (drawings, boards, renders) reviewed and approved per room. */
export const DELIVERABLE_STAGES = ["moodboards", "space_planning", "concepts", "material_selection", "renders"] as const;
export type DeliverableStage = (typeof DELIVERABLE_STAGES)[number];
export const isDeliverableStage = (stage: string | null | undefined): stage is DeliverableStage => (DELIVERABLE_STAGES as readonly string[]).includes(stage ?? "");

export type StageProgress = { stage: DeliverableStage; total: number; approved: number; pending: number };

/** Per deliverable stage: how many current deliverables it has and how many of their latest revisions are approved. */
export async function stageProgress(db: Db, workspaceId: string, caseId: string): Promise<StageProgress[]> {
  const rows = (await db.query<{ stage: DeliverableStage; total: number; approved: number }>(
    `SELECT design.stage, count(*)::int AS total, count(*) FILTER (WHERE latest.status = 'approved')::int AS approved
       FROM pre_project_designs design
       JOIN LATERAL (SELECT status FROM pre_project_design_versions version WHERE version.workspace_id = design.workspace_id AND version.design_id = design.id ORDER BY number DESC LIMIT 1) latest ON true
      WHERE design.workspace_id = $1 AND design.case_id = $2 AND design.archived_at IS NULL AND design.stage IS NOT NULL
      GROUP BY design.stage`, [workspaceId, caseId])).rows;
  return DELIVERABLE_STAGES.map((stage) => {
    const row = rows.find((item) => item.stage === stage);
    return { stage, total: row?.total ?? 0, approved: row?.approved ?? 0, pending: (row?.total ?? 0) - (row?.approved ?? 0) };
  });
}

/**
 * PLM-141: in the current order the concept can't be approved before the design site measure is done. True when the
 * case has no site measure open (the old order, or it is done).
 */
export async function siteMeasureDone(db: Db, workspaceId: string, caseId: string) {
  return !(await db.query(`SELECT 1 FROM design_journey_tasks WHERE workspace_id = $1 AND case_id = $2 AND task = 'site_measure' AND status <> 'done'`, [workspaceId, caseId])).rowCount;
}

/** The order a case's journey runs in (1, 2 or 3). */
async function flowOf(db: Db, workspaceId: string, caseId: string) {
  return Number((await db.query<{ flow: number }>(`SELECT flow_version AS flow FROM design_journeys WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, caseId])).rows[0]?.flow ?? 1);
}

/** The current order's renders end with the client's render sign-off (PLM-143), not with approved files. */
async function signOffEnds(db: Db, workspaceId: string, caseId: string, stage: JourneyStage) {
  if (stage !== "renders") return false;
  return Boolean((await db.query(`SELECT 1 FROM design_journeys WHERE workspace_id = $1 AND case_id = $2 AND flow_version >= 2`, [workspaceId, caseId])).rowCount);
}

/**
 * Completes the current journey stage once every current deliverable in it is client-approved, then
 * checks the next one, so work approved ahead of time finishes its stage as soon as that stage opens.
 * A stage with no deliverables is never completed here (it is skipped explicitly, with a reason). In the current order
 * the concept also waits for the site measure, and the renders for the client's sign-off.
 */
export async function syncDesignStages(db: Db, workspaceId: string, caseId: string, userId: string | null) {
  const completed: JourneyStage[] = [];
  for (let guard = 0; guard < DELIVERABLE_STAGES.length; guard += 1) {
    const active = (await db.query<{ stage: JourneyStage }>(
      `SELECT stage FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND status = 'active' ORDER BY position LIMIT 1 FOR UPDATE`, [workspaceId, caseId])).rows[0]?.stage;
    if (!active || !isDeliverableStage(active)) break;
    const progress = (await stageProgress(db, workspaceId, caseId)).find((item) => item.stage === active)!;
    // Guide step 6: space planning is a PDF the team uploads (no client approval), once the site measure is in.
    if (active === "space_planning" && await flowOf(db, workspaceId, caseId) === 3) {
      if (progress.total === 0 || !(await siteMeasureDone(db, workspaceId, caseId))) break;
      await completeStage(db, workspaceId, caseId, active, userId, null, "uploaded");
      completed.push(active);
      continue;
    }
    if (progress.total === 0 || progress.pending > 0) break;
    if (active === "concepts" && !(await siteMeasureDone(db, workspaceId, caseId))) break;
    if (await signOffEnds(db, workspaceId, caseId, active)) break;
    await completeStage(db, workspaceId, caseId, active, userId, null, "approved");
    completed.push(active);
  }
  return completed;
}

/**
 * PLM-141/142: once the site measure is done, a concept the client already chose (or whose files are all approved)
 * completes the concept step. Returns whether it did.
 */
export async function completeConceptIfReady(db: Db, workspaceId: string, caseId: string, userId: string | null) {
  const active = (await db.query(`SELECT 1 FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND stage = 'concepts' AND status = 'active' FOR UPDATE`, [workspaceId, caseId])).rowCount;
  if (!active || !(await siteMeasureDone(db, workspaceId, caseId))) return false;
  const chosen = (await db.query<{ title: string }>(
    `SELECT option.title FROM design_presentations presentation JOIN design_presentation_options option ON option.workspace_id = presentation.workspace_id AND option.id = presentation.chosen_option_id
      WHERE presentation.workspace_id = $1 AND presentation.case_id = $2 AND presentation.stage = 'concepts' AND presentation.status = 'chosen' ORDER BY presentation.round DESC LIMIT 1`,
    [workspaceId, caseId])).rows[0];
  if (chosen) { await completeStage(db, workspaceId, caseId, "concepts", userId, `Client's choice: ${chosen.title}`, "chosen"); return true; }
  return (await syncDesignStages(db, workspaceId, caseId, userId)).includes("concepts");
}
