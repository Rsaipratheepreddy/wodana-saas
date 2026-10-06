import type { FurniturePath } from "../opportunities/flow-gates";
import { allSteps, canSkipStep, WON_COLUMN, type BranchQuestion, type FlowCheck, type FlowDefinition, type FlowField, type FlowStepDefinition } from "./flow-definition";

/**
 * Plan §5a, engine rules: the interpreter reads a job's facts (from real records) against its pinned flow
 * definition. Pure: definition and facts in; the resolved line, the current step and what a move still needs out.
 *
 * - A step is done when its `needs` are present and its check passes.
 * - Standing in a column needs every required step that enters that column or an earlier one (cumulative), so a
 *   jump of several columns is checked against every step in between. Moves backward and to Lost are always allowed.
 * - A branch adds the steps of the answer the records give; an unanswered question adds none (the step that asks it
 *   is what is missing).
 */
export type CheckFacts = {
  /** False only when the job came from an enquiry whose type is empty or "not sure yet". */
  enquiryTypeResolved: boolean;
  clientTypeResolved: boolean;
  clientType: string | null;
  clientEmail: boolean;
  propertyLocation: boolean;
  floorPlanOrArea: boolean;
  budgetBand: string | null;
  contactLogged: boolean;
  introCompleted: boolean;
  /** Everything the discovery form still lacks (PLM-040). */
  discoveryMissing: Array<{ key: string; label: string }>;
  furniturePath: FurniturePath | null;
  feasibilityConfirmed: boolean;
  packageCode: string | null;
  siteVisitRecorded: boolean;
  quotationExists: boolean;
  qsApproved: boolean;
  quoteSent: boolean;
  quoteAccepted: boolean;
  clientApprovedOnSpot: boolean;
  paymentProof: boolean;
  paymentVerified: boolean;
  dealApproved: boolean;
  designStagesDone: string[];
  materialListSignedOff: boolean;
  /** Who completed a check and when, where the records say. */
  evidence?: Partial<Record<FlowCheck, { at: string | Date | null; by: string | null }>>;
  /** E2-5 / PLM-081: steps this job marked as not needed, by step key, with the reason, who and when. */
  skippedSteps?: Record<string, StepSkip>;
};

export type StepSkip = { reason: string; by: string | null; at: string | Date | null };

/** A recorded skip counts only for a step the type lets a job skip (optional, or material selection). */
const skipOf = (step: FlowStepDefinition, facts: CheckFacts) => canSkipStep(step) ? facts.skippedSteps?.[step.key] ?? null : null;

export type MissingRequirement = { key: string; label: string; column: string; stepKey: string };

const FIELD: Record<FlowField, { label: string; present: (facts: CheckFacts) => boolean }> = {
  enquiryType: { label: "Enquiry type chosen", present: (facts) => facts.enquiryTypeResolved },
  clientEmail: { label: "Client email", present: (facts) => facts.clientEmail },
  propertyLocation: { label: "Property location", present: (facts) => facts.propertyLocation },
  floorPlanOrArea: { label: "Floor plan or area", present: (facts) => facts.floorPlanOrArea },
  budget: { label: "Budget", present: (facts) => Boolean(facts.budgetBand) },
};

type SimpleCheck = Exclude<FlowCheck, "details_complete" | "discovery_complete" | "design_stage_done">;
const CHECK: Record<SimpleCheck, { key: string; label: string; done: (facts: CheckFacts) => boolean }> = {
  contact_logged: { key: "contact", label: "Contact logged", done: (facts) => facts.contactLogged },
  intro_meeting_completed: { key: "introMeeting", label: "Intro meeting completed", done: (facts) => facts.introCompleted },
  client_type_set: { key: "clientType", label: "Client type chosen (not TBC)", done: (facts) => facts.clientTypeResolved },
  sub_path_chosen: { key: "furniturePath", label: "Furniture sub-path chosen", done: (facts) => Boolean(facts.furniturePath) },
  feasibility_confirmed: { key: "feasibility", label: "Feasibility confirmed by Factory/Technical", done: (facts) => facts.feasibilityConfirmed },
  package_chosen: { key: "package", label: "Design package chosen", done: (facts) => Boolean(facts.packageCode) },
  site_visit_recorded: { key: "siteVisit", label: "Site visit recorded", done: (facts) => facts.siteVisitRecorded },
  quote_exists: { key: "quotation", label: "Quotation prepared", done: (facts) => facts.quotationExists },
  qs_approved: { key: "qsApproval", label: "Quotation approved by the QS", done: (facts) => facts.qsApproved },
  quote_sent: { key: "quoteSent", label: "Quotation sent to the client", done: (facts) => facts.quoteSent },
  client_accepted: { key: "clientAccepted", label: "Client accepted the quotation", done: (facts) => facts.quoteAccepted },
  client_approved_on_spot: { key: "clientApproval", label: "Client approved on the spot", done: (facts) => facts.clientApprovedOnSpot },
  payment_proof_attached: { key: "paymentProof", label: "Payment proof attached", done: (facts) => facts.paymentProof },
  payment_verified: { key: "paymentVerified", label: "Payment verified by Finance", done: (facts) => facts.paymentVerified },
  deal_approved: { key: "dealApproved", label: "Deal approved", done: (facts) => facts.dealApproved },
  material_list_signed_off: { key: "materialList", label: "Material list signed off", done: (facts) => facts.materialListSignedOff },
};

const DESIGN_STAGE_LABELS: Record<string, string> = {
  inspiration: "Inspiration", site_visit: "Site visit", concepts: "Concepts", space_planning: "Space planning",
  material_selection: "Material selection", renders: "Renders", approval: "Design approval",
};

/** The pipeline step names the r30 API returned for the standard columns (kept for existing clients). */
const LEGACY_STEP_BY_COLUMN: Record<string, string> = { qualified: "new", qualification: "qualified", proposal: "proposal", negotiation: "negotiation", won: "won" };
export const legacyStepName = (column: string | null) => column === null ? null : LEGACY_STEP_BY_COLUMN[column] ?? column;

/** The answer the records give to a branch question, or null while it is unanswered. */
export function branchAnswer(question: BranchQuestion, facts: CheckFacts): string | null {
  if (question === "subPath") return facts.furniturePath;
  if (question === "package") return facts.packageCode;
  if (question === "budgetBand") return facts.budgetBand;
  return facts.clientTypeResolved ? facts.clientType : null;
}

/** The job's line: the main steps with, after each branch point, the steps of the answer the records give. */
export function resolveLine(definition: FlowDefinition, facts: CheckFacts): FlowStepDefinition[] {
  const line: FlowStepDefinition[] = [];
  for (const step of definition.steps) {
    line.push(step);
    const branch = definition.branches.find((candidate) => candidate.after === step.key);
    if (!branch) continue;
    const answer = branchAnswer(branch.question, facts);
    const chosen = answer === null ? undefined : branch.answers.find((candidate) => candidate.value === answer);
    if (chosen) line.push(...chosen.steps);
  }
  return line;
}

/** Discovery items an earlier step on the line already asks for, so they are not listed twice. */
function coveredByEarlier(earlier: FlowStepDefinition[], facts: CheckFacts) {
  const covered = new Set<string>();
  for (const step of earlier) {
    for (const field of step.needs ?? []) {
      if (field === "floorPlanOrArea") { if (!facts.floorPlanOrArea) covered.add("floorPlan").add("area"); }
      else covered.add(field);
    }
    if (step.check === "client_type_set") covered.add("clientType");
  }
  return covered;
}

/** What one step still lacks (its own needs and check), given the steps before it on the line. */
export function stepMissing(step: FlowStepDefinition, facts: CheckFacts, earlier: FlowStepDefinition[]): Array<{ key: string; label: string }> {
  // Auto-passed on this path, or marked not needed for this job with a reason (E2-5, PLM-081).
  if (step.auto || skipOf(step, facts)) return [];
  const missing: Array<{ key: string; label: string }> = [];
  for (const field of step.needs ?? []) if (!FIELD[field].present(facts)) missing.push({ key: field, label: FIELD[field].label });
  if (step.check === "details_complete") return missing;
  if (step.check === "discovery_complete") {
    const covered = coveredByEarlier(earlier, facts);
    for (const item of facts.discoveryMissing) if (!covered.has(item.key)) missing.push({ key: `discovery:${item.key}`, label: item.label });
    return missing;
  }
  if (step.check === "design_stage_done") {
    const stage = step.designStage ?? "";
    if (!facts.designStagesDone.includes(stage)) missing.push({ key: `designStage:${stage}`, label: `${DESIGN_STAGE_LABELS[stage] ?? stage} done` });
    return missing;
  }
  const check = CHECK[step.check];
  if (!check.done(facts)) missing.push({ key: check.key, label: check.label });
  return missing;
}

/** The column a pipeline stage stands for: its code first, then its place (the first column is always the first). */
export function columnOfStage(definition: FlowDefinition, stage: { code: string; position: number }, firstPosition: number): number | null {
  const index = definition.columns.indexOf(stage.code);
  if (index >= 0) return index;
  return stage.position === firstPosition ? 0 : null;
}

/** Everything that must exist to stand on a column: every required step entering it or an earlier column. */
export function requirementsUpTo(definition: FlowDefinition, facts: CheckFacts, column: number): MissingRequirement[] {
  const line = resolveLine(definition, facts);
  const missing: MissingRequirement[] = [];
  line.forEach((step, index) => {
    if (step.optional || definition.columns.indexOf(step.column) > column) return;
    for (const item of stepMissing(step, facts, line.slice(0, index))) missing.push({ ...item, column: step.column, stepKey: step.key });
  });
  return missing;
}

/** A column is optional when steps enter it and every one of them is optional (e.g. furniture Negotiation). */
export function columnOptional(definition: FlowDefinition, column: number) {
  const code = definition.columns[column];
  const entering = allSteps(definition).filter((step) => step.column === code);
  return entering.length > 0 && entering.every((step) => step.optional);
}

/**
 * What blocks a move (engine rule 1). Backward moves, moves within the same place and Lost are always allowed; an
 * unknown target (a custom column) needs what the known columns before it need.
 */
export function moveBlockers(input: {
  definition: FlowDefinition;
  facts: CheckFacts;
  from: { code: string; position: number };
  to: { code: string; position: number };
  firstPosition: number;
  stages: Array<{ code: string; position: number }>;
  targetStatus: string;
}): MissingRequirement[] {
  const { definition, facts, from, to, firstPosition, stages, targetStatus } = input;
  if (targetStatus === "lost" || targetStatus === "abandoned") return [];
  if (targetStatus !== "won" && to.position <= from.position) return [];
  let target = targetStatus === "won" ? definition.columns.indexOf(WON_COLUMN) : columnOfStage(definition, to, firstPosition);
  if (target === null) {
    const before = stages.filter((stage) => stage.position < to.position).map((stage) => columnOfStage(definition, stage, firstPosition))
      .filter((column): column is number => column !== null);
    target = before.length ? Math.max(...before) : null;
  }
  return target === null ? [] : requirementsUpTo(definition, facts, target);
}

/** The next column and everything still needed for it, skipping optional columns. */
export function nextColumnPlan(input: { definition: FlowDefinition; facts: CheckFacts; current: number | null; status: string }) {
  const { definition, facts, status } = input;
  if (status !== "open") return { next: null as number | null, missing: [] as MissingRequirement[], skippable: false };
  const last = definition.columns.length - 1;
  let next: number | null = (input.current ?? 0) + 1 <= last ? (input.current ?? 0) + 1 : null;
  let skippable = false;
  while (next !== null && next < last && columnOptional(definition, next)) { skippable = true; next += 1; }
  return { next, missing: next === null ? [] : requirementsUpTo(definition, facts, next), skippable };
}

export type LineStep = {
  key: string; name: string; role: string; check: FlowCheck; column: string; optional: boolean; clientVisible: boolean;
  deadline: FlowStepDefinition["deadline"] | null;
  state: "done" | "current" | "upcoming" | "skipped";
  doneAt: string | null; doneBy: string | null;
  missing: Array<{ key: string; label: string }>;
  /** Passed on its own on this path (the type marks it auto-passed). */
  auto?: boolean;
  /** Marked not needed for this job (E2-5, PLM-081): why, who and when. */
  skip?: { reason: string; by: string | null; at: string | null } | null;
  /** E2-2: done, but an earlier required step is open again (its evidence was removed); flagged, never undone. */
  afterReopened?: boolean;
};

/**
 * The job's progress on its line: each step done or not (from the records), the current step (the first one not
 * done; an optional step is passed over once a later step is done), with who and when where the records say.
 */
export function flowProgress(definition: FlowDefinition, facts: CheckFacts): { line: LineStep[]; current: LineStep | null } {
  const steps = resolveLine(definition, facts);
  const missing = steps.map((step, index) => stepMissing(step, facts, steps.slice(0, index)));
  const done = missing.map((items) => items.length === 0);
  // An auto-passed step is done by definition; it says nothing about how far the job got.
  const lastDone = done.reduce((last, value, index) => value && !steps[index].auto ? index : last, -1);
  const currentIndex = steps.findIndex((step, index) => !done[index] && !(step.optional && index < lastDone));
  // E2-2: the first required step that is open while a later step is done (its evidence was removed).
  const reopened = steps.findIndex((step, index) => !done[index] && !step.optional && index < lastDone);
  const line = steps.map((step, index): LineStep => {
    const skip = skipOf(step, facts);
    const evidence = done[index] && !skip ? facts.evidence?.[step.check] : undefined;
    return {
      key: step.key, name: step.name, role: step.role, check: step.check, column: step.column,
      optional: Boolean(step.optional), clientVisible: Boolean(step.clientVisible), deadline: step.deadline ?? null,
      state: skip ? "skipped" : done[index] ? "done" : index === currentIndex ? "current" : currentIndex >= 0 && index < currentIndex ? "skipped" : "upcoming",
      doneAt: evidence?.at ? new Date(evidence.at).toISOString() : null, doneBy: evidence?.by ?? null,
      missing: missing[index],
      ...(step.auto ? { auto: true } : {}),
      ...(skip ? { skip: { reason: skip.reason, by: skip.by, at: skip.at ? new Date(skip.at).toISOString() : null } } : {}),
      ...(reopened >= 0 && index > reopened && done[index] && !skip && !step.auto ? { afterReopened: true } : {}),
    };
  });
  return { line, current: currentIndex >= 0 ? line[currentIndex] : null };
}

/** Whether the flow asks a question of the job (the sub-path card shows only when it does). */
export function flowAsks(definition: FlowDefinition, check: FlowCheck) {
  return allSteps(definition).some((step) => step.check === check);
}
