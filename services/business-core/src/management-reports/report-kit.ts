import { Dec } from "../catalog-core/decimal";
import type { ReportFilters } from "./report-scope";
import { href } from "./report-scope";

/**
 * The shape every management KPI is built from. A KPI query returns *facts* — one row per record behind the figure
 * (a won proposal, a receipt, a lead…) with the dimensions its chart groups by — and the figure, the chart and the
 * drill-down list are all read from the same facts, so a bar always reconciles with the records it opens.
 */
export type RecordKind = "lead" | "opportunity" | "case" | "project" | "quote" | "approval" | "invoice" | "receipt";

export type Fact = {
  id: string;
  kind: RecordKind;
  /** The case or project the link opens (cases and quotes link through their case). */
  parentId: string | null;
  reference: string | null;
  title: string;
  client: string | null;
  owner: string | null;
  ownerId: string | null;
  /** The moment that places the record in the period (ISO), or its due date. */
  at: string | null;
  /** Money in the workspace's base currency (decimal text), already net of tax unless the KPI says otherwise. */
  amount: string | null;
  /** A KPI-specific measure (hours, days, a margin %), decimal text. */
  measure: string | null;
  /** A short status or reason, shown as written (stage names, reasons, statuses). */
  detail: string | null;
  /** What the charts group by. `period` = "1" when the record falls in the chosen period. */
  dims: Record<string, string>;
};

export type Unit = "count" | "money" | "percent" | "hours" | "days";

export type ChartSeries = { id: string; label: string };
export type ChartCategory = { key: string; label: string };
export type Chart =
  | { type: "columns"; dimension: string; seriesDimension?: string; categories: ChartCategory[]; series: ChartSeries[]; values: string[][]; unit: Unit }
  | { type: "lines"; dimension: string; categories: ChartCategory[]; series: ChartSeries[]; values: Array<Array<string | null>>; unit: Unit }
  | { type: "bars"; dimension: string; items: Array<{ key: string; label: string; value: string; count: number; amount?: string | null; target?: TargetResult | null }>; unit: Unit }
  | { type: "donut"; dimension: string; items: Array<{ key: string; label: string; value: string; count: number; amount: string | null }>; unit: Unit }
  | { type: "funnel"; dimension: string; items: Array<{ key: string; label: string; value: string; rate: string | null }> }
  | { type: "gauge"; percent: string | null; target: string | null }
  | { type: "list"; bucket: string };

export type TargetResult = {
  /** The target for the period (decimal text, the KPI's unit). */
  target: string;
  /** Actual ÷ target × 100 (target ÷ actual when lower is better), one decimal; null when it can't be divided. */
  percent: string | null;
  /** Target − actual (actual − target when lower is better). */
  gap: string;
  tone: "success" | "warning" | "danger";
};

export type Kpi = {
  code: string;
  unit: Unit;
  /** The figure (decimal text); null when the data it needs isn't recorded yet ("Not enough data yet"). */
  value: string | null;
  count: number;
  /** Money next to a count (e.g. Won: count and value). */
  amount?: string | null;
  /** The KPI has a target in Settings. */
  targetable: boolean;
  /** undefined: not targetable or no target set; null with targetHidden: a filter other than period and Account Manager is on. */
  target?: TargetResult | null;
  targetHidden?: boolean;
  chart?: Chart;
  /** Records left out of money because they are in another currency, and money whose tax could not be separated. */
  notes?: { otherCurrency?: number; taxIncluded?: number; amountsIncludeTax?: boolean; target?: string };
  /** Extra figures shown with the main one (e.g. average deal size), decimal text keyed by name. */
  extra?: Record<string, string | number | null>;
};

export type Dashboard = { dashboard: string; currency: string; timeZone: string; from: string; to: string; generatedAt: string; kpis: Kpi[] };

// ------------------------------------------------------------------ money and numbers

export const sum = (values: Array<string | null | undefined>) => values.reduce<Dec>((total, value) => (value ? total.add(value) : total), Dec.ZERO);
export const fixed = (value: Dec, places: number) => value.toFixed(places);
/** a ÷ b × 100, one decimal; null when b is zero. */
export const percent = (a: Dec | number, b: Dec | number) => {
  const denominator = Dec.of(b instanceof Dec ? b : String(b));
  if (denominator.isZero()) return null;
  return Dec.of(a instanceof Dec ? a : String(a)).mul(100).div(denominator).toFixed(1);
};
export const mean = (values: string[], places: number) => (values.length ? sum(values).div(values.length).toFixed(places) : null);

export function inPeriod(fact: Fact) { return fact.dims.period === "1"; }

// ------------------------------------------------------------------ calendar categories

const iso = (date: Date) => date.toISOString().slice(0, 10);

/** The 12 months ending with the period's last month, oldest first (YYYY-MM). */
export function monthKeys(filters: Pick<ReportFilters, "to">): string[] {
  const [year, monthNumber] = filters.to.split("-").map(Number);
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(year, monthNumber - 1 - (11 - index), 1));
    return iso(date).slice(0, 7);
  });
}

/** The 12 weeks (start dates) ending with the week of the period's last day, on the workspace's week start. */
export function weekKeys(filters: Pick<ReportFilters, "to">, weekStart: number): string[] {
  const last = new Date(`${filters.to}T00:00:00Z`);
  const start = new Date(last.getTime() - ((last.getUTCDay() - weekStart + 7) % 7) * 86_400_000);
  return Array.from({ length: 12 }, (_, index) => iso(new Date(start.getTime() - (11 - index) * 7 * 86_400_000)));
}

export const categories = (keys: string[]): ChartCategory[] => keys.map((key) => ({ key, label: key }));

/** Count or money per category (and series) from facts. */
export function grid(facts: Fact[], dimension: string, keys: string[], series: ChartSeries[], seriesDimension: string | null, measure: "count" | "amount", places: number) {
  return series.map((item) => keys.map((key) => {
    const matched = facts.filter((fact) => fact.dims[dimension] === key && (!seriesDimension || fact.dims[seriesDimension] === item.id));
    return measure === "count" ? String(matched.length) : sum(matched.map((fact) => fact.amount)).toFixed(places);
  }));
}

/** Groups facts by a dimension, biggest first (by amount when money, else by count). */
export function groupBy(facts: Fact[], dimension: string, label: (fact: Fact) => string, places: number) {
  const groups = new Map<string, { key: string; label: string; count: number; amount: Dec; facts: Fact[] }>();
  for (const fact of facts) {
    const key = fact.dims[dimension] ?? "none";
    const group = groups.get(key) ?? { key, label: label(fact), count: 0, amount: Dec.ZERO, facts: [] };
    group.count += 1;
    if (fact.amount) group.amount = group.amount.add(fact.amount);
    group.facts.push(fact);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({ ...group, amountText: group.amount.toFixed(places) }));
}

// ------------------------------------------------------------------ drill-down

/** Bucket text from a chart click: `dimension=value;dimension=value` (values are dimension values, never SQL). */
export function parseBucket(bucket: string | undefined | null): Record<string, string> {
  if (!bucket) return { period: "1" };
  const out: Record<string, string> = {};
  for (const part of bucket.split(";").slice(0, 4)) {
    const at = part.indexOf("=");
    if (at <= 0) continue;
    out[part.slice(0, at).slice(0, 40)] = part.slice(at + 1).slice(0, 200);
  }
  return Object.keys(out).length ? out : { period: "1" };
}

export function matchBucket(facts: Fact[], bucket: Record<string, string>) {
  return facts.filter((fact) => Object.entries(bucket).every(([key, value]) => fact.dims[key] === value));
}

export type RecordRow = Omit<Fact, "dims" | "parentId"> & { href: string };

export function recordRow(fact: Fact): RecordRow {
  const { dims: _dims, parentId, ...rest } = fact;
  const link = fact.kind === "lead" ? href.lead(fact.id)
    : fact.kind === "opportunity" ? href.opportunity(fact.id)
    : fact.kind === "project" ? href.project(fact.id)
    : fact.kind === "quote" ? href.quote(parentId ?? "", fact.id)
    : fact.kind === "approval" ? href.case(parentId ?? fact.id, "execution-release")
    : fact.kind === "invoice" ? href.invoice(fact.id)
    : href.case(parentId ?? fact.id);
  return { ...rest, href: link };
}

// ------------------------------------------------------------------ row mapping

export type FactRow = {
  id: string; kind: RecordKind; parent_id: string | null; reference: string | null; title: string | null; client: string | null; owner: string | null;
  owner_id: string | null; at: Date | string | null; amount: string | null; measure: string | null; detail: string | null; dims: Record<string, unknown> | null;
};

export function toFact(row: FactRow): Fact {
  const dims: Record<string, string> = {};
  for (const [key, value] of Object.entries(row.dims ?? {})) if (value !== null && value !== undefined) dims[key] = String(value);
  return {
    id: String(row.id), kind: row.kind, parentId: row.parent_id ? String(row.parent_id) : null, reference: row.reference ?? null,
    title: row.title ?? row.reference ?? "", client: row.client ?? null, owner: row.owner ?? null, ownerId: row.owner_id ? String(row.owner_id) : null,
    at: row.at instanceof Date ? row.at.toISOString() : row.at ?? null, amount: row.amount ?? null, measure: row.measure ?? null, detail: row.detail ?? null, dims,
  };
}

/** The columns a fact query selects, in order (each KPI's SQL ends with these). */
export const FACT_COLUMNS = "id, kind, parent_id, reference, title, client, owner, owner_id, at, amount, measure, detail, dims";
