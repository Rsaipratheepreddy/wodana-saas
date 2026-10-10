import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { Dec } from "../catalog-core/decimal";
import { readSettings, storeQuotePricing, taxCodes } from "./quotation-builder.service";

/** The line's name when no design package names the fee: an English key the web translates (apps/web/lib/i18n/en.json). */
export const DESIGN_FEE_LABEL = "Design fee";

/** What Sales priced on the opportunity before its design-fee quote exists. Amounts are decimal text, never floats. */
export type OpportunityDesignFee = {
  /** Proposal 1's value (PLM-101), only for someone who may see the opportunity's values. */
  proposal: { amount: string | null; currency: string | null } | null;
  /** The fee the opportunity's design package worked out in discovery (PLM-041). */
  priced: { amount: string | null; currency: string | null } | null;
  /** The firm's design package the fee is for: its name and inclusions describe the line. */
  package: { name: string; inclusions: string | null } | null;
};

export type DesignFeeLine = {
  title: string; description: string; kind: "service"; quantity: "1"; unit: ""; rate: string;
  taxCode: string | null; taxRate: string | null; source: "proposal" | "discovery";
};

const AMOUNT = /^\d{1,16}(\.\d{1,6})?$/;

/**
 * The first line of a new design-fee quote: the Proposal 1 value Sales entered, else the fee the design package priced
 * (the first above zero in the quote's currency), once, at the firm's default tax (without tax codes the quote's own
 * rate applies). Null when nothing usable was priced: the quote starts empty, as before.
 */
export function designFeeLine(fee: OpportunityDesignFee | null, quoteCurrency: string | null | undefined, tax: { code: string; rate: string } | null): DesignFeeLine | null {
  const currency = quoteCurrency?.trim().toUpperCase();
  if (!fee || !currency) return null;
  const sources = [["proposal", fee.proposal], ["discovery", fee.priced]] as const;
  for (const [source, value] of sources) {
    const amount = value?.amount?.trim() ?? "";
    if (!AMOUNT.test(amount) || Dec.of(amount).isZero() || value?.currency?.trim().toUpperCase() !== currency) continue;
    return {
      title: fee.package?.name.trim() || DESIGN_FEE_LABEL,
      description: fee.package?.inclusions?.trim() ?? "",
      kind: "service", quantity: "1", unit: "", rate: Dec.of(amount).toString(),
      taxCode: tax?.code ?? null, taxRate: tax ? Dec.of(tax.rate).toString() : null, source,
    };
  }
  return null;
}

/** The design fee on the case's opportunity: Proposal 1's value, the discovery fee and its design package. */
export async function readOpportunityDesignFee(db: Pick<PoolClient, "query">, workspaceId: string, caseId: string, includeProposalValue: boolean): Promise<OpportunityDesignFee | null> {
  const row = (await db.query<{ proposalAmount: string | null; proposalCurrency: string | null; pricedAmount: string | null; pricedCurrency: string | null; packageName: string | null; inclusions: string | null }>(
    `SELECT proposal.amount::text AS "proposalAmount", proposal.currency_code AS "proposalCurrency",
            discovery.design_fee::text AS "pricedAmount", discovery.design_fee_currency AS "pricedCurrency", pkg.name AS "packageName", pkg.inclusions
       FROM pre_project_cases pre_case
       LEFT JOIN crm_opportunity_proposals proposal
         ON proposal.workspace_id = pre_case.workspace_id AND proposal.opportunity_id = pre_case.opportunity_id AND proposal.kind = 'design'
       LEFT JOIN crm_opportunity_discovery discovery ON discovery.workspace_id = pre_case.workspace_id AND discovery.opportunity_id = pre_case.opportunity_id
       LEFT JOIN design_packages pkg ON pkg.workspace_id = discovery.workspace_id AND pkg.id = discovery.design_package_id
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0];
  if (!row) return null;
  return {
    proposal: includeProposalValue && row.proposalAmount ? { amount: row.proposalAmount, currency: row.proposalCurrency } : null,
    priced: row.pricedAmount ? { amount: row.pricedAmount, currency: row.pricedCurrency } : null,
    package: row.packageName ? { name: row.packageName, inclusions: row.inclusions } : null,
  };
}

/**
 * A design-fee quote just created starts with the fee priced on the opportunity: one editable line, priced with the
 * shared engine, audited. Part of the creating command (same transaction and revision). Only a draft design-fee quote
 * with no lines is filled; a quote that has lines is never touched. Returns what it added, or null.
 */
export async function prefillDesignFeeQuote(db: PoolClient, input: { workspaceId: string; caseId: string; quoteId: string; actorUserId: string; includeProposalValue: boolean }) {
  const { workspaceId, caseId, quoteId } = input;
  const quote = (await db.query<{ id: string; kind: string; round: string | null; status: string; currency: string | null; taxRate: string }>(
    `SELECT id, kind, round, status, currency, tax_rate::text AS "taxRate" FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3 FOR UPDATE`,
    [workspaceId, caseId, quoteId])).rows[0];
  if (!quote || quote.kind !== "quotation" || quote.round !== "design" || quote.status !== "draft" || !quote.currency) return null;
  if ((await db.query(`SELECT 1 FROM commercial_quote_lines WHERE workspace_id = $1 AND case_id = $2 AND quote_id = $3 LIMIT 1`, [workspaceId, caseId, quoteId])).rowCount) return null;
  const standard = (await taxCodes(db, workspaceId, caseId)).find((tax) => tax.isDefault) ?? null;
  const line = designFeeLine(await readOpportunityDesignFee(db, workspaceId, caseId, input.includeProposalValue), quote.currency, standard);
  if (!line) return null;
  const lineId = randomUUID();
  await db.query(
    `INSERT INTO commercial_quote_lines (workspace_id, case_id, quote_id, id, sort_order, title, description, kind, quantity, unit, unit_cost, rate,
       pricing_mode, tax_code, tax_rate, version, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8::numeric, $9, NULL, $10::numeric, 'rate', $11, $12::numeric, 1, $13, now())`,
    [workspaceId, caseId, quoteId, lineId, line.title, line.description, line.kind, line.quantity, line.unit, line.rate, line.taxCode, line.taxRate, input.actorUserId]);
  await storeQuotePricing(db, workspaceId, caseId, { id: quote.id, currency: quote.currency, taxRate: quote.taxRate }, await readSettings(db, workspaceId));
  await recordAudit(db, { workspaceId, actorUserId: input.actorUserId, action: "commercial.quote_design_fee_prefilled.v1", entityType: "pre_project_case", entityId: caseId,
    after: { quoteId, lineId, amount: line.rate, currency: quote.currency, source: line.source, taxCode: line.taxCode } });
  return { lineId, rate: line.rate, currency: quote.currency, source: line.source };
}
