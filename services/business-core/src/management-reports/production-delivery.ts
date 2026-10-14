import { Dec } from "../catalog-core/decimal";
import { FURNITURE_PATHS, type FurniturePath } from "../crm/opportunities/flow-gates";
import { materialsShort, ORDER_TOTALS, defaultHours, FINAL_PENDING, plain, readWorkOrderMaterials } from "../factory/factory";
import { DEFAULT_PRODUCTION_STEPS, normaliseProductionSteps } from "../factory/production-status";
import { expectedWindow } from "../fulfilment/deal-fulfilment";
import { dealRule } from "../fulfilment/fulfilment-rules";
import { readFacts as readFulfilmentFacts } from "../fulfilment/fulfilment.service";
import { readCalendar, workdays } from "../project-core/work-calendar";
import { needsNotIn, readNeeds } from "../purchasing/orders";
import { type KpiSpec, type ReportContext, readFacts } from "./report-context";
import { type Fact, FACT_COLUMNS, byUrgency, calendarEntries, categories, grid, inPeriod, mean, monthKeys, percent, topGroups } from "./report-kit";
import { OPPORTUNITIES, OPPORTUNITY_ENTITY, P, localDate } from "./report-scope";
import { targetFor } from "./report-targets";

/**
 * Dashboard 5 · Production and delivery (PLM-131). Every definition here is also written in the master plan (§6.27a).
 *
 * Every record belongs to a started project (or, for a delivery or permit without one, a deal), so the filter bar
 * applies through the project's deal like everywhere else. Days are the workspace's local days; "this week" starts on
 * the workspace's week start.
 */

/** Started projects with what the filters read (`pj`), already filtered. */
const PROJECTS = `pj AS (
  SELECT dp.id AS project_id, dp.reference, dp.name, dp.status, dp.promise_date, dp.delivery_on, dp.installation_on, dp.site_finished_on,
         oc.client, oc.owner, oc.am, oc.opportunity_id
    FROM delivery_projects dp CROSS JOIN p JOIN oc ON oc.case_id = dp.case_id
   WHERE dp.workspace_id = p.ws AND dp.started_at IS NOT NULL AND ${OPPORTUNITY_ENTITY}
)`;
/** The first day of this week and of the week after next, on the workspace's week start. */
const WEEK = `wk AS (SELECT p.today - ((extract(dow FROM p.today)::int - p.week_start + 7) % 7) AS start FROM p)`;
const LIVE = `pj.status IN ('active', 'on_hold')`;
const WO_REFERENCE = (alias: string) => `'WO-' || lpad(${alias}.number::text, 4, '0')`;
const local = (day: string) => `(${day}::timestamp AT TIME ZONE p.tz)`;
const inChosen = (day: string) => `(${local(day)} >= p.from_at AND ${local(day)} < p.to_at)`;

// ------------------------------------------------------------------ work orders by status

/**
 * Work orders by status, live: every work order on a running project by where it stands — Scheduled (planned or
 * released), In production, Quality check (everything made, waiting for its approval or check, or for its last design
 * inspection, PLM-150), Ready — as the factory's own production status reads it (PLM-063; a step the firm doesn't use
 * folds into the one before, and it names the steps in its own words); plus Delivered: ready work orders whose
 * dispatches all arrived on site, counted when they arrived in the period.
 */
const STATUS_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${PROJECTS},
orders AS (
  SELECT wo.id, wo.number, wo.title, wo.planned_end, wo.project_id, pj.reference AS project_reference, pj.client, pj.owner, pj.am, pj.status AS project_status,
         CASE
           WHEN wo.status IN ('ready', 'short_closed') AND shipped.arrived > 0 AND shipped.moving = 0 THEN 'delivered'
           -- PLM-150: made and checked but not through its last design inspection yet: still the quality check.
           WHEN wo.status IN ('ready', 'short_closed') AND ${FINAL_PENDING("wo")} THEN 'quality_check'
           WHEN wo.status IN ('ready', 'short_closed') THEN 'ready'
           WHEN wo.status IN ('planned', 'released') OR (wo.status = 'on_hold' AND wo.held_from IS DISTINCT FROM 'in_production') THEN 'scheduled'
           WHEN wo.status = 'in_production'
                AND greatest(wo.quantity - (quality.passed - reworked.quantity) - greatest(reported.made - quality.passed - quality.failed, 0) - reported.pending, 0) = 0
                AND (reported.pending > 0 OR greatest(reported.made - quality.passed - quality.failed, 0) > 0) THEN 'quality_check'
           ELSE 'in_production' END AS step,
         -- Late (PLM-131): not made yet and past its internal date (planned end) or the client's (delivery day or promised date).
         CASE WHEN wo.status NOT IN ('ready', 'short_closed') AND (wo.planned_end < p.today OR least(pj.delivery_on, pj.promise_date) < p.today) THEN 'late' ELSE 'on_track' END AS timing,
         shipped.arrived_on
    FROM work_orders wo CROSS JOIN p JOIN pj ON pj.project_id = wo.project_id
    ${ORDER_TOTALS}
    LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE move.status = 'received' AND site.kind = 'site') AS arrived, count(*) FILTER (WHERE move.status = 'in_transit') AS moving,
                              max(move.received_on) FILTER (WHERE move.status = 'received' AND site.kind = 'site') AS arrived_on
                         FROM stock_transfers move JOIN stock_locations site ON site.workspace_id = move.workspace_id AND site.id = move.to_location_id
                        WHERE move.workspace_id = wo.workspace_id AND move.work_order_id = wo.id) shipped ON true
   WHERE wo.workspace_id = p.ws AND wo.status <> 'cancelled'
)
SELECT ${FACT_COLUMNS} FROM (
  SELECT orders.id::text AS id, 'work_order' AS kind, orders.project_id::text AS parent_id, ${WO_REFERENCE("orders")} AS reference, orders.title,
         orders.client, orders.owner, orders.am::text AS owner_id, ${local("COALESCE(orders.arrived_on, orders.planned_end)")} AS at,
         NULL::text AS amount, NULL::text AS measure, orders.project_reference AS detail, jsonb_build_object('period', '1', 'step', orders.step, 'late', orders.timing) AS dims
    FROM orders CROSS JOIN p
   WHERE (orders.step <> 'delivered' AND orders.project_status IN ('active', 'on_hold'))
      OR (orders.step = 'delivered' AND ${inChosen("orders.arrived_on")})
) facts ORDER BY at NULLS LAST, reference`;

export const DELIVERED = "delivered";

/** The firm's production steps (their kinds in order, with its own words), Delivered last. */
async function productionSteps(ctx: ReportContext) {
  const stored = (await ctx.db.query<{ steps: unknown }>(`SELECT production_steps AS steps FROM workspace_factory_settings WHERE workspace_id = $1`, [ctx.workspaceId])).rows[0];
  return normaliseProductionSteps(stored?.steps ?? DEFAULT_PRODUCTION_STEPS);
}

/** A work order at a step the firm doesn't keep reads as the step before it (no quality check: still in production). */
export function foldSteps(facts: Fact[], kept: string[]) {
  for (const fact of facts) {
    if (fact.dims.step === DELIVERED || kept.includes(fact.dims.step)) continue;
    fact.dims.step = fact.dims.step === "quality_check" && kept.includes("in_production") ? "in_production" : kept[0] ?? fact.dims.step;
  }
  return facts;
}

export const TIMING_SERIES = [{ id: "on_track", label: "" }, { id: "late", label: "" }];

/**
 * Production schedule (PLM-131): the open work orders by step in the firm's own words, each column on track against
 * late (as Late jobs reads it).
 */
const workOrderStatus: KpiSpec = {
  code: "work_orders_status",
  facts: async (ctx) => foldSteps(await readFacts(ctx, STATUS_SQL), (await productionSteps(ctx)).map((step) => step.kind)),
  build: async (ctx, facts) => {
    const steps = await productionSteps(ctx);
    const open = facts.filter((fact) => fact.dims.step !== DELIVERED);
    // Delivered is its own figure (Delivered to site); the chart shows the open work orders by step.
    return {
      code: "work_orders_status", unit: "count", value: String(open.length), count: open.length, targetable: false,
      extra: { delivered: facts.length - open.length, late: open.filter((fact) => fact.dims.late === "late").length },
      chart: { type: "columns", dimension: "step", seriesDimension: "late", categories: steps.map((step) => ({ key: step.kind, label: step.label })), series: TIMING_SERIES,
        values: grid(open, "step", steps.map((step) => step.kind), TIMING_SERIES, "late", "count", ctx.places), unit: "count" },
    };
  },
};

// ------------------------------------------------------------------ on time

/**
 * On time: work orders that became ready in the period (the day they were made ready, local), on time when that day
 * is on or before their planned end, late after it; one without a planned end is counted apart and left out of the
 * rate. Rate = on time ÷ (on time + late). Monthly columns over 12 months, on time against late.
 */
const ON_TIME_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${PROJECTS},
made AS (
  SELECT wo.id, wo.number, wo.title, wo.project_id, wo.planned_end, pj.reference AS project_reference, pj.client, pj.owner, pj.am,
         COALESCE(wo.ready_on, (wo.ready_at AT TIME ZONE p.tz)::date, (wo.closed_at AT TIME ZONE p.tz)::date) AS made_on
    FROM work_orders wo CROSS JOIN p JOIN pj ON pj.project_id = wo.project_id
   WHERE wo.workspace_id = p.ws AND wo.status IN ('ready', 'short_closed')
)
SELECT ${FACT_COLUMNS} FROM (
  SELECT made.id::text AS id, 'work_order' AS kind, made.project_id::text AS parent_id, ${WO_REFERENCE("made")} AS reference, made.title, made.client, made.owner, made.am::text AS owner_id,
         ${local("made.made_on")} AS at, NULL::text AS amount,
         CASE WHEN made.made_on > made.planned_end THEN (made.made_on - made.planned_end)::text END AS measure, made.project_reference AS detail,
         jsonb_build_object('period', CASE WHEN ${inChosen("made.made_on")} THEN '1' ELSE '0' END, 'month', to_char(made.made_on, 'YYYY-MM'),
           'timing', CASE WHEN made.planned_end IS NULL THEN 'no_date' WHEN made.made_on <= made.planned_end THEN 'on_time' ELSE 'late' END) AS dims
    FROM made CROSS JOIN p
   WHERE made.made_on IS NOT NULL AND ${local("made.made_on")} >= p.series_from_at AND ${local("made.made_on")} < p.to_at
) facts ORDER BY at DESC`;

/** On time ÷ (on time + late) × 100, one decimal; null when nothing with a planned end was made ready. */
export function onTimeRate(facts: Fact[]) {
  const dated = facts.filter((fact) => fact.dims.timing === "on_time" || fact.dims.timing === "late");
  return dated.length ? percent(dated.filter((fact) => fact.dims.timing === "on_time").length, dated.length) : null;
}

const onTime: KpiSpec = {
  code: "on_time_rate",
  compare: "higher",
  facts: (ctx) => readFacts(ctx, ON_TIME_SQL),
  build: (ctx, facts) => {
    const period = facts.filter(inPeriod);
    const rate = onTimeRate(period);
    const keys = monthKeys(ctx.filters);
    const series = [{ id: "on_time", label: "" }, { id: "late", label: "" }];
    return {
      code: "on_time_rate", unit: "percent", value: rate, count: period.length, targetable: true, ...targetFor(ctx.targets, "on_time_rate", ctx.filters, rate),
      extra: { onTime: period.filter((fact) => fact.dims.timing === "on_time").length, late: period.filter((fact) => fact.dims.timing === "late").length,
        noDate: period.filter((fact) => fact.dims.timing === "no_date").length },
      chart: { type: "columns", dimension: "month", seriesDimension: "timing", categories: categories(keys), series, values: grid(facts, "month", keys, series, "timing", "count", ctx.places), unit: "count" },
    };
  },
};

/**
 * Late jobs (PLM-131), live: open work orders (not made yet) on running projects past their internal date (the planned
 * end) or the client's date (the booked delivery day, else the promised handover date, whichever comes first). Days
 * late count from the first date missed; `against` says whether the client's date has gone (the more serious) or only
 * the internal one.
 */
const LATE_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${PROJECTS}
SELECT ${FACT_COLUMNS} FROM (
  SELECT wo.id::text AS id, 'work_order' AS kind, wo.project_id::text AS parent_id, ${WO_REFERENCE("wo")} AS reference, wo.title, pj.client, pj.owner, pj.am::text AS owner_id,
         ${local("missed.missed_on")} AS at, NULL::text AS amount, (p.today - missed.missed_on)::text AS measure, missed.against AS detail,
         jsonb_build_object('period', '1', 'against', missed.against) AS dims
    FROM work_orders wo CROSS JOIN p JOIN pj ON pj.project_id = wo.project_id
    CROSS JOIN LATERAL (SELECT least(pj.delivery_on, pj.promise_date) AS client_on) client
    CROSS JOIN LATERAL (SELECT CASE WHEN client.client_on < p.today THEN 'client_date' ELSE 'internal_date' END AS against,
                               CASE WHEN client.client_on < p.today THEN least(client.client_on, wo.planned_end) ELSE wo.planned_end END AS missed_on) missed
   WHERE wo.workspace_id = p.ws AND wo.status IN ('planned', 'released', 'in_production', 'on_hold') AND ${LIVE}
     AND (wo.planned_end < p.today OR client.client_on < p.today)
) facts ORDER BY at, reference`;

const lateOrders: KpiSpec = {
  code: "late_work_orders",
  facts: (ctx) => readFacts(ctx, LATE_SQL),
  build: (_ctx, facts) => ({ code: "late_work_orders", unit: "count", value: String(facts.length), count: facts.length, targetable: false,
    extra: { clientDate: facts.filter((fact) => fact.dims.against === "client_date").length }, chart: { type: "list", bucket: "period=1" } }),
};

// ------------------------------------------------------------------ ready this week and next

/**
 * Ready this week and next (PLM-131): work orders on running projects whose order-ready day falls in this week or the
 * next (on the workspace's week start) — the day recorded when it was made ready, else its planned end — by day, made
 * ready against still planned.
 */
const READY_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${PROJECTS}, ${WEEK}
SELECT ${FACT_COLUMNS} FROM (
  SELECT wo.id::text AS id, 'work_order' AS kind, wo.project_id::text AS parent_id, ${WO_REFERENCE("wo")} AS reference, wo.title, pj.client, pj.owner, pj.am::text AS owner_id,
         ${local("ready.day")} AS at, NULL::text AS amount, NULL::text AS measure, pj.reference AS detail,
         jsonb_build_object('period', '1', 'day', to_char(ready.day, 'YYYY-MM-DD'), 'state', ready.state,
           'week', CASE WHEN ready.day < wk.start + 7 THEN 'this_week' ELSE 'next_week' END) AS dims
    FROM work_orders wo CROSS JOIN p CROSS JOIN wk JOIN pj ON pj.project_id = wo.project_id
    CROSS JOIN LATERAL (SELECT CASE WHEN wo.status IN ('ready', 'short_closed') THEN 'ready' ELSE 'planned' END AS state,
                               CASE WHEN wo.status IN ('ready', 'short_closed') THEN COALESCE(wo.ready_on, (wo.ready_at AT TIME ZONE p.tz)::date) ELSE wo.planned_end END AS day) ready
   WHERE wo.workspace_id = p.ws AND wo.status <> 'cancelled' AND ${LIVE} AND ready.day >= wk.start AND ready.day < wk.start + 14
) facts ORDER BY at, reference`;

export const READY_SERIES = [{ id: "ready", label: "" }, { id: "planned", label: "" }];

/** The 14 days of this week and the next, on the workspace's week start. */
export function fortnight(today: string, weekStart: number) {
  const first = loadWeeks(today, weekStart)[0];
  return Array.from({ length: 14 }, (_, index) => addDays(first, index));
}

const readyUpcoming: KpiSpec = {
  code: "ready_upcoming",
  facts: (ctx) => readFacts(ctx, READY_SQL),
  build: (ctx, facts) => {
    const days = fortnight(localDate(ctx.now, ctx.timeZone), ctx.weekStart);
    return {
      code: "ready_upcoming", unit: "count", value: String(facts.length), count: facts.length, targetable: false,
      extra: { thisWeek: facts.filter((fact) => fact.dims.week === "this_week").length, nextWeek: facts.filter((fact) => fact.dims.week === "next_week").length },
      chart: { type: "columns", dimension: "day", seriesDimension: "state", categories: categories(days), series: READY_SERIES,
        values: grid(facts, "day", days, READY_SERIES, "state", "count", ctx.places), unit: "count" },
    };
  },
};

// ------------------------------------------------------------------ deliveries and installations booked

/**
 * Deliveries and installations booked (PLM-131), as the logistics calendar holds them: running and finished projects'
 * delivery and installation days, and the delivery days of deals delivered without a project — from the first of the
 * period's month to the end of the month after the later of the period's end and today. A day opens what is booked.
 */
const BOOKINGS_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${PROJECTS},
win AS (SELECT date_trunc('month', $2::date)::date AS first, (date_trunc('month', greatest($3::date, p.today)) + interval '2 months' - interval '1 day')::date AS last FROM p),
booked AS (
  SELECT pj.project_id AS id, 'project' AS kind, pj.project_id AS parent, pj.reference, pj.name AS title, pj.client, pj.owner, pj.am, 'delivery' AS what, pj.delivery_on AS day
    FROM pj WHERE pj.status IN ('active', 'on_hold', 'completed') AND pj.delivery_on IS NOT NULL
  UNION ALL
  SELECT pj.project_id, 'project', pj.project_id, pj.reference, pj.name, pj.client, pj.owner, pj.am, 'installation', pj.installation_on
    FROM pj WHERE pj.status IN ('active', 'on_hold', 'completed') AND pj.installation_on IS NOT NULL
  UNION ALL
  SELECT oc.opportunity_id, 'opportunity', oc.case_id, oc.reference, oc.title, oc.client, oc.owner, oc.am, 'delivery', f.delivery_on
    FROM crm_deal_fulfilment f CROSS JOIN p JOIN oc ON oc.opportunity_id = f.opportunity_id
   WHERE f.workspace_id = p.ws AND f.cancelled_at IS NULL AND f.delivery_on IS NOT NULL AND ${OPPORTUNITY_ENTITY}
     AND NOT EXISTS (SELECT 1 FROM delivery_projects dp WHERE dp.workspace_id = p.ws AND dp.case_id = oc.case_id AND dp.started_at IS NOT NULL)
)
SELECT ${FACT_COLUMNS} FROM (
  SELECT booked.id::text || ':' || booked.what AS id, booked.kind, booked.parent::text AS parent_id, booked.reference, booked.title, booked.client, booked.owner,
         booked.am::text AS owner_id, ${local("booked.day")} AS at, NULL::text AS amount, NULL::text AS measure, booked.what AS detail,
         jsonb_build_object('period', CASE WHEN booked.day BETWEEN $2::date AND $3::date THEN '1' ELSE '0' END, 'day', to_char(booked.day, 'YYYY-MM-DD'), 'kind', booked.what) AS dims
    FROM booked CROSS JOIN p CROSS JOIN win
   WHERE booked.day BETWEEN win.first AND win.last
) facts ORDER BY at, reference`;

const bookings: KpiSpec = {
  code: "bookings",
  facts: (ctx) => readFacts(ctx, BOOKINGS_SQL),
  build: (ctx, facts) => {
    const period = facts.filter(inPeriod);
    return {
      code: "bookings", unit: "count", value: String(period.length), count: period.length, targetable: false,
      extra: { deliveries: period.filter((fact) => fact.dims.kind === "delivery").length, installations: period.filter((fact) => fact.dims.kind === "installation").length },
      chart: { type: "calendar", dimension: "day", seriesDimension: "kind", month: ctx.filters.to.slice(0, 7), weekStart: ctx.weekStart, entries: calendarEntries(facts, "day", "kind") },
    };
  },
};

// ------------------------------------------------------------------ open snags

export const SNAG_AGES = ["days_0_7", "days_8_30", "days_31_plus"] as const;
export const SNAG_PROJECTS = 8;

/** A snag's age bucket from the days it has been open. */
export function snagAge(days: number): (typeof SNAG_AGES)[number] {
  return days <= 7 ? "days_0_7" : days <= 30 ? "days_8_30" : "days_31_plus";
}

/**
 * Open snags (PLM-131), live: snags not done or cancelled on started projects (not cancelled ones; a warranty snag on a
 * finished project still counts), by project — the eight with the most, the rest together — and by how many local
 * days they have been open.
 */
const SNAGS_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${PROJECTS}
SELECT ${FACT_COLUMNS} FROM (
  SELECT item.id::text AS id, 'snag' AS kind, item.project_id::text AS parent_id, pj.reference, item.title, pj.client, pj.owner, pj.am::text AS owner_id,
         item.created_at AS at, NULL::text AS amount, (p.today - (item.created_at AT TIME ZONE p.tz)::date)::text AS measure, item.severity AS detail,
         jsonb_build_object('period', '1', 'project', item.project_id::text) AS dims
    FROM work_items item CROSS JOIN p JOIN pj ON pj.project_id = item.project_id
   WHERE item.workspace_id = p.ws AND item.type = 'snag' AND item.status NOT IN ('done', 'cancelled') AND pj.status <> 'cancelled'
) facts ORDER BY at, reference`;

const openSnags: KpiSpec = {
  code: "open_snags",
  facts: async (ctx) => {
    const facts = await readFacts(ctx, SNAGS_SQL);
    for (const fact of facts) fact.dims.age = snagAge(Number(fact.measure ?? "0"));
    topGroups(facts, "project", "projectGroup", SNAG_PROJECTS);
    return facts;
  },
  build: (ctx, facts) => {
    const { top, hasOther } = topGroups(facts, "project", "projectGroup", SNAG_PROJECTS);
    const keys = [...top, ...(hasOther ? ["other"] : [])];
    const series = SNAG_AGES.map((id) => ({ id, label: "" }));
    return {
      code: "open_snags", unit: "count", value: String(facts.length), count: facts.length, targetable: false,
      extra: { over30: facts.filter((fact) => fact.dims.age === "days_31_plus").length },
      chart: { type: "columns", dimension: "projectGroup", seriesDimension: "age",
        categories: keys.map((key) => ({ key, label: key === "other" ? "" : facts.find((fact) => fact.dims.project === key)?.reference ?? "" })), series,
        values: grid(facts, "projectGroup", keys, series, "age", "count", ctx.places), unit: "count" },
    };
  },
};

// ------------------------------------------------------------------ factory load

export const LOAD_WEEKS = 8;

type LoadOrder = {
  id: string; number: number; title: string; projectId: string; projectReference: string; client: string | null; owner: string | null; am: string | null;
  workcenterId: string; workcenterName: string; hoursPerDay: string | null; plannedStart: string; plannedEnd: string; plannedHours: string | null;
};

const LOAD_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${PROJECTS}
SELECT wo.id, wo.number, wo.title, wo.project_id AS "projectId", pj.reference AS "projectReference", pj.client, pj.owner, pj.am::text AS am,
       wo.workcenter_id AS "workcenterId", center.name AS "workcenterName", center.hours_per_day::text AS "hoursPerDay",
       wo.planned_start::text AS "plannedStart", wo.planned_end::text AS "plannedEnd", wo.planned_hours::text AS "plannedHours"
  FROM work_orders wo CROSS JOIN p JOIN pj ON pj.project_id = wo.project_id
  JOIN workcenters center ON center.workspace_id = wo.workspace_id AND center.id = wo.workcenter_id
 WHERE wo.workspace_id = p.ws AND wo.status IN ('planned', 'released', 'in_production', 'on_hold') AND wo.planned_start IS NOT NULL AND wo.planned_end IS NOT NULL AND ${LIVE}`;

const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The weeks the load covers: this week (on the workspace's week start) and the seven after it. */
export function loadWeeks(today: string, weekStart: number) {
  const date = new Date(`${today}T00:00:00Z`);
  const first = addDays(today, -((date.getUTCDay() - weekStart + 7) % 7));
  return Array.from({ length: LOAD_WEEKS }, (_, index) => addDays(first, index * 7));
}

/**
 * One fact per work order and week: the hours it books on its workcenter that week. A work order's hours (else its
 * workcenter's hours a day over its working days, as the factory schedule does) are spread evenly over its working
 * days, the way the factory's own capacity view spreads them.
 */
export function spreadLoad(orders: LoadOrder[], weeks: string[], isWorking: (day: string) => boolean, fallbackHours: (order: LoadOrder) => string | null): Fact[] {
  const facts: Fact[] = [];
  const end = addDays(weeks[weeks.length - 1], 6);
  for (const order of orders) {
    const hours = order.plannedHours ?? fallbackHours(order);
    if (!hours) continue;
    const worked: string[] = [];
    for (let day = order.plannedStart; day <= order.plannedEnd; day = addDays(day, 1)) if (isWorking(day)) worked.push(day);
    if (!worked.length) continue;
    const share = Dec.of(hours).div(worked.length);
    const byWeek = new Map<string, Dec>();
    for (const day of worked) {
      if (day < weeks[0] || day > end) continue;
      const week = weeks.filter((start) => start <= day).at(-1)!;
      byWeek.set(week, (byWeek.get(week) ?? Dec.ZERO).add(share));
    }
    for (const [week, booked] of byWeek) facts.push({
      id: `${order.id}:${week}`, kind: "work_order", parentId: order.projectId, reference: `WO-${String(order.number).padStart(4, "0")}`, title: order.title,
      client: order.client, owner: order.owner, ownerId: order.am, at: `${week}T00:00:00.000Z`, amount: null, measure: booked.toFixed(1), detail: order.workcenterName,
      dims: { period: "1", week, workcenter: order.workcenterId },
    });
  }
  return facts.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "") || (a.reference ?? "").localeCompare(b.reference ?? ""));
}

const hoursOf = (facts: Fact[]) => facts.reduce((sum, fact) => sum.add(fact.measure ?? "0"), Dec.ZERO);

/** The five busiest workcenters keep their own series (the chart's colours, and their drill-down); the rest are "other". */
export function groupCentres(facts: Fact[], keep = 5) {
  const ranked = [...new Set(facts.map((fact) => fact.dims.workcenter))]
    .map((id) => ({ id, hours: hoursOf(facts.filter((fact) => fact.dims.workcenter === id)) }))
    .sort((a, b) => b.hours.cmp(a.hours) || a.id.localeCompare(b.id));
  const top = ranked.slice(0, keep).map((item) => item.id);
  for (const fact of facts) fact.dims.centre = top.includes(fact.dims.workcenter) ? fact.dims.workcenter : "other";
  return { top, hasOther: ranked.length > keep };
}

const factoryLoad: KpiSpec = {
  code: "factory_load",
  facts: async (ctx) => {
    const orders = (await ctx.db.query<LoadOrder>(LOAD_SQL, ctx.params)).rows;
    const calendar = await readCalendar(ctx.db, ctx.workspaceId);
    const weeks = loadWeeks(localDate(ctx.now, ctx.timeZone), ctx.weekStart);
    const facts = spreadLoad(orders, weeks, workdays(calendar).isWorking, (order) => defaultHours(order.hoursPerDay, order.plannedStart, order.plannedEnd, calendar));
    groupCentres(facts);
    return facts;
  },
  build: async (ctx, facts) => {
    const weeks = loadWeeks(localDate(ctx.now, ctx.timeZone), ctx.weekStart);
    const calendar = await readCalendar(ctx.db, ctx.workspaceId);
    const isWorking = workdays(calendar).isWorking;
    const centers = (await ctx.db.query<{ id: string; name: string; hoursPerDay: string | null }>(
      `SELECT id, name, hours_per_day::text AS "hoursPerDay" FROM workcenters WHERE workspace_id = $1 AND active ORDER BY position, name`, [ctx.workspaceId])).rows;
    const workingDays = (week: string) => Array.from({ length: 7 }, (_, index) => addDays(week, index)).filter(isWorking).length;
    let capacity = Dec.ZERO, overloaded = 0;
    for (const center of centers) {
      if (!center.hoursPerDay) continue;
      for (const week of weeks) {
        const available = Dec.of(center.hoursPerDay).mul(workingDays(week));
        capacity = capacity.add(available);
        if (hoursOf(facts.filter((fact) => fact.dims.workcenter === center.id && fact.dims.week === week)).cmp(available) > 0) overloaded += 1;
      }
    }
    const total = hoursOf(facts);
    const { top, hasOther } = groupCentres(facts);
    const series = [...top.map((id) => ({ id, label: centers.find((center) => center.id === id)?.name ?? facts.find((fact) => fact.dims.workcenter === id)?.detail ?? id })),
      ...(hasOther ? [{ id: "other", label: "" }] : [])];
    return {
      code: "factory_load", unit: "hours", value: total.toFixed(1), count: new Set(facts.map((fact) => fact.id.split(":")[0])).size, targetable: false,
      extra: { capacity: capacity.toFixed(1), percent: capacity.isZero() ? null : percent(total, capacity), overloaded },
      chart: { type: "columns", dimension: "week", seriesDimension: "centre", categories: categories(weeks), series,
        values: series.map((item) => weeks.map((week) => hoursOf(facts.filter((fact) => fact.dims.centre === item.id && fact.dims.week === week)).toFixed(1))), unit: "hours" },
    };
  },
};

// ------------------------------------------------------------------ material shortages

/**
 * Material shortages, live: work orders not released yet (planned, or held before release) on running projects whose
 * materials aren't in — the factory's own release check: each listed material is issued, or covered by the project's
 * stock after its other running work orders; a work order that lists none waits on its package's purchasing needs.
 */
const SHORT_CANDIDATES_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${PROJECTS}
SELECT wo.id::text AS id, wo.number, wo.title, wo.project_id::text AS "projectId", wo.package_id::text AS "packageId", wo.planned_start::text AS "plannedStart",
       pj.reference AS "projectReference", pj.client, pj.owner, pj.am::text AS am
  FROM work_orders wo CROSS JOIN p JOIN pj ON pj.project_id = wo.project_id
 WHERE wo.workspace_id = p.ws AND ${LIVE}
   AND (wo.status = 'planned' OR (wo.status = 'on_hold' AND wo.held_from IN ('planned', 'released')))
 ORDER BY wo.planned_start NULLS LAST, wo.number`;

const shortages: KpiSpec = {
  code: "material_shortages",
  facts: async (ctx) => {
    const candidates = (await ctx.db.query<{ id: string; number: number; title: string; projectId: string; packageId: string | null; plannedStart: string | null;
      projectReference: string; client: string | null; owner: string | null; am: string | null }>(SHORT_CANDIDATES_SQL, ctx.params)).rows;
    const needs = new Map<string, Awaited<ReturnType<typeof readNeeds>>>();
    const facts: Fact[] = [];
    for (const order of candidates) {
      const materials = (await readWorkOrderMaterials(ctx.db, ctx.workspaceId, order.id)).filter((row) => row.status === "active");
      let missing: string[];
      if (materials.length) missing = (await materialsShort(ctx.db, ctx.workspaceId, order.id, materials)).map((row) => `${row.itemName} ${plain(row.short)} ${row.unit}`.trim());
      else {
        if (!needs.has(order.projectId)) needs.set(order.projectId, await readNeeds(ctx.db, ctx.workspaceId, false, order.projectId));
        missing = needsNotIn(needs.get(order.projectId)!, order.packageId).map((need) => need.title);
      }
      if (!missing.length) continue;
      facts.push({
        id: order.id, kind: "work_order", parentId: order.projectId, reference: `WO-${String(order.number).padStart(4, "0")}`, title: order.title, client: order.client,
        owner: order.owner, ownerId: order.am, at: order.plannedStart ? `${order.plannedStart}T00:00:00.000Z` : null, amount: null, measure: String(missing.length),
        detail: missing.slice(0, 3).join(", ") + (missing.length > 3 ? ` +${missing.length - 3}` : ""), dims: { period: "1" },
      });
    }
    return facts;
  },
  build: (_ctx, facts) => ({ code: "material_shortages", unit: "count", value: String(facts.length), count: facts.length, targetable: false, chart: { type: "list", bucket: "period=1" } }),
};

// ------------------------------------------------------------------ deliveries, installations, permits, stages, handovers

/**
 * Deliveries this week and next, live: running projects whose delivery day is booked in this week or the next (on the
 * workspace's week start), and deals delivered without a project whose delivery is booked then and not yet delivered.
 */
const DELIVERIES_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${PROJECTS}, ${WEEK}
SELECT ${FACT_COLUMNS} FROM (
  SELECT pj.project_id::text AS id, 'project' AS kind, pj.project_id::text AS parent_id, pj.reference, pj.name AS title, pj.client, pj.owner, pj.am::text AS owner_id,
         ${local("pj.delivery_on")} AS at, NULL::text AS amount, (pj.delivery_on - p.today)::text AS measure, NULL::text AS detail,
         jsonb_build_object('period', '1', 'week', CASE WHEN pj.delivery_on < wk.start + 7 THEN 'this_week' ELSE 'next_week' END) AS dims
    FROM pj CROSS JOIN p CROSS JOIN wk
   WHERE ${LIVE} AND pj.delivery_on >= wk.start AND pj.delivery_on < wk.start + 14
  UNION ALL
  SELECT oc.opportunity_id::text, 'opportunity', oc.case_id::text, oc.reference, oc.title, oc.client, oc.owner, oc.am::text,
         ${local("f.delivery_on")}, NULL, (f.delivery_on - p.today)::text, NULL,
         jsonb_build_object('period', '1', 'week', CASE WHEN f.delivery_on < wk.start + 7 THEN 'this_week' ELSE 'next_week' END)
    FROM crm_deal_fulfilment f CROSS JOIN p CROSS JOIN wk JOIN oc ON oc.opportunity_id = f.opportunity_id
   WHERE f.workspace_id = p.ws AND f.cancelled_at IS NULL AND f.delivery_on >= wk.start AND f.delivery_on < wk.start + 14 AND ${OPPORTUNITY_ENTITY}
     AND NOT EXISTS (SELECT 1 FROM crm_deal_fulfilment_events ev WHERE ev.workspace_id = p.ws AND ev.opportunity_id = f.opportunity_id AND ev.event IN ('collected', 'delivered', 'installed'))
     AND NOT EXISTS (SELECT 1 FROM delivery_projects dp WHERE dp.workspace_id = p.ws AND dp.case_id = oc.case_id AND dp.started_at IS NOT NULL)
) facts ORDER BY at, reference`;

export const WEEK_BUCKETS = ["this_week", "next_week"] as const;

/** A bars chart over fixed buckets, counted. */
const bucketBars = (facts: Fact[], dimension: string, keys: readonly string[]) => ({
  type: "bars" as const, dimension, unit: "count" as const, items: keys.map((key) => {
    const count = facts.filter((fact) => fact.dims[dimension] === key).length;
    return { key, label: key, value: String(count), count };
  }),
});

const deliveries: KpiSpec = {
  code: "deliveries_upcoming",
  facts: (ctx) => readFacts(ctx, DELIVERIES_SQL),
  build: (_ctx, facts) => ({
    code: "deliveries_upcoming", unit: "count", value: String(facts.length), count: facts.length, targetable: false,
    extra: { thisWeek: facts.filter((fact) => fact.dims.week === "this_week").length, nextWeek: facts.filter((fact) => fact.dims.week === "next_week").length },
    chart: bucketBars(facts, "week", WEEK_BUCKETS),
  }),
};

/**
 * Installations scheduled, live: running projects with an installation day and no installation sign-off yet — late
 * (the day has passed), this week, next week, or later.
 */
const INSTALLATIONS_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${PROJECTS}, ${WEEK}
SELECT ${FACT_COLUMNS} FROM (
  SELECT pj.project_id::text AS id, 'project' AS kind, pj.project_id::text AS parent_id, pj.reference, pj.name AS title, pj.client, pj.owner, pj.am::text AS owner_id,
         ${local("pj.installation_on")} AS at, NULL::text AS amount, (pj.installation_on - p.today)::text AS measure, NULL::text AS detail,
         jsonb_build_object('period', '1', 'when', CASE WHEN pj.installation_on < p.today THEN 'late' WHEN pj.installation_on < wk.start + 7 THEN 'this_week'
           WHEN pj.installation_on < wk.start + 14 THEN 'next_week' ELSE 'later' END) AS dims
    FROM pj CROSS JOIN p CROSS JOIN wk
   WHERE ${LIVE} AND pj.installation_on IS NOT NULL AND pj.site_finished_on IS NULL
) facts ORDER BY at, reference`;

export const INSTALLATION_BUCKETS = ["late", "this_week", "next_week", "later"] as const;

const installations: KpiSpec = {
  code: "installations_scheduled",
  facts: (ctx) => readFacts(ctx, INSTALLATIONS_SQL),
  build: (_ctx, facts) => ({
    code: "installations_scheduled", unit: "count", value: String(facts.length), count: facts.length, targetable: false,
    extra: { late: facts.filter((fact) => fact.dims.when === "late").length },
    chart: bucketBars(facts, "when", INSTALLATION_BUCKETS),
  }),
};

/**
 * Permits expiring, live: collected permits on running projects (or deals not yet delivered) whose validity ends
 * within 30 days, or has ended, with no newer permit of the same type collected after it — expired, within 7 days,
 * within 30 days.
 */
const PERMITS_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${PROJECTS}
SELECT ${FACT_COLUMNS} FROM (
  SELECT COALESCE(pj.project_id, oc.opportunity_id)::text || ':' || permit.id::text AS id, CASE WHEN pj.project_id IS NOT NULL THEN 'project' ELSE 'opportunity' END AS kind,
         COALESCE(pj.project_id::text, oc.case_id::text) AS parent_id, COALESCE(pj.reference, oc.reference) AS reference,
         permit.permit_type || ' · ' || permit.permit_number AS title, COALESCE(pj.client, oc.client) AS client, COALESCE(pj.owner, oc.owner) AS owner,
         COALESCE(pj.am, oc.am)::text AS owner_id, ${local("permit.valid_to")} AS at, NULL::text AS amount, (permit.valid_to - p.today)::text AS measure,
         COALESCE(pj.name, oc.title) AS detail,
         jsonb_build_object('period', '1', 'expiry', CASE WHEN permit.valid_to < p.today THEN 'expired' WHEN permit.valid_to <= p.today + 7 THEN 'within_7' ELSE 'within_30' END) AS dims
    FROM building_permits permit CROSS JOIN p
    LEFT JOIN pj ON pj.project_id = permit.project_id
    LEFT JOIN oc ON permit.opportunity_id IS NOT NULL AND oc.opportunity_id = permit.opportunity_id AND ${OPPORTUNITY_ENTITY}
   WHERE permit.workspace_id = p.ws AND permit.status = 'collected' AND permit.valid_to <= p.today + 30
     AND ((pj.project_id IS NOT NULL AND ${LIVE})
       OR (oc.opportunity_id IS NOT NULL AND oc.cancelled_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM crm_deal_fulfilment_events ev WHERE ev.workspace_id = p.ws AND ev.opportunity_id = oc.opportunity_id AND ev.event IN ('delivered', 'installed'))))
     AND NOT EXISTS (SELECT 1 FROM building_permits newer WHERE newer.workspace_id = permit.workspace_id AND newer.status = 'collected' AND newer.id <> permit.id
                       AND newer.permit_type = permit.permit_type AND newer.valid_to > permit.valid_to
                       AND (newer.project_id = permit.project_id OR newer.opportunity_id = permit.opportunity_id))
) facts ORDER BY at, reference`;

export const PERMIT_BUCKETS = ["expired", "within_7", "within_30"] as const;

const permits: KpiSpec = {
  code: "permits_expiring",
  facts: (ctx) => readFacts(ctx, PERMITS_SQL),
  build: (_ctx, facts) => ({
    code: "permits_expiring", unit: "count", value: String(facts.length), count: facts.length, targetable: false,
    extra: { expired: facts.filter((fact) => fact.dims.expiry === "expired").length },
    chart: bucketBars(facts, "expiry", PERMIT_BUCKETS),
  }),
};

/**
 * Projects by stage, live: running projects by their current stage (the firm's own stages, in their order), each on
 * track or late — late when the stage has open tasks past their due date, or the project is past its promised
 * handover date.
 */
const STAGES_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${PROJECTS}
SELECT ${FACT_COLUMNS} FROM (
  SELECT pj.project_id::text AS id, 'project' AS kind, pj.project_id::text AS parent_id, pj.reference, pj.name AS title, pj.client, pj.owner, pj.am::text AS owner_id,
         stage.started_at AS at, NULL::text AS amount, NULLIF(late.items, 0)::text AS measure, stage.name AS detail,
         jsonb_build_object('period', '1', 'stage', COALESCE(stage.key, 'no_stage'), 'position', lpad(COALESCE(stage.position, 9999)::text, 4, '0'),
           'late', CASE WHEN late.items > 0 OR pj.promise_date < p.today THEN 'late' ELSE 'on_track' END) AS dims
    FROM pj CROSS JOIN p
    LEFT JOIN LATERAL (SELECT ps.id, ps.key, ps.name, ps.position, ps.started_at FROM project_stages ps
                        WHERE ps.workspace_id = p.ws AND ps.project_id = pj.project_id AND ps.status = 'current' ORDER BY ps.position LIMIT 1) stage ON true
    LEFT JOIN LATERAL (SELECT count(*)::int AS items FROM work_items item
                        WHERE item.workspace_id = p.ws AND item.project_id = pj.project_id AND item.stage_id = stage.id
                          AND item.status NOT IN ('done', 'cancelled') AND item.due_date < p.today) late ON true
   WHERE ${LIVE}
) facts ORDER BY title`;

const projectStages: KpiSpec = {
  code: "projects_by_stage",
  facts: (ctx) => readFacts(ctx, STAGES_SQL),
  build: (ctx, facts) => {
    const keys = [...new Map(facts.map((fact) => [fact.dims.stage, fact.dims.position])).entries()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
    const series = [{ id: "on_track", label: "" }, { id: "late", label: "" }];
    return {
      code: "projects_by_stage", unit: "count", value: String(facts.length), count: facts.length, targetable: false,
      extra: { late: facts.filter((fact) => fact.dims.late === "late").length },
      chart: { type: "columns", dimension: "stage", seriesDimension: "late",
        categories: keys.map(([key]) => ({ key, label: key === "no_stage" ? "" : facts.find((fact) => fact.dims.stage === key)?.detail ?? key })), series,
        values: grid(facts, "stage", keys.map(([key]) => key), series, "late", "count", ctx.places), unit: "count" },
    };
  },
};

/**
 * Handovers due, live: running projects whose promised handover date is within 30 days (or has passed) and that
 * aren't handed over yet (no handover accepted, handover stage not done) — overdue, within 7 days, within 30 days.
 */
const HANDOVERS_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${PROJECTS}
SELECT ${FACT_COLUMNS} FROM (
  SELECT pj.project_id::text AS id, 'handover' AS kind, pj.project_id::text AS parent_id, pj.reference, pj.name AS title, pj.client, pj.owner, pj.am::text AS owner_id,
         ${local("pj.promise_date")} AS at, NULL::text AS amount, (pj.promise_date - p.today)::text AS measure, NULL::text AS detail,
         jsonb_build_object('period', '1', 'due', CASE WHEN pj.promise_date < p.today THEN 'overdue' WHEN pj.promise_date <= p.today + 7 THEN 'within_7' ELSE 'within_30' END) AS dims
    FROM pj CROSS JOIN p
   WHERE ${LIVE} AND pj.promise_date <= p.today + 30
     AND NOT EXISTS (SELECT 1 FROM handover_packs pack WHERE pack.workspace_id = p.ws AND pack.project_id = pj.project_id AND pack.status = 'accepted')
     AND NOT EXISTS (SELECT 1 FROM project_stages ps WHERE ps.workspace_id = p.ws AND ps.project_id = pj.project_id AND ps.key = 'handover' AND ps.status IN ('done', 'skipped'))
) facts ORDER BY at, reference`;

export const HANDOVER_BUCKETS = ["overdue", "within_7", "within_30"] as const;

const handovers: KpiSpec = {
  code: "handovers_due",
  facts: (ctx) => readFacts(ctx, HANDOVERS_SQL),
  build: (_ctx, facts) => ({
    code: "handovers_due", unit: "count", value: String(facts.length), count: facts.length, targetable: false,
    extra: { overdue: facts.filter((fact) => fact.dims.due === "overdue").length },
    chart: bucketBars(facts, "due", HANDOVER_BUCKETS),
  }),
};

// ------------------------------------------------------------------ the period's output (tiles)

/** Made ready: work orders the factory made ready in the period (as On time counts them, with or without a planned end). */
const made: KpiSpec = {
  code: "work_orders_made",
  compare: "higher",
  facts: async (ctx) => (await readFacts(ctx, ON_TIME_SQL)).filter(inPeriod),
  build: (_ctx, facts) => ({ code: "work_orders_made", unit: "count", value: String(facts.length), count: facts.length, targetable: false }),
};

/** Delivered to site: work orders whose dispatches all arrived on the project's site, counted on the day the last arrived. */
const delivered: KpiSpec = {
  code: "work_orders_delivered",
  compare: "higher",
  facts: async (ctx) => (await readFacts(ctx, STATUS_SQL)).filter((fact) => fact.dims.step === DELIVERED),
  build: (_ctx, facts) => ({ code: "work_orders_delivered", unit: "count", value: String(facts.length), count: facts.length, targetable: false }),
};

/**
 * Installations done: projects whose installation was signed off (site finished) in the period, on time against the
 * installation day they were booked for (late after it; without one, counted as on time).
 */
const INSTALLED_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${PROJECTS}
SELECT ${FACT_COLUMNS} FROM (
  SELECT pj.project_id::text AS id, 'project' AS kind, pj.project_id::text AS parent_id, pj.reference, pj.name AS title, pj.client, pj.owner, pj.am::text AS owner_id,
         ${local("pj.site_finished_on")} AS at, NULL::text AS amount,
         CASE WHEN pj.site_finished_on > pj.installation_on THEN (pj.site_finished_on - pj.installation_on)::text END AS measure, NULL::text AS detail,
         jsonb_build_object('period', '1', 'timing', CASE WHEN pj.site_finished_on > pj.installation_on THEN 'late' ELSE 'on_time' END) AS dims
    FROM pj CROSS JOIN p
   WHERE pj.site_finished_on IS NOT NULL AND ${inChosen("pj.site_finished_on")}
) facts ORDER BY at DESC, reference`;

const installed: KpiSpec = {
  code: "installations_done",
  compare: "higher",
  facts: (ctx) => readFacts(ctx, INSTALLED_SQL),
  build: (_ctx, facts) => ({
    code: "installations_done", unit: "count", value: String(facts.length), count: facts.length, targetable: false,
    extra: { late: facts.filter((fact) => fact.dims.timing === "late").length },
  }),
};

// ------------------------------------------------------------------ Furniture Only lead times

/** Working days after `from` up to and including `to` (0 when `to` isn't after `from`): how long a lead time ran. */
export function workingDaysAfter(isWorking: (day: string) => boolean, from: string, to: string) {
  let count = 0;
  for (let day = addDays(from, 1); day <= to; day = addDays(day, 1)) if (isWorking(day)) count += 1;
  return count;
}

/**
 * One Furniture Only order's lead time: working days from its anchor (Won, or the drawing approval for a path counted
 * from it) to the day it reached the client, against the working days its path allows (its rule's longest lead time,
 * stretched to the catalogue's own time when the rule says so). On time when it reached the client by the last day.
 * No target when the path has no lead time (or the anchor isn't recorded).
 */
export function leadTime(isWorking: (day: string) => boolean, anchor: string | null, handed: string, expectedBy: string | null) {
  if (!anchor) return { actual: null, target: null, timing: "no_target" as const };
  const actual = workingDaysAfter(isWorking, anchor, handed);
  if (!expectedBy) return { actual, target: null, timing: "no_target" as const };
  return { actual, target: workingDaysAfter(isWorking, anchor, expectedBy), timing: handed <= expectedBy ? "on_time" as const : "late" as const };
}

/** On time ÷ (on time + late) × 100, one decimal; null when nothing with a lead time reached a client. */
export function leadTimeRate(facts: Fact[]) {
  const timed = facts.filter((fact) => fact.dims.timing === "on_time" || fact.dims.timing === "late");
  return timed.length ? percent(timed.filter((fact) => fact.dims.timing === "on_time").length, timed.length) : null;
}

/**
 * Furniture Only orders (deals on a furniture path, A–E) handed to the client in the period — collected for A, the
 * earlier of collection and delivery for C, else delivered (or collected) — not cancelled; each with its own path's
 * rule, the way the deal's fulfilment reads it.
 */
const FO_SQL = `WITH ${P}, ${OPPORTUNITIES},
fo AS (
  SELECT oc.opportunity_id, oc.case_id, oc.reference, oc.title, oc.client, oc.owner, oc.am, deal.furniture_path AS path,
         (SELECT min(ev.recorded_at) FROM crm_deal_fulfilment_events ev WHERE ev.workspace_id = p.ws AND ev.opportunity_id = oc.opportunity_id AND ev.event = 'collected') AS collected_at,
         (SELECT min(ev.recorded_at) FROM crm_deal_fulfilment_events ev WHERE ev.workspace_id = p.ws AND ev.opportunity_id = oc.opportunity_id AND ev.event = 'delivered') AS delivered_at
    FROM oc CROSS JOIN p JOIN crm_opportunities deal ON deal.workspace_id = p.ws AND deal.id = oc.opportunity_id
   WHERE deal.furniture_path IS NOT NULL AND oc.cancelled_at IS NULL AND ${OPPORTUNITY_ENTITY}
),
handed AS (
  SELECT fo.*, CASE fo.path WHEN 'take_home_now' THEN fo.collected_at WHEN 'supplier_order' THEN least(fo.collected_at, fo.delivered_at)
                            ELSE COALESCE(fo.delivered_at, fo.collected_at) END AS handed_at
    FROM fo
)
SELECT handed.opportunity_id::text AS id, handed.case_id::text AS "caseId", handed.reference, handed.title, handed.client, handed.owner, handed.am::text AS am,
       handed.path, handed.handed_at AS "handedAt"
  FROM handed CROSS JOIN p
 WHERE handed.handed_at >= p.from_at AND handed.handed_at < p.to_at
 ORDER BY handed.handed_at, handed.reference`;

const foLeadTime: KpiSpec = {
  code: "fo_lead_time",
  compare: "higher",
  facts: async (ctx) => {
    const rows = (await ctx.db.query<{ id: string; caseId: string | null; reference: string | null; title: string; client: string | null; owner: string | null; am: string | null;
      path: FurniturePath; handedAt: Date }>(FO_SQL, ctx.params)).rows;
    if (!rows.length) return [];
    const calendar = await readCalendar(ctx.db, ctx.workspaceId);
    const isWorking = workdays(calendar).isWorking;
    const day = (at: string | Date | null) => (at ? localDate(new Date(at), ctx.timeZone) : null);
    const facts: Fact[] = [];
    for (const row of rows) {
      const rule = await dealRule(ctx.db, ctx.workspaceId, row.id, { readOnly: true });
      if (!rule) continue;
      const known = await readFulfilmentFacts(ctx.db, ctx.workspaceId, rule);
      const anchor = day(rule.leadFrom === "drawing_approved" ? known.production.drawingApprovedAt : known.wonAt);
      const handed = day(row.handedAt)!;
      const window = anchor ? expectedWindow(rule, anchor, known.catalogueDays, calendar) : null;
      const time = leadTime(isWorking, anchor, handed, window?.by ?? null);
      facts.push({
        id: row.id, kind: "opportunity", parentId: row.caseId, reference: row.reference, title: row.title, client: row.client, owner: row.owner, ownerId: row.am,
        at: row.handedAt.toISOString(), amount: null, measure: time.actual === null ? null : String(time.actual), detail: row.path,
        dims: { period: "1", path: row.path, timing: time.timing, ...(time.target === null ? {} : { target: String(time.target) }) },
      });
    }
    return facts;
  },
  build: (ctx, facts) => {
    const rate = leadTimeRate(facts);
    const items = FURNITURE_PATHS.map((path) => {
      const group = facts.filter((fact) => fact.dims.path === path);
      const measured = group.filter((fact) => fact.measure !== null);
      const targets = group.filter((fact) => fact.dims.target !== undefined);
      return { key: path, label: "", value: mean(measured.map((fact) => fact.measure!), 1) ?? "0", count: group.length,
        extra: { target: mean(targets.map((fact) => fact.dims.target), 1), onTime: leadTimeRate(group) } };
    });
    return {
      code: "fo_lead_time", unit: "percent", value: rate, count: facts.length, targetable: true, ...targetFor(ctx.targets, "fo_lead_time_rate", ctx.filters, rate),
      extra: { onTime: facts.filter((fact) => fact.dims.timing === "on_time").length, late: facts.filter((fact) => fact.dims.timing === "late").length,
        noTarget: facts.filter((fact) => fact.dims.timing === "no_target").length },
      chart: { type: "bars", dimension: "path", unit: "days", items },
    };
  },
};

// ------------------------------------------------------------------ needs attention

/**
 * Needs attention, live: what is late or about to block delivery, most days late first — work orders past their
 * planned end, work orders waiting on materials, installations past their day, permits expired or expiring within a
 * week, and handovers past their promised date. One line per thing; each opens its record.
 */
export async function productionAttention(ctx: ReportContext): Promise<Fact[]> {
  const late = (await lateOrders.facts(ctx)).map((fact) => ({ ...fact, detail: "late_work_order", dims: { ...fact.dims, reason: "late_work_order" } }));
  const waiting = (await shortages.facts(ctx)).map((fact) => ({ ...fact, measure: null, detail: "materials", dims: { ...fact.dims, reason: "materials" } }));
  const installing = (await installations.facts(ctx)).filter((fact) => fact.dims.when === "late")
    .map((fact) => ({ ...fact, measure: String(-Number(fact.measure ?? "0")), detail: "late_installation", dims: { ...fact.dims, reason: "late_installation" } }));
  const permitted = (await permits.facts(ctx)).filter((fact) => fact.dims.expiry !== "within_30")
    .map((fact) => ({ ...fact, measure: String(-Number(fact.measure ?? "0")), detail: fact.dims.expiry === "expired" ? "permit_expired" : "permit_expiring",
      dims: { ...fact.dims, reason: fact.dims.expiry === "expired" ? "permit_expired" : "permit_expiring" } }));
  const handing = (await handovers.facts(ctx)).filter((fact) => fact.dims.due === "overdue")
    .map((fact) => ({ ...fact, kind: "project" as const, measure: String(-Number(fact.measure ?? "0")), detail: "late_handover", dims: { ...fact.dims, reason: "late_handover" } }));
  return byUrgency([...late, ...waiting, ...installing, ...permitted, ...handing]);
}

const attention: KpiSpec = {
  code: "production_attention",
  facts: productionAttention,
  build: (_ctx, facts) => ({ code: "production_attention", unit: "count", value: String(facts.length), count: facts.length, targetable: false, chart: { type: "list", bucket: "period=1" } }),
};

export const PRODUCTION_DELIVERY: KpiSpec[] = [lateOrders, readyUpcoming, openSnags, foLeadTime, workOrderStatus, bookings, attention, made, onTime, delivered, installed,
  factoryLoad, shortages, deliveries, installations, permits, projectStages, handovers];
