import { randomUUID } from "node:crypto";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toolContext } from "../../ai-tools/ai-tool-context";
import { ToolQuestion } from "../../ai-tools/ai-tool";
import { AiToolRegistry } from "../../ai-tools/ai-tools.registry";
import { validateToolInput } from "../../ai-tools/tool-kit";
import type { ToolServices } from "../../ai-tools/tool-services";
import { postJournal, type DraftLine, type JournalDraft } from "../ledger/ledger";
import { applyTemplate } from "../ledger/templates";
import { ProjectProfitService } from "./project-profit.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Fixtures are committed in their own
// workspaces and removed at the end; every read runs as the app role under forced RLS, as the API does.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

const BOOKS_TABLES = ["books_settings", "books_accounts", "books_account_roles", "books_payment_accounts", "books_tax_codes", "books_journals",
  "books_journal_lines", "books_posting_issues", "books_manual_journals", "books_manual_journal_lines", "books_bill_captures"];
const FIXTURE_TABLES = ["petty_cash_claims", "purchase_order_lines", "purchase_orders", "project_scope_seals", "commercial_deal_files", "commercial_quotes",
  "project_assignments", "delivery_projects", "pre_project_cases", "crm_opportunities", "crm_parties", "workspace_memberships", "document_sequences", "exchange_rates",
  "audit_events", "legal_entities"];

integration("Ledger project profit and Woddy's books tools on real Postgres", () => {
  let pool: Pool;
  const run = randomUUID().slice(0, 8);
  const ws = randomUUID(), otherWs = randomUUID();
  const people = { finance: randomUUID(), manager: randomUUID(), lead: randomUUID(), designer: randomUUID(), other: randomUUID() };
  const membership = { lead: randomUUID(), designer: randomUUID(), manager: randomUUID(), finance: randomUUID() };
  const entity = randomUUID(), otherEntity = randomUUID();
  const villa12 = randomUUID(), villa14 = randomUUID(), otherProject = randomUUID();
  const clientA = randomUUID(), clientB = randomUUID(), vendor = randomUUID();

  async function tenant<T>(workspaceId: string, userId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [workspaceId, userId]);
      await client.query("SET LOCAL ROLE wodana_app");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** The person's own tenant transaction, with exactly these permissions (as WorkspaceAccessService grants them). */
  const access = (userId: string, permissions: string[]) => ({
    asMember: (_a: unknown, workspaceId: string, work: (c: PoolClient, u: { userId: string }) => unknown) => tenant(workspaceId, userId, (client) => Promise.resolve(work(client, { userId }))),
    withPermission: async (_a: unknown, workspaceId: string, code: string, work: (c: PoolClient, u: { userId: string }) => unknown) => {
      if (!permissions.includes(code)) throw new ForbiddenException(`Permissions required: ${code}`);
      return tenant(workspaceId, userId, (client) => Promise.resolve(work(client, { userId })));
    },
    withAnyPermission: async (_a: unknown, workspaceId: string, codes: string[], work: (c: PoolClient, u: { userId: string }) => unknown) => {
      if (!codes.some((code) => permissions.includes(code))) throw new ForbiddenException(`Any permission required: ${codes.join(", ")}`);
      return tenant(workspaceId, userId, (client) => Promise.resolve(work(client, { userId })));
    },
    hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code),
  }) as never;
  const as = {
    finance: () => new ProjectProfitService(access(people.finance, ["books.view"])),
    manager: () => new ProjectProfitService(access(people.manager, ["projects.manage", "projects.view", "commercial.costs.view"])),
    lead: () => new ProjectProfitService(access(people.lead, ["projects.view", "projects.costs.view"])),
    designer: () => new ProjectProfitService(access(people.designer, ["projects.view"])),
  };

  let day = 0;
  const post = async (eventDate: string, type: string, lines: DraftLine[], workspaceId = ws, legalEntityId = entity) => {
    const draft: JournalDraft = { legalEntityId, eventDate, currency: "AED", source: { type, id: `${run}-${(day += 1)}`, event: type === "petty_cash" ? "approved" : "issued" }, lines };
    const outcome = await tenant(workspaceId, people.finance, (client) => postJournal(client, workspaceId, draft));
    if (outcome.status !== "posted") throw new Error(`Not posted: ${JSON.stringify(outcome)}`);
    return outcome.journal;
  };
  const line = (account: DraftLine["account"], side: "debit" | "credit", amount: string, extra: Partial<DraftLine> = {}): DraftLine => ({ account, side, amount, ...extra });
  const r = (role: string) => ({ role }) as DraftLine["account"];

  async function seedProject(client: PoolClient, workspaceId: string, projectId: string, name: string, reference: string, quoteId: string) {
    const caseId = randomUUID(), opportunity = randomUUID(), party = randomUUID();
    await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person',$3,$4)", [party, workspaceId, `${name} Client`, `${name} client`.toLowerCase()]);
    await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,'lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, workspaceId, party, randomUUID(), randomUUID(), name, `O-${reference}`]);
    await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunity, people.finance]);
    await client.query(`INSERT INTO delivery_projects(id,workspace_id,case_id,name,created_by,reference,quote_id,started_at,currency) VALUES($1,$2,$3,$4,$5,$6,$7,now(),'AED')`,
      [projectId, workspaceId, caseId, name, people.finance, reference, quoteId]);
    return caseId;
  }
  const seal = (client: PoolClient, projectId: string, quoteId: string, net: string, total: string) => client.query(
    `INSERT INTO project_scope_seals(id,workspace_id,project_id,kind,quote_id,quote_number,revision_label,quote_hash,snapshot,content_hash,currency,total,accepted_at,accepted_by_name,sealed_by)
     VALUES($1,$2,$3,'baseline',$4,1,'R1','h',$5::jsonb,repeat('c',64),'AED',$6,now(),'Client',$7)`,
    [randomUUID(), ws, projectId, quoteId, JSON.stringify({ pricing: { net } }), total, people.finance]);

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 6 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [key, id] of Object.entries(people)) await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${key}-${run}@profit.test`, key]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      for (const workspace of [ws, otherWs])
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Profit firm',$2,'AED','Asia/Dubai',$3)",
          [workspace, `profit-${workspace.slice(0, 8)}`, people.finance]);
      for (const [key, id] of Object.entries(membership))
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [id, ws, people[key as keyof typeof people]]);
      const company = `INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone) VALUES($1,$2,$3,$4,$4,'AE','AED','en-AE','Asia/Dubai')`;
      await client.query(company, [entity, ws, "MAIN", "Studio Interiors LLC"]);
      await client.query(company, [otherEntity, otherWs, "OTHER", "Other Firm LLC"]);
      const case12 = await seedProject(client, ws, villa12, "Villa 12", "PRJ-0012", "q12");
      const case14 = await seedProject(client, ws, villa14, "Villa 14", "PRJ-0014", "q14");
      await seedProject(client, otherWs, otherProject, "Villa 12 elsewhere", "PRJ-0099", "q99");
      // The plan: Villa 12 quoted 100,000 before tax at a Deal File cost of 70,000 (30%); Villa 14 20,000 at a QS cost of 15,000 (25%).
      await seal(client, villa12, "q12", "100000.00", "105000.00");
      await seal(client, villa14, "q14", "20000.00", "21000.00");
      await client.query(`INSERT INTO commercial_deal_files(workspace_id,case_id,id,reference,revision,quote_id,quote_hash,value,cost,margin,status) VALUES($1,$2,'DF-12','DF-12',1,'q12','h',100000,70000,30,'approved')`, [ws, case12]);
      await client.query(`INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,status,title,currency,detail) VALUES($1,$2,'q14',0,1,'quotation','accepted','Villa 14','AED',$3::jsonb)`,
        [ws, case14, JSON.stringify({ qsEstimate: { cost: "15000" } })]);
      // The site lead runs Villa 12; the designer is on its team without cost rights.
      await client.query("INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager) VALUES($1,$2,$3,true),($1,$2,$4,false)", [ws, villa12, membership.lead, membership.designer]);
      // What the Money tab counts: a petty cash claim of 450 (spent), and an open order of 10 × 100 (committed).
      await client.query(`INSERT INTO petty_cash_claims(id,workspace_id,number,project_id,spent_on,amount,currency,description,category,no_receipt_reason,status,claimed_by,submitted_at,decided_by,decided_at)
        VALUES($1,$2,1,$3,'2026-09-26',450,'AED','Diesel for the generator','transport','Fuel station',  'approved',$4,now(),$5,now())`, [randomUUID(), ws, villa12, people.lead, people.manager]);
      const order = randomUUID();
      await client.query(`INSERT INTO purchase_orders(id,workspace_id,number,legal_entity_id,vendor_id,currency,payment_terms,created_by,status,approved_at) VALUES($1,$2,'PO-1',$3,$4,'AED','on_delivery',$5,'approved',now())`,
        [order, ws, entity, vendor, people.finance]);
      await client.query(`INSERT INTO purchase_order_lines(id,workspace_id,order_id,source,project_id,description,quantity,unit_price,net,tax,total) VALUES($1,$2,$3,'free',$4,'Marble slabs',10,100,1000,50,1050)`,
        [randomUUID(), ws, order, villa12]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    // The Ledger on from 1 Sep 2026 (AE chart) in both workspaces.
    await tenant(ws, people.finance, (c) => applyTemplate(c, ws, entity, "AE", { actorId: people.finance, startDate: "2026-09-01" }));
    await tenant(otherWs, people.other, (c) => applyTemplate(c, otherWs, otherEntity, "AE", { startDate: "2026-09-01" }));
    for (const [workspace, company] of [[ws, entity], [otherWs, otherEntity]])
      await tenant(workspace, people.finance, (c) => c.query(`UPDATE books_settings SET enabled = true, version = version + 1 WHERE workspace_id = $1 AND legal_entity_id = $2`, [workspace, company]));
    const bank = await tenant(ws, people.finance, async (c) => (await c.query<{ id: string }>(
      `SELECT account_id AS id FROM books_payment_accounts WHERE workspace_id = $1 AND legal_entity_id = $2 AND direction = 'in' AND method = 'bank'`, [ws, entity])).rows[0].id);

    const p12 = { projectId: villa12 }, p14 = { projectId: villa14 };
    const a = { party: { type: "client" as const, id: clientA } }, b = { party: { type: "client" as const, id: clientB } }, v = { party: { type: "vendor" as const, id: vendor } };
    // Villa 12: invoiced 100,000 + VAT, a credit note of 10,000, a bill (subcontract 20,000 and a price variance of 500), materials issued,
    // labour (with its absorbed contra on the project too), petty cash, goods sold and a general charge.
    await post("2026-09-10", "client_invoice", [line(r("ar_control"), "debit", "105000", a), line(r("revenue_project"), "credit", "100000", p12), line(r("vat_output"), "credit", "5000")]);
    await post("2026-09-20", "supplier_bill", [line(r("cost_subcontract"), "debit", "20000", p12), line(r("cost_price_variance"), "debit", "500", p12),
      line(r("vat_input"), "debit", "1025"), line(r("ap_control"), "credit", "21525", v)]);
    await post("2026-09-25", "stock_batch", [line(r("cost_materials"), "debit", "15000", p12), line(r("inventory"), "credit", "15000")]);
    await post("2026-09-26", "petty_cash", [line(r("cost_site_expenses"), "debit", "450", p12), line(r("employee_claims_payable"), "credit", "450")]);
    await post("2026-09-28", "labour", [line(r("cost_labour"), "debit", "8000", p12), line(r("labour_absorbed"), "credit", "8000", p12)]);
    await post("2026-09-29", "stock_batch", [line(r("cogs_goods"), "debit", "1000", p12), line(r("inventory"), "credit", "1000")]);
    await post("2026-09-30", "supplier_bill", [line(r("general_expense"), "debit", "300", p12), line(r("ap_control"), "credit", "300", v)]);
    await post("2026-10-02", "client_credit_note", [line(r("revenue_project"), "debit", "10000", p12), line(r("vat_output"), "debit", "500"), line(r("ar_control"), "credit", "10500", a)]);
    await post("2026-10-03", "receipt", [line({ accountId: bank }, "debit", "50000"), line(r("ar_control"), "credit", "50000", a)]);
    // Villa 14: invoiced 20,000 + VAT, materials of 25,000: a loss.
    await post("2026-10-04", "client_invoice", [line(r("ar_control"), "debit", "21000", b), line(r("revenue_project"), "credit", "20000", p14), line(r("vat_output"), "credit", "1000")]);
    await post("2026-10-05", "stock_batch", [line(r("cost_materials"), "debit", "25000", p14), line(r("inventory"), "credit", "25000")]);
    // Another tenant's project with the same name and its own revenue.
    await post("2026-10-01", "client_invoice", [line(r("ar_control"), "debit", "999", { party: { type: "client", id: clientA } }),
      line(r("revenue_project"), "credit", "999", { projectId: otherProject })], otherWs, otherEntity);
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // fixture teardown only: immutable rows go with their workspace
      for (const table of [...BOOKS_TABLES].reverse()) await client.query(`DELETE FROM ${table} WHERE workspace_id = ANY($1::uuid[])`, [[ws, otherWs]]);
      for (const table of FIXTURE_TABLES) await client.query(`DELETE FROM ${table} WHERE workspace_id = ANY($1::uuid[])`, [[ws, otherWs]]);
      await client.query("DELETE FROM workspaces WHERE id = ANY($1::uuid[])", [[ws, otherWs]]);
      await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [Object.values(people)]);
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    await pool.end();
  });

  it("works out a project's P&L from its journal lines: revenue net of credits, costs by type, profit, margin against the quote, committed spend", async () => {
    const pnl = await as.finance().pnl(actor, ws, villa12);
    if (!pnl.enabled) throw new Error("Ledger off");
    expect(pnl).toMatchObject({
      reference: "PRJ-0012", name: "Villa 12", clientName: "Villa 12 Client", company: { id: entity, name: "Studio Interiors LLC" }, currency: "AED", marginHidden: false,
      revenue: "90000.0000",
      // The labour absorbed contra on the project is not a cost; the general charge is "other".
      costs: { materials: "15000.0000", subcontract: "20000.0000", labour: "8000.0000", siteExpenses: "450.0000", priceVariance: "500.0000", other: "300.0000", cogs: "1000.0000" },
      totalCost: "45250.0000", profit: "44750.0000", marginPercent: "49.72",
      quotedValue: "100000.0000", quoteCurrency: "AED", quotedCost: "70000.0000", quotedMarginPercent: "30.00", marginVsQuote: "19.72",
      committed: "1000.0000", committedCurrency: "AED",
      links: { project: `/workspace/projects/${villa12}/money`, journals: `/workspace/ledger/journals?project=${villa12}` },
    });
    // Reconciliation with the Money tab's "spent": only the petty cash has a source record here; the rest is the difference.
    expect(pnl.reconciliation).toEqual({ moneySpent: "450.0000", moneyCurrency: "AED", uncosted: 0, difference: "44800.0000", matches: false });

    const loss = await as.finance().pnl(actor, ws, villa14);
    expect(loss).toMatchObject({ revenue: "20000.0000", totalCost: "25000.0000", profit: "-5000.0000", marginPercent: "-25.00", quotedMarginPercent: "25.00", marginVsQuote: "-50.00" });
    // Someone who sees costs and margins on every project reads the same.
    expect(await as.manager().pnl(actor, ws, villa12)).toMatchObject({ profit: "44750.0000", marginHidden: false });
  });

  it("hides the margin from people who only see their project's own costs, and refuses people without cost rights", async () => {
    const pnl = await as.lead().pnl(actor, ws, villa12);
    expect(pnl).toMatchObject({ enabled: true, marginHidden: true, totalCost: "45250.0000", profit: null, marginPercent: null, quotedCost: null, quotedMarginPercent: null, marginVsQuote: null });
    await expect(as.lead().pnl(actor, ws, villa14)).rejects.toBeInstanceOf(NotFoundException);
    await expect(as.designer().pnl(actor, ws, villa12)).rejects.toThrow(/don't see this project's costs/);
    await expect(as.designer().projectsProfit(actor, ws, {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("lists every project's profit for a company and period, only the person's own projects without margin for cost-only viewers", async () => {
    const grid = await as.finance().projectsProfit(actor, ws, {});
    if (!grid.enabled) throw new Error("Ledger off");
    expect(grid).toMatchObject({ companies: [{ id: entity, name: "Studio Interiors LLC" }], company: { id: entity }, currency: "AED", marginHidden: false });
    expect(grid.rows.map((row) => [row.reference, row.revenue, row.totalCost, row.profit, row.marginPercent, row.marginVsQuote, row.committed])).toEqual([
      ["PRJ-0012", "90000.0000", "45250.0000", "44750.0000", "49.72", "19.72", "1000.0000"],
      ["PRJ-0014", "20000.0000", "25000.0000", "-5000.0000", "-25.00", "-50.00", "0.0000"],
    ]);
    const october = await as.finance().projectsProfit(actor, ws, { entity, from: "2026-10-01", to: "2026-10-31" });
    expect(october.rows.map((row) => [row.reference, row.revenue, row.totalCost])).toEqual([["PRJ-0012", "-10000.0000", "0.0000"], ["PRJ-0014", "20000.0000", "25000.0000"]]);
    await expect(as.finance().projectsProfit(actor, ws, { entity: otherEntity })).rejects.toThrow(/isn't on for this company/);
    await expect(as.finance().projectsProfit(actor, ws, { from: "2026-10-31", to: "2026-10-01" })).rejects.toThrow(/after/);

    const own = await as.lead().projectsProfit(actor, ws, {});
    expect(own).toMatchObject({ marginHidden: true });
    expect(own.rows).toEqual([expect.objectContaining({ reference: "PRJ-0012", totalCost: "45250.0000", profit: null, marginPercent: null, marginVsQuote: null })]);
  });

  it("keeps each tenant's books apart", async () => {
    // The other firm's Villa 12 posted 999 of revenue: never in this workspace's figures, and its project isn't found from here.
    const grid = await as.finance().projectsProfit(actor, ws, {});
    expect(grid.rows.map((row) => row.projectId)).not.toContain(otherProject);
    await expect(as.finance().pnl(actor, ws, otherProject)).rejects.toBeInstanceOf(NotFoundException);
    expect(await tenant(ws, people.finance, async (c) => (await c.query("SELECT 1 FROM books_journal_lines WHERE project_id = $1", [otherProject])).rowCount)).toBe(0);
    expect(await as.finance().findProjects(actor, ws, "Villa 12")).toEqual([expect.objectContaining({ id: villa12 })]);
    const theirs = await new ProjectProfitService(access(people.other, ["books.view"])).pnl(actor, otherWs, otherProject);
    expect(theirs).toMatchObject({ revenue: "999.0000", totalCost: "0.0000" });
  });

  it("sums the books for Woddy: P&L, cash, receivables and payables, VAT due and ageing", async () => {
    const year = await as.finance().summary(actor, ws, { from: "2026-09-01", to: "2026-10-31" });
    if (!year.enabled) throw new Error("Ledger off");
    expect(year).toMatchObject({
      company: { id: entity }, currency: "AED", from: "2026-09-01", to: "2026-10-31",
      // Labour absorbed sits in cost of sales (AE template), so it offsets labour there.
      profitAndLoss: { income: "110000.0000", costOfSales: "61950.0000", grossProfit: "48050.0000", operatingExpenses: "300.0000", netProfit: "47750.0000" },
      balances: { cash: "50000.0000", receivables: "65500.0000", payables: "21825.0000" },
      vat: { output: "5500.0000", input: "1025.0000", due: "4475.0000" },
      receivablesAgeing: { current: "0.0000", "1_30": "21000.0000", "31_60": "44500.0000", "61_90": "0.0000", over_90: "0.0000", total: "65500.0000" },
      payablesAgeing: { "31_60": "21825.0000", total: "21825.0000" },
    });
    const october = await as.finance().summary(actor, ws, { from: "2026-10-01", to: "2026-10-31" });
    expect(october).toMatchObject({ vat: { output: "500.0000", input: "0.0000", due: "500.0000" } });
    await expect(as.manager().summary(actor, ws, {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("answers \"Did Villa 12 make money?\" through Woddy with the numbers and the citation, within the person's permissions", async () => {
    const woddy = (userId: string, granted: string[], service: ProjectProfitService) => {
      const registry = AiToolRegistry.catalogue({ books: service } as unknown as ToolServices);
      const { context, sources } = toolContext({ actor, workspaceId: ws, runId: "run-1", asker: { userId, membershipId: "m", permissions: new Set(granted), timeZone: "Asia/Dubai", locale: "en" } });
      const offered = registry.offered(new Set(granted)).map((tool) => tool.name);
      const call = (name: string, args: Record<string, unknown>) => {
        const tool = registry.get(name)!;
        return tool.run!(context, validateToolInput(tool.parameters, args)) as Promise<{ data: Record<string, unknown> }>;
      };
      return { offered, call, sources };
    };

    const finance = woddy(people.finance, ["books.view"], as.finance());
    expect(finance.offered).toEqual(expect.arrayContaining(["project_profit", "books_report"]));
    const answer = await finance.call("project_profit", { project: "Villa 12" });
    expect(answer.data).toMatchObject({
      source: "S1", journals: "S2", project: { reference: "PRJ-0012", name: "Villa 12" }, currency: "AED", revenue: "90000.0000", totalCost: "45250.0000",
      profit: "44750.0000", marginPercent: "49.72", result: "made money", quoted: { value: "100000.0000", marginPercent: "30.00" }, marginVsQuotePoints: "19.72",
      committedOnOpenOrders: { amount: "1000.0000", currency: "AED" },
    });
    expect(finance.sources).toEqual([
      { key: "S1", type: "project", id: villa12, label: "PRJ-0012", href: `/workspace/projects/${villa12}/money` },
      { key: "S2", type: "ledger_journals", id: villa12, label: "Ledger journals · PRJ-0012", href: `/workspace/ledger/journals?project=${villa12}` },
    ]);
    // "Villa 1" matches both villas: Woddy asks which one.
    await expect(finance.call("project_profit", { project: "Villa 1" })).rejects.toBeInstanceOf(ToolQuestion);
    const report = await finance.call("books_report", { from: "2026-09-01", to: "2026-10-31" });
    expect(report.data).toMatchObject({ company: "Studio Interiors LLC", vat: { due: "4475.0000" }, profitAndLoss: { netProfit: "47750.0000" } });

    // A site lead sees Villa 12's costs, not its revenue, profit or margin; no books_report without the Ledger.
    const lead = woddy(people.lead, ["projects.view", "projects.costs.view"], as.lead());
    expect(lead.offered).toContain("project_profit");
    expect(lead.offered).not.toContain("books_report");
    const costs = await lead.call("project_profit", { project: "PRJ-0012" });
    expect(costs.data).toMatchObject({ marginHidden: true, totalCost: "45250.0000" });
    expect(costs.data).not.toHaveProperty("profit");
    expect(costs.data).not.toHaveProperty("revenue");

    // Without the Ledger or cost rights the tool isn't offered at all.
    const designer = woddy(people.designer, ["projects.view"], as.designer());
    expect(designer.offered).not.toContain("project_profit");
    expect(designer.offered).not.toContain("books_report");
  });
});
