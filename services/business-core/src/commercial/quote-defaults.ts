import type { PoolClient } from "pg";
import { readProposalKit } from "../quotation/proposal-kit";

/** Used only when the firm hasn't written its own terms in the proposal kit. */
export const FALLBACK_QUOTE_TERMS = "Payment terms and delivery dates are subject to the agreed contract.";

export type NewQuoteDefaults = { currency: string | null; validityDays: number; taxRate: number; terms: string; exclusions: string };

/**
 * What a new quote starts with, from the firm's own configuration: its currency, its quotation
 * validity, the default rate of its active tax profile, and the terms and exclusions from its
 * proposal kit. Nothing here is a regional constant.
 */
export async function newQuoteDefaults(db: Pick<PoolClient, "query">, workspaceId: string, caseId: string): Promise<NewQuoteDefaults> {
  const workspace = (await db.query<{ currency: string | null; validityDays: number | null }>(
    `SELECT w.default_currency AS currency, s.validity_days AS "validityDays"
     FROM workspaces w LEFT JOIN workspace_quotation_settings s ON s.workspace_id = w.id WHERE w.id = $1`, [workspaceId])).rows[0];
  // The default rate of the case's legal entity (from its opportunity), else the workspace's first active entity.
  const tax = (await db.query<{ rate: string }>(
    `SELECT rate.rate::text AS rate FROM tax_rates rate JOIN tax_profiles profile ON profile.id = rate.tax_profile_id
      WHERE rate.workspace_id = $1 AND rate.is_default AND rate.effective_to IS NULL AND profile.status = 'active' AND profile.effective_to IS NULL
        AND profile.legal_entity_id = coalesce(
          (SELECT opportunity.legal_entity_id FROM pre_project_cases pre_case
             JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
            WHERE pre_case.workspace_id = $1 AND pre_case.id = $2),
          (SELECT entity.id FROM legal_entities entity WHERE entity.workspace_id = $1 AND entity.status = 'active' ORDER BY entity.created_at LIMIT 1))
      LIMIT 1`, [workspaceId, caseId])).rows[0];
  const kit = await readProposalKit(db, workspaceId);
  return {
    currency: workspace?.currency?.trim() || null,
    validityDays: workspace?.validityDays ?? 30,
    taxRate: tax ? Number(tax.rate) : 0,
    terms: kit.defaultTerms || FALLBACK_QUOTE_TERMS,
    exclusions: kit.defaultExclusions,
  };
}
