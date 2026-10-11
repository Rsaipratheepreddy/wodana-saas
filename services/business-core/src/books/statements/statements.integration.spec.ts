import { randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import type { AccountRole } from "../books-contract";
import { type DraftLine, type JournalDraft, postJournal, type PostOutcome } from "../ledger/ledger";
import { applyTemplate } from "../ledger/templates";
import type { GeneralLedgerReport, TrialBalanceReport } from "../reports/report-types";
import { BooksReportsService } from "../reports/reports.service";
import { cashFlowCsv, profitAndLossCsv } from "./statement-csv";
import type { CashFlowStatement, ProfitAndLossStatement, StatementRow } from "./statement-contract";
import { StatementSourceRegistry } from "./statement-source";
import type { StatementResponse, StatementSourceView } from "./statements";
import { BooksStatementsService } from "./statements.service";
import { seedDefaultNotificationTemplates } from "../../notifications/default-templates";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Fixtures are committed in their own
// workspaces; every read and command runs through the service as the app role under forced RLS, exactly as the API does.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

const BOOKS_TABLES = ["books_settings", "books_accounts", "books_account_roles", "books_payment_accounts", "books_tax_codes", "books_journals",
  "books_journal_lines", "books_posting_issues", "books_manual_journals", "books_manual_journal_lines", "books_bill_captures", "books_commands", "books_statement_sources"];

integration("Company statements on real Postgres (P&L by category, comparison, cash flow by month, sources, drill-down, tenancy)", () => {
  let pool: Pool;
  const run = randomUUID().slice(0, 8);
  const ws = randomUUID(), otherWs = randomUUID(), plainWs = randomUUID();
  const people = { finance: randomUUID(), controller: randomUUID(), viewer: randomUUID(), sales: randomUUID(), other: randomUUID(), plain: randomUUID() };
  const entity = randomUUID(), otherEntity = randomUUID(), plainEntity = randomUUID();
  const quotes = { design: "q-design", main: "q-main", variation: "q-var" };
  const caseId = randomUUID(), projectId = randomUUID();
  const invoices = { design: randomUUID(), main: randomUUID(), variation: randomUUID() };
  const creditNote = randomUUID();
  const factoryReport = randomUUID();
  const vendor = randomUUID();
  const journals: Record<string, string> = {};

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
  const database = { tenantTransaction: (workspaceId: string, userId: string, work: (client: PoolClient) => Promise<unknown>) => tenant(workspaceId, userId, work) };
  const access = (userId: string) => new WorkspaceAccessService(database as never, { resolveActor: async () => ({ userId }) } as never);
  const sweeps: string[] = [];
  const statements = (userId: string) => new BooksStatementsService(access(userId), new StatementSourceRegistry(), { runSweepNow: async (id: string) => { sweeps.push(id); } });
  const reports = (userId: string) => new BooksReportsService(access(userId), { runSweepNow: async () => undefined });
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

  const post = async (key: string, draft: Omit<JournalDraft, "currency" | "legalEntityId" | "source"> & { source?: Partial<JournalDraft["source"]> }) => {
    const source = { type: "manual_journal", id: randomUUID(), event: "approved", label: key, ...draft.source };
    const outcome: PostOutcome = await tenant(ws, people.finance, (client) => postJournal(client, ws, { legalEntityId: entity, currency: "AED", ...draft, source }));
    if (outcome.status !== "posted" && outcome.status !== "existing") throw new Error(`Not posted ${key}: ${JSON.stringify(outcome)}`);
    journals[key] = outcome.journal.id;
  };
  const line = (role: AccountRole, side: "debit" | "credit", amount: string, extra: Partial<DraftLine> = {}): DraftLine => ({ account: { role }, side, amount, ...extra });
  const code = (accountCode: string, side: "debit" | "credit", amount: string): DraftLine => ({ account: { accountId: accounts[accountCode] }, side, amount });
  const accounts: Record<string, string> = {};

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 6 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [key, id] of Object.entries(people)) await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${key}-${run}@statements.test`, `${key} person`]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers and foreign keys
      for (const [workspace, name] of [[ws, "Statements"], [otherWs, "Other firm"], [plainWs, "No books"]]) {
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,$2,$3,'AED','Asia/Dubai',$4)",
          [workspace, name, `statements-${workspace.slice(0, 8)}`, people.finance]);
      }
      const company = `INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8)`;
      await client.query(company, [entity, ws, "MAIN", "Studio Interiors LLC", "AE", "AED", "en-AE", "Asia/Dubai"]);
      await client.query(company, [otherEntity, otherWs, "OTHER", "Other Firm LLC", "AE", "AED", "en-AE", "Asia/Dubai"]);
      // A firm without the Ledger, in a country whose financial year starts in April (region pack).
      await client.query(company, [plainEntity, plainWs, "PLAIN", "Plain Studio Pvt Ltd", "IN", "INR", "en-IN", "Asia/Kolkata"]);
      const grants: Array<[keyof typeof people, string, string[]]> = [
        ["finance", ws, ["books.view", "books.manage"]], ["controller", ws, ["books.view", "books.manage"]], ["viewer", ws, ["books.view"]], ["sales", ws, ["crm.leads.view"]], ["other", otherWs, ["books.view", "books.manage"]],
        ["plain", plainWs, ["books.view", "books.manage"]]];
      for (const [key, workspace, permissions] of grants) {
        const membership = randomUUID(), role = randomUUID();
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, workspace, people[key]]);
        await client.query("INSERT INTO roles(id,workspace_id,code,name) VALUES($1,$2,$3,$3)", [role, workspace, `statements_${key}`]);
        await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])", [workspace, role, permissions]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspace, membership, role]);
      }
      // The quotations invoices came from: a design round, the main quotation and a variation.
      for (const [id, kind, round, number] of [[quotes.design, "quotation", "design", 1], [quotes.main, "quotation", "main", 2], [quotes.variation, "variation", null, 3]] as const) {
        await client.query(`INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency,tax_rate)
          VALUES($1,$2,$3,$4,$4,$5,$6,'accepted',$3,'AED',5)`, [ws, caseId, id, number, kind, round]);
      }
      const invoice = `INSERT INTO client_invoices(id,workspace_id,legal_entity_id,project_id,case_id,payment_id,quote_id,number,issue_date,due_date,currency,net,tax,total,
          prices_include_tax,milestone_title,customer_name,company_name,issued_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,'AED',$10,$11,$12,true,'Milestone','Client','Studio',$13)`;
      await client.query(invoice, [invoices.design, ws, entity, projectId, caseId, "p-design", quotes.design, "INV-1", "2026-10-02", "20000", "1000", "21000", people.finance]);
      await client.query(invoice, [invoices.main, ws, entity, projectId, caseId, "p-main", quotes.main, "INV-2", "2026-10-05", "100000", "5000", "105000", people.finance]);
      await client.query(invoice, [invoices.variation, ws, entity, projectId, caseId, "p-var", quotes.variation, "INV-3", "2026-10-06", "10000", "500", "10500", people.finance]);
      await client.query(`INSERT INTO client_credit_notes(id,workspace_id,legal_entity_id,invoice_id,number,issue_date,currency,net,tax,total,reason,issued_by)
        VALUES($1,$2,$3,$4,'CN-1','2026-11-03','AED',10000,500,10500,'Wrong scope',$5)`, [creditNote, ws, entity, invoices.variation, people.finance]);
      await client.query("INSERT INTO work_order_reports(id,workspace_id,work_order_id,good,reported_by) VALUES($1,$2,$3,1,$4)", [factoryReport, ws, randomUUID(), people.finance]);
      await client.query("INSERT INTO workspace_vendors(workspace_id,id,code,display_name,status,capabilities,created_by,updated_by) VALUES($1,$2,'TIMBER','Dubai Timber','active','{materials}',$3,$3)",
        [ws, vendor, people.finance]);
      // Wodana's own records for operational cash: a design milestone paid (5% VAT inside), a bill for ordered goods and its payment.
      await client.query("INSERT INTO commercial_payments(workspace_id,case_id,id,sort_order,title,amount,status,source_quote_id,legal_entity_id,due_date,currency) VALUES($1,$2,'p-design',1,'Design',21000,'verified',$3,$4,'2026-10-02','AED')",
        [ws, caseId, quotes.design, entity]);
      await client.query("INSERT INTO commercial_payments(workspace_id,case_id,id,sort_order,title,amount,status,source_quote_id,legal_entity_id,due_date,currency) VALUES($1,$2,'p-main',2,'Production',105000,'pending',$3,$4,'2026-10-20','AED')",
        [ws, caseId, quotes.main, entity]);
      await client.query("INSERT INTO delivery_projects(id,workspace_id,case_id,name,reference,quote_id,started_at,created_by) VALUES($1,$2,$3,'Villa 12','PRJ-12',$4,now(),$5)",
        [projectId, ws, caseId, quotes.main, people.finance]);
      await client.query(`INSERT INTO commercial_receipts(workspace_id,case_id,id,sort_order,payment_id,legal_entity_id,currency,amount,source,status,detail)
        VALUES($1,$2,'r1',1,'p-design',$3,'AED',21000,'manual','finance_verified',jsonb_build_object('verifiedAt','2026-10-03T08:00:00Z'))`, [ws, caseId, entity]);
      const bill = randomUUID();
      await client.query(`INSERT INTO supplier_invoices(id,workspace_id,vendor_id,legal_entity_id,number,invoice_date,due_date,currency,net,tax,total,status,approved_at,approved_by,created_by)
        VALUES($1,$2,$3,$4,'B-1','2026-10-04','2026-11-15','AED',30000,1500,31500,'approved',now(),$5,$6)`, [bill, ws, vendor, entity, people.viewer, people.finance]);
      await client.query(`INSERT INTO supplier_invoice_lines(id,workspace_id,invoice_id,order_line_id,description,quantity,unit_price,net,tax,total)
        VALUES($1,$2,$3,$4,'Oak veneer',1,30000,30000,1500,31500)`, [randomUUID(), ws, bill, randomUUID()]);
      await client.query(`INSERT INTO supplier_payments(id,workspace_id,vendor_id,legal_entity_id,paid_on,currency,amount,method,bank_account_id,created_by)
        VALUES($1,$2,$3,$4,'2026-10-12','AED',21000,'bank',$5,$6)`, [randomUUID(), ws, vendor, entity, randomUUID(), people.finance]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, ws);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    // The AE chart from 1 Sep 2026, the Ledger on for the firm (not for the other two companies' statements here).
    await tenant(ws, people.finance, (db) => applyTemplate(db, ws, entity, "AE", { startDate: "2026-09-01" }));
    await tenant(otherWs, people.other, (db) => applyTemplate(db, otherWs, otherEntity, "IFRS", { startDate: "2026-09-01" }));
    for (const [workspace, company, region] of [[ws, entity, "DXB"], [otherWs, otherEntity, null]] as const) {
      await tenant(workspace, people.finance, (db) => db.query("UPDATE books_settings SET enabled = true, vat_region = $3, version = version + 1 WHERE workspace_id = $1 AND legal_entity_id = $2",
        [workspace, company, region]));
    }
    for (const row of (await tenant(ws, people.finance, (db) => db.query<{ id: string; code: string }>("SELECT id, code FROM books_accounts WHERE workspace_id = $1 AND legal_entity_id = $2", [ws, entity]))).rows) {
      accounts[row.code] = row.id;
    }

    // Opening cash, dated the start date: before the first day in a cash flow.
    await post("OPEN", { kind: "opening", eventDate: "2026-09-01", lines: [code("1100", "debit", "100000"), line("opening_balance_equity", "credit", "100000")] });
    // September: other income received.
    await post("SEP-FEE", { eventDate: "2026-09-15", lines: [code("1100", "debit", "5000"), line("revenue_other", "credit", "5000")] });
    // October: invoices from the three quotations.
    await post("INV-1", { eventDate: "2026-10-02", source: { type: "client_invoice", id: invoices.design, event: "issued" },
      lines: [line("ar_control", "debit", "21000"), line("revenue_project", "credit", "20000"), line("vat_output", "credit", "1000")] });
    await post("INV-2", { eventDate: "2026-10-05", source: { type: "client_invoice", id: invoices.main, event: "issued" },
      lines: [line("ar_control", "debit", "105000"), line("revenue_project", "credit", "100000"), line("vat_output", "credit", "5000")] });
    await post("INV-3", { eventDate: "2026-10-06", source: { type: "client_invoice", id: invoices.variation, event: "issued" },
      lines: [line("ar_control", "debit", "10500"), line("revenue_project", "credit", "10000"), line("vat_output", "credit", "500")] });
    await post("RCPT-1", { eventDate: "2026-10-08", source: { type: "receipt", event: "verified" }, lines: [code("1100", "debit", "50000"), line("ar_control", "credit", "50000")] });
    await post("RCPT-ADV", { eventDate: "2026-10-09", source: { type: "receipt", event: "verified" }, lines: [code("1100", "debit", "21000"), line("client_advances", "credit", "21000")] });
    await post("BILL", { eventDate: "2026-10-10", source: { type: "supplier_bill", event: "approved" },
      lines: [line("grni", "debit", "30000"), line("vat_input", "debit", "1500"), line("ap_control", "credit", "31500")] });
    await post("STOCK", { eventDate: "2026-10-10", source: { type: "stock_batch", event: "moved" }, lines: [line("cost_materials", "debit", "30000"), line("grni", "credit", "30000")] });
    await post("SITE-LAB", { eventDate: "2026-10-11", source: { type: "labour", id: `labour:${randomUUID()}:1`, event: "costed" },
      lines: [line("cost_labour", "debit", "4000"), line("labour_absorbed", "credit", "4000")] });
    await post("FACTORY-LAB", { eventDate: "2026-10-12", source: { type: "labour", id: `labour:${factoryReport}:1`, event: "costed" },
      lines: [line("cost_labour", "debit", "6000"), line("labour_absorbed", "credit", "6000")] });
    await post("PAY", { eventDate: "2026-10-13", source: { type: "supplier_payment", event: "paid" }, lines: [line("ap_control", "debit", "31500"), code("1100", "credit", "31500")] });
    await post("RENT", { eventDate: "2026-10-14", lines: [code("6120", "debit", "8000"), code("1100", "credit", "8000")] });
    await post("PAYROLL", { eventDate: "2026-10-15", lines: [code("6110", "debit", "12000"), code("1100", "credit", "12000")] });
    await post("VAT-PAID", { eventDate: "2026-10-16", lines: [line("vat_output", "debit", "2000"), code("1100", "credit", "2000")] });
    await post("FLOAT", { eventDate: "2026-10-17", lines: [code("1150", "debit", "1000"), code("1100", "credit", "1000")] });
    await post("PETTY-OK", { eventDate: "2026-10-18", source: { type: "petty_cash", event: "approved" }, lines: [line("cost_site_expenses", "debit", "300"), line("employee_claims_payable", "credit", "300")] });
    await post("PETTY-PAID", { eventDate: "2026-10-19", source: { type: "petty_cash", event: "reimbursed" }, lines: [line("employee_claims_payable", "debit", "300"), code("1150", "credit", "300")] });
    // November: the variation credited.
    await post("CN-1", { eventDate: "2026-11-03", source: { type: "client_credit_note", id: creditNote, event: "issued" },
      lines: [line("revenue_project", "debit", "10000"), line("vat_output", "debit", "500"), line("ar_control", "credit", "10500")] });
    // The other tenant's revenue, never in this firm's statements.
    await tenant(otherWs, people.other, (db) => postJournal(db, otherWs, { legalEntityId: otherEntity, eventDate: "2026-10-05", currency: "AED",
      source: { type: "manual_journal", id: randomUUID(), event: "approved" }, lines: [line("ar_control", "debit", "999"), line("revenue_project", "credit", "999")] }));
  }, 120_000);

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // fixture teardown only
      const all = [ws, otherWs, plainWs];
      for (const table of [...BOOKS_TABLES].reverse()) await client.query(`DELETE FROM ${table} WHERE workspace_id = ANY($1::uuid[])`, [all]);
      for (const table of ["document_sequences", "audit_events", "notifications", "notification_deliveries", "notification_templates", "outbox_events", "client_credit_notes", "client_invoices", "commercial_receipts",
        "commercial_payments", "commercial_quotes", "supplier_payments", "supplier_invoice_lines", "supplier_invoices", "work_order_reports", "delivery_projects",
        "workspace_vendors", "member_roles", "role_permissions", "roles", "workspace_memberships", "legal_entities"]) {
        await client.query(`DELETE FROM ${table} WHERE workspace_id = ANY($1::uuid[])`, [all]).catch(() => undefined);
      }
      await client.query("DELETE FROM workspaces WHERE id = ANY($1::uuid[])", [all]);
      await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [Object.values(people)]);
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    await pool.end();
  });

  const pnl = (query: Record<string, unknown>, userId = people.finance) =>
    statements(userId).profitAndLoss(actor, ws, { entity, ...query }) as Promise<StatementResponse<ProfitAndLossStatement>>;
  const flow = (query: Record<string, unknown>, userId = people.finance) =>
    statements(userId).cashFlow(actor, ws, { entity, ...query }) as Promise<StatementResponse<CashFlowStatement>>;
  const section = (statement: ProfitAndLossStatement | CashFlowStatement, key: string) => statement.sections.find((item) => item.key === key)!;
  const amounts = (rows: readonly StatementRow[]) => Object.fromEntries(rows.map((row) => [row.key, row.amounts]));

  it("balances the trial balance the statements are read from", async () => {
    const tb = await reports(people.finance).report(actor, ws, "trial-balance", { entity, from: "2026-09-01", to: "2026-11-30" }) as TrialBalanceReport;
    expect(tb.balanced).toBe(true);
    expect(tb.totals.debit).toBe(tb.totals.credit);
  });

  it("builds October's P&L by category with gross and net margins (hand-computed)", async () => {
    const { statement, source, period } = await pnl({ from: "2026-10-01", to: "2026-10-31" });
    expect(source).toMatchObject({ source: "ledger", chosen: false, capabilities: { accrual: true, cash: true, drillDown: true } });
    expect(period).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(amounts(section(statement, "revenue").rows)).toEqual({ design_fees: ["20000.0000"], production: ["100000.0000"], variations: ["10000.0000"] });
    const costs = section(statement, "cost_of_sales");
    expect(amounts(costs.rows)).toEqual({ materials: ["30000.0000"], subcontract_labour: ["-6000.0000"], factory: ["6000.0000"], other_costs: ["300.0000"] });
    expect(costs.rows.find((row) => row.key === "factory")!.rows!.map((row) => [row.code, row.amounts[0]])).toEqual([["5300", "6000.0000"]]);
    expect(costs.rows.find((row) => row.key === "subcontract_labour")!.rows!.map((row) => [row.code, row.amounts[0]])).toEqual([["5300", "4000.0000"], ["6300", "-10000.0000"]]);
    expect(section(statement, "operating_expenses").rows.map((row) => [row.code, row.amounts[0]])).toEqual([["6110", "12000.0000"], ["6120", "8000.0000"]]);
    expect(statement.totals).toEqual({
      revenue: ["130000.0000"], costOfSales: ["30300.0000"], grossProfit: ["99700.0000"], grossMarginPercent: ["76.7"],
      operatingExpenses: ["20000.0000"], operatingProfit: ["79700.0000"], otherIncome: ["0.0000"], otherExpenses: ["0.0000"],
      netProfit: ["79700.0000"], netMarginPercent: ["61.3"],
    });
    expect(sweeps).toContain(ws);
  });

  it("compares with the previous period and the same period last year", async () => {
    const previous = await pnl({ from: "2026-10-01", to: "2026-10-31", compare: "previous_period" });
    expect(previous.comparison).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(previous.statement.columns.map((column) => column.role)).toEqual(["current", "comparison"]);
    expect(previous.statement.totals.netProfit).toEqual(["79700.0000", "5000.0000"]);
    expect(previous.statement.totals.grossMarginPercent).toEqual(["76.7", null]);
    expect(amounts(section(previous.statement, "other_income").rows)).toEqual({ [`account:${accounts["4900"]}`]: ["0.0000", "5000.0000"] });
    const november = await pnl({ from: "2026-11-01", to: "2026-11-30", compare: "previous_period" });
    expect(amounts(section(november.statement, "revenue").rows).variations).toEqual(["-10000.0000", "10000.0000"]);
    const lastYear = await pnl({ from: "2026-10-01", to: "2026-10-31", compare: "previous_year" });
    expect(lastYear.comparison).toEqual({ from: "2025-10-01", to: "2025-10-31" });
    expect(lastYear.statement.totals.revenue).toEqual(["130000.0000", "0.0000"]);
    const csv = profitAndLossCsv(previous);
    expect(csv).toContain('"Gross profit","","99700.0000","0.0000","99700.0000",""');
    expect(csv).toContain('"Net profit","","79700.0000","5000.0000","74700.0000","1494.0"');
  });

  it("drills from a P&L line to its account's journals", async () => {
    const { statement } = await pnl({ from: "2026-10-01", to: "2026-10-31" });
    const revenueAccount = section(statement, "revenue").rows[0].rows![0].accountId!;
    expect(revenueAccount).toBe(accounts["4100"]);
    const ledger = await reports(people.finance).account(actor, ws, revenueAccount, { entity, from: "2026-10-01", to: "2026-10-31" }) as GeneralLedgerReport;
    expect(ledger.rows.map((row) => row.journalId).sort()).toEqual([journals["INV-1"], journals["INV-2"], journals["INV-3"]].sort());
    expect(ledger.credit).toBe("130000.0000");
  });

  it("builds the cash flow by month with opening and closing cash per account (hand-computed)", async () => {
    const { statement } = await flow({ from: "2026-09-01", to: "2026-10-31" });
    expect(statement.columns.map((column) => column.from)).toEqual(["2026-09-01", "2026-10-01"]);
    expect(amounts(section(statement, "cash_in").rows)).toEqual({ client_payments: ["0.0000", "50000.0000"], client_advances: ["0.0000", "21000.0000"],
      other_receipts: ["5000.0000", "0.0000"] });
    expect(amounts(section(statement, "cash_out").rows)).toEqual({ supplier_payments: ["0.0000", "31500.0000"], labour: ["0.0000", "12000.0000"],
      expenses: ["0.0000", "8300.0000"], tax: ["0.0000", "2000.0000"] });
    expect(statement.netCashFlow).toEqual(["5000.0000", "17200.0000"]);
    expect(statement.opening).toEqual(["100000.0000", "105000.0000"]);
    expect(statement.closing).toEqual(["105000.0000", "122200.0000"]);
    expect(statement.accounts.map((account) => [account.label, account.opening, account.closing])).toEqual([
      ["Bank", ["100000.0000", "105000.0000"], ["105000.0000", "121500.0000"]],
      ["Petty cash", ["0.0000", "0.0000"], ["0.0000", "700.0000"]],
    ]);
    expect(cashFlowCsv(await flow({ from: "2026-09-01", to: "2026-10-31" }))).toContain('"Closing cash","105000.0000","122200.0000"');
  });

  it("forecasts the next 90 days from what is due when the period reaches today", async () => {
    const today = (await statements(people.finance).source(actor, ws, { entity }) as StatementSourceView).company.today;
    const { statement } = await flow({ from: "2026-09-01", to: today });
    expect(statement.forecast?.columns).toHaveLength(3);
    // The production milestone (105,000, unpaid) and the rest of the bill (31,500 − 21,000) are due before the third bucket ends.
    expect(statement.forecast!.receipts.reduce((sum, value) => sum + Number(value), 0)).toBe(105000);
    expect(statement.forecast!.payments.reduce((sum, value) => sum + Number(value), 0)).toBe(10500);
  });

  it("reads operational cash from Wodana's records once chosen, and the choice is version-checked, idempotent and audited", async () => {
    const view = await statements(people.finance).source(actor, ws, { entity }) as StatementSourceView;
    expect(view).toMatchObject({ source: "ledger", chosen: false, version: 0, canManage: true });
    expect(view.options.map((option) => [option.source, option.available])).toEqual([["ledger", true], ["zoho_books", false], ["quickbooks", false], ["operational_cash", true]]);
    const commandId = randomUUID();
    await expect(statements(people.viewer).setSource(actor, ws, { legalEntityId: entity, source: "operational_cash", expectedVersion: 0, commandId })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(statements(people.finance).setSource(actor, ws, { legalEntityId: entity, source: "zoho_books", expectedVersion: 0, commandId: randomUUID() }))
      .rejects.toBeInstanceOf(ConflictException);
    const chosen = await statements(people.finance).setSource(actor, ws, { legalEntityId: entity, source: "operational_cash", expectedVersion: 0, commandId }) as StatementSourceView;
    expect(chosen).toMatchObject({ source: "operational_cash", chosen: true, version: 1 });
    // The same command again changes nothing; a stale version is refused.
    expect(await statements(people.finance).setSource(actor, ws, { legalEntityId: entity, source: "operational_cash", expectedVersion: 0, commandId })).toMatchObject({ version: 1 });
    await expect(statements(people.finance).setSource(actor, ws, { legalEntityId: entity, source: "ledger", expectedVersion: 0, commandId: randomUUID() }))
      .rejects.toBeInstanceOf(ConflictException);
    const audits = await pool.query("SELECT before, after FROM audit_events WHERE workspace_id = $1 AND action = 'books.statement_source_changed' AND entity_id = $2", [ws, entity]);
    expect(audits.rows).toEqual([{ before: { source: "ledger", chosen: false, version: 0 }, after: { source: "operational_cash", version: 1 } }]);
    // Everyone else who sets up the Ledger is told, in the app and by email; never who changed it.
    const told = async (userId: string) => (await pool.query("SELECT channel, subject FROM notifications WHERE workspace_id = $1 AND recipient_id = $2 AND event_type = $3 ORDER BY channel",
      [ws, userId, "books.statement_source_changed"])).rows;
    expect(await told(people.controller)).toEqual(expect.arrayContaining([expect.objectContaining({ subject: "Studio Interiors LLC · statements from Operational cash" })]));
    expect(await told(people.finance)).toEqual([]);
    expect(await told(people.viewer)).toEqual([]);

    const accrual = await pnl({ from: "2026-10-01", to: "2026-10-31" });
    expect(accrual.source.source).toBe("operational_cash");
    expect(accrual.statement.source).toBe("operational_cash");
    // Revenue from the tax invoices (net), by quotation; no project costs in October (the stock was bought for no project).
    expect(amounts(section(accrual.statement, "revenue").rows)).toEqual({ design_fees: ["20000.0000"], production: ["100000.0000"], variations: ["10000.0000"] });
    const cash = await pnl({ from: "2026-10-01", to: "2026-10-31", basis: "cash" });
    // 21,000 received with 5% inside → 20,000; 21,000 paid to a supplier whose bill was 5% VAT on goods → 20,000 materials.
    expect(amounts(section(cash.statement, "revenue").rows)).toEqual({ design_fees: ["20000.0000"] });
    expect(amounts(section(cash.statement, "cost_of_sales").rows)).toEqual({ materials: ["20000.0000"] });
    const cashFlow = await flow({ from: "2026-10-01", to: "2026-10-31" });
    expect(cashFlow.statement.accounts).toEqual([]);
    expect(amounts(section(cashFlow.statement, "cash_in").rows)).toEqual({ client_advances: ["21000.0000"] });
    expect(amounts(section(cashFlow.statement, "cash_out").rows)).toEqual({ supplier_payments: ["21000.0000"] });
    // Back to the Ledger for the other tests.
    await statements(people.finance).setSource(actor, ws, { legalEntityId: entity, source: "ledger", expectedVersion: 1, commandId: randomUUID() });
  });

  it("serves a firm without the Ledger from operational cash, with its region's financial year", async () => {
    const view = await statements(people.plain).source(actor, plainWs, {}) as StatementSourceView;
    expect(view).toMatchObject({ source: "operational_cash", chosen: false, company: { currency: "INR", fiscalYearStartMonth: 4, ledgerOn: false } });
    expect(view.options.find((option) => option.source === "ledger")!.available).toBe(false);
    const response = await statements(people.plain).profitAndLoss(actor, plainWs, {}) as StatementResponse<ProfitAndLossStatement>;
    expect(response.period.from.slice(5)).toBe("04-01");
    expect(response.statement.totals.netProfit).toEqual(["0.0000"]);
  });

  it("keeps statements to people with Ledger access and to their own workspace", async () => {
    await expect(pnl({}, people.sales)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(statements(people.other).profitAndLoss(actor, otherWs, { entity })).rejects.toThrow();
    const theirs = await statements(people.other).profitAndLoss(actor, otherWs, { from: "2026-10-01", to: "2026-10-31" }) as StatementResponse<ProfitAndLossStatement>;
    expect(theirs.company.id).toBe(otherEntity);
    expect(theirs.statement.totals.revenue).toEqual(["999.0000"]);
    expect(theirs.companies.map((company) => company.id)).toEqual([otherEntity]);
    // Under the app role, the firm's rows are invisible from the other tenant.
    const seen = await tenant(otherWs, people.other, (db) => db.query("SELECT count(*)::int AS count FROM books_statement_sources WHERE workspace_id = $1", [ws]));
    expect(seen.rows[0].count).toBe(0);
  });
});
