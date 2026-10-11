import type { PoolClient } from "pg";
import { commercialRepository } from "../commercial/commercial-repository";
import type { CommercialData } from "../commercial/commercial.types";
import { financeGatePaymentsReady } from "../commercial/release-integrity";

type Db = Pick<PoolClient, "query">;

/**
 * Work held for a variation's payment (plan §6.20, "nothing is released until every linked quote is accepted and paid,
 * per policy"): where the firm requires it (Settings › Projects, "variation paid before its work"), the scope lines a
 * sealed variation added stay held while a payment it marks "before the work" isn't finance-verified. A variation
 * billed with the next milestone, or one that credits the client, holds nothing. Worked out from the records, never a
 * flag: verifying the payment releases the work by itself. Returns each held live-scope line with the variation (VO-n).
 */
export async function variationHolds(db: Db, workspaceId: string, projectIds: string[]): Promise<Map<string, string>> {
  const held = new Map<string, string>();
  if (!projectIds.length) return held;
  const required = (await db.query<{ on: boolean }>(`SELECT require_variation_payment AS on FROM workspace_project_settings WHERE workspace_id = $1`, [workspaceId])).rows[0]?.on ?? false;
  if (!required) return held;
  const seals = (await db.query<{ caseId: string; quoteId: string; label: string; lines: string[] }>(
    `SELECT project.case_id AS "caseId", seal.quote_id AS "quoteId", seal.revision_label AS label,
            array_agg(line.id::text) AS lines
       FROM project_scope_seals seal
       JOIN delivery_projects project ON project.workspace_id = seal.workspace_id AND project.id = seal.project_id
       JOIN project_boq_lines line ON line.workspace_id = seal.workspace_id AND line.origin_seal_id = seal.id AND line.status = 'active'
      WHERE seal.workspace_id = $1 AND seal.project_id = ANY($2::uuid[]) AND seal.kind = 'variation'
        AND EXISTS (SELECT 1 FROM commercial_payments payment WHERE payment.workspace_id = seal.workspace_id AND payment.case_id = project.case_id
                     AND payment.source_quote_id = seal.quote_id AND payment.required_for_release)
      GROUP BY project.case_id, seal.quote_id, seal.revision_label`, [workspaceId, projectIds])).rows;
  const cases = new Map<string, CommercialData>();
  for (const seal of seals) {
    if (!cases.has(seal.caseId)) {
      const loaded = await commercialRepository.load(db, workspaceId, seal.caseId);
      if (!loaded) continue;
      cases.set(seal.caseId, { ...(loaded.content as CommercialData), payments: (loaded.content as CommercialData).payments ?? [], revision: loaded.revision });
    }
    const data = cases.get(seal.caseId)!;
    if (financeGatePaymentsReady(data, "release", seal.quoteId)) continue;
    for (const line of seal.lines) held.set(line, seal.label);
  }
  return held;
}
