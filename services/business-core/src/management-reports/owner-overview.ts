import type { FurniturePath } from "../crm/opportunities/flow-gates";
import { readDealClosing } from "./deal-closing-read";
import { type ReportContext, type KpiSpec, moneyNotes, readFacts } from "./report-context";
import { type Fact, FACT_COLUMNS, categories, grid, groupBy, inPeriod, monthKeys, sum } from "./report-kit";
import { NO_SALES_FILTERS, OPPORTUNITIES, OPPORTUNITY_ENTITY, P, month, moneyDims, netMoney, netRatio, stamp } from "./report-scope";
import { targetFor } from "./report-targets";

/**
 * Dashboard 1 · Owner overview (PLM-105). Every definition here is also written in the master plan (§6.27a).
 */

/** In the chosen period (1) or only in the 12-month trend (0). */
const PERIOD = (at: string) => `CASE WHEN ${at} >= p.from_at AND ${at} < p.to_at THEN '1' ELSE '0' END`;

/** The share before tax of a proposal's value: its own quotation, else the case's accepted quotation of that round. */
export const proposalRatio = (kind: string, quoteId: string, caseId: string) => `(SELECT ${netRatio("q")} FROM commercial_quotes q
  WHERE q.workspace_id = p.ws AND q.case_id = ${caseId} AND q.kind = 'quotation'
    AND (q.id = ${quoteId}::text OR (q.status = 'accepted' AND COALESCE(q.round, 'main') = ${kind}))
  ORDER BY (q.id = ${quoteId}::text) IS TRUE DESC, q.updated_at DESC LIMIT 1)`;

/**
 * Sales Won: proposals whose payment proof was attached (Won, PLM-122) — Proposal 1 (Design Fee) and Proposal 2 (main)
 * each count once, on its own Won date (PLM-103/009). A deal won before proposals existed counts as Proposal 2 on the
 * opportunity's Won date with its value. Value = the proposal's value net of tax (its quotation's tax share), base
 * currency only. Count = proposals won. A cancelled deal is never Won: it stays recorded and is reported under
 * Cancellations and refunds.
 */
export const WON_SQL = `WITH ${P}, ${OPPORTUNITIES},
won AS (
  SELECT oc.opportunity_id, pr.kind AS series, pr.won_at AS at, pr.amount, pr.currency_code AS cur, ${proposalRatio("pr.kind", "pr.quote_id", "oc.case_id")} AS ratio
    FROM crm_opportunity_proposals pr CROSS JOIN p JOIN oc ON oc.opportunity_id = pr.opportunity_id
   WHERE pr.workspace_id = p.ws AND pr.won_at >= p.series_from_at AND pr.won_at < p.to_at AND oc.cancelled_at IS NULL AND ${OPPORTUNITY_ENTITY}
  UNION ALL
  SELECT oc.opportunity_id, 'main', oc.closed_at, oc.amount, oc.currency_code, ${proposalRatio("'main'", "NULL::uuid", "oc.case_id")}
    FROM oc CROSS JOIN p
   WHERE oc.status = 'won' AND oc.closed_at >= p.series_from_at AND oc.closed_at < p.to_at AND oc.cancelled_at IS NULL AND ${OPPORTUNITY_ENTITY}
     AND NOT EXISTS (SELECT 1 FROM crm_opportunity_proposals pr WHERE pr.workspace_id = p.ws AND pr.opportunity_id = oc.opportunity_id AND pr.won_at IS NOT NULL)
)
SELECT ${FACT_COLUMNS} FROM (
  SELECT oc.opportunity_id::text AS id, 'opportunity' AS kind, oc.case_id::text AS parent_id, oc.reference, oc.title, oc.client, oc.owner, oc.am::text AS owner_id,
         won.at, ${netMoney("won.amount", "won.cur", "won.ratio")} AS amount, NULL::text AS measure, won.series AS detail,
         jsonb_build_object('period', ${PERIOD("won.at")}, 'month', ${month("won.at")}, 'series', won.series, 'am', COALESCE(oc.am::text, 'none'),
           ${moneyDims("won.cur", "won.ratio")}) AS dims
    FROM won CROSS JOIN p JOIN oc ON oc.opportunity_id = won.opportunity_id
) facts ORDER BY at DESC`;

const salesWon: KpiSpec = {
  code: "sales_won",
  compare: "higher",
  facts: (ctx) => readFacts(ctx, WON_SQL),
  build: (ctx, facts) => {
    const period = facts.filter(inPeriod);
    const amount = sum(period.map((fact) => fact.amount)).toFixed(ctx.places);
    const keys = monthKeys(ctx.filters);
    const series = [{ id: "design", label: "Design Fee" }, { id: "main", label: "Proposal 2" }];
    return {
      code: "sales_won", unit: "money", value: amount, count: period.length, amount, targetable: true,
      ...targetFor(ctx.targets, "sales_won_value", ctx.filters, amount),
      extra: {
        count: period.length, designCount: period.filter((fact) => fact.dims.series === "design").length,
        mainCount: period.filter((fact) => fact.dims.series === "main").length,
        designValue: sum(period.filter((fact) => fact.dims.series === "design").map((fact) => fact.amount)).toFixed(ctx.places),
        mainValue: sum(period.filter((fact) => fact.dims.series === "main").map((fact) => fact.amount)).toFixed(ctx.places),
        ...countTarget(ctx, "sales_won_count", period.length),
      },
      chart: { type: "columns", dimension: "month", seriesDimension: "series", categories: categories(keys), series, values: grid(facts, "month", keys, series, "series", "amount", ctx.places), unit: "money" },
      notes: moneyNotes(facts),
    };
  },
};

/** A count KPI's target next to a money one (Won count beside Won value). */
function countTarget(ctx: ReportContext, code: string, count: number): Record<string, string | null> {
  const result = targetFor(ctx.targets, code, ctx.filters, String(count));
  return result.target ? { countTarget: result.target.target, countPercent: result.target.percent, countTone: result.target.tone, countGap: result.target.gap } : {};
}

/** Client receipts Finance verified, net of tax by their payment stage's quotation (Revenue collected and Net revenue). */
const RECEIPT_CTE = `receipt AS (
  SELECT r.id, r.case_id, r.amount, r.currency AS cur, ${stamp("COALESCE(NULLIF(r.detail->>'verifiedAt', ''), r.detail->>'reportedAt')")} AS at,
         (SELECT ${netRatio("q")} FROM commercial_payments pay JOIN commercial_quotes q ON q.workspace_id = pay.workspace_id AND q.case_id = pay.case_id AND q.id = pay.source_quote_id
           WHERE pay.workspace_id = r.workspace_id AND pay.case_id = r.case_id AND pay.id = r.payment_id) AS ratio,
         c.opportunity_id
    FROM commercial_receipts r CROSS JOIN p
    JOIN pre_project_cases c ON c.workspace_id = r.workspace_id AND c.id = r.case_id
   WHERE r.workspace_id = p.ws AND r.status = 'finance_verified' AND (p.entity_id IS NULL OR r.legal_entity_id = p.entity_id::text)
)`;
const RECEIPT_FACTS = `SELECT receipt.id AS id, 'receipt' AS kind, receipt.case_id::text AS parent_id, oc.reference, oc.title, oc.client, oc.owner, oc.am::text AS owner_id,
         receipt.at, ${netMoney("receipt.amount", "receipt.cur", "receipt.ratio")} AS amount, NULL::text AS measure, 'collected' AS detail,
         jsonb_build_object('period', ${PERIOD("receipt.at")}, 'month', ${month("receipt.at")}, 'series', 'collected', ${moneyDims("receipt.cur", "receipt.ratio")}) AS dims
    FROM receipt CROSS JOIN p JOIN oc ON oc.opportunity_id = receipt.opportunity_id
   WHERE receipt.at >= p.series_from_at AND receipt.at < p.to_at`;

/**
 * Refunds paid: client refund requests Finance completed (Done), dated when Finance closed them, net of tax by the
 * deal's main quotation (else as entered, noted); entity = the request's company, else its deal's. A refund raised
 * without a deal counts only while no sales filter (Account Manager, enquiry type, package…) is on. `sign` is -1 where
 * a refund takes money away (Net revenue).
 */
export const REFUND_CTE = `refund AS (
  SELECT r.id, r.number, r.total_amount AS amount, btrim(r.currency) AS cur, r.closed_at AS at, r.reason, r.opportunity_id, oc.case_id,
         CASE WHEN oc.case_id IS NOT NULL THEN ${proposalRatio("'main'", "NULL::uuid", "oc.case_id")} END AS ratio,
         party.display_name AS party_name
    FROM finance_requests r CROSS JOIN p
    LEFT JOIN oc ON oc.opportunity_id = r.opportunity_id
    LEFT JOIN crm_parties party ON party.workspace_id = r.workspace_id AND party.id = r.party_id
   WHERE r.workspace_id = p.ws AND r.kind = 'refund' AND r.status = 'done' AND r.closed_at >= p.series_from_at AND r.closed_at < p.to_at
     AND (oc.opportunity_id IS NOT NULL OR (r.opportunity_id IS NULL AND ${NO_SALES_FILTERS}))
     AND (p.entity_id IS NULL OR COALESCE(r.legal_entity_id, oc.entity_id) = p.entity_id)
)`;
const refundFacts = (sign: 1 | -1) => `SELECT refund.id::text AS id, 'refund' AS kind, refund.case_id::text AS parent_id, 'FR-' || lpad(refund.number::text, 4, '0') AS reference,
         COALESCE(oc.title, refund.reason) AS title, COALESCE(oc.client, refund.party_name) AS client, oc.owner, oc.am::text AS owner_id, refund.at,
         CASE WHEN refund.cur = p.currency THEN round(${sign} * refund.amount * COALESCE(refund.ratio, 1), 6)::text END AS amount, NULL::text AS measure,
         'refund' AS detail,
         jsonb_build_object('period', ${PERIOD("refund.at")}, 'month', ${month("refund.at")}, 'series', 'refund', ${moneyDims("refund.cur", "refund.ratio")}) AS dims
    FROM refund CROSS JOIN p LEFT JOIN oc ON oc.opportunity_id = refund.opportunity_id`;

/**
 * Revenue collected: client payments Finance verified (receipts with status finance_verified), dated when Finance
 * verified them (else when reported, for older rows), net of tax by the share of the quotation the payment stage
 * belongs to; base currency only; entity = the receipt's entity. Invoiced (the trend's second line): tax invoices
 * issued (not credited), by issue date, their net.
 */
const COLLECTED_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${RECEIPT_CTE}
SELECT ${FACT_COLUMNS} FROM (
  ${RECEIPT_FACTS}
  UNION ALL
  SELECT invoice.id::text, 'invoice', invoice.case_id::text, invoice.number, COALESCE(NULLIF(btrim(invoice.milestone_title), ''), invoice.number), oc.client, oc.owner, oc.am::text,
         (invoice.issue_date::timestamp AT TIME ZONE p.tz), CASE WHEN btrim(invoice.currency) = p.currency THEN invoice.net::text END, NULL, 'invoiced',
         jsonb_build_object('period', ${PERIOD("(invoice.issue_date::timestamp AT TIME ZONE p.tz)")}, 'month', to_char(invoice.issue_date, 'YYYY-MM'), 'series', 'invoiced',
           'currency', CASE WHEN btrim(invoice.currency) = p.currency THEN 'base' ELSE 'other' END, 'tax', 'net')
    FROM client_invoices invoice CROSS JOIN p
    JOIN pre_project_cases c ON c.workspace_id = invoice.workspace_id AND c.id = invoice.case_id
    JOIN oc ON oc.opportunity_id = c.opportunity_id
   WHERE invoice.workspace_id = p.ws AND invoice.status = 'issued' AND (p.entity_id IS NULL OR invoice.legal_entity_id = p.entity_id)
     AND (invoice.issue_date::timestamp AT TIME ZONE p.tz) >= p.series_from_at AND (invoice.issue_date::timestamp AT TIME ZONE p.tz) < p.to_at
) facts ORDER BY at DESC`;

const revenueCollected: KpiSpec = {
  code: "revenue_collected",
  compare: "higher",
  facts: (ctx) => readFacts(ctx, COLLECTED_SQL),
  build: (ctx, facts) => {
    const collected = facts.filter((fact) => fact.dims.series === "collected");
    const period = collected.filter(inPeriod);
    const amount = sum(period.map((fact) => fact.amount)).toFixed(ctx.places);
    const keys = monthKeys(ctx.filters);
    const series = [{ id: "collected", label: "Collected" }, { id: "invoiced", label: "Invoiced" }];
    const values = grid(facts, "month", keys, series, "series", "amount", ctx.places);
    return {
      code: "revenue_collected", unit: "money", value: amount, count: period.length, amount, targetable: true,
      ...targetFor(ctx.targets, "revenue_collected", ctx.filters, amount),
      extra: { invoiced: sum(facts.filter((fact) => fact.dims.series === "invoiced" && inPeriod(fact)).map((fact) => fact.amount)).toFixed(ctx.places) },
      chart: { type: "lines", dimension: "month", categories: categories(keys), series, values, unit: "money" },
      notes: moneyNotes(collected),
    };
  },
};

/**
 * Outstanding balances: on every live job (case not cancelled, project not cancelled), each payment stage's amount
 * less the Finance-verified payments allocated to it (reversed allocations left out; older stages verified before
 * allocations existed count as paid in full), never below zero. These are what clients owe, so they include tax.
 * Ageing by the stage's due date against today: not due yet, 1–30, 31–60 and over 60 days overdue, or no due date.
 */
export const OUTSTANDING_SQL = `WITH ${P}, ${OPPORTUNITIES},
stage AS (
  SELECT pay.case_id, pay.id, pay.title, pay.amount, COALESCE(NULLIF(btrim(pay.currency), ''), btrim(q.currency)) AS cur, pay.due_date, c.opportunity_id,
         COALESCE((SELECT sum(al.amount) FROM commercial_allocations al
                     JOIN commercial_receipts r ON r.workspace_id = al.workspace_id AND r.case_id = al.case_id AND r.id = al.receipt_id AND r.status = 'finance_verified'
                    WHERE al.workspace_id = pay.workspace_id AND al.case_id = pay.case_id AND al.payment_id = pay.id AND al.detail->>'reversedAt' IS NULL),
                  CASE WHEN pay.status = 'verified' AND NOT COALESCE(jsonb_typeof(cc.content->'financeContext') = 'object', false) THEN pay.amount ELSE 0 END) AS paid,
         pay.legal_entity_id
    FROM commercial_payments pay CROSS JOIN p
    JOIN pre_project_cases c ON c.workspace_id = pay.workspace_id AND c.id = pay.case_id AND c.status <> 'cancelled'
    LEFT JOIN commercial_quotes q ON q.workspace_id = pay.workspace_id AND q.case_id = pay.case_id AND q.id = pay.source_quote_id
    LEFT JOIN commercial_cases cc ON cc.workspace_id = pay.workspace_id AND cc.case_id = pay.case_id
   WHERE pay.workspace_id = p.ws AND pay.amount > 0
     AND NOT EXISTS (SELECT 1 FROM delivery_projects dp WHERE dp.workspace_id = pay.workspace_id AND dp.case_id = pay.case_id AND dp.status = 'cancelled')
)
SELECT ${FACT_COLUMNS} FROM (
  SELECT stage.id AS id, 'case' AS kind, stage.case_id::text AS parent_id, oc.reference, stage.title, oc.client, oc.owner, oc.am::text AS owner_id,
         (stage.due_date::timestamp AT TIME ZONE p.tz) AS at,
         CASE WHEN stage.cur = p.currency THEN round(greatest(stage.amount - stage.paid, 0), 6)::text END AS amount,
         CASE WHEN stage.due_date < p.today THEN (p.today - stage.due_date)::text END AS measure, oc.title AS detail,
         jsonb_build_object('period', '1', 'age', CASE WHEN stage.due_date IS NULL THEN 'no_due_date' WHEN stage.due_date >= p.today THEN 'not_due'
             WHEN p.today - stage.due_date <= 30 THEN 'overdue_1_30' WHEN p.today - stage.due_date <= 60 THEN 'overdue_31_60' ELSE 'overdue_60_plus' END,
           'currency', CASE WHEN stage.cur = p.currency THEN 'base' ELSE 'other' END, 'tax', 'gross') AS dims
    FROM stage CROSS JOIN p JOIN oc ON oc.opportunity_id = stage.opportunity_id
   WHERE stage.amount - stage.paid > 0 AND (p.entity_id IS NULL OR COALESCE(stage.legal_entity_id, oc.entity_id::text) = p.entity_id::text)
) facts ORDER BY at NULLS LAST`;

export const AGE_BUCKETS = ["not_due", "overdue_1_30", "overdue_31_60", "overdue_60_plus", "no_due_date"] as const;

const outstanding: KpiSpec = {
  code: "outstanding",
  facts: (ctx) => readFacts(ctx, OUTSTANDING_SQL),
  build: (ctx, facts) => {
    const counted = facts.filter((fact) => fact.dims.currency === "base");
    const amount = sum(counted.map((fact) => fact.amount)).toFixed(ctx.places);
    return {
      code: "outstanding", unit: "money", value: amount, count: counted.length, amount, targetable: false,
      chart: { type: "bars", dimension: "age", unit: "money", items: AGE_BUCKETS.map((age) => {
        const bucket = counted.filter((fact) => fact.dims.age === age);
        return { key: age, label: age, value: sum(bucket.map((fact) => fact.amount)).toFixed(ctx.places), count: bucket.length };
      }) },
      notes: moneyNotes(facts, true),
    };
  },
};

/**
 * Deals waiting for approval: Deal Files submitted (Deal Created / Submitted) whose approval request is still pending
 * at Finance or the approver — not yet Deal Approved. Live, not bound to the period. Value net of tax by the case's
 * accepted quotation.
 */
const AWAITING_SQL = `WITH ${P}, ${OPPORTUNITIES}
SELECT ${FACT_COLUMNS} FROM (
  SELECT ar.id::text AS id, 'approval' AS kind, c.id::text AS parent_id, oc.reference, ar.title, oc.client, oc.owner, oc.am::text AS owner_id,
         ar.requested_at AS at, ${netMoney("ar.amount", "ar.currency_code", "ratio.value")} AS amount,
         (p.today - (ar.requested_at AT TIME ZONE p.tz)::date)::text AS measure, CASE WHEN ar.current_step > 1 THEN 'verified' ELSE 'submitted' END AS detail,
         jsonb_build_object('period', '1', ${moneyDims("ar.currency_code", "ratio.value")}) AS dims
    FROM approval_requests ar CROSS JOIN p
    JOIN pre_project_cases c ON c.workspace_id = ar.workspace_id AND c.id = (substring(ar.href FROM '/cases/([0-9a-fA-F-]{36})'))::uuid
    JOIN oc ON oc.opportunity_id = c.opportunity_id
    LEFT JOIN LATERAL (SELECT ${netRatio("q")} AS value FROM commercial_quotes q WHERE q.workspace_id = c.workspace_id AND q.case_id = c.id AND q.kind = 'quotation' AND q.status = 'accepted'
                        ORDER BY q.updated_at DESC LIMIT 1) ratio ON true
   WHERE ar.workspace_id = p.ws AND ar.subject_kind = 'deal_file' AND ar.status = 'pending' AND ${OPPORTUNITY_ENTITY}
) facts ORDER BY at`;

const dealsAwaiting: KpiSpec = {
  code: "deals_awaiting_approval",
  facts: (ctx) => readFacts(ctx, AWAITING_SQL),
  build: (ctx, facts) => ({
    code: "deals_awaiting_approval", unit: "count", value: String(facts.length), count: facts.length,
    amount: sum(facts.map((fact) => fact.amount)).toFixed(ctx.places), targetable: false, chart: { type: "list", bucket: "period=1" }, notes: moneyNotes(facts),
  }),
};

/**
 * Active projects by stage, live: won jobs only.
 *   Design — a design journey whose approval isn't done yet.
 *   Estimate — no open design journey and no project started yet (from design approval to the main quotation's start),
 *     leaving out orders already collected or delivered and cancelled deals.
 *   Production / Delivery / Snagging — started projects (active or on hold) by their current stage: installation,
 *     permit and delivery stages are Delivery; snagging and handover are Snagging; every other stage (kick-off,
 *     materials, purchasing, drawings, production and the firm's own) is Production.
 */
const STAGES_SQL = `WITH ${P}, ${OPPORTUNITIES},
job AS (
  SELECT oc.*, j.case_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM design_journey_stages s WHERE s.workspace_id = p.ws AND s.case_id = j.case_id AND s.stage = 'approval' AND s.status = 'done') AS designing,
         dp.id AS project_id, dp.name AS project_name, dp.reference AS project_reference, dp.status AS project_status, dp.started_at AS project_started_at,
         stage.key AS stage_key, stage.name AS stage_name
    FROM oc CROSS JOIN p
    LEFT JOIN design_journeys j ON j.workspace_id = p.ws AND j.case_id = oc.case_id AND j.package_id IS NOT NULL
    LEFT JOIN delivery_projects dp ON dp.workspace_id = p.ws AND dp.case_id = oc.case_id
    LEFT JOIN LATERAL (SELECT ps.key, ps.name FROM project_stages ps WHERE ps.workspace_id = p.ws AND ps.project_id = dp.id AND ps.status = 'current' LIMIT 1) stage ON true
   WHERE oc.status = 'won' AND oc.case_id IS NOT NULL AND oc.case_status <> 'cancelled' AND ${OPPORTUNITY_ENTITY}
     AND NOT EXISTS (SELECT 1 FROM crm_deal_fulfilment f WHERE f.workspace_id = p.ws AND f.opportunity_id = oc.opportunity_id AND f.cancelled_at IS NOT NULL)
),
bucketed AS (
  SELECT job.*, CASE
      WHEN job.project_started_at IS NOT NULL AND job.project_status IN ('active', 'on_hold') THEN CASE
        WHEN job.stage_key ~* '(install|deliver|dispatch|permit)' THEN 'delivery'
        WHEN job.stage_key ~* '(snag|handover)' THEN 'snagging'
        ELSE 'production' END
      WHEN job.project_started_at IS NOT NULL THEN NULL
      WHEN job.designing THEN 'design'
      WHEN EXISTS (SELECT 1 FROM crm_deal_fulfilment_events ev WHERE ev.workspace_id = p.ws AND ev.opportunity_id = job.opportunity_id AND ev.event IN ('collected', 'delivered')) THEN NULL
      ELSE 'estimate' END AS bucket
    FROM job CROSS JOIN p
)
SELECT ${FACT_COLUMNS} FROM (
  SELECT COALESCE(project_id, case_id)::text AS id, CASE WHEN project_id IS NOT NULL AND project_started_at IS NOT NULL THEN 'project' ELSE 'case' END AS kind,
         case_id::text AS parent_id, COALESCE(project_reference, reference) AS reference, COALESCE(project_name, title) AS title, client, owner, am::text AS owner_id,
         project_started_at AS at, NULL::text AS amount, NULL::text AS measure, COALESCE(stage_name, bucket) AS detail,
         jsonb_build_object('period', '1', 'stage', bucket) AS dims
    FROM bucketed WHERE bucket IS NOT NULL
) facts ORDER BY title`;

export const PROJECT_BUCKETS = ["design", "estimate", "production", "delivery", "snagging"] as const;

const activeProjects: KpiSpec = {
  code: "active_projects",
  facts: (ctx) => readFacts(ctx, STAGES_SQL),
  build: (_ctx, facts) => ({
    code: "active_projects", unit: "count", value: String(facts.length), count: facts.length, targetable: false,
    chart: { type: "bars", dimension: "stage", unit: "count", items: PROJECT_BUCKETS.map((stage) => {
      const bucket = facts.filter((fact) => fact.dims.stage === stage);
      return { key: stage, label: stage, value: String(bucket.length), count: bucket.length };
    }) },
  }),
};

/**
 * Delayed items, live — anything past its internal deadline:
 *   a design stage still open after its internal due time (inspiration, site visit, concepts, space planning, material
 *     selection, renders);
 *   an estimate (Proposal 2) not linked by its due time after design approval;
 *   a started project past its promised handover date;
 *   a started project with open tasks past their due date (one item per project, with how many).
 * Days late counts local days since the deadline.
 */
const DELAYED_SQL = `WITH ${P}, ${OPPORTUNITIES}
SELECT ${FACT_COLUMNS} FROM (
  SELECT s.case_id::text || ':' || s.stage AS id, 'case' AS kind, s.case_id::text AS parent_id, oc.reference, oc.title, oc.client, COALESCE(NULLIF(btrim(stage_user.display_name), ''), stage_user.primary_email, oc.owner) AS owner,
         COALESCE(s.owner_membership_id, oc.am)::text AS owner_id, s.due_at AS at, NULL::text AS amount, (p.today - (s.due_at AT TIME ZONE p.tz)::date)::text AS measure, s.stage AS detail,
         jsonb_build_object('period', '1', 'type', 'design_stage', 'stage', s.stage) AS dims
    FROM design_journey_stages s CROSS JOIN p
    JOIN design_journeys j ON j.workspace_id = s.workspace_id AND j.case_id = s.case_id
    JOIN oc ON oc.case_id = s.case_id
    LEFT JOIN workspace_memberships stage_member ON stage_member.workspace_id = s.workspace_id AND stage_member.id = s.owner_membership_id
    LEFT JOIN users stage_user ON stage_user.id = stage_member.user_id
   WHERE s.workspace_id = p.ws AND s.status = 'active' AND s.due_at < p.now_at AND oc.case_status NOT IN ('cancelled') AND ${OPPORTUNITY_ENTITY}
  UNION ALL
  -- The work inside a design step (the design site measure, the sample collection, the design team to allocate).
  SELECT t.case_id::text || ':' || t.task, 'case', t.case_id::text, oc.reference, oc.title, oc.client, COALESCE(NULLIF(btrim(task_user.display_name), ''), task_user.primary_email, oc.owner),
         COALESCE(t.owner_membership_id, oc.am)::text, t.due_at, NULL, (p.today - (t.due_at AT TIME ZONE p.tz)::date)::text, t.task,
         jsonb_build_object('period', '1', 'type', 'design_stage', 'stage', t.task)
    FROM design_journey_tasks t CROSS JOIN p
    JOIN oc ON oc.case_id = t.case_id
    LEFT JOIN workspace_memberships task_member ON task_member.workspace_id = t.workspace_id AND task_member.id = t.owner_membership_id
    LEFT JOIN users task_user ON task_user.id = task_member.user_id
   WHERE t.workspace_id = p.ws AND t.status = 'open' AND t.due_at < p.now_at AND oc.case_status NOT IN ('cancelled') AND ${OPPORTUNITY_ENTITY}
  UNION ALL
  SELECT j.case_id::text || ':estimate', 'case', j.case_id::text, oc.reference, oc.title, oc.client, oc.owner, oc.am::text, j.estimate_due_at, NULL,
         (p.today - (j.estimate_due_at AT TIME ZONE p.tz)::date)::text, 'estimate', jsonb_build_object('period', '1', 'type', 'estimate')
    FROM design_journeys j CROSS JOIN p JOIN oc ON oc.case_id = j.case_id
   WHERE j.workspace_id = p.ws AND j.estimate_due_at < p.now_at AND j.estimate_linked_at IS NULL AND j.approved_on IS NOT NULL
     AND oc.case_status NOT IN ('cancelled') AND ${OPPORTUNITY_ENTITY}
  UNION ALL
  SELECT dp.id::text || ':promise', 'project', dp.id::text, dp.reference, dp.name, oc.client, oc.owner, oc.am::text, (dp.promise_date::timestamp AT TIME ZONE p.tz), NULL,
         (p.today - dp.promise_date)::text, 'promise_date', jsonb_build_object('period', '1', 'type', 'promise_date')
    FROM delivery_projects dp CROSS JOIN p JOIN oc ON oc.case_id = dp.case_id
   WHERE dp.workspace_id = p.ws AND dp.status = 'active' AND dp.started_at IS NOT NULL AND dp.promise_date < p.today AND ${OPPORTUNITY_ENTITY}
  UNION ALL
  SELECT dp.id::text || ':tasks', 'project', dp.id::text, dp.reference, dp.name, oc.client, oc.owner, oc.am::text, (late.first_due::timestamp AT TIME ZONE p.tz), NULL,
         late.items::text, 'tasks', jsonb_build_object('period', '1', 'type', 'tasks')
    FROM delivery_projects dp CROSS JOIN p JOIN oc ON oc.case_id = dp.case_id
    JOIN LATERAL (SELECT count(*)::int AS items, min(item.due_date) AS first_due FROM work_items item
                   WHERE item.workspace_id = dp.workspace_id AND item.project_id = dp.id AND item.type = 'task'
                     AND item.status NOT IN ('done', 'cancelled') AND item.due_date < p.today) late ON late.items > 0
   WHERE dp.workspace_id = p.ws AND dp.status = 'active' AND dp.started_at IS NOT NULL AND ${OPPORTUNITY_ENTITY}
) facts ORDER BY at`;

const delayedItems: KpiSpec = {
  code: "delayed_items",
  facts: (ctx) => readFacts(ctx, DELAYED_SQL),
  build: (_ctx, facts) => ({ code: "delayed_items", unit: "count", value: String(facts.length), count: facts.length, targetable: false, chart: { type: "list", bucket: "period=1" } }),
};

/**
 * Deals Closed / Completed: won deals whose Enquiry Type closing rule is met (PLM-102; computed read-only from the
 * records, as on the deal itself — collection, delivery, installation, design approval, production, the accepted
 * handover pack),
 * dated when the last required record happened. Cancelled deals never close. Value = the deal's won proposals, net of
 * tax. Grouped by Enquiry Type.
 */
const CLOSED_CANDIDATES_SQL = `WITH ${P}, ${OPPORTUNITIES}
SELECT oc.opportunity_id::text AS id, oc.case_id::text AS parent_id, oc.reference, oc.title, oc.client, oc.owner, oc.am::text AS owner_id, oc.enquiry_type,
       choice.flow AS flow_code, o.flow_version_id::text AS flow_version_id, o.furniture_path,
       (SELECT sum(CASE WHEN btrim(pr.currency_code) = p.currency THEN pr.amount * COALESCE(${proposalRatio("pr.kind", "pr.quote_id", "oc.case_id")}, 1) END)::text
          FROM crm_opportunity_proposals pr WHERE pr.workspace_id = p.ws AND pr.opportunity_id = oc.opportunity_id AND pr.won_at IS NOT NULL) AS proposals,
       CASE WHEN btrim(oc.currency_code) = p.currency THEN (oc.amount * COALESCE(${proposalRatio("'main'", "NULL::uuid", "oc.case_id")}, 1))::text END AS headline
  FROM oc CROSS JOIN p
  JOIN crm_opportunities o ON o.workspace_id = p.ws AND o.id = oc.opportunity_id
  LEFT JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = p.ws AND taxonomy.code = 'enquiry_type'
  LEFT JOIN crm_taxonomy_options choice ON choice.workspace_id = p.ws AND choice.taxonomy_id = taxonomy.id AND choice.code = oc.enquiry_type
 WHERE oc.status = 'won' AND oc.closed_at < p.to_at AND oc.cancelled_at IS NULL AND ${OPPORTUNITY_ENTITY}`;

export async function closedFacts(ctx: ReportContext): Promise<Fact[]> {
  const candidates = (await ctx.db.query<{ id: string; parent_id: string | null; reference: string | null; title: string; client: string | null; owner: string | null;
    owner_id: string | null; enquiry_type: string | null; flow_code: string | null; flow_version_id: string | null; furniture_path: FurniturePath | null;
    proposals: string | null; headline: string | null }>(CLOSED_CANDIDATES_SQL, ctx.params)).rows;
  const bounds = (await ctx.db.query<{ fromAt: Date; toAt: Date; seriesFrom: Date }>(`WITH ${P} SELECT from_at AS "fromAt", to_at AS "toAt", series_from_at AS "seriesFrom" FROM p`, ctx.params)).rows[0];
  const facts: Fact[] = [];
  for (const candidate of candidates) {
    const closing = await readDealClosing(ctx.db, ctx.workspaceId, {
      id: candidate.id, flowCode: candidate.flow_code, flowVersionId: candidate.flow_version_id, furniturePath: candidate.furniture_path, caseId: candidate.parent_id,
    });
    if (!closing?.closed || !closing.closedAt) continue;
    const at = new Date(closing.closedAt);
    if (at < bounds.seriesFrom || at >= bounds.toAt) continue;
    const local = new Intl.DateTimeFormat("en-CA", { timeZone: ctx.timeZone, year: "numeric", month: "2-digit" }).format(at).slice(0, 7);
    facts.push({
      id: candidate.id, kind: "opportunity", parentId: candidate.parent_id, reference: candidate.reference, title: candidate.title, client: candidate.client,
      owner: candidate.owner, ownerId: candidate.owner_id, at: at.toISOString(), amount: candidate.proposals ?? candidate.headline, measure: null,
      detail: closing.event, dims: { period: at >= bounds.fromAt ? "1" : "0", month: local, type: candidate.enquiry_type ?? "none", currency: "base", tax: "net" },
    });
  }
  return facts.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

const dealsClosed: KpiSpec = {
  code: "deals_closed",
  compare: "higher",
  facts: closedFacts,
  build: (ctx, facts) => {
    const period = facts.filter(inPeriod);
    const amount = sum(period.map((fact) => fact.amount)).toFixed(ctx.places);
    return {
      code: "deals_closed", unit: "count", value: String(period.length), count: period.length, amount, targetable: true,
      ...targetFor(ctx.targets, "deals_closed", ctx.filters, String(period.length)),
      chart: { type: "bars", dimension: "type", unit: "count", items: groupBy(period, "type", (fact) => ctx.labels.enquiryTypes.get(fact.dims.type) ?? fact.dims.type, ctx.places)
        .sort((a, b) => b.count - a.count).map((group) => ({ key: group.key, label: group.label, value: String(group.count), count: group.count, amount: group.amountText })) },
    };
  },
};

/**
 * Profit margin: for projects started in the period, the agreed value net of tax (the sealed baseline plus every
 * sealed variation) against the QS / BOQ cost of those same quotations (the QS estimate on the quotation, else the
 * Deal File's cost for it). Margin = (agreed − cost) ÷ agreed, weighted by value over the projects. A project whose
 * sealed quotations don't all carry a QS cost is left out (and counted apart), never treated as zero cost.
 */
const MARGIN_SQL = `WITH ${P}, ${OPPORTUNITIES},
sealed AS (
  SELECT dp.id AS project_id, dp.case_id, dp.name, dp.reference, dp.started_at, seal.currency,
         CASE WHEN (seal.snapshot->'pricing'->>'net') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (seal.snapshot->'pricing'->>'net')::numeric END AS net,
         COALESCE(CASE WHEN (q.detail->'qsEstimate'->>'cost') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (q.detail->'qsEstimate'->>'cost')::numeric END,
                  (SELECT deal.cost FROM commercial_deal_files deal WHERE deal.workspace_id = dp.workspace_id AND deal.case_id = dp.case_id AND deal.quote_id = seal.quote_id AND deal.cost > 0)) AS cost
    FROM delivery_projects dp CROSS JOIN p
    JOIN project_scope_seals seal ON seal.workspace_id = dp.workspace_id AND seal.project_id = dp.id
    LEFT JOIN commercial_quotes q ON q.workspace_id = dp.workspace_id AND q.case_id = dp.case_id AND q.id = seal.quote_id
   WHERE dp.workspace_id = p.ws AND dp.started_at IS NOT NULL AND dp.status <> 'cancelled' AND dp.started_at >= p.series_from_at AND dp.started_at < p.to_at
),
project AS (
  SELECT project_id, case_id, name, reference, started_at, sum(net) AS net, sum(cost) AS cost,
         bool_and(net IS NOT NULL AND cost IS NOT NULL AND btrim(currency) = (SELECT currency FROM p)) AS complete
    FROM sealed GROUP BY project_id, case_id, name, reference, started_at
)
SELECT ${FACT_COLUMNS} FROM (
  SELECT project.project_id::text AS id, 'project' AS kind, project.case_id::text AS parent_id, project.reference, project.name AS title, oc.client, oc.owner, oc.am::text AS owner_id,
         project.started_at AS at, CASE WHEN project.complete THEN round(project.net, 6)::text END AS amount,
         CASE WHEN project.complete AND project.net > 0 THEN round((project.net - project.cost) * 100 / project.net, 2)::text END AS measure,
         CASE WHEN project.complete THEN round(project.cost, 6)::text END AS detail,
         jsonb_build_object('period', ${PERIOD("project.started_at")}, 'month', ${month("project.started_at")}, 'cost', CASE WHEN project.complete THEN 'known' ELSE 'missing' END) AS dims
    FROM project CROSS JOIN p JOIN oc ON oc.case_id = project.case_id
   WHERE ${OPPORTUNITY_ENTITY}
) facts ORDER BY at DESC`;

/** Weighted margin of complete projects: Σ(agreed − cost) ÷ Σ agreed, two decimals; null when there are none. */
export function weightedMargin(facts: Fact[]) {
  const complete = facts.filter((fact) => fact.dims.cost === "known" && fact.amount !== null && fact.detail !== null);
  const net = sum(complete.map((fact) => fact.amount));
  if (!complete.length || net.cmp(0) <= 0) return null;
  return net.sub(sum(complete.map((fact) => fact.detail))).mul(100).div(net).toFixed(2);
}

const profitMargin: KpiSpec = {
  code: "profit_margin",
  compare: "higher",
  facts: (ctx) => readFacts(ctx, MARGIN_SQL),
  build: (ctx, facts) => {
    const period = facts.filter(inPeriod);
    const value = weightedMargin(period);
    const keys = monthKeys(ctx.filters);
    return {
      code: "profit_margin", unit: "percent", value, count: period.filter((fact) => fact.dims.cost === "known").length, targetable: true,
      ...targetFor(ctx.targets, "profit_margin", ctx.filters, value),
      extra: { withoutCost: period.filter((fact) => fact.dims.cost === "missing").length },
      chart: { type: "lines", dimension: "month", categories: categories(keys), series: [{ id: "margin", label: "Margin" }],
        values: [keys.map((key) => weightedMargin(facts.filter((fact) => fact.dims.month === key)))], unit: "percent" },
    };
  },
};

/**
 * Cancellations and refunds: won deals cancelled in the period (their order or job cancelled; dated when cancelled;
 * value = their won proposals net of tax, else the deal's value), and client refunds Finance completed in the period
 * (as in Net revenue). The figure is the number of cancelled deals; the refunds are shown with it. Monthly columns,
 * cancelled value vs refunds paid. Cancelled deals stay recorded; they never count as Won.
 */
const CANCELLED_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${REFUND_CTE}
SELECT ${FACT_COLUMNS} FROM (
  SELECT oc.opportunity_id::text AS id, 'opportunity' AS kind, oc.case_id::text AS parent_id, oc.reference, oc.title, oc.client, oc.owner, oc.am::text AS owner_id,
         oc.cancelled_at AS at,
         CASE WHEN oc.currency_code = p.currency THEN round(COALESCE(won.net, oc.amount * COALESCE(main.ratio, 1)), 6)::text END AS amount,
         NULL::text AS measure, oc.cancel_reason AS detail,
         jsonb_build_object('period', ${PERIOD("oc.cancelled_at")}, 'month', ${month("oc.cancelled_at")}, 'series', 'cancelled',
           'currency', CASE WHEN oc.currency_code = p.currency THEN 'base' ELSE 'other' END,
           'tax', CASE WHEN won.net IS NOT NULL THEN CASE WHEN won.separated THEN 'net' ELSE 'gross' END WHEN main.ratio IS NOT NULL THEN 'net' ELSE 'gross' END) AS dims
    FROM oc CROSS JOIN p
    LEFT JOIN LATERAL (SELECT sum(proposal.amount * COALESCE(proposal.ratio, 1)) AS net, bool_and(proposal.ratio IS NOT NULL) AS separated
                         FROM (SELECT pr.amount, ${proposalRatio("pr.kind", "pr.quote_id", "oc.case_id")} AS ratio FROM crm_opportunity_proposals pr
                                WHERE pr.workspace_id = p.ws AND pr.opportunity_id = oc.opportunity_id AND pr.won_at IS NOT NULL AND btrim(pr.currency_code) = p.currency) proposal) won ON true
    LEFT JOIN LATERAL (SELECT ${proposalRatio("'main'", "NULL::uuid", "oc.case_id")} AS ratio) main ON true
   WHERE oc.cancelled_at >= p.series_from_at AND oc.cancelled_at < p.to_at AND ${OPPORTUNITY_ENTITY}
  UNION ALL
  ${refundFacts(1)}
) facts ORDER BY at DESC`;

const cancellations: KpiSpec = {
  code: "cancellations_refunds",
  facts: (ctx) => readFacts(ctx, CANCELLED_SQL),
  build: (ctx, facts) => {
    const period = facts.filter(inPeriod);
    const cancelled = period.filter((fact) => fact.dims.series === "cancelled"), refunds = period.filter((fact) => fact.dims.series === "refund");
    const keys = monthKeys(ctx.filters);
    const series = [{ id: "cancelled", label: "Cancelled" }, { id: "refund", label: "Refunded" }];
    return {
      code: "cancellations_refunds", unit: "count", value: String(cancelled.length), count: cancelled.length,
      amount: sum(cancelled.map((fact) => fact.amount)).toFixed(ctx.places), targetable: false,
      extra: { refundCount: refunds.length, refundValue: sum(refunds.map((fact) => fact.amount)).toFixed(ctx.places) },
      chart: { type: "columns", dimension: "month", seriesDimension: "series", categories: categories(keys), series, values: grid(facts, "month", keys, series, "series", "amount", ctx.places), unit: "money" },
      notes: moneyNotes(facts),
    };
  },
};

/**
 * Net revenue: Revenue collected (client receipts Finance verified, net of tax) less refunds paid (client refunds
 * Finance completed, net of tax), both in the period. The drill-down lists both; refunds show as negative amounts.
 */
const NET_REVENUE_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${RECEIPT_CTE}, ${REFUND_CTE}
SELECT ${FACT_COLUMNS} FROM (
  ${RECEIPT_FACTS}
  UNION ALL
  ${refundFacts(-1)}
) facts ORDER BY at DESC`;

const netRevenue: KpiSpec = {
  code: "net_revenue",
  facts: (ctx) => readFacts(ctx, NET_REVENUE_SQL),
  build: (ctx, facts) => {
    const period = facts.filter(inPeriod);
    const amount = sum(period.map((fact) => fact.amount)).toFixed(ctx.places);
    const of = (items: Fact[], series: string) => sum(items.filter((fact) => fact.dims.series === series).map((fact) => fact.amount));
    const keys = monthKeys(ctx.filters);
    const monthly = keys.map((key) => facts.filter((fact) => fact.dims.month === key));
    return {
      code: "net_revenue", unit: "money", value: amount, count: period.length, amount, targetable: true,
      ...targetFor(ctx.targets, "net_revenue", ctx.filters, amount),
      extra: { collected: of(period, "collected").toFixed(ctx.places), refunded: of(period, "refund").neg().toFixed(ctx.places) },
      chart: { type: "lines", dimension: "month", categories: categories(keys), unit: "money",
        series: [{ id: "net", label: "Net revenue" }, { id: "collected", label: "Collected" }, { id: "refund", label: "Refunded" }],
        values: [monthly.map((items) => sum(items.map((fact) => fact.amount)).toFixed(ctx.places)), monthly.map((items) => of(items, "collected").toFixed(ctx.places)),
          monthly.map((items) => of(items, "refund").neg().toFixed(ctx.places))] },
      notes: moneyNotes(facts),
    };
  },
};

export const OWNER_OVERVIEW: KpiSpec[] = [salesWon, revenueCollected, netRevenue, cancellations, outstanding, dealsAwaiting, activeProjects, delayedItems, dealsClosed, profitMargin];
