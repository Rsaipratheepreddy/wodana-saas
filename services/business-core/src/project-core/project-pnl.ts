import type { PoolClient } from "pg";
import { Dec } from "../catalog-core/decimal";
import { currencyDecimals } from "../purchasing/orders";
import { COST_CATEGORIES, supplyCategory, type CostCategory } from "./project-money";

/**
 * A project's P&L (plan §6.10, §6.21): what was agreed (the sealed quotation plus the sealed variations), what was
 * invoiced and received, what it cost so far by category against what the quotation planned to spend (the QS cost
 * estimate: each sealed line's unit cost), what is still committed on open orders, and from those the margin so far and
 * the margin expected at completion. Money is exact decimal text (4 places), never a float.
 */

type Db = Pick<PoolClient, "query">;
const fixed = (value: Dec) => value.toFixed(4);
const ZERO = () => Object.fromEntries(COST_CATEGORIES.map((category) => [category, Dec.ZERO])) as Record<CostCategory, Dec>;

/** part ÷ base × 100 to one place (half away from zero); null without a base. */
export function percentOf(part: Dec | string, base: Dec | string): string | null {
  const whole = Dec.of(base);
  return whole.isZero() ? null : Dec.of(part).mul(100).div(whole).round(1).toFixed(1);
}

// ---------------------------------------------------------------------------------------------------------------
// The quotation's cost estimate by category

export type EstimateComponent = { kind: string; quantity: string; unitCost: string | null; wastePercent: string | null; suppliedByClient: boolean };
export type EstimateLine = {
  /** The line's quantity as sealed. */
  quantity: string;
  /** Its unit cost (null when the builder had no cost for it). */
  unitCost: string | null;
  /** The quote line's kind (item, service, allowance...). */
  kind: string;
  /** A variation line that removes scope: a credit at its cost. */
  credit: boolean;
  /** The way of delivery of the package its live scope line is in, when it has one. */
  supply: string | null;
  components: EstimateComponent[];
};

/** A line without a package: services and site work are labour, items are materials, the rest is other. */
export function lineKindCategory(kind: string): CostCategory {
  if (["service", "relocate", "dismantle", "remove_store", "dispose"].includes(kind)) return "subcontract_labour";
  if (kind === "item") return "materials";
  return "other";
}

/**
 * Where a part of a line's build-up goes. A package made in the factory or subcontracted takes the whole line; a bought
 * or site package splits it: labour to subcontract and labour, materials, finishes and hardware to materials.
 */
export function componentCategory(kind: string, supply: string | null): CostCategory {
  if (supply === "make") return "factory";
  if (supply === "subcontract") return "subcontract_labour";
  if (kind === "labour") return "subcontract_labour";
  if (kind === "material" || kind === "finish" || kind === "hardware") return "materials";
  return "other";
}

/** One line's category when it has no build-up to split by. */
export function lineCategory(line: Pick<EstimateLine, "kind" | "supply">): CostCategory {
  return line.supply === "client" ? lineKindCategory(line.kind) : supplyCategory(line.supply, lineKindCategory(line.kind));
}

/**
 * The estimate per category: each line's cost (quantity × unit cost, to the currency's places; negative for a credit),
 * split over its build-up by each part's share of the build-up's cost (the rounding rest to the largest part). A line
 * without a cost is counted as missing, never as zero cost.
 */
export function estimateByCategory(lines: readonly EstimateLine[], places: number) {
  const byCategory = ZERO();
  let missing = 0;
  for (const line of lines) {
    if (line.unitCost === null) { missing += 1; continue; }
    let cost = Dec.of(line.quantity).mul(line.unitCost).round(places);
    if (line.credit) cost = cost.neg();
    if (cost.isZero()) continue;
    const parts = line.components.map((part) => ({
      category: componentCategory(part.kind, line.supply),
      weight: part.suppliedByClient || part.unitCost === null ? Dec.ZERO : Dec.of(part.quantity).mul(part.unitCost).mul(Dec.ONE.add(Dec.of(part.wastePercent ?? "0").div(100))),
    })).filter((part) => part.weight.cmp(0) > 0);
    const weight = parts.reduce((sum, part) => sum.add(part.weight), Dec.ZERO);
    if (!parts.length || weight.isZero()) { const category = lineCategory(line); byCategory[category] = byCategory[category].add(cost); continue; }
    let given = Dec.ZERO;
    let largest = parts[0];
    for (const part of parts) {
      const share = cost.mul(part.weight).div(weight).round(places);
      byCategory[part.category] = byCategory[part.category].add(share);
      given = given.add(share);
      if (part.weight.cmp(largest.weight) > 0) largest = part;
    }
    byCategory[largest.category] = byCategory[largest.category].add(cost.sub(given));
  }
  return { byCategory, total: COST_CATEGORIES.reduce((sum, category) => sum.add(byCategory[category]), Dec.ZERO), missing };
}

export type QuotedEstimate = { currency: string | null; byCategory: Record<CostCategory, string> | null; total: string | null; lines: number; missing: number };

/**
 * The cost the sealed quotations planned, per category: the baseline's lines that made the live scope (chosen options
 * included), and every sealed variation's lines (removals as credits), each priced at its unit cost and placed by the
 * package its scope line is in. Null figures when the quotations are in different currencies or no line has a cost.
 */
export async function readQuotedEstimate(db: Db, workspaceId: string, project: { id: string; caseId: string }): Promise<QuotedEstimate> {
  const rows = (await db.query<{ quoteId: string; lineId: string; currency: string; quantity: string; unitCost: string | null; kind: string; credit: boolean; supply: string | null }>(
    `SELECT seal.quote_id AS "quoteId", line.id AS "lineId", btrim(seal.currency) AS currency, line.quantity::text AS quantity, line.unit_cost::text AS "unitCost", line.kind,
            coalesce(line.change_op = 'omit', false) AS credit, coalesce(own.supply, target.supply) AS supply
       FROM project_scope_seals seal
       JOIN commercial_quote_lines line ON line.workspace_id = seal.workspace_id AND line.case_id = $3 AND line.quote_id = seal.quote_id
       LEFT JOIN project_boq_lines boq ON boq.workspace_id = seal.workspace_id AND boq.project_id = seal.project_id AND boq.origin_seal_id = seal.id AND boq.source_line_id = line.id
       LEFT JOIN project_packages own ON own.workspace_id = boq.workspace_id AND own.id = boq.package_id
       LEFT JOIN project_boq_lines changed ON changed.workspace_id = seal.workspace_id AND changed.project_id = seal.project_id AND changed.id = line.boq_line_id
       LEFT JOIN project_packages target ON target.workspace_id = changed.workspace_id AND target.id = changed.package_id
      WHERE seal.workspace_id = $1 AND seal.project_id = $2
        -- The baseline counts what made the live scope; a variation counts its additions, removals and moves.
        AND (boq.id IS NOT NULL OR (seal.kind = 'variation' AND line.change_op IN ('omit', 'move') AND NOT coalesce(line.optional, false)))
      ORDER BY seal.sealed_at, line.sort_order`, [workspaceId, project.id, project.caseId])).rows;
  const currencies = new Set(rows.map((row) => row.currency));
  if (!rows.length || currencies.size !== 1) return { currency: currencies.size === 1 ? [...currencies][0] : null, byCategory: null, total: null, lines: rows.length, missing: 0 };
  const currency = [...currencies][0];
  const components = rows.length ? (await db.query<{ quoteId: string; lineId: string } & EstimateComponent>(
    `SELECT quote_id AS "quoteId", line_id AS "lineId", kind, quantity::text AS quantity, unit_cost::text AS "unitCost", waste_percent::text AS "wastePercent",
            supplied_by_client AS "suppliedByClient"
       FROM commercial_quote_line_components WHERE workspace_id = $1 AND case_id = $2 AND quote_id = ANY($3::text[]) ORDER BY position`,
    [workspaceId, project.caseId, [...new Set(rows.map((row) => row.quoteId))]])).rows : [];
  const lines: EstimateLine[] = rows.map((row) => ({
    quantity: row.quantity, unitCost: row.unitCost, kind: row.kind, credit: row.credit, supply: row.supply,
    components: components.filter((part) => part.quoteId === row.quoteId && part.lineId === row.lineId),
  }));
  const estimate = estimateByCategory(lines, currencyDecimals(currency));
  const known = lines.length - estimate.missing;
  if (!known) return { currency, byCategory: null, total: null, lines: lines.length, missing: estimate.missing };
  return { currency, byCategory: Object.fromEntries(COST_CATEGORIES.map((category) => [category, fixed(estimate.byCategory[category])])) as Record<CostCategory, string>,
    total: fixed(estimate.total), lines: lines.length, missing: estimate.missing };
}

// ---------------------------------------------------------------------------------------------------------------
// What was agreed and what was invoiced

export type ContractPart = { sealId: string; label: string; net: string; total: string; acceptedAt: string };
export type Contract = { currency: string; baseline: ContractPart | null; variations: ContractPart[] };

/** The sealed baseline and each sealed variation, before tax (net) and with tax (total). */
export async function readContract(db: Db, workspaceId: string, project: { id: string; currency: string }): Promise<Contract> {
  const seals = (await db.query<{ sealId: string; kind: string; label: string; net: string | null; total: string; acceptedAt: string }>(
    `SELECT id AS "sealId", kind, revision_label AS label, total::text AS total, accepted_at AS "acceptedAt",
            CASE WHEN (snapshot->'pricing'->>'net') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN snapshot->'pricing'->>'net' END AS net
       FROM project_scope_seals WHERE workspace_id = $1 AND project_id = $2 ORDER BY sealed_at`, [workspaceId, project.id])).rows;
  const part = (seal: (typeof seals)[number]): ContractPart => ({ sealId: seal.sealId, label: seal.label, net: fixed(Dec.of(seal.net ?? seal.total)), total: fixed(Dec.of(seal.total)),
    acceptedAt: new Date(seal.acceptedAt).toISOString() });
  const baseline = seals.find((seal) => seal.kind === "baseline");
  return { currency: project.currency, baseline: baseline ? part(baseline) : null, variations: seals.filter((seal) => seal.kind === "variation").map(part) };
}

/** Tax invoices issued for the project and not credited: before tax and with tax. */
export async function readInvoiced(db: Db, workspaceId: string, projectId: string) {
  const row = (await db.query<{ net: string; total: string }>(
    `SELECT coalesce(sum(net), 0)::text AS net, coalesce(sum(total), 0)::text AS total FROM client_invoices WHERE workspace_id = $1 AND project_id = $2 AND status = 'issued'`,
    [workspaceId, projectId])).rows[0];
  return { net: fixed(Dec.of(row.net)), total: fixed(Dec.of(row.total)) };
}

/** The firm's lowest acceptable margin (Settings › Quotation › margin floor), as the projects' target; null when not set. */
export async function readTargetMargin(db: Db, workspaceId: string): Promise<string | null> {
  const value = (await db.query<{ percent: string | null }>(`SELECT margin_floor_percent::text AS percent FROM workspace_quotation_settings WHERE workspace_id = $1`,
    [workspaceId])).rows[0]?.percent ?? null;
  return value === null ? null : Dec.of(value).toFixed(1);
}

// ---------------------------------------------------------------------------------------------------------------
// The P&L

export type PnlCategory = {
  category: CostCategory;
  /** What the quotation planned for it; null without an estimate (or in another currency). */
  budget: string | null;
  actual: string;
  committed: string;
  /** The budget not yet spent or committed (never below zero); zero without a budget. */
  remaining: string;
  /** actual + committed + remaining: what it is expected to cost by the end. */
  forecast: string;
  /** budget − forecast; negative when it runs over. */
  variance: string | null;
  /** (actual + committed) ÷ budget, as a percentage. */
  usedPercent: string | null;
  over: boolean;
};

export type PnlFlag =
  | { code: "over_budget"; category: CostCategory; amount: string }
  | { code: "forecast_loss"; amount: string }
  | { code: "below_target"; forecastPercent: string; target: string }
  | { code: "estimate_incomplete"; count: number }
  | { code: "no_estimate" };

export type PnlInput = {
  /** The currency costs are kept in (the workspace's). */
  currency: string;
  contract: Contract;
  invoiced: { net: string; total: string };
  /** Client money received, in the project's currency. */
  received: string;
  actual: Partial<Record<CostCategory, Dec | string>>;
  committed: Partial<Record<CostCategory, Dec | string>>;
  estimate: QuotedEstimate;
  targetMarginPercent: string | null;
};

export type PnlFigures = {
  currency: string;
  contractCurrency: string;
  /** Revenue and costs are in the same currency, so margins can be worked out. */
  comparable: boolean;
  contract: { baselineNet: string; baselineTotal: string; variationsNet: string; variationsTotal: string; variations: ContractPart[]; net: string; total: string };
  revenue: { invoicedNet: string; invoicedTotal: string; received: string };
  categories: PnlCategory[];
  totals: { budget: string | null; actual: string; committed: string; remaining: string; forecast: string };
  margin: { toDate: string | null; toDatePercent: string | null; forecast: string | null; forecastPercent: string | null; target: string | null };
  flags: PnlFlag[];
};

/**
 * The P&L from its parts. Budgets compare only when the quotation and the costs share a currency. Margin so far is
 * invoiced revenue before tax less what has been spent; margin at completion is the agreed value before tax less the
 * expected cost (spent + committed + the rest of each category's budget). Categories with nothing planned, spent or
 * committed are left out.
 */
export function buildPnl(input: PnlInput): PnlFigures {
  const actual = ZERO(), committed = ZERO();
  for (const category of COST_CATEGORIES) {
    actual[category] = Dec.of(input.actual[category] ?? "0");
    committed[category] = Dec.of(input.committed[category] ?? "0");
  }
  const comparable = input.contract.currency === input.currency;
  const budgets = comparable && input.estimate.byCategory && input.estimate.currency === input.currency ? input.estimate.byCategory : null;
  const categories: PnlCategory[] = [];
  const totals = { budget: Dec.ZERO, actual: Dec.ZERO, committed: Dec.ZERO, remaining: Dec.ZERO, forecast: Dec.ZERO };
  const flags: PnlFlag[] = [];
  for (const category of COST_CATEGORIES) {
    // A category the quotation planned nothing for has no budget to run over (petty cash, say).
    const budget = budgets && !Dec.of(budgets[category]).isZero() ? Dec.of(budgets[category]) : null;
    const used = actual[category].add(committed[category]);
    if (budget === null && actual[category].isZero() && committed[category].isZero()) continue;
    const left = budget === null ? Dec.ZERO : budget.sub(used);
    const remaining = left.cmp(0) > 0 ? left : Dec.ZERO;
    const forecast = used.add(remaining);
    const over = budget !== null && used.cmp(budget) > 0;
    categories.push({ category, budget: budget === null ? null : fixed(budget), actual: fixed(actual[category]), committed: fixed(committed[category]), remaining: fixed(remaining),
      forecast: fixed(forecast), variance: budget === null ? null : fixed(budget.sub(forecast)), usedPercent: budget === null ? null : percentOf(used, budget), over });
    if (over) flags.push({ code: "over_budget", category, amount: fixed(used.sub(budget!)) });
    totals.budget = totals.budget.add(budget ?? Dec.ZERO);
    totals.actual = totals.actual.add(actual[category]);
    totals.committed = totals.committed.add(committed[category]);
    totals.remaining = totals.remaining.add(remaining);
    totals.forecast = totals.forecast.add(forecast);
  }
  const baselineNet = Dec.of(input.contract.baseline?.net ?? "0"), baselineTotal = Dec.of(input.contract.baseline?.total ?? "0");
  const variationsNet = input.contract.variations.reduce((sum, item) => sum.add(item.net), Dec.ZERO);
  const variationsTotal = input.contract.variations.reduce((sum, item) => sum.add(item.total), Dec.ZERO);
  const contractNet = baselineNet.add(variationsNet);
  const invoicedNet = Dec.of(input.invoiced.net);
  const toDate = comparable ? invoicedNet.sub(totals.actual) : null;
  const forecastMargin = comparable ? contractNet.sub(totals.forecast) : null;
  const forecastPercent = forecastMargin === null ? null : percentOf(forecastMargin, contractNet);
  if (forecastMargin !== null && forecastMargin.cmp(0) < 0) flags.push({ code: "forecast_loss", amount: fixed(forecastMargin.neg()) });
  else if (forecastPercent !== null && input.targetMarginPercent !== null && Dec.of(forecastPercent).cmp(input.targetMarginPercent) < 0)
    flags.push({ code: "below_target", forecastPercent, target: input.targetMarginPercent });
  if (comparable && input.estimate.missing > 0) flags.push({ code: "estimate_incomplete", count: input.estimate.missing });
  if (comparable && !budgets && input.estimate.missing === 0) flags.push({ code: "no_estimate" });
  return {
    currency: input.currency, contractCurrency: input.contract.currency, comparable,
    contract: { baselineNet: fixed(baselineNet), baselineTotal: fixed(baselineTotal), variationsNet: fixed(variationsNet), variationsTotal: fixed(variationsTotal),
      variations: input.contract.variations, net: fixed(contractNet), total: fixed(baselineTotal.add(variationsTotal)) },
    revenue: { invoicedNet: fixed(invoicedNet), invoicedTotal: fixed(Dec.of(input.invoiced.total)), received: fixed(Dec.of(input.received)) },
    categories,
    totals: { budget: budgets ? fixed(totals.budget) : null, actual: fixed(totals.actual), committed: fixed(totals.committed), remaining: fixed(totals.remaining), forecast: fixed(totals.forecast) },
    margin: { toDate: toDate === null ? null : fixed(toDate), toDatePercent: toDate === null ? null : percentOf(toDate, invoicedNet),
      forecast: forecastMargin === null ? null : fixed(forecastMargin), forecastPercent, target: input.targetMarginPercent },
    flags,
  };
}

/** The P&L for someone who sees the project's costs but not its margins: no margin, and no flags that give it away. */
export function withoutMargin(figures: PnlFigures): PnlFigures {
  return { ...figures, margin: { toDate: null, toDatePercent: null, forecast: null, forecastPercent: null, target: null },
    flags: figures.flags.filter((flag) => flag.code !== "forecast_loss" && flag.code !== "below_target") };
}
