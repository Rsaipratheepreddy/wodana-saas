import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Dec } from "../../catalog-core/decimal";
import { seedDefaultNotificationTemplates } from "../../notifications/default-templates";
import { readProjectCosts } from "../../project-core/project-money";
import { applyTemplate } from "../ledger/templates";
import { listIssues, retryIssue } from "./issues";
import { sweepWorkspace, type SweepResult } from "./sweep";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Source records are fixtures written
// directly (foreign keys off, as the A1 spec does); every sweep runs as the app role under forced RLS, as the service
// does. A UAE workspace with the Ledger on from 1 Oct 2026 (acceptance checks 1 to 8 and 10 of plan §6.21b).
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

const CLEAR_TABLES = [
  "books_journal_lines", "books_journals", "books_posting_issues", "books_manual_journal_lines", "books_manual_journals", "books_bill_captures", "books_tax_codes",
  "books_payment_accounts", "books_account_roles", "books_accounts", "books_settings", "notifications", "notification_templates", "audit_events",
  "hrms_crew_day_workers", "hrms_crew_days", "hrms_workers", "hrms_crews", "petty_cash_claims", "stock_movements", "stock_items", "stock_locations",
  "goods_receipt_lines", "goods_receipts", "supplier_payments", "payment_runs", "supplier_invoice_lines", "supplier_invoices", "purchase_order_lines",
  "purchase_orders", "workspace_vendors", "client_credit_notes", "client_invoice_lines", "client_invoices", "commercial_allocations", "commercial_receipts",
  "commercial_payments", "project_scope_seals", "delivery_projects", "document_sequences", "member_roles", "role_permissions", "roles", "workspace_memberships",
  "legal_entities",
];

integration("Ledger posting rules on real Postgres (P1 to P14, the sweep and its issues)", () => {
  let pool: Pool;
  const run = randomUUID().slice(0, 8);
  const ws = randomUUID();
  const people = { finance: randomUUID(), site: randomUUID() };
  const entity = randomUUID();
  const project = randomUUID(), otherProject = randomUUID();
  const caseA = randomUUID(), caseB = randomUUID(), caseC = randomUUID();
  const vendor = randomUUID(), order = randomUUID(), stockLine = randomUUID(), serviceLine = randomUUID();
  const warehouse = randomUUID(), item = randomUUID();

  async function tenant<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [ws, people.finance]);
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
  /** Source records as the modules leave them (fixture only: foreign keys and triggers off). */
  async function fixture(work: (client: PoolClient) => Promise<unknown>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await work(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  const sweep = (options: Parameters<typeof sweepWorkspace>[2] = {}) => tenant((client) => sweepWorkspace(client, ws, options));
  const clean = (result: SweepResult) => {
    expect(result.errors).toEqual([]);
    return result;
  };

  type Line = { code: string; debit: string; credit: string; projectId: string | null; tax: string | null; taxBase: string | null; partyType: string | null };
  async function journal(type: string, id: string, event: string) {
    const head = (await pool.query<{ id: string; number: string; kind: string; journalDate: string; late: boolean; total: string; reverses: string | null }>(
      `SELECT id, number, kind, journal_date::text AS "journalDate", late, total::text AS total, reverses_journal_id AS reverses FROM books_journals
        WHERE workspace_id = $1 AND source_type = $2 AND source_id = $3 AND source_event = $4`, [ws, type, id, event])).rows[0];
    if (!head) return null;
    const lines = (await pool.query<Line>(
      `SELECT account.code, line.debit::text AS debit, line.credit::text AS credit, line.project_id AS "projectId", tax.code AS tax, line.tax_base::text AS "taxBase",
              line.party_type AS "partyType"
         FROM books_journal_lines line JOIN books_accounts account ON account.id = line.account_id LEFT JOIN books_tax_codes tax ON tax.id = line.tax_code_id
        WHERE line.workspace_id = $1 AND line.journal_id = $2 ORDER BY line.position`, [ws, head.id])).rows;
    return { ...head, lines };
  }
  /** Net (debit − credit) per account code of one journal. */
  const net = (lines: Line[]) => {
    const sums = new Map<string, Dec>();
    for (const line of lines) sums.set(line.code, (sums.get(line.code) ?? Dec.ZERO).add(line.debit).sub(line.credit));
    return Object.fromEntries([...sums].filter(([, value]) => !value.isZero()).map(([code, value]) => [code, value.toFixed(2)]));
  };
  /** Balance (debit − credit) of an account code, optionally for one deal or project. */
  const balance = async (code: string, filter: { caseId?: string; projectId?: string } = {}) => Dec.of((await pool.query<{ total: string }>(
    `SELECT coalesce(sum(line.debit - line.credit), 0)::text AS total FROM books_journal_lines line JOIN books_accounts account ON account.id = line.account_id
      WHERE line.workspace_id = $1 AND account.code = $2 AND ($3::uuid IS NULL OR line.case_id = $3) AND ($4::uuid IS NULL OR line.project_id = $4)`,
    [ws, code, filter.caseId ?? null, filter.projectId ?? null])).rows[0].total).toFixed(2);
  const journalCount = async () => Number((await pool.query<{ count: string }>(`SELECT count(*) FROM books_journals WHERE workspace_id = $1`, [ws])).rows[0].count);

  const audit = (client: PoolClient, entityType: string, action: string, entityId: string, at: string) => client.query(
    `INSERT INTO audit_events (workspace_id, actor_user_id, source, action, entity_type, entity_id, correlation_id, occurred_at) VALUES ($1, $2, 'api', $3, $4, $5, $6, $7)`,
    [ws, people.finance, action, entityType, entityId, randomUUID(), at]);
  const invoice = (client: PoolClient, input: { id: string; caseId: string; paymentId: string; projectId: string; number: string; issueDate: string; issuedAt: string }) =>
    client.query(
      `INSERT INTO client_invoices (id, workspace_id, legal_entity_id, project_id, case_id, payment_id, quote_id, number, issue_date, due_date, currency, net, tax, total,
                                    prices_include_tax, milestone_title, customer_name, company_name, issued_by, issued_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'q', $7, $8, $8, 'AED', 100000, 5000, 105000, true, 'Advance', 'Aisha', 'Studio Interiors LLC', $9, $10);
       `, [input.id, ws, entity, input.projectId, input.caseId, input.paymentId, input.number, input.issueDate, people.finance, input.issuedAt])
      .then(() => client.query(`INSERT INTO client_invoice_lines (id, workspace_id, invoice_id, position, description, tax_rate, net, tax, total)
        VALUES ($1, $2, $3, 0, 'Advance', 5, 100000, 5000, 105000)`, [randomUUID(), ws, input.id]));
  const receipt = (client: PoolClient, input: { caseId: string; id: string; paymentId: string; verifiedAt: string; status?: string; rejectedAt?: string }) => client.query(
    `INSERT INTO commercial_receipts (workspace_id, case_id, id, sort_order, payment_id, legal_entity_id, currency, amount, source, status, reference, detail)
     VALUES ($1, $2, $3, 0, $4, $5, 'AED', 105000, $6, $7, 'TT-' || left($3, 4), $8::jsonb)`,
    [ws, input.caseId, input.id, input.paymentId, entity, input.rejectedAt ? "provider" : "manual", input.status ?? "finance_verified",
      JSON.stringify({ verifiedAt: input.verifiedAt, ...(input.rejectedAt ? { rejectedAt: input.rejectedAt, rejectionReason: "Bounced" } : {}) })]);
  const move = (client: PoolClient, input: { batch: string; kind: string; quantity: string; unitCost: string | null; projectId?: string | null; forProjectId?: string | null;
    receiptLineId?: string | null; movedOn: string; currency?: string; reason?: string }) => client.query(
    `INSERT INTO stock_movements (id, workspace_id, batch_id, item_id, location_id, project_id, kind, quantity, for_project_id, unit_cost, currency, receipt_line_id, moved_on,
                                  actor_id, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [randomUUID(), ws, input.batch, item, warehouse, input.projectId ?? null, input.kind, input.quantity, input.forProjectId ?? null, input.unitCost,
      input.unitCost === null ? null : input.currency ?? "AED", input.receiptLineId ?? null, input.movedOn, people.finance, input.reason ?? ""]);

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 8 });
    await pool.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Farah Finance'),($3,$4,'Sam Site')",
      [people.finance, `finance-${run}@posting.test`, people.site, `site-${run}@posting.test`]);
    await fixture(async (client) => {
      await client.query(`INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Posting firm',$2,'AED','Asia/Dubai',$3)`,
        [ws, `posting-${run}`, people.finance]);
      await client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone)
        VALUES($1,$2,'MAIN','Studio Interiors LLC','Studio Interiors LLC','AE','AED','en-AE','Asia/Dubai')`, [entity, ws]);
      await seedDefaultNotificationTemplates(client, ws);
      // The finance person manages the Ledger (books.manage) and hears about issues.
      const role = randomUUID(), membership = randomUUID();
      await client.query(`INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,'owner','Owner',true)`, [role, ws]);
      await client.query(`INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code IN ('books.view','books.manage')`, [ws, role]);
      await client.query(`INSERT INTO workspace_memberships(id,workspace_id,user_id,status,joined_at) VALUES($1,$2,$3,'active',now())`, [membership, ws, people.finance]);
      await client.query(`INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)`, [ws, membership, role]);
      // Two projects (deals A and B), the milestone plan and the sealed pricing (5% VAT).
      await client.query(`INSERT INTO delivery_projects(id,workspace_id,case_id,name,created_by) VALUES($1,$2,$3,'Villa 12',$5),($4,$2,$6,'Flat 3',$5)`,
        [project, ws, caseA, otherProject, people.finance, caseB]);
      await client.query(`INSERT INTO project_scope_seals(id,workspace_id,project_id,kind,quote_id,quote_number,revision_label,quote_hash,snapshot,content_hash,currency,total,
          accepted_at,accepted_by_name,sealed_by)
        VALUES($1,$2,$3,'baseline','qA',1,'R1','hash',$4::jsonb,repeat('a',64),'AED',105000,now(),'Aisha',$5)`,
        [randomUUID(), ws, project, JSON.stringify({ pricing: { total: "105000", taxes: [{ rate: "5", base: "100000", tax: "5000" }] } }), people.finance]);
      for (const [caseId, paymentId] of [[caseA, "m1"], [caseB, "m2"], [caseC, "m3"]]) {
        await client.query(`INSERT INTO commercial_payments(workspace_id,case_id,id,sort_order,title,amount,currency,status,source_quote_id,legal_entity_id,detail)
          VALUES($1,$2,$3,0,'Advance',105000,'AED','verified','qA',$4,$5::jsonb)`,
          [ws, caseId, paymentId, entity, JSON.stringify(paymentId === "m3" ? { invoice: { provider: "quickbooks", id: "QB-77", number: "1077" } } : {})]);
      }
      // Purchasing: a supplier, an order for stock and for outside work on the project.
      await client.query(`INSERT INTO workspace_vendors(workspace_id,id,code,display_name,created_by,updated_by) VALUES($1,$2,$3,'Timber Co',$4,$4)`,
        [ws, vendor, `V-${run.toUpperCase()}`, people.finance]);
      await client.query(`INSERT INTO purchase_orders(id,workspace_id,number,legal_entity_id,vendor_id,currency,payment_terms,status,approved_at,created_by)
        VALUES($1,$2,'PO-0001',$3,$4,'AED','upfront','approved',now(),$5)`, [order, ws, entity, vendor, people.finance]);
      await client.query(`INSERT INTO purchase_order_lines(id,workspace_id,order_id,position,source,description,quantity,unit_price,net,tax,total,project_id,work_order_id)
        VALUES($1,$2,$3,0,'free','Oak boards',10,100,1000,50,1050,$4,NULL),($5,$2,$3,1,'free','Joinery outside work',1,2000,2000,100,2100,$4,$6)`,
        [stockLine, ws, order, project, serviceLine, randomUUID()]);
      await client.query(`INSERT INTO stock_locations(id,workspace_id,kind,name) VALUES($1,$2,'warehouse','Main store')`, [warehouse, ws]);
      await client.query(`INSERT INTO stock_items(id,workspace_id,name,unit,normal_key) VALUES($1,$2,'Oak board','nos',$3)`, [item, ws, `oak-${run}`]);
    });
    // The UAE chart, on from 1 Oct 2026.
    await tenant(async (client) => {
      await applyTemplate(client, ws, entity, "AE", { actorId: people.finance, startDate: "2026-10-01" });
      await client.query(`UPDATE books_settings SET enabled = true, version = version + 1 WHERE workspace_id = $1 AND legal_entity_id = $2`, [ws, entity]);
    });
  }, 60_000);

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // fixture teardown only
      for (const table of CLEAR_TABLES) await client.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [ws]);
      await client.query("DELETE FROM workspaces WHERE id = $1", [ws]);
      await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [Object.values(people)]);
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    await pool.end();
  });

  it("2: an invoice of AED 105,000 posts Dr AR 105,000 / Cr revenue 100,000 / Cr VAT 5,000", async () => {
    const id = randomUUID();
    await fixture((client) => invoice(client, { id, caseId: caseB, paymentId: "m2", projectId: otherProject, number: "MAIN-INV-2026-00002", issueDate: "2026-10-05",
      issuedAt: "2026-10-05T08:00:00Z" }));
    clean(await sweep());
    const posted = (await journal("client_invoice", id, "issued"))!;
    expect(net(posted.lines)).toEqual({ "1200": "105000.00", "4100": "-100000.00", "2200": "-5000.00" });
    expect(posted).toMatchObject({ kind: "auto", journalDate: "2026-10-05", late: false, total: "105000.0000" });
    expect(posted.lines.find((line) => line.code === "2200")).toMatchObject({ tax: "SR", taxBase: "100000.0000" });
    expect(posted.lines.find((line) => line.code === "1200")).toMatchObject({ partyType: null, projectId: otherProject });

    // 3a: a receipt after the invoice clears receivables.
    await fixture((client) => receipt(client, { caseId: caseB, id: randomUUID(), paymentId: "m2", verifiedAt: "2026-10-06T06:00:00.000Z" }));
    clean(await sweep());
    expect(await balance("1200", { caseId: caseB })).toBe("0.00");
    expect(await balance("1100")).toBe("105000.00");
  });

  it("3: an advance goes to client advances with 5/105 VAT; once invoiced VAT counts once and advances and AR return to 0", async () => {
    const receiptId = randomUUID(), invoiceId = randomUUID();
    await fixture((client) => receipt(client, { caseId: caseA, id: receiptId, paymentId: "m1", verifiedAt: "2026-10-02T06:00:00.000Z" }));
    clean(await sweep());
    const advance = (await journal("receipt", `${caseA}:${receiptId}`, "verified"))!;
    expect(net(advance.lines)).toEqual({ "1100": "105000.00", "2300": "-105000.00", "2210": "5000.00", "2200": "-5000.00" });
    expect(advance.lines.find((line) => line.code === "2200")).toMatchObject({ tax: "SR", taxBase: "100000.0000" });

    await fixture((client) => invoice(client, { id: invoiceId, caseId: caseA, paymentId: "m1", projectId: project, number: "MAIN-INV-2026-00001", issueDate: "2026-10-04",
      issuedAt: "2026-10-04T08:00:00Z" }));
    clean(await sweep());
    const invoiced = (await journal("client_invoice", invoiceId, "issued"))!;
    expect(net(invoiced.lines)).toEqual({ "4100": "-100000.00", "2210": "-5000.00", "2300": "105000.00" });
    for (const code of ["2300", "1200", "2210"]) expect(await balance(code, { caseId: caseA })).toBe("0.00");
    expect(await balance("2200", { caseId: caseA })).toBe("-5000.00");
  });

  it("4: a credit note reverses revenue and VAT; posted journals never change", async () => {
    const invoiceId = (await pool.query<{ id: string }>(`SELECT id FROM client_invoices WHERE workspace_id = $1 AND case_id = $2`, [ws, caseB])).rows[0].id;
    const creditId = randomUUID();
    await fixture(async (client) => {
      await client.query(`INSERT INTO client_credit_notes(id,workspace_id,legal_entity_id,invoice_id,number,issue_date,currency,net,tax,total,reason,issued_by,issued_at)
        VALUES($1,$2,$3,$4,'MAIN-CN-2026-00001','2026-10-07','AED',100000,5000,105000,'Wrong client',$5,'2026-10-07T08:00:00Z')`, [creditId, ws, entity, invoiceId, people.finance]);
      await client.query(`UPDATE client_invoices SET status = 'credited' WHERE workspace_id = $1 AND id = $2`, [ws, invoiceId]);
    });
    clean(await sweep());
    const credit = (await journal("client_credit_note", creditId, "issued"))!;
    const original = (await journal("client_invoice", invoiceId, "issued"))!;
    expect(credit).toMatchObject({ kind: "reversal", reverses: original.id, journalDate: "2026-10-07" });
    expect(net(credit.lines)).toEqual({ "1200": "-105000.00", "4100": "100000.00", "2200": "5000.00" });
    await expect(tenant((client) => client.query(`UPDATE books_journals SET description = 'x' WHERE id = $1`, [credit.id]))).rejects.toThrow();
    await expect(tenant((client) => client.query(`DELETE FROM books_journal_lines WHERE journal_id = $1`, [credit.id]))).rejects.toThrow();
  });

  let billB = "";
  it("5: a bill with order lines, a charge and a reverse-charge line; cancelling reverses it", async () => {
    const bill = randomUUID();
    billB = randomUUID();
    await fixture(async (client) => {
      for (const [id, number] of [[bill, "TC-101"], [billB, "TC-102"]]) {
        await client.query(`INSERT INTO supplier_invoices(id,workspace_id,vendor_id,legal_entity_id,number,invoice_date,currency,net,tax,total,status,approved_at,created_by)
          VALUES($1,$2,$3,$4,$5,'2026-10-08','AED',0,0,0,'approved','2026-10-08T09:00:00Z',$6)`, [id, ws, vendor, entity, number, people.finance]);
      }
      const line = `INSERT INTO supplier_invoice_lines(id,workspace_id,invoice_id,position,order_line_id,project_id,description,quantity,unit_price,tax_rate,net,tax,total,tax_code)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`;
      await client.query(line, [randomUUID(), ws, bill, 0, stockLine, null, "Oak boards", 10, 105, 5, 1050, 52.5, 1102.5, null]);
      await client.query(line, [randomUUID(), ws, bill, 1, null, project, "Delivery to site", 1, 200, 5, 200, 10, 210, null]);
      await client.query(line, [randomUUID(), ws, bill, 2, null, null, "Design software (import)", 1, 1000, 0, 1000, 0, 1000, "RC"]);
      await client.query(line, [randomUUID(), ws, billB, 0, serviceLine, null, "Joinery outside work", 1, 2100, 5, 2100, 105, 2205, null]);
    });
    clean(await sweep());
    const approved = (await journal("supplier_bill", bill, "approved"))!;
    expect(net(approved.lines)).toEqual({ "2110": "1000.00", "5500": "50.00", "1210": "112.50", "5600": "200.00", "6100": "1000.00", "2200": "-50.00", "2100": "-2312.50" });
    expect(approved.lines.filter((line) => line.tax === "RC").map((line) => line.code).sort()).toEqual(["1210", "2200"]);
    expect(approved.lines.find((line) => line.code === "5500")).toMatchObject({ projectId: project });

    await fixture(async (client) => {
      await client.query(`UPDATE supplier_invoices SET status = 'cancelled', cancel_reason = 'Duplicate' WHERE workspace_id = $1 AND id = $2`, [ws, bill]);
      await audit(client, "supplier_invoice", "supplier_invoice.cancelled", bill, "2026-10-09T08:00:00Z");
    });
    clean(await sweep());
    const cancelled = (await journal("supplier_bill", bill, "cancelled"))!;
    expect(cancelled).toMatchObject({ kind: "reversal", reverses: approved.id, journalDate: "2026-10-09" });
    expect(net(cancelled.lines)).toEqual(Object.fromEntries(Object.entries(net(approved.lines)).map(([code, value]) => [code, Dec.of(value).neg().toFixed(2)])));
    expect(net((await journal("supplier_bill", billB, "approved"))!.lines)).toEqual({ "2110": "2000.00", "5500": "100.00", "1210": "105.00", "2100": "-2205.00" });
  });

  it("6: payments, their reversal, payment runs, and a reversal whose payment was before the start date", async () => {
    const paid = randomUUID(), inRun = randomUUID(), early = randomUUID(), runId = randomUUID();
    await fixture(async (client) => {
      await client.query(`INSERT INTO payment_runs(id,workspace_id,number,status,created_by,prepared_by) VALUES($1,$2,1,'draft',$3,$3)`, [runId, ws, people.finance]);
      const payment = `INSERT INTO supplier_payments(id,workspace_id,vendor_id,legal_entity_id,paid_on,currency,amount,method,reference,bank_account_id,run_id,status,reverse_reason,created_by)
        VALUES($1,$2,$3,$4,$5,'AED',$6,'bank',$7,$8,$9,$10,$11,$12)`;
      await client.query(payment, [paid, ws, vendor, entity, "2026-10-10", 2205, "TT-9", randomUUID(), null, "reversed", "Wrong account", people.finance]);
      await client.query(payment, [inRun, ws, vendor, entity, "2026-10-12", 500, "RUN-1", randomUUID(), runId, "recorded", null, people.finance]);
      await client.query(payment, [early, ws, vendor, entity, "2026-09-25", 300, "TT-1", randomUUID(), null, "reversed", "Bounced", people.finance]);
      await audit(client, "supplier_payment", "supplier_payment.reversed", paid, "2026-10-11T08:00:00Z");
      await audit(client, "supplier_payment", "supplier_payment.reversed", early, "2026-10-03T08:00:00Z");
    });
    clean(await sweep());
    expect(net((await journal("supplier_payment", paid, "paid"))!.lines)).toEqual({ "2100": "2205.00", "1100": "-2205.00" });
    expect(await journal("supplier_payment", paid, "reversed")).toMatchObject({ kind: "reversal", journalDate: "2026-10-11" });
    expect((await journal("supplier_payment", inRun, "paid"))!.lines.map((line) => line.code)).toEqual(["2100", "1100"]);
    expect((await pool.query(`SELECT source_label FROM books_journals WHERE workspace_id = $1 AND source_id = $2`, [ws, inRun])).rows[0].source_label).toBe("Timber Co PR-0001");
    // Paid before the Ledger started (in the opening balances), reversed after: the payment comes back.
    expect(await journal("supplier_payment", early, "paid")).toBeNull();
    const undone = (await journal("supplier_payment", early, "reversed"))!;
    expect(undone).toMatchObject({ kind: "auto", journalDate: "2026-10-03" });
    expect(net(undone.lines)).toEqual({ "1100": "300.00", "2100": "-300.00" });
  });

  it("7: stock received, issued to a project, allocated within its batch; no cost and another currency wait as issues", async () => {
    const grn = randomUUID(), grnLine = randomUUID(), projectGrnLine = randomUUID(), serviceGrn = randomUUID();
    const batches = { received: randomUUID(), issued: randomUUID(), allocated: randomUUID(), projectReceived: randomUUID(), uncosted: randomUUID(), foreign: randomUUID() };
    await fixture(async (client) => {
      await client.query(`INSERT INTO goods_receipts(id,workspace_id,number,order_id,location_id,received_on,received_by) VALUES($1,$2,1,$3,$4,'2026-10-08',$5),($6,$2,2,$3,$4,'2026-10-09',$5)`,
        [grn, ws, order, warehouse, people.site, serviceGrn]);
      await client.query(`INSERT INTO goods_receipt_lines(id,workspace_id,receipt_id,order_line_id,received,accepted,rejected,pending) VALUES($1,$2,$3,$4,10,10,0,0),($5,$2,$3,$4,5,5,0,0),
        ($6,$2,$7,$8,1,1,0,0)`, [grnLine, ws, grn, stockLine, projectGrnLine, randomUUID(), serviceGrn, serviceLine]);
      await move(client, { batch: batches.received, kind: "receive", quantity: "10", unitCost: "20", receiptLineId: grnLine, movedOn: "2026-10-08" });
      await move(client, { batch: batches.issued, kind: "issue", quantity: "-4", unitCost: "20", forProjectId: project, movedOn: "2026-10-09" });
      await move(client, { batch: batches.allocated, kind: "allocate", quantity: "-3", unitCost: "20", movedOn: "2026-10-09" });
      await move(client, { batch: batches.allocated, kind: "allocate", quantity: "3", unitCost: "20", projectId: project, movedOn: "2026-10-09" });
      await move(client, { batch: batches.projectReceived, kind: "receive", quantity: "5", unitCost: "100", projectId: project, forProjectId: project, receiptLineId: projectGrnLine,
        movedOn: "2026-10-09" });
      await move(client, { batch: batches.uncosted, kind: "adjust", quantity: "1", unitCost: null, movedOn: "2026-10-09", reason: "Found in store" });
      await move(client, { batch: batches.foreign, kind: "adjust", quantity: "1", unitCost: "5", currency: "USD", movedOn: "2026-10-09", reason: "Count" });
    });
    clean(await sweep());
    expect(net((await journal("stock_batch", batches.received, "moved"))!.lines)).toEqual({ "1300": "200.00", "2110": "-200.00" });
    const issued = (await journal("stock_batch", batches.issued, "moved"))!;
    expect(net(issued.lines)).toEqual({ "1300": "-80.00", "5100": "80.00" });
    expect(issued.lines.find((line) => line.code === "5100")).toMatchObject({ projectId: project });
    expect(net((await journal("stock_batch", batches.allocated, "moved"))!.lines)).toEqual({ "1300": "-60.00", "5100": "60.00" });
    expect(net((await journal("stock_batch", batches.projectReceived, "moved"))!.lines)).toEqual({ "5100": "500.00", "2110": "-500.00" });
    // 9: services and outside work received.
    expect(net((await journal("goods_receipt", serviceGrn, "received"))!.lines)).toEqual({ "5200": "2000.00", "2110": "-2000.00" });
    expect(await journal("goods_receipt", grn, "received")).toBeNull();
    const issues = await tenant((client) => listIssues(client, ws));
    expect(issues.filter((row) => row.sourceType === "stock_batch").map((row) => [row.sourceId, row.code]).sort())
      .toEqual([[batches.uncosted, "no_cost"], [batches.foreign, "currency_mismatch"]].sort());
  });

  it("8: petty cash approved and reimbursed; labour posts, and a rate change posts only the difference", async () => {
    const claim = randomUUID(), crew = randomUUID(), day = randomUUID(), [one, two] = [randomUUID(), randomUUID()];
    await fixture(async (client) => {
      await client.query(`INSERT INTO petty_cash_claims(id,workspace_id,number,project_id,spent_on,amount,currency,description,category,no_receipt_reason,status,claimed_by,
          submitted_at,decided_by,decided_at,reimbursed_by,reimbursed_at)
        VALUES($1,$2,7,$3,'2026-10-11',150,'AED','Diesel for the generator','transport','Fuel station receipt lost','reimbursed',$4,'2026-10-11T06:00:00Z',$5,
          '2026-10-12T06:00:00Z',$5,'2026-10-13T06:00:00Z')`, [claim, ws, project, people.site, people.finance]);
      await client.query(`INSERT INTO hrms_crews(id,workspace_id,name,trade) VALUES($1,$2,'Carpentry A','carpentry')`, [crew, ws]);
      await client.query(`INSERT INTO hrms_workers(id,workspace_id,crew_id,name,trade) VALUES($1,$2,$3,'Ravi','carpentry'),($4,$2,$3,'Anil','carpentry')`, [one, ws, crew, two]);
      await client.query(`INSERT INTO hrms_crew_days(id,workspace_id,crew_id,project_id,work_date,status,marked_by,marked_membership_id,decided_by,decided_at)
        VALUES($1,$2,$3,$4,'2026-10-14','approved',$5,$6,$7,now())`, [day, ws, crew, project, people.site, randomUUID(), people.finance]);
      await client.query(`INSERT INTO hrms_crew_day_workers(workspace_id,crew_day_id,worker_id,presence,day_rate,currency) VALUES($1,$2,$3,'present',300,'AED'),($1,$2,$4,'present',300,'AED')`,
        [ws, day, one, two]);
    });
    clean(await sweep());
    const approved = (await journal("petty_cash", claim, "approved"))!;
    expect(approved.journalDate).toBe("2026-10-12");
    expect(net(approved.lines)).toEqual({ "5400": "150.00", "2120": "-150.00" });
    expect(approved.lines.find((line) => line.code === "2120")).toMatchObject({ partyType: "employee" });
    expect(net((await journal("petty_cash", claim, "reimbursed"))!.lines)).toEqual({ "2120": "150.00", "1150": "-150.00" });
    expect(net((await journal("labour", `crew:${day}:1`, "costed"))!.lines)).toEqual({ "5300": "600.00", "6300": "-600.00" });

    await fixture((client) => client.query(`UPDATE hrms_crew_day_workers SET day_rate = 350 WHERE workspace_id = $1 AND worker_id = $2`, [ws, two]));
    clean(await sweep());
    expect(net((await journal("labour", `crew:${day}:2`, "recosted"))!.lines)).toEqual({ "5300": "50.00", "6300": "-50.00" });
    const before = await journalCount();
    clean(await sweep());
    expect(await journalCount()).toBe(before);
    expect(await balance("5300", { projectId: project })).toBe("650.00");
  });

  it("10: project cost in the Ledger equals the Money tab's spent; revenue equals invoices net of credits", async () => {
    const money = await tenant((client) => readProjectCosts(client, ws, project));
    const ledger = (await pool.query<{ total: string }>(
      `SELECT coalesce(sum(line.debit - line.credit), 0)::text AS total FROM books_journal_lines line
         JOIN books_accounts account ON account.id = line.account_id AND account.type = 'expense'
        WHERE line.workspace_id = $1 AND line.project_id = $2`, [ws, project])).rows[0].total;
    expect(money.uncosted).toBe(0);
    expect(Dec.of(ledger).toFixed(2)).toBe(Dec.of(money.total).toFixed(2));
    expect(Dec.of(money.total).toFixed(2)).toBe("3540.00");
    const invoiced = (await pool.query<{ net: string }>(
      `SELECT (coalesce((SELECT sum(net) FROM client_invoices WHERE workspace_id = $1), 0) - coalesce((SELECT sum(net) FROM client_credit_notes WHERE workspace_id = $1), 0))::text AS net`,
      [ws])).rows[0].net;
    expect(await balance("4100")).toBe(Dec.of(invoiced).neg().toFixed(2));
  });

  it("4 and 10: reversed receipts (still an advance, or already invoiced) and a reversed delivery", async () => {
    const caseD = randomUUID(), caseE = randomUUID(), early = randomUUID(), moved = randomUUID(), invoiceId = randomUUID();
    await fixture(async (client) => {
      for (const [caseId, paymentId] of [[caseD, "m4"], [caseE, "m5"]]) {
        await client.query(`INSERT INTO commercial_payments(workspace_id,case_id,id,sort_order,title,amount,currency,status,source_quote_id,legal_entity_id)
          VALUES($1,$2,$3,0,'Advance',105000,'AED','pending','qA',$4)`, [ws, caseId, paymentId, entity]);
      }
      await receipt(client, { caseId: caseD, id: early, paymentId: "m4", verifiedAt: "2026-10-16T06:00:00.000Z", status: "rejected", rejectedAt: "2026-10-17T06:00:00.000Z" });
      await receipt(client, { caseId: caseE, id: moved, paymentId: "m5", verifiedAt: "2026-10-16T06:00:00.000Z", status: "rejected", rejectedAt: "2026-10-18T06:00:00.000Z" });
      await invoice(client, { id: invoiceId, caseId: caseE, paymentId: "m5", projectId: project, number: "MAIN-INV-2026-00003", issueDate: "2026-10-17", issuedAt: "2026-10-17T06:00:00Z" });
      const serviceGrn = (await client.query<{ id: string }>(`SELECT id FROM goods_receipts WHERE workspace_id = $1 AND number = 2`, [ws])).rows[0].id;
      await client.query(`UPDATE goods_receipts SET reversed_at = '2026-10-19T06:00:00Z', reversed_by = $2, reverse_reason = 'Wrong order' WHERE id = $1`, [serviceGrn, people.site]);
    });
    clean(await sweep());
    const advanced = (await journal("receipt", `${caseD}:${early}`, "verified"))!;
    const undone = (await journal("receipt", `${caseD}:${early}`, "reversed"))!;
    expect(undone).toMatchObject({ kind: "reversal", reverses: advanced.id, journalDate: "2026-10-17" });
    for (const code of ["1200", "2300", "2210", "2200"]) expect(await balance(code, { caseId: caseD })).toBe("0.00");
    // Moved into receivables by the invoice, then reversed: the client owes it again; VAT stays counted once.
    expect(net((await journal("receipt", `${caseE}:${moved}`, "reversed"))!.lines)).toEqual({ "1200": "105000.00", "1130": "-105000.00" });
    expect(await balance("1200", { caseId: caseE })).toBe("105000.00");
    expect(await balance("2300", { caseId: caseE })).toBe("0.00");
    expect(await balance("2210", { caseId: caseE })).toBe("0.00");
    expect(await balance("2200", { caseId: caseE })).toBe("-5000.00");
    // The reversed delivery comes off the project, as on its Money tab.
    const money = await tenant((client) => readProjectCosts(client, ws, project));
    expect(Dec.of(money.total).toFixed(2)).toBe("1540.00");
    expect(await balance("5200", { projectId: project })).toBe("0.00");
  });

  it("a milestone invoiced outside Wodana waits as external_invoice, notifies once, and posts when retried after it's fixed", async () => {
    const receiptId = randomUUID();
    await fixture((client) => receipt(client, { caseId: caseC, id: receiptId, paymentId: "m3", verifiedAt: "2026-10-03T06:00:00.000Z" }));
    clean(await sweep());
    const sourceId = `${caseC}:${receiptId}`;
    let open = (await tenant((client) => listIssues(client, ws))).find((row) => row.sourceId === sourceId)!;
    expect(open).toMatchObject({ code: "external_invoice", attempts: 1, sourceEvent: "verified" });
    // Not tried again within the retry interval.
    clean(await sweep());
    open = (await tenant((client) => listIssues(client, ws))).find((row) => row.sourceId === sourceId)!;
    expect(open.attempts).toBe(1);
    const notices = await pool.query(`SELECT 1 FROM notifications WHERE workspace_id = $1 AND recipient_id = $2 AND event_type = 'books.posting_blocked'
      AND idempotency_key LIKE $3`, [ws, people.finance, `books.posting_blocked:${open.id}:%`]);
    expect(notices.rowCount).toBe(1);

    await fixture((client) => client.query(`UPDATE commercial_payments SET detail = '{}' WHERE workspace_id = $1 AND case_id = $2`, [ws, caseC]));
    expect(await tenant((client) => retryIssue(client, ws, open.id))).toBe(true);
    clean(await sweep());
    expect((await tenant((client) => listIssues(client, ws))).some((row) => row.sourceId === sourceId)).toBe(false);
    expect(await journal("receipt", sourceId, "verified")).not.toBeNull();
    expect((await pool.query(`SELECT resolved_at FROM books_posting_issues WHERE id = $1`, [open.id])).rows[0].resolved_at).not.toBeNull();
  });

  it("1: three sweeps give the same journals, numbered gap-free, even with sweeps at the same time", async () => {
    const count = await journalCount();
    for (let index = 0; index < 3; index += 1) clean(await sweep());
    expect(await journalCount()).toBe(count);

    // New payments, two sweeps at once: one runs, the other finds it busy; nothing posts twice.
    await fixture(async (client) => {
      for (let index = 0; index < 4; index += 1) {
        await client.query(`INSERT INTO supplier_payments(id,workspace_id,vendor_id,legal_entity_id,paid_on,currency,amount,method,reference,bank_account_id,created_by)
          VALUES($1,$2,$3,$4,'2026-10-15','AED',$5,'bank',$6,$7,$8)`, [randomUUID(), ws, vendor, entity, 100 + index, `TT-C${index}`, randomUUID(), people.finance]);
      }
    });
    const results = await Promise.all([sweep(), sweep()]);
    for (const result of results) expect(result.errors).toEqual([]);
    clean(await sweep());
    expect(await journalCount()).toBe(count + 4);
    const numbers = (await pool.query<{ number: string }>(`SELECT number FROM books_journals WHERE workspace_id = $1`, [ws])).rows
      .map((row) => Number(row.number.split("-").pop())).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, index) => index + 1));
    // Every journal balances.
    const unbalanced = await pool.query(`SELECT journal.id FROM books_journals journal JOIN books_journal_lines line ON line.journal_id = journal.id
      WHERE journal.workspace_id = $1 GROUP BY journal.id, journal.total HAVING sum(line.debit) <> sum(line.credit) OR sum(line.debit) <> journal.total`, [ws]);
    expect(unbalanced.rowCount).toBe(0);
  });
});
