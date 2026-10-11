/**
 * The demo scenario matrix (`sandbox --scenarios`): every main situation a firm meets in Wodana, each with at least one
 * realistic example in the organization. Pure data and functions: what the scenarios are (some depend on the
 * organization's own options: its enquiry types, its sales pipeline's stages, its project route's stages, its test
 * members), and, given what is already there, what is missing and which recipes make it. Nothing here names a tenant.
 */

export type ScenarioModule = "sales" | "design" | "quotations" | "deals" | "projects" | "changes" | "purchasing" | "factory" | "site" | "finance" | "ledger"
  | "approvals" | "my_day" | "portal";

export const SCENARIO_MODULES: readonly ScenarioModule[] = ["sales", "design", "quotations", "deals", "projects", "changes", "purchasing", "factory", "site", "finance",
  "ledger", "approvals", "my_day", "portal"];

/**
 * The recipes that make missing scenarios, in the order they run: a later one builds on what an earlier one makes
 * (a change needs a running project; the Ledger posts what the others made; My day is swept from everything).
 */
export const RECIPES = [
  "enquiries", "pipeline", "inbox", "design_fee", "design_stages", "quotes", "deals", "planning",
  "project_kickoff", "project_route", "project_hold", "project_completed", "project_risk", "project_budget",
  "changes", "purchasing", "stock", "factory", "logistics", "site", "finance", "ledger", "approvals", "portal", "my_day",
] as const;
export type RecipeKey = typeof RECIPES[number];

export type ScenarioSpec = { key: string; module: ScenarioModule; label: string; recipe: RecipeKey; /** The release that added it (1: the first scenarios, 2: the rest); every run makes both. */ pass: 1 | 2 };

const PASS_TWO = new Set<RecipeKey>(["pipeline", "inbox", "design_fee", "planning", "stock", "factory", "logistics", "site", "approvals", "portal", "my_day"]);
const PASS_TWO_KEYS = new Set(["design.moodboard", "design.site_visit", "refund.requested", "finance_request.waiting", "petty_cash.claim", "supplier.payment"]);
const spec = (key: string, module: ScenarioModule, label: string, recipe: RecipeKey): ScenarioSpec =>
  ({ key, module, label, recipe, pass: PASS_TWO.has(recipe) || PASS_TWO_KEYS.has(key) || key.startsWith("approval.") || key.startsWith("my_day.") || key.startsWith("portal.") ? 2 : 1 });

/** The scenarios every organization gets, whatever its options. */
export const FIXED_SCENARIOS: readonly ScenarioSpec[] = [
  // Sales
  spec("sales.enquiry.new", "sales", "Enquiry, new and not yet contacted", "enquiries"),
  spec("sales.enquiry.contacted", "sales", "Enquiry, contacted with a follow-up booked", "enquiries"),
  spec("sales.enquiry.qualified", "sales", "Enquiry, qualified into an opportunity", "enquiries"),
  spec("sales.enquiry.not_sure", "sales", "Enquiry, type not sure yet", "enquiries"),
  spec("sales.enquiry.lost", "sales", "Enquiry, lost with a reason", "enquiries"),
  spec("sales.enquiry.converted", "sales", "Enquiry converted into a planning record", "planning"),
  spec("sales.follow_up.today", "sales", "Follow-up due today", "enquiries"),
  spec("sales.follow_up.overdue", "sales", "Follow-up overdue", "enquiries"),
  spec("sales.message.unanswered", "sales", "Client message waiting for a reply", "inbox"),
  // Design
  spec("design.fee.sent", "design", "Design fee proposal sent to the client", "design_fee"),
  spec("design.fee.accepted", "design", "Design fee proposal accepted", "design_fee"),
  spec("design.fee.paid", "design", "Design fee paid (payment proof, verified by Finance)", "design_fee"),
  spec("design.stage.concepts", "design", "Design concepts uploaded", "design_stages"),
  spec("design.stage.revision_requested", "design", "Design revision requested by the client", "design_stages"),
  spec("design.stage.internal_review", "design", "Design waiting for internal review", "design_stages"),
  spec("design.stage.client_review", "design", "Design waiting for the client's review", "design_stages"),
  spec("design.stage.approved", "design", "Design approved by the client", "design_stages"),
  spec("design.moodboard", "design", "Moodboard shared with the client", "design_stages"),
  spec("design.site_visit", "design", "Site visit recorded with measurements", "design_stages"),
  // Quotations
  spec("quote.draft", "quotations", "Quotation, draft", "quotes"),
  spec("quote.with_qs", "quotations", "Quotation with the QS (scope rules)", "quotes"),
  spec("quote.internal_approved", "quotations", "Quotation internally approved", "quotes"),
  spec("quote.sent", "quotations", "Quotation sent to the client", "quotes"),
  spec("quote.accepted", "quotations", "Quotation accepted", "quotes"),
  spec("quote.declined", "quotations", "Quotation declined by the client", "quotes"),
  spec("quote.expired", "quotations", "Quotation expired", "quotes"),
  spec("quote.discount_pending", "quotations", "Quotation with a discount waiting for approval", "quotes"),
  spec("quote.revision", "quotations", "Quotation revised (a second version)", "quotes"),
  // Deal file and planning
  spec("deal.waiting_finance", "deals", "Deal file waiting for Finance", "deals"),
  spec("deal.waiting_approval", "deals", "Deal file waiting for approval", "deals"),
  spec("deal.released", "deals", "Deal file approved and released", "deals"),
  spec("planning.requirements", "deals", "Planning at requirements", "planning"),
  spec("planning.scope", "deals", "Planning at scope", "planning"),
  spec("planning.ready", "deals", "Planning ready for the quotation", "planning"),
  // Projects (the route's stages are added per organization)
  spec("project.on_hold", "projects", "Project on hold", "project_hold"),
  spec("project.completed", "projects", "Project completed with its handover pack", "project_completed"),
  spec("project.at_risk", "projects", "Project at risk (late order, missing site reports)", "project_risk"),
  spec("project.over_budget", "projects", "Project over budget", "project_budget"),
  spec("project.costs", "projects", "Project costs: received orders, bills, labour and petty cash", "project_budget"),
  spec("project.committed", "projects", "Project with committed orders", "project_budget"),
  spec("project.budget", "projects", "Project budget from the quotation's cost estimate", "project_budget"),
  // Change requests
  spec("change.draft", "changes", "Change request, draft", "changes"),
  spec("change.pricing", "changes", "Change request being priced", "changes"),
  spec("change.with_qs", "changes", "Change request with the QS", "changes"),
  spec("change.waiting_approval", "changes", "Change request waiting for approval", "changes"),
  spec("change.with_client", "changes", "Change request with the client", "changes"),
  spec("change.applied", "changes", "Change request approved and applied (variation, milestone, handover moved)", "changes"),
  spec("change.declined", "changes", "Change request declined by the client", "changes"),
  // Purchasing and inventory
  spec("po.draft", "purchasing", "Purchase order, draft", "purchasing"),
  spec("po.sent", "purchasing", "Purchase order sent to the supplier", "purchasing"),
  spec("po.part_received", "purchasing", "Purchase order part received", "purchasing"),
  spec("po.received", "purchasing", "Purchase order received", "purchasing"),
  spec("po.billed", "purchasing", "Purchase order billed", "purchasing"),
  spec("po.late", "purchasing", "Purchase order late", "purchasing"),
  spec("stock.low", "purchasing", "Stock item below its reorder level", "stock"),
  spec("bill.due", "purchasing", "Supplier bill due", "purchasing"),
  spec("bill.overdue", "purchasing", "Supplier bill overdue", "purchasing"),
  // Factory and logistics
  spec("factory.planned", "factory", "Work order planned", "factory"),
  spec("factory.in_production", "factory", "Work order in production", "factory"),
  spec("factory.done", "factory", "Work order done (ready)", "factory"),
  spec("factory.shortage", "factory", "Work order waiting for materials", "factory"),
  spec("logistics.delivery_booked", "factory", "Delivery booked", "logistics"),
  spec("logistics.installation_scheduled", "factory", "Installation scheduled", "logistics"),
  spec("logistics.permit_expiring", "factory", "Permit expiring", "logistics"),
  // Site
  spec("site.report.approved", "site", "Site report approved", "site"),
  spec("site.report.missing", "site", "Site report days missing", "site"),
  spec("site.snag.open", "site", "Snag open", "site"),
  spec("site.snag.critical", "site", "Snag critical", "site"),
  spec("site.snag.closed", "site", "Snag closed", "site"),
  spec("site.progress_photos", "site", "Daily progress with photos", "site"),
  // Finance
  spec("invoice.issued", "finance", "Client invoice issued", "finance"),
  spec("invoice.overdue", "finance", "Client invoice overdue", "finance"),
  spec("invoice.paid", "finance", "Client invoice paid", "finance"),
  spec("receipt.verified", "finance", "Client receipt verified", "finance"),
  spec("receipt.pending", "finance", "Client receipt waiting for verification", "finance"),
  spec("refund.requested", "finance", "Refund request", "finance"),
  spec("finance_request.waiting", "finance", "Finance request waiting", "finance"),
  spec("petty_cash.claim", "finance", "Petty cash claim", "finance"),
  spec("supplier.payment", "finance", "Supplier payment", "finance"),
  // Wodana Ledger
  spec("ledger.on", "ledger", "Wodana Ledger on for the company", "ledger"),
  spec("ledger.statements_source", "ledger", "Statements come from the Ledger", "ledger"),
  spec("ledger.posted", "ledger", "Documents posted to the Ledger", "ledger"),
  // Client portal
  spec("portal.access", "portal", "Client with portal access", "portal"),
  spec("portal.decision.quote", "portal", "Client decision waiting: quotation", "quotes"),
  spec("portal.decision.design", "portal", "Client decision waiting: design", "design_stages"),
  spec("portal.decision.change", "portal", "Client decision waiting: change", "changes"),
];

/**
 * The approval kinds the feed shows that demo data can wait on (an AI action and the factory's material swap and the
 * stock correction need a person on the spot, and a warranty claim comes from a client after handover: those are made
 * by the showcase when they are made at all).
 */
export const APPROVAL_KINDS = ["quote_review", "qs_review", "design_review", "receipt", "invoice", "agreement", "deal_finance", "deal_approval", "order", "output",
  "site_report", "petty_cash", "snag", "bill", "payment_run", "reimbursement", "approval"] as const;

const APPROVAL_LABELS: Record<typeof APPROVAL_KINDS[number], string> = {
  quote_review: "quotation to review", qs_review: "quotation with the QS", design_review: "design to review", receipt: "payment to verify",
  invoice: "milestone to invoice", agreement: "agreement to execute", deal_finance: "deal file for Finance", deal_approval: "deal file to approve",
  order: "purchase order", output: "factory output", site_report: "site report", petty_cash: "petty cash claim", snag: "snag to close",
  bill: "supplier bill on hold", payment_run: "payment run", reimbursement: "claim to reimburse", approval: "change request or refund",
};

/** Where a waiting approval of each kind comes from. */
const APPROVAL_RECIPE: Record<typeof APPROVAL_KINDS[number], RecipeKey> = {
  quote_review: "quotes", qs_review: "quotes", design_review: "design_stages", receipt: "finance", invoice: "finance", agreement: "deals",
  deal_finance: "deals", deal_approval: "deals", order: "purchasing", output: "factory", site_report: "site", petty_cash: "finance", snag: "site",
  bill: "purchasing", payment_run: "finance", reimbursement: "finance", approval: "changes",
};

/** The organization's own options the matrix depends on. */
export type MatrixContext = {
  enquiryTypes: ReadonlyArray<{ code: string; label: string }>;
  pipelineStages: ReadonlyArray<{ code: string; label: string }>;
  routeStages: ReadonlyArray<{ key: string; label: string }>;
  members: ReadonlyArray<{ key: string; displayName: string }>;
};

/** The project route stage a stage scenario stops at goes through a different recipe at its ends. */
const routeRecipe = (_key: string, _position: number, _count: number): RecipeKey => "project_route";

/** Every scenario for the organization: the fixed ones and those its own options add. */
export function expandMatrix(context: MatrixContext): ScenarioSpec[] {
  const typed = context.enquiryTypes.filter((type) => type.code !== "not_sure")
    .map((type) => spec(`sales.enquiry_type.${type.code}`, "sales", `Enquiry: ${type.label}`, "enquiries"));
  const stages = context.pipelineStages.map((stage) => spec(`sales.opportunity.${stage.code}`, "sales", `Opportunity at ${stage.label}`, "pipeline"));
  const route = context.routeStages.map((stage, position) => spec(`project.stage.${stage.key}`, "projects", `Project at ${stage.label}`,
    routeRecipe(stage.key, position, context.routeStages.length)));
  const approvals = APPROVAL_KINDS.map((kind) => spec(`approval.${kind}`, "approvals", `Waiting approval: ${APPROVAL_LABELS[kind]}`, APPROVAL_RECIPE[kind]));
  const myDay = context.members.map((member) => spec(`my_day.${member.key}`, "my_day", `My day for ${member.displayName}`, "my_day"));
  const all = [...FIXED_SCENARIOS, ...typed, ...stages, ...route, ...approvals, ...myDay];
  const order = new Map(SCENARIO_MODULES.map((module, index) => [module, index]));
  // Grouped by module (stable within a module), keys unique.
  const seen = new Set<string>();
  return all.filter((row) => !seen.has(row.key) && seen.add(row.key)).sort((a, b) => order.get(a.module)! - order.get(b.module)!);
}

export type Found = ReadonlyMap<string, string | null | undefined>;
export type ScenarioPlan = {
  /** Scenarios with an example already: key → its reference. */
  present: Array<{ spec: ScenarioSpec; reference: string }>;
  missing: ScenarioSpec[];
  /** The recipes that make the missing ones, in run order, each once. */
  recipes: RecipeKey[];
};

/** What is there, what is missing and the recipes to run, in their order. Nothing to run when everything is there. */
export function planScenarios(matrix: readonly ScenarioSpec[], found: Found): ScenarioPlan {
  const present: ScenarioPlan["present"] = [];
  const missing: ScenarioSpec[] = [];
  for (const row of matrix) {
    const reference = found.get(row.key);
    if (reference) present.push({ spec: row, reference });
    else missing.push(row);
  }
  const wanted = new Set(missing.map((row) => row.recipe));
  return { present, missing, recipes: RECIPES.filter((recipe) => wanted.has(recipe)) };
}

export type ScenarioOutcome = { spec: ScenarioSpec; status: "already there" | "created" | "would create" | "skipped"; reference: string | null; reason?: string };

/**
 * Each scenario's outcome after the recipes ran: there before, made now, still missing (with the reason its recipe gave,
 * or that it would be made on --apply).
 */
export function outcomes(matrix: readonly ScenarioSpec[], before: Found, after: Found, options: { apply: boolean; reasons: ReadonlyMap<RecipeKey, string>; notes?: ReadonlyMap<string, string> }): ScenarioOutcome[] {
  return matrix.map((row) => {
    const was = before.get(row.key), now = after.get(row.key);
    if (was) return { spec: row, status: "already there", reference: was };
    if (now) return { spec: row, status: "created", reference: now };
    if (!options.apply) return { spec: row, status: "would create", reference: null };
    return { spec: row, status: "skipped", reference: null, reason: options.notes?.get(row.key) ?? options.reasons.get(row.recipe) ?? "its recipe ran but didn't make it" };
  });
}

/** Counts per module: how many scenarios, already there, created, skipped. */
export function moduleCounts(rows: readonly ScenarioOutcome[]) {
  const counts: Record<string, { scenarios: number; alreadyThere: number; created: number; skipped: number; wouldCreate: number }> = {};
  for (const row of rows) {
    const entry = counts[row.spec.module] ??= { scenarios: 0, alreadyThere: 0, created: 0, skipped: 0, wouldCreate: 0 };
    entry.scenarios += 1;
    if (row.status === "already there") entry.alreadyThere += 1;
    else if (row.status === "created") entry.created += 1;
    else if (row.status === "skipped") entry.skipped += 1;
    else entry.wouldCreate += 1;
  }
  return counts;
}
