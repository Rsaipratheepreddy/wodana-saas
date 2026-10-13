import { tKey, type MessageKey } from "@/lib/i18n/keys";
import type { MissingRequirement } from "./client";
import type { OpportunityFlowView, FlowLineStep } from "./opportunity-flow";

/**
 * F1 (plan §5a): one job, one step at a time. What the opportunity's "Now" card and board card show,
 * derived from the gate response (what the next column still needs) and the funnel (the work after Won).
 * Every requirement key the server can send maps here to one verb, one short label and one action.
 */

/** Where a requirement is resolved. */
export type RequirementTarget = "proof" | "furniture" | "intro" | "discovery" | "quote" | "enquiry" | "edit" | "siteVisit" | "materials";
/** What the Now card's one primary button does. */
export type NowTarget = RequirementTarget | "advance" | "win" | "planning" | "project" | "reopen";
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
  /** The fields this step asks for by name, shown as {fields} in its title. */
  names?: MessageKey[];
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
  // PLM-080/044: the joinery site visit, booked for the salesperson and a designer together.
  siteVisit: { id: "siteVisit", title: tKey("Book the site visit"), short: tKey("Book site visit"), target: "siteVisit" },
  // PLM-081: material selection, or "Not required for this order" with a reason.
  "designStage:material_selection": { id: "materials", title: tKey("Choose the materials"), short: tKey("Choose materials"), target: "materials" },
  enquiryType: { id: "enquiryType", title: tKey("Choose the enquiry type"), short: tKey("Choose enquiry type"), target: "enquiry" },
  clientType: { id: "clientType", title: tKey("Set the client type"), short: tKey("Set client type"), target: "enquiry" },
  owner: { id: "owner", title: tKey("Assign a sales owner"), short: tKey("Assign owner"), target: "edit" },
  nextAction: { id: "nextAction", title: tKey("Schedule the next follow-up"), short: tKey("Schedule follow-up"), target: "edit" },
  amount: { id: "amount", title: tKey("Add the value"), short: tKey("Add value"), target: "edit" },
  expectedCloseAt: { id: "expectedCloseAt", title: tKey("Set the expected close date"), short: tKey("Set close date"), target: "edit" },
  stakeholders: { id: "stakeholders", title: tKey("Add the stakeholders"), short: tKey("Add stakeholders"), target: "edit" },
};

/**
 * PLM-096/155: a field the enquiry holds and the enquiry type requires before the intro ("enquiry.<field>"): completed
 * on the enquiry. Its title names the fields ("Complete the enquiry: Area / city, Target completion").
 */
const ENQUIRY_FIELDS: StepDef = { id: "enquiryFields", title: tKey("Complete the enquiry: {fields}"), short: tKey("Open enquiry"), target: "enquiry" };
const ENQUIRY_FIELD_NAMES: Record<string, MessageKey> = {
  email: tKey("Client email"), area: tKey("Area / city"), address: tKey("Address"), budgetRange: tKey("Budget range"), customerType: tKey("Client type"),
  summary: tKey("Project description"), targetCompletion: tKey("Target completion"),
};

/** The step a requirement key belongs to; anything else is a property or discovery fact. */
export function stepForRequirement(key: string): StepDef {
  if (key.startsWith("enquiry.")) return ENQUIRY_FIELDS;
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
    // An enquiry field reads by its name; the workspace's own fields and team roles by the server's words.
    const name = def === ENQUIRY_FIELDS ? (ENQUIRY_FIELD_NAMES[item.key.slice(8)] ?? item.label as MessageKey) : null;
    const existing = steps.find((step) => step.id === def.id);
    if (existing) { existing.keys.push(item.key); existing.fields.push(item.label); if (name) existing.names!.push(name); continue; }
    steps.push({ id: def.id, title: def.title, short: def.short, target: def.target, keys: [item.key], fields: [item.label], ...(name ? { names: [name] } : {}) });
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

/** After Won the work continues in Planning: the first funnel step that is not done; once the project runs, the project. */
function wonPlan(flow: OpportunityFlowView | null, funnel: FunnelStep[], caseId: string | null, project: { id: string; reference: string | null } | null): NowPlan {
  if (project) {
    return { status: "won", column: null, more: [], then: [], why: project.reference ? { key: tKey("Won. The work continues in project {reference}."), values: { reference: project.reference } } : { key: tKey("Won. The work continues in the project.") },
      now: { id: "project", title: tKey("Open the project"), short: tKey("Open project"), target: "project", keys: [], fields: [] } };
  }
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

export function nowPlan(input: { flow: OpportunityFlowView | null; status: string; funnel?: FunnelStep[] | null; caseId?: string | null; project?: { id: string; reference: string | null } | null }): NowPlan {
  const { flow, status } = input;
  const funnel = Array.isArray(input.funnel) ? input.funnel : [];
  if (status === "won") return wonPlan(flow, funnel, input.caseId ?? null, input.project ?? null);
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

/* ── The next column's checklist ───────────────────────────────────────────────────────────────────── */

/** The groups an opportunity's facts are kept in: each has one card and, where it is edited here, one side sheet. */
export type FactGroup = "client" | "property" | "package" | "questions" | "intro" | "supply" | "payment" | "planning" | "deal" | "proposals" | "closing" | "fulfilment";

const GROUP_OF: Record<string, FactGroup> = {
  floorPlan: "property", area: "property", floorPlanOrArea: "property", spaces: "property", propertyLocation: "property", clientEmail: "property", budget: "client",
  enquiryType: "client", clientType: "client", contact: "client",
  package: "package", introMeeting: "intro", paymentProof: "payment",
  furniturePath: "supply", feasibility: "supply", clientApproval: "supply",
  quotation: "planning", siteVisit: "planning", qsApproval: "planning", quoteSent: "planning", clientAccepted: "planning", paymentVerified: "planning", dealApproved: "planning", materialList: "planning",
  owner: "deal", nextAction: "deal", amount: "deal", expectedCloseAt: "deal", stakeholders: "deal",
};

/** The group a requirement key belongs to ("discovery:" keys are the same facts asked again by discovery). */
export function groupForRequirement(key: string): FactGroup {
  const bare = key.replace(/^discovery:/, "");
  if (bare.startsWith("question:")) return "questions";
  if (bare.startsWith("designStage:")) return "planning";
  return GROUP_OF[bare] ?? "property";
}

const GROUP_OF_CHECK: Record<string, FactGroup> = {
  intro_meeting_completed: "intro", client_type_set: "client", sub_path_chosen: "supply", feasibility_confirmed: "supply", client_approved_on_spot: "supply",
  package_chosen: "package", payment_proof_attached: "payment", discovery_complete: "property", contact_logged: "client",
};

/** The short verb on a missing row's button. */
function rowAction(key: string): MessageKey {
  const bare = key.replace(/^discovery:/, "");
  const group = groupForRequirement(key);
  if (bare === "floorPlan") return tKey("Upload");
  if (bare === "siteVisit") return tKey("Book");
  if (bare === "designStage:material_selection") return tKey("Choose");
  if (group === "questions") return tKey("Answer");
  if (group === "intro") return tKey("Book");
  if (group === "payment") return tKey("Attach");
  if (bare === "package" || bare === "furniturePath") return tKey("Choose");
  if (group === "client" && bare !== "contact") return tKey("Open enquiry");
  if (group === "planning") return tKey("Open Planning");
  if (bare === "contact") return tKey("Log");
  return tKey("Add");
}

export type ChecklistRow = {
  id: string;
  state: "done" | "missing";
  /** The server's label (a requirement) or the firm's step name (a done step): shown through translateKnown. */
  label: string;
  keys: string[];
  group: FactGroup | null;
  /** Where a missing row is resolved, and its button. */
  target: RequirementTarget | null;
  action: MessageKey | null;
  doneAt: string | null;
  doneBy: string | null;
};

export type Checklist = {
  /** The next column's name, and its code in the flow. */
  column: string;
  columnCode: string;
  why: { key: MessageKey; values?: Record<string, string> };
  rows: ChecklistRow[];
};

/** The r30 step names the API keeps for the standard columns, back to the flow's column codes. */
const COLUMN_OF_STEP: Record<string, string> = { new: "qualified", qualified: "qualification" };
export function columnOfStep(step: string | null | undefined) {
  return step ? COLUMN_OF_STEP[step] ?? step : "";
}

/** One line on what reaching the column means; a firm's own column says what it needs. */
const WHY: Record<string, MessageKey> = {
  qualified: tKey("{stage} means we know the client and the property."),
  qualification: tKey("{stage} means the brief is clear enough to plan the intro."),
  proposal: tKey("{stage} means we have everything to price the work."),
  negotiation: tKey("{stage} means the client has the offer."),
  won: tKey("{stage} means the client has paid."),
};

function missingRow(item: { key: string; label: string }): ChecklistRow {
  const step = stepForRequirement(item.key);
  return { id: item.key, state: "missing", label: item.label, keys: [item.key], group: groupForRequirement(item.key), target: step.target, action: rowAction(item.key), doneAt: null, doneBy: null };
}

/**
 * Everything the next column needs, done and not, in the order of the job's line: a done step is one ✓ row
 * (who and when, where the records say), a missing requirement one ○ row with the action that resolves it.
 */
export function nextChecklist(flow: OpportunityFlowView | null, status: string): Checklist | null {
  if (status !== "open" || !flow?.next) return null;
  const columnCode = columnOfStep(flow.next.step);
  const missing = flow.missing ?? [];
  const missingKeys = new Set(missing.map((item) => item.key));
  const rows: ChecklistRow[] = [];
  const listed = new Set<string>();
  for (const step of (Array.isArray(flow.line) ? flow.line : []) as FlowLineStep[]) {
    if (step.optional) continue;
    if (step.state === "done") {
      if (step.column === columnCode) rows.push({ id: `step:${step.key}`, state: "done", label: step.name, keys: [], group: GROUP_OF_CHECK[step.check] ?? null, target: null, action: null, doneAt: step.doneAt, doneBy: step.doneBy });
      continue;
    }
    for (const item of step.missing ?? []) {
      if (!missingKeys.has(item.key) || listed.has(item.key)) continue;
      listed.add(item.key);
      rows.push(missingRow(missing.find((entry) => entry.key === item.key) ?? item));
    }
  }
  for (const item of missing) if (!listed.has(item.key)) rows.push(missingRow(item));
  const column = flow.next.name;
  const why = missing.length ? { key: WHY[columnCode] ?? tKey("Needed to move to {stage}"), values: { stage: column } } : { key: tKey("Everything for {stage} is in place"), values: { stage: column } };
  return { column, columnCode, why, rows };
}

type ActivityLike = { status?: unknown; isNextAction?: unknown; dueAt?: unknown; title?: unknown };

/** The pending next follow-up: the pending activity marked as the next action, else the soonest pending one with a due date. */
export function pendingFollowUp<T extends object>(items: T[]): T | null {
  const of = (item: T) => item as ActivityLike;
  const pending = items.filter((item) => of(item).status === "pending");
  const due = (item: T) => Date.parse(String(of(item).dueAt ?? "")) || Infinity;
  const soonest = (list: T[]) => [...list].sort((a, b) => due(a) - due(b))[0] ?? null;
  return soonest(pending.filter((item) => of(item).isNextAction === true)) ?? soonest(pending.filter((item) => due(item) !== Infinity));
}

/** The title the server gives the follow-up it books with an opportunity; shown as "Follow up with <first name>". */
const SERVER_FOLLOW_UP_TITLE = "Follow up on opportunity";

/** Whether a follow-up keeps the server's generic title (and so reads better as "Follow up with <client>"). */
export function isGenericFollowUp(item: object) {
  const { title: raw } = item as ActivityLike;
  const title = typeof raw === "string" ? raw.trim() : "";
  return !title || title === SERVER_FOLLOW_UP_TITLE;
}

/** The first word of a name ("Amal Rahman" → "Amal"). */
export function firstName(name: string | null | undefined) {
  const clean = (name ?? "").trim();
  return clean.split(/\s+/)[0] ?? clean;
}
