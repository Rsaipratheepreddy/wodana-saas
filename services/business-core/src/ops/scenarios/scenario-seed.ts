import { Dec } from "../../catalog-core/decimal";
import { BooksPostingService } from "../../books/posting/posting.service";
import { BooksSettingsService } from "../../books/settings/books-settings.service";
import { BooksStatementsService } from "../../books/statements/statements.service";
import { CrmLeadsService } from "../../crm/leads/crm-leads.service";
import { LogContactDto } from "../../crm/leads/dto/leads.dto";
import { ProjectChangesService } from "../../change-requests/project-changes.service";
import { ProjectCoreService } from "../../project-core/project-core.service";
import { OrdersService } from "../../purchasing/orders.service";
import { PayablesService } from "../../purchasing/payables.service";
import { ReceivingService } from "../../purchasing/receiving.service";
import { QuotationBuilderService } from "../../quotation/quotation-builder.service";
import { ReceivablesService } from "../../receivables/receivables.service";
import { ValueEngineeringService } from "../../value-engineering/value-engineering.service";
import {
  describe, ShowcaseSeed, Skip, type Any, type ShowcaseActor, type ShowcaseCtx, type ShowcaseInput, type ShowcaseStory,
} from "../../seed/showcase";
import type { RecipeKey } from "./scenario-matrix";
import { regionAmount, regionPerson, type RegionFixture } from "./scenario-regions";
import type { StoryKey } from "./scenario-stories";

/**
 * The demo scenarios' recipes (`sandbox --scenarios`), on the showcase engine: the stories it tells (enquiry to project,
 * each stopping at its scenario) and the few steps after a story that the engine has no stop for (a quotation declined
 * or revised, a discount over the firm's limit, a project put on hold or flagged at risk, change requests in every
 * state, purchase orders, supplier bills, client invoices and receipts, and the Ledger). Everything goes through the
 * app's own services as the sandbox's test members. Each recipe is idempotent (stable ids and finds), and a step the
 * product refuses is reported with its reason; the run goes on with the rest.
 */

/** Which stories each recipe needs. */
export const RECIPE_STORIES: Partial<Record<RecipeKey, (route: readonly string[]) => StoryKey[]>> = {
  design_stages: () => ["design-uploaded", "design-internal", "design-client", "design-changes", "quote-draft"],
  quotes: () => ["quote-draft", "quote-qs", "quote-review", "quote-approved", "quote-sent", "quote-declined", "quote-discount", "quote-revision", "quote-expiring", "deal-released"],
  deals: () => ["deal-finance", "deal-approval", "deal-released", "agreement-waiting"],
  design_fee: () => ["fee-sent", "fee-accepted", "fee-paid"],
  planning: () => ["planning-scope", "planning-ready", "quote-draft"],
  factory: (route) => [route.includes("production") ? "stage-production" : `stage-${route[0]}` as StoryKey],
  logistics: (route) => route.filter((stage) => ["installation", "permit", "snagging"].includes(stage)).map((stage) => `stage-${stage}` as StoryKey),
  site: (route) => ["project-risk", "project-completed", ...(route.includes("snagging") ? ["stage-snagging" as StoryKey] : [])],
  portal: (route) => ["quote-sent", "design-client", route.includes("production") ? "stage-production" : `stage-${route[0]}` as StoryKey],
  approvals: () => ["quote-review", "quote-qs", "design-internal", "deal-finance", "deal-approval", "agreement-waiting", "project-budget"],
  my_day: () => ["project-risk"],
  project_route: (route) => route.map((stage) => `stage-${stage}` as StoryKey),
  project_kickoff: (route) => route.slice(0, 1).map((stage) => `stage-${stage}` as StoryKey),
  project_hold: () => ["project-hold"],
  project_completed: () => ["project-completed"],
  project_risk: () => ["project-risk"],
  project_budget: () => ["project-budget"],
  changes: (route) => [route.includes("production") ? "stage-production" : `stage-${route[0]}` as StoryKey],
  purchasing: (route) => [...(route.includes("procurement") ? ["stage-procurement" as StoryKey] : []), "project-risk", "project-budget"],
  finance: (route) => ["project-completed", "project-budget", "project-risk", ...(route[0] ? [`stage-${route[0]}` as StoryKey] : [])],
};

export type ScenarioSeedInput = ShowcaseInput & {
  stories: ShowcaseStory[];
  fixture: RegionFixture;
  country: string;
  currency: string;
};

type Actor = ShowcaseActor;

export class ScenarioSeed extends ShowcaseSeed {
  /** Why a recipe made nothing (its first refusal), by recipe; and per scenario where a step knows exactly. */
  readonly reasons = new Map<RecipeKey, string>();
  readonly notes = new Map<string, string>();

  constructor(protected readonly scenarioInput: ScenarioSeedInput) {
    super({ ...scenarioInput, settleChecks: true });
  }

  protected storyCtx(key: StoryKey): ShowcaseCtx | null {
    const s = this.scenarioInput.stories.find((story) => story.key === `scenario-${key}`);
    const ids = this.result.scenarios[`scenario-${key}`];
    return s && ids ? { s, rooms: new Map(), ids } : null;
  }

  /** Runs one recipe; its first refusal is kept as the reason its scenarios are still missing. */
  async recipe(key: RecipeKey, work: () => Promise<void>) {
    try { await work(); } catch (error) {
      const reason = error instanceof Skip ? error.reason : describe(error);
      if (!this.reasons.has(key)) this.reasons.set(key, reason.slice(0, 300));
      this.skip(`scenarios · ${key}`, reason);
    }
  }

  /** A soft step inside a recipe: a refusal is noted for the scenario it was for and the recipe goes on. */
  protected async soft(scenario: string, work: () => Promise<unknown>) {
    try { await work(); } catch (error) {
      const reason = error instanceof Skip ? error.reason : describe(error);
      if (!this.notes.has(scenario)) this.notes.set(scenario, reason.slice(0, 300));
      this.skip(`scenarios · ${scenario}`, reason);
    }
  }

  // ---------------------------------------------------------------- enquiries

  /**
   * Enquiries in every state, from the region's people: new, contacted (a follow-up due today), contacted with an
   * overdue follow-up, qualified, lost with a reason, an enquiry whose type is "not sure yet", and one for each of the
   * organization's own enquiry types.
   */
  async scenarioEnquiries(enquiryTypes: ReadonlyArray<{ code: string; label: string }>, regionId: (name: string) => string | undefined) {
    const leads = this.get(CrmLeadsService);
    const plans: Array<{ n: number; key: string; type: string | null; outcome: "new" | "today" | "overdue" | "qualified" | "lost" }> = [
      { n: 1, key: "new", type: null, outcome: "new" },
      { n: 2, key: "contacted", type: null, outcome: "today" },
      { n: 3, key: "overdue", type: null, outcome: "overdue" },
      { n: 4, key: "qualified", type: null, outcome: "qualified" },
      { n: 5, key: "lost", type: null, outcome: "lost" },
      { n: 6, key: "not-sure", type: "not_sure", outcome: "new" },
      ...enquiryTypes.filter((type) => type.code !== "not_sure").map((type, index) => ({ n: 7 + index, key: `type-${type.code}`, type: type.code, outcome: "new" as const })),
    ];
    const actor = await this.actor(this.input.actorUserId);
    for (const plan of plans) {
      await this.soft(plan.outcome === "new" && plan.type && plan.type !== "not_sure" ? `sales.enquiry_type.${plan.type}` : `sales.enquiry.${plan.key}`, async () => {
        const person = regionPerson(this.scenarioInput.fixture, plan.n, this.scenarioInput.country);
        const owner = await this.as(plan.n % 2 ? "sales" : "salesAdmin");
        const title = `${person.place.area} ${plan.type === "not_sure" ? "home, ideas" : "home refresh"}`;
        const facts = { title, summary: "Fictional enquiry for the demo scenarios.", area: person.place.area, emirate: regionId(person.place.region), daysAgo: plan.n % 9,
          owner: (plan.n % 2 ? "sales" : "salesAdmin") as "sales" | "salesAdmin",
          pick: { source: plan.n, channel: plan.n, type: plan.type ? new RegExp(`^${plan.type}$`) : /interior|fit.?out|full/i } };
        const party = { displayName: person.displayName, email: person.email, mobile: person.mobile };
        const reference = `SCENARIO-ENQ-${plan.key.toUpperCase()}`;
        const lead = await this.step(`enquiry ${reference}`, () => this.findLead(actor, party), () => this.record(actor, owner, `scenario-${plan.key}`, reference, party, facts));
        const current = (await leads.get(owner, this.w, lead.id)) as unknown as { status: string; version: number };
        if (plan.outcome === "qualified") {
          if (current.status !== "qualified") await this.qualify(lead.id, lead.partyId, owner, { title, summary: facts.summary, amount: Number(regionAmount(this.scenarioInput.fixture, "45000")), daysAgo: 3 });
          return;
        }
        if (plan.outcome === "lost") {
          if (current.status === "new") await this.advance(`${reference} · lost (went with another studio)`, false, async () => this.tryAs(owner, async (who) => leads.logContact(who, this.w, lead.id,
            await this.validated(LogContactDto, { version: current.version, channel: "call", outcome: "not_interested", note: "Chose another studio after comparing proposals.", reason: "Went with another studio (price)" }))));
          return;
        }
        if (plan.outcome === "today" || plan.outcome === "overdue") {
          const due = plan.outcome === "today" ? this.moment(0, 17) : this.moment(-2, 11);
          if (current.status === "new") await this.advance(`${reference} · call logged, no answer`, false, async () => this.tryAs(owner, async (who) => leads.logContact(who, this.w, lead.id,
            await this.validated(LogContactDto, { version: current.version, channel: "call", outcome: "no_answer", note: "Called; left a voicemail.", nextActionAt: due.toISOString() }))));
          await this.followUp(lead.id, lead.partyId, owner, `Call ${person.displayName} back`, due.toISOString());
        }
      });
    }
  }

  // ---------------------------------------------------------------- after the stories

  /** A quotation the client declined in the portal (with why). */
  async declineQuote() {
    const ctx = this.storyCtx("quote-declined");
    if (!ctx?.ids.caseId || !ctx.ids.quoteId) throw new Skip("the quotation to decline wasn't sent");
    const { caseId, quoteId } = ctx.ids as { caseId: string; quoteId: string };
    const quote = ((await this.commercialData(caseId)).quotes as Any[]).find((row) => row.id === quoteId);
    if (quote?.status !== "issued") { if (quote?.status === "declined") this.kept("quotation declined by the client"); return; }
    await this.advance("quotation declined by the client in the portal", false, () => this.portalDecision(ctx, "quote_decision", `quote:${caseId}:${quoteId}:decline`,
      { caseId, quoteId, decision: "decline", note: "We've decided to postpone the work until next year.", selectedOptionLineIds: [], hash: quote.hash }));
  }

  /** A sent quotation revised: the second version is the working draft. */
  async reviseQuote() {
    const ctx = this.storyCtx("quote-revision");
    if (!ctx?.ids.caseId || !ctx.ids.quoteId) throw new Skip("the quotation to revise wasn't sent");
    const { caseId, quoteId } = ctx.ids as { caseId: string; quoteId: string };
    const quotes = (await this.commercialData(caseId)).quotes as Any[];
    const family = quotes.filter((row) => row.kind === "quotation" && (row.id === quoteId || row.familyId === quoteId));
    await this.advance("quotation revised (version 2)", family.length > 1, () => this.commercialCommand(caseId, this.salesAdminSync!, "revise", { quoteId }));
  }

  /**
   * PLM-147: the QS-priced estimate the client finds too high goes to value engineering, led by the job's lead designer
   * (the Account Manager on a design job without one) with the QS. The QS starts it; no budget was recorded on this job.
   */
  async valueEngineering() {
    const ctx = this.storyCtx("quote-approved");
    if (!ctx?.ids.caseId || !ctx.ids.quoteId) throw new Skip("the priced quotation isn't there");
    const { caseId, quoteId } = ctx.ids as { caseId: string; quoteId: string };
    const service = this.get(ValueEngineeringService);
    const qs = await this.as("estimator");
    const view = await this.tryAs(qs, (actor) => service.view(actor, this.w, caseId, quoteId));
    if (view.open) { this.kept("estimate in value engineering"); return; }
    if (view.quote?.problem) throw new Skip(view.quote.problem);
    await this.advance("estimate over the client's budget: value engineering started", false, () => this.tryAs(qs, (actor) => service.start(actor, this.w, caseId,
      { quoteId, note: "The client's budget is about 15% below this price." })));
  }

  protected salesAdminSync: Actor | null = null;

  /** A quotation with a discount over the firm's approval limit, submitted and waiting for someone who approves. */
  async discountQuote() {
    const ctx = this.storyCtx("quote-discount");
    if (!ctx?.ids.caseId || !ctx.ids.quoteId) throw new Skip("the quotation for the discount wasn't made");
    const { caseId, quoteId } = ctx.ids as { caseId: string; quoteId: string };
    const builder = this.get(QuotationBuilderService);
    const owner = await this.as("owner"), salesAdmin = await this.as("salesAdmin");
    const settings = ((await builder.settings(owner, this.w)) as unknown as { settings: { discountApprovalPercent: string | null; version: number } }).settings;
    // The firm's rule (Settings › Quotations): discounts above 10% wait for someone who approves quotations.
    if (settings.discountApprovalPercent === null || settings.discountApprovalPercent === undefined)
      await this.advance("quotation rule: a discount above 10% needs approval", false, () => builder.saveSettings(owner, this.w, { version: settings.version, discountApprovalPercent: "10" }));
    const quote = ((await this.commercialData(caseId)).quotes as Any[]).find((row) => row.id === quoteId);
    if (quote?.status === "draft") {
      await this.advance("15% discount on the quotation", Number(quote.discount ?? 0) > 0, () => builder.setDiscount(salesAdmin, this.w, caseId, quoteId,
        { scope: "quote", target: "", kind: "percent", value: "15", reason: "Second project with us." }));
      await this.issue(ctx, caseId, quoteId, ctx.ids.grantId ?? "", { submitOnly: true, until: "quotation_review" });
    } else if (quote?.status === "internal_review") this.kept("quotation with a discount waiting for approval");
  }

  /** Projects put on hold and flagged at risk (the project manager's update). */
  async holdProject() {
    const projectId = this.storyCtx("project-hold")?.ids.projectId;
    if (!projectId) throw new Skip("the project to put on hold isn't there");
    const projects = this.get(ProjectCoreService), pm = await this.as("projectManager");
    const detail = (await projects.get(pm, this.w, projectId)) as unknown as { project: { version: number; status: string } };
    await this.advance("project on hold (client travelling)", detail.project.status === "on_hold", () => projects.command(pm, this.w, projectId,
      { action: "hold", version: detail.project.version, reason: "The client is travelling; works resume when they are back.", reviewOn: this.day(14) }));
  }

  async riskProject() {
    const projectId = this.storyCtx("project-risk")?.ids.projectId;
    if (!projectId) throw new Skip("the project at risk isn't there");
    const projects = this.get(ProjectCoreService), pm = await this.as("projectManager");
    const detail = (await projects.get(pm, this.w, projectId)) as unknown as { project: { version: number; status: string; health: string } };
    if (detail.project.status !== "active") return;
    await this.advance("project flagged at risk (late order, site reports missing)", detail.project.health !== "on_track", () => projects.command(pm, this.w, projectId,
      { action: "post_update", version: detail.project.version, health: "at_risk", note: "The flooring order is late and two site reports are missing this week.", shareWithClient: false }));
  }

  // ---------------------------------------------------------------- over budget

  /** A project whose costs run over the quotation's cost estimate: extra material bought and received, a bill, a site claim. */
  async overBudget() {
    const ctx = this.storyCtx("project-budget");
    const projectId = ctx?.ids.projectId;
    if (!ctx || !projectId) throw new Skip("the project for the budget isn't there");
    const total = this.storyTotalCost(ctx.s);
    // Materials bought on top of the plan: half the job's estimated cost again, received at the factory.
    const orderId = await this.freeOrder(ctx, projectId, "extra-materials", "received",
      [{ description: "Walnut veneer, replacement sheets (damaged in the factory)", quantity: "1", unit: "lot", unitPrice: total.div(2).toFixed(2) }],
      "Extra material over the budget: replacement veneer after damage in the factory.", -6);
    if (orderId) await this.bill(ctx, orderId, "extra-materials", { invoiceDaysAgo: 4, dueDays: 26 });
    await this.projectPettyCash(ctx, projectId);
  }

  private storyTotalCost(story: ShowcaseStory) {
    return story.lines.reduce((sum, line) => sum.add(DecOf(line.unitCost).mul(line.quantity)), DecOf("0"));
  }

  /** One petty cash claim on the project, approved by the project manager. */
  private async projectPettyCash(ctx: ShowcaseCtx, projectId: string) {
    const { PettyCashService } = await import("../../petty-cash/petty-cash.service");
    const petty = this.get(PettyCashService);
    const claimant = await this.as("site"), decider = await this.other(claimant, ["projectManager", "owner", "manager"]);
    const id = this.id(ctx, "petty:fixings");
    const read = async () => { try { return ((await petty.state(decider, this.w, projectId)) as unknown as { claims: Array<{ id: string; status: string; version: number }> }).claims.find((row) => row.id === id) ?? null; } catch { return null; } };
    let claim = await this.step("petty cash · fixings from the hardware shop", read, async () => {
      await petty.command(claimant, this.w, projectId, { action: "save", commandId: this.id(ctx, "petty:fixings:save"), id, spentOn: this.day(-2), amount: regionAmount(this.scenarioInput.fixture, "85"),
        description: "Screws, wall plugs and silicone from the hardware shop", category: "materials", noReceiptReason: "Receipt handed to the office." });
      return (await read())!;
    });
    if (claim.status === "draft") { await this.advance("petty cash submitted", false, () => petty.command(claimant, this.w, projectId, { action: "submit", commandId: this.id(ctx, `petty:fixings:submit:${claim.version}`), claimId: id, version: claim.version })); claim = (await read())!; }
    if (claim.status === "submitted") await this.advance("petty cash approved", false, () => petty.command(decider, this.w, projectId, { action: "approve", commandId: this.id(ctx, `petty:fixings:approve:${claim.version}`), claimId: id, version: claim.version }));
  }

  // ---------------------------------------------------------------- purchasing

  /** A purchase order with free lines on the project, taken as far as `state` (draft, sent, part received, received). */
  protected async freeOrder(ctx: ShowcaseCtx, projectId: string, key: string, state: "draft" | "pending_approval" | "sent" | "partly_received" | "received",
    lines: Array<{ description: string; quantity: string; unit: string; unitPrice: string }>, notes: string, expected: number): Promise<string | null> {
    const orders = this.get(OrdersService), receiving = this.get(ReceivingService);
    const buyer = await this.as("buyer");
    const usable = await this.suppliers();
    if (!usable.length) throw new Skip("the supplier register has no approved supplier");
    const supplier = usable[(key.length + 1) % usable.length];
    const orderId = this.id(ctx, `purchase-order:${key}`);
    const get = async () => { try { return (await orders.get(buyer, this.w, orderId)) as unknown as { order: Any; lines: Any[]; receipts?: Any[] }; } catch { return null; } };
    let order = await this.step(`purchase order · ${key}`, get, async () => {
      await orders.create(buyer, this.w, { id: orderId, vendorId: supplier.id, expectedDate: this.day(expected), notes,
        lines: lines.map((line) => ({ source: "free", projectId, ...line })) });
      return (await get())!;
    });
    const command = async (actor: Actor, action: string, extra: Record<string, unknown> = {}) => orders.command(actor, this.w, orderId, { action, version: (await get())!.order.version, ...extra });
    const ladder = ["draft", "pending_approval", "approved", "sent", "confirmed", "partly_received", "received", "closed"];
    const wants = (status: string) => ladder.indexOf(state) >= ladder.indexOf(status);
    let status = order.order.status as string;
    if (status === "draft" && wants("pending_approval")) { await this.advance(`${key} · submitted`, false, () => command(buyer, "submit")); status = (await get())!.order.status; }
    if (status === "pending_approval" && wants("approved")) { const approver = await this.other(buyer, ["owner", "manager", "projectManager", "finance"]); await this.advance(`${key} · approved`, false, () => command(approver, "approve")); status = "approved"; }
    if (status === "approved" && wants("sent")) { await this.advance(`${key} · sent (no email)`, false, () => command(buyer, "send", { to: null })); status = "sent"; }
    if (!["partly_received", "received"].includes(state) || !["sent", "confirmed", "partly_received"].includes(status)) return orderId;
    order = (await get())!;
    const receiptId = this.id(ctx, `receipt:${key}`);
    if (!(order.receipts ?? []).some((row: Any) => row.id === receiptId)) {
      await this.advance(`${key} · received at the factory`, false, async () => {
        const form = (await receiving.receiving(buyer, this.w, orderId)) as unknown as { defaultPlace: string; places: Array<{ key: string; kind: string }>; lines: Array<{ id: string; outstanding: string }> };
        const place = form.places.find((row) => row.kind === "factory")?.key ?? form.places.find((row) => row.kind === "store")?.key ?? form.defaultPlace;
        const open = form.lines.filter((line) => Number(line.outstanding) > 0);
        const take = state === "partly_received" ? open.slice(0, 1).map((line) => ({ orderLineId: line.id, received: DecOf(line.outstanding).div(2).toFixed(2) }))
          : open.map((line) => ({ orderLineId: line.id, received: line.outstanding }));
        await receiving.receive(buyer, this.w, { id: receiptId, orderId, place, receivedOn: this.day(Math.min(expected, 0)), deliveryNote: `DN-${key.toUpperCase()}`, lines: take });
      });
    }
    const inspector = await this.other(buyer, ["owner", "manager", "projectManager", "factory"]);
    const full = (await receiving.receipt(inspector, this.w, receiptId)) as unknown as { lines: Array<{ id: string; pending: string }> };
    await this.advance(`${key} · inspected and accepted`, !full.lines.some((line) => Number(line.pending) > 0), () =>
      receiving.inspect(inspector, this.w, receiptId, { lines: full.lines.filter((line) => Number(line.pending) > 0).map((line) => ({ id: line.id, accepted: line.pending, rejected: "0" })) }));
    return orderId;
  }

  /** A supplier bill against an order's received lines, matched and approved; due or overdue by its dates. */
  protected async bill(ctx: ShowcaseCtx, orderId: string, key: string, dates: { invoiceDaysAgo: number; dueDays: number }, options: { held?: boolean } = {}) {
    const payables = this.get(PayablesService), orders = this.get(OrdersService);
    const finance = await this.as("finance"), buyer = await this.as("buyer");
    const order = (await orders.get(buyer, this.w, orderId)) as unknown as { order: { vendorId: string; legalEntityId: string; currency: string; status: string; number: string };
      lines: Array<{ id: string; quantity: string; unitPrice: string; taxRate?: string | null; accepted?: string; received?: string }> };
    if (!["received", "closed", "partly_received"].includes(order.order.status)) throw new Skip(`order ${order.order.number} isn't received`);
    const billId = this.id(ctx, `bill:${key}`);
    const overview = async () => ((await this.tryAs(finance, (actor) => payables.overview(actor, this.w))) as unknown as { bills: Array<{ id: string; version: number; status: string }> }).bills;
    let bill = (await overview()).find((row) => row.id === billId);
    if (!bill) {
      const number = `INV-${order.order.number.replace(/[^A-Z0-9]/gi, "").slice(-6)}`;
      await this.advance(`supplier bill ${number}`, false, () => this.tryAs(finance, (actor) => payables.command(actor, this.w, { action: "save", commandId: this.id(ctx, `bill:${key}:save`), id: billId,
        vendorId: order.order.vendorId, legalEntityId: order.order.legalEntityId, currency: order.order.currency, number, invoiceDate: this.day(-dates.invoiceDaysAgo),
        dueDate: this.day(-dates.invoiceDaysAgo + dates.dueDays),
        lines: order.lines.filter((line) => Number(line.accepted ?? line.received ?? 0) > 0).map((line) => ({ orderLineId: line.id, quantity: String(line.accepted ?? line.received),
          unitPrice: options.held ? DecOf(line.unitPrice).mul("1.25").toFixed(2) : line.unitPrice, ...(line.taxRate !== undefined && line.taxRate !== null ? { taxRate: line.taxRate } : {}) })) })));
      bill = (await overview()).find((row) => row.id === billId);
    } else this.kept(`supplier bill on ${order.order.number}`);
    if (bill?.status === "draft") {
      await this.advance("supplier bill matched and submitted", false, () => this.tryAs(finance, (actor) => payables.command(actor, this.w, { action: "submit", commandId: this.id(ctx, `bill:${key}:submit:${bill!.version}`), id: billId, version: bill!.version })));
      bill = (await overview()).find((row) => row.id === billId);
    }
    if (bill?.status === "held" && !options.held) {
      const approver = await this.other(finance, ["owner", "manager"]);
      await this.advance("supplier bill approved", false, () => payables.command(approver, this.w, { action: "approve", commandId: this.id(ctx, `bill:${key}:approve:${bill!.version}`), id: billId, version: bill!.version, note: "Checked against the delivery." }));
    }
  }

  /** Orders in every state on the running projects (draft, sent, part received, received, late) and bills due and overdue. */
  async scenarioPurchasing(route: readonly string[]) {
    const procurement = route.includes("procurement") ? this.storyCtx("stage-procurement") : null;
    const risk = this.storyCtx("project-risk");
    const host = procurement?.ids.projectId ? procurement : risk;
    if (!host?.ids.projectId) throw new Skip("no running project to buy for");
    const projectId = host.ids.projectId;
    const money = (value: string) => regionAmount(this.scenarioInput.fixture, value);
    await this.soft("po.draft", () => this.freeOrder(host, projectId, "spare-veneer", "draft", [{ description: "Walnut veneer, spare sheets", quantity: "2", unit: "sheet", unitPrice: money("180") }],
      "Spare sheets for the TV wall (draft).", 12));
    await this.soft("po.sent", () => this.freeOrder(host, projectId, "brass-handles", "sent", [{ description: "Brushed brass handle 160 mm", quantity: "18", unit: "nos", unitPrice: money("42") }],
      "Handles for the wardrobe.", 9));
    await this.soft("po.part_received", () => this.freeOrder(host, projectId, "paint-and-film", "partly_received",
      [{ description: "Premium emulsion, warm white (5 L)", quantity: "6", unit: "nos", unitPrice: money("95") }, { description: "Masking and protection film", quantity: "4", unit: "roll", unitPrice: money("35") }],
      "Paint and protection for the site.", -2));
    await this.soft("po.late", () => this.freeOrder(host, projectId, "downlights-late", "sent", [{ description: "LED downlight 9W warm, extra", quantity: "6", unit: "nos", unitPrice: money("45") }],
      "Extra downlights; the supplier is late.", -4));
    await this.soft("po.received", () => this.freeOrder(host, projectId, "skirting", "received", [{ description: "MDF skirting 90 mm, primed", quantity: "40", unit: "m", unitPrice: money("12") }],
      "Skirting for the living room.", -8));
    const skirting = this.id(host, "purchase-order:skirting");
    await this.soft("bill.overdue", () => this.bill(host, skirting, "skirting", { invoiceDaysAgo: 30, dueDays: 20 }));
    const budget = this.storyCtx("project-budget");
    if (budget?.ids.projectId) {
      const sealant = await this.freeOrder(budget, budget.ids.projectId, "sealant", "received", [{ description: "Silicone sealant, clear", quantity: "12", unit: "nos", unitPrice: money("18") }],
        "Sealant for the kitchen.", -5).catch((error) => { this.notes.set("bill.due", describe(error)); return null; });
      if (sealant) await this.soft("bill.due", () => this.bill(budget, sealant, "sealant", { invoiceDaysAgo: 3, dueDays: 27 }));
    }
  }

  // ---------------------------------------------------------------- change requests

  /** Change requests in every state on a running project: draft, priced, with the QS, waiting for approval, with the client, applied, declined. */
  async changes(projectKey: StoryKey) {
    const ctx = this.storyCtx(projectKey);
    const projectId = ctx?.ids.projectId, caseId = ctx?.ids.caseId;
    if (!ctx || !projectId || !caseId) throw new Skip("no running project for the change requests");
    const changes = this.get(ProjectChangesService);
    const pm = await this.as("projectManager");
    const projects = this.get(ProjectCoreService);
    const money = (value: string) => regionAmount(this.scenarioInput.fixture, value);
    type Record_ = { change: { id: string; status: string; version: number; quoteId: string | null }; approval?: { version: number } | null };
    const read = async (id: string) => { try { return (await changes.get(pm, this.w, projectId, id)) as unknown as Record_; } catch { return null; } };
    const stage = ((await projects.get(pm, this.w, projectId)) as unknown as { stages: Array<{ id: string; status: string }> }).stages.find((row) => row.status !== "done") ?? null;
    const plans: Array<{ key: string; scenario: string; title: string; to: "draft" | "pricing" | "with_qs" | "pending_approval" | "with_client" | "applied" | "declined"; amount: string; days: number }> = [
      { key: "draft", scenario: "change.draft", title: "Add a reading light by the bed", to: "draft", amount: "650", days: 0 },
      { key: "pricing", scenario: "change.pricing", title: "Extra shelves in the study niche", to: "pricing", amount: "1800", days: 0 },
      { key: "with-qs", scenario: "change.with_qs", title: "Wardrobe internal drawers", to: "with_qs", amount: "3200", days: 2 },
      { key: "approval", scenario: "change.waiting_approval", title: "Upgrade the kitchen downlights", to: "pending_approval", amount: "900", days: 0 },
      { key: "client", scenario: "change.with_client", title: "Feature wallpaper in the master bedroom", to: "with_client", amount: "2400", days: 1 },
      { key: "applied", scenario: "change.applied", title: "Add a floating vanity in the guest bathroom", to: "applied", amount: "4800", days: 3 },
      { key: "declined", scenario: "change.declined", title: "Marble top for the TV wall", to: "declined", amount: "6500", days: 2 },
    ];
    for (const plan of plans) {
      await this.soft(plan.scenario, async () => {
        const id = this.id(ctx, `change:${plan.key}`);
        let record = await read(id);
        if (!record) {
          await this.advance(`change request · ${plan.title}`, false, () => changes.raise(pm, this.w, projectId, { id, title: plan.title, reason: "client_request",
            description: "Asked by the client on the site visit.", stageImpacts: stage && plan.days ? [{ stageId: stage.id, days: plan.days }] : [],
            lines: [{ id: this.id(ctx, `change:${plan.key}:line`), source: "custom", title: plan.title, quantity: "1", unit: "nos", unitPrice: money(plan.amount) }] } as never));
          record = (await read(id))!;
        }
        if (plan.to === "draft") return;
        if (record.change.status === "draft") { await this.advance(`${plan.key} · priced`, false, () => changes.price(pm, this.w, projectId, id, { version: record!.change.version } as never)); record = (await read(id))!; }
        if (plan.to === "pricing") return;
        if (record.change.status === "pricing") {
          const { QsReviewService } = await import("../../proposals/qs-review.service");
          const qs = this.get(QsReviewService);
          const state = (await qs.state(pm, this.w, caseId, record.change.quoteId!)) as unknown as { required: boolean; stage: string };
          if (plan.to === "with_qs") {
            if (!state.required && state.stage !== "with_qs") {
              // The firm's QS rules name joinery work: the variation's line goes in the Joinery work package (flagged for QS review in Settings › Quotations).
              const packageId = await this.qsWorkPackage();
              const builder = this.get(QuotationBuilderService);
              const lines = ((await builder.builder(pm, this.w, caseId, record.change.quoteId!)) as unknown as { lines: Array<{ id: string; version: number; workPackageId: string | null }> }).lines;
              const ops = lines.filter((line) => line.workPackageId !== packageId).map((line) => ({ op: "upsert", line: { id: line.id, version: line.version, workPackageId: packageId } }));
              if (ops.length) await this.advance(`${plan.key} · drawers in the Joinery work package`, false, () => builder.apply(pm, this.w, caseId, record!.change.quoteId!, { ops }));
              const again = (await qs.state(pm, this.w, caseId, record.change.quoteId!)) as unknown as { required: boolean };
              if (!again.required) throw new Skip("the firm's QS rules don't send variations to the QS");
            }
            if (state.stage !== "with_qs") {
              const surveyor = await this.other(pm, ["estimator", "owner"]);
              await this.advance(`${plan.key} · sent to the QS`, false, () => qs.send(pm, this.w, caseId, record!.change.quoteId!, { assigneeUserId: surveyor.userId, note: "Please price the drawers." }));
            }
            return;
          }
          if (state.required && state.stage !== "confirmed") {
            const surveyor = await this.other(pm, ["estimator", "owner"]);
            if (state.stage !== "with_qs") await qs.send(pm, this.w, caseId, record.change.quoteId!, { assigneeUserId: surveyor.userId });
            await qs.decide(surveyor, this.w, caseId, record.change.quoteId!, { decision: "confirm", commandId: this.id(ctx, `change:${plan.key}:qs`) });
          }
          await this.advance(`${plan.key} · submitted for approval`, false, () => changes.submit(pm, this.w, projectId, id, { version: record!.change.version } as never));
          record = (await read(id))!;
        }
        if (plan.to === "pending_approval") return;
        if (record.change.status === "pending_approval") {
          const approver = await this.other(pm, ["owner", "manager"]);
          await this.advance(`${plan.key} · approved internally`, false, () => changes.decide(approver, this.w, projectId, id, { decision: "approve", approvalVersion: record!.approval?.version,
            commandId: this.id(ctx, `change:${plan.key}:approve`) } as never));
          record = (await read(id))!;
        }
        if (record.change.status === "to_send") {
          await this.advance(`${plan.key} · sent to the client`, false, () => changes.send(pm, this.w, projectId, id, { version: record!.change.version, commandId: this.id(ctx, `change:${plan.key}:send`) } as never));
          record = (await read(id))!;
        }
        if (plan.to === "with_client" || record.change.status !== "with_client") return;
        const decision = plan.to === "applied" ? "accept" : "decline";
        await this.advance(`${plan.key} · ${decision === "accept" ? "accepted (applied)" : "declined"} by the client in the portal`, false, async () => {
          if (decision === "accept") await this.portalDecision(ctx, "change_decision", `change:${caseId}:${id}:accept`, { caseId, changeId: id, decision, version: record!.change.version });
          else {
            const { ClientPortalService } = await import("../../client-portal/client-portal.service");
            const { token } = await this.portalView(ctx);
            const slug = (this as unknown as { slug: string }).slug;
            await this.get(ClientPortalService).command(slug, token, { commandId: this.id(ctx, `change:${plan.key}:decline`), action: "change_decision", caseId, changeId: id, decision,
              note: "Too costly for now; we'll keep the plain top.", version: record!.change.version });
          }
        });
      });
    }
  }

  /**
   * The Joinery work package, flagged for QS review (Settings › Quotations): found by name, else added. A firm whose
   * QS rules name joinery work sends its joinery quotations and variations to the QS.
   */
  protected async qsWorkPackage(): Promise<string> {
    const builder = this.get(QuotationBuilderService);
    const owner = await this.as("owner");
    const packages = () => this.db.tenantTransaction(this.w, owner.userId, (client) => client.query<{ id: string; qsReview: boolean }>(
      `SELECT id, qs_review AS "qsReview" FROM workspace_work_packages WHERE workspace_id = $1 AND lower(btrim(name)) = 'joinery' AND archived_at IS NULL`, [this.w]));
    let found = (await packages()).rows[0];
    if (!found) {
      await this.advance("work package · Joinery", false, () => builder.addWorkPackage(owner, this.w, { id: this.id("scenario:quotes:", "work-package:joinery"), name: "Joinery" }));
      found = (await packages()).rows[0];
    }
    if (!found) throw new Skip("the Joinery work package couldn't be added");
    if (!found.qsReview) await this.advance("work package · Joinery flagged for QS review", false, () => builder.updateWorkPackage(owner, this.w, found!.id, { qsReview: true }));
    return found.id;
  }

  // ---------------------------------------------------------------- client invoices and receipts

  /** Client invoices for the started projects' milestones: paid, overdue and to be paid; a receipt waiting for Finance. */
  async invoices() {
    const receivables = this.get(ReceivablesService);
    const finance = await this.as("finance");
    const overview = async () => (await this.tryAs(finance, (actor) => receivables.overview(actor, this.w))) as unknown as {
      invoices: Array<{ id: string }>; toInvoice: Array<{ caseId: string; paymentId: string; title: string; paid?: boolean | string }> };
    const plans: Array<{ story: StoryKey; scenario: string; pick: (title: string) => boolean; issueDaysAgo: number; dueDays: number }> = [
      { story: "project-completed", scenario: "invoice.paid", pick: (title) => /advance/i.test(title), issueDaysAgo: 60, dueDays: 7 },
      { story: "project-risk", scenario: "invoice.overdue", pick: (title) => /handover/i.test(title), issueDaysAgo: 25, dueDays: 10 },
      { story: "project-budget", scenario: "invoice.issued", pick: (title) => /handover/i.test(title), issueDaysAgo: 2, dueDays: 14 },
    ];
    for (const plan of plans) {
      await this.soft(plan.scenario, async () => {
        const ctx = this.storyCtx(plan.story);
        if (!ctx?.ids.caseId) throw new Skip(`the project for ${plan.scenario} isn't there`);
        const invoiceId = this.id(ctx, `invoice:${plan.scenario}`);
        const current = await overview();
        if (current.invoices.some((row) => row.id === invoiceId)) { this.kept(`client invoice for ${plan.scenario}`); return; }
        const milestone = current.toInvoice.find((row) => row.caseId === ctx.ids.caseId && plan.pick(row.title));
        if (!milestone) throw new Skip(`no milestone to invoice for ${plan.scenario}`);
        await this.advance(`client invoice · ${milestone.title}`, false, () => this.tryAs(finance, (actor) => receivables.command(actor, this.w, { action: "issue",
          commandId: this.id(ctx, `invoice:${plan.scenario}:issue`), id: invoiceId, caseId: milestone.caseId, paymentId: milestone.paymentId,
          issueDate: this.day(-plan.issueDaysAgo), dueDate: this.day(-plan.issueDaysAgo + plan.dueDays) })));
      });
    }
    // The handover payment reported by Sales and waiting for Finance's verification.
    await this.soft("receipt.pending", async () => {
      const ctx = this.storyCtx("project-budget");
      if (!ctx?.ids.caseId) throw new Skip("the project for the receipt isn't there");
      const caseId = ctx.ids.caseId;
      const data = await this.commercialData(caseId);
      const payment = ((data.payments ?? []) as Any[]).find((row) => /handover/i.test(row.title) && row.status === "pending");
      const reported = ((data.receipts ?? []) as Any[]).some((row) => /handover/i.test(String(((data.payments ?? []) as Any[]).find((p) => p.id === row.paymentId)?.title ?? "")) && row.status === "reported");
      if (reported) { this.kept("handover payment reported, waiting for Finance"); return; }
      if (!payment) throw new Skip("no unpaid handover milestone to report");
      const salesAdmin = await this.as("salesAdmin");
      await this.advance("handover payment reported, waiting for Finance", false, () => this.commercialCommand(caseId, salesAdmin, "report_payment_receipt",
        { paymentId: payment.id, reference: `TRF-${ctx.s.reference.replace(/[^A-Z0-9]/gi, "").slice(-8)}`, evidence: "Bank transfer confirmation on file.", evidenceKind: "operational" }));
    });
  }

  // ---------------------------------------------------------------- Wodana Ledger

  /**
   * The Ledger on for the organization's company, through its settings command: the country's chart (the region's own
   * template when there is one, else the international one), from the first day of the month four months ago so the
   * seeded months show in the statements; tax codes for the company's own sales tax rates on the international chart;
   * the statements taken from the Ledger; then the posting sweep posts every document since the start.
   */
  async ledger() {
    const owner = await this.actor(this.input.actorUserId);
    const settings = this.get(BooksSettingsService);
    const overview = (await settings.overview(owner, this.w)) as unknown as { companies: Array<{ id: string; countryCode: string; settings: { enabled: boolean; version: number } | null;
      templates: Array<{ code: string; recommended?: boolean }> }> };
    const company = overview.companies[0];
    if (!company) throw new Skip("the organization has no company");
    const start = monthStart(-4, new Date(`${this.day(0)}T00:00:00Z`));
    if (!company.settings?.enabled) {
      const template = company.templates.find((row) => row.recommended) ?? company.templates.find((row) => row.code === this.scenarioInput.country) ?? company.templates[0];
      if (!template) throw new Skip("no Ledger chart is offered for the company's country");
      const regionEntries = (await this.db.tenantTransaction(this.w, owner.userId, (client) => client.query<{ fiscal: number | null }>(
        `SELECT (profile.configuration->>'fiscalYearStartMonth')::int AS fiscal FROM workspace_setup_versions setup
           JOIN tenant_setup_profiles profile ON profile.kind = 'region' AND profile.code = setup.region_code AND profile.version = setup.region_version
          WHERE setup.workspace_id = $1`, [this.w]))).rows[0];
      await this.advance(`Wodana Ledger on (${template.code} chart, from ${start})`, false, () => settings.command(owner, this.w, { action: "turn_on", commandId: this.id("ledger:", "turn-on"),
        legalEntityId: company.id, templateCode: template.code, startDate: start, ...(regionEntries?.fiscal ? { fiscalYearStartMonth: regionEntries.fiscal } : {}),
        ...(template.code === "AE" ? { vatRegion: "DXB" } : {}) }));
      // On the international chart the company's own sales tax rates need their tax codes, or taxed documents can't post.
      const rates = (await this.db.tenantTransaction(this.w, owner.userId, (client) => client.query<{ rate: string; label: string }>(
        `SELECT DISTINCT rate.rate::text AS rate, rate.label FROM tax_rates rate JOIN tax_profiles profile ON profile.workspace_id = rate.workspace_id AND profile.id = rate.tax_profile_id
          WHERE rate.workspace_id = $1 AND profile.legal_entity_id = $2 AND rate.rate > 0`, [this.w, company.id]).catch(() => ({ rows: [] as Array<{ rate: string; label: string }> })))).rows;
      if (template.code !== "AE") for (const rate of rates) for (const direction of ["sales", "purchases"] as const) {
        const code = `${direction === "sales" ? "S" : "P"}${String(Number(rate.rate)).replace(/\D/g, "")}`;
        await this.soft("ledger.posted", () => settings.command(owner, this.w, { action: "add_tax_code", commandId: this.id("ledger:", `tax:${code}`), legalEntityId: company.id, code,
          name: `${rate.label} ${Number(rate.rate)}% (${direction})`, rate: String(Number(rate.rate)), treatment: "standard", direction, ...(direction === "purchases" ? { recoverable: true } : {}),
          effectiveFrom: start }));
      }
    } else this.kept("Wodana Ledger on");
    const statements = this.get(BooksStatementsService);
    const source = (await statements.source(owner, this.w, { entity: company.id } as never)) as unknown as { source?: { source: string; chosen: boolean; version?: number }; version?: number };
    if (!(source.source?.source === "ledger" && source.source.chosen))
      await this.soft("ledger.statements_source", () => this.advance("statements from the Ledger", false, () => statements.setSource(owner, this.w,
        { legalEntityId: company.id, source: "ledger", expectedVersion: source.source?.version ?? source.version ?? 0, commandId: this.id("ledger:", "statements-source") } as never)));
    // Posts everything since the start date (500 documents a pass).
    const posting = this.get(BooksPostingService);
    for (let pass = 0; pass < 20; pass += 1) {
      const result = await posting.runSweepNow(this.w) as unknown as { busy?: boolean; posted?: number };
      if (!result?.busy && !result?.posted) break;
      if (result.posted) this.made(`${result.posted} documents posted to the Ledger`);
    }
  }


  async prepareScenarios() {
    await this.prepare();
    this.salesAdminSync = await this.as("salesAdmin");
  }

  /** Runs the stories (the engine's own run, over the stories given). */
  async tellStories() {
    if (!this.scenarioInput.stories.length) return;
    // A later stage can open an earlier one's step (the drawings approved on the way let the factory release its work
    // orders): the stories are told again while a pass still makes something, so one run finishes them.
    for (let pass = 0; pass < 3; pass += 1) {
      const before = this.result.created.length;
      const skipped = this.result.skipped.length;
      await this.run();
      if (this.result.created.length === before) break;
      // Only the last pass's refusals stand.
      if (pass < 2) this.result.skipped.splice(skipped);
    }
  }
}

/** The first day of the month `offset` months from this one (YYYY-MM-DD). */
export function monthStart(offset: number, now = new Date()) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return date.toISOString().slice(0, 10);
}

/** Exact decimals for amounts (never floats). */
const DecOf = (value: string | number) => Dec.of(String(value));
