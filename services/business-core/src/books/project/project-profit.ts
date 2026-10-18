import type { PoolClient } from "pg";
import { Dec } from "../../catalog-core/decimal";
import { commercialRepository } from "../../commercial/commercial-repository";
import type { CommercialData } from "../../commercial/commercial.types";
import { readProjectCommitted, readProjectCosts } from "../../project-core/project-money";
import { enabledBooksSettings, readBooksSettings } from "../ledger/ledger";

/**
 * Live project profit from the Ledger (plan §6.21b, slice E): what a project earned and cost so far, read from the
 * journal lines that carry its project dimension, against what the accepted quotation planned. Revenue is the net
 * movement on income accounts (invoices less credit notes, before tax); costs are split by the posting role of the
 * expense account they were booked to. Money is exact decimal text in the company's functional currency.
 */

type Db = Pick<PoolClient, "query">;

/** The cost buckets of a project P&L, in display order. */
export const COST_BUCKETS = ["materials", "subcontract", "labour", "siteExpenses", "priceVariance", "other", "cogs"] as const;
export type CostBucket = (typeof COST_BUCKETS)[number];
export type ProjectCosts = Record<CostBucket, string>;

/** Which bucket each posting role books into; the first role an account plays (in this order) decides. */
const ROLE_BUCKETS: ReadonlyArray<[string, CostBucket]> = [
  ["cost_materials", "materials"], ["cost_subcontract", "subcontract"], ["cost_labour", "labour"], ["cost_site_expenses", "siteExpenses"],
  ["cost_price_variance", "priceVariance"], ["cogs_goods", "cogs"], ["cost_other", "other"],
];
/** The labour absorbed contra offsets labour cost in the company's books: never a project's cost. */
const NOT_A_COST = new Set(["labour_absorbed"]);

/** Ledger links (users see "Ledger"; the routes are the shared contract's `ledgerHref`). */
export const ledgerLinks = {
  projectJournals: (projectId: string) => `/workspace/ledger/journals?project=${encodeURIComponent(projectId)}`,
  projectMoney: (projectId: string) => `/workspace/projects/${encodeURIComponent(projectId)}/money`,
  report: (report: string, scope: { entity?: string; from?: string; to?: string } = {}) => {
    const search = new URLSearchParams(Object.entries(scope).filter((entry): entry is [string, string] => Boolean(entry[1])));
    return `/workspace/ledger/reports/${report}${search.size ? `?${search}` : ""}`;
  },
};

/** One project's lines summed per account (functional currency). */
export type AccountMovement = { projectId: string; accountType: string; roles: string[]; debit: string; credit: string };

export type ProjectFigures = { revenue: string; costs: ProjectCosts; totalCost: string; profit: string; marginPercent: string | null };

const zeroCosts = (): Record<CostBucket, Dec> => Object.fromEntries(COST_BUCKETS.map((bucket) => [bucket, Dec.ZERO])) as Record<CostBucket, Dec>;
const fixed = (value: Dec) => value.toFixed(4);

/** The bucket an expense account's lines go to, or null when they aren't a project cost. */
export function costBucket(roles: readonly string[]): CostBucket | null {
  for (const [role, bucket] of ROLE_BUCKETS) if (roles.includes(role)) return bucket;
  if (roles.some((role) => NOT_A_COST.has(role))) return null;
  return "other";
}

/** profit ÷ revenue × 100, two decimals; null without revenue. */
export function marginOf(profit: Dec, revenue: Dec): string | null {
  return revenue.isZero() ? null : profit.mul(100).div(revenue).round(2).toFixed(2);
}

/**
 * Revenue, costs by bucket, profit and margin per project from its account movements. Income accounts give revenue
 * (credit − debit); expense accounts give cost (debit − credit) in their role's bucket; balance-sheet lines that carry
 * the project (receivables, stock, VAT) are not profit and are left out.
 */
export function projectFigures(movements: readonly AccountMovement[]): Map<string, ProjectFigures> {
  const totals = new Map<string, { revenue: Dec; costs: Record<CostBucket, Dec> }>();
  for (const movement of movements) {
    const entry = totals.get(movement.projectId) ?? { revenue: Dec.ZERO, costs: zeroCosts() };
    totals.set(movement.projectId, entry);
    if (movement.accountType === "income") entry.revenue = entry.revenue.add(movement.credit).sub(movement.debit);
    else if (movement.accountType === "expense") {
      const bucket = costBucket(movement.roles);
      if (bucket) entry.costs[bucket] = entry.costs[bucket].add(movement.debit).sub(movement.credit);
    }
  }
  const result = new Map<string, ProjectFigures>();
  for (const [projectId, entry] of totals) {
    const totalCost = COST_BUCKETS.reduce((sum, bucket) => sum.add(entry.costs[bucket]), Dec.ZERO);
    const profit = entry.revenue.sub(totalCost);
    result.set(projectId, {
      revenue: fixed(entry.revenue), costs: Object.fromEntries(COST_BUCKETS.map((bucket) => [bucket, fixed(entry.costs[bucket])])) as ProjectCosts,
      totalCost: fixed(totalCost), profit: fixed(profit), marginPercent: marginOf(profit, entry.revenue),
    });
  }
  return result;
}

/** A project with nothing posted yet. */
export const emptyFigures = (): ProjectFigures => ({
  revenue: fixed(Dec.ZERO), costs: Object.fromEntries(COST_BUCKETS.map((bucket) => [bucket, fixed(Dec.ZERO)])) as ProjectCosts,
  totalCost: fixed(Dec.ZERO), profit: fixed(Dec.ZERO), marginPercent: null,
});

/** The journal lines of these projects in one company, summed per account, optionally within a period of journal dates. */
export async function readProjectMovements(db: Db, workspaceId: string, legalEntityId: string, projectIds: readonly string[] | null,
  period: { from?: string | null; to?: string | null } = {}): Promise<AccountMovement[]> {
  return (await db.query<AccountMovement>(
    `SELECT line.project_id AS "projectId", account.type AS "accountType",
            coalesce((SELECT array_agg(role.role::text ORDER BY role.role) FROM books_account_roles role
                       WHERE role.workspace_id = account.workspace_id AND role.legal_entity_id = account.legal_entity_id AND role.account_id = account.id), '{}') AS roles,
            sum(line.debit)::text AS debit, sum(line.credit)::text AS credit
       FROM books_journal_lines line
       JOIN books_journals journal ON journal.workspace_id = line.workspace_id AND journal.id = line.journal_id
       JOIN books_accounts account ON account.workspace_id = line.workspace_id AND account.id = line.account_id
      WHERE line.workspace_id = $1 AND line.legal_entity_id = $2 AND line.project_id IS NOT NULL
        AND ($3::uuid[] IS NULL OR line.project_id = ANY($3::uuid[]))
        AND ($4::date IS NULL OR journal.journal_date >= $4::date) AND ($5::date IS NULL OR journal.journal_date <= $5::date)
        AND account.type IN ('income', 'expense')
      GROUP BY line.project_id, account.workspace_id, account.legal_entity_id, account.id, account.type`,
    [workspaceId, legalEntityId, projectIds, period.from ?? null, period.to ?? null])).rows;
}

/** What the accepted quotation (and every sealed variation) planned: the value before tax and, when every one carries it, the cost. */
export type QuotedPlan = { currency: string | null; value: string | null; cost: string | null; marginPercent: string | null };

/**
 * The plan per project: each sealed quotation's value before tax, and its cost from the QS estimate on the quotation,
 * else the Deal File's cost for it (as the owner overview reads margin). Without a cost for every sealed quotation the
 * planned cost and margin are unknown, never treated as zero.
 */
export async function readQuotedPlans(db: Db, workspaceId: string, projectIds: readonly string[]): Promise<Map<string, QuotedPlan>> {
  const rows = (await db.query<{ projectId: string; currency: string; net: string | null; cost: string | null }>(
    `SELECT seal.project_id AS "projectId", btrim(seal.currency) AS currency,
            coalesce(CASE WHEN (seal.snapshot->'pricing'->>'net') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (seal.snapshot->'pricing'->>'net') END, seal.total::text) AS net,
            coalesce(CASE WHEN (quote.detail->'qsEstimate'->>'cost') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (quote.detail->'qsEstimate'->>'cost') END,
                     (SELECT deal.cost::text FROM commercial_deal_files deal
                       WHERE deal.workspace_id = project.workspace_id AND deal.case_id = project.case_id AND deal.quote_id = seal.quote_id AND deal.cost > 0)) AS cost
       FROM project_scope_seals seal
       JOIN delivery_projects project ON project.workspace_id = seal.workspace_id AND project.id = seal.project_id
       LEFT JOIN commercial_quotes quote ON quote.workspace_id = project.workspace_id AND quote.case_id = project.case_id AND quote.id = seal.quote_id
      WHERE seal.workspace_id = $1 AND seal.project_id = ANY($2::uuid[])`, [workspaceId, projectIds])).rows;
  const plans = new Map<string, { currency: string | null; value: Dec; cost: Dec | null; mixed: boolean }>();
  for (const row of rows) {
    const plan = plans.get(row.projectId) ?? { currency: row.currency, value: Dec.ZERO, cost: Dec.ZERO, mixed: false };
    plans.set(row.projectId, plan);
    if (plan.currency !== row.currency) plan.mixed = true;
    plan.value = plan.value.add(row.net ?? "0");
    plan.cost = plan.cost === null || row.cost === null ? null : plan.cost.add(row.cost);
  }
  const result = new Map<string, QuotedPlan>();
  for (const [projectId, plan] of plans) {
    if (plan.mixed) { result.set(projectId, { currency: null, value: null, cost: null, marginPercent: null }); continue; }
    result.set(projectId, {
      currency: plan.currency, value: fixed(plan.value), cost: plan.cost === null ? null : fixed(plan.cost),
      marginPercent: plan.cost === null ? null : marginOf(plan.value.sub(plan.cost), plan.value),
    });
  }
  return result;
}

/** Actual margin less planned margin, in percentage points (two decimals); null when either is unknown. */
export function marginVsQuote(actual: string | null, quoted: string | null): string | null {
  return actual === null || quoted === null ? null : Dec.of(actual).sub(quoted).round(2).toFixed(2);
}

export type Company = { legalEntityId: string; name: string; currency: string; enabled: boolean };

async function company(db: Db, workspaceId: string, legalEntityId: string): Promise<Company | null> {
  const settings = await readBooksSettings(db, workspaceId, legalEntityId);
  const entity = (await db.query<{ name: string; currency: string }>(
    `SELECT coalesce(nullif(registered_name, ''), display_name) AS name, base_currency AS currency FROM legal_entities WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, legalEntityId])).rows[0];
  if (!entity) return null;
  return { legalEntityId, name: entity.name, currency: settings?.functionalCurrency ?? entity.currency, enabled: Boolean(settings?.enabled) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The company a project's books sit in: the company its tax invoices are issued from, else the contract's company
 * on its payment milestones, else the company most of its journal lines are in, else the only company with the
 * Ledger on, else the only active company. Null when none of these decides.
 */
export async function projectCompany(db: Db, workspaceId: string, projectId: string): Promise<Company | null> {
  const invoiced = (await db.query<{ id: string }>(
    `SELECT legal_entity_id AS id FROM client_invoices WHERE workspace_id = $1 AND project_id = $2 ORDER BY issue_date DESC, number DESC LIMIT 1`,
    [workspaceId, projectId])).rows[0]?.id;
  if (invoiced) return company(db, workspaceId, invoiced);
  const project = (await db.query<{ caseId: string }>(`SELECT case_id AS "caseId" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0];
  if (project) {
    const quotes = new Set((await db.query<{ quoteId: string }>(`SELECT quote_id AS "quoteId" FROM project_scope_seals WHERE workspace_id = $1 AND project_id = $2`,
      [workspaceId, projectId])).rows.map((row) => row.quoteId));
    const loaded = await commercialRepository.load(db as PoolClient, workspaceId, project.caseId);
    const contract = ((loaded?.content as CommercialData | undefined)?.payments ?? [])
      .find((payment) => payment.sourceQuoteId && quotes.has(payment.sourceQuoteId) && payment.legalEntityId && UUID.test(payment.legalEntityId))?.legalEntityId;
    if (contract) return company(db, workspaceId, contract);
  }
  const booked = (await db.query<{ id: string }>(
    `SELECT legal_entity_id AS id FROM books_journal_lines WHERE workspace_id = $1 AND project_id = $2 GROUP BY legal_entity_id ORDER BY count(*) DESC, legal_entity_id LIMIT 1`,
    [workspaceId, projectId])).rows[0]?.id;
  if (booked) return company(db, workspaceId, booked);
  const enabled = await enabledBooksSettings(db, workspaceId);
  if (enabled.length === 1) return company(db, workspaceId, enabled[0].legalEntityId);
  const active = (await db.query<{ id: string }>(`SELECT id FROM legal_entities WHERE workspace_id = $1 AND status = 'active' AND archived_at IS NULL`, [workspaceId])).rows;
  return active.length === 1 ? company(db, workspaceId, active[0].id) : null;
}

/** The companies with the Ledger on, by name. */
export async function ledgerCompanies(db: Db, workspaceId: string): Promise<Company[]> {
  const enabled = await enabledBooksSettings(db, workspaceId);
  const companies: Array<Company | null> = [];
  for (const settings of enabled) companies.push(await company(db, workspaceId, settings.legalEntityId));
  return companies.filter((item): item is Company => Boolean(item)).sort((a, b) => a.name.localeCompare(b.name));
}

/** The company's today in its own time zone (else the workspace's). */
export async function companyToday(db: Db, workspaceId: string, legalEntityId: string): Promise<string> {
  return (await db.query<{ today: string }>(
    `SELECT (now() AT TIME ZONE coalesce(nullif(entity.timezone, ''), nullif(workspace.default_timezone, ''), 'UTC'))::date::text AS today
       FROM workspaces workspace LEFT JOIN legal_entities entity ON entity.workspace_id = workspace.id AND entity.id = $2 WHERE workspace.id = $1`,
    [workspaceId, legalEntityId])).rows[0].today;
}

/** What the project still has on order and not yet received (the Money tab's committed), in the workspace's currency. */
export async function readCommitted(db: Db, workspaceId: string, projectId: string) {
  const home = (await db.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0].currency;
  const committed = await readProjectCommitted(db, workspaceId, projectId);
  return { amount: committed.total, currency: home, unconverted: committed.unconverted };
}

/**
 * The Ledger's project cost against the Money tab's "spent" (read only): the same records, so they agree once every
 * source has posted. A difference means events still waiting to post (see the Ledger's attention list) or costs the
 * Money tab could not price. Null when the two are kept in different currencies.
 */
export async function reconcileSpent(db: Db, workspaceId: string, projectId: string, ledgerCost: string, functionalCurrency: string) {
  const costs = await readProjectCosts(db, workspaceId, projectId);
  const same = costs.currency === functionalCurrency;
  return {
    moneySpent: costs.total, moneyCurrency: costs.currency, uncosted: costs.uncosted,
    difference: same ? fixed(Dec.of(ledgerCost).sub(costs.total)) : null,
    matches: same ? Dec.of(ledgerCost).cmp(costs.total) === 0 : null,
  };
}
