import { Dec } from "../catalog-core/decimal";
import { type KpiSpec, readFacts } from "./report-context";
import { type Fact, FACT_COLUMNS, categories, groupBy, inPeriod, mean, percent, weekKeys } from "./report-kit";
import { LEADS, P, leadsCte, week } from "./report-scope";
import { targetFor } from "./report-targets";

/**
 * Dashboard 3 · Lead response (PLM-129, PLM-095). Every definition here is also written in the master plan (§6.27a).
 *
 * The response clock is the enquiry's first-response SLA (the first cycle only): it starts when the enquiry is
 * received and stops at the first verified human contact. Its target and its working calendar are the workspace's
 * first-response policy (e.g. 60 minutes on Mon–Sun 9:00–18:00 in the workspace's time zone) — configuration, frozen
 * on each clock when it starts. Elapsed minutes are working minutes when the policy counts business hours.
 *
 * Each clock's outcome:
 *   met — a response was logged within the target (elapsed working minutes ≤ the target);
 *   missed — a response came later, or the target passed with no response (still open, or closed after the target);
 *   open — still running inside its target, or closed before its target without needing a response (spam,
 *     duplicate, converted) — left out of the rate.
 * The Account Manager filter applies to whoever held the clock (its owner), not to the enquiry's owner today.
 */
export const SLA_SQL = `WITH ${P}, ${leadsCte(false)},
clock AS (
  SELECT i.lead_id, i.started_at, i.due_at, i.responded_at, i.response_elapsed_minutes, i.owner_membership_id, i.calculation_mode,
         CASE WHEN (i.policy_snapshot->>'breachAfterMinutes') ~ '^[0-9]+$' THEN (i.policy_snapshot->>'breachAfterMinutes')::int END AS target_minutes,
         CASE
           WHEN i.responded_at IS NOT NULL THEN CASE
             WHEN i.response_elapsed_minutes IS NOT NULL AND (i.policy_snapshot->>'breachAfterMinutes') ~ '^[0-9]+$'
               THEN CASE WHEN i.response_elapsed_minutes <= (i.policy_snapshot->>'breachAfterMinutes')::int THEN 'met' ELSE 'missed' END
             WHEN i.responded_at <= i.due_at THEN 'met' ELSE 'missed' END
           WHEN i.status IN ('active', 'warning', 'breached', 'paused') AND i.due_at <= p.now_at THEN 'missed'
           WHEN i.status = 'stopped' AND i.stopped_at > i.due_at THEN 'missed'
           ELSE 'open' END AS outcome
    FROM crm_sla_instances i CROSS JOIN p
   WHERE i.workspace_id = p.ws AND i.target_type = 'lead' AND i.event_type = 'first_response' AND i.cycle = 1
     AND i.started_at >= least(p.from_at, p.week_from_at) AND i.started_at < p.to_at
     AND (p.am IS NULL OR i.owner_membership_id = p.am)
)
SELECT ${FACT_COLUMNS} FROM (
  SELECT lc.lead_id::text AS id, 'lead' AS kind, NULL::text AS parent_id, lc.reference, lc.title, lc.client,
         COALESCE(NULLIF(btrim(owner_user.display_name), ''), owner_user.primary_email) AS owner, clock.owner_membership_id::text AS owner_id,
         clock.started_at AS at, NULL::text AS amount,
         CASE WHEN clock.responded_at IS NOT NULL AND clock.response_elapsed_minutes IS NOT NULL THEN round(clock.response_elapsed_minutes::numeric / 60, 4)::text END AS measure,
         clock.outcome AS detail,
         jsonb_build_object('period', CASE WHEN clock.started_at >= p.from_at THEN '1' ELSE '0' END, 'week', ${week("clock.started_at")}, 'outcome', clock.outcome,
           'am', COALESCE(clock.owner_membership_id::text, 'none'), 'mode', clock.calculation_mode, 'target', clock.target_minutes, 'source', lc.source) AS dims
    FROM clock CROSS JOIN p JOIN lc ON lc.lead_id = clock.lead_id
    LEFT JOIN workspace_memberships owner_member ON owner_member.workspace_id = p.ws AND owner_member.id = clock.owner_membership_id
    LEFT JOIN users owner_user ON owner_user.id = owner_member.user_id
) facts ORDER BY at DESC`;

/** Met ÷ (met + missed) × 100, one decimal; null when no clock has an outcome yet. */
export function responseRate(facts: Fact[]) {
  const decided = facts.filter((fact) => fact.dims.outcome === "met" || fact.dims.outcome === "missed");
  return decided.length ? percent(decided.filter((fact) => fact.dims.outcome === "met").length, decided.length) : null;
}

/** The target the policy set (minutes) and how it counts, when every clock in the period shares one. */
function policyNote(facts: Fact[]) {
  const targets = [...new Set(facts.map((fact) => fact.dims.target).filter(Boolean))];
  const modes = [...new Set(facts.map((fact) => fact.dims.mode).filter(Boolean))];
  return { target: targets.length === 1 ? targets[0] : undefined, mode: modes.length === 1 ? modes[0] : null };
}

const responseRateKpi: KpiSpec = {
  code: "response_rate",
  facts: (ctx) => readFacts(ctx, SLA_SQL),
  build: (ctx, facts) => {
    const period = facts.filter(inPeriod);
    const rate = responseRate(period);
    const keys = weekKeys(ctx.filters, ctx.weekStart);
    const target = targetFor(ctx.targets, "response_rate", ctx.filters, rate);
    const policy = policyNote(period);
    return {
      code: "response_rate", unit: "percent", value: rate, count: period.filter((fact) => fact.dims.outcome !== "open").length, targetable: true, ...target,
      extra: { met: period.filter((fact) => fact.dims.outcome === "met").length, missed: period.filter((fact) => fact.dims.outcome === "missed").length, mode: policy.mode },
      notes: policy.target ? { target: policy.target } : undefined,
      chart: { type: "lines", dimension: "week", categories: categories(keys), series: [{ id: "rate", label: "Response rate" }],
        values: [keys.map((key) => responseRate(facts.filter((fact) => fact.dims.week === key)))], unit: "percent" },
    };
  },
};

/** Average first-response time: the mean of the period's responded clocks' elapsed working minutes, in hours. */
const firstResponseKpi: KpiSpec = {
  code: "first_response_hours",
  facts: async (ctx) => (await readFacts(ctx, SLA_SQL)).filter((fact) => inPeriod(fact) && fact.measure !== null),
  build: (ctx, facts) => {
    const average = mean(facts.map((fact) => fact.measure!), 2);
    const groups = groupBy(facts, "am", (fact) => fact.owner ?? "", 2)
      .map((group) => ({ ...group, average: mean(group.facts.map((fact) => fact.measure!), 2) ?? "0" }))
      .sort((a, b) => Dec.of(a.average).cmp(b.average));
    return {
      code: "first_response_hours", unit: "hours", value: average, count: facts.length, targetable: true,
      ...targetFor(ctx.targets, "first_response_hours", ctx.filters, average),
      extra: { mode: policyNote(facts).mode },
      chart: { type: "bars", dimension: "am", unit: "hours", items: groups.map((group) => ({
        key: group.key, label: group.label, value: group.average, count: group.count,
        target: group.key === "none" ? null : targetFor(ctx.targets, "first_response_hours", { ...ctx.filters, accountManager: group.key }, group.average, group.key).target ?? null,
      })) },
    };
  },
};

/**
 * Reassignments: enquiries the takeover rule moved to someone else because nobody logged a call or a note before the
 * ownership deadline (PLM-095 / PLM-039), in the period, by the Account Manager it moved from. A takeover that found
 * nobody else (the enquiry stayed and was escalated) is not a move and isn't counted.
 */
const REASSIGNED_SQL = `WITH ${P}, ${leadsCte(false)}
SELECT ${FACT_COLUMNS} FROM (
  SELECT h.id::text AS id, 'lead' AS kind, NULL::text AS parent_id, lc.reference, lc.title, lc.client,
         COALESCE(NULLIF(btrim(from_user.display_name), ''), from_user.primary_email) AS owner, h.previous_owner_membership_id::text AS owner_id,
         h.assigned_at AS at, NULL::text AS amount, NULL::text AS measure, COALESCE(NULLIF(btrim(to_user.display_name), ''), to_user.primary_email) AS detail,
         jsonb_build_object('period', '1', 'am', COALESCE(h.previous_owner_membership_id::text, 'none')) AS dims
    FROM crm_assignment_history h CROSS JOIN p
    JOIN lc ON lc.lead_id = h.lead_id
    LEFT JOIN workspace_memberships from_member ON from_member.workspace_id = p.ws AND from_member.id = h.previous_owner_membership_id
    LEFT JOIN users from_user ON from_user.id = from_member.user_id
    LEFT JOIN workspace_memberships to_member ON to_member.workspace_id = p.ws AND to_member.id = h.owner_membership_id
    LEFT JOIN users to_user ON to_user.id = to_member.user_id
   WHERE h.workspace_id = p.ws AND h.explanation->>'reason' = 'unanswered_takeover'
     AND h.owner_membership_id IS DISTINCT FROM h.previous_owner_membership_id
     AND h.assigned_at >= p.from_at AND h.assigned_at < p.to_at
     AND (p.am IS NULL OR h.previous_owner_membership_id = p.am)
) facts ORDER BY at DESC`;

const reassignments: KpiSpec = {
  code: "reassignments",
  facts: (ctx) => readFacts(ctx, REASSIGNED_SQL),
  build: (ctx, facts) => ({
    code: "reassignments", unit: "count", value: String(facts.length), count: facts.length, targetable: false,
    chart: { type: "bars", dimension: "am", unit: "count", items: groupBy(facts, "am", (fact) => fact.owner ?? "", ctx.places)
      .sort((a, b) => b.count - a.count).map((group) => ({ key: group.key, label: group.label, value: String(group.count), count: group.count })) },
  }),
};

/** Unassigned leads, live: open enquiries (not spam, not closed) with nobody responsible. */
const UNASSIGNED_SQL = `WITH ${P}, ${LEADS}
SELECT ${FACT_COLUMNS} FROM (
  SELECT lc.lead_id::text AS id, 'lead' AS kind, NULL::text AS parent_id, lc.reference, lc.title, lc.client, NULL::text AS owner, NULL::text AS owner_id,
         lc.created_at AS at, NULL::text AS amount, round(extract(epoch FROM p.now_at - lc.created_at)::numeric / 3600, 1)::text AS measure, lc.source || ' / ' || lc.channel AS detail,
         jsonb_build_object('period', '1') AS dims
    FROM lc CROSS JOIN p WHERE lc.am IS NULL AND lc.status IN ('new', 'attempting_contact', 'connected', 'nurturing', 'paused')
) facts ORDER BY at`;

const unassigned: KpiSpec = {
  code: "unassigned_leads",
  facts: (ctx) => readFacts(ctx, UNASSIGNED_SQL),
  build: (_ctx, facts) => ({ code: "unassigned_leads", unit: "count", value: String(facts.length), count: facts.length, targetable: false, chart: { type: "list", bucket: "period=1" } }),
};

export const LEAD_RESPONSE: KpiSpec[] = [responseRateKpi, firstResponseKpi, reassignments, unassigned];
