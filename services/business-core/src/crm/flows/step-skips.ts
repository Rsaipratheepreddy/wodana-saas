import type { PoolClient } from "pg";
import type { StepSkip } from "./flow-interpreter";

type Db = Pick<PoolClient, "query">;

/** E2-5 / PLM-081: the live skips of one job, by step key (the reason, who and when). */
export async function loadStepSkips(db: Db, workspaceId: string, opportunityId: string): Promise<Record<string, StepSkip>> {
  const rows = (await db.query<{ stepKey: string; reason: string; by: string | null; at: Date }>(
    `SELECT skip.step_key AS "stepKey", skip.reason, account.display_name AS by, skip.skipped_at AS at
       FROM crm_opportunity_step_skips skip LEFT JOIN users account ON account.id = skip.skipped_by
      WHERE skip.workspace_id = $1 AND skip.opportunity_id = $2 AND skip.revoked_at IS NULL`,
    [workspaceId, opportunityId])).rows;
  return Object.fromEntries(rows.map((row) => [row.stepKey, { reason: row.reason, by: row.by, at: row.at }]));
}
