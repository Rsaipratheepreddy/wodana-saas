import type { PoolClient } from "pg";
import type { ApprovalDecision, ApprovalStatus } from "../../approvals/approval-policy";
import { recordAudit } from "../../audit/record-audit";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-139: the Approvals inbox decided a design rate above the package's starting rate (kind design_rate, subject the
 * opportunity). Approved, the opportunity's design fee becomes the amount approved (the fee at the agreed rate), as long
 * as the agreed rate is still on it; sent back or refused, the fee stays at the package's rate.
 */
export async function applyDesignRateDecision(db: Db, workspaceId: string, approval: ApprovalStatus, decision: ApprovalDecision, actorUserId: string) {
  if (decision !== "approve" || approval.status !== "approved" || !approval.amount || !approval.currency) return;
  const updated = await db.query(
    `UPDATE crm_opportunity_discovery SET design_fee = $3::numeric, design_fee_currency = $4, updated_by = $5, updated_at = now(), version = version + 1
      WHERE workspace_id = $1 AND opportunity_id = $2 AND design_rate IS NOT NULL AND design_fee IS DISTINCT FROM $3::numeric`,
    [workspaceId, approval.subjectId, approval.amount, approval.currency, actorUserId]);
  if (updated.rowCount) await recordAudit(db, { workspaceId, actorUserId, action: "crm.opportunity.design_rate_approved.v1", entityType: "crm_opportunity", entityId: approval.subjectId,
    after: { designFee: approval.amount, currency: approval.currency, approvalId: approval.id } });
}
