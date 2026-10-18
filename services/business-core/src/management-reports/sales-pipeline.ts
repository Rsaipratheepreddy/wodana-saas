import { type KpiSpec, type ReportContext, moneyNotes, readFacts } from "./report-context";
import { type Fact, FACT_COLUMNS, byUrgency, categories, grid, groupBy, inPeriod, monthKeys, percent, sum } from "./report-kit";
import { LEADS, OPPORTUNITIES, OPPORTUNITY_ENTITY, P, dealCancelledAt, localDate, month, moneyDims, netMoney, netRatio } from "./report-scope";
import { targetFor } from "./report-targets";
import { WON_SQL } from "./owner-overview";

/** Dashboard 2 · Sales and pipeline (PLM-104). Every definition here is also written in the master plan (§6.27a). */

const PERIOD = (at: string) => `CASE WHEN ${at} >= p.from_at AND ${at} < p.to_at THEN '1' ELSE '0' END`;
/** Open enquiry statuses (the lead still needs work). */
const OPEN_LEAD = `('new', 'attempting_contact', 'connected', 'nurturing', 'paused')`;

/**
 * New leads: enquiries created in the period (local days), spam and duplicates of an open enquiry left out (they are
 * counted under Duplicates). The trend stacks the last 12 months by source; the five biggest sources over those
 * months are their own series, the rest are "Other".
 */
export const NEW_LEADS_SQL = `WITH ${P}, ${LEADS}
SELECT ${FACT_COLUMNS} FROM (
  SELECT lc.lead_id::text AS id, 'lead' AS kind, NULL::text AS parent_id, lc.reference, lc.title, lc.client, lc.owner, lc.am::text AS owner_id,
         lc.created_at AS at, NULL::text AS amount, NULL::text AS measure, lc.source || ' / ' || lc.channel AS detail,
         jsonb_build_object('period', ${PERIOD("lc.created_at")}, 'month', ${month("lc.created_at")}, 'source', lc.source, 'channel', lc.channel, 'type', COALESCE(lc.enquiry_type, 'none')) AS dims
    FROM lc CROSS JOIN p WHERE lc.status <> 'duplicate' AND lc.created_at >= p.series_from_at AND lc.created_at < p.to_at
) facts ORDER BY at DESC`;

/** The five biggest sources keep their own series; the rest become "other" (stable for the chart and its drill-down). */
export function groupSources(facts: Fact[], keep = 5) {
  const counts = new Map<string, number>();
  for (const fact of facts) counts.set(fact.dims.source, (counts.get(fact.dims.source) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, keep).map(([source]) => source);
  for (const fact of facts) fact.dims.sourceGroup = top.includes(fact.dims.source) ? fact.dims.source : "other";
  return { top, hasOther: facts.some((fact) => fact.dims.sourceGroup === "other") };
}

const newLeads: KpiSpec = {
  code: "new_leads",
  compare: "higher",
  facts: async (ctx) => { const facts = await readFacts(ctx, NEW_LEADS_SQL); groupSources(facts); return facts; },
  build: (ctx, facts) => {
    const period = facts.filter(inPeriod);
    const { top, hasOther } = groupSources(facts);
    const keys = monthKeys(ctx.filters);
    const series = [...top.map((source) => ({ id: source, label: ctx.labels.sources.get(source) ?? source })), ...(hasOther ? [{ id: "other", label: "Other" }] : [])];
    return {
      code: "new_leads", unit: "count", value: String(period.length), count: period.length, targetable: true,
      ...targetFor(ctx.targets, "new_leads", ctx.filters, String(period.length)),
      chart: { type: "columns", dimension: "month", seriesDimension: "sourceGroup", categories: categories(keys), series, values: grid(facts, "month", keys, series, "sourceGroup", "count", ctx.places), unit: "count" },
    };
  },
};

/**
 * Conversion funnel: the enquiries created in the period (as New leads) and how far each got, as of now:
 *   Opportunity — it became an opportunity;
 *   Qualified — the opportunity reached the Qualified stage (stage code `qualification`) or any later one, or was won;
 *   Proposal — it reached the Proposal stage (code `proposal`) or a later one (Negotiation, Won), or was won;
 *   Won — a payment proof was attached (a proposal or the opportunity is Won), and the deal wasn't cancelled.
 * Each step's % is of the step before; Lead → Won % is Won ÷ leads.
 */
const reached = (codes: string) => `(o.status = 'won' OR EXISTS (SELECT 1 FROM crm_stage_history h JOIN crm_pipeline_stages s ON s.workspace_id = h.workspace_id AND s.id = h.to_stage_id
    WHERE h.workspace_id = o.workspace_id AND h.opportunity_id = o.id AND s.code IN ${codes})
  OR EXISTS (SELECT 1 FROM crm_pipeline_stages s WHERE s.workspace_id = o.workspace_id AND s.id = o.stage_id AND s.code IN ${codes}))`;
export const FUNNEL_SQL = `WITH ${P}, ${LEADS}
SELECT ${FACT_COLUMNS} FROM (
  SELECT lc.lead_id::text AS id, 'lead' AS kind, NULL::text AS parent_id, lc.reference, lc.title, lc.client, lc.owner, lc.am::text AS owner_id,
         lc.created_at AS at, NULL::text AS amount, NULL::text AS measure, o.status::text AS detail,
         jsonb_build_object('period', '1', 'lead', '1', 'source', lc.source, 'channel', lc.channel,
           'opportunity', CASE WHEN o.id IS NOT NULL THEN '1' ELSE '0' END,
           'qualified', CASE WHEN o.id IS NOT NULL AND ${reached("('qualification', 'proposal', 'negotiation', 'won')")} THEN '1' ELSE '0' END,
           'proposal', CASE WHEN o.id IS NOT NULL AND ${reached("('proposal', 'negotiation', 'won')")} THEN '1' ELSE '0' END,
           'won', CASE WHEN (o.status = 'won' OR EXISTS (SELECT 1 FROM crm_opportunity_proposals pr WHERE pr.workspace_id = o.workspace_id AND pr.opportunity_id = o.id AND pr.won_at IS NOT NULL))
                         AND ${dealCancelledAt("o", "pc")} IS NULL THEN '1' ELSE '0' END) AS dims
    FROM lc CROSS JOIN p
    LEFT JOIN crm_opportunities o ON o.workspace_id = p.ws AND o.id = lc.opportunity_id
    LEFT JOIN LATERAL (SELECT c.status, c.cancelled_at FROM pre_project_cases c WHERE c.workspace_id = p.ws AND c.opportunity_id = o.id ORDER BY c.created_at LIMIT 1) pc ON true
   WHERE lc.status <> 'duplicate' AND lc.created_at >= p.from_at AND lc.created_at < p.to_at
) facts ORDER BY at DESC`;

export const FUNNEL_STEPS = ["lead", "opportunity", "qualified", "proposal", "won"] as const;

const conversion: KpiSpec = {
  code: "conversion_funnel",
  compare: "higher",
  facts: (ctx) => readFacts(ctx, FUNNEL_SQL),
  build: (ctx, facts) => {
    const counts = FUNNEL_STEPS.map((step) => facts.filter((fact) => fact.dims[step] === "1").length);
    const rate = facts.length ? percent(counts[4], counts[0]) : null;
    return {
      code: "conversion_funnel", unit: "percent", value: rate, count: facts.length, targetable: true,
      ...targetFor(ctx.targets, "lead_to_won_rate", ctx.filters, rate),
      chart: { type: "funnel", dimension: "step", items: FUNNEL_STEPS.map((step, index) => ({
        key: step, label: step, value: String(counts[index]), rate: index === 0 ? null : percent(counts[index], counts[index - 1]),
      })) },
    };
  },
};

/**
 * Pipeline value, live (not bound to the period): open opportunities by their current stage, count and value. The
 * value is the opportunity's value net of tax by its latest live quotation; one without a quotation keeps the value
 * as entered (counted apart).
 */
const PIPELINE_SQL = `WITH ${P}, ${OPPORTUNITIES}
SELECT ${FACT_COLUMNS} FROM (
  SELECT oc.opportunity_id::text AS id, 'opportunity' AS kind, oc.case_id::text AS parent_id, oc.reference, oc.title, oc.client, oc.owner, oc.am::text AS owner_id,
         oc.created_at AS at, ${netMoney("oc.amount", "oc.currency_code", "ratio.value")} AS amount, NULL::text AS measure, stage.name AS detail,
         jsonb_build_object('period', '1', 'stage', oc.stage_id::text, 'position', lpad(COALESCE(stage.position, 0)::text, 4, '0'), ${moneyDims("oc.currency_code", "ratio.value")}) AS dims
    FROM oc CROSS JOIN p
    LEFT JOIN crm_pipeline_stages stage ON stage.workspace_id = p.ws AND stage.id = oc.stage_id
    LEFT JOIN LATERAL (SELECT ${netRatio("q")} AS value FROM commercial_quotes q WHERE q.workspace_id = p.ws AND q.case_id = oc.case_id AND q.kind = 'quotation'
                        AND q.status NOT IN ('superseded', 'withdrawn') ORDER BY q.updated_at DESC LIMIT 1) ratio ON true
   WHERE oc.status = 'open' AND ${OPPORTUNITY_ENTITY}
) facts ORDER BY at DESC`;

const pipeline: KpiSpec = {
  code: "pipeline_value",
  facts: (ctx) => readFacts(ctx, PIPELINE_SQL),
  build: (ctx, facts) => {
    const amount = sum(facts.map((fact) => fact.amount)).toFixed(ctx.places);
    const groups = groupBy(facts, "stage", (fact) => fact.detail ?? "", ctx.places)
      .sort((a, b) => (a.facts[0].dims.position ?? "").localeCompare(b.facts[0].dims.position ?? ""));
    return {
      code: "pipeline_value", unit: "money", value: amount, count: facts.length, amount, targetable: false,
      chart: { type: "bars", dimension: "stage", unit: "money", items: groups.map((group) => ({ key: group.key, label: group.label, value: group.amountText, count: group.count, amount: group.amountText })) },
      notes: moneyNotes(facts),
    };
  },
};

/**
 * Won by Account Manager: the period's Sales Won (as on the Owner overview) by the opportunity's owner — count, value
 * and average deal size (value ÷ count) — ranked by value, each against that person's Won value target.
 */
const wonByAccountManager: KpiSpec = {
  code: "won_by_account_manager",
  facts: async (ctx) => (await readFacts(ctx, WON_SQL)).filter(inPeriod),
  build: (ctx, facts) => {
    const groups = groupBy(facts, "am", (fact) => fact.owner ?? "", ctx.places).sort((a, b) => b.amount.cmp(a.amount) || b.count - a.count);
    const amount = sum(facts.map((fact) => fact.amount));
    return {
      code: "won_by_account_manager", unit: "money", value: amount.toFixed(ctx.places), count: facts.length, targetable: true,
      extra: { average: facts.length ? amount.div(facts.length).toFixed(ctx.places) : null },
      chart: { type: "bars", dimension: "am", unit: "money", items: groups.map((group) => ({
        key: group.key, label: group.label, value: group.amountText, count: group.count,
        amount: group.count ? group.amount.div(group.count).toFixed(ctx.places) : null,
        target: group.key === "none" ? null : targetFor(ctx.targets, "sales_won_value", { ...ctx.filters, accountManager: group.key }, group.amountText, group.key).target ?? null,
      })) },
      notes: moneyNotes(facts),
    };
  },
};

/**
 * Lost: opportunities marked Lost in the period (closed date), count and value (net of tax by their latest quotation,
 * else as entered), by the reason recorded when they were lost. Lost opportunities only: enquiries closed as not
 * interested are their own figure, and a won deal that was cancelled is under Cancellations and refunds.
 */
const LOST_SQL = `WITH ${P}, ${OPPORTUNITIES}
SELECT ${FACT_COLUMNS} FROM (
  SELECT oc.opportunity_id::text AS id, 'opportunity' AS kind, oc.case_id::text AS parent_id, oc.reference, oc.title, oc.client, oc.owner, oc.am::text AS owner_id,
         oc.closed_at AS at, ${netMoney("oc.amount", "oc.currency_code", "ratio.value")} AS amount, NULL::text AS measure, NULLIF(btrim(oc.outcome_reason), '') AS detail,
         jsonb_build_object('period', '1', 'reason', COALESCE(lower(NULLIF(btrim(oc.outcome_reason), '')), 'none'), ${moneyDims("oc.currency_code", "ratio.value")}) AS dims
    FROM oc CROSS JOIN p
    LEFT JOIN LATERAL (SELECT ${netRatio("q")} AS value FROM commercial_quotes q WHERE q.workspace_id = p.ws AND q.case_id = oc.case_id AND q.kind = 'quotation'
                        AND q.status NOT IN ('superseded', 'withdrawn') ORDER BY q.updated_at DESC LIMIT 1) ratio ON true
   WHERE oc.status = 'lost' AND oc.cancelled_at IS NULL AND oc.closed_at >= p.from_at AND oc.closed_at < p.to_at AND ${OPPORTUNITY_ENTITY}
) facts ORDER BY at DESC`;

const lost: KpiSpec = {
  code: "lost",
  compare: "lower",
  facts: (ctx) => readFacts(ctx, LOST_SQL),
  build: (ctx, facts) => {
    const groups = groupBy(facts, "reason", (fact) => fact.detail ?? "", ctx.places).sort((a, b) => b.count - a.count || b.amount.cmp(a.amount));
    return {
      code: "lost", unit: "count", value: String(facts.length), count: facts.length, amount: sum(facts.map((fact) => fact.amount)).toFixed(ctx.places), targetable: false,
      chart: { type: "bars", dimension: "reason", unit: "count", items: groups.map((group) => ({ key: group.key, label: group.label, value: String(group.count), count: group.count, amount: group.amountText })) },
      notes: moneyNotes(facts),
    };
  },
};

/**
 * Not interested enquiries: enquiries closed (disqualified) in the period before becoming an opportunity — the client
 * wasn't interested, couldn't be reached, or another reason — by the reason recorded when they were closed. Spam and
 * duplicates are left out (they are never disqualified).
 */
const NOT_INTERESTED_SQL = `WITH ${P}, ${LEADS}
SELECT ${FACT_COLUMNS} FROM (
  SELECT lc.lead_id::text AS id, 'lead' AS kind, NULL::text AS parent_id, lc.reference, lc.title, lc.client, lc.owner, lc.am::text AS owner_id,
         lc.closed_at AS at, NULL::text AS amount, NULL::text AS measure, NULLIF(btrim(lc.disqualification_reason), '') AS detail,
         jsonb_build_object('period', '1', 'reason', COALESCE(lower(NULLIF(btrim(lc.disqualification_reason), '')), 'none')) AS dims
    FROM lc CROSS JOIN p
   WHERE lc.status = 'disqualified' AND lc.opportunity_id IS NULL AND lc.closed_at >= p.from_at AND lc.closed_at < p.to_at
) facts ORDER BY at DESC`;

/**
 * Guide K: Proposal 2 withdrawn: deals whose client withdrew from the main quotation, confirmed in the period, with
 * the reason given. Their own list: neither Lost nor counted as Won (the design deal completes at design handover).
 */
const WITHDRAWN_SQL = `WITH ${P}, ${OPPORTUNITIES}
SELECT ${FACT_COLUMNS} FROM (
  SELECT oc.opportunity_id::text AS id, 'opportunity' AS kind, oc.case_id::text AS parent_id, oc.reference, oc.title, oc.client, oc.owner, oc.am::text AS owner_id,
         proposal.withdrawal_decided_at AS at, NULL::text AS amount, NULL::text AS measure, NULLIF(btrim(proposal.withdrawal_reason), '') AS detail,
         jsonb_build_object('period', '1', 'reason', COALESCE(lower(NULLIF(btrim(proposal.withdrawal_reason), '')), 'none')) AS dims
    FROM oc CROSS JOIN p
    JOIN crm_opportunity_proposals proposal ON proposal.workspace_id = p.ws AND proposal.opportunity_id = oc.opportunity_id AND proposal.kind = 'main'
   WHERE proposal.withdrawal_status = 'confirmed' AND proposal.withdrawal_decided_at >= p.from_at AND proposal.withdrawal_decided_at < p.to_at AND ${OPPORTUNITY_ENTITY}
) facts ORDER BY at DESC`;

const withdrawnQ2: KpiSpec = {
  code: "withdrawn_q2",
  compare: "lower",
  facts: (ctx) => readFacts(ctx, WITHDRAWN_SQL),
  build: (ctx, facts) => {
    const groups = groupBy(facts, "reason", (fact) => fact.detail ?? "", ctx.places).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    return {
      code: "withdrawn_q2", unit: "count", value: String(facts.length), count: facts.length, targetable: false,
      chart: { type: "bars", dimension: "reason", unit: "count", items: groups.map((group) => ({ key: group.key, label: group.label, value: String(group.count), count: group.count })) },
    };
  },
};

const notInterested: KpiSpec = {
  code: "not_interested",
  facts: (ctx) => readFacts(ctx, NOT_INTERESTED_SQL),
  build: (ctx, facts) => {
    const groups = groupBy(facts, "reason", (fact) => fact.detail ?? "", ctx.places).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    return {
      code: "not_interested", unit: "count", value: String(facts.length), count: facts.length, targetable: false,
      chart: { type: "bars", dimension: "reason", unit: "count", items: groups.map((group) => ({ key: group.key, label: group.label, value: String(group.count), count: group.count })) },
    };
  },
};

/**
 * Duplicates: enquiries created in the period that the duplicate rule (PLM-093) marked as a duplicate of an open one.
 * Returning customers: enquiries created in the period from someone with an earlier enquiry and none open (PLM-037),
 * recorded under the returning-customer source with the source they really came in on.
 */
const REPEAT_SQL = `WITH ${P}, ${LEADS}
SELECT ${FACT_COLUMNS} FROM (
  SELECT lc.lead_id::text AS id, 'lead' AS kind, NULL::text AS parent_id, lc.reference, lc.title, lc.client, lc.owner, lc.am::text AS owner_id,
         lc.created_at AS at, NULL::text AS amount, NULL::text AS measure, CASE WHEN lc.status = 'duplicate' THEN 'duplicate' ELSE 'returning' END AS detail,
         jsonb_build_object('period', '1', 'repeat', CASE WHEN lc.status = 'duplicate' THEN 'duplicate' ELSE 'returning' END) AS dims
    FROM lc CROSS JOIN p
   WHERE lc.created_at >= p.from_at AND lc.created_at < p.to_at
     AND (lc.status = 'duplicate' OR lc.source = 'returning_customer' OR lc.original_source IS NOT NULL)
) facts ORDER BY at DESC`;

const repeatKpi = (code: "duplicates" | "returning_customers", repeat: string): KpiSpec => ({
  code,
  facts: async (ctx) => (await readFacts(ctx, REPEAT_SQL)).filter((fact) => fact.dims.repeat === repeat),
  build: (_ctx, facts) => ({ code, unit: "count", value: String(facts.length), count: facts.length, targetable: false, chart: { type: "list", bucket: "period=1" } }),
});

/**
 * Follow-ups due / overdue, live:
 *   an open enquiry whose last logged contact was "come back later" / needs time to think (its come-back date);
 *   an open opportunity's next follow-up (a pending call, message or task marked as the next action; meetings are not
 *     follow-ups).
 * Overdue when the date has passed; otherwise due, soonest first.
 */
const FOLLOW_UPS_SQL = `WITH ${P}, ${LEADS}, ${OPPORTUNITIES}
SELECT ${FACT_COLUMNS} FROM (
  SELECT lc.lead_id::text AS id, 'lead' AS kind, NULL::text AS parent_id, lc.reference, lc.title, lc.client, lc.owner, lc.am::text AS owner_id,
         lc.next_action_at AS at, NULL::text AS amount, NULL::text AS measure, last_contact.note AS detail,
         jsonb_build_object('period', '1', 'state', CASE WHEN lc.next_action_at < p.now_at THEN 'overdue' ELSE 'due' END, 'source', 'enquiry') AS dims
    FROM lc CROSS JOIN p
    JOIN LATERAL (SELECT a.completion_outcome, COALESCE(NULLIF(btrim(a.description), ''), a.title) AS note FROM crm_activities a
                   WHERE a.workspace_id = p.ws AND a.lead_id = lc.lead_id AND a.status = 'completed'
                     AND a.completion_outcome IN ('no_answer', 'message_sent_no_reply', 'willing_to_talk', 'come_back_later', 'not_interested', 'unreachable')
                   ORDER BY a.completed_at DESC NULLS LAST, a.id DESC LIMIT 1) last_contact ON last_contact.completion_outcome = 'come_back_later'
   WHERE lc.status IN ${OPEN_LEAD} AND lc.next_action_at IS NOT NULL AND lc.opportunity_id IS NULL
  UNION ALL
  SELECT oc.opportunity_id::text, 'opportunity', oc.case_id::text, oc.reference, oc.title, oc.client, COALESCE(NULLIF(btrim(owner_user.display_name), ''), owner_user.primary_email, oc.owner),
         COALESCE(a.owner_membership_id, oc.am)::text, a.due_at, NULL, NULL, a.title,
         jsonb_build_object('period', '1', 'state', CASE WHEN a.due_at < p.now_at THEN 'overdue' ELSE 'due' END, 'source', 'opportunity')
    FROM oc CROSS JOIN p
    JOIN crm_activities a ON a.workspace_id = p.ws AND a.opportunity_id = oc.opportunity_id AND a.status = 'pending' AND a.is_next_action AND a.due_at IS NOT NULL AND a.type <> 'meeting'
    LEFT JOIN workspace_memberships owner_member ON owner_member.workspace_id = p.ws AND owner_member.id = a.owner_membership_id
    LEFT JOIN users owner_user ON owner_user.id = owner_member.user_id
   WHERE oc.status = 'open' AND ${OPPORTUNITY_ENTITY}
) facts ORDER BY at`;

const followUps: KpiSpec = {
  code: "follow_ups",
  facts: (ctx) => readFacts(ctx, FOLLOW_UPS_SQL),
  build: (_ctx, facts) => ({
    code: "follow_ups", unit: "count", value: String(facts.length), count: facts.length, targetable: false,
    extra: { overdue: facts.filter((fact) => fact.dims.state === "overdue").length, due: facts.filter((fact) => fact.dims.state === "due").length },
    chart: { type: "list", bucket: "period=1" },
  }),
};

/**
 * Quotes expiring: quotations sent to the client and still awaiting their decision whose validity ends between today
 * and the workspace's expiry-warning window (Settings › Quotations, 3 days by default), on live jobs. Value net of tax.
 */
const EXPIRING_SQL = `WITH ${P}, ${OPPORTUNITIES}
SELECT ${FACT_COLUMNS} FROM (
  SELECT q.id AS id, 'quote' AS kind, q.case_id::text AS parent_id, oc.reference, q.title, oc.client, oc.owner, oc.am::text AS owner_id,
         (q.valid_until::timestamp AT TIME ZONE p.tz) AS at, ${netMoney("q.total", "q.currency", netRatio("q"))} AS amount, (q.valid_until - p.today)::text AS measure,
         COALESCE(q.round, 'main') AS detail, jsonb_build_object('period', '1', 'currency', CASE WHEN btrim(q.currency) = p.currency THEN 'base' ELSE 'other' END, 'tax', 'net') AS dims
    FROM commercial_quotes q CROSS JOIN p
    JOIN oc ON oc.case_id = q.case_id
    LEFT JOIN workspace_quotation_settings settings ON settings.workspace_id = p.ws
   WHERE q.workspace_id = p.ws AND q.kind = 'quotation' AND q.status = 'issued' AND oc.case_status <> 'cancelled'
     AND q.valid_until >= p.today AND q.valid_until <= p.today + COALESCE(settings.expiry_warning_days, 3) AND ${OPPORTUNITY_ENTITY}
) facts ORDER BY at`;

const quotesExpiring: KpiSpec = {
  code: "quotes_expiring",
  facts: (ctx) => readFacts(ctx, EXPIRING_SQL),
  build: (ctx, facts) => ({
    code: "quotes_expiring", unit: "count", value: String(facts.length), count: facts.length, amount: sum(facts.map((fact) => fact.amount)).toFixed(ctx.places),
    targetable: false, chart: { type: "list", bucket: "period=1" }, notes: moneyNotes(facts),
  }),
};

/**
 * Stuck deals, live: open opportunities whose stage hasn't changed (their last stage change, else when they were
 * opened) for the firm's Sales rule (Settings › Sales, 14 days unless changed), longest first; days are local.
 */
const STUCK_SQL = `WITH ${P}, ${OPPORTUNITIES},
rule AS (SELECT COALESCE((SELECT settings.stuck_deal_days FROM workspace_sales_settings settings WHERE settings.workspace_id = p.ws), 14) AS days FROM p)
SELECT ${FACT_COLUMNS} FROM (
  SELECT oc.opportunity_id::text AS id, 'opportunity' AS kind, oc.case_id::text AS parent_id, oc.reference, oc.title, oc.client, oc.owner, oc.am::text AS owner_id,
         moved.at, NULL::text AS amount, (p.today - (moved.at AT TIME ZONE p.tz)::date)::text AS measure, 'stuck_deal' AS detail,
         jsonb_build_object('period', '1', 'reason', 'stuck_deal') AS dims
    FROM oc CROSS JOIN p CROSS JOIN rule
    CROSS JOIN LATERAL (SELECT COALESCE((SELECT max(history.changed_at) FROM crm_stage_history history
                                          WHERE history.workspace_id = p.ws AND history.opportunity_id = oc.opportunity_id), oc.created_at) AS at) moved
   WHERE oc.status = 'open' AND ${OPPORTUNITY_ENTITY} AND p.today - (moved.at AT TIME ZONE p.tz)::date >= rule.days
) facts ORDER BY at`;

const stuck: KpiSpec = {
  code: "stuck_deals",
  facts: (ctx) => readFacts(ctx, STUCK_SQL),
  build: (_ctx, facts) => ({ code: "stuck_deals", unit: "count", value: String(facts.length), count: facts.length, targetable: false, chart: { type: "list", bucket: "period=1" } }),
};

const dayOf = (at: string, timeZone: string) => Date.parse(`${localDate(new Date(at), timeZone)}T00:00:00Z`);

/**
 * Needs attention on Sales, live, most days first: follow-ups past their date (days overdue) and stuck deals (days
 * without a stage change). Each opens its enquiry or opportunity.
 */
export async function salesAttention(ctx: ReportContext): Promise<Fact[]> {
  const today = dayOf(ctx.now.toISOString(), ctx.timeZone);
  const late = (await followUps.facts(ctx)).filter((fact) => fact.dims.state === "overdue" && fact.at)
    .map((fact) => ({ ...fact, measure: String(Math.round((today - dayOf(fact.at!, ctx.timeZone)) / 86_400_000)), detail: "follow_up_overdue",
      dims: { ...fact.dims, reason: "follow_up_overdue" } }));
  return byUrgency([...late, ...(await stuck.facts(ctx))]);
}

const attention: KpiSpec = {
  code: "sales_attention",
  facts: salesAttention,
  build: (_ctx, facts) => ({ code: "sales_attention", unit: "count", value: String(facts.length), count: facts.length, targetable: false, chart: { type: "list", bucket: "period=1" } }),
};

export const SALES_PIPELINE: KpiSpec[] = [attention, stuck, newLeads, conversion, pipeline, wonByAccountManager, lost, withdrawnQ2, notInterested, repeatKpi("duplicates", "duplicate"),
  repeatKpi("returning_customers", "returning"), followUps, quotesExpiring];

