import type { PoolClient } from "pg";
import { projectCompany, projectFigures, readProjectMovements } from "../books/project/project-profit";
import { revenueCategoryOfQuote } from "../books/statements/classify";
import { taxInside } from "../books/statements/documents";
import { Dec } from "../catalog-core/decimal";
import { projectPnlFigures } from "../project-core/project-finance.service";
import { readProjects } from "../project-core/project-core.store";
import { percentOf, readTargetMargin } from "../project-core/project-pnl";
import { readMilestonePaid } from "../receivables/receivables";
import { AGE_BUCKETS, OUTSTANDING_SQL, REFUND_CTE } from "./owner-overview";
import { type KpiSpec, type ReportContext, moneyNotes, readFacts } from "./report-context";
import { type Fact, FACT_COLUMNS, categories, grid, groupBy, inPeriod, monthKeys, percent, sum } from "./report-kit";
import { NO_SALES_FILTERS, OPPORTUNITIES, OPPORTUNITY_ENTITY, P, type ReportFilters, month, stamp } from "./report-scope";
import { targetFor } from "./report-targets";

/**
 * Dashboard 6 · Finance (PLM-132). Every definition here is also written in the master plan (§6.27a).
 *
 * Money is the workspace's base currency; records in another currency are counted and noted, never converted. Cash
 * figures are as received or paid (tax included); revenue is before tax. A record that belongs to the company rather
 * than a deal (a supplier payment, a bill) counts only while no sales filter is on; the entity filter applies to its
 * own company.
 */

const PERIOD = (at: string) => `CASE WHEN ${at} >= p.from_at AND ${at} < p.to_at THEN '1' ELSE '0' END`;
const BASE = (currency: string) => `CASE WHEN btrim(${currency}) = p.currency THEN 'base' ELSE 'other' END`;
const inBase = (amount: string, currency: string) => `CASE WHEN btrim(${currency}) = p.currency THEN round(${amount}, 6)::text END`;

/** A filter that only a deal or an enquiry carries is on (company records drop out). */
export const salesFiltered = (filters: ReportFilters) => Boolean(filters.accountManager || filters.enquiryType || filters.package || filters.clientType
  || filters.source || filters.channel || filters.region);

/**
 * Client payments as the cash statement reads them (operational source): each payment Finance verified, on the day
 * it was verified, and taken off again on the day it was rejected after that; the company is the payment's, else its
 * payment stage's.
 */
const RECEIPTS = `rc AS (
  SELECT r.id, r.case_id, r.amount, btrim(r.currency) AS cur, ${stamp("r.detail->>'verifiedAt'")} AS verified_at, ${stamp("r.detail->>'rejectedAt'")} AS rejected_at,
         q.tax_rate, q.kind AS quote_kind, q.round AS quote_round, oc.reference, oc.title, oc.client, oc.owner, oc.am
    FROM commercial_receipts r CROSS JOIN p
    JOIN commercial_payments stage ON stage.workspace_id = r.workspace_id AND stage.case_id = r.case_id AND stage.id = r.payment_id
    JOIN pre_project_cases c ON c.workspace_id = r.workspace_id AND c.id = r.case_id
    JOIN oc ON oc.opportunity_id = c.opportunity_id
    LEFT JOIN commercial_quotes q ON q.workspace_id = r.workspace_id AND q.case_id = stage.case_id AND q.id = stage.source_quote_id
   WHERE r.workspace_id = p.ws AND ${stamp("r.detail->>'verifiedAt'")} IS NOT NULL
     AND (p.entity_id IS NULL OR COALESCE(NULLIF(r.legal_entity_id, ''), stage.legal_entity_id) = p.entity_id::text)
),
receipt_moves AS (
  SELECT rc.*, rc.verified_at AS at, 1 AS sign FROM rc
  UNION ALL
  SELECT rc.*, rc.rejected_at, -1 FROM rc WHERE rc.rejected_at IS NOT NULL
)`;

// ------------------------------------------------------------------ cash in and out

/**
 * Cash in and out by month: client payments verified (less those rejected afterwards) against supplier payments
 * recorded (not reversed, by the day paid) and petty cash reimbursed — the company's cash statement from Wodana's
 * records. The figure is cash in; out and the net are beside it. Supplier payments belong to the company (no deal),
 * so they count only while no sales filter is on.
 */
const CASH_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${RECEIPTS}
SELECT ${FACT_COLUMNS} FROM (
  SELECT receipt_moves.id AS id, 'receipt' AS kind, receipt_moves.case_id::text AS parent_id, receipt_moves.reference, receipt_moves.title, receipt_moves.client,
         receipt_moves.owner, receipt_moves.am::text AS owner_id, receipt_moves.at, ${inBase("receipt_moves.sign * receipt_moves.amount", "receipt_moves.cur")} AS amount,
         NULL::text AS measure, CASE WHEN receipt_moves.sign < 0 THEN 'rejected' ELSE 'client_payment' END AS detail,
         jsonb_build_object('period', ${PERIOD("receipt_moves.at")}, 'month', ${month("receipt_moves.at")}, 'series', 'in', 'currency', ${BASE("receipt_moves.cur")}) AS dims
    FROM receipt_moves CROSS JOIN p
   WHERE receipt_moves.at >= p.series_from_at AND receipt_moves.at < p.to_at
  UNION ALL
  SELECT payment.id::text, 'supplier_payment', NULL, NULLIF(btrim(payment.reference), ''), vendor.display_name, NULL, NULL, NULL,
         (payment.paid_on::timestamp AT TIME ZONE p.tz), ${inBase("-payment.amount", "payment.currency")}, NULL, 'supplier_payment',
         jsonb_build_object('period', ${PERIOD("(payment.paid_on::timestamp AT TIME ZONE p.tz)")}, 'month', to_char(payment.paid_on, 'YYYY-MM'), 'series', 'out',
           'currency', ${BASE("payment.currency")})
    FROM supplier_payments payment CROSS JOIN p
    JOIN workspace_vendors vendor ON vendor.workspace_id = payment.workspace_id AND vendor.id = payment.vendor_id
   WHERE payment.workspace_id = p.ws AND payment.status <> 'reversed' AND ${NO_SALES_FILTERS}
     AND (p.entity_id IS NULL OR payment.legal_entity_id = p.entity_id)
     AND (payment.paid_on::timestamp AT TIME ZONE p.tz) >= p.series_from_at AND (payment.paid_on::timestamp AT TIME ZONE p.tz) < p.to_at
  UNION ALL
  SELECT claim.id::text, 'petty_cash', claim.project_id::text, 'PC-' || lpad(claim.number::text, 4, '0'), claim.description, oc.client, oc.owner, oc.am::text,
         claim.reimbursed_at, ${inBase("-claim.amount", "claim.currency")}, NULL, 'petty_cash',
         jsonb_build_object('period', ${PERIOD("claim.reimbursed_at")}, 'month', ${month("claim.reimbursed_at")}, 'series', 'out', 'currency', ${BASE("claim.currency")})
    FROM petty_cash_claims claim CROSS JOIN p
    JOIN delivery_projects dp ON dp.workspace_id = claim.workspace_id AND dp.id = claim.project_id
    JOIN oc ON oc.case_id = dp.case_id
   WHERE claim.workspace_id = p.ws AND claim.reimbursed_at IS NOT NULL AND ${OPPORTUNITY_ENTITY}
     AND claim.reimbursed_at >= p.series_from_at AND claim.reimbursed_at < p.to_at
) facts ORDER BY at DESC`;

/** Whether any company of the workspace keeps its books in the Ledger (figures here are then Wodana's records, said so). */
async function ledgerOn(ctx: ReportContext) {
  return (await ctx.db.query(`SELECT 1 FROM books_settings WHERE workspace_id = $1 AND enabled LIMIT 1`, [ctx.workspaceId])).rowCount! > 0;
}

const cashInOut: KpiSpec = {
  code: "cash_in_out",
  compare: "higher",
  facts: (ctx) => readFacts(ctx, CASH_SQL),
  build: async (ctx, facts) => {
    const period = facts.filter(inPeriod);
    const of = (items: Fact[], series: string) => sum(items.filter((fact) => fact.dims.series === series).map((fact) => fact.amount));
    const cashIn = of(period, "in"), cashOut = of(period, "out").neg();
    const keys = monthKeys(ctx.filters);
    const monthly = keys.map((key) => facts.filter((fact) => fact.dims.month === key));
    const notes = moneyNotes(facts, true);
    return {
      code: "cash_in_out", unit: "money", value: cashIn.toFixed(ctx.places), count: period.length, amount: cashIn.toFixed(ctx.places), targetable: true,
      ...targetFor(ctx.targets, "cash_in", ctx.filters, cashIn.toFixed(ctx.places)),
      extra: { out: cashOut.toFixed(ctx.places), net: cashIn.sub(cashOut).toFixed(ctx.places) },
      chart: { type: "lines", dimension: "month", categories: categories(keys), unit: "money",
        series: [{ id: "in", label: "" }, { id: "out", label: "" }, { id: "net", label: "" }],
        values: [monthly.map((items) => of(items, "in").toFixed(ctx.places)), monthly.map((items) => of(items, "out").neg().toFixed(ctx.places)),
          monthly.map((items) => sum(items.map((fact) => fact.amount)).toFixed(ctx.places))] },
      notes: { ...notes, ...((await ledgerOn(ctx)) ? { basis: "records" as const } : {}) },
    };
  },
};

// ------------------------------------------------------------------ design fee vs production revenue

export const REVENUE_CATEGORIES = ["design_fees", "production", "variations"] as const;

const REVENUE_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${RECEIPTS}
SELECT receipt_moves.id, receipt_moves.case_id::text AS "caseId", receipt_moves.reference, receipt_moves.title, receipt_moves.client, receipt_moves.owner, receipt_moves.am::text AS am,
       receipt_moves.at, receipt_moves.sign, receipt_moves.amount::text AS amount, receipt_moves.cur, receipt_moves.tax_rate::text AS rate,
       receipt_moves.quote_kind AS kind, receipt_moves.quote_round AS round, (receipt_moves.at >= p.from_at) AS chosen, ${month("receipt_moves.at")} AS month, p.currency AS base
  FROM receipt_moves CROSS JOIN p
 WHERE receipt_moves.at >= p.series_from_at AND receipt_moves.at < p.to_at
 ORDER BY receipt_moves.at DESC`;

/**
 * Design fee vs production revenue: the period's client payments as revenue on the cash statement's basis (verified,
 * less rejections, before the tax inside them at their quotation's rate), by what they paid for — Design fee (the
 * design round), production (the main quotation) and variations. Monthly columns over 12 months.
 */
const revenueMix: KpiSpec = {
  code: "revenue_mix",
  compare: "higher",
  facts: async (ctx) => {
    const rows = (await ctx.db.query<{ id: string; caseId: string; reference: string | null; title: string; client: string | null; owner: string | null; am: string | null;
      at: Date; sign: number; amount: string; cur: string; rate: string | null; kind: string | null; round: string | null; chosen: boolean; month: string; base: string }>(REVENUE_SQL, ctx.params)).rows;
    return rows.map((row) => {
      const base = row.cur === row.base;
      const net = base ? Dec.of(row.amount).sub(taxInside(row.amount, row.rate, row.cur)).mul(row.sign).toFixed(4) : null;
      return {
        id: row.id, kind: "receipt", parentId: row.caseId, reference: row.reference, title: row.title, client: row.client, owner: row.owner, ownerId: row.am,
        at: row.at.toISOString(), amount: net, measure: null, detail: revenueCategoryOfQuote(row),
        dims: { period: row.chosen ? "1" : "0", month: row.month, category: revenueCategoryOfQuote(row), currency: base ? "base" : "other", tax: row.rate === null ? "gross" : "net" },
      } satisfies Fact;
    });
  },
  build: (ctx, facts) => {
    const period = facts.filter(inPeriod);
    const amount = sum(period.map((fact) => fact.amount)).toFixed(ctx.places);
    const keys = monthKeys(ctx.filters);
    const series = REVENUE_CATEGORIES.map((id) => ({ id, label: "" }));
    return {
      code: "revenue_mix", unit: "money", value: amount, count: period.length, amount, targetable: false,
      extra: Object.fromEntries(REVENUE_CATEGORIES.map((category) => [category, sum(period.filter((fact) => fact.dims.category === category).map((fact) => fact.amount)).toFixed(ctx.places)])),
      chart: { type: "columns", dimension: "month", seriesDimension: "category", categories: categories(keys), series, values: grid(facts, "month", keys, series, "category", "amount", ctx.places), unit: "money" },
      notes: moneyNotes(facts),
    };
  },
};

// ------------------------------------------------------------------ invoices issued vs collected

/**
 * Invoices issued vs collected: tax invoices issued (not credited) in the period, their totals, and what the client
 * has paid on each so far (the payments Finance verified on its payment stage, never more than the invoice). Monthly
 * lines over 12 months by issue date; the figure is what was issued, with how much of it is collected.
 */
const INVOICES_SQL = `WITH ${P}, ${OPPORTUNITIES}
SELECT invoice.id::text AS id, invoice.case_id::text AS "caseId", invoice.payment_id AS "paymentId", invoice.number AS reference,
       COALESCE(NULLIF(btrim(invoice.milestone_title), ''), invoice.number) AS title, oc.client, oc.owner, oc.am::text AS am,
       invoice.issue_date::text AS "issueDate", invoice.due_date::text AS "dueDate", invoice.total::text AS total, btrim(invoice.currency) = p.currency AS base,
       ${PERIOD("(invoice.issue_date::timestamp AT TIME ZONE p.tz)")} AS period, to_char(invoice.issue_date, 'YYYY-MM') AS month, p.today::text AS today
  FROM client_invoices invoice CROSS JOIN p
  JOIN pre_project_cases c ON c.workspace_id = invoice.workspace_id AND c.id = invoice.case_id
  JOIN oc ON oc.opportunity_id = c.opportunity_id
 WHERE invoice.workspace_id = p.ws AND invoice.status = 'issued' AND (p.entity_id IS NULL OR invoice.legal_entity_id = p.entity_id)
   AND (invoice.issue_date::timestamp AT TIME ZONE p.tz) >= p.series_from_at AND (invoice.issue_date::timestamp AT TIME ZONE p.tz) < p.to_at
 ORDER BY invoice.issue_date DESC, invoice.number DESC`;

const invoicesCollected: KpiSpec = {
  code: "invoices_collected",
  compare: "higher",
  facts: async (ctx) => {
    const rows = (await ctx.db.query<{ id: string; caseId: string; paymentId: string; reference: string; title: string; client: string | null; owner: string | null; am: string | null;
      issueDate: string; dueDate: string | null; total: string; base: boolean; period: string; month: string; today: string }>(INVOICES_SQL, ctx.params)).rows;
    const paid = await readMilestonePaid(ctx.db, ctx.workspaceId, rows.map((row) => ({ caseId: row.caseId, paymentId: row.paymentId })));
    return rows.map((row) => {
      const settled = Dec.of(paid.get(`${row.caseId}|${row.paymentId}`)?.toFixed(4) ?? "0");
      const collected = settled.cmp(row.total) > 0 ? Dec.of(row.total) : settled.cmp(0) < 0 ? Dec.ZERO : settled;
      const balance = Dec.of(row.total).sub(collected);
      const state = balance.isZero() ? "paid" : row.dueDate && row.dueDate < row.today ? "overdue" : collected.isZero() ? "unpaid" : "part_paid";
      return {
        id: row.id, kind: "invoice", parentId: row.caseId, reference: row.reference, title: row.title, client: row.client, owner: row.owner, ownerId: row.am,
        at: `${row.issueDate}T00:00:00.000Z`, amount: row.base ? Dec.of(row.total).toFixed(4) : null, measure: row.base ? balance.toFixed(4) : null, detail: state,
        dims: { period: row.period, month: row.month, state, collected: row.base ? collected.toFixed(4) : "0", currency: row.base ? "base" : "other", tax: "gross" },
      } satisfies Fact;
    });
  },
  build: (ctx, facts) => {
    const period = facts.filter(inPeriod);
    const issued = sum(period.map((fact) => fact.amount));
    const collected = sum(period.filter((fact) => fact.dims.currency === "base").map((fact) => fact.dims.collected));
    const keys = monthKeys(ctx.filters);
    const monthly = keys.map((key) => facts.filter((fact) => fact.dims.month === key));
    return {
      code: "invoices_collected", unit: "money", value: issued.toFixed(ctx.places), count: period.length, amount: issued.toFixed(ctx.places), targetable: false,
      extra: { collected: collected.toFixed(ctx.places), rate: percent(collected, issued), overdue: period.filter((fact) => fact.dims.state === "overdue").length },
      chart: { type: "lines", dimension: "month", categories: categories(keys), unit: "money", series: [{ id: "issued", label: "" }, { id: "collected", label: "" }],
        values: [monthly.map((items) => sum(items.map((fact) => fact.amount)).toFixed(ctx.places)),
          monthly.map((items) => sum(items.filter((fact) => fact.dims.currency === "base").map((fact) => fact.dims.collected)).toFixed(ctx.places))] },
      notes: moneyNotes(facts, true),
    };
  },
};

// ------------------------------------------------------------------ receivables and payables

/**
 * Receivables ageing, live: what clients owe on every live job — the Owner overview's Outstanding balances (each
 * payment stage less the payments Finance verified against it, tax included) — by age past the due date. The overdue
 * list is the overdue buckets.
 */
const receivables: KpiSpec = {
  code: "receivables_ageing",
  facts: async (ctx) => (await readFacts(ctx, OUTSTANDING_SQL)).map((fact) => ({ ...fact, dims: { ...fact.dims, overdue: fact.dims.age.startsWith("overdue") ? "1" : "0" } })),
  build: (ctx, facts) => {
    const counted = facts.filter((fact) => fact.dims.currency === "base");
    const overdue = counted.filter((fact) => fact.dims.overdue === "1");
    return {
      code: "receivables_ageing", unit: "money", value: sum(counted.map((fact) => fact.amount)).toFixed(ctx.places), count: counted.length, targetable: false,
      extra: { overdue: sum(overdue.map((fact) => fact.amount)).toFixed(ctx.places), overdueCount: overdue.length },
      chart: { type: "bars", dimension: "age", unit: "money", items: AGE_BUCKETS.map((age) => {
        const bucket = counted.filter((fact) => fact.dims.age === age);
        return { key: age, label: age, value: sum(bucket.map((fact) => fact.amount)).toFixed(ctx.places), count: bucket.length };
      }) },
      notes: moneyNotes(facts, true),
    };
  },
};

export const PAYABLE_BUCKETS = ["overdue", "within_7", "within_30"] as const;
export const PAYABLES_DAYS = 30;


/**
 * Payables due, live: approved supplier bills with a balance still to pay — the bill less the supplier payments
 * allocated to it and the retention still held, as Payables works it out — due within 30 days of today, or overdue.
 * Bills belong to the company, so they count only while no sales filter is on; the entity filter is the bill's company.
 */
const PAYABLES_SQL = `WITH ${P}
SELECT ${FACT_COLUMNS} FROM (
  SELECT bill.id::text AS id, 'bill' AS kind, NULL::text AS parent_id, bill.number AS reference, vendor.display_name AS title, NULL::text AS client, NULL::text AS owner,
         NULL::text AS owner_id, (bill.due_date::timestamp AT TIME ZONE p.tz) AS at,
         ${inBase("bill.total - coalesce(paid.amount, 0) - coalesce(kept.amount, 0) + coalesce(freed.amount, 0)", "bill.currency")} AS amount,
         CASE WHEN bill.due_date < p.today THEN (p.today - bill.due_date)::text END AS measure,
         CASE WHEN bill.due_date < p.today THEN 'overdue' WHEN bill.due_date <= p.today + 7 THEN 'within_7' ELSE 'within_30' END AS detail,
         jsonb_build_object('period', '1', 'due', CASE WHEN bill.due_date < p.today THEN 'overdue' WHEN bill.due_date <= p.today + 7 THEN 'within_7' ELSE 'within_30' END,
           'currency', ${BASE("bill.currency")}, 'tax', 'gross') AS dims
    FROM supplier_invoices bill CROSS JOIN p
    JOIN workspace_vendors vendor ON vendor.workspace_id = bill.workspace_id AND vendor.id = bill.vendor_id
    LEFT JOIN LATERAL (SELECT sum(allocation.amount) AS amount FROM supplier_payment_allocations allocation
                         JOIN supplier_payments payment ON payment.workspace_id = allocation.workspace_id AND payment.id = allocation.payment_id AND payment.status = 'recorded'
                        WHERE allocation.workspace_id = bill.workspace_id AND allocation.invoice_id = bill.id) paid ON true
    LEFT JOIN LATERAL (SELECT sum(amount) AS amount FROM supplier_invoice_retentions WHERE workspace_id = bill.workspace_id AND invoice_id = bill.id) kept ON true
    LEFT JOIN LATERAL (SELECT sum(amount) AS amount FROM supplier_retention_releases WHERE workspace_id = bill.workspace_id AND invoice_id = bill.id) freed ON true
   WHERE bill.workspace_id = p.ws AND bill.status = 'approved' AND bill.due_date IS NOT NULL AND bill.due_date <= p.today + ${PAYABLES_DAYS}
     AND bill.total - coalesce(kept.amount, 0) + coalesce(freed.amount, 0) > coalesce(paid.amount, 0)
     AND ${NO_SALES_FILTERS} AND (p.entity_id IS NULL OR bill.legal_entity_id = p.entity_id)
) facts ORDER BY at, reference`;

const payables: KpiSpec = {
  code: "payables_due",
  facts: (ctx) => readFacts(ctx, PAYABLES_SQL),
  build: (ctx, facts) => {
    const counted = facts.filter((fact) => fact.dims.currency === "base");
    const overdue = counted.filter((fact) => fact.dims.due === "overdue");
    return {
      code: "payables_due", unit: "money", value: sum(counted.map((fact) => fact.amount)).toFixed(ctx.places), count: counted.length, targetable: false,
      extra: { overdue: sum(overdue.map((fact) => fact.amount)).toFixed(ctx.places), overdueCount: overdue.length },
      chart: { type: "bars", dimension: "due", unit: "money", items: PAYABLE_BUCKETS.map((due) => {
        const bucket = counted.filter((fact) => fact.dims.due === due);
        return { key: due, label: due, value: sum(bucket.map((fact) => fact.amount)).toFixed(ctx.places), count: bucket.length };
      }) },
      notes: moneyNotes(facts, true),
    };
  },
};


// ------------------------------------------------------------------ project margins

export const MARGIN_BANDS = ["loss", "below_target", "on_target", "no_revenue"] as const;

/** A project's margin band: a loss, under the firm's margin floor, at or above it, or nothing invoiced yet. */
export function marginBand(revenue: string, profit: string, target: string | null): (typeof MARGIN_BANDS)[number] {
  if (Dec.of(revenue).cmp(0) <= 0) return "no_revenue";
  if (Dec.of(profit).cmp(0) < 0) return "loss";
  const margin = percentOf(profit, revenue);
  return target !== null && margin !== null && Dec.of(margin).cmp(target) < 0 ? "below_target" : "on_target";
}

/** Σ profit ÷ Σ revenue × 100 over the projects with revenue in the base currency, one decimal; null without any. */
export function portfolioMargin(facts: Fact[]) {
  const counted = facts.filter((fact) => fact.dims.currency === "base" && fact.amount !== null && Dec.of(fact.amount).cmp(0) > 0);
  const revenue = sum(counted.map((fact) => fact.amount));
  return counted.length ? percentOf(sum(counted.map((fact) => fact.dims.profit)), revenue) : null;
}

const MARGIN_PROJECTS_SQL = `WITH ${P}, ${OPPORTUNITIES}
SELECT dp.id::text AS id, oc.owner, oc.am::text AS am
  FROM delivery_projects dp CROSS JOIN p JOIN oc ON oc.case_id = dp.case_id
 WHERE dp.workspace_id = p.ws AND dp.started_at IS NOT NULL AND dp.status IN ('active', 'on_hold', 'completed') AND ${OPPORTUNITY_ENTITY}`;

/**
 * Project margins, live (who sees margins only): every running or completed project's margin so far — revenue
 * invoiced before tax less what it has cost. Read from the Ledger's journals for a project whose company keeps its
 * books in the Ledger, else from Wodana's records (the project P&L); the basis is said under the figure. Weighted over
 * the projects (Σ profit ÷ Σ revenue), and banded: a loss, under the firm's margin floor, on target, nothing invoiced yet.
 */
const projectMargins: KpiSpec = {
  code: "project_margins",
  requires: ["commercial.costs.view"],
  facts: async (ctx) => {
    const scoped = (await ctx.db.query<{ id: string; owner: string | null; am: string | null }>(MARGIN_PROJECTS_SQL, ctx.params)).rows;
    if (!scoped.length) return [];
    const owners = new Map(scoped.map((row) => [row.id, row]));
    const projects = (await readProjects(ctx.db as PoolClient, ctx.workspaceId, null, true)).filter((project) => owners.has(project.id));
    const target = await readTargetMargin(ctx.db, ctx.workspaceId);
    const facts: Fact[] = [];
    for (const project of projects) {
      const company = await projectCompany(ctx.db, ctx.workspaceId, project.id);
      let revenue: string, cost: string, currency: string, forecast: string | null = null, basis: "ledger" | "records";
      if (company?.enabled) {
        const figures = projectFigures(await readProjectMovements(ctx.db, ctx.workspaceId, company.legalEntityId, [project.id])).get(project.id);
        revenue = figures?.revenue ?? "0"; cost = figures?.totalCost ?? "0"; currency = company.currency; basis = "ledger";
      } else {
        const { figures } = await projectPnlFigures(ctx.db as PoolClient, ctx.workspaceId, project);
        if (!figures.comparable) continue;
        revenue = figures.revenue.invoicedNet; cost = figures.totals.actual; currency = figures.currency; forecast = figures.margin.forecastPercent; basis = "records";
      }
      const profit = Dec.of(revenue).sub(cost).toFixed(4);
      const base = currency.trim() === ctx.currency;
      facts.push({
        id: project.id, kind: "project_money", parentId: project.id, reference: project.reference, title: project.name, client: project.clientName,
        owner: owners.get(project.id)?.owner ?? null, ownerId: owners.get(project.id)?.am ?? null, at: project.startedAt ? new Date(project.startedAt).toISOString() : null,
        amount: base ? Dec.of(revenue).toFixed(4) : null, measure: percentOf(profit, revenue), detail: forecast,
        dims: { period: "1", band: marginBand(revenue, profit, target), basis, profit, currency: base ? "base" : "other", tax: "net" },
      });
    }
    return facts;
  },
  build: async (ctx, facts) => {
    const bases = new Set(facts.map((fact) => fact.dims.basis));
    const basis = bases.size === 1 ? [...bases][0] as "ledger" | "records" : bases.size ? "mixed" : "records";
    return {
      code: "project_margins", unit: "percent", value: portfolioMargin(facts), count: facts.length, targetable: false,
      extra: { target: await readTargetMargin(ctx.db, ctx.workspaceId), loss: facts.filter((fact) => fact.dims.band === "loss").length },
      chart: { type: "bars", dimension: "band", unit: "count", items: MARGIN_BANDS.map((band) => {
        const bucket = facts.filter((fact) => fact.dims.band === band);
        return { key: band, label: band, value: String(bucket.length), count: bucket.length, amount: sum(bucket.map((fact) => fact.amount)).toFixed(ctx.places) };
      }) },
      notes: { ...moneyNotes(facts), basis },
    };
  },
};

// ------------------------------------------------------------------ finance requests, refunds, petty cash

export const REQUEST_KINDS = ["invoice", "refund", "payable"] as const;
export const WAIT_BUCKETS = ["days_0_2", "days_3_7", "days_8_plus"] as const;

/**
 * Finance requests waiting, live: invoice, refund and supplier-payment requests not done or rejected yet (new, in
 * progress or waiting for information), by kind and by how long they have waited (local days since raised). A request
 * without a deal counts only while no sales filter is on.
 */
const REQUESTS_SQL = `WITH ${P}, ${OPPORTUNITIES}
SELECT ${FACT_COLUMNS} FROM (
  SELECT r.id::text AS id, 'finance_request' AS kind, NULL::text AS parent_id, 'FR-' || lpad(r.number::text, 4, '0') AS reference,
         COALESCE(oc.title, NULLIF(btrim(r.reason), ''), r.kind) AS title, COALESCE(oc.client, party.display_name) AS client, oc.owner, oc.am::text AS owner_id,
         r.created_at AS at, ${inBase("r.total_amount", "r.currency")} AS amount, (p.today - (r.created_at AT TIME ZONE p.tz)::date)::text AS measure, r.status AS detail,
         jsonb_build_object('period', '1', 'kind', r.kind, 'wait', CASE WHEN p.today - (r.created_at AT TIME ZONE p.tz)::date <= 2 THEN 'days_0_2'
             WHEN p.today - (r.created_at AT TIME ZONE p.tz)::date <= 7 THEN 'days_3_7' ELSE 'days_8_plus' END,
           'currency', ${BASE("r.currency")}, 'tax', 'gross') AS dims
    FROM finance_requests r CROSS JOIN p
    LEFT JOIN oc ON oc.opportunity_id = r.opportunity_id
    LEFT JOIN crm_parties party ON party.workspace_id = r.workspace_id AND party.id = r.party_id
   WHERE r.workspace_id = p.ws AND r.status IN ('new', 'in_progress', 'needs_info')
     AND (oc.opportunity_id IS NOT NULL OR (r.opportunity_id IS NULL AND ${NO_SALES_FILTERS}))
     AND (p.entity_id IS NULL OR COALESCE(r.legal_entity_id, oc.entity_id) = p.entity_id)
) facts ORDER BY at`;

const requests: KpiSpec = {
  code: "finance_requests_open",
  facts: (ctx) => readFacts(ctx, REQUESTS_SQL),
  build: (ctx, facts) => {
    const series = WAIT_BUCKETS.map((id) => ({ id, label: "" }));
    return {
      code: "finance_requests_open", unit: "count", value: String(facts.length), count: facts.length, amount: sum(facts.map((fact) => fact.amount)).toFixed(ctx.places),
      targetable: false, extra: { waitingLong: facts.filter((fact) => fact.dims.wait === "days_8_plus").length },
      chart: { type: "columns", dimension: "kind", seriesDimension: "wait", categories: REQUEST_KINDS.map((key) => ({ key, label: key })), series,
        values: grid(facts, "kind", [...REQUEST_KINDS], series, "wait", "count", ctx.places), unit: "count" },
      notes: moneyNotes(facts, true),
    };
  },
};

/**
 * Refunds: client refunds Finance completed in the period (as in Net revenue: dated when closed, net of tax by the
 * deal's main quotation, else as entered), count and value, by the reason given.
 */
const REFUNDS_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${REFUND_CTE}
SELECT ${FACT_COLUMNS} FROM (
  SELECT refund.id::text AS id, 'refund' AS kind, refund.case_id::text AS parent_id, 'FR-' || lpad(refund.number::text, 4, '0') AS reference,
         COALESCE(oc.title, refund.reason) AS title, COALESCE(oc.client, refund.party_name) AS client, oc.owner, oc.am::text AS owner_id, refund.at,
         CASE WHEN refund.cur = p.currency THEN round(refund.amount * COALESCE(refund.ratio, 1), 6)::text END AS amount, NULL::text AS measure,
         NULLIF(btrim(refund.reason), '') AS detail,
         jsonb_build_object('period', ${PERIOD("refund.at")}, 'reason', COALESCE(lower(NULLIF(btrim(refund.reason), '')), 'none'),
           'currency', CASE WHEN refund.cur = p.currency THEN 'base' ELSE 'other' END, 'tax', CASE WHEN refund.ratio IS NULL THEN 'gross' ELSE 'net' END) AS dims
    FROM refund CROSS JOIN p LEFT JOIN oc ON oc.opportunity_id = refund.opportunity_id
   WHERE refund.at >= p.from_at
) facts ORDER BY at DESC`;

const refunds: KpiSpec = {
  code: "refunds",
  compare: "lower",
  facts: (ctx) => readFacts(ctx, REFUNDS_SQL),
  build: (ctx, facts) => {
    const groups = groupBy(facts, "reason", (fact) => fact.detail ?? "", ctx.places).sort((a, b) => b.count - a.count || b.amount.cmp(a.amount));
    return {
      code: "refunds", unit: "count", value: String(facts.length), count: facts.length, amount: sum(facts.map((fact) => fact.amount)).toFixed(ctx.places), targetable: false,
      chart: { type: "bars", dimension: "reason", unit: "count", items: groups.map((group) => ({ key: group.key, label: group.label, value: String(group.count), count: group.count, amount: group.amountText })) },
      notes: moneyNotes(facts),
    };
  },
};

export const PETTY_CATEGORIES = ["transport", "food", "materials", "tools", "fees", "other"] as const;

/**
 * Petty cash: site expenses approved (or already reimbursed) that were spent in the period, by category; beside it,
 * live, the claims waiting for approval and those approved but not reimbursed yet.
 */
const PETTY_SQL = `WITH ${P}, ${OPPORTUNITIES}
SELECT ${FACT_COLUMNS} FROM (
  SELECT claim.id::text AS id, 'petty_cash' AS kind, claim.project_id::text AS parent_id, 'PC-' || lpad(claim.number::text, 4, '0') AS reference, claim.description AS title,
         oc.client, COALESCE(NULLIF(btrim(claimer.display_name), ''), claimer.primary_email) AS owner, NULL::text AS owner_id,
         (claim.spent_on::timestamp AT TIME ZONE p.tz) AS at, ${inBase("claim.amount", "claim.currency")} AS amount, NULL::text AS measure, claim.status AS detail,
         jsonb_build_object('period', CASE WHEN claim.status IN ('approved', 'reimbursed') THEN ${PERIOD("(claim.spent_on::timestamp AT TIME ZONE p.tz)")} ELSE '0' END,
           'category', claim.category, 'state', CASE WHEN claim.status = 'submitted' THEN 'waiting' WHEN claim.status = 'approved' THEN 'to_pay' ELSE 'paid' END,
           'currency', ${BASE("claim.currency")}, 'tax', 'gross') AS dims
    FROM petty_cash_claims claim CROSS JOIN p
    JOIN delivery_projects dp ON dp.workspace_id = claim.workspace_id AND dp.id = claim.project_id
    JOIN oc ON oc.case_id = dp.case_id
    LEFT JOIN users claimer ON claimer.id = claim.claimed_by
   WHERE claim.workspace_id = p.ws AND ${OPPORTUNITY_ENTITY}
     AND (claim.status IN ('submitted', 'approved')
       OR (claim.status = 'reimbursed' AND (claim.spent_on::timestamp AT TIME ZONE p.tz) >= p.from_at AND (claim.spent_on::timestamp AT TIME ZONE p.tz) < p.to_at))
) facts ORDER BY at DESC`;

const pettyCash: KpiSpec = {
  code: "petty_cash",
  compare: "lower",
  facts: (ctx) => readFacts(ctx, PETTY_SQL),
  build: (ctx, facts) => {
    const spent = facts.filter(inPeriod);
    const waiting = facts.filter((fact) => fact.dims.state === "waiting"), toPay = facts.filter((fact) => fact.dims.state === "to_pay");
    const amount = sum(spent.map((fact) => fact.amount)).toFixed(ctx.places);
    return {
      code: "petty_cash", unit: "money", value: amount, count: spent.length, amount, targetable: false,
      extra: { waiting: waiting.length, waitingValue: sum(waiting.map((fact) => fact.amount)).toFixed(ctx.places), toPay: toPay.length,
        toPayValue: sum(toPay.map((fact) => fact.amount)).toFixed(ctx.places) },
      chart: { type: "bars", dimension: "category", unit: "money", items: PETTY_CATEGORIES.map((category) => {
        const bucket = spent.filter((fact) => fact.dims.category === category);
        return { key: category, label: category, value: sum(bucket.map((fact) => fact.amount)).toFixed(ctx.places), count: bucket.length };
      }).filter((item) => item.count > 0) },
      notes: moneyNotes(facts, true),
    };
  },
};

export const FINANCE: KpiSpec[] = [cashInOut, revenueMix, invoicesCollected, receivables, payables, projectMargins, requests, refunds, pettyCash];
