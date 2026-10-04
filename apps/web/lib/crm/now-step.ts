import { tKey, type MessageKey } from "@/lib/i18n/keys";
import type { MissingRequirement } from "./client";
import type { OpportunityFlowView } from "./opportunity-flow";

/**
 * F1 (plan §5a): one job, one step at a time. What the opportunity's "Now" card and board card show,
 * derived from the gate response (what the next column still needs) and the funnel (the work after Won).
 * Every requirement key the server can send maps here to one verb, one short label and one action.
 */

/** Where a requirement is resolved. */
export type RequirementTarget = "proof" | "furniture" | "intro" | "discovery" | "quote" | "enquiry" | "edit";
/** What the Now card's one primary button does. */
export type NowTarget = RequirementTarget | "advance" | "win" | "planning" | "reopen";
export type PlanningSection = "overview" | "designs" | "quotations" | "approvals";

export type FunnelStep = { key: "enquiry" | "discovery" | "intro" | "design" | "quote" | "deal"; state: "done" | "current" | "active" | "upcoming"; detail: string | null; at: string | null };

export type NowStep = {
  id: string;
  /** The step as a verb: "Book the intro meeting". */
  title: MessageKey;
  /** The short verb for the board card and the button: "Book intro". */
  short: MessageKey;
  target: NowTarget;
  /** The requirement keys this step resolves, and their server labels. */
  keys: string[];
  fields: string[];
  values?: Record<string, string>;
  section?: PlanningSection;
};

export type NowPlan = {
  status: "open" | "won" | "lost";
  now: NowStep | null;
  /** One plain line: why this step. */
  why: { key: MessageKey; values?: Record<string, string> } | null;
  /** The column the missing steps lead to. */
  column: string | null;
  /** The other steps still needed before that column. */
  more: NowStep[];
  /** The next two steps after it, shown greyed. */
  then: NowStep[];
};

type StepDef = { id: string; title: MessageKey; short: MessageKey; target: RequirementTarget };

/** Property and discovery facts are filled in one form, so they are one step. */
const DETAILS: StepDef = { id: "details", title: tKey("Fill in the property details"), short: tKey("Fill in details"), target: "discovery" };

const STEPS: Record<string, StepDef> = {
  paymentProof: { id: "paymentProof", title: tKey("Attach payment proof"), short: tKey("Attach proof"), target: "proof" },
  furniturePath: { id: "furniturePath", title: tKey("Choose how it's supplied"), short: tKey("Choose sub-path"), target: "furniture" },
  feasibility: { id: "feasibility", title: tKey("Confirm feasibility with the factory"), short: tKey("Confirm feasibility"), target: "furniture" },
  introMeeting: { id: "introMeeting", title: tKey("Book the intro meeting"), short: tKey("Book intro"), target: "intro" },
  quotation: { id: "quotation", title: tKey("Prepare the quotation"), short: tKey("Prepare quote"), target: "quote" },
  enquiryType: { id: "enquiryType", title: tKey("Choose the enquiry type"), short: tKey("Choose enquiry type"), target: "enquiry" },
  clientType: { id: "clientType", title: tKey("Set the client type"), short: tKey("Set client type"), target: "enquiry" },
  owner: { id: "owner", title: tKey("Assign a sales owner"), short: tKey("Assign owner"), target: "edit" },
  nextAction: { id: "nextAction", title: tKey("Schedule the next follow-up"), short: tKey("Schedule follow-up"), target: "edit" },
  amount: { id: "amount", title: tKey("Add the value"), short: tKey("Add value"), target: "edit" },
  expectedCloseAt: { id: "expectedCloseAt", title: tKey("Set the expected close date"), short: tKey("Set close date"), target: "edit" },
  stakeholders: { id: "stakeholders", title: tKey("Add the stakeholders"), short: tKey("Add stakeholders"), target: "edit" },
};

/** The step a requirement key belongs to; anything else is a property or discovery fact. */
export function stepForRequirement(key: string): StepDef {
  return STEPS[key] ?? DETAILS;
}

/** What resolves a requirement: where the person goes and the button that takes them there. */
export function requirementAction(key: string): { target: RequirementTarget; label: MessageKey } {
  const step = stepForRequirement(key);
  return { target: step.target, label: step.short };
}

/** Requirements grouped into steps, in the order the server listed them. */
export function groupRequirements(items: MissingRequirement[] | null | undefined): NowStep[] {
  const steps: NowStep[] = [];
  for (const item of items ?? []) {
    const def = stepForRequirement(item.key);
    const existing = steps.find((step) => step.id === def.id);
    if (existing) { existing.keys.push(item.key); existing.fields.push(item.label); continue; }
    steps.push({ id: def.id, title: def.title, short: def.short, target: def.target, keys: [item.key], fields: [item.label] });
  }
  return steps;
}

const FUNNEL_STEPS: Record<"design" | "quote" | "deal", Omit<NowStep, "keys" | "fields">> = {
  design: { id: "design", title: tKey("Finish the design"), short: tKey("Open design"), target: "planning", section: "designs" },
  quote: { id: "quote", title: tKey("Get the quote accepted"), short: tKey("Open quotes"), target: "planning", section: "quotations" },
  deal: { id: "deal", title: tKey("Submit the Deal File"), short: tKey("Open approvals"), target: "planning", section: "approvals" },
};

function moveStep(stage: string): NowStep {
  return { id: "advance", title: tKey("Move to {stage}"), short: tKey("Move to {stage}"), target: "advance", keys: [], fields: [], values: { stage } };
}

/** After Won the work continues in Planning: the first funnel step that is not done. */
function wonPlan(flow: OpportunityFlowView | null, funnel: FunnelStep[], caseId: string | null): NowPlan {
  const order = (flow?.flow === "furniture" || flow?.flow === "basic" ? ["quote", "deal"] : ["design", "quote", "deal"]) as Array<keyof typeof FUNNEL_STEPS>;
  const done = (key: string) => funnel.find((step) => step.key === key)?.state === "done";
  const open = order.filter((key) => !done(key)).map((key) => ({ ...FUNNEL_STEPS[key], keys: [], fields: [] }));
  if (!caseId) {
    return { status: "won", column: null, more: [], then: open.slice(0, 2), why: { key: tKey("Won. The work continues in Planning.") },
      now: { id: "planning", title: tKey("Start Planning"), short: tKey("Start Planning"), target: "planning", section: "overview", keys: [], fields: [] } };
  }
  const now = open[0] ?? { id: "planning", title: tKey("Open Planning"), short: tKey("Open Planning"), target: "planning" as const, section: "overview" as const, keys: [], fields: [] };
  return { status: "won", column: null, more: [], then: open.slice(1, 3), now, why: { key: tKey("Won. The work continues in Planning.") } };
}

export function nowPlan(input: { flow: OpportunityFlowView | null; status: string; funnel?: FunnelStep[] | null; caseId?: string | null }): NowPlan {
  const { flow, status } = input;
  const funnel = Array.isArray(input.funnel) ? input.funnel : [];
  if (status === "won") return wonPlan(flow, funnel, input.caseId ?? null);
  if (status !== "open") {
    return { status: "lost", column: null, more: [], then: [], why: { key: tKey("This opportunity was lost.") },
      now: { id: "reopen", title: tKey("Reopen the opportunity"), short: tKey("Reopen"), target: "reopen", keys: [], fields: [] } };
  }
  const empty: NowPlan = { status: "open", now: null, why: null, column: null, more: [], then: [] };
  if (!flow) return empty;
  const next = flow.next ?? null;
  const missing = groupRequirements(flow.missing);
  const missingKeys = new Set((flow.missing ?? []).map((item) => item.key));
  const later = groupRequirements((flow.toWon ?? []).filter((item) => !missingKeys.has(item.key))).filter((step) => !missing.some((item) => item.id === step.id));
  if (missing.length) {
    const column = next?.name ?? null;
    const afterwards = column && next?.step !== "won" ? [moveStep(column), ...later] : later;
    return { status: "open", now: missing[0], more: missing.slice(1), column, then: afterwards.slice(0, 2),
      why: column ? { key: tKey("Needed to move to {stage}"), values: { stage: column } } : null };
  }
  if (!next) return empty;
  const now: NowStep = next.step === "won"
    ? { id: "win", title: tKey("Mark it Won"), short: tKey("Mark Won"), target: "win", keys: [], fields: [] }
    : moveStep(next.name);
  return { status: "open", now, more: [], column: next.name, then: later.slice(0, 2), why: { key: tKey("Everything for {stage} is in place"), values: { stage: next.name } } };
}
