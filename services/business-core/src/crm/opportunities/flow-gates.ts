/**
 * PLM-121 / PLM-122: the sales pipeline moves one step at a time, and what each step needs depends on the
 * enquiry type's flow (configured per enquiry type in Settings). Pure: facts in, missing items out.
 *
 * Steps are cumulative: moving to Proposal needs everything New Opportunity and Qualified need too, so a jump of
 * several columns is checked against every step it passes. Moving back is always allowed.
 */
export const OPPORTUNITY_FLOWS = ["furniture", "design", "fit_out", "basic"] as const;
export type OpportunityFlow = (typeof OPPORTUNITY_FLOWS)[number];

export const FURNITURE_PATHS = ["take_home_now", "in_stock_delivery", "supplier_order", "core_collection_factory", "bespoke"] as const;
export type FurniturePath = (typeof FURNITURE_PATHS)[number];

/** What a payment proof is (PLM-122): a receipt, a card slip, a transfer, a cash sheet or a photo. */
export const PAYMENT_PROOF_KINDS = ["receipt", "card_slip", "bank_transfer", "cash_sheet", "photo", "other"] as const;
export type PaymentProofKind = (typeof PAYMENT_PROOF_KINDS)[number];

/** The pipeline steps the gates know, in order. */
export const FLOW_STEPS = ["new", "qualified", "proposal", "negotiation", "won"] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];

/** Stage codes of the default Sales pipeline mapped to their step ("qualified" is the New Opportunity column). */
const STEP_BY_STAGE_CODE: Record<string, FlowStep> = { qualified: "new", qualification: "qualified", proposal: "proposal", negotiation: "negotiation", won: "won" };

export type FlowFacts = {
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

export type MissingRequirement = { key: string; label: string; step: FlowStep };

/** The step a stage stands for: its code first, then its place (the first column is always New Opportunity). */
export function stepForStage(stage: { code: string; position: number }, firstPosition: number): FlowStep | null {
  return STEP_BY_STAGE_CODE[stage.code] ?? (stage.position === firstPosition ? "new" : null);
}

/** An unset or unknown flow is the basic one. */
export function flowOf(value: unknown): OpportunityFlow {
  return OPPORTUNITY_FLOWS.includes(value as OpportunityFlow) ? value as OpportunityFlow : "basic";
}

/** A suggested flow for an enquiry type from its code or label; the administrator confirms it in Settings. */
export function suggestedFlow(text: string): OpportunityFlow {
  const value = text.toLowerCase();
  if (/furniture/.test(value) && !/design/.test(value)) return "furniture";
  if (/design|concept/.test(value)) return "design";
  if (/fit[\s_-]?out|renovation|joinery/.test(value)) return "fit_out";
  return "basic";
}

/** A client type is decided once it is set and not a placeholder such as TBC. */
export function clientTypeDecided(value: string | null | undefined) {
  const code = value?.trim().toLowerCase() ?? "";
  return Boolean(code) && !["tbc", "not_sure", "unknown", "to_be_confirmed"].includes(code);
}

/** What one step itself needs for a flow (not the steps before it). */
export function stepRequirements(flow: OpportunityFlow, step: FlowStep, facts: FlowFacts): MissingRequirement[] {
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
export function requirementsUpTo(flow: OpportunityFlow, target: FlowStep, facts: FlowFacts): MissingRequirement[] {
  const last = FLOW_STEPS.indexOf(target);
  return FLOW_STEPS.slice(0, last + 1).flatMap((step) => stepRequirements(flow, step, facts));
}

/**
 * What blocks a move. Backward moves and moves within the same place are always allowed; an unknown target
 * (a custom column) needs what the known steps before it need.
 */
export function moveBlockers(input: {
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
export function nextStepPlan(input: { facts: FlowFacts; current: FlowStep | null; status: string }) {
  const { facts, current, status } = input;
  if (status !== "open") return { next: null as FlowStep | null, missing: [] as MissingRequirement[], skippable: false };
  const index = current ? FLOW_STEPS.indexOf(current) : 0;
  let next: FlowStep | null = FLOW_STEPS[index + 1] ?? null;
  // Negotiation is optional for furniture: the next real step after Proposal is Won.
  const skippable = facts.flow === "furniture" && next === "negotiation";
  if (skippable) next = "won";
  return { next, missing: next ? requirementsUpTo(facts.flow, next, facts) : [], skippable };
}
