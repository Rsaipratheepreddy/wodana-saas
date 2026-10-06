import { tKey, type MessageKey } from "@/lib/i18n/keys";

/**
 * Plan §5a, F3: the flow builder's model. The draft is a flow definition (the same shape the business service
 * validates and publishes); the canvas is drawn from it, and every edit is a pure function from one definition to
 * the next, so undo is a stack of definitions and the graph always round-trips to the definition it came from.
 */

export const FLOW_CHECKS = [
  "contact_logged", "details_complete", "intro_meeting_completed", "client_type_set", "sub_path_chosen", "feasibility_confirmed",
  "package_chosen", "discovery_complete", "site_visit_recorded",
  "quote_exists", "qs_approved", "quote_sent", "client_accepted", "client_approved_on_spot", "payment_proof_attached", "payment_verified", "deal_approved",
  "design_stage_done", "material_list_signed_off",
] as const;
export type FlowCheck = (typeof FLOW_CHECKS)[number];
export const FLOW_FIELDS = ["enquiryType", "clientEmail", "propertyLocation", "floorPlanOrArea", "budget"] as const;
export type FlowField = (typeof FLOW_FIELDS)[number];
export const BRANCH_QUESTIONS = ["subPath", "package", "budgetBand", "clientType"] as const;
export type BranchQuestion = (typeof BRANCH_QUESTIONS)[number];
export const DESIGN_STAGES = ["inspiration", "site_visit", "concepts", "space_planning", "material_selection", "renders", "approval"] as const;
export type DesignStage = (typeof DESIGN_STAGES)[number];
export const DEADLINE_UNITS = ["working_hours", "hours", "days"] as const;
export type DeadlineUnit = (typeof DEADLINE_UNITS)[number];
export const WON_COLUMN = "won";

export type FlowStep = {
  key: string;
  name: string;
  role: string;
  check: FlowCheck;
  needs?: FlowField[];
  designStage?: DesignStage;
  column: string;
  optional?: boolean;
  /** CeCe's "Auto-passed": on this path the step passes on its own (never the payment proof, never with `optional`). */
  auto?: boolean;
  clientVisible?: boolean;
  deadline?: { amount: number; unit: DeadlineUnit };
  notify?: string[];
};
export type FlowBranch = { key: string; question: BranchQuestion; after: string; rejoin: string; answers: Array<{ value: string; steps: FlowStep[] }> };
export type FlowDefinition = { schema: 1; columns: string[]; steps: FlowStep[]; branches: FlowBranch[] };
export type FlowValidationError = { path: string; message: string };

/** A colour a firm picks for an enquiry type: one of the six chart hues. */
export type TypeColor = 1 | 2 | 3 | 4 | 5 | 6;
export const TYPE_COLORS: TypeColor[] = [1, 2, 3, 4, 5, 6];
/** An enquiry type with a summary of its steps (`GET crm/enquiry-types`). "Not sure yet" is never listed. */
export type EnquiryTypeSummary = {
  id: string; code: string; label: string; color: TypeColor | null; status: string; version: number; flowId: string | null; runningJobs?: number;
  latest: { id: string; version: number; source: "starter" | "published"; publishedAt: string; publishedBy: string | null; steps?: string[] } | null;
};
export type FlowDetail = {
  id: string; code: string; name: string; status: string; version: number;
  selected: { version: number; publishedAt?: string; publishedBy?: string | null; source?: string; definition: FlowDefinition };
  /** The enquiry type these steps belong to (`GET crm/enquiry-types/:id`). */
  enquiryType?: { id: string; code: string; label: string; color: TypeColor | null; status: string; version: number };
};
/** Ready-made steps from the template library (`GET crm/flows/templates`). */
export type FlowTemplate = { key: string; name: string; description: string; group: string; suggestedEnquiryTypes: string[]; stepCount: number };
export const TEMPLATE_GROUPS = ["Furniture", "Interior design", "Fit-out", "Other"] as const;
export type RoleOption = { code: string; name: string };
export type AnswerOption = { value: string; label: string; letter?: string };
export type AnswerOptions = Partial<Record<BranchQuestion, AnswerOption[]>>;

// ── The component palette ────────────────────────────────────────────────────────────────────────────────────────

export type ComponentGroup = "contact" | "meetings" | "sell" | "design" | "logic";
export const COMPONENT_GROUPS: Array<{ id: ComponentGroup; label: MessageKey }> = [
  { id: "contact", label: tKey("Contact") },
  { id: "meetings", label: tKey("Meetings") },
  { id: "sell", label: tKey("Sell") },
  { id: "design", label: tKey("Design") },
  { id: "logic", label: tKey("Logic") },
];

/** One catalogue check as the builder offers it: the step it makes, in plain words. */
export type CheckMeta = {
  check: FlowCheck;
  group: Exclude<ComponentGroup, "logic">;
  /** The plain name of the component and of the check ("Done when …"). */
  label: MessageKey;
  /** The default step name: what someone does. */
  step: MessageKey;
  hint: MessageKey;
  role: string;
  needs?: FlowField[];
  designStage?: DesignStage;
};

export const CHECK_CATALOGUE: CheckMeta[] = [
  { check: "contact_logged", group: "contact", label: tKey("Contact logged"), step: tKey("Log the first contact"), hint: tKey("A call, message or visit is on record"), role: "sales" },
  { check: "details_complete", group: "contact", label: tKey("Details complete"), step: tKey("Complete the client details"), hint: tKey("The fields you choose are filled in"), role: "sales", needs: ["clientEmail", "propertyLocation"] },
  { check: "client_type_set", group: "contact", label: tKey("Client type set"), step: tKey("Set the client type"), hint: tKey("The client type is chosen"), role: "sales" },
  { check: "intro_meeting_completed", group: "meetings", label: tKey("Intro meeting completed"), step: tKey("Hold the intro meeting"), hint: tKey("The first meeting is marked done"), role: "sales" },
  { check: "site_visit_recorded", group: "meetings", label: tKey("Site visit recorded"), step: tKey("Record the site visit"), hint: tKey("A site visit is on record"), role: "sales" },
  { check: "discovery_complete", group: "meetings", label: tKey("Discovery complete"), step: tKey("Complete discovery"), hint: tKey("Rooms, style and budget are captured"), role: "sales" },
  { check: "sub_path_chosen", group: "sell", label: tKey("Sub-path chosen"), step: tKey("Choose the sub-path"), hint: tKey("How the furniture is supplied"), role: "sales" },
  { check: "feasibility_confirmed", group: "sell", label: tKey("Feasibility confirmed"), step: tKey("Confirm feasibility with the factory"), hint: tKey("The factory says it can be made"), role: "factory" },
  { check: "package_chosen", group: "sell", label: tKey("Package chosen"), step: tKey("Choose the design package"), hint: tKey("A design package is picked"), role: "sales" },
  { check: "quote_exists", group: "sell", label: tKey("Quote exists"), step: tKey("Prepare the quotation"), hint: tKey("A quotation is drafted"), role: "sales" },
  { check: "qs_approved", group: "sell", label: tKey("QS approved"), step: tKey("Price the quote with the QS"), hint: tKey("The quantity surveyor approves the price"), role: "quantity_surveyor" },
  { check: "quote_sent", group: "sell", label: tKey("Quote sent"), step: tKey("Send the quotation"), hint: tKey("The client has the quotation"), role: "sales" },
  { check: "client_accepted", group: "sell", label: tKey("Client accepted"), step: tKey("Get the client's acceptance"), hint: tKey("The client accepts the quotation"), role: "sales" },
  { check: "client_approved_on_spot", group: "sell", label: tKey("Client approved on the spot"), step: tKey("Agree the deal with the client"), hint: tKey("The client says yes in person"), role: "sales" },
  { check: "deal_approved", group: "sell", label: tKey("Deal approved"), step: tKey("Approve the deal"), hint: tKey("A manager approves the terms"), role: "manager" },
  { check: "payment_proof_attached", group: "sell", label: tKey("Payment proof attached"), step: tKey("Attach the payment proof"), hint: tKey("Proof of payment is on the deal"), role: "sales" },
  { check: "payment_verified", group: "sell", label: tKey("Payment verified"), step: tKey("Verify the payment"), hint: tKey("Finance confirms the money arrived"), role: "finance" },
  { check: "design_stage_done", group: "design", label: tKey("Design stage done"), step: tKey("Finish a design stage"), hint: tKey("A named design stage is complete"), role: "designer", designStage: "concepts" },
  { check: "material_list_signed_off", group: "design", label: tKey("Material list signed off"), step: tKey("Sign off the material list"), hint: tKey("The client signs off the materials"), role: "designer" },
];
export const BRANCH_COMPONENT = { label: tKey("Branch"), hint: tKey("Split the line on one question") } as const;
export const checkMeta = (check: FlowCheck) => CHECK_CATALOGUE.find((item) => item.check === check)!;

export const FIELD_LABELS: Record<FlowField, MessageKey> = {
  enquiryType: tKey("Enquiry type"), clientEmail: tKey("Client email"), propertyLocation: tKey("Property location"),
  floorPlanOrArea: tKey("Floor plan or area"), budget: tKey("Budget"),
};
export const QUESTION_LABELS: Record<BranchQuestion, MessageKey> = {
  subPath: tKey("Which sub-path?"), package: tKey("Which design package?"), budgetBand: tKey("Which budget band?"), clientType: tKey("Which client type?"),
};
export const DESIGN_STAGE_LABELS: Record<DesignStage, MessageKey> = {
  inspiration: tKey("Inspiration"), site_visit: tKey("Site visit"), concepts: tKey("Concepts"), space_planning: tKey("Space planning"),
  material_selection: tKey("Material selection"), renders: tKey("Renders"), approval: tKey("Design approval"),
};
export const DEADLINE_UNIT_LABELS: Record<DeadlineUnit, MessageKey> = { working_hours: tKey("Working hours"), hours: tKey("Hours"), days: tKey("Days") };
const COLUMN_LABELS: Record<string, MessageKey> = {
  qualified: tKey("New Opportunity"), qualification: tKey("Qualified"), proposal: tKey("Proposal"), negotiation: tKey("Negotiation"), won: tKey("Won"),
};
/** The furniture sub-paths, lettered as the opportunity screen shows them. */
export const SUB_PATH_ANSWERS: AnswerOption[] = [
  { value: "take_home_now", letter: "A", label: tKey("Take home now") },
  { value: "in_stock_delivery", letter: "B", label: tKey("In-stock delivery") },
  { value: "supplier_order", letter: "C", label: tKey("Supplier order") },
  { value: "core_collection_factory", letter: "D", label: tKey("Core collection") },
  { value: "bespoke", letter: "E", label: tKey("Bespoke") },
];

const titled = (code: string) => code.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
/** A pipeline column's name: the workspace's stage name, else the standard one, else the code in words. */
export function columnLabel(code: string, names: Record<string, string> = {}): string {
  return names[code] ?? COLUMN_LABELS[code] ?? titled(code);
}
export function roleName(code: string, roles: RoleOption[]): string {
  return roles.find((role) => role.code === code)?.name ?? titled(code);
}
export function answerOptions(question: BranchQuestion, options: AnswerOptions): AnswerOption[] {
  return question === "subPath" ? SUB_PATH_ANSWERS : options[question] ?? [];
}

// ── Reading a definition ─────────────────────────────────────────────────────────────────────────────────────────

/** Where a node sits: the main line, a branch, or a step on one answer's path. */
export type NodeLocation =
  | { kind: "main"; index: number; step: FlowStep }
  | { kind: "branch"; index: number; branch: FlowBranch }
  | { kind: "lane"; branchIndex: number; answerIndex: number; index: number; step: FlowStep; branch: FlowBranch };

export function locate(definition: FlowDefinition, id: string): NodeLocation | null {
  const main = definition.steps.findIndex((step) => step.key === id);
  if (main >= 0) return { kind: "main", index: main, step: definition.steps[main] };
  for (const [branchIndex, branch] of definition.branches.entries()) {
    if (branch.key === id) return { kind: "branch", index: branchIndex, branch };
    for (const [answerIndex, answer] of branch.answers.entries()) {
      const index = answer.steps.findIndex((step) => step.key === id);
      if (index >= 0) return { kind: "lane", branchIndex, answerIndex, index, step: answer.steps[index], branch };
    }
  }
  return null;
}

/** Every node id in reading order: a main step, its branch, each answer's steps, then the line again. */
export function nodeOrder(definition: FlowDefinition): string[] {
  return definition.steps.flatMap((step) => {
    const branch = definition.branches.find((item) => item.after === step.key);
    return branch ? [step.key, branch.key, ...branch.answers.flatMap((answer) => answer.steps.map((item) => item.key))] : [step.key];
  });
}

export function allSteps(definition: FlowDefinition): FlowStep[] {
  return [...definition.steps, ...definition.branches.flatMap((branch) => branch.answers.flatMap((answer) => answer.steps))];
}

// ── The canvas graph ─────────────────────────────────────────────────────────────────────────────────────────────

export const NODE_WIDTH = 288;
/** A card's height until the canvas has measured it. */
export const NODE_HEIGHT = 120;
/** The space between two cards, one under the other (the line between them runs through it). */
const ROW_GAP = 48;
const BRANCH_GAP = 32;
const SLOT = NODE_WIDTH + 48;
const ANSWER_WIDTH = 120;
/** Bands: the gap between two neighbouring bands, and room beside the cards for the column name. */
export const BAND_GAP = 16;
const BAND_LABEL = 136;

export type StepNodeData = { kind: "step"; step: FlowStep };
export type BranchNodeData = { kind: "branch"; branch: Omit<FlowBranch, "answers" | "after" | "rejoin">; answers: string[] };
export type BandNodeData = { kind: "band"; column: string };
export type GraphNode = {
  id: string; type: "step" | "branch" | "band"; position: { x: number; y: number };
  width: number; height: number; data: StepNodeData | BranchNodeData | BandNodeData;
};
export type GraphEdge = { id: string; source: string; target: string; sourceHandle?: string; data: { kind: "next" | "answer" | "rejoin"; answer?: string } };

export const branchWidth = (answers: number) => Math.max(NODE_WIDTH, answers * ANSWER_WIDTH);

/**
 * Top-to-bottom auto-layout: the main line down the centre; a branch is a wide card with one exit per answer, its
 * answers' steps in lanes beside the line, and the paths rejoin at the next main step. In right-to-left the
 * picture is mirrored. Pipeline columns become bands behind the steps that enter them. `heights` are the cards'
 * measured heights (by node id), so a taller card pushes the ones below it down instead of overlapping them.
 */
export function definitionToGraph(definition: FlowDefinition, options: { rtl?: boolean; heights?: Record<string, number> } = {}): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const height = (id: string) => options.heights?.[id] ?? NODE_HEIGHT;
  const centre = (offset: number, width: number) => (options.rtl ? -offset : offset) - width / 2;
  const stepNode = (step: FlowStep, offset: number, y: number): GraphNode =>
    ({ id: step.key, type: "step", position: { x: centre(offset, NODE_WIDTH), y }, width: NODE_WIDTH, height: height(step.key), data: { kind: "step", step } });
  let y = 0;
  let previous: string | null = null;
  const link = (source: string, target: string, data: GraphEdge["data"], sourceHandle?: string) =>
    edges.push({ id: `${source}${sourceHandle ? `:${sourceHandle}` : ""}->${target}`, source, target, data, ...(sourceHandle ? { sourceHandle } : {}) });
  /** Lanes still waiting for the step their paths rejoin at. */
  let open: { branch: FlowBranch; ends: Array<{ id: string; handle?: string; answer?: string }> } | null = null;
  for (const step of definition.steps) {
    nodes.push(stepNode(step, 0, y));
    if (open) {
      for (const end of open.ends) link(end.id, step.key, end.answer ? { kind: "rejoin", answer: end.answer } : { kind: "rejoin" }, end.handle);
      open = null;
    } else if (previous) link(previous, step.key, { kind: "next" });
    y += height(step.key) + ROW_GAP;
    previous = step.key;
    const branch = definition.branches.find((item) => item.after === step.key);
    if (!branch) continue;
    const width = branchWidth(branch.answers.length);
    nodes.push({ id: branch.key, type: "branch", position: { x: centre(0, width), y }, width, height: height(branch.key),
      data: { kind: "branch", branch: { key: branch.key, question: branch.question }, answers: branch.answers.map((answer) => answer.value) } });
    link(step.key, branch.key, { kind: "next" });
    y += height(branch.key) + BRANCH_GAP;
    const ends: Array<{ id: string; handle?: string; answer?: string }> = [];
    const count = branch.answers.length;
    let longest = 0;
    branch.answers.forEach((answer, index) => {
      if (!answer.steps.length) { ends.push({ id: branch.key, handle: answer.value, answer: answer.value }); return; }
      // Under its own exit on the branch card, but clear of the line down the middle and of the other exits.
      const exit = (index - (count - 1) / 2) * (branchWidth(count) / Math.max(count, 1));
      const offset = Math.sign(exit) * Math.max(Math.abs(exit), count > 2 ? SLOT - 24 : SLOT / 2 + 12);
      let laneY = y;
      answer.steps.forEach((laneStep, depth) => {
        nodes.push(stepNode(laneStep, offset, laneY));
        laneY += height(laneStep.key) + ROW_GAP;
        if (depth === 0) link(branch.key, laneStep.key, { kind: "answer", answer: answer.value }, answer.value);
        else link(answer.steps[depth - 1].key, laneStep.key, { kind: "next" });
      });
      ends.push({ id: answer.steps.at(-1)!.key });
      longest = Math.max(longest, laneY - y);
    });
    if (!count) ends.push({ id: branch.key });
    y += longest || (NODE_HEIGHT + ROW_GAP) / 2;
    open = { branch, ends };
    previous = null;
  }
  return { nodes: [...bands(definition, nodes), ...nodes], edges };
}

/**
 * Soft bands behind the cards, one per run of rows whose steps enter the same pipeline column. Bands follow the rows
 * top to bottom, never overlap and keep the same gap between them, so their rounded corners never touch.
 */
function bands(definition: FlowDefinition, nodes: GraphNode[]): GraphNode[] {
  if (!nodes.length) return [];
  const pad = (ROW_GAP - BAND_GAP) / 2;
  // Room on both sides for the column name, which sits at the band's inline start in either direction.
  const minX = Math.min(...nodes.map((node) => node.position.x)) - pad - BAND_LABEL;
  const maxX = Math.max(...nodes.map((node) => node.position.x + node.width)) + pad + BAND_LABEL;
  // A row is the cards that start at the same height; it belongs to the column most of its steps enter (a branch
  // card has no column of its own and stays with the row above it).
  const rows = [...new Set(nodes.map((node) => node.position.y))].sort((a, b) => a - b).map((top) => {
    const inRow = nodes.filter((node) => node.position.y === top);
    const columns = inRow.flatMap((node) => node.data.kind === "step" ? [node.data.step.column] : []);
    const column = columns.sort((a, b) => columns.filter((item) => item === b).length - columns.filter((item) => item === a).length
      || definition.columns.indexOf(a) - definition.columns.indexOf(b))[0] ?? null;
    return { top, bottom: Math.max(...inRow.map((node) => node.position.y + node.height)), column };
  });
  const runs: Array<{ column: string; top: number; bottom: number }> = [];
  for (const row of rows) {
    const last = runs.at(-1);
    if (last && (row.column === null || row.column === last.column)) last.bottom = Math.max(last.bottom, row.bottom);
    else if (row.column !== null) runs.push({ column: row.column, top: row.top, bottom: row.bottom });
  }
  const placed = runs.map((run) => ({ column: run.column, top: run.top - pad, bottom: run.bottom + pad }));
  for (let index = 1; index < placed.length; index += 1) {
    const [before, after] = [placed[index - 1], placed[index]];
    if (after.top - before.bottom >= BAND_GAP) continue;
    const middle = (runs[index - 1].bottom + runs[index].top) / 2;
    before.bottom = middle - BAND_GAP / 2;
    after.top = middle + BAND_GAP / 2;
  }
  const seen = new Map<string, number>();
  return placed.map((band) => {
    const count = seen.get(band.column) ?? 0;
    seen.set(band.column, count + 1);
    return {
      id: count ? `band:${band.column}:${count + 1}` : `band:${band.column}`, type: "band" as const, position: { x: minX, y: band.top },
      width: maxX - minX, height: band.bottom - band.top, data: { kind: "band" as const, column: band.column },
    };
  });
}

/**
 * The definition a graph draws: the inverse of `definitionToGraph` (bands are decoration and are ignored). A main
 * step has one exit; a branch has one exit per answer: "answer" into that answer's first step, or "rejoin" straight
 * to the step where the paths meet; an answer's last step exits with "rejoin".
 */
export function graphToDefinition(graph: { nodes: GraphNode[]; edges: GraphEdge[] }, columns: string[]): FlowDefinition {
  const byId = new Map(graph.nodes.filter((node) => node.type !== "band").map((node) => [node.id, node]));
  const out = (id: string) => graph.edges.filter((edge) => edge.source === id);
  const incoming = new Set(graph.edges.map((edge) => edge.target));
  const stepOf = (id: string) => (byId.get(id)!.data as StepNodeData).step;
  const steps: FlowStep[] = [];
  const branches: FlowBranch[] = [];
  let current = [...byId.values()].find((node) => node.type === "step" && !incoming.has(node.id))?.id ?? null;
  while (current) {
    steps.push(stepOf(current));
    const exit = out(current)[0];
    const target = exit ? byId.get(exit.target) : undefined;
    if (!target) break;
    if (target.type === "step") { current = target.id; continue; }
    const data = target.data as BranchNodeData;
    let rejoin: string | null = null;
    const answers = data.answers.map((value) => {
      const first = out(target.id).find((edge) => edge.sourceHandle === value);
      const lane: FlowStep[] = [];
      if (first?.data.kind === "answer") {
        for (let at: string | null = first.target; at;) {
          lane.push(stepOf(at));
          const edge: GraphEdge | undefined = out(at)[0];
          if (edge?.data.kind === "rejoin") rejoin ??= edge.target;
          at = edge && edge.data.kind !== "rejoin" ? edge.target : null;
        }
      } else if (first) rejoin ??= first.target;
      return { value, steps: lane };
    });
    if (!data.answers.length) rejoin = out(target.id)[0]?.target ?? null;
    branches.push({ key: data.branch.key, question: data.branch.question, after: current, rejoin: rejoin ?? "", answers });
    current = rejoin;
  }
  return { schema: 1, columns, steps, branches };
}

// ── Editing ──────────────────────────────────────────────────────────────────────────────────────────────────────

const clone = (definition: FlowDefinition): FlowDefinition => structuredClone(definition);

export function uniqueKey(definition: FlowDefinition, base: string): string {
  const taken = new Set([...allSteps(definition).map((step) => step.key), ...definition.branches.map((branch) => branch.key)]);
  const root = (base.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^[^a-z]+/, "") || "step").slice(0, 34);
  if (!taken.has(root)) return root;
  for (let index = 2; ; index += 1) if (!taken.has(`${root}_${index}`)) return `${root}_${index}`;
}

/** A step keeps only what it says: no false flags, empty lists or a design stage on another check. */
export function cleanStep(step: FlowStep): FlowStep {
  const next: FlowStep = { ...step };
  if (!next.optional) delete next.optional;
  if (!next.auto || next.optional) delete next.auto;
  if (!next.clientVisible) delete next.clientVisible;
  if (!next.notify?.length) delete next.notify;
  if (!next.needs?.length && next.check !== "details_complete") delete next.needs;
  if (next.check !== "design_stage_done") delete next.designStage;
  else next.designStage ??= "concepts";
  if (next.check === "details_complete" && !next.needs?.length) next.needs = ["clientEmail"];
  if (!next.deadline) delete next.deadline;
  return next;
}

/** Each branch rejoins at the main step right after the one it follows. */
function normalise(definition: FlowDefinition): FlowDefinition {
  const keys = definition.steps.map((step) => step.key);
  definition.branches = definition.branches.filter((branch) => keys.includes(branch.after));
  for (const branch of definition.branches) branch.rejoin = keys[keys.indexOf(branch.after) + 1] ?? branch.rejoin;
  return definition;
}

const ends = (definition: FlowDefinition) => definition.steps.at(-1)?.check === "payment_proof_attached";
const earlierColumn = (definition: FlowDefinition, column: string | undefined) =>
  column === WON_COLUMN || !column ? definition.columns.at(-2) ?? definition.columns[0] : column;

/**
 * Adds a step for a catalogue check after the selected node: after a main step (before its branch, if it has one),
 * after a step on an answer's path, or after a branch (where the paths rejoin). With nothing selected it goes at
 * the end of the line, before the payment proof step that always ends it.
 */
export function insertStep(definition: FlowDefinition, afterId: string | null, check: FlowCheck, name: string): { definition: FlowDefinition; id: string } {
  const next = clone(definition);
  const meta = checkMeta(check);
  const key = uniqueKey(next, check === "design_stage_done" ? "design_stage" : check.replace(/_(completed|recorded|chosen|confirmed|attached|approved|exists|set|logged|complete|done|sent|verified|signed_off)$/, ""));
  const at = afterId ? locate(next, afterId) : null;
  const make = (column: string | undefined): FlowStep => cleanStep({ key, name, role: meta.role, check, column: earlierColumn(next, column), ...(meta.needs ? { needs: [...meta.needs] } : {}), ...(meta.designStage ? { designStage: meta.designStage } : {}) });
  if (at?.kind === "lane") {
    next.branches[at.branchIndex].answers[at.answerIndex].steps.splice(at.index + 1, 0, make(at.step.column));
    return { definition: next, id: key };
  }
  let index: number;
  if (at?.kind === "branch") index = next.steps.findIndex((step) => step.key === at.branch.rejoin);
  else if (at?.kind === "main") index = at.index + 1;
  else index = next.steps.length;
  if (index < 0) index = next.steps.length;
  // The payment proof step always ends the line.
  if (index >= next.steps.length && ends(next)) index = next.steps.length - 1;
  const before = next.steps[index - 1];
  next.steps.splice(index, 0, make(before?.column ?? next.columns[0]));
  // A step put right after a step with a branch comes before that branch.
  if (at?.kind === "main") for (const branch of next.branches) if (branch.after === at.step.key) branch.after = key;
  return { definition: normalise(next), id: key };
}

/** The question a new branch asks: the latest one a step before it answers, else the client type. */
function askedBefore(definition: FlowDefinition, index: number): BranchQuestion {
  const asked = definition.steps.slice(0, index + 1).reverse().find((step) => ["sub_path_chosen", "package_chosen", "client_type_set"].includes(step.check) || step.needs?.includes("budget"));
  if (!asked) return "clientType";
  return asked.check === "sub_path_chosen" ? "subPath" : asked.check === "package_chosen" ? "package" : asked.check === "client_type_set" ? "clientType" : "budgetBand";
}

/** Splits the line after a main step (one branch per step, never after the last step or inside a branch). */
export function insertBranch(definition: FlowDefinition, afterId: string | null, options: AnswerOptions): { definition: FlowDefinition; id: string } | null {
  const next = clone(definition);
  const at = afterId ? locate(next, afterId) : { kind: "main" as const, index: next.steps.length - 2, step: next.steps[next.steps.length - 2] };
  if (!at || at.kind !== "main" || !at.step || at.index >= next.steps.length - 1 || next.branches.some((branch) => branch.after === at.step.key)) return null;
  const question = askedBefore(next, at.index);
  const key = uniqueKey(next, "branch");
  const values = answerOptions(question, options).map((option) => option.value);
  next.branches.push({ key, question, after: at.step.key, rejoin: next.steps[at.index + 1].key, answers: (question === "subPath" ? values : values.slice(0, 2)).map((value) => ({ value, steps: [] })) });
  return { definition: next, id: key };
}

export function canRemove(definition: FlowDefinition, id: string): boolean {
  const at = locate(definition, id);
  return Boolean(at) && !(at!.kind === "main" && at!.index === definition.steps.length - 1 && at!.step.check === "payment_proof_attached");
}

/** Removes a node. A removed branch takes its answers' steps; a branch whose step is removed follows the step before. */
export function removeNode(definition: FlowDefinition, id: string): FlowDefinition {
  if (!canRemove(definition, id)) return definition;
  const next = clone(definition);
  const at = locate(next, id)!;
  if (at.kind === "branch") next.branches.splice(at.index, 1);
  else if (at.kind === "lane") next.branches[at.branchIndex].answers[at.answerIndex].steps.splice(at.index, 1);
  else {
    const before = next.steps[at.index - 1]?.key;
    next.steps.splice(at.index, 1);
    for (const branch of next.branches) if (branch.after === id) branch.after = before && !next.branches.some((other) => other.after === before) ? before : "";
  }
  return normalise(next);
}

export function updateStep(definition: FlowDefinition, key: string, patch: Partial<Omit<FlowStep, "key">>): FlowDefinition {
  const next = clone(definition);
  const at = locate(next, key);
  if (!at || at.kind === "branch") return definition;
  const updated = cleanStep({ ...at.step, ...patch });
  for (const [field, value] of Object.entries(patch)) if (value === undefined) delete (updated as Record<string, unknown>)[field];
  if (at.kind === "main") next.steps[at.index] = updated;
  else next.branches[at.branchIndex].answers[at.answerIndex].steps[at.index] = updated;
  return next;
}

/** Changes a branch's question (its answers start again from that question's choices) or which answers it has. */
export function updateBranch(definition: FlowDefinition, key: string, patch: { question?: BranchQuestion; answers?: string[] }, options: AnswerOptions): FlowDefinition {
  const next = clone(definition);
  const branch = next.branches.find((item) => item.key === key);
  if (!branch) return definition;
  if (patch.question && patch.question !== branch.question) {
    branch.question = patch.question;
    const values = answerOptions(patch.question, options).map((option) => option.value);
    branch.answers = (patch.question === "subPath" ? values : values.slice(0, 2)).map((value) => ({ value, steps: [] }));
  }
  if (patch.answers) {
    const order = answerOptions(branch.question, options).map((option) => option.value);
    const rank = (value: string) => (order.indexOf(value) + order.length + 1) % (order.length + 1);
    branch.answers = [...new Set(patch.answers)].sort((a, b) => rank(a) - rank(b))
      .map((value) => branch.answers.find((answer) => answer.value === value) ?? { value, steps: [] });
  }
  return next;
}

/** Moves a step one place up or down its own path; the payment proof step stays last. */
export function moveStep(definition: FlowDefinition, key: string, direction: -1 | 1): FlowDefinition {
  const next = clone(definition);
  const at = locate(next, key);
  if (!at || at.kind === "branch") return definition;
  const list = at.kind === "main" ? next.steps : next.branches[at.branchIndex].answers[at.answerIndex].steps;
  const target = at.index + direction;
  if (target < 0 || target >= list.length) return definition;
  if (at.kind === "main" && ends(next) && (at.index === list.length - 1 || target === list.length - 1)) return definition;
  [list[at.index], list[target]] = [list[target], list[at.index]];
  return normalise(next);
}

export function canMove(definition: FlowDefinition, key: string, direction: -1 | 1): boolean {
  return moveStep(definition, key, direction) !== definition;
}

// ── Publishing problems ──────────────────────────────────────────────────────────────────────────────────────────

export type FlowProblem = { nodeId: string | null; field: string | null; message: string; path: string };

/** Points each validator error at the card (and property) it is about; flow-wide errors point at no card. */
export function problemsFor(errors: FlowValidationError[], definition: FlowDefinition): FlowProblem[] {
  return errors.map(({ path, message }) => {
    const lane = /^branches\[(\d+)\]\.answers\[(\d+)\]\.steps\[(\d+)\](?:\.(\w+))?/.exec(path);
    if (lane) return { nodeId: definition.branches[+lane[1]]?.answers[+lane[2]]?.steps[+lane[3]]?.key ?? null, field: lane[4] ?? null, message, path };
    const branch = /^branches\[(\d+)\](?:\.(\w+))?/.exec(path);
    if (branch) return { nodeId: definition.branches[+branch[1]]?.key ?? null, field: branch[2] ?? null, message, path };
    const step = /^steps\[(\d+)\](?:\.(\w+))?/.exec(path);
    if (step) return { nodeId: definition.steps[+step[1]]?.key ?? null, field: step[2] ?? null, message, path };
    return { nodeId: null, field: null, message, path };
  });
}
