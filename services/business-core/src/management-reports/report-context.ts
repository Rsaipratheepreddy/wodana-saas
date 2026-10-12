import type { PoolClient } from "pg";
import { currencyDecimals } from "../common/currency";
import { type Better, type Fact, type FactRow, type Kpi, inPeriod, toFact } from "./report-kit";
import { scopeParams, type ReportFilters } from "./report-scope";
import { loadTargets } from "./report-targets";

type Db = Pick<PoolClient, "query">;

/** Everything a KPI needs: the member's tenant connection, the filters and the workspace's calendar and currency. */
export type ReportContext = {
  db: Db; workspaceId: string; filters: ReportFilters; now: Date; params: unknown[];
  currency: string; places: number; timeZone: string; weekStart: number;
  targets: Awaited<ReturnType<typeof loadTargets>>;
  /** Labels the workspace configured (enquiry types, sources…), code → label. */
  labels: { enquiryTypes: Map<string, string>; sources: Map<string, string>; packages: Map<string, string> };
  /** Whether the member holds a permission a figure needs beyond opening the dashboard (e.g. seeing margins). */
  can: (permission: string) => boolean;
};

/**
 * One KPI: how its records are read (facts) and how the figure and chart are built from them. `compare` (a figure for
 * the period, not a live one) also reads the span just before and says which way is good news.
 */
export type KpiSpec = {
  code: string; facts: (ctx: ReportContext) => Promise<Fact[]>; build: (ctx: ReportContext, facts: Fact[]) => Kpi | Promise<Kpi>;
  compare?: Better;
  /** Permissions (any one) the member needs to see this figure, beyond opening its dashboard (e.g. margins). */
  requires?: string[];
};

export async function readFacts(ctx: ReportContext, sql: string): Promise<Fact[]> {
  return (await ctx.db.query<FactRow>(sql, ctx.params)).rows.map(toFact);
}

export async function reportContext(db: Db, workspaceId: string, filters: ReportFilters, now: Date, can: (permission: string) => boolean = () => true): Promise<ReportContext> {
  const workspace = (await db.query<{ currency: string; timeZone: string; weekStart: number }>(
    `SELECT btrim(default_currency) AS currency, COALESCE(NULLIF(btrim(default_timezone), ''), 'UTC') AS "timeZone",
            CASE WHEN week_starts_on BETWEEN 0 AND 6 THEN week_starts_on::int ELSE 1 END AS "weekStart" FROM workspaces WHERE id = $1`, [workspaceId])).rows[0];
  const options = (await db.query<{ taxonomy: string; code: string; label: string }>(
    `SELECT taxonomy.code AS taxonomy, choice.code, choice.label FROM crm_taxonomies taxonomy
       JOIN crm_taxonomy_options choice ON choice.workspace_id = taxonomy.workspace_id AND choice.taxonomy_id = taxonomy.id
      WHERE taxonomy.workspace_id = $1 AND taxonomy.code IN ('enquiry_type', 'lead_source')`, [workspaceId])).rows;
  const packages = (await db.query<{ id: string; name: string }>(`SELECT id, name FROM design_packages WHERE workspace_id = $1`, [workspaceId])).rows;
  const map = (taxonomy: string) => new Map(options.filter((row) => row.taxonomy === taxonomy).map((row) => [row.code, row.label]));
  const currency = workspace?.currency ?? "USD";
  return {
    db, workspaceId, filters, now, params: scopeParams(workspaceId, filters, now),
    currency, places: currencyDecimals(currency), timeZone: workspace?.timeZone ?? "UTC", weekStart: workspace?.weekStart ?? 1,
    targets: await loadTargets(db, workspaceId, filters.from, filters.to),
    labels: { enquiryTypes: map("enquiry_type"), sources: map("lead_source"), packages: new Map(packages.map((row) => [row.id, row.name])) }, can,
  };
}

/** Records left out of money (other currency) or whose tax could not be separated, among the period's facts. */
export function moneyNotes(facts: Fact[], includeTax = false): Kpi["notes"] {
  const period = facts.filter(inPeriod);
  const otherCurrency = period.filter((fact) => fact.dims.currency === "other").length;
  const taxIncluded = includeTax ? 0 : period.filter((fact) => fact.dims.currency === "base" && fact.dims.tax === "gross" && fact.amount !== null).length;
  const notes: NonNullable<Kpi["notes"]> = {};
  if (otherCurrency) notes.otherCurrency = otherCurrency;
  if (taxIncluded) notes.taxIncluded = taxIncluded;
  if (includeTax) notes.amountsIncludeTax = true;
  return Object.keys(notes).length ? notes : undefined;
}
