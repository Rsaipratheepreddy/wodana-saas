import { randomUUID } from "node:crypto";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WorkspaceAccessService } from "../../workspaces/workspace-access.service";
import type { AccountRole } from "../books-contract";
import { type DraftLine, type JournalDraft, postJournal, type PostOutcome } from "../ledger/ledger";
import { applyTemplate } from "../ledger/templates";
import type { AgeingReport, BalanceSheetReport, GeneralLedgerReport, JournalDetail, LedgerOverview, ProfitAndLossReport, TrialBalanceReport, VatReport } from "./report-types";
import { BooksReportsService } from "./reports.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Fixtures are committed in their own
// workspaces; every read runs through the service as the app role under forced RLS, exactly as the API does.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

const BOOKS_TABLES = ["books_settings", "books_accounts", "books_account_roles", "books_payment_accounts", "books_tax_codes", "books_journals",
  "books_journal_lines", "books_posting_issues", "books_manual_journals", "books_manual_journal_lines", "books_bill_captures"];

integration("Ledger reports on real Postgres (statements, VAT 201, ageing, drill-down, permissions, tenancy)", () => {
  let pool: Pool;
  const run = randomUUID().slice(0, 8);
  const ws = randomUUID(), otherWs = randomUUID();
  const people = { finance: randomUUID(), sales: randomUUID(), other: randomUUID() };
  const memberships = { finance: randomUUID(), sales: randomUUID(), other: randomUUID() };
  const roles = { finance: randomUUID(), sales: randomUUID(), other: randomUUID() };
  const entity = randomUUID(), second = randomUUID(), otherEntity = randomUUID();
  const clients = { villa: randomUUID(), office: randomUUID() };
  const vendors = { local: randomUUID(), abroad: randomUUID() };
  const project = randomUUID();
  const tax: Record<string, string> = {};
  const journals: Record<string, string> = {};
  let otherJournal = "";
  const sweeps: string[] = [];

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
  const as = (userId: string) => new BooksReportsService(
    new WorkspaceAccessService(database as never, { resolveActor: async () => ({ userId }) } as never),
    { runSweepNow: async (workspaceId: string) => { sweeps.push(workspaceId); } },
  );
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
  const october = { entity, from: "2026-10-01", to: "2026-10-31" };

  const posted = (outcome: PostOutcome) => {
    if (outcome.status !== "posted" && outcome.status !== "existing") throw new Error(`Not posted: ${JSON.stringify(outcome)}`);
    return outcome.journal.id;
  };
  const post = async (key: string, draft: Omit<JournalDraft, "currency" | "legalEntityId" | "source"> & { legalEntityId?: string; source?: Partial<JournalDraft["source"]> }) => {
    const source = { type: "client_invoice", id: randomUUID(), event: "issued", label: key, href: `/workspace/finance/client-invoices?invoice=${key}`, ...draft.source };
    journals[key] = posted(await tenant(ws, people.finance, (client) => postJournal(client, ws, { legalEntityId: entity, currency: "AED", ...draft, source })));
  };
  const line = (role: AccountRole, side: "debit" | "credit", amount: string, extra: Partial<DraftLine> = {}): DraftLine =>
    ({ account: { role }, side, amount, ...extra });
  const party = (type: "client" | "vendor", id: string) => ({ party: { type, id } });

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 6 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [key, id] of Object.entries(people)) {
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${key}-${run}@ledger-reports.test`, `${key} person`]);
      }
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      for (const workspace of [ws, otherWs]) {
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Ledger reports',$2,'AED',$3)", [workspace, `ledger-reports-${workspace.slice(0, 8)}`, people.finance]);
      }
      const company = `INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone)
        VALUES($1,$2,$3,$4,$4,'AE','AED','en-AE','Asia/Dubai')`;
      await client.query(company, [entity, ws, "MAIN", "Studio Interiors LLC"]);
      await client.query(company, [second, ws, "TRD", "Studio Trading LLC"]);
      await client.query(company, [otherEntity, otherWs, "OTHER", "Other Firm LLC"]);
      // Finance holds books.view; Sales holds nothing of the Ledger; the other tenant's finance person sees only theirs.
      for (const [key, workspace, permissions] of [["finance", ws, ["books.view", "books.manage"]], ["sales", ws, ["crm.leads.view"]], ["other", otherWs, ["books.view"]]] as const) {
        const k = key as keyof typeof people;
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [memberships[k], workspace, people[k]]);
        await client.query("INSERT INTO roles(id,workspace_id,code,name) VALUES($1,$2,$3,$3)", [roles[k], workspace, `ledger_${key}`]);
        await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])", [workspace, roles[k], permissions]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspace, memberships[k], roles[k]]);
      }
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$3,'person','Villa 12 Owner','villa 12 owner'),($2,$3,'organization','Office Co','office co')",
        [clients.villa, clients.office, ws]);
      for (const [id, code, name, country] of [[vendors.local, "LOCAL", "Dubai Timber", "AE"], [vendors.abroad, "ABROAD", "Milan Lighting", "IT"]]) {
        await client.query("INSERT INTO workspace_vendors(workspace_id,id,code,display_name,status,capabilities,created_by,updated_by) VALUES($1,$2,$3,$4,'active','{materials}',$5,$5)",
          [ws, id, code, name, people.finance]);
        await client.query(`INSERT INTO workspace_vendor_sites(workspace_id,vendor_id,id,name,site_type,country_code,is_primary,created_by,updated_by)
          VALUES($1,$2,$3,'Head office','office',$4,true,$5,$5)`, [ws, id, randomUUID(), country, people.finance]);
      }
      await client.query("INSERT INTO delivery_projects(id,workspace_id,case_id,name,reference,quote_id,started_at,created_by) VALUES($1,$2,$3,'Villa 12','PRJ-12','q1',now(),$4)",
        [project, ws, randomUUID(), people.finance]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    // The AE chart from 1 Dec 2025 for both companies here, IFRS for the other tenant; the Ledger on.
    for (const company of [entity, second]) await tenant(ws, people.finance, (db) => applyTemplate(db, ws, company, "AE", { startDate: "2025-12-01" }));
    await tenant(otherWs, people.other, (db) => applyTemplate(db, otherWs, otherEntity, "IFRS", { startDate: "2025-12-01" }));
    for (const [workspace, company, region] of [[ws, entity, "DXB"], [ws, second, "DXB"], [otherWs, otherEntity, null]] as const) {
      await tenant(workspace, people.finance, (db) => db.query(
        "UPDATE books_settings SET enabled = true, vat_region = $3, version = version + 1 WHERE workspace_id = $1 AND legal_entity_id = $2", [workspace, company, region]));
    }
    const codes = (await tenant(ws, people.finance, (db) => db.query<{ id: string; code: string; direction: string }>(
      "SELECT id, code, direction FROM books_tax_codes WHERE workspace_id = $1 AND legal_entity_id = $2", [ws, entity]))).rows;
    for (const row of codes) tax[`${row.code}_${row.direction}`] = row.id;

    // Last year: other income (retained earnings next year) and an opening receivable with no party.
    await post("OPEN-AR", { kind: "opening", eventDate: "2025-12-01", source: { type: "manual_journal", event: "approved" },
      lines: [line("ar_control", "debit", "1000"), line("opening_balance_equity", "credit", "1000")] });
    await post("FEE-2025", { eventDate: "2025-12-20", source: { type: "receipt", event: "verified" },
      lines: [{ account: { accountId: await accountId("1100") }, side: "debit", amount: "5000" }, line("revenue_other", "credit", "5000")] });
    // September: an expense (outside the October period).
    await post("SEP-EXP", { eventDate: "2026-09-15", source: { type: "petty_cash", event: "approved" },
      lines: [line("general_expense", "debit", "2000"), { account: { accountId: await accountId("1100") }, side: "credit", amount: "2000" }] });
    // October.
    await post("INV-1", { eventDate: "2026-10-05", lines: [line("ar_control", "debit", "105000", party("client", clients.villa)), line("revenue_project", "credit", "100000"),
      line("vat_output", "credit", "5000", { taxCodeId: tax.SR_sales, taxBase: "100000", taxRegion: "DXB" })] });
    await post("INV-2", { eventDate: "2026-10-06", lines: [line("ar_control", "debit", "52500", party("client", clients.office)), line("revenue_project", "credit", "50000"),
      line("vat_output", "credit", "2500", { taxCodeId: tax.SR_sales, taxBase: "50000", taxRegion: "AUH" })] });
    await post("INV-3", { eventDate: "2026-10-07", lines: [line("ar_control", "debit", "20000", party("client", clients.office)),
      line("revenue_project", "credit", "20000", { taxCodeId: tax.ZR_sales, taxBase: "20000" })] });
    await post("RCPT-1", { eventDate: "2026-10-08", source: { type: "receipt", event: "verified" },
      lines: [{ account: { accountId: await accountId("1100") }, side: "debit", amount: "105000" }, line("ar_control", "credit", "105000", party("client", clients.villa))] });
    // An advance before any invoice, tax point on payment: VAT 5/105 on the advance (no region: the company's).
    await post("RCPT-ADV", { eventDate: "2026-10-09", source: { type: "receipt", event: "verified" }, lines: [
      { account: { accountId: await accountId("1100") }, side: "debit", amount: "21000" }, line("client_advances", "credit", "21000", party("client", clients.villa)),
      line("vat_advance_contra", "debit", "1000"), line("vat_output", "credit", "1000", { taxCodeId: tax.SR_sales, taxBase: "20000" })] });
    await post("BILL-1", { eventDate: "2026-10-10", source: { type: "supplier_bill", event: "approved" }, lines: [line("cost_materials", "debit", "10000", { projectId: project }),
      line("vat_input", "debit", "500", { taxCodeId: tax.SR_purchases, taxBase: "10000" }), line("ap_control", "credit", "10500", party("vendor", vendors.local))] });
    await post("BILL-RC", { eventDate: "2026-10-11", source: { type: "supplier_bill", event: "approved" }, lines: [line("cost_subcontract", "debit", "8000"),
      line("ap_control", "credit", "8000", party("vendor", vendors.abroad)),
      line("vat_input", "debit", "400", { taxCodeId: tax.RC_purchases, taxBase: "8000" }), line("vat_output", "credit", "400", { taxCodeId: tax.RC_purchases, taxBase: "8000" })] });
    await post("BILL-NORC", { eventDate: "2026-10-12", source: { type: "supplier_bill", event: "approved" }, lines: [line("cost_materials", "debit", "3000"),
      line("ap_control", "credit", "3000", party("vendor", vendors.abroad))] });
    await post("PAY-1", { eventDate: "2026-10-13", source: { type: "supplier_payment", event: "paid" }, lines: [line("ap_control", "debit", "10500", party("vendor", vendors.local)),
      { account: { accountId: await accountId("1100") }, side: "credit", amount: "10500" }] });
    await post("CN-1", { eventDate: "2026-10-14", source: { type: "client_credit_note", event: "issued" }, lines: [line("revenue_project", "debit", "10000"),
      line("vat_output", "debit", "500", { taxCodeId: tax.SR_sales, taxBase: "10000", taxRegion: "AUH" }), line("ar_control", "credit", "10500", party("client", clients.office))] });
    // The second company and the other tenant each have their own invoice.
    await post("TRD-INV", { legalEntityId: second, eventDate: "2026-10-05", lines: [line("ar_control", "debit", "7777"), line("revenue_project", "credit", "7777")] });
    otherJournal = posted(await tenant(otherWs, people.other, (db) => postJournal(db, otherWs, { legalEntityId: otherEntity, eventDate: "2026-10-05", currency: "AED",
      source: { type: "client_invoice", id: randomUUID(), event: "issued" }, lines: [line("ar_control", "debit", "999"), line("revenue_project", "credit", "999")] })));
  });

  async function accountId(code: string, company = entity) {
    return (await tenant(ws, people.finance, (db) => db.query<{ id: string }>("SELECT id FROM books_accounts WHERE workspace_id = $1 AND legal_entity_id = $2 AND code = $3",
      [ws, company, code]))).rows[0].id;
  }

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // fixture teardown only: immutable rows go with their workspace
      const both = [ws, otherWs];
      for (const table of [...BOOKS_TABLES].reverse()) await client.query(`DELETE FROM ${table} WHERE workspace_id = ANY($1::uuid[])`, [both]);
      for (const table of ["document_sequences", "audit_events", "delivery_projects", "workspace_vendor_sites", "workspace_vendors", "crm_parties", "member_roles", "role_permissions", "roles",
        "workspace_memberships", "legal_entities"]) {
        await client.query(`DELETE FROM ${table} WHERE workspace_id = ANY($1::uuid[])`, [both]);
      }
      await client.query("DELETE FROM workspaces WHERE id = ANY($1::uuid[])", [both]);
      await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [Object.values(people)]);
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    await pool.end();
  });

  const report = <T>(code: string, query: Record<string, unknown> = october, userId = people.finance) => as(userId).report(actor, ws, code, query) as Promise<T>;

  it("balances the trial balance, with income and expenses from the year start and last year's result in retained earnings", async () => {
    const tb = await report<TrialBalanceReport>("trial-balance");
    expect(tb).toMatchObject({ balanced: true, fiscalYearStart: "2026-01-01", scope: { legalEntityId: entity, from: "2026-10-01", to: "2026-10-31" } });
    expect(tb.totals.debit).toBe(tb.totals.credit);
    const row = (code: string) => tb.rows.find((candidate) => candidate.code === code);
    expect(row("1200")).toMatchObject({ opening: "1000.0000", debit: "177500.0000", credit: "115500.0000", closing: "63000.0000" });
    // Last year's other income is not opened on its own account but carried in retained earnings.
    expect(row("4900")).toBeUndefined();
    expect(row("3100")).toMatchObject({ opening: "-5000.0000", closing: "-5000.0000" });
    expect(row("6100")).toMatchObject({ opening: "2000.0000", debit: "0.0000", closing: "2000.0000" });
    expect(row("2200")).toMatchObject({ closing: "-8400.0000" });
    expect(sweeps).toContain(ws);
  });

  it("works out the P&L for a period and the balance sheet with this year's earnings and retained earnings", async () => {
    const pnl = await report<ProfitAndLossReport>("profit-and-loss");
    expect(pnl.totals).toMatchObject({ revenue: "160000.0000", costOfSales: "21000.0000", grossProfit: "139000.0000", operatingExpenses: "0.0000", netProfit: "139000.0000" });
    expect(pnl.sections.find((section) => section.key === "cost_of_sales")?.lines.map((item) => item.code)).toEqual(["5100", "5200"]);
    const september = await report<ProfitAndLossReport>("profit-and-loss", { entity, from: "2026-09-01", to: "2026-09-30" });
    expect(september.totals).toMatchObject({ revenue: "0.0000", operatingExpenses: "2000.0000", netProfit: "-2000.0000" });

    const sheet = await report<BalanceSheetReport>("balance-sheet");
    expect(sheet).toMatchObject({ balanced: true, currentYearEarnings: "137000.0000", retainedEarnings: "5000.0000", fiscalYearStart: "2026-01-01" });
    expect(sheet.totals.assets).toBe(sheet.totals.liabilitiesAndEquity);
    // Assets: bank 5,000 - 2,000 + 105,000 + 21,000 - 10,500, receivables 63,000, VAT recoverable 900.
    expect(sheet.totals.assets).toBe("182400.0000");
    // Liabilities: payables 11,000, VAT output 8,400, VAT on advances (a debit) -1,000, client advances 21,000.
    expect(sheet.totals.liabilities).toBe("39400.0000");
  });

  it("fills the VAT 201 boxes from the journals: box 1 by emirate, 3, 4, 8 to 14, with the review list and drill-down", async () => {
    const vat = await report<VatReport>("vat");
    expect(vat.layout).toMatchObject({ code: "AE_VAT201", regionLabel: "Emirate" });
    const box = Object.fromEntries(vat.boxes.map((item) => [item.box, item]));
    expect(box["1a"]).toMatchObject({ amount: "40000.0000", vat: "2000.0000", adjustment: "0.0000" });
    expect(box["1b"]).toMatchObject({ amount: "120000.0000", vat: "6000.0000" });
    expect(box["1c"]).toMatchObject({ amount: "0.0000", vat: "0.0000" });
    expect(box["3"]).toMatchObject({ amount: "8000.0000", vat: "400.0000", adjustment: null });
    expect(box["4"]).toMatchObject({ amount: "20000.0000", vat: null });
    expect(box["8"]).toMatchObject({ amount: "188000.0000", vat: "8400.0000", computed: true });
    expect(box["9"]).toMatchObject({ amount: "10000.0000", vat: "500.0000" });
    expect(box["10"]).toMatchObject({ amount: "8000.0000", vat: "400.0000" });
    expect(box["11"]).toMatchObject({ amount: "18000.0000", vat: "900.0000" });
    expect(box["12"]).toMatchObject({ vat: "8400.0000" });
    expect(box["13"]).toMatchObject({ vat: "900.0000" });
    expect(box["14"]).toMatchObject({ vat: "7500.0000", computed: true });
    // The payable equals the VAT accounts: output 8,400 less input 900.
    const reasons = vat.review.map((item) => `${item.reason}:${item.sourceLabel}`).sort();
    expect(reasons).toEqual(["advance_split:RCPT-ADV", "foreign_supplier_without_reverse_charge:BILL-NORC", "zero_rate:INV-3"]);
    expect(vat.review.find((item) => item.reason === "foreign_supplier_without_reverse_charge")).toMatchObject({ partyName: "Milan Lighting", amount: "3000.0000" });

    const drill = await report<VatReport>("vat", { ...october, box: "1b" });
    expect(drill.lines?.map((item) => item.journalId).sort()).toEqual([journals["INV-1"], journals["RCPT-ADV"]].sort());
    expect(drill.lines?.[0]).toMatchObject({ accountCode: "2200", taxCode: "SR", region: "DXB" });
  });

  it("ages receivables and payables from the sub-ledger and reconciles them to the control accounts", async () => {
    const ar = await report<AgeingReport>("ar-ageing");
    expect(ar).toMatchObject({ side: "receivable", reconciled: true, unlinked: "1000.0000", control: { code: "1200", balance: "63000.0000" } });
    expect(ar.rows).toEqual([expect.objectContaining({ partyType: "client", partyId: clients.office, partyName: "Office Co", total: "62000.0000",
      buckets: { current: "0.0000", "1_30": "62000.0000", "31_60": "0.0000", "61_90": "0.0000", over_90: "0.0000" } })]);
    expect(ar.totals.total).toBe("62000.0000");
    // At 5 October only the first invoice is open, not yet due.
    const early = await report<AgeingReport>("ar-ageing", { entity, to: "2026-10-05" });
    expect(early.rows).toEqual([expect.objectContaining({ partyName: "Villa 12 Owner", buckets: expect.objectContaining({ current: "105000.0000" }) })]);
    const ap = await report<AgeingReport>("ap-ageing");
    expect(ap).toMatchObject({ side: "payable", reconciled: true, unlinked: "0.0000", control: { code: "2100", balance: "11000.0000" } });
    expect(ap.rows.map((row) => [row.partyName, row.total])).toEqual([["Milan Lighting", "11000.0000"]]);
  });

  it("drills from a report to an account's ledger, a journal and its source", async () => {
    const receivables = await accountId("1200");
    const ledger = await as(people.finance).account(actor, ws, receivables, { from: "2026-10-01", to: "2026-10-31" }) as GeneralLedgerReport;
    expect(ledger).toMatchObject({ account: { code: "1200", isControl: true }, opening: "1000.0000", closing: "63000.0000" });
    expect(ledger.rows.map((row) => row.balance)).toEqual(["106000.0000", "158500.0000", "178500.0000", "73500.0000", "63000.0000"]);
    expect(ledger.rows[0]).toMatchObject({ journalId: journals["INV-1"], partyName: "Villa 12 Owner", sourceHref: "/workspace/finance/client-invoices?invoice=INV-1" });
    const same = await report<GeneralLedgerReport>("general-ledger", { ...october, account: receivables });
    expect(same.closing).toBe(ledger.closing);

    const journal = await as(people.finance).journal(actor, ws, journals["INV-1"]) as JournalDetail;
    expect(journal.journal.number).toMatch(/^MAIN-JV-0*4$/);
    expect(journal.journal).toMatchObject({ sourceLabel: "INV-1", total: "105000.0000", reversedByJournalId: null });
    expect(journal.lines.map((item) => [item.accountCode, item.debit, item.credit, item.taxCode, item.partyName])).toEqual([
      ["1200", "105000.0000", "0.0000", null, "Villa 12 Owner"], ["4100", "0.0000", "100000.0000", null, null], ["2200", "0.0000", "5000.0000", "SR", null]]);
    const list = await as(people.finance).journals(actor, ws, { ...october, search: "BILL" });
    expect(list.journals.map((item) => item.sourceLabel).sort()).toEqual(["BILL-1", "BILL-NORC", "BILL-RC"]);
    // Project profit links to a project's journals: its company, since the Ledger started.
    const forProject = await as(people.finance).journals(actor, ws, { project, to: "2026-10-31" });
    expect(forProject).toMatchObject({ project, scope: { legalEntityId: entity, from: "2025-12-01" } });
    expect(forProject.journals.map((item) => item.sourceLabel)).toEqual(["BILL-1"]);
    const accounts = await as(people.finance).accounts(actor, ws, october);
    expect(accounts.accounts.find((item) => item.code === "1200")).toMatchObject({ closing: "63000.0000", roles: ["ar_control"], isControl: true });
  });

  it("keeps each company to its own books and returns CSV", async () => {
    const trading = await report<TrialBalanceReport>("trial-balance", { entity: second, from: "2026-10-01", to: "2026-10-31" });
    expect(trading.rows.map((row) => [row.code, row.closing])).toEqual([["1200", "7777.0000"], ["4100", "-7777.0000"]]);
    const file = await as(people.finance).reportFile(actor, ws, "vat", october);
    expect(file.fileName).toBe("MAIN-vat-2026-10-01-2026-10-31.csv");
    expect(file.body).toContain(`"14","Payable tax for the period","","7500.0000",""`);
    await expect(report("trial-balance", { entity, from: "2026-10-31", to: "2026-10-01" })).rejects.toThrow("The period ends before it starts");
    await expect(report("cash-flow")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("gives the overview's balances, and refuses without books.view", async () => {
    const overview = await as(people.finance).overview(actor, ws, { entity, to: "2026-10-31" }) as LedgerOverview;
    expect(overview.entities.map((item) => item.code).sort()).toEqual(["MAIN", "TRD"]);
    expect(overview).toMatchObject({ canManage: true, canPost: false, entity: { id: entity, currency: "AED", locale: "en-AE" }, vatPeriod: { from: "2026-10-01", to: "2026-12-31" },
      fiscalYear: { from: "2026-01-01", to: "2026-10-31" } });
    expect(overview.balances).toEqual({ cash: "118500.0000", receivables: "63000.0000", payables: "11000.0000", vatDue: "7500.0000", profitThisYear: "137000.0000" });
    expect(overview.vatMissingRegion).toBeNull();
    // Without the company's region, its regional sales are in no box: the overview says how many, with the region's name.
    await tenant(ws, people.finance, (db) => db.query("UPDATE books_settings SET vat_region = NULL WHERE workspace_id = $1 AND legal_entity_id = $2", [ws, entity]));
    try {
      const regionless = await as(people.finance).overview(actor, ws, { entity, to: "2026-10-31" }) as LedgerOverview;
      expect(regionless.vatMissingRegion).toEqual({ lines: expect.any(Number), label: "Emirate" });
      expect(regionless.vatMissingRegion!.lines).toBeGreaterThan(0);
    } finally {
      await tenant(ws, people.finance, (db) => db.query("UPDATE books_settings SET vat_region = 'DXB' WHERE workspace_id = $1 AND legal_entity_id = $2", [ws, entity]));
    }
    await expect(as(people.sales).report(actor, ws, "trial-balance", october)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(as(people.sales).overview(actor, ws, {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("never shows another tenant's companies or journals", async () => {
    await expect(report("trial-balance", { entity: otherEntity, from: "2026-10-01", to: "2026-10-31" })).rejects.toBeInstanceOf(NotFoundException);
    await expect(as(people.finance).journal(actor, ws, otherJournal)).rejects.toBeInstanceOf(NotFoundException);
    // A member of the other tenant can't read this workspace at all, and sees only its own company there.
    await expect(as(people.other).report(actor, ws, "trial-balance", october)).rejects.toBeInstanceOf(NotFoundException);
    const theirs = await as(people.other).report(actor, otherWs, "trial-balance", { from: "2026-10-01", to: "2026-10-31" }) as TrialBalanceReport;
    expect(theirs.entity.id).toBe(otherEntity);
    expect(theirs.totals.debit).toBe("999.0000");
  });
});
