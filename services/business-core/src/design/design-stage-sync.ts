import type { PoolClient } from "pg";
import { completeStage } from "./design-journey.store";
import type { JourneyStage } from "./design-journey.domain";

type Db = Pick<PoolClient, "query">;

/** Stages whose work is design deliverables (drawings, boards, renders) reviewed and approved per room. */
export const DELIVERABLE_STAGES = ["space_planning", "concepts", "material_selection", "renders"] as const;
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
 * Completes the current journey stage once every current deliverable in it is client-approved, then
 * checks the next one, so work approved ahead of time finishes its stage as soon as that stage opens.
 * A stage with no deliverables is never completed here (it is skipped explicitly, with a reason).
 */
export async function syncDesignStages(db: Db, workspaceId: string, caseId: string, userId: string | null) {
  const completed: JourneyStage[] = [];
  for (let guard = 0; guard < DELIVERABLE_STAGES.length; guard += 1) {
    const active = (await db.query<{ stage: JourneyStage }>(
      `SELECT stage FROM design_journey_stages WHERE workspace_id = $1 AND case_id = $2 AND status = 'active' ORDER BY position LIMIT 1 FOR UPDATE`, [workspaceId, caseId])).rows[0]?.stage;
    if (!active || !isDeliverableStage(active)) break;
    const progress = (await stageProgress(db, workspaceId, caseId)).find((item) => item.stage === active)!;
    if (progress.total === 0 || progress.pending > 0) break;
    await completeStage(db, workspaceId, caseId, active, userId, null, "approved");
    completed.push(active);
  }
  return completed;
}
