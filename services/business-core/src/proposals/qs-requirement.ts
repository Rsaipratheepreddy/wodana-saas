import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { dealRule, opportunityOfCase } from "../fulfilment/fulfilment-rules";

type Db = Pick<PoolClient, "query">;

/** Catalogue item kinds a firm can mark for QS review (catalog_items.item_type). */
export const QS_ITEM_TYPES = ["product", "material", "assembly", "service", "package", "ready_made"] as const;
export type QsItemType = (typeof QS_ITEM_TYPES)[number];
/** Whether the QS prices every quotation (as before) or only where the rules apply. */
export const QS_SCOPES = ["all", "rules"] as const;
export type QsScope = (typeof QS_SCOPES)[number];

/**
 * Why a quotation does or doesn't need the QS (PLM-082/083/084, Palm's second round):
 *   off            — the firm doesn't use a QS (the master switch);
 *   not_quotation  — a variation, where the firm keeps variations away from the QS (or the quotation isn't found);
 *   variation_amount — a variation at or above the amount from which the firm always asks the QS;
 *   every_quotation — the firm's QS prices every quotation;
 *   no_boq         — the deal's order (or its path) needs no BOQ;
 *   design_fee     — a Design Fee (first, paid design round) proposal, under the rules;
 *   boq_required   — the deal's order (or its path) needs a BOQ, under the rules;
 *   lines          — it has lines the rules name: in a work package or of a catalogue kind marked for QS review;
 *   standard_only  — none of its lines needs the QS (standard items only), under the rules.
 */
export type QsReason =
  | { code: "off" | "not_quotation" | "every_quotation" | "no_boq" | "design_fee" | "boq_required" | "standard_only" | "variation_amount" }
  | { code: "lines"; workPackages: string[]; itemTypes: QsItemType[] };
export type QsRequirement = { required: boolean; reason: QsReason };

export type QsInputs = {
  /** The firm's QS switch (Settings › Quotations). */
  qsReview: boolean;
  scope: QsScope;
  quote: { kind: string; round: string | null };
  /** The deal's BOQ choice, else its path's (null: the deal has no say). */
  boqRequired: boolean | null;
  /** Names of the work packages marked for QS review that the quotation's lines use. */
  workPackages: string[];
  /** Catalogue kinds marked for QS review that the quotation's lines use. */
  itemTypes: QsItemType[];
  /**
   * A variation (a change on a started project): whether variations follow the firm's QS rules ("rules", the default)
   * or never go to the QS ("never"), the amount from which one always does, and the variation's total (its size).
   */
  variation?: { rule: "rules" | "never"; threshold: string | null; total: string };
};

/** The decision itself, from what the quotation and the firm's rules say. */
export function decideQsRequirement(input: QsInputs): QsRequirement {
  if (!input.qsReview) return { required: false, reason: { code: "off" } };
  if (input.quote.kind !== "quotation") {
    // A variation follows the rules unless the firm keeps variations away from the QS: a big one always goes; under
    // "every quotation" every variation goes; otherwise one with lines the rules name (joinery work, marked kinds).
    const variation = input.variation;
    if (input.quote.kind !== "variation" || !variation || variation.rule === "never") return { required: false, reason: { code: "not_quotation" } };
    if (variation.threshold && Dec.of(variation.total).abs().cmp(variation.threshold) >= 0) return { required: true, reason: { code: "variation_amount" } };
    if (input.scope === "all") return { required: true, reason: { code: "every_quotation" } };
    if (input.workPackages.length || input.itemTypes.length)
      return { required: true, reason: { code: "lines", workPackages: [...input.workPackages].sort(), itemTypes: [...input.itemTypes].sort() } };
    return { required: false, reason: { code: "standard_only" } };
  }
  if (input.scope === "all") {
    // As before the rules: every quotation, unless the deal's order needs no BOQ.
    return input.boqRequired === false ? { required: false, reason: { code: "no_boq" } } : { required: true, reason: { code: "every_quotation" } };
  }
  if (input.quote.round === "design") return { required: false, reason: { code: "design_fee" } };
  if (input.boqRequired === true) return { required: true, reason: { code: "boq_required" } };
  if (input.workPackages.length || input.itemTypes.length)
    return { required: true, reason: { code: "lines", workPackages: [...input.workPackages].sort(), itemTypes: [...input.itemTypes].sort() } };
  return { required: false, reason: { code: "standard_only" } };
}

/** The firm's QS settings: the switch, its scope and the catalogue kinds it marked. */
export async function readQsRules(db: Db, workspaceId: string) {
  const row = (await db.query<{ qsReview: boolean; scope: QsScope; itemTypes: QsItemType[]; variations: "rules" | "never"; variationThreshold: string | null }>(
    `SELECT qs_review AS "qsReview", qs_review_scope AS scope, qs_review_item_types::text[] AS "itemTypes", qs_variations AS variations,
            qs_variation_threshold::text AS "variationThreshold" FROM workspace_quotation_settings WHERE workspace_id = $1`,
    [workspaceId])).rows[0];
  return row ?? { qsReview: false, scope: "all" as QsScope, itemTypes: [] as QsItemType[], variations: "rules" as const, variationThreshold: null };
}

/**
 * Whether this quotation needs the QS before it reaches the client, and why. Reads the quotation, the deal's BOQ rule
 * and the lines the firm's rules name. A quotation that isn't found needs nothing.
 */
export async function qsRequirement(db: Db, workspaceId: string, caseId: string, quoteId: string): Promise<QsRequirement> {
  const rules = await readQsRules(db, workspaceId);
  const quote = (await db.query<{ kind: string; round: string | null; total: string }>(
    `SELECT kind, round, total::text AS total FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, caseId, quoteId])).rows[0];
  if (!quote) return { required: false, reason: { code: "not_quotation" } };
  const variation = quote.kind === "variation" ? { rule: rules.variations, threshold: rules.variationThreshold, total: quote.total } : undefined;
  if (!rules.qsReview || (quote.kind !== "quotation" && variation?.rule !== "rules"))
    return decideQsRequirement({ ...rules, quote, boqRequired: null, workPackages: [], itemTypes: [], variation });
  const opportunityId = quote.kind === "quotation" ? await opportunityOfCase(db, workspaceId, caseId) : null;
  const boqRequired = opportunityId ? (await dealRule(db, workspaceId, opportunityId))?.boqRequired ?? null : null;
  let workPackages: string[] = [], itemTypes: QsItemType[] = [];
  // A variation always reads its lines: the rules name the work (joinery) whatever the firm's quotation scope.
  if (rules.scope === "rules" || variation) {
    workPackages = (await db.query<{ name: string }>(
      `SELECT DISTINCT trade.name FROM commercial_quote_lines line
         JOIN workspace_work_packages trade ON trade.workspace_id = line.workspace_id AND trade.id = line.work_package_id AND trade.qs_review
        WHERE line.workspace_id = $1 AND line.case_id = $2 AND line.quote_id = $3`, [workspaceId, caseId, quoteId])).rows.map((row) => row.name);
    itemTypes = rules.itemTypes.length ? (await db.query<{ type: QsItemType }>(
      `SELECT DISTINCT item.item_type AS type FROM commercial_quote_lines line
         JOIN catalog_items item ON item.workspace_id = line.workspace_id AND item.id = line.catalog_item_id
        WHERE line.workspace_id = $1 AND line.case_id = $2 AND line.quote_id = $3 AND item.item_type = ANY($4::text[])`,
      [workspaceId, caseId, quoteId, rules.itemTypes])).rows.map((row) => row.type) : [];
  }
  return decideQsRequirement({ ...rules, quote, boqRequired, workPackages, itemTypes, variation });
}

/**
 * Whether a deal quotation needs the QS estimate before it is approved: exactly what the firm's QS rules say
 * (Settings › Quotations). With "QS prices quotations" off the QS prices nothing, so it is approved as priced.
 */
export async function qsEstimateRequired(db: Db, workspaceId: string, caseId: string, quoteId: string): Promise<boolean> {
  return (await qsRequirement(db, workspaceId, caseId, quoteId)).required;
}

/**
 * The review a quotation in review waits for: the QS estimate (`qs_approve`) for a deal-first quotation the firm's QS
 * rules send to the QS, else the plain approval (`approve`). The quote builder, the commercial page and the Approvals
 * inbox all ask this one question, so the same quote is approved the same way wherever the button is pressed.
 */
export async function quoteReviewAction(db: Db, workspaceId: string, caseId: string, quote: { id: string; kind: string }, dealFirst: boolean): Promise<"qs_approve" | "approve"> {
  if (!dealFirst || quote.kind !== "quotation" || !await qsEstimateRequired(db, workspaceId, caseId, quote.id)) return "approve";
  // The QS already confirmed this quotation's pricing (Send to QS): the plain approval follows, the QS isn't asked twice.
  // Sending still checks the pricing hasn't changed since (quote-issue.ts).
  return await qsConfirmed(db, workspaceId, caseId, quote.id) ? "approve" : "qs_approve";
}

/** Whether the QS's latest review of this quotation (PLM-082) confirmed it. */
async function qsConfirmed(db: Db, workspaceId: string, caseId: string, quoteId: string) {
  return (await db.query<{ status: string }>(
    `SELECT status FROM quote_qs_reviews WHERE workspace_id = $1 AND case_id = $2 AND quote_id = $3 ORDER BY requested_at DESC, id DESC LIMIT 1`,
    [workspaceId, caseId, quoteId])).rows[0]?.status === "confirmed";
}
