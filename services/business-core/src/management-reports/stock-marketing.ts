import { Dec } from "../catalog-core/decimal";
import { readReorderPoints } from "../inventory/stock-levels";
import { responseRate, SLA_SQL } from "./lead-response";
import { WON_SQL } from "./owner-overview";
import { type KpiSpec, type ReportContext, moneyNotes, readFacts } from "./report-context";
import { type Fact, FACT_COLUMNS, categories, grid, groupBy, inPeriod, mean, monthKeys, percent, sum } from "./report-kit";
import { NO_SALES_FILTERS, OPPORTUNITIES, OPPORTUNITY_ENTITY, P, month } from "./report-scope";
import { FUNNEL_SQL, NEW_LEADS_SQL } from "./sales-pipeline";
import { salesFiltered } from "./finance";

/**
 * Dashboard 7 · Stock and marketing (PLM-133). Every definition here is also written in the master plan (§6.27a).
 *
 * Stock is valued at its moving average cost in the workspace's currency (what the stock ledger keeps). Free stock
 * belongs to the company, not a deal: it counts only while no sales filter is on, and under the entity filter only when
 * the workspace has one company. Stock a project owns (allocated to it) and stock a deal holds follow their project or
 * deal through the filter bar like everything else.
 */

/** Who reads each half: stock figures need a stock (or, for purchases, purchasing) read permission; marketing needs enquiries. */
export const STOCK_READ = ["stock.view", "stock.manage", "stock.adjust", "stock.receive"];
export const PURCHASING_READ = ["purchasing.view", "purchasing.manage"];
export const MARKETING_READ = ["crm.leads.view"];

/** Free stock is in scope: no sales filter, and no company chosen unless the workspace has only one. */
const COMPANY_STOCK = `(${NO_SALES_FILTERS} AND (p.entity_id IS NULL OR (SELECT count(*) = 1 FROM legal_entities only_entity
  WHERE only_entity.workspace_id = p.ws AND only_entity.archived_at IS NULL)))`;
const CATEGORY = (column: string) => `COALESCE(NULLIF(lower(btrim(${column})), ''), 'none')`;

async function companyStock(ctx: ReportContext) {
  if (salesFiltered(ctx.filters)) return false;
  if (!ctx.filters.entity) return true;
  return (await ctx.db.query<{ only: boolean }>(`SELECT count(*) = 1 AS only FROM legal_entities WHERE workspace_id = $1 AND archived_at IS NULL`, [ctx.workspaceId])).rows[0]?.only ?? false;
}

/** Bars per category, biggest value first (categories are the workspace's own words). */
const byCategory = (ctx: ReportContext, facts: Fact[]) => groupBy(facts, "category", (fact) => fact.detail ?? "", ctx.places)
  .sort((a, b) => b.amount.cmp(a.amount) || b.count - a.count)
  .map((group) => ({ key: group.key, label: group.key === "none" ? "" : group.label, value: group.amountText, count: group.count }));

// ------------------------------------------------------------------ stock value

/** Stock value, live: what is in stock now (free stock and stock projects own), at its average cost, by category. */
const VALUE_SQL = `WITH ${P}, ${OPPORTUNITIES},
held AS (
  SELECT balance.item_id, sum(balance.on_hand) AS on_hand, sum(balance.value) AS value
    FROM stock_balances balance CROSS JOIN p
    LEFT JOIN delivery_projects dp ON dp.workspace_id = balance.workspace_id AND dp.id = balance.project_id
    LEFT JOIN oc ON oc.case_id = dp.case_id
   WHERE balance.workspace_id = p.ws AND balance.on_hand > 0
     AND ((balance.project_id IS NULL AND ${COMPANY_STOCK}) OR (balance.project_id IS NOT NULL AND oc.opportunity_id IS NOT NULL AND ${OPPORTUNITY_ENTITY}))
   GROUP BY balance.item_id
)
SELECT ${FACT_COLUMNS} FROM (
  SELECT item.id::text AS id, 'stock_item' AS kind, NULL::text AS parent_id, NULLIF(btrim(item.code), '') AS reference, item.name AS title, NULL::text AS client,
         NULL::text AS owner, NULL::text AS owner_id, NULL::timestamptz AS at, round(held.value, 6)::text AS amount, round(held.on_hand, 4)::text AS measure,
         NULLIF(btrim(item.category), '') AS detail, jsonb_build_object('period', '1', 'category', ${CATEGORY("item.category")}, 'currency', 'base', 'tax', 'net') AS dims,
         held.value AS sort
    FROM held CROSS JOIN p JOIN stock_items item ON item.workspace_id = p.ws AND item.id = held.item_id
) facts ORDER BY sort DESC, title`;

const stockValue: KpiSpec = {
  code: "stock_value",
  requires: STOCK_READ,
  facts: (ctx) => readFacts(ctx, VALUE_SQL),
  build: (ctx, facts) => {
    const amount = sum(facts.map((fact) => fact.amount)).toFixed(ctx.places);
    return { code: "stock_value", unit: "money", value: amount, count: facts.length, amount, targetable: false,
      chart: { type: "bars", dimension: "category", unit: "money", items: byCategory(ctx, facts) } };
  },
};

// ------------------------------------------------------------------ low stock

/**
 * Low stock, live: items at or below their reorder point (free stock less what deals hold, per place or across
 * places) — Short when what is on order won't lift them above it, else Low (the same rule as the stock alerts).
 */
const lowStock: KpiSpec = {
  code: "low_stock",
  requires: STOCK_READ,
  facts: async (ctx) => {
    if (!(await companyStock(ctx))) return [];
    return (await readReorderPoints(ctx.db, ctx.workspaceId)).filter((point) => point.low).map((point) => ({
      id: `${point.itemId}:${point.id}`, kind: "stock_item", parentId: null, reference: point.itemCode || null, title: point.itemName, client: null, owner: point.vendorName ?? null,
      ownerId: null, at: point.lowSince ? new Date(point.lowSince).toISOString() : null, amount: null, measure: Dec.of(point.free).toFixed(4),
      detail: point.locationName ?? null, dims: { period: "1", level: point.short ? "short" : "low" },
    } satisfies Fact));
  },
  build: (_ctx, facts) => ({
    code: "low_stock", unit: "count", value: String(facts.length), count: facts.length, targetable: false,
    extra: { short: facts.filter((fact) => fact.dims.level === "short").length },
    chart: { type: "bars", dimension: "level", unit: "count", items: ["short", "low"].map((level) => {
      const count = facts.filter((fact) => fact.dims.level === level).length;
      return { key: level, label: level, value: String(count), count };
    }) },
  }),
};

// ------------------------------------------------------------------ slow-moving

export const SLOW_DAYS = 90;
export const SLOW_BUCKETS = ["days_90_180", "days_181_365", "over_365"] as const;

/**
 * Slow-moving, live: free stock of items nothing has gone out of (issued to a project or work order, sold, returned to
 * the supplier) for more than 90 days — counted from the last time something went out, else from when it first came
 * in. Value at average cost.
 */
const SLOW_SQL = `WITH ${P},
free AS (
  SELECT balance.item_id, sum(balance.on_hand) AS on_hand, sum(balance.value) AS value FROM stock_balances balance CROSS JOIN p
   WHERE balance.workspace_id = p.ws AND balance.project_id IS NULL AND balance.on_hand > 0 GROUP BY balance.item_id
),
moved AS (
  SELECT movement.item_id, max(movement.moved_on) FILTER (WHERE movement.kind IN ('issue', 'sale', 'supplier_return')) AS last_out, min(movement.moved_on) AS first_in
    FROM stock_movements movement CROSS JOIN p WHERE movement.workspace_id = p.ws GROUP BY movement.item_id
)
SELECT ${FACT_COLUMNS} FROM (
  SELECT item.id::text AS id, 'stock_item' AS kind, NULL::text AS parent_id, NULLIF(btrim(item.code), '') AS reference, item.name AS title, NULL::text AS client,
         NULL::text AS owner, NULL::text AS owner_id, (COALESCE(moved.last_out, moved.first_in)::timestamp AT TIME ZONE p.tz) AS at, round(free.value, 6)::text AS amount,
         (p.today - COALESCE(moved.last_out, moved.first_in))::text AS measure, NULLIF(btrim(item.category), '') AS detail,
         jsonb_build_object('period', '1', 'idle', CASE WHEN p.today - COALESCE(moved.last_out, moved.first_in) <= 180 THEN 'days_90_180'
             WHEN p.today - COALESCE(moved.last_out, moved.first_in) <= 365 THEN 'days_181_365' ELSE 'over_365' END,
           'out', CASE WHEN moved.last_out IS NULL THEN 'never' ELSE 'before' END, 'currency', 'base', 'tax', 'net') AS dims
    FROM free CROSS JOIN p
    JOIN stock_items item ON item.workspace_id = p.ws AND item.id = free.item_id
    JOIN moved ON moved.item_id = free.item_id
   WHERE ${COMPANY_STOCK} AND p.today - COALESCE(moved.last_out, moved.first_in) > ${SLOW_DAYS}
) facts ORDER BY at NULLS FIRST, title`;

const slowMoving: KpiSpec = {
  code: "slow_moving",
  requires: STOCK_READ,
  facts: (ctx) => readFacts(ctx, SLOW_SQL),
  build: (ctx, facts) => ({
    code: "slow_moving", unit: "count", value: String(facts.length), count: facts.length, amount: sum(facts.map((fact) => fact.amount)).toFixed(ctx.places), targetable: false,
    chart: { type: "bars", dimension: "idle", unit: "money", items: SLOW_BUCKETS.map((idle) => {
      const bucket = facts.filter((fact) => fact.dims.idle === idle);
      return { key: idle, label: idle, value: sum(bucket.map((fact) => fact.amount)).toFixed(ctx.places), count: bucket.length };
    }) },
  }),
};

// ------------------------------------------------------------------ reserved vs available

/**
 * Reserved vs available, live, by category, at average cost: reserved is stock projects own (allocated to them) and
 * free stock deals hold; available is free stock no deal holds.
 */
const RESERVED_SQL = `WITH ${P}, ${OPPORTUNITIES},
cost AS (
  SELECT balance.item_id, CASE WHEN sum(balance.on_hand) > 0 THEN sum(balance.value) / sum(balance.on_hand) END AS unit
    FROM stock_balances balance CROSS JOIN p WHERE balance.workspace_id = p.ws GROUP BY balance.item_id
),
owned AS (
  SELECT balance.item_id, sum(balance.on_hand) AS quantity FROM stock_balances balance CROSS JOIN p
    JOIN delivery_projects dp ON dp.workspace_id = balance.workspace_id AND dp.id = balance.project_id
    JOIN oc ON oc.case_id = dp.case_id
   WHERE balance.workspace_id = p.ws AND balance.on_hand > 0 AND ${OPPORTUNITY_ENTITY} GROUP BY balance.item_id
),
holds AS (
  SELECT held.item_id, sum(held.quantity) AS quantity, sum(held.quantity) FILTER (WHERE oc.opportunity_id IS NOT NULL AND ${OPPORTUNITY_ENTITY}) AS scoped
    FROM stock_reservations held CROSS JOIN p LEFT JOIN oc ON oc.opportunity_id = held.opportunity_id
   WHERE held.workspace_id = p.ws AND held.status = 'reserved' AND held.project_id IS NULL GROUP BY held.item_id
),
free AS (
  SELECT balance.item_id, sum(balance.on_hand) AS quantity FROM stock_balances balance CROSS JOIN p
   WHERE balance.workspace_id = p.ws AND balance.project_id IS NULL AND balance.on_hand > 0 GROUP BY balance.item_id
),
split AS (
  SELECT item.id AS item_id, 'reserved' AS series, COALESCE(owned.quantity, 0) + COALESCE(holds.scoped, 0) AS quantity
    FROM stock_items item CROSS JOIN p LEFT JOIN owned ON owned.item_id = item.id LEFT JOIN holds ON holds.item_id = item.id
   WHERE item.workspace_id = p.ws
  UNION ALL
  SELECT item.id, 'available', greatest(COALESCE(free.quantity, 0) - COALESCE(holds.quantity, 0), 0)
    FROM stock_items item CROSS JOIN p LEFT JOIN free ON free.item_id = item.id LEFT JOIN holds ON holds.item_id = item.id
   WHERE item.workspace_id = p.ws AND ${COMPANY_STOCK}
)
SELECT ${FACT_COLUMNS} FROM (
  SELECT item.id::text || ':' || split.series AS id, 'stock_item' AS kind, NULL::text AS parent_id, NULLIF(btrim(item.code), '') AS reference, item.name AS title,
         NULL::text AS client, NULL::text AS owner, NULL::text AS owner_id, NULL::timestamptz AS at, round(split.quantity * COALESCE(cost.unit, 0), 6)::text AS amount,
         round(split.quantity, 4)::text AS measure, NULLIF(btrim(item.category), '') AS detail,
         jsonb_build_object('period', '1', 'series', split.series, 'category', ${CATEGORY("item.category")}, 'currency', 'base', 'tax', 'net') AS dims
    FROM split CROSS JOIN p JOIN stock_items item ON item.workspace_id = p.ws AND item.id = split.item_id LEFT JOIN cost ON cost.item_id = split.item_id
   WHERE split.quantity > 0
) facts ORDER BY title`;

const reserved: KpiSpec = {
  code: "reserved_available",
  requires: STOCK_READ,
  facts: (ctx) => readFacts(ctx, RESERVED_SQL),
  build: (ctx, facts) => {
    const of = (series: string) => sum(facts.filter((fact) => fact.dims.series === series).map((fact) => fact.amount));
    const ranked = byCategory(ctx, facts).slice(0, 8);
    const series = [{ id: "reserved", label: "" }, { id: "available", label: "" }];
    return {
      code: "reserved_available", unit: "money", value: of("reserved").toFixed(ctx.places), count: facts.filter((fact) => fact.dims.series === "reserved").length, targetable: false,
      extra: { available: of("available").toFixed(ctx.places) },
      chart: { type: "columns", dimension: "category", seriesDimension: "series", categories: ranked.map((item) => ({ key: item.key, label: item.label })), series,
        values: grid(facts, "category", ranked.map((item) => item.key), series, "series", "amount", ctx.places), unit: "money" },
    };
  },
};

// ------------------------------------------------------------------ purchases

/**
 * Purchases: purchase orders approved in the period (not cancelled since), before tax, by the month approved over 12
 * months. An order for projects or deals follows them through the filter bar; one for stock belongs to the company.
 */
const PURCHASES_SQL = `WITH ${P}, ${OPPORTUNITIES},
placed AS (
  SELECT purchase.id, purchase.number, purchase.approved_at, purchase.total - purchase.tax_total AS net, btrim(purchase.currency) AS cur, vendor.display_name AS vendor,
         EXISTS (SELECT 1 FROM purchase_order_lines line WHERE line.workspace_id = purchase.workspace_id AND line.order_id = purchase.id
                   AND (line.project_id IS NOT NULL OR line.opportunity_id IS NOT NULL)) AS for_jobs,
         EXISTS (SELECT 1 FROM purchase_order_lines line
                   LEFT JOIN delivery_projects dp ON dp.workspace_id = line.workspace_id AND dp.id = line.project_id
                   JOIN oc ON oc.case_id = dp.case_id OR oc.opportunity_id = line.opportunity_id
                  WHERE line.workspace_id = purchase.workspace_id AND line.order_id = purchase.id) AS in_scope
    FROM purchase_orders purchase CROSS JOIN p
    JOIN workspace_vendors vendor ON vendor.workspace_id = purchase.workspace_id AND vendor.id = purchase.vendor_id
   WHERE purchase.workspace_id = p.ws AND purchase.approved_at IS NOT NULL AND purchase.status <> 'cancelled'
     AND (p.entity_id IS NULL OR purchase.legal_entity_id = p.entity_id)
     AND purchase.approved_at >= p.series_from_at AND purchase.approved_at < p.to_at
)
SELECT ${FACT_COLUMNS} FROM (
  SELECT placed.id::text AS id, 'purchase_order' AS kind, NULL::text AS parent_id, placed.number AS reference, placed.vendor AS title, NULL::text AS client, NULL::text AS owner,
         NULL::text AS owner_id, placed.approved_at AS at, CASE WHEN placed.cur = p.currency THEN round(placed.net, 6)::text END AS amount, NULL::text AS measure, NULL::text AS detail,
         jsonb_build_object('period', CASE WHEN placed.approved_at >= p.from_at THEN '1' ELSE '0' END, 'month', ${month("placed.approved_at")},
           'currency', CASE WHEN placed.cur = p.currency THEN 'base' ELSE 'other' END, 'tax', 'net') AS dims
    FROM placed CROSS JOIN p
   WHERE placed.in_scope OR (NOT placed.for_jobs AND ${NO_SALES_FILTERS})
) facts ORDER BY at DESC`;

const purchases: KpiSpec = {
  code: "purchases",
  requires: [...PURCHASING_READ, ...STOCK_READ],
  compare: "neutral",
  facts: (ctx) => readFacts(ctx, PURCHASES_SQL),
  build: (ctx, facts) => {
    const period = facts.filter(inPeriod);
    const amount = sum(period.map((fact) => fact.amount)).toFixed(ctx.places);
    const keys = monthKeys(ctx.filters);
    const series = [{ id: "purchases", label: "" }];
    return {
      code: "purchases", unit: "money", value: amount, count: period.length, amount, targetable: false,
      chart: { type: "columns", dimension: "month", categories: categories(keys), series, values: [keys.map((key) => sum(facts.filter((fact) => fact.dims.month === key).map((fact) => fact.amount)).toFixed(ctx.places))], unit: "money" },
      notes: moneyNotes(facts),
    };
  },
};

// ------------------------------------------------------------------ marketing

/** Groups facts by a dimension into the five biggest (their own series, stable for the chart and its drill-down) and "other". */
export function topFive(facts: Fact[], dimension: string, into: string) {
  const counts = new Map<string, number>();
  for (const fact of facts) counts.set(fact.dims[dimension], (counts.get(fact.dims[dimension]) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([key]) => key);
  for (const fact of facts) fact.dims[into] = top.includes(fact.dims[dimension]) ? fact.dims[dimension] : "other";
  return { top, hasOther: facts.some((fact) => fact.dims[into] === "other") };
}

const withChannel = (facts: Fact[]) => { for (const fact of facts) fact.dims.sourceChannel = `${fact.dims.source}/${fact.dims.channel}`; topFive(facts, "sourceChannel", "channelGroup"); return facts; };

/**
 * Enquiries by source and channel: enquiries created in the period (as New leads: spam and duplicates left out),
 * 12-month columns stacked by source and channel — the five biggest pairs over those months, the rest "Other".
 */
const bySource: KpiSpec = {
  code: "enquiries_by_source",
  requires: MARKETING_READ,
  compare: "higher",
  facts: async (ctx) => withChannel(await readFacts(ctx, NEW_LEADS_SQL)),
  build: (ctx, facts) => {
    const period = facts.filter(inPeriod);
    const { top, hasOther } = topFive(facts, "sourceChannel", "channelGroup");
    const keys = monthKeys(ctx.filters);
    const series = [...top.map((id) => ({ id, label: id })), ...(hasOther ? [{ id: "other", label: "" }] : [])];
    return {
      code: "enquiries_by_source", unit: "count", value: String(period.length), count: period.length, targetable: false,
      chart: { type: "columns", dimension: "month", seriesDimension: "channelGroup", categories: categories(keys), series, values: grid(facts, "month", keys, series, "channelGroup", "count", ctx.places), unit: "count" },
    };
  },
};

/** Enquiries by type: the same enquiries, 12-month columns stacked by enquiry type (the five biggest, the rest "Other"). */
const byType: KpiSpec = {
  code: "enquiries_by_type",
  requires: MARKETING_READ,
  facts: async (ctx) => { const facts = await readFacts(ctx, NEW_LEADS_SQL); topFive(facts, "type", "typeGroup"); return facts; },
  build: (ctx, facts) => {
    const period = facts.filter(inPeriod);
    const { top, hasOther } = topFive(facts, "type", "typeGroup");
    const keys = monthKeys(ctx.filters);
    const series = [...top.map((id) => ({ id, label: ctx.labels.enquiryTypes.get(id) ?? "" })), ...(hasOther ? [{ id: "other", label: "" }] : [])];
    return {
      code: "enquiries_by_type", unit: "count", value: String(period.length), count: period.length, targetable: false,
      chart: { type: "columns", dimension: "month", seriesDimension: "typeGroup", categories: categories(keys), series, values: grid(facts, "month", keys, series, "typeGroup", "count", ctx.places), unit: "count" },
    };
  },
};

/** The step rates of a group of enquiries: qualified, quote (Proposal) and won, each as a share of the enquiries. */
export function sourceRates(facts: Fact[]) {
  const share = (step: string) => (facts.length ? percent(facts.filter((fact) => fact.dims[step] === "1").length, facts.length) : null);
  return { qualified: share("qualified"), proposal: share("proposal"), won: share("won") };
}

/**
 * Conversion by source: enquiries created in the period, by source, and how far each got (as the Conversion funnel
 * reads it): qualified, quote (reached Proposal) and won — each as a share of the source's enquiries. The figure is
 * enquiry → won over all sources.
 */
const conversion: KpiSpec = {
  code: "conversion_by_source",
  requires: MARKETING_READ,
  compare: "higher",
  facts: (ctx) => readFacts(ctx, FUNNEL_SQL),
  build: (ctx, facts) => {
    const groups = groupBy(facts, "source", (fact) => ctx.labels.sources.get(fact.dims.source) ?? fact.dims.source, ctx.places).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    return {
      code: "conversion_by_source", unit: "percent", value: sourceRates(facts).won, count: facts.length, targetable: false,
      chart: { type: "bars", dimension: "source", unit: "percent", items: groups.map((group) => {
        const rates = sourceRates(group.facts);
        return { key: group.key, label: ctx.labels.sources.get(group.key) ?? "", value: rates.won ?? "0", count: group.count, extra: { qualified: rates.qualified, proposal: rates.proposal } };
      }) },
    };
  },
};

/** The source of the enquiry behind each opportunity ("none" for one opened without an enquiry). */
async function opportunitySources(ctx: ReportContext, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  return new Map((await ctx.db.query<{ id: string; source: string | null }>(
    `SELECT o.id::text, e.source FROM crm_opportunities o
       LEFT JOIN crm_leads l ON l.workspace_id = o.workspace_id AND l.id = o.lead_id
       LEFT JOIN crm_enquiries e ON e.workspace_id = o.workspace_id AND e.id = l.enquiry_id
      WHERE o.workspace_id = $1 AND o.id = ANY($2::uuid[])`, [ctx.workspaceId, ids])).rows.map((row) => [row.id, row.source ?? "none"]));
}

/**
 * Won value by source: the period's Sales Won (as on the Owner overview: proposals with their payment proof, net of
 * tax, cancelled deals left out) by the source of the enquiry the deal came from, beside the source's enquiries in the
 * period.
 */
const wonBySource: KpiSpec = {
  code: "won_by_source",
  requires: MARKETING_READ,
  compare: "higher",
  facts: async (ctx) => {
    const facts = (await readFacts(ctx, WON_SQL)).filter(inPeriod);
    const sources = await opportunitySources(ctx, [...new Set(facts.map((fact) => fact.id))]);
    for (const fact of facts) fact.dims.source = sources.get(fact.id) ?? "none";
    return facts;
  },
  build: async (ctx, facts) => {
    const leads = (await readFacts(ctx, NEW_LEADS_SQL)).filter(inPeriod);
    const groups = groupBy(facts, "source", () => "", ctx.places).sort((a, b) => b.amount.cmp(a.amount) || b.count - a.count);
    const amount = sum(facts.map((fact) => fact.amount)).toFixed(ctx.places);
    return {
      code: "won_by_source", unit: "money", value: amount, count: facts.length, amount, targetable: false,
      chart: { type: "bars", dimension: "source", unit: "money", items: groups.map((group) => ({
        key: group.key, label: ctx.labels.sources.get(group.key) ?? "", value: group.amountText, count: group.count,
        extra: { leads: leads.filter((fact) => fact.dims.source === group.key).length },
      })) },
      notes: moneyNotes(facts),
    };
  },
};

/**
 * Lead response by source: the first-response clocks started in the period (the Lead response dashboard's), the
 * average working hours to the first response by the enquiry's source (lower is better), with the response rate.
 */
const responseBySource: KpiSpec = {
  code: "response_by_source",
  requires: MARKETING_READ,
  compare: "lower",
  facts: async (ctx) => (await readFacts(ctx, SLA_SQL)).filter((fact) => inPeriod(fact) && fact.measure !== null),
  build: async (ctx, facts) => {
    const clocks = (await readFacts(ctx, SLA_SQL)).filter(inPeriod);
    const groups = groupBy(facts, "source", () => "", 2).map((group) => ({ ...group, average: mean(group.facts.map((fact) => fact.measure!), 2) ?? "0" }))
      .sort((a, b) => Dec.of(a.average).cmp(b.average));
    return {
      code: "response_by_source", unit: "hours", value: mean(facts.map((fact) => fact.measure!), 2), count: facts.length, targetable: false,
      extra: { rate: responseRate(clocks) },
      chart: { type: "bars", dimension: "source", unit: "hours", items: groups.map((group) => ({ key: group.key, label: ctx.labels.sources.get(group.key) ?? "", value: group.average, count: group.count })) },
    };
  },
};

export const STOCK_MARKETING: KpiSpec[] = [stockValue, lowStock, slowMoving, reserved, purchases, bySource, byType, conversion, wonBySource, responseBySource];
