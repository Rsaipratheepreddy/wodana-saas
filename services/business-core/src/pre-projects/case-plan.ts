import type { PoolClient } from "pg";
import type { FlowDefinition, FlowStepDefinition } from "../crm/flows/flow-definition";
import { areasFor, loadWonAreas, type WonArea } from "../crm/flows/flow-won-areas";
import type { FurniturePath } from "../crm/opportunities/flow-gates";
import { FURNITURE_RULES, isFurnitureFlow, loadRules, ruleFor, type FulfilmentRule, type RuleSettings } from "../fulfilment/fulfilment-rules";
import { engagementPhases, type EngagementPhase } from "./engagement-lifecycle";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-121/126/098: what a planning case goes through before its order is released, from the job's configuration —
 * its enquiry type's flow (the steps on its path), the path's fulfilment rule and the areas it uses after Won. Never
 * from an enquiry type's name.
 *   phases     the planning phases the case shows, in order (the stage list and the next step follow them)
 *   siteVisit  the case runs a site visit (measurements, photos) before it is priced
 *   design     the case runs the design stages (moodboard, concepts, renders)
 *   release    what the agreed order goes to: production, or fulfilment from stock or a supplier
 * A job whose path has no rule that says where its goods come from keeps the full planning journey, so an enquiry
 * type without path configuration sees exactly what it saw before.
 */
export type CasePlan = {
  source: "default" | "path";
  phases: EngagementPhase[];
  siteVisit: boolean;
  design: boolean;
  release: "production" | "fulfilment";
};

export const FULL_PLAN: CasePlan = { source: "default", phases: [...engagementPhases], siteVisit: true, design: true, release: "production" };

const DESIGN_DELIVERABLES = new Set(["inspiration", "concepts", "space_planning", "renders", "approval"]);

/** A step that asks for a site visit: the sales visit, or the design journey's site visit stage. */
export const asksSiteVisit = (step: Pick<FlowStepDefinition, "check" | "designStage">) =>
  step.check === "site_visit_recorded" || (step.check === "design_stage_done" && step.designStage === "site_visit");

/** A step that asks for design work: a design package, or one of the design deliverable stages. */
export const asksDesign = (step: Pick<FlowStepDefinition, "check" | "designStage">) =>
  step.check === "package_chosen" || (step.check === "design_stage_done" && DESIGN_DELIVERABLES.has(step.designStage ?? ""));

/**
 * The steps a job on this path can meet: the main line, the sub-path branch's answer for its path, and every answer
 * of any other branch (their answers aren't known from the path alone).
 */
export function pathSteps(definition: FlowDefinition, path: FurniturePath | null): FlowStepDefinition[] {
  const steps: FlowStepDefinition[] = [];
  for (const step of definition.steps) {
    steps.push(step);
    for (const branch of definition.branches.filter((candidate) => candidate.after === step.key)) {
      const answers = branch.question === "subPath" ? branch.answers.filter((answer) => answer.value === path) : branch.answers;
      steps.push(...answers.flatMap((answer) => answer.steps));
    }
  }
  return steps;
}

export type PlanInput = {
  definition: FlowDefinition | null;
  path: FurniturePath | null;
  /** The path's fulfilment rule with the order's own BOQ choice applied; null when the flow has none. */
  rule: RuleSettings | null;
  /** The areas the path uses after Won when the firm set them; null when it didn't. */
  areas: WonArea[] | null;
  /** The case's design journey, when one has started: what already exists always shows. */
  journey: "design" | "site_and_materials" | null;
};

/**
 * The plan from configuration. Goods taken from stock or bought in from a supplier (the rule holds or takes them at
 * the quote, the supplier's delivery, Won or fulfilment) go straight to the quotation, the agreement and payment,
 * then fulfilment. Goods made to order without a BOQ do the same and go to production. Either kind still gets a site
 * visit or design stages when the path's steps ask for them, and scope confirmation when the order needs a BOQ.
 * Anything else (made to order with a BOQ, or no rule at all) keeps the full journey.
 */
export function planFor(input: PlanInput): CasePlan {
  const rule = input.rule;
  if (!rule) return FULL_PLAN;
  const production = rule.reserveOn === "production_booked" || rule.deductOn === "production_started";
  const readyMade = !production && (["quote_accepted", "supplier_received"].includes(rule.reserveOn) || ["won", "fulfilled"].includes(rule.deductOn));
  if (!readyMade && !(production && rule.boqRequired === false)) return FULL_PLAN;
  const asked = (input.definition ? pathSteps(input.definition, input.path) : []).filter((step) => !step.auto);
  const siteVisit = asked.some(asksSiteVisit) || input.journey === "site_and_materials";
  const design = asked.some(asksDesign) || input.journey === "design";
  const phases: EngagementPhase[] = [
    ...(design ? ["discover" as const] : []),
    ...(rule.boqRequired === true ? ["define" as const] : []),
    ...(siteVisit || design ? ["design" as const] : []),
    "price", "agree", "release",
  ];
  // A made-to-order path the firm set to skip the factory after Won is fulfilled like ready-made goods.
  const toProduction = production && !(input.areas && !input.areas.includes("production"));
  return { source: "path", phases, siteVisit, design, release: toProduction ? "production" : "fulfilment" };
}

type CaseRow = {
  caseId: string; flowId: string | null; definition: FlowDefinition | null; furniturePath: FurniturePath | null; boqOverride: boolean | null;
  journeyKind: "design" | "site_and_materials" | null;
};

/**
 * The plans of several cases in one read: each case's job flow (the version it pinned, else its enquiry type's latest),
 * its furniture path, the order's own BOQ choice and its design journey. Read only: it never pins a version or seeds
 * rules (a furniture flow without rules reads the product defaults, as `ensureRules` would write them).
 */
export async function casePlans(db: Db, workspaceId: string, caseIds: string[]): Promise<Map<string, CasePlan>> {
  const plans = new Map<string, CasePlan>();
  if (!caseIds.length) return plans;
  const rows = (await db.query<CaseRow>(
    `SELECT pre_case.id AS "caseId", coalesce(pinned.flow_id, typed.id) AS "flowId", coalesce(pinned.definition, latest.definition) AS definition,
            opportunity.furniture_path AS "furniturePath", deal.boq_required AS "boqOverride",
            CASE WHEN journey.case_id IS NULL THEN NULL WHEN journey.package_id IS NOT NULL OR journey.package_name IS NOT NULL THEN 'design' ELSE 'site_and_materials' END AS "journeyKind"
       FROM pre_project_cases pre_case
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN crm_flow_versions pinned ON pinned.workspace_id = opportunity.workspace_id AND pinned.id = opportunity.flow_version_id
       LEFT JOIN crm_leads lead ON lead.workspace_id = opportunity.workspace_id AND lead.id = opportunity.lead_id
       LEFT JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
       LEFT JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = opportunity.workspace_id AND taxonomy.code = 'enquiry_type'
       LEFT JOIN crm_taxonomy_options choice ON choice.workspace_id = taxonomy.workspace_id AND choice.taxonomy_id = taxonomy.id AND choice.code = enquiry.service_type
       LEFT JOIN crm_flows typed ON typed.workspace_id = opportunity.workspace_id AND typed.code = choice.flow AND typed.status = 'active'
       LEFT JOIN LATERAL (SELECT version.definition FROM crm_flow_versions version WHERE version.workspace_id = typed.workspace_id AND version.flow_id = typed.id
                           ORDER BY version.version DESC LIMIT 1) latest ON pinned.id IS NULL
       LEFT JOIN crm_deal_fulfilment deal ON deal.workspace_id = opportunity.workspace_id AND deal.opportunity_id = opportunity.id
       LEFT JOIN design_journeys journey ON journey.workspace_id = pre_case.workspace_id AND journey.case_id = pre_case.id
      WHERE pre_case.workspace_id = $1 AND pre_case.id = ANY($2::uuid[])`, [workspaceId, caseIds])).rows;
  const rules = new Map<string, FulfilmentRule[]>();
  const areas = new Map<string, Awaited<ReturnType<typeof loadWonAreas>>>();
  for (const row of rows) {
    if (!row.flowId) { plans.set(row.caseId, FULL_PLAN); continue; }
    if (!rules.has(row.flowId)) {
      const own = await loadRules(db, workspaceId, row.flowId);
      rules.set(row.flowId, own.length || !(await isFurnitureFlow(db, workspaceId, row.flowId)) ? own : FURNITURE_RULES.map((rule) => ({ ...rule, version: 0 })));
      areas.set(row.flowId, await loadWonAreas(db, workspaceId, row.flowId));
    }
    const flowRules = rules.get(row.flowId)!;
    const settings = flowRules.length ? ruleFor(flowRules, row.furniturePath) : null;
    const wonRules = areas.get(row.flowId)!;
    plans.set(row.caseId, planFor({
      definition: row.definition, path: row.furniturePath,
      rule: settings ? { ...settings, boqRequired: row.boqOverride ?? settings.boqRequired } : null,
      areas: wonRules.length ? areasFor(wonRules, row.furniturePath) : null,
      journey: row.journeyKind,
    }));
  }
  for (const id of caseIds) if (!plans.has(id)) plans.set(id, FULL_PLAN);
  return plans;
}

export async function casePlan(db: Db, workspaceId: string, caseId: string): Promise<CasePlan> {
  return (await casePlans(db, workspaceId, [caseId])).get(caseId) ?? FULL_PLAN;
}
