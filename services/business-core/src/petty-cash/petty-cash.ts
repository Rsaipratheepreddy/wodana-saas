import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

export const CATEGORIES = ["transport", "food", "materials", "tools", "fees", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export type ClaimStatus = "draft" | "submitted" | "approved" | "rejected" | "reimbursed";

/** A claim's reference: PC-0007. */
export const claimNumber = (number: number) => `PC-${String(number).padStart(4, "0")}`;

export type ClaimRow = {
  id: string; number: number; reference: string; projectId: string; projectReference: string; projectName: string; packageId: string | null; packageName: string | null;
  spentOn: string; amount: string; currency: string; description: string; category: Category; receiptName: string | null; noReceiptReason: string; status: ClaimStatus;
  claimedBy: string; claimedByName: string; submittedAt: string | null; decidedByName: string | null; decidedAt: string | null; decisionNote: string;
  reimbursedByName: string | null; reimbursedAt: string | null; reimbursementReference: string; version: number;
};

/** Claims, newest first: one, a project's (all or one person's), or by status across projects. */
export async function readClaims(db: Db, workspaceId: string, filter: { id?: string; projectId?: string; claimedBy?: string; statuses?: ClaimStatus[] } = {}): Promise<ClaimRow[]> {
  const values: unknown[] = [workspaceId];
  const where = ["claim.workspace_id = $1"];
  const add = (sql: string, value: unknown) => { values.push(value); where.push(sql.replace("?", `$${values.length}`)); };
  if (filter.id) add("claim.id = ?", filter.id);
  if (filter.projectId) add("claim.project_id = ?", filter.projectId);
  if (filter.claimedBy) add("claim.claimed_by = ?", filter.claimedBy);
  if (filter.statuses) add("claim.status = ANY(?::text[])", filter.statuses);
  const rows = (await db.query<Omit<ClaimRow, "reference">>(
    `SELECT claim.id, claim.number, claim.project_id AS "projectId", project.reference AS "projectReference", project.name AS "projectName", claim.package_id AS "packageId",
            package.name AS "packageName", claim.spent_on::text AS "spentOn", claim.amount::text AS amount, claim.currency, claim.description, claim.category,
            claim.receipt_name AS "receiptName", claim.no_receipt_reason AS "noReceiptReason", claim.status, claim.claimed_by AS "claimedBy", claimant.display_name AS "claimedByName",
            claim.submitted_at AS "submittedAt", decider.display_name AS "decidedByName", claim.decided_at AS "decidedAt", claim.decision_note AS "decisionNote",
            payer.display_name AS "reimbursedByName", claim.reimbursed_at AS "reimbursedAt", claim.reimbursement_reference AS "reimbursementReference", claim.version
       FROM petty_cash_claims claim
       JOIN delivery_projects project ON project.workspace_id = claim.workspace_id AND project.id = claim.project_id
       JOIN users claimant ON claimant.id = claim.claimed_by
       LEFT JOIN users decider ON decider.id = claim.decided_by
       LEFT JOIN users payer ON payer.id = claim.reimbursed_by
       LEFT JOIN project_packages package ON package.workspace_id = claim.workspace_id AND package.id = claim.package_id
      WHERE ${where.join(" AND ")}
      ORDER BY claim.spent_on DESC, claim.number DESC LIMIT 500`, values)).rows;
  return rows.map((row) => ({ ...row, reference: claimNumber(row.number) }));
}
