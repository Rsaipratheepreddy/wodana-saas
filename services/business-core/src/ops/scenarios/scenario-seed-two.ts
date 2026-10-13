import { ApprovalsService } from "../../approvals/approvals.service";
import { CrmConversationsService } from "../../crm/conversations/crm-conversations.service";
import { ProviderInboundMessageDto } from "../../crm/conversations/dto/conversations.dto";
import { CrmOpportunitiesService } from "../../crm/opportunities/crm-opportunities.service";
import { TransitionOpportunityDto } from "../../crm/opportunities/dto/opportunities.dto";
import { DatabaseService } from "../../database/database.service";
import { FactoryService } from "../../factory/factory.service";
import { FinanceRequestsService } from "../../finance-requests/finance-requests.service";
import { InventoryService } from "../../inventory/inventory.service";
import { TransitionEngagementDto } from "../../pre-projects/pre-projects.dto";
import { PreProjectsService } from "../../pre-projects/pre-projects.service";
import { ProjectWorkService } from "../../project-core/project-work.service";
import { PaymentRunsService } from "../../purchasing/payment-runs.service";
import { PayablesService } from "../../purchasing/payables.service";
import { SupplierControlsService } from "../../purchasing/supplier-controls.service";
import { QuotationBuilderService } from "../../quotation/quotation-builder.service";
import { describe, Skip, tile, type Any, type ShowcaseCtx } from "../../seed/showcase";
import { regionAmount, regionPerson } from "./scenario-regions";
import { ScenarioSeed } from "./scenario-seed";
import type { StoryKey } from "./scenario-stories";

/**
 * The second pass of the demo scenarios: opportunities at each stage of the sales pipeline, a client message waiting
 * for a reply, the design fee (sent, accepted, paid), planning at scope and ready, low stock, a work order short of
 * material, a critical snag, a refund and a finance request, a supplier payment and a payment run, approvals of every
 * kind the feed shows, and My day items for each test member. Same rules as the first pass: the app's own services, as
 * the test members, idempotent, and each refusal reported with its reason.
 */
export class ScenarioSeedTwo extends ScenarioSeed {
  // ---------------------------------------------------------------- the sales pipeline

  /**
   * An opportunity at each stage of the organization's pipeline. The salesperson walks it along the board one column at
   * a time, doing what its enquiry type's flow asks before each move (walkTo); a lost one is closed with its reason.
   */
  async pipeline(stages: ReadonlyArray<{ id: string; code: string; label: string }>) {
    const opportunities = this.get(CrmOpportunitiesService);
    const actor = await this.actor(this.input.actorUserId);
    const working = stages.filter((stage) => stage.code !== "won" && stage.code !== "lost");
    for (const [index, stage] of stages.entries()) {
      await this.softly(`sales.opportunity.${stage.code}`, async () => {
        const person = regionPerson(this.scenarioInput.fixture, 70 + index, this.scenarioInput.country);
        const owner = await this.as("sales");
        const title = `${person.place.area} home · ${stage.label}`;
        const party = { displayName: person.displayName, email: person.email, mobile: person.mobile };
        const reference = `SCENARIO-OPP-${stage.code.toUpperCase()}`;
        const facts = { title, summary: "Fictional opportunity for the demo scenarios.", area: person.place.area, daysAgo: 10 + index, owner: "sales" as const,
          pick: { source: 70 + index, channel: index, type: /interior|fit.?out|full/i } };
        const lead = await this.step(`enquiry ${reference}`, () => this.findLead(actor, party), () => this.record(actor, owner, `scenario-opp-${stage.code}`, reference, party, facts));
        await this.ensureEnquiryType(actor, lead, party, facts);
        const opportunity = await this.qualify(lead.id, lead.partyId, owner, { title, summary: facts.summary, amount: Number(regionAmount(this.scenarioInput.fixture, "80000")), daysAgo: 5 });
        const current = (await opportunities.get(owner, this.w, opportunity.id)) as unknown as { version: number; stageId: string; status: string };
        if (current.stageId === stage.id) return;
        if (stage.code === "won") throw new Skip("an opportunity is won by its client's acceptance and payment (the projects show those)");
        if (stage.code === "lost") {
          await this.advance(`opportunity moved to ${stage.label}`, false, async () => this.tryAs(owner, async (who) => opportunities.transition(who, this.w, opportunity.id,
            await this.validated(TransitionOpportunityDto, { version: current.version, stageId: stage.id, status: "lost", reason: "Budget moved to next year." }))));
          return;
        }
        const job = { ns: `scenario:opp-${stage.code}:`, opportunityId: opportunity.id, leadId: lead.id, owner, email: person.email, place: `${person.place.area}, ${person.place.city}` };
        await this.walkTo(job, working, stage.id);
      });
    }
  }

  /** A client's WhatsApp message waiting in the inbox (as the provider delivers it; nothing is sent back). */
  async unansweredMessage() {
    const person = regionPerson(this.scenarioInput.fixture, 2, this.scenarioInput.country);
    const providerMessageId = `scenario:whatsapp:${this.w}:waiting:${person.mobile}`;
    const known = (await this.db.tenantTransaction(this.w, this.input.actorUserId, (client) => client.query(
      `SELECT 1 FROM crm_messages WHERE workspace_id = $1 AND provider_message_id = $2`, [this.w, providerMessageId]))).rowCount;
    await this.advance(`client message waiting · ${person.displayName}`, Boolean(known), async () => this.get(CrmConversationsService).ingestProviderMessage(
      await this.validated(ProviderInboundMessageDto, { workspaceId: this.w, channel: "whatsapp", providerThreadId: `scenario:whatsapp:${person.mobile}`, providerMessageId,
        contact: person.mobile, displayName: person.displayName, bodyText: "Hi, can someone call me about the kitchen quotation? Tomorrow morning works.", metadata: { seed: "scenarios" } })));
  }

  // ---------------------------------------------------------------- the design fee

  /**
   * The design fee, the first paid round: sent to the client (fee-sent), accepted in the portal (fee-accepted), and paid
   * (fee-paid: the agreement executed, the payment reported with its proof and verified by Finance).
   */
  async designFee() {
    const builder = this.get(QuotationBuilderService);
    const salesAdmin = await this.as("salesAdmin");
    const approver = await this.other(salesAdmin, ["owner", "manager"]);
    const finance = await this.as("finance");
    for (const [key, to] of [["fee-sent", "sent"], ["fee-accepted", "accepted"], ["fee-paid", "paid"]] as const) {
      await this.softly(`design.fee.${to}`, async () => {
        const ctx = this.ctxOf(key);
        const caseId = ctx?.ids.caseId;
        if (!ctx || !caseId) throw new Skip("its planning record wasn't made");
        let data = await this.commercialData(caseId);
        if (!data.servicePath) await this.advance("service route with the design round", false, () => this.commercialCommand(caseId, salesAdmin, "set_service_path",
          { scope: { design: true, mainQuotation: true, materialSelection: true, procurement: true, manufacturing: true, siteWorks: true, installation: true } }));
        const fee = () => ((data.quotes ?? []) as Any[]).find((row) => row.round === "design");
        data = await this.commercialData(caseId);
        if (!fee()) { await this.advance("design fee proposal", false, () => this.commercialCommand(caseId, salesAdmin, "create")); data = await this.commercialData(caseId); }
        if (!fee()) throw new Skip("the design fee proposal wasn't made");
        let quote: Any = fee()!;
        const amount = regionAmount(this.scenarioInput.fixture, "6500");
        if (quote.status === "draft") {
          const lines = ((await builder.builder(salesAdmin, this.w, caseId, quote.id)) as unknown as { lines: Array<{ id: string; rate: string; version: number }> }).lines;
          if (!lines.some((line) => Number(line.rate) > 0))
            await this.advance("design fee line", false, () => builder.apply(salesAdmin, this.w, caseId, quote.id, { ops: [{ op: "upsert", line: { id: this.id(ctx, "design-fee:line"), kind: "service",
              title: "Interior design fee: concept, layouts and material selection", description: "", quantity: "1", unit: "lot", rate: amount,
              unitCost: (Number(amount) * 0.55).toFixed(2), areaId: null } }] }));
          await this.advance("design fee payment: 100% on signing", false, () => builder.setPaymentTerms(salesAdmin, this.w, caseId, quote.id, { terms: [{ id: this.id(ctx, "design-fee:term"),
            title: "Design fee", percent: 100, trigger: "On signing the design agreement", requiredForRelease: true, requiredForProduction: false }] }));
          await this.advance("design fee submitted", false, () => this.commercialCommand(caseId, salesAdmin, "submit", { quoteId: quote.id }));
          data = await this.commercialData(caseId); quote = fee()!;
        }
        if (quote.status === "internal_review") { await this.advance("design fee approved", false, () => this.commercialCommand(caseId, approver, "approve", { quoteId: quote.id })); data = await this.commercialData(caseId); quote = fee()!; }
        if (quote.status === "internal_approved") {
          await this.advance("design fee sent to the client", false, () => this.commercialCommand(caseId, salesAdmin, "issue", { quoteId: quote.id, approverId: ctx.ids.grantId }));
          data = await this.commercialData(caseId); quote = fee()!;
        }
        if (to === "sent") return;
        if (quote.status === "issued") {
          await this.advance("design fee accepted by the client in the portal", false, () => this.portalDecision(ctx, "quote_decision", `quote:${caseId}:${quote.id}:accept`,
            { caseId, quoteId: quote.id, decision: "accept", selectedOptionLineIds: [], note: "", hash: quote.hash }));
          data = await this.commercialData(caseId); quote = fee()!;
        }
        if (to === "accepted") return;
        const reference = `AGR-${ctx.s.reference.replace(/[^A-Z0-9]/gi, "").slice(-10)}-DF`;
        if (!data.agreement) await this.advance("design agreement recorded", false, () => this.commercialCommand(caseId, salesAdmin, "agreement", { quoteId: quote.id, reference,
          terms: "The accepted design fee proposal; the firm's standard terms apply.", evidence: `Signed design agreement ${reference} on file.`, evidenceKind: "operational" }));
        data = await this.commercialData(caseId);
        if (data.agreement && !((data.agreement.files ?? []) as Any[]).length) await this.advance("signed design agreement attached", false, async () => {
          const fileId = this.id(ctx, "asset:design-agreement");
          const pdf = Buffer.from(`%PDF-1.4\n% Signed design agreement ${reference}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
          await this.get((await import("../../pre-projects/brief.service")).BriefService).upload(salesAdmin, this.w, caseId, fileId, { buffer: pdf, originalname: `${reference}.pdf`, mimetype: "application/pdf", size: pdf.length });
          await this.commercialCommand(caseId, salesAdmin, "attach_agreement_file", { quoteId: quote.id, assetId: fileId });
        });
        data = await this.commercialData(caseId);
        if (data.agreement?.status !== "executed") await this.advance("design agreement executed", false, () => this.commercialCommand(caseId, approver, "execute_agreement"));
        data = await this.commercialData(caseId);
        const payment = ((data.payments ?? []) as Any[]).find((row) => row.sourceQuoteId === quote.id && row.requiredForRelease);
        if (!payment) throw new Skip("the design agreement has no payment due on signing");
        if (payment.status === "pending") await this.advance("design fee payment reported", false, () => this.commercialCommand(caseId, salesAdmin, "report_payment_receipt",
          { paymentId: payment.id, reference: `TRF-${reference}`, evidence: "Bank transfer confirmation on file.", evidenceKind: "operational" }));
        data = await this.commercialData(caseId);
        if (((data.payments ?? []) as Any[]).find((row) => row.id === payment.id)?.status !== "verified")
          await this.advance("design fee payment verified by Finance", false, () => this.tryAs(finance, (actor) => this.commercialCommand(caseId, actor, "verify_payment", { paymentId: payment.id })));
      });
    }
  }

  // ---------------------------------------------------------------- planning

  /** Planning records at scope confirmation and ready for the quotation (their phase moved by the planner, with why). */
  async planningPhases() {
    const cases = this.get(PreProjectsService);
    for (const [key, phase, scenario] of [["planning-scope", "define", "planning.scope"], ["planning-ready", "price", "planning.ready"]] as const) {
      await this.softly(scenario, async () => {
        const caseId = this.ctxOf(key as StoryKey)?.ids.caseId;
        if (!caseId) throw new Skip("its planning record wasn't made");
        const designer = await this.as("manager");
        const current = (await cases.get(designer, this.w, caseId)) as unknown as { case?: { phase: string; version: number }; phase?: string; version?: number };
        const row = current.case ?? (current as { phase: string; version: number });
        if (row.phase === phase) return;
        await this.advance(`planning moved to ${phase}`, false, async () => cases.transition(designer, this.w, caseId, await this.validated(TransitionEngagementDto,
          { requestId: this.id(caseId, `phase:${phase}`), version: row.version, action: "set_phase", phase, reason: "Requirements agreed with the client on the visit." })));
      });
    }
  }

  // ---------------------------------------------------------------- stock and factory

  /** A stock item below its reorder level (free stock added, the level set above it). */
  async lowStock() {
    const inventory = this.get(InventoryService);
    const actor = await this.actor(this.input.actorUserId);
    const state = async () => (await inventory.stock(actor, this.w)) as unknown as { rows: Array<{ itemId: string; itemName: string; locationId: string; projectId: string | null }>;
      locations: Array<{ id: string; kind: string }> };
    let current = await state();
    let warehouse = current.locations.find((row) => row.kind === "warehouse");
    if (!warehouse) {
      const id = this.id("scenario:stock:", "warehouse");
      await this.advance("stock location · Main warehouse", false, () => inventory.saveLocation(actor, this.w, { id, kind: "warehouse", name: "Main warehouse", isDefault: true }));
      current = await state();
      warehouse = current.locations.find((row) => row.kind === "warehouse");
    }
    if (!warehouse) throw new Skip("no warehouse");
    const name = "Wood glue, PVA (5 kg)";
    let row = current.rows.find((entry) => entry.itemName === name && !entry.projectId);
    if (!row) {
      await this.advance(`free stock · ${name} ×3`, false, () => inventory.command(actor, this.w, { id: this.id("scenario:stock:", "glue:add"), action: "add", locationId: warehouse!.id, name,
        unit: "nos", quantity: "3", unitCost: regionAmount(this.scenarioInput.fixture, "38"), reason: "Opening stock count" }));
      row = (await state()).rows.find((entry) => entry.itemName === name && !entry.projectId);
    }
    if (!row) throw new Skip("the stock item wasn't added");
    const points = (await this.db.tenantTransaction(this.w, actor.userId, (client) => client.query<{ itemId: string }>(`SELECT item_id AS "itemId" FROM stock_reorder_points WHERE workspace_id = $1`, [this.w]))).rows;
    await this.advance(`${name} reorders at 10`, points.some((point) => point.itemId === row!.itemId), () => inventory.setReorderPoint(actor, this.w,
      { id: this.id("scenario:stock:", "glue:reorder"), itemId: row!.itemId, locationId: null, reorderAt: "10", reorderQuantity: "20" }));
  }

  /** A planned work order that lists more material than the project holds: it waits for materials. */
  async factoryShortage(projectKey: StoryKey) {
    const projectId = this.ctxOf(projectKey)?.ids.projectId;
    if (!projectId) throw new Skip("the project in production isn't there");
    const factory = this.get(FactoryService), maker = await this.as("factory");
    const state = (await factory.state(maker, this.w)) as unknown as { orders: Array<{ id: string; projectId: string; status: string; version: number }> };
    const planned = state.orders.find((row) => row.projectId === projectId && row.status === "planned");
    if (!planned) throw new Skip("the project has no planned work order");
    const detail = (await factory.order(maker, this.w, planned.id)) as unknown as { order: Any; materials?: Array<{ id: string; itemName?: string; status?: string }> };
    const materialId = this.id(projectId, "factory:shortage:walnut");
    const listed = (detail.materials ?? []).some((row) => row.id === materialId || (row.status === "active" && /walnut veneer, spare/i.test(row.itemName ?? "")));
    await this.advance("work order needs 40 sheets of walnut veneer (not in yet)", listed, () =>
      factory.command(maker, this.w, planned.id, { action: "add_material", version: detail.order.version, materialId, name: "Walnut veneer, spare sheets", unit: "sheet", quantity: "40" }));
  }

  /** Output reported on a work order in production, waiting for the factory lead's approval. */
  async factoryOutput(projectKey: StoryKey) {
    const projectId = this.ctxOf(projectKey)?.ids.projectId;
    if (!projectId) throw new Skip("the project in production isn't there");
    const factory = this.get(FactoryService), maker = await this.as("factory");
    const state = (await factory.state(maker, this.w)) as unknown as { orders: Array<{ id: string; projectId: string; status: string }> };
    const running = state.orders.find((row) => row.projectId === projectId && row.status === "in_production");
    if (!running) throw new Skip("no work order in production");
    const detail = (await factory.order(maker, this.w, running.id)) as unknown as { order: Any; reports: Array<{ id: string }> };
    const reportId = this.id(projectId, "factory:output:1");
    await this.advance("factory output reported, waiting for approval", detail.reports.some((row) => row.id === reportId), () =>
      factory.command(maker, this.w, running.id, { action: "report", id: reportId, good: "0.5", note: "Carcass done; doors next." }));
  }

  // ---------------------------------------------------------------- site

  /** A critical snag (open) and one fixed and waiting for the project manager's check. */
  async snags(projectKey: StoryKey) {
    const projectId = this.ctxOf(projectKey)?.ids.projectId;
    if (!projectId) throw new Skip("the project on site isn't there");
    const work = this.get(ProjectWorkService);
    const pm = await this.as("projectManager"), supervisor = await this.as("site");
    const board = async () => ((await work.board(pm, this.w, projectId)) as { items: Array<{ id: string; status: string; version: number }> }).items;
    const critical = this.id(projectId, "snag:critical");
    if (!(await board()).some((row) => row.id === critical))
      await this.advance("critical snag · water leak under the kitchen sink", false, () => work.command(pm, this.w, projectId, { action: "create", id: critical, type: "snag",
        title: "Water leak under the kitchen sink", severity: "critical", source: "inspection", assigneeId: supervisor.membershipId, dueDate: this.day(1) }));
    const review = this.id(projectId, "snag:in-review");
    let item = (await board()).find((row) => row.id === review);
    if (!item) {
      await this.advance("snag · cabinet door alignment", false, () => work.command(pm, this.w, projectId, { action: "create", id: review, type: "snag", title: "Cabinet door alignment",
        severity: "minor", source: "client", assigneeId: supervisor.membershipId, dueDate: this.day(2) }));
      item = (await board()).find((row) => row.id === review);
    }
    if (item?.status === "todo") await this.advance("snag fixed, waiting for the project manager's check", false, () => work.command(supervisor, this.w, projectId,
      { action: "update", itemId: review, version: item!.version, status: "in_review" }));
  }

  // ---------------------------------------------------------------- finance

  /** A refund request from a client, waiting for Finance and its approval. */
  async refund(storyKey: StoryKey) {
    const ctx = this.ctxOf(storyKey);
    const projectId = ctx?.ids.projectId;
    if (!ctx || !projectId) throw new Skip("the project for the refund isn't there");
    const requests = this.get(FinanceRequestsService);
    const sales = await this.as("sales");
    const id = this.id(ctx, "finance-request:refund");
    const known = (await this.db.tenantTransaction(this.w, sales.userId, (client) => client.query(`SELECT 1 FROM finance_requests WHERE workspace_id = $1 AND id = $2`, [this.w, id]))).rowCount;
    const invoice = (await this.db.tenantTransaction(this.w, sales.userId, (client) => client.query<{ number: string }>(
      `SELECT number FROM client_invoices WHERE workspace_id = $1 AND project_id = $2 ORDER BY issue_date LIMIT 1`, [this.w, projectId]))).rows[0]?.number ?? `${ctx.s.reference}-ADV`;
    await this.advance("refund request · deposit overpaid", Boolean(known), () => this.tryAs(sales, (who) => requests.command(who, this.w, { action: "submit", commandId: this.id(ctx, "finance-request:refund:submit"),
      id, kind: "refund", projectId, currency: this.scenarioInput.currency, invoiceNumber: invoice, reason: "The client paid the advance twice by mistake.",
      lines: [{ description: "Duplicate advance transfer", unitPrice: regionAmount(this.scenarioInput.fixture, "1500") }], paymentMethod: "Bank transfer" })));
  }

  /** Half of a supplier bill paid by cheque. */
  async supplierPayment(storyKey: StoryKey) {
    const ctx = this.ctxOf(storyKey);
    if (!ctx) throw new Skip("the project with the bill isn't there");
    const payables = this.get(PayablesService);
    const finance = await this.as("finance");
    const billId = this.id(ctx, "bill:extra-materials");
    const overview = (await this.tryAs(finance, (actor) => payables.overview(actor, this.w))) as unknown as { bills: Array<{ id: string; status: string; total: string; paid: string; vendorId: string;
      legalEntityId: string; currency: string; number: string }>; payments: Array<{ id: string }> };
    const bill = overview.bills.find((row) => row.id === billId);
    if (!bill || bill.status !== "approved") throw new Skip("the bill to pay isn't approved");
    const paymentId = this.id(ctx, "payment:extra-materials");
    const amount = (Number(bill.total) / 2).toFixed(2);
    await this.advance(`supplier payment · half of ${bill.number} by cheque`, overview.payments.some((row) => row.id === paymentId) || Number(bill.paid) > 0, () =>
      this.tryAs(finance, (actor) => payables.command(actor, this.w, { action: "pay", commandId: this.id(ctx, "payment:extra-materials:pay"), id: paymentId, vendorId: bill.vendorId,
        legalEntityId: bill.legalEntityId, currency: bill.currency, paidOn: this.day(-1), amount, method: "cheque", reference: `CHQ-${bill.number.replace(/[^A-Z0-9]/gi, "").slice(-6)}`,
        allocations: [{ invoiceId: billId, amount }] })));
  }

  /** This week's payment run, submitted for approval (the suppliers' bank details recorded, called back and approved first). */
  async paymentRun() {
    const payables = this.get(PayablesService), runs = this.get(PaymentRunsService), controls = this.get(SupplierControlsService);
    const finance = await this.as("finance");
    const runId = this.id("scenario:finance:", "payment-run");
    const overview = (await this.tryAs(finance, (actor) => payables.overview(actor, this.w))) as unknown as { bills: Array<{ id: string; status: string; balance: string; vendorId: string }>;
      runs: Array<{ id: string; status: string; version: number }> };
    const existing = overview.runs.find((row) => row.id === runId);
    if (existing && existing.status !== "draft") { this.kept("payment run submitted"); return; }
    const open = overview.bills.filter((bill) => bill.status === "approved" && Number(bill.balance) > 0).slice(0, 2);
    if (!open.length) throw new Skip("no approved bill with a balance for the run");
    const buyer = await this.as("buyer"), approver = await this.other(buyer, ["owner", "manager"]), checker = await this.other(approver, ["manager", "owner"]);
    for (const vendorId of [...new Set(open.map((bill) => bill.vendorId))]) {
      const view = { bankAccounts: (await this.db.tenantTransaction(this.w, buyer.userId, (client) => client.query<{ status: string }>(`SELECT status FROM vendor_bank_accounts WHERE workspace_id = $1 AND vendor_id = $2`, [this.w, vendorId]))).rows };
      if (view?.bankAccounts?.some((account) => account.status === "approved")) continue;
      const accountId = this.id(vendorId, "bank:main");
      await this.softly("approval.payment_run", async () => {
        await controls.requestBankAccount(approver, this.w, vendorId, { id: accountId, accountName: "Sandbox supplier", bankName: "Sandbox Bank", accountNumber: "0000 0000 0000 0001",
          currency: this.scenarioInput.currency, source: "supplier_letter" });
        await controls.bankAccountCommand(checker, this.w, vendorId, accountId, { action: "callback", note: "Called the supplier's office number on file." });
        await controls.bankAccountCommand(checker, this.w, vendorId, accountId, { action: "approve" });
      });
    }
    let run = existing;
    if (!run) {
      await this.advance(`payment run · ${open.length} bills`, false, () => this.tryAs(finance, (actor) => runs.command(actor, this.w, { action: "save", commandId: this.id("scenario:finance:", "payment-run:save"),
        id: runId, note: "Supplier payments for this week.", items: open.map((bill) => ({ invoiceId: bill.id, amount: bill.balance })) })));
      run = ((await this.tryAs(finance, (actor) => payables.overview(actor, this.w))) as unknown as { runs: Array<{ id: string; status: string; version: number }> }).runs.find((row) => row.id === runId);
    }
    if (run?.status === "draft") await this.advance("payment run submitted for approval", false, () => this.tryAs(finance, (actor) => runs.command(actor, this.w, { action: "submit",
      commandId: this.id("scenario:finance:", `payment-run:submit:${run!.version}`), id: runId, version: run!.version })));
  }

  // ---------------------------------------------------------------- approvals and My day

  /** The kinds waiting in the approvals feed across the test members (as each of them sees it). */
  async approvalKinds(members: ReadonlyArray<{ userId: string | null }>): Promise<Map<string, string>> {
    const approvals = this.get(ApprovalsService);
    const kinds = new Map<string, string>();
    for (const member of members) {
      if (!member.userId) continue;
      const actor = await this.actor(member.userId).catch(() => null);
      if (!actor?.membershipId) continue;
      const feed = (await approvals.mine(actor, this.w).catch(() => ({ rows: [] }))) as unknown as { rows: Array<{ kind: string; title: string; subject?: string }> };
      for (const row of feed.rows) if (!kinds.has(row.kind)) kinds.set(row.kind, `${row.title}${row.subject ? ` · ${row.subject}` : ""}`.slice(0, 160));
    }
    return kinds;
  }

  /** Each test member's open My day items (after the reminder sweep), by member key. */
  async myDayCounts(members: ReadonlyArray<{ key: string; userId: string | null }>): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const member of members) {
      if (!member.userId) continue;
      const count = (await this.db.tenantTransaction(this.w, member.userId, (client) => client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM reminder_subjects subject JOIN workspace_memberships membership ON membership.workspace_id = subject.workspace_id AND membership.user_id = $2
          WHERE subject.workspace_id = $1 AND subject.status IN ('open', 'snoozed') AND (subject.owner_membership_id = membership.id OR membership.id = ANY(subject.cc_membership_ids))`,
        [this.w, member.userId]))).rows[0]?.count ?? 0;
      counts.set(member.key, count);
    }
    return counts;
  }

  /** A task due today for a member with nothing on their day yet, on a running project. */
  async dueToday(member: { key: string; displayName: string; userId: string }, projectKey: StoryKey) {
    const projectId = this.ctxOf(projectKey)?.ids.projectId;
    if (!projectId) throw new Skip("no running project for the task");
    const person = await this.actor(member.userId);
    if (!person.membershipId) throw new Skip(`${member.displayName} isn't a member`);
    const work = this.get(ProjectWorkService), pm = await this.as("projectManager");
    const id = this.id(projectId, `my-day:${member.key}`);
    const items = ((await work.board(pm, this.w, projectId)) as { items: Array<{ id: string }> }).items;
    await this.advance(`task due today · ${member.displayName}`, items.some((row) => row.id === id), () => work.command(pm, this.w, projectId, { action: "create", id, type: "task",
      title: `Check the week's plan with the team (${member.displayName.split(" ")[0]})`, assigneeId: person.membershipId, startDate: this.day(-1), dueDate: this.day(0) }));
  }

  // ---------------------------------------------------------------- quotations and deals, after their stories

  /**
   * A quotation sent with a validity that ends today (the salesperson sets the date on the draft, as in the quote
   * form), so the product's own daily expiry marks it expired once the day is over. Its reference, or why not.
   */
  async expiringQuote(): Promise<string | null> {
    const ctx = this.ctxOf("quote-expiring");
    const caseId = ctx?.ids.caseId, quoteId = ctx?.ids.quoteId;
    if (!ctx || !caseId || !quoteId) throw new Skip("the quotation to send with a short validity wasn't made");
    const salesAdmin = await this.as("salesAdmin");
    const read = async () => ((await this.commercialData(caseId)).quotes as Any[]).find((row) => row.id === quoteId)!;
    let quote = await read();
    const today = this.day(0);
    if (quote.status === "draft" && quote.validUntil !== today) {
      // The quote form sends the whole draft back with the new date (its text fields as text, as the form keeps them).
      const asText = (value: unknown) => (typeof value === "string" ? value : "");
      const lines = ((quote.lines ?? []) as Any[]).map((line) => ({ ...line, room: asText(line.room) || "General", title: asText(line.title) || "Item", unit: asText(line.unit) || "nos",
        specification: asText(line.specification), material: asText(line.material), finish: asText(line.finish) }));
      await this.advance("quotation valid until today", false, () => this.commercialCommand(caseId, salesAdmin, "save", { quoteId, quote: { ...quote, lines,
        title: asText(quote.title) || ctx.s.title, inclusions: asText(quote.inclusions), terms: asText(quote.terms), exclusions: asText(quote.exclusions), validUntil: today } }));
    }
    quote = await read();
    if (quote.status === "draft" || quote.status === "internal_review" || quote.status === "internal_approved") await this.issue(ctx, caseId, quoteId, ctx.ids.grantId ?? "", {});
    quote = await read();
    return quote.status === "issued" ? `${quote.title} v${quote.number}, sent, valid until ${quote.validUntil}` : null;
  }

  /** A quotation the client accepted, with the agreement recorded and signed, waiting for someone who executes it. */
  async agreementWaiting() {
    const ctx = this.ctxOf("agreement-waiting");
    const caseId = ctx?.ids.caseId, quoteId = ctx?.ids.quoteId;
    if (!ctx || !caseId || !quoteId) throw new Skip("the quotation for the agreement wasn't sent");
    const salesAdmin = await this.as("salesAdmin");
    let data = await this.commercialData(caseId);
    let quote = ((data.quotes ?? []) as Any[]).find((row) => row.id === quoteId)!;
    if (quote.status === "issued") {
      await this.advance("quotation accepted by the client in the portal", false, () => this.portalDecision(ctx, "quote_decision", `quote:${caseId}:${quoteId}:accept`,
        { caseId, quoteId, decision: "accept", selectedOptionLineIds: [], note: "", hash: quote.hash }));
      data = await this.commercialData(caseId);
      quote = ((data.quotes ?? []) as Any[]).find((row) => row.id === quoteId)!;
    }
    if (quote.status !== "accepted") throw new Skip(`the quotation is ${quote.status}`);
    const reference = `AGR-${ctx.s.reference.replace(/[^A-Z0-9]/gi, "").slice(-12)}`;
    if (!data.agreement) await this.advance("agreement recorded (waiting to be executed)", false, () => this.commercialCommand(caseId, salesAdmin, "agreement", { quoteId, reference,
      terms: "The accepted quotation; the firm's standard terms apply.", evidence: `Signed agreement ${reference} on file.`, evidenceKind: "operational" }));
  }

  /** A milestone falling due today on a running project, not invoiced yet (Finance's "issue invoice" approval). */
  async invoiceDue(storyKey: StoryKey) {
    const ctx = this.ctxOf(storyKey);
    const caseId = ctx?.ids.caseId;
    if (!ctx || !caseId) throw new Skip("the project for the milestone isn't there");
    const salesAdmin = await this.as("salesAdmin");
    const data = await this.commercialData(caseId);
    const due = ((data.payments ?? []) as Any[]).find((payment) => /handover/i.test(payment.title) && payment.status === "pending");
    if (!due) throw new Skip("no unpaid handover milestone");
    await this.advance(`milestone "${due.title}" due today`, due.dueDate === this.day(0), () => this.commercialCommand(caseId, salesAdmin, "payment", {
      paymentId: due.id, title: due.title, amount: due.amount, dueDate: this.day(0), requiredForRelease: due.requiredForRelease === true, requiredForProduction: due.requiredForProduction === true,
      reference: due.reference ?? "" }));
  }

  /** A purchase order submitted and waiting for approval, and a supplier bill held (its price above the order's). */
  async waitingPurchases(storyKey: StoryKey) {
    const ctx = this.ctxOf(storyKey);
    const projectId = ctx?.ids.projectId;
    if (!ctx || !projectId) throw new Skip("the project to buy for isn't there");
    const money = (value: string) => regionAmount(this.scenarioInput.fixture, value);
    await this.softly("approval.order", () => this.freeOrder(ctx, projectId, "tiles-approval", "pending_approval",
      [{ description: "Porcelain tile 60x120 matte", quantity: "24", unit: "sqm", unitPrice: money("95") }], "Tiles for the guest bathroom (waiting for approval).", 10));
    await this.softly("approval.bill", async () => {
      const orderId = await this.freeOrder(ctx, projectId, "grout-held", "received", [{ description: "Epoxy grout, warm grey", quantity: "10", unit: "nos", unitPrice: money("40") }],
        "Grout for the bathroom.", -6);
      if (orderId) await this.bill(ctx, orderId, "grout-held", { invoiceDaysAgo: 2, dueDays: 28 }, { held: true });
    });
  }

  /** A petty cash claim submitted and waiting for the project manager. */
  async pettyCashWaiting(storyKey: StoryKey) {
    const ctx = this.ctxOf(storyKey);
    const projectId = ctx?.ids.projectId;
    if (!ctx || !projectId) throw new Skip("the project for the claim isn't there");
    const { PettyCashService } = await import("../../petty-cash/petty-cash.service");
    const petty = this.get(PettyCashService);
    const claimant = await this.as("site"), decider = await this.other(claimant, ["projectManager", "owner", "manager"]);
    const id = this.id(ctx, "petty:taxi");
    const read = async () => { try { return ((await petty.state(decider, this.w, projectId)) as unknown as { claims: Array<{ id: string; status: string; version: number }> }).claims.find((row) => row.id === id) ?? null; } catch { return null; } };
    const claim = await this.step("petty cash · taxi to the stone supplier", read, async () => {
      await petty.command(claimant, this.w, projectId, { action: "save", commandId: this.id(ctx, "petty:taxi:save"), id, spentOn: this.day(-1), amount: regionAmount(this.scenarioInput.fixture, "60"),
        description: "Taxi to the stone supplier and back", category: "transport", noReceiptReason: "Paid in cash; the driver had no receipt." });
      return (await read())!;
    });
    if (claim.status === "draft") await this.advance("petty cash submitted for approval", false, () => petty.command(claimant, this.w, projectId,
      { action: "submit", commandId: this.id(ctx, `petty:taxi:submit:${claim.version}`), claimId: id, version: claim.version }));
  }

  // ---------------------------------------------------------------- helpers

  private ctxOf(key: StoryKey): ShowcaseCtx | null {
    const s = this.scenarioInput.stories.find((story) => story.key === `scenario-${key}`);
    const ids = this.result.scenarios[`scenario-${key}`];
    return s && ids ? { s, rooms: new Map(), ids } : null;
  }

  private async softly(scenario: string, work: () => Promise<unknown>) {
    try { await work(); } catch (error) {
      const reason = error instanceof Skip ? error.reason : describe(error);
      if (!this.notes.has(scenario)) this.notes.set(scenario, reason.slice(0, 300));
      this.skip(`scenarios · ${scenario}`, reason);
    }
  }

}
