import type { PoolClient } from "pg";
import { commercialRepository } from "../commercial/commercial-repository";
import type { CommercialData } from "../commercial/commercial.types";
import { financeGatePaymentsReady } from "../commercial/release-integrity";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-071: what a project buys is ordered only once the client's payment for that order is in: every payment stage of
 * the project's own quotation that the deal's release needs, Finance-verified (the stage flags, never their titles).
 * For a design client the project's quotation is the main round, so it's the Proposal 2 payment, never the design fee
 * (that belongs to the design round's quotation). A project without its case's money record isn't paid.
 */
export async function orderPaymentIn(db: Db, workspaceId: string, projectId: string) {
  const project = (await db.query<{ caseId: string; quoteId: string }>(`SELECT case_id AS "caseId", quote_id AS "quoteId" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, projectId])).rows[0];
  if (!project) return false;
  const row = await commercialRepository.load(db, workspaceId, project.caseId);
  if (!row) return false;
  return financeGatePaymentsReady({ ...(row.content as CommercialData), revision: row.revision }, "release", project.quoteId);
}

/** A deal's order (Furniture C) is paid in full when the deal is won: its payment proof is what won it (PLM-122). */
export async function dealPaymentIn(db: Db, workspaceId: string, opportunityId: string) {
  return Boolean((await db.query(`SELECT 1 FROM crm_opportunities WHERE workspace_id = $1 AND id = $2 AND status = 'won'`, [workspaceId, opportunityId])).rowCount);
}
