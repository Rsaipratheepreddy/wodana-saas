import { createHash } from "node:crypto";
import { FURNITURE_PATHS } from "../opportunities/flow-gates";

/**
 * Plan §5a: a flow is a versioned template of steps. Each step names who does it, the one check (from the closed
 * catalogue below) that says it is done, the fields it needs, and the pipeline column the job enters when it is
 * done. A branch splits the line on one question and its paths rejoin. The definition is configuration (JSON in
 * crm_flow_versions); the truth it reads stays in the records.
 */
export const FLOW_DEFINITION_SCHEMA = 1;

/** The check catalogue: product-defined, read from real records. New checks are added here, once, for every firm. */
export const FLOW_CHECKS = [
  "contact_logged", "details_complete", "intro_meeting_completed", "client_type_set", "qualification_outcome_recorded", "target_completion_set",
  "sub_path_chosen", "feasibility_confirmed",
  "package_chosen", "discovery_complete", "site_visit_recorded",
  "quote_exists", "qs_approved", "quote_sent", "client_accepted", "client_approved_on_spot", "payment_proof_attached", "payment_verified", "deal_approved",
  "design_stage_done", "material_list_signed_off",
] as const;
export type FlowCheck = (typeof FLOW_CHECKS)[number];

/** Fields a step may need (the "details complete" check and any step's `needs`). */
export const FLOW_FIELDS = ["enquiryType", "clientEmail", "propertyLocation", "floorPlanOrArea", "budget"] as const;
export type FlowField = (typeof FLOW_FIELDS)[number];

/** The questions a branch may split on. */
export const BRANCH_QUESTIONS = ["subPath", "package", "budgetBand", "clientType"] as const;
export type BranchQuestion = (typeof BRANCH_QUESTIONS)[number];

/** The check that answers each branch question; a branch must come after a step that asks it. */
export const QUESTION_ASKED_BY: Record<BranchQuestion, (step: FlowStepDefinition) => boolean> = {
  subPath: (step) => step.check === "sub_path_chosen",
  package: (step) => step.check === "package_chosen",
  clientType: (step) => step.check === "client_type_set",
  budgetBand: (step) => (step.needs ?? []).includes("budget"),
};

export const DESIGN_STAGES = ["inspiration", "kickoff", "site_visit", "concepts", "space_planning", "material_selection", "renders", "samples", "approval"] as const;
export type DesignStage = (typeof DESIGN_STAGES)[number];

export const DEADLINE_UNITS = ["working_hours", "hours", "days"] as const;
export type DeadlineUnit = (typeof DEADLINE_UNITS)[number];

/** The column every flow ends in; only the payment proof step enters it (PLM-122). */
export const WON_COLUMN = "won";

export type FlowStepDefinition = {
  key: string;
  name: string;
  /** Who does it: a workspace role code. */
  role: string;
  check: FlowCheck;
  needs?: FlowField[];
  /** For `design_stage_done` only: which design stage. */
  designStage?: DesignStage;
  /** The pipeline column (stage code) the job enters when this step is done. */
  column: string;
  optional?: boolean;
  /**
   * Auto-passed (CeCe's "Auto-passed"): on this path the step passes on its own, with nothing to do. It shows on the
   * job's line as done; it never blocks a move. Never on the payment proof step, never together with `optional`.
   */
  auto?: boolean;
  clientVisible?: boolean;
  deadline?: { amount: number; unit: DeadlineUnit };
  /** Roles told when the step becomes current. */
  notify?: string[];
};

export type FlowBranchDefinition = {
  key: string;
  question: BranchQuestion;
  /** The main-line step after which the line splits. */
  after: string;
  /** The main-line step where the paths join again (the one right after `after`). */
  rejoin: string;
  answers: Array<{ value: string; steps: FlowStepDefinition[] }>;
};

export type FlowDefinition = {
  schema: typeof FLOW_DEFINITION_SCHEMA;
  /** The pipeline columns (stage codes) the flow knows, in order; the last is Won. */
  columns: string[];
  steps: FlowStepDefinition[];
  branches: FlowBranchDefinition[];
};

export type FlowValidationError = { path: string; message: string };

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const CODE = /^[a-z][a-z0-9_]{0,59}$/;
const MAX_STEPS = 80;

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * The publisher's validator. Strict: unknown properties are refused. Rules: unique keys; every step has a role and
 * a catalogue check; columns are known and only move forward along every path; every branch answer leads somewhere
 * (its paths rejoin the line); no dead ends; Won is entered only by the payment proof step, which ends the line.
 */
export function validateFlowDefinition(input: unknown): { ok: true; definition: FlowDefinition; errors: [] } | { ok: false; errors: FlowValidationError[] } {
  const errors: FlowValidationError[] = [];
  const fail = (path: string, message: string) => { errors.push({ path, message }); };
  const only = (value: Record<string, unknown>, path: string, allowed: string[]) => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, "Unknown property");
  };
  if (!isObject(input)) return { ok: false, errors: [{ path: "", message: "A flow definition is an object" }] };
  only(input, "", ["schema", "columns", "steps", "branches"]);
  if (input.schema !== FLOW_DEFINITION_SCHEMA) fail("schema", `Schema must be ${FLOW_DEFINITION_SCHEMA}`);

  const columns = Array.isArray(input.columns) ? input.columns : [];
  if (!Array.isArray(input.columns) || columns.length < 2 || columns.length > 20) fail("columns", "List 2 to 20 pipeline columns in order");
  columns.forEach((column, index) => { if (typeof column !== "string" || !KEY.test(column)) fail(`columns[${index}]`, "A column is a stage code"); });
  if (new Set(columns).size !== columns.length) fail("columns", "Each column appears once");
  if (columns.includes("lost")) fail("columns", "Lost is always allowed and is not part of a flow");
  if (columns.length && columns.at(-1) !== WON_COLUMN) fail("columns", "The last column is Won");
  const columnIndex = (code: unknown) => columns.indexOf(code as string);

  const keys = new Set<string>();
  const uniqueKey = (key: unknown, path: string) => {
    if (typeof key !== "string" || !KEY.test(key)) { fail(`${path}.key`, "A key is lower-case letters, digits and _"); return; }
    if (keys.has(key)) fail(`${path}.key`, `The key "${key}" is used twice`);
    keys.add(key);
  };
  const checkStep = (step: unknown, path: string): step is FlowStepDefinition => {
    if (!isObject(step)) { fail(path, "A step is an object"); return false; }
    only(step, path, ["key", "name", "role", "check", "needs", "designStage", "column", "optional", "auto", "clientVisible", "deadline", "notify"]);
    uniqueKey(step.key, path);
    if (typeof step.name !== "string" || !step.name.trim() || step.name.length > 120) fail(`${path}.name`, "Give the step a name (up to 120 characters)");
    if (typeof step.role !== "string" || !CODE.test(step.role)) fail(`${path}.role`, "Every step has a role");
    if (!FLOW_CHECKS.includes(step.check as FlowCheck)) fail(`${path}.check`, "Choose a check from the catalogue");
    if (step.needs !== undefined) {
      if (!Array.isArray(step.needs) || step.needs.some((field) => !FLOW_FIELDS.includes(field as FlowField))) fail(`${path}.needs`, "Choose fields from the list");
      else if (new Set(step.needs).size !== step.needs.length) fail(`${path}.needs`, "Each field appears once");
    }
    if (step.check === "details_complete" && (!Array.isArray(step.needs) || !step.needs.length)) fail(`${path}.needs`, "Choose the details this step needs");
    if (step.check === "design_stage_done") {
      if (!DESIGN_STAGES.includes(step.designStage as DesignStage)) fail(`${path}.designStage`, "Choose the design stage");
    } else if (step.designStage !== undefined) fail(`${path}.designStage`, "Only a design stage step names a design stage");
    if (columnIndex(step.column) < 0) fail(`${path}.column`, "Choose one of the flow's columns");
    for (const flag of ["optional", "auto", "clientVisible"] as const) if (step[flag] !== undefined && typeof step[flag] !== "boolean") fail(`${path}.${flag}`, "Yes or no");
    if (step.auto === true && step.optional === true) fail(`${path}.auto`, "A step is either auto-passed or used if needed, not both");
    if (step.auto === true && step.check === "payment_proof_attached") fail(`${path}.auto`, "The payment proof is never auto-passed");
    if (step.deadline !== undefined) {
      const deadline = step.deadline;
      if (!isObject(deadline)) fail(`${path}.deadline`, "A deadline has an amount and a unit");
      else {
        only(deadline, `${path}.deadline`, ["amount", "unit"]);
        if (!Number.isInteger(deadline.amount) || (deadline.amount as number) < 1 || (deadline.amount as number) > 1000) fail(`${path}.deadline.amount`, "A whole number from 1 to 1000");
        if (!DEADLINE_UNITS.includes(deadline.unit as DeadlineUnit)) fail(`${path}.deadline.unit`, "Working hours, hours or days");
      }
    }
    if (step.notify !== undefined && (!Array.isArray(step.notify) || step.notify.length > 10 || step.notify.some((role) => typeof role !== "string" || !CODE.test(role)) || new Set(step.notify).size !== step.notify.length))
      fail(`${path}.notify`, "Choose up to 10 roles to tell");
    return true;
  };

  const steps = Array.isArray(input.steps) ? input.steps : [];
  if (!Array.isArray(input.steps) || !steps.length) fail("steps", "A flow has at least one step");
  steps.forEach((step, index) => checkStep(step, `steps[${index}]`));
  const main = steps.filter(isObject) as FlowStepDefinition[];
  const mainIndex = new Map(main.map((step, index) => [step.key, index]));

  // Columns only move forward along the main line.
  for (let index = 1; index < main.length; index += 1)
    if (columnIndex(main[index].column) >= 0 && columnIndex(main[index].column) < columnIndex(main[index - 1].column))
      fail(`steps[${index}].column`, "Columns only move forward: this step enters an earlier column than the step before it");

  // Won: entered only by the payment proof step, which is required and ends the line.
  const last = main.at(-1);
  if (last && (last.check !== "payment_proof_attached" || last.column !== WON_COLUMN || last.optional || last.auto))
    fail(`steps[${main.length - 1}]`, "The flow ends with a required payment proof step that enters Won");
  main.forEach((step, index) => {
    if (step.column === WON_COLUMN && index !== main.length - 1) fail(`steps[${index}].column`, "Only the payment proof step enters Won");
  });

  const branches = input.branches === undefined ? [] : Array.isArray(input.branches) ? input.branches : (fail("branches", "Branches are a list"), []);
  const opened = new Set<string>();
  let total = main.length;
  branches.forEach((branch, index) => {
    const path = `branches[${index}]`;
    if (!isObject(branch)) { fail(path, "A branch is an object"); return; }
    only(branch, path, ["key", "question", "after", "rejoin", "answers"]);
    uniqueKey(branch.key, path);
    if (!BRANCH_QUESTIONS.includes(branch.question as BranchQuestion)) fail(`${path}.question`, "Split on sub-path, package, budget band or client type");
    const at = mainIndex.get(branch.after as string);
    if (at === undefined) { fail(`${path}.after`, "Choose the step the branch follows"); return; }
    if (opened.has(branch.after as string)) fail(`${path}.after`, "Only one branch can follow a step");
    opened.add(branch.after as string);
    const rejoin = main[at + 1];
    if (!rejoin) fail(`${path}.rejoin`, "A branch after the last step is a dead end");
    else if (branch.rejoin !== rejoin.key) fail(`${path}.rejoin`, `The paths rejoin at the next step ("${rejoin.key}")`);
    const question = branch.question as BranchQuestion;
    if (QUESTION_ASKED_BY[question] && !main.slice(0, at + 1).some(QUESTION_ASKED_BY[question])) fail(`${path}.question`, "Ask the question in a step before the branch");
    const answers = Array.isArray(branch.answers) ? branch.answers : [];
    if (!answers.length || answers.length > 20) fail(`${path}.answers`, "A branch has 1 to 20 answers");
    const values = new Set<string>();
    answers.forEach((answer, answerIndex) => {
      const answerPath = `${path}.answers[${answerIndex}]`;
      if (!isObject(answer)) { fail(answerPath, "An answer is an object"); return; }
      only(answer, answerPath, ["value", "steps"]);
      if (typeof answer.value !== "string" || !CODE.test(answer.value)) fail(`${answerPath}.value`, "An answer is a code");
      else if (values.has(answer.value)) fail(`${answerPath}.value`, "Each answer appears once");
      else values.add(answer.value);
      if (question === "subPath" && !FURNITURE_PATHS.includes(answer.value as never)) fail(`${answerPath}.value`, "Choose a furniture sub-path");
      // An answer with no steps goes straight to the rejoin step, which always exists; it is never a dead end.
      if (!Array.isArray(answer.steps)) { fail(`${answerPath}.steps`, "An answer leads to a list of steps (it may be empty)"); return; }
      total += answer.steps.length;
      let previous = columnIndex(main[at]?.column);
      answer.steps.forEach((step, stepIndex) => {
        const stepPath = `${answerPath}.steps[${stepIndex}]`;
        if (!checkStep(step, stepPath)) return;
        const own = columnIndex(step.column);
        if (step.column === WON_COLUMN) fail(`${stepPath}.column`, "Only the payment proof step enters Won");
        if (own >= 0 && own < previous) fail(`${stepPath}.column`, "Columns only move forward along every path");
        if (rejoin && own > columnIndex(rejoin.column)) fail(`${stepPath}.column`, "A branch step cannot enter a column after the step its paths rejoin");
        if (own >= 0) previous = own;
      });
    });
  });
  if (total > MAX_STEPS) fail("steps", `A flow has at most ${MAX_STEPS} steps`);
  if (errors.length) return { ok: false, errors };
  const definition = input as unknown as FlowDefinition;
  return { ok: true, definition: { ...definition, branches: definition.branches ?? [] }, errors: [] };
}

/** A stable fingerprint of a definition (keys sorted), stored with each version. */
export function flowChecksum(definition: FlowDefinition) {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : isObject(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  return createHash("sha256").update(JSON.stringify(canonical(definition))).digest("hex");
}

/** Every step of a definition, main line and branch paths. */
export function allSteps(definition: FlowDefinition): FlowStepDefinition[] {
  return [...definition.steps, ...definition.branches.flatMap((branch) => branch.answers.flatMap((answer) => answer.steps))];
}

/** PLM-081: the material selection step (a design stage step for the material selection stage). */
export const isMaterialSelectionStep = (step: Pick<FlowStepDefinition, "check" | "designStage">) =>
  step.check === "design_stage_done" && step.designStage === "material_selection";

/**
 * E2-5 / PLM-081: a step a job may mark as not needed, with a reason: one the type marks optional ("used if
 * needed"), and material selection ("Not required for this order"). Never the payment proof.
 */
export const canSkipStep = (step: Pick<FlowStepDefinition, "check" | "designStage" | "optional">) =>
  step.check !== "payment_proof_attached" && (Boolean(step.optional) || isMaterialSelectionStep(step));

/** A furniture or joinery flow: it asks the furniture sub-path, or a site visit is priced by the QS. */
export function isFurnitureOrJoineryFlow(definition: FlowDefinition) {
  const steps = allSteps(definition);
  return definition.branches.some((branch) => branch.question === "subPath") || steps.some((step) => step.check === "sub_path_chosen")
    || (steps.some((step) => step.check === "site_visit_recorded") && steps.some((step) => step.check === "qs_approved"));
}

/** Each path of a definition: the main line plus, at every branch, the steps of one answer. One path when it doesn't branch. */
export function definitionPaths(definition: FlowDefinition): Array<{ value: string | null; steps: FlowStepDefinition[] }> {
  const values = [...new Set(definition.branches.flatMap((branch) => branch.answers.map((answer) => answer.value)))];
  if (!values.length) return [{ value: null, steps: [...definition.steps] }];
  return values.map((value) => ({
    value,
    steps: definition.steps.flatMap((step) => {
      const branch = definition.branches.find((item) => item.after === step.key);
      return [step, ...(branch?.answers.find((answer) => answer.value === value)?.steps ?? [])];
    }),
  }));
}

/**
 * The publisher's product rules on top of the shape (run on publish and on the editor's check; every problem at
 * once). PLM-081: on a furniture or joinery flow, material selection is a required step on every path; a job
 * that doesn't need it marks it "Not required for this order" with a reason, so it is never simply left blank.
 */
export function flowPolicyProblems(definition: FlowDefinition): FlowValidationError[] {
  if (!isFurnitureOrJoineryFlow(definition)) return [];
  const errors: FlowValidationError[] = [];
  const located = (key: string) => {
    const main = definition.steps.findIndex((step) => step.key === key);
    if (main >= 0) return `steps[${main}]`;
    for (const [branchIndex, branch] of definition.branches.entries())
      for (const [answerIndex, answer] of branch.answers.entries()) {
        const index = answer.steps.findIndex((step) => step.key === key);
        if (index >= 0) return `branches[${branchIndex}].answers[${answerIndex}].steps[${index}]`;
      }
    return "steps";
  };
  for (const step of allSteps(definition))
    if (isMaterialSelectionStep(step) && (step.optional || step.auto))
      errors.push({ path: `${located(step.key)}.optional`, message: "Material selection is required; a job marks it Not required for this order with a reason" });
  for (const path of definitionPaths(definition))
    if (!path.steps.some((step) => isMaterialSelectionStep(step) && !step.optional && !step.auto))
      errors.push({ path: path.value ? `paths.${path.value}` : "steps", message: "Material selection is always a step on furniture and joinery paths" });
  return errors;
}
