import { describe, expect, it } from "vitest";
import { FURNITURE_PATHS, OPPORTUNITY_FLOWS, type FurniturePath, type OpportunityFlow } from "../opportunities/flow-gates";
import { validateFlowDefinition } from "./flow-definition";
import { columnOptional, legacyStepName, moveBlockers as interpretedBlockers, nextColumnPlan, type CheckFacts } from "./flow-interpreter";
import { STARTER_FLOWS } from "./starter-flows";

/*
 * Plan §5a, F2 "done when": the starter flows give the same results as the r30 gates for every flow × stage.
 * The r30 gates (commit f2cc9e9e, src/crm/opportunities/flow-gates.ts) are kept below, verbatim, only as the oracle.
 */
// ---------------------------------------------------------------- r30 oracle (verbatim) ----------------------------
/** The pipeline steps the gates know, in order. */
const FLOW_STEPS = ["new", "qualified", "proposal", "negotiation", "won"] as const;
type FlowStep = (typeof FLOW_STEPS)[number];

/** Stage codes of the default Sales pipeline mapped to their step ("qualified" is the New Opportunity column). */
const STEP_BY_STAGE_CODE: Record<string, FlowStep> = { qualified: "new", qualification: "qualified", proposal: "proposal", negotiation: "negotiation", won: "won" };

type FlowFacts = {
  flow: OpportunityFlow;
  /** False only when the opportunity came from an enquiry whose type is empty or "not sure yet". */
  enquiryTypeResolved: boolean;
  clientTypeResolved: boolean;
  clientEmail: boolean;
  propertyLocation: boolean;
  floorPlanOrArea: boolean;
  introCompleted: boolean;
  /** Everything the discovery form still lacks (PLM-040). */
  discoveryMissing: Array<{ key: string; label: string }>;
  furniturePath: FurniturePath | null;
  feasibilityConfirmed: boolean;
  quotationExists: boolean;
  paymentProof: boolean;
};

type MissingRequirement = { key: string; label: string; step: FlowStep };

/** The step a stage stands for: its code first, then its place (the first column is always New Opportunity). */
function stepForStage(stage: { code: string; position: number }, firstPosition: number): FlowStep | null {
  return STEP_BY_STAGE_CODE[stage.code] ?? (stage.position === firstPosition ? "new" : null);
}

/** What one step itself needs for a flow (not the steps before it). */
function stepRequirements(flow: OpportunityFlow, step: FlowStep, facts: FlowFacts): MissingRequirement[] {
  const missing: MissingRequirement[] = [];
  const need = (ok: boolean, key: string, label: string) => { if (!ok) missing.push({ key, label, step }); };
  // Every flow: an enquiry whose type is "not sure yet" stays in the first column (PLM-007).
  if (step === "qualified") need(facts.enquiryTypeResolved, "enquiryType", "Enquiry type chosen");
  if (step === "won") need(facts.paymentProof, "paymentProof", "Payment proof attached");
  if (flow === "design" || flow === "fit_out") {
    if (step === "new") {
      need(facts.clientEmail, "clientEmail", "Client email");
      need(facts.propertyLocation, "propertyLocation", "Property location");
      need(facts.floorPlanOrArea, "floorPlanOrArea", "Floor plan or area");
    }
    if (step === "qualified") {
      need(facts.introCompleted, "introMeeting", "Intro meeting completed");
      need(facts.clientTypeResolved, "clientType", "Client type chosen (not TBC)");
    }
    if (step === "proposal") {
      // Discovery facts already asked for by an earlier step are not listed twice.
      const earlier = new Set(["clientEmail", "propertyLocation", "enquiryType", "clientType"]);
      if (!facts.floorPlanOrArea) earlier.add("floorPlan").add("area");
      for (const item of facts.discoveryMissing) if (!earlier.has(item.key)) missing.push({ key: `discovery:${item.key}`, label: item.label, step });
    }
  }
  if (flow === "furniture") {
    if (step === "qualified") {
      need(Boolean(facts.furniturePath), "furniturePath", "Furniture sub-path chosen");
      need(facts.clientTypeResolved, "clientType", "Client type chosen (not TBC)");
      if (facts.furniturePath === "bespoke") need(facts.feasibilityConfirmed, "feasibility", "Feasibility confirmed by Factory/Technical");
    }
    if (step === "proposal") need(facts.quotationExists, "quotation", "Quotation prepared");
    // Negotiation is optional for furniture: it adds nothing, so Proposal → Won is allowed.
  }
  return missing;
}

/** Everything that must exist to stand on `target`: the requirements of every step up to and including it. */
function requirementsUpTo(flow: OpportunityFlow, target: FlowStep, facts: FlowFacts): MissingRequirement[] {
  const last = FLOW_STEPS.indexOf(target);
  return FLOW_STEPS.slice(0, last + 1).flatMap((step) => stepRequirements(flow, step, facts));
}

/**
 * What blocks a move. Backward moves and moves within the same place are always allowed; an unknown target
 * (a custom column) needs what the known steps before it need.
 */
function moveBlockers(input: {
  facts: FlowFacts;
  from: { code: string; position: number };
  to: { code: string; position: number };
  firstPosition: number;
  /** Stages of the pipeline, to place a custom column after the known steps before it. */
  stages: Array<{ code: string; position: number }>;
  targetStatus: string;
}): MissingRequirement[] {
  const { facts, from, to, firstPosition, stages, targetStatus } = input;
  if (targetStatus === "lost" || targetStatus === "abandoned") return [];
  if (targetStatus !== "won" && to.position <= from.position) return [];
  let target: FlowStep | null = targetStatus === "won" ? "won" : stepForStage(to, firstPosition);
  if (!target) {
    const before = stages.filter((stage) => stage.position < to.position).map((stage) => stepForStage(stage, firstPosition)).filter((step): step is FlowStep => Boolean(step));
    target = before.sort((a, b) => FLOW_STEPS.indexOf(b) - FLOW_STEPS.indexOf(a))[0] ?? null;
  }
  return target ? requirementsUpTo(facts.flow, target, facts) : [];
}

/** The next column's needs, for the opportunity's "Next step" card. */
function nextStepPlan(input: { facts: FlowFacts; current: FlowStep | null; status: string }) {
  const { facts, current, status } = input;
  if (status !== "open") return { next: null as FlowStep | null, missing: [] as MissingRequirement[], skippable: false };
  const index = current ? FLOW_STEPS.indexOf(current) : 0;
  let next: FlowStep | null = FLOW_STEPS[index + 1] ?? null;
  // Negotiation is optional for furniture: the next real step after Proposal is Won.
  const skippable = facts.flow === "furniture" && next === "negotiation";
  if (skippable) next = "won";
  return { next, missing: next ? requirementsUpTo(facts.flow, next, facts) : [], skippable };
}
// ---------------------------------------------------------------- end of r30 oracle ----------------------------------

const COLUMN_OF_STEP: Record<FlowStep, string> = { new: "qualified", qualified: "qualification", proposal: "proposal", negotiation: "negotiation", won: "won" };
const DISCOVERY_VARIANTS: Array<FlowFacts["discoveryMissing"]> = [
  [],
  [{ key: "question:style", label: "Style" }, { key: "spaces", label: "Number of spaces" }],
  [{ key: "floorPlan", label: "Floor plan" }, { key: "area", label: "Area" }, { key: "clientEmail", label: "Client email" }, { key: "propertyLocation", label: "Property location" },
    { key: "enquiryType", label: "Enquiry type" }, { key: "clientType", label: "Client type" }, { key: "question:budget", label: "Budget" }],
];
const BOOLEANS = ["enquiryTypeResolved", "clientTypeResolved", "clientEmail", "propertyLocation", "floorPlanOrArea", "introCompleted", "feasibilityConfirmed", "quotationExists", "paymentProof"] as const;

/** Representative fact sets: every combination of the r30 facts, with the sub-paths and discovery gaps that matter. */
function* factSets(flow: OpportunityFlow): Generator<FlowFacts> {
  const paths: Array<FurniturePath | null> = flow === "furniture" ? [null, ...FURNITURE_PATHS] : [null, "bespoke"];
  const discovery = flow === "design" || flow === "fit_out" ? DISCOVERY_VARIANTS : [[]];
  for (let mask = 0; mask < 1 << BOOLEANS.length; mask += 1)
    for (const furniturePath of paths)
      for (const discoveryMissing of discovery) {
        const flags = Object.fromEntries(BOOLEANS.map((name, bit) => [name, Boolean(mask & (1 << bit))])) as Record<(typeof BOOLEANS)[number], boolean>;
        yield { flow, ...flags, discoveryMissing, furniturePath };
      }
}

/** The same facts for the interpreter. The facts r30 never read alternate between all-off and all-on, which proves optional steps never gate. */
function checkFacts(facts: FlowFacts, extras: boolean): CheckFacts {
  return {
    ...facts, clientType: facts.clientTypeResolved ? "end_user" : null, budgetBand: extras ? "100k_250k" : null, contactLogged: extras,
    packageCode: extras ? "signature" : null, siteVisitRecorded: extras, qsApproved: extras, quoteSent: extras, quoteAccepted: extras,
    clientApprovedOnSpot: extras, paymentVerified: extras, dealApproved: extras, designStagesDone: extras ? ["site_visit"] : [], materialListSignedOff: extras,
  };
}

const STANDARD = [
  { code: "qualified", position: 1 }, { code: "qualification", position: 2 }, { code: "proposal", position: 3 },
  { code: "negotiation", position: 4 }, { code: "won", position: 5 }, { code: "lost", position: 6 },
];
/** A firm's own columns: a custom first column and a custom column between Proposal and Negotiation. */
const CUSTOM = [
  { code: "enquiry", position: 10 }, { code: "qualification", position: 20 }, { code: "proposal", position: 30 }, { code: "site_check", position: 35 },
  { code: "negotiation", position: 40 }, { code: "won", position: 50 }, { code: "lost", position: 60 },
];
const strip = (items: Array<{ key: string; label: string; step?: FlowStep; column?: string }>) =>
  items.map((item) => ({ key: item.key, label: item.label, column: item.column ?? COLUMN_OF_STEP[item.step!] }));

describe("starter flows ≡ r30 gates (plan §5a, F2)", () => {
  it("every starter flow passes the publisher's validator", () => {
    for (const [code, starter] of Object.entries(STARTER_FLOWS)) expect(validateFlowDefinition(starter.definition), code).toMatchObject({ ok: true });
  });

  it.each(OPPORTUNITY_FLOWS)("%s: every move between every pair of stages, for every fact set, is blocked by the same items", (flow) => {
    const definition = STARTER_FLOWS[flow].definition;
    let compared = 0;
    const mismatches: string[] = [];
    let extras = false;
    for (const facts of factSets(flow)) {
      extras = !extras;
      const interpreted = checkFacts(facts, extras);
      for (const stages of [STANDARD, CUSTOM]) {
        const firstPosition = stages[0].position;
        for (const from of stages.filter((stage) => !["won", "lost"].includes(stage.code)))
          for (const to of stages)
            for (const targetStatus of to.code === "won" ? ["won"] : to.code === "lost" ? ["lost"] : ["open", "abandoned"]) {
              const expected = strip(moveBlockers({ facts, from, to, firstPosition, stages, targetStatus }));
              const actual = strip(interpretedBlockers({ definition, facts: interpreted, from, to, firstPosition, stages, targetStatus }));
              compared += 1;
              if (JSON.stringify(actual) !== JSON.stringify(expected) && mismatches.length < 5)
                mismatches.push(`${from.code}→${to.code} (${targetStatus}) ${JSON.stringify(facts)}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
            }
      }
    }
    expect(mismatches).toEqual([]);
    expect(compared).toBeGreaterThan(10_000);
  });

  it.each(OPPORTUNITY_FLOWS)("%s: the next step, what it needs and whether a column is skipped are the same", (flow) => {
    const definition = STARTER_FLOWS[flow].definition;
    const mismatches: string[] = [];
    let extras = false;
    for (const facts of factSets(flow)) {
      extras = !extras;
      for (const current of [null, ...FLOW_STEPS])
        for (const status of ["open", "won", "lost"]) {
          const expected = nextStepPlan({ facts, current, status });
          const column = current === null ? null : definition.columns.indexOf(COLUMN_OF_STEP[current]);
          const actual = nextColumnPlan({ definition, facts: checkFacts(facts, extras), current: column, status });
          const same = legacyStepName(actual.next === null ? null : definition.columns[actual.next]) === expected.next
            && JSON.stringify(strip(actual.missing)) === JSON.stringify(strip(expected.missing)) && actual.skippable === expected.skippable;
          if (!same && mismatches.length < 5) mismatches.push(`${current} ${status} ${JSON.stringify(facts)}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
        }
    }
    expect(mismatches).toEqual([]);
  });

  it.each(OPPORTUNITY_FLOWS)("%s: only furniture's Negotiation is optional, as in r30", (flow) => {
    const definition = STARTER_FLOWS[flow].definition;
    definition.columns.forEach((code, index) => expect(columnOptional(definition, index), code).toBe(flow === "furniture" && code === "negotiation"));
  });
});
