import { type KpiSpec, moneyNotes, readFacts } from "./report-context";
import { type Fact, FACT_COLUMNS, groupBy, mean, percent, sum } from "./report-kit";
import { OPPORTUNITIES, OPPORTUNITY_ENTITY, P, netMoney, stamp } from "./report-scope";
import { targetFor } from "./report-targets";
import { proposalRatio } from "./owner-overview";

/**
 * Dashboard 4 · Design projects (PLM-130). Every definition here is also written in the master plan (§6.27a).
 *
 * A design project is a design journey with a design package (a furniture/joinery order's site-and-materials steps
 * are not one). It is open until its Design approval stage is done, on a case that is not cancelled.
 */
const JOURNEYS = `journey AS (
  SELECT j.case_id, j.package_id, j.package_name, j.included_revisions, j.inspiration_days, j.includes_renders, j.started_at, j.approved_on,
         oc.opportunity_id, oc.reference, oc.title, oc.client, oc.owner, oc.am, oc.case_status, oc.entity_id,
         NOT EXISTS (SELECT 1 FROM design_journey_stages s WHERE s.workspace_id = j.workspace_id AND s.case_id = j.case_id AND s.stage = 'approval' AND s.status = 'done') AS open
    FROM design_journeys j CROSS JOIN p JOIN oc ON oc.case_id = j.case_id
   WHERE j.workspace_id = p.ws AND j.package_id IS NOT NULL AND oc.case_status <> 'cancelled' AND ${OPPORTUNITY_ENTITY}
)`;

/** The six phases the owner follows; concepts and space planning are "Development". */
export const DESIGN_PHASES = ["inspiration", "site_visit", "development", "materials", "renders", "approval"] as const;

/**
 * Projects by design stage, live: open design projects by the stage now in progress (Inspiration → Site visit →
 * Development (concepts, space planning) → Materials → Renders → Approval); one with no stage started yet is
 * "Not started".
 */
const STAGE_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${JOURNEYS}
SELECT ${FACT_COLUMNS} FROM (
  SELECT journey.case_id::text AS id, 'case' AS kind, journey.case_id::text AS parent_id, journey.reference, journey.title, journey.client, journey.owner, journey.am::text AS owner_id,
         current_stage.started_at AS at, NULL::text AS amount, NULL::text AS measure, journey.package_name AS detail,
         jsonb_build_object('period', '1', 'stage', CASE current_stage.stage WHEN 'concepts' THEN 'development' WHEN 'space_planning' THEN 'development'
           WHEN 'material_selection' THEN 'materials' ELSE COALESCE(current_stage.stage, 'not_started') END) AS dims
    FROM journey CROSS JOIN p
    LEFT JOIN LATERAL (SELECT s.stage, s.started_at FROM design_journey_stages s WHERE s.workspace_id = p.ws AND s.case_id = journey.case_id AND s.status = 'active'
                        ORDER BY s.position LIMIT 1) current_stage ON true
   WHERE journey.open
) facts ORDER BY title`;

const byStage: KpiSpec = {
  code: "design_stage",
  facts: (ctx) => readFacts(ctx, STAGE_SQL),
  build: (_ctx, facts) => ({
    code: "design_stage", unit: "count", value: String(facts.length), count: facts.length, targetable: false,
    chart: { type: "bars", dimension: "stage", unit: "count", items: [...DESIGN_PHASES, ...(facts.some((fact) => fact.dims.stage === "not_started") ? ["not_started"] : [])].map((stage) => {
      const bucket = facts.filter((fact) => fact.dims.stage === stage);
      return { key: stage, label: stage, value: String(bucket.length), count: bucket.length };
    }) },
  }),
};

/**
 * Package mix: design projects started in the period by package — count and value. Value = the Design Fee proposal
 * (Proposal 1) net of tax, else the design fee worked out in discovery (package rate × area or spaces, before tax).
 */
const MIX_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${JOURNEYS}
SELECT ${FACT_COLUMNS} FROM (
  SELECT journey.case_id::text AS id, 'case' AS kind, journey.case_id::text AS parent_id, journey.reference, journey.title, journey.client, journey.owner, journey.am::text AS owner_id,
         journey.started_at AS at,
         COALESCE(${netMoney("pr.amount", "pr.currency_code", proposalRatio("'design'", "pr.quote_id", "journey.case_id"))},
                  CASE WHEN btrim(d.design_fee_currency) = p.currency THEN d.design_fee::text END) AS amount,
         NULL::text AS measure, journey.package_name AS detail,
         jsonb_build_object('period', '1', 'package', journey.package_id::text,
           'currency', CASE WHEN COALESCE(btrim(pr.currency_code), btrim(d.design_fee_currency), p.currency) = p.currency THEN 'base' ELSE 'other' END, 'tax', 'net') AS dims
    FROM journey CROSS JOIN p
    LEFT JOIN crm_opportunity_proposals pr ON pr.workspace_id = p.ws AND pr.opportunity_id = journey.opportunity_id AND pr.kind = 'design'
    LEFT JOIN crm_opportunity_discovery d ON d.workspace_id = p.ws AND d.opportunity_id = journey.opportunity_id
   WHERE journey.started_at >= p.from_at AND journey.started_at < p.to_at
) facts ORDER BY at DESC`;

const packageMix: KpiSpec = {
  code: "package_mix",
  compare: "higher",
  facts: (ctx) => readFacts(ctx, MIX_SQL),
  build: (ctx, facts) => ({
    code: "package_mix", unit: "count", value: String(facts.length), count: facts.length, amount: sum(facts.map((fact) => fact.amount)).toFixed(ctx.places), targetable: false,
    chart: { type: "donut", dimension: "package", unit: "count", items: groupBy(facts, "package", (fact) => ctx.labels.packages.get(fact.dims.package) ?? fact.detail ?? "", ctx.places)
      .sort((a, b) => b.count - a.count).map((group) => ({ key: group.key, label: group.label, value: String(group.count), count: group.count, amount: group.amountText })) },
    notes: moneyNotes(facts),
  }),
};

/**
 * Overdue, live, on open design projects:
 *   inspiration open past its week (the inspiration days the journey started with, counted from the first inspiration,
 *     else from when the stage started);
 *   site visit not done within its hours (72 by default) of the stage starting;
 *   design (concepts, space planning) or renders past their internal deadline.
 */
const OVERDUE_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${JOURNEYS},
late AS (
  SELECT journey.*, s.stage, s.owner_membership_id,
         CASE WHEN s.stage = 'inspiration' THEN COALESCE(s.due_at, s.started_at + make_interval(days => journey.inspiration_days)) ELSE s.due_at END AS deadline
    FROM journey CROSS JOIN p
    JOIN design_journey_stages s ON s.workspace_id = p.ws AND s.case_id = journey.case_id AND s.status = 'active'
     AND s.stage IN ('inspiration', 'site_visit', 'concepts', 'space_planning', 'renders')
   WHERE journey.open
)
SELECT ${FACT_COLUMNS} FROM (
  SELECT late.case_id::text || ':' || late.stage AS id, 'case' AS kind, late.case_id::text AS parent_id, late.reference, late.title, late.client,
         COALESCE(NULLIF(btrim(stage_user.display_name), ''), stage_user.primary_email, late.owner) AS owner, COALESCE(late.owner_membership_id, late.am)::text AS owner_id,
         late.deadline AS at, NULL::text AS amount, round(extract(epoch FROM p.now_at - late.deadline)::numeric / 86400, 1)::text AS measure, late.stage AS detail,
         jsonb_build_object('period', '1', 'type', CASE WHEN late.stage IN ('concepts', 'space_planning') THEN 'design' ELSE late.stage END) AS dims
    FROM late CROSS JOIN p
    LEFT JOIN workspace_memberships stage_member ON stage_member.workspace_id = p.ws AND stage_member.id = late.owner_membership_id
    LEFT JOIN users stage_user ON stage_user.id = stage_member.user_id
   WHERE late.deadline < p.now_at
) facts ORDER BY at`;

const overdue: KpiSpec = {
  code: "design_overdue",
  facts: (ctx) => readFacts(ctx, OVERDUE_SQL),
  build: (_ctx, facts) => ({
    code: "design_overdue", unit: "count", value: String(facts.length), count: facts.length, targetable: false,
    extra: Object.fromEntries(["inspiration", "site_visit", "design", "renders"].map((type) => [type, facts.filter((fact) => fact.dims.type === type).length])),
    chart: { type: "list", bucket: "period=1" },
  }),
};

/**
 * Revisions: open design projects where a stage has been presented beyond the revisions the package includes (the
 * first presentation is the design; each later one a revision) — the chargeable revision (Palm: the 3rd).
 */
const REVISIONS_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${JOURNEYS}
SELECT ${FACT_COLUMNS} FROM (
  SELECT journey.case_id::text AS id, 'case' AS kind, journey.case_id::text AS parent_id, journey.reference, journey.title, journey.client, journey.owner, journey.am::text AS owner_id,
         rounds.last_at AS at, NULL::text AS amount, (rounds.max_round - 1)::text AS measure, rounds.stage AS detail, jsonb_build_object('period', '1') AS dims
    FROM journey CROSS JOIN p
    JOIN LATERAL (SELECT dp.stage, dp.round AS max_round, COALESCE(dp.presented_at, dp.created_at) AS last_at FROM design_presentations dp
                   WHERE dp.workspace_id = p.ws AND dp.case_id = journey.case_id AND dp.status NOT IN ('draft', 'withdrawn')
                     AND (dp.chargeable OR dp.round - 1 > journey.included_revisions)
                   ORDER BY dp.round DESC, dp.created_at DESC LIMIT 1) rounds ON true
   WHERE journey.open
) facts ORDER BY at DESC`;

const revisions: KpiSpec = {
  code: "chargeable_revisions",
  facts: (ctx) => readFacts(ctx, REVISIONS_SQL),
  build: (_ctx, facts) => ({ code: "chargeable_revisions", unit: "count", value: String(facts.length), count: facts.length, targetable: false, chart: { type: "list", bucket: "period=1" } }),
};

/**
 * Workload, live: open design projects per Interior Designer (the opportunity's dedicated designer) and per Visualiser
 * (who owns the renders stage, while renders aren't done). A project without one is under "Not assigned".
 */
const WORKLOAD_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${JOURNEYS}
SELECT ${FACT_COLUMNS} FROM (
  SELECT journey.case_id::text AS id, 'case' AS kind, journey.case_id::text AS parent_id, journey.reference, journey.title, journey.client,
         COALESCE(NULLIF(btrim(person_user.display_name), ''), person_user.primary_email) AS owner, person.membership_id::text AS owner_id,
         journey.started_at AS at, NULL::text AS amount, NULL::text AS measure, person.role AS detail,
         jsonb_build_object('period', '1', 'role', person.role, 'person', COALESCE(person.membership_id::text, 'none')) AS dims
    FROM journey CROSS JOIN p
    CROSS JOIN LATERAL (
      SELECT 'designer' AS role, (SELECT designer.membership_id FROM crm_opportunity_designer designer WHERE designer.workspace_id = p.ws AND designer.opportunity_id = journey.opportunity_id) AS membership_id
      UNION ALL
      SELECT 'visualiser', s.owner_membership_id FROM design_journey_stages s
       WHERE s.workspace_id = p.ws AND s.case_id = journey.case_id AND s.stage = 'renders' AND s.status <> 'done'
    ) person
    LEFT JOIN workspace_memberships person_member ON person_member.workspace_id = p.ws AND person_member.id = person.membership_id
    LEFT JOIN users person_user ON person_user.id = person_member.user_id
   WHERE journey.open
) facts ORDER BY owner NULLS LAST, title`;

const workload = (code: "designer_workload" | "visualiser_workload", role: string): KpiSpec => ({
  code,
  facts: async (ctx) => (await readFacts(ctx, WORKLOAD_SQL)).filter((fact) => fact.dims.role === role),
  build: (ctx, facts) => ({
    code, unit: "count", value: String(facts.length), count: facts.length, targetable: false,
    chart: { type: "bars", dimension: "person", unit: "count", items: groupBy(facts, "person", (fact) => fact.owner ?? "", ctx.places)
      .sort((a, b) => b.count - a.count).map((group) => ({ key: group.key, label: group.key === "none" ? "none" : group.label, value: String(group.count), count: group.count })) },
  }),
});

/**
 * Design approval → Proposal 2, for design projects whose design the client approved in the period (the approval's
 * signed date):
 *   days — calendar days from the approval to the first main quotation (Proposal 2) sent to the client on or after it,
 *     averaged over those that have one;
 *   moved on — the share whose Proposal 2 is Won (payment proof received): the Full ID clients that went on to
 *     furniture / joinery (filter Enquiry Type to see one route).
 */
const PROPOSAL2_SQL = `WITH ${P}, ${OPPORTUNITIES}, ${JOURNEYS}
SELECT ${FACT_COLUMNS} FROM (
  SELECT journey.case_id::text AS id, 'case' AS kind, journey.case_id::text AS parent_id, journey.reference, journey.title, journey.client, journey.owner, journey.am::text AS owner_id,
         (journey.approved_on::timestamp AT TIME ZONE p.tz) AS at, NULL::text AS amount,
         ((issued.at AT TIME ZONE p.tz)::date - journey.approved_on)::text AS measure, journey.package_name AS detail,
         jsonb_build_object('period', '1', 'issued', CASE WHEN issued.at IS NULL THEN '0' ELSE '1' END,
           'won', CASE WHEN EXISTS (SELECT 1 FROM crm_opportunity_proposals pr WHERE pr.workspace_id = p.ws AND pr.opportunity_id = journey.opportunity_id
                                     AND pr.kind = 'main' AND pr.won_at IS NOT NULL) THEN '1' ELSE '0' END) AS dims
    FROM journey CROSS JOIN p
    LEFT JOIN LATERAL (SELECT min(${stamp("q.detail->>'issuedAt'")}) AS at FROM commercial_quotes q
                        WHERE q.workspace_id = p.ws AND q.case_id = journey.case_id AND q.kind = 'quotation' AND COALESCE(q.round, 'main') = 'main'
                          AND (${stamp("q.detail->>'issuedAt'")} AT TIME ZONE p.tz)::date >= journey.approved_on) issued ON true
   WHERE journey.approved_on IS NOT NULL AND (journey.approved_on::timestamp AT TIME ZONE p.tz) >= p.from_at AND (journey.approved_on::timestamp AT TIME ZONE p.tz) < p.to_at
) facts ORDER BY at DESC`;

const proposal2Days: KpiSpec = {
  code: "design_to_proposal2_days",
  compare: "lower",
  facts: (ctx) => readFacts(ctx, PROPOSAL2_SQL),
  build: (ctx, facts) => {
    const days = mean(facts.filter((fact) => fact.dims.issued === "1" && fact.measure !== null).map((fact) => fact.measure!), 1);
    return {
      code: "design_to_proposal2_days", unit: "days", value: days, count: facts.filter((fact) => fact.dims.issued === "1").length, targetable: true,
      ...targetFor(ctx.targets, "design_to_proposal2_days", ctx.filters, days), extra: { approved: facts.length },
      chart: { type: "list", bucket: "issued=1" },
    };
  },
};

const proposal2Rate: KpiSpec = {
  code: "design_to_proposal2_rate",
  compare: "higher",
  facts: (ctx) => readFacts(ctx, PROPOSAL2_SQL),
  build: (ctx, facts: Fact[]) => {
    const won = facts.filter((fact) => fact.dims.won === "1").length;
    const rate = facts.length ? percent(won, facts.length) : null;
    return {
      code: "design_to_proposal2_rate", unit: "percent", value: rate, count: facts.length, targetable: true,
      ...targetFor(ctx.targets, "design_to_proposal2_rate", ctx.filters, rate), extra: { won, approved: facts.length },
      chart: { type: "list", bucket: "won=1" },
    };
  },
};

/** Designs approved: design projects whose design the client approved in the period (the approval's signed date). */
const approved: KpiSpec = {
  code: "designs_approved",
  compare: "higher",
  facts: (ctx) => readFacts(ctx, PROPOSAL2_SQL),
  build: (_ctx, facts) => ({ code: "designs_approved", unit: "count", value: String(facts.length), count: facts.length, targetable: false }),
};

export const DESIGN_PROJECTS: KpiSpec[] = [packageMix, approved, proposal2Days, proposal2Rate, byStage, workload("designer_workload", "designer"), overdue, revisions,
  workload("visualiser_workload", "visualiser")];

