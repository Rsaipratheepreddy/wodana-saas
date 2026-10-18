import { randomUUID } from "node:crypto";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toolContext } from "../ai-tools/ai-tool-context";
import { AiToolRegistry } from "../ai-tools/ai-tools.registry";
import { validateToolInput } from "../ai-tools/tool-kit";
import type { ToolServices } from "../ai-tools/tool-services";
import { postJournal, type DraftLine } from "../books/ledger/ledger";
import { applyTemplate } from "../books/ledger/templates";
import { ProjectProfitService } from "../books/project/project-profit.service";
import { addDays, dayIn } from "./project-cash-flow";
import { ProjectFinanceService } from "./project-finance.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Fixtures are committed in their own
// workspaces and removed at the end; every read runs as the app role under forced RLS, as the API does.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

const FIXTURE_TABLES = ["stock_movements", "goods_receipt_lines", "goods_receipts", "stock_items", "stock_locations", "work_orders", "supplier_payment_allocations",
  "supplier_payments", "supplier_invoice_lines", "supplier_invoices", "purchase_order_lines", "purchase_orders", "site_report_workforce", "site_reports",
  "workspace_labour_rates", "petty_cash_claims", "client_invoices", "commercial_allocations", "commercial_receipts", "commercial_payments", "commercial_cases",
  "commercial_quote_lines", "commercial_quotes", "project_boq_lines", "project_packages", "project_scope_seals", "project_assignments", "delivery_projects",
  "pre_project_cases", "crm_opportunities", "crm_parties", "workspace_vendors", "workspace_quotation_settings", "workspace_purchasing_settings",
  "workspace_memberships", "document_sequences", "audit_events", "legal_entities"];
const BOOKS_TABLES = ["books_journal_lines", "books_journals", "books_posting_issues", "books_tax_codes", "books_payment_accounts", "books_account_roles", "books_accounts",
  "books_settings"];

integration("project P&L, cash flow and profitability on real Postgres", () => {
  let pool: Pool;
  const run = randomUUID().slice(0, 8);
  const ws = randomUUID(), otherWs = randomUUID();
  const people = { manager: randomUUID(), lead: randomUUID(), designer: randomUUID(), other: randomUUID() };
  const membership = { lead: randomUUID(), designer: randomUUID() };
  const entity = randomUUID(), vendor = randomUUID(), location = randomUUID(), item = randomUUID();
  const villa = randomUUID(), caseId = randomUUID(), otherProject = randomUUID();
  const pkg = { kitchen: randomUUID(), stone: randomUUID(), paint: randomUUID() };
  const boq = { cabinets: randomUUID(), marble: randomUUID(), painting: randomUUID(), lighting: randomUUID(), wardrobe: randomUUID() };
  const seals = { baseline: randomUUID(), variation: randomUUID() };
  const order = { marble: randomUUID(), painting: randomUUID() };
  const line = { marble: randomUUID(), painting: randomUUID() };
  // Due dates are kept relative to today in the workspace's time zone, so the 90-day view always has them.
  const today = dayIn(new Date(), "Asia/Dubai");

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
  const access = (userId: string, permissions: string[]) => ({
    asMember: (_a: unknown, workspaceId: string, work: (c: PoolClient, u: { userId: string }) => unknown) => tenant(workspaceId, userId, (client) => Promise.resolve(work(client, { userId }))),
    hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code),
    withAnyPermission: async (_a: unknown, workspaceId: string, codes: string[], work: (c: PoolClient, u: { userId: string }) => unknown) => {
      if (!codes.some((code) => permissions.includes(code))) throw new ForbiddenException(`Any permission required: ${codes.join(", ")}`);
      return tenant(workspaceId, userId, (client) => Promise.resolve(work(client, { userId })));
    },
  }) as never;
  const as = {
    manager: () => new ProjectFinanceService(access(people.manager, ["projects.manage", "projects.view", "commercial.costs.view"])),
    lead: () => new ProjectFinanceService(access(people.lead, ["projects.view", "projects.costs.view"])),
    designer: () => new ProjectFinanceService(access(people.designer, ["projects.view"])),
    other: () => new ProjectFinanceService(access(people.other, ["projects.manage", "projects.view", "commercial.costs.view"])),
  };
  const actor = {} as never;

  async function seedProject(client: PoolClient, workspaceId: string, projectId: string, project: string, name: string, reference: string) {
    const opportunity = randomUUID(), party = randomUUID();
    await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person',$3,$4)", [party, workspaceId, `${name} Client`, `${name} client`.toLowerCase()]);
    await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,'lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, workspaceId, party, randomUUID(), randomUUID(), name, `O-${reference}`]);
    await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [project, workspaceId, opportunity, people.manager]);
    await client.query(`INSERT INTO delivery_projects(id,workspace_id,case_id,name,created_by,reference,quote_id,started_at,start_date,currency) VALUES($1,$2,$3,$4,$5,$6,'q7','2026-08-01T06:00:00Z','2026-08-01','AED')`,
      [projectId, workspaceId, project, name, people.manager, reference]);
  }

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 6 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [key, id] of Object.entries(people)) await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${key}-${run}@pnl.test`, key]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers and cross-table keys
      for (const workspace of [ws, otherWs])
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'P&L firm',$2,'AED','Asia/Dubai',$3)",
          [workspace, `pnl-${workspace.slice(0, 8)}`, people.manager]);
      for (const [key, id] of Object.entries(membership))
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [id, ws, people[key as keyof typeof people]]);
      await client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone) VALUES($1,$2,'MAIN','Studio LLC','Studio LLC','AE','AED','en-AE','Asia/Dubai')`,
        [entity, ws]);
      await client.query(`INSERT INTO workspace_vendors(workspace_id,id,code,display_name,created_by,updated_by) VALUES($1,$2,'STONE','Stone Co',$3,$3)`, [ws, vendor, people.manager]);
      // The firm's target: 45 % margin (Settings › Quotation › margin floor); the spending guard is strict.
      await client.query("INSERT INTO workspace_quotation_settings(workspace_id,margin_floor_percent) VALUES($1,45)", [ws]);
      await client.query("INSERT INTO workspace_purchasing_settings(workspace_id,spending_guard) VALUES($1,'strict')", [ws]);

      await seedProject(client, ws, villa, caseId, "Villa 7", "PRJ-0007");
      await seedProject(client, otherWs, otherProject, randomUUID(), "Villa 7 elsewhere", "PRJ-0099");
      await client.query("INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager) VALUES($1,$2,$3,true),($1,$2,$4,false)", [ws, villa, membership.lead, membership.designer]);
      for (const [key, supply] of [["kitchen", "make"], ["stone", "buy"], ["paint", "subcontract"]] as const)
        await client.query("INSERT INTO project_packages(id,workspace_id,project_id,name,supply) VALUES($1,$2,$3,$4,$5)", [pkg[key], ws, villa, key, supply]);

      // What was agreed: R1 at 100,000 before tax (105,000 with it) and VO-1 at 10,000 (10,500).
      await client.query(`INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,status,title,currency) VALUES($1,$2,'q7',0,1,'quotation','accepted','Villa 7','AED'),
        ($1,$2,'v7',1,2,'variation','accepted','VO-1','AED')`, [ws, caseId]);
      const quoteLine = (quote: string, id: string, position: number, quantity: string, unitCost: string | null, kind: string, extra: { optional?: boolean; changeOp?: string; boqLine?: string } = {}) =>
        client.query(`INSERT INTO commercial_quote_lines(workspace_id,case_id,quote_id,id,sort_order,title,quantity,unit_cost,rate,kind,optional,change_op,boq_line_id)
          VALUES($1,$2,$3,$4::text,$5,$4::text,$6,$7,0,$8,$9,$10,$11)`, [ws, caseId, quote, id, position, quantity, unitCost, kind, extra.optional ?? null, extra.changeOp ?? null, extra.boqLine ?? null]);
      // Planned cost: cabinets 30,000 (factory), marble 100 × 200 (materials), painting 8,000 (subcontract); a wine fridge the client didn't choose;
      // lighting without a cost. VO-1 adds a 6,000 wardrobe (factory) and takes 20 marble off (−4,000 materials).
      await quoteLine("q7", "L1", 0, "1", "30000", "item");
      await quoteLine("q7", "L2", 1, "100", "200", "item");
      await quoteLine("q7", "L3", 2, "1", "8000", "service");
      await quoteLine("q7", "L4", 3, "1", "5000", "item", { optional: true });
      await quoteLine("q7", "L5", 4, "10", null, "item");
      await quoteLine("v7", "V1", 0, "1", "6000", "item", { changeOp: "add" });
      await quoteLine("v7", "V2", 1, "20", "200", "item", { changeOp: "omit", boqLine: boq.marble });
      const seal = (id: string, kind: string, quote: string, label: string, net: string, total: string, at: string) => client.query(
        `INSERT INTO project_scope_seals(id,workspace_id,project_id,kind,quote_id,quote_number,revision_label,quote_hash,snapshot,content_hash,currency,total,accepted_at,accepted_by_name,sealed_by,sealed_at)
         VALUES($1,$2,$3,$4,$5,1,$6,'h',$7::jsonb,repeat('c',64),'AED',$8,$9,'Client',$10,$9)`, [id, ws, villa, kind, quote, label, JSON.stringify({ pricing: { net } }), total, at, people.manager]);
      await seal(seals.baseline, "baseline", "q7", "R1", "100000.0000", "105000.0000", "2026-08-01T06:00:00Z");
      await seal(seals.variation, "variation", "v7", "VO-1", "10000.0000", "10500.0000", "2026-09-15T06:00:00Z");
      const boqLine = (id: string, sealId: string, source: string, packageId: string) => client.query(
        `INSERT INTO project_boq_lines(id,workspace_id,project_id,origin_seal_id,source_line_id,kind,title,quantity,rate,net,package_id) VALUES($1,$2,$3,$4,$5::text,'item',$5::text,1,0,0,$6)`,
        [id, ws, villa, sealId, source, packageId]);
      await boqLine(boq.cabinets, seals.baseline, "L1", pkg.kitchen);
      await boqLine(boq.marble, seals.baseline, "L2", pkg.stone);
      await boqLine(boq.painting, seals.baseline, "L3", pkg.paint);
      await boqLine(boq.lighting, seals.baseline, "L5", pkg.stone);
      await boqLine(boq.wardrobe, seals.variation, "V1", pkg.kitchen);

      // Costs. Marble: ordered 100 at 190 (credit 30 days after it's expected), 50 received into the project's stock (9,500 materials).
      await client.query(`INSERT INTO purchase_orders(id,workspace_id,number,legal_entity_id,vendor_id,currency,payment_terms,credit_days,expected_date,created_by,status,approved_at)
        VALUES($1,$2,'PO-1',$3,$4,'AED','credit',30,$5,$6,'approved',now()),($7,$2,'PO-2',$3,$4,'AED','on_delivery',NULL,$8,$6,'approved',now())`,
        [order.marble, ws, entity, vendor, addDays(today, 5), people.manager, order.painting, addDays(today, 70)]);
      await client.query(`INSERT INTO purchase_order_lines(id,workspace_id,order_id,source,boq_line_id,project_id,description,quantity,unit_price,net,tax,total)
        VALUES($1,$2,$3,'line',$4,$5,'Marble',100,190,19000,950,19950),($6,$2,$7,'line',$8,$5,'Painting',1,9000,9000,450,9450)`,
        [line.marble, ws, order.marble, boq.marble, villa, line.painting, order.painting, boq.painting]);
      await client.query("INSERT INTO stock_locations(id,workspace_id,kind,name) VALUES($1,$2,'warehouse','Main store')", [location, ws]);
      await client.query("INSERT INTO stock_items(id,workspace_id,name,unit,normal_key) VALUES($1,$2,'Marble slab','sqm','marble slab|sqm')", [item, ws]);
      const receipt = randomUUID(), receiptLine = randomUUID(), serviceReceipt = randomUUID();
      await client.query(`INSERT INTO goods_receipts(id,workspace_id,number,order_id,location_id,received_on,received_by) VALUES($1,$2,1,$3,$4,'2026-09-05',$5),($6,$2,2,$7,$4,'2026-09-20',$5)`,
        [receipt, ws, order.marble, location, people.lead, serviceReceipt, order.painting]);
      // Half the painting is done and accepted (4,500 subcontract); the other half is still committed.
      await client.query(`INSERT INTO goods_receipt_lines(id,workspace_id,receipt_id,order_line_id,received,accepted) VALUES($1,$2,$3,$4,50,50),($5,$2,$6,$7,0.5,0.5)`,
        [receiptLine, ws, receipt, line.marble, randomUUID(), serviceReceipt, line.painting]);
      await client.query(`INSERT INTO stock_movements(id,workspace_id,batch_id,item_id,location_id,project_id,kind,quantity,unit_cost,currency,receipt_line_id,moved_on,actor_id)
        VALUES($1,$2,$3,$4,$5,$6,'receive',50,190,'AED',$7,'2026-09-05',$8)`, [randomUUID(), ws, randomUUID(), item, location, villa, receiptLine, people.lead]);
      // The factory: 10 slabs at 400 issued from free stock to the cabinets' work order (4,000 factory).
      const workOrder = randomUUID();
      await client.query(`INSERT INTO work_orders(id,workspace_id,number,project_id,package_id,boq_line_id,title,quantity,created_by) VALUES($1,$2,1,$3,$4,$5,'Cabinets',1,$6)`,
        [workOrder, ws, villa, pkg.kitchen, boq.cabinets, people.manager]);
      await client.query(`INSERT INTO stock_movements(id,workspace_id,batch_id,item_id,location_id,project_id,for_project_id,work_order_id,kind,quantity,unit_cost,currency,moved_on,actor_id)
        VALUES($1,$2,$3,$4,$5,NULL,$6,$7,'issue',-10,400,'AED','2026-09-10',$8)`, [randomUUID(), ws, randomUUID(), item, location, villa, workOrder, people.lead]);
      // The supplier's bill for the marble: 50 at 192 (100 more than ordered, materials) and a 300 delivery charge (other), due in 20 days; 5,000 paid.
      const bill = randomUUID();
      await client.query(`INSERT INTO supplier_invoices(id,workspace_id,vendor_id,legal_entity_id,number,invoice_date,due_date,currency,net,tax,total,status,approved_by,approved_at,created_by)
        VALUES($1,$2,$3,$4,'INV-889','2026-09-25',$5,'AED',9900,495,10395,'approved',$6,now(),$7)`, [bill, ws, vendor, entity, addDays(today, 20), people.manager, people.lead]);
      await client.query(`INSERT INTO supplier_invoice_lines(id,workspace_id,invoice_id,order_line_id,project_id,description,quantity,unit_price,net,tax,total)
        VALUES($1,$2,$3,$4,NULL,'Marble',50,192,9600,480,10080),($5,$2,$3,NULL,$6,'Delivery to site',1,300,300,15,315)`, [randomUUID(), ws, bill, line.marble, randomUUID(), villa]);
      const payment = randomUUID(), advance = randomUUID();
      await client.query(`INSERT INTO supplier_payments(id,workspace_id,vendor_id,legal_entity_id,paid_on,currency,amount,method,created_by,order_id)
        VALUES($1,$2,$3,$4,'2026-10-01','AED',5000,'cash',$5,NULL),($6,$2,$3,$4,'2026-09-18','AED',2000,'cash',$5,$7)`, [payment, ws, vendor, entity, people.manager, advance, order.painting]);
      await client.query("INSERT INTO supplier_payment_allocations(id,workspace_id,payment_id,invoice_id,amount,created_by) VALUES($1,$2,$3,$4,5000,$5)", [randomUUID(), ws, payment, bill, people.manager]);
      // Site labour: 3 painters on an approved report at 250 a day (750 subcontract and labour).
      const report = randomUUID();
      await client.query("INSERT INTO workspace_labour_rates(id,workspace_id,trade,effective_from,day_rate,currency,updated_by) VALUES($1,$2,'Painter','2026-01-01',250,'AED',$3)", [randomUUID(), ws, people.manager]);
      await client.query(`INSERT INTO site_reports(id,workspace_id,project_id,report_date,author_id,status,submitted_at,decided_by,decided_at) VALUES($1,$2,$3,'2026-09-22',$4,'approved',now(),$5,now())`,
        [report, ws, villa, people.lead, people.manager]);
      await client.query("INSERT INTO site_report_workforce(id,workspace_id,report_id,trade,people) VALUES($1,$2,$3,'Painter',3)", [randomUUID(), ws, report]);
      // Petty cash: 450 approved, waiting to be reimbursed; 200 reimbursed at 21:30 UTC on 30 Sep (1 Oct in Dubai).
      await client.query(`INSERT INTO petty_cash_claims(id,workspace_id,number,project_id,spent_on,amount,currency,description,category,no_receipt_reason,status,claimed_by,submitted_at,decided_by,decided_at,reimbursed_by,reimbursed_at)
        VALUES($1,$2,1,$3,'2026-09-26',450,'AED','Diesel','transport','Fuel station','approved',$4,now(),$5,now(),NULL,NULL),
              ($6,$2,2,$3,'2026-09-12',200,'AED','Taxi','transport','Taxi','reimbursed',$4,now(),$5,now(),$5,'2026-09-30T21:30:00Z')`, [randomUUID(), ws, villa, people.lead, people.manager, randomUUID()]);

      // The client: 42,000 advance paid and verified on 6 Aug; 10,000 of the 31,500 progress payment verified at 21:00 UTC on 30 Sep (1 Oct in Dubai);
      // 5,000 more reported but not verified; a design fee on another quotation; an allocation reversed.
      await client.query(`INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,$3::jsonb)`, [ws, caseId, JSON.stringify({ financeContext: { legalEntityId: entity, currency: "AED" } })]);
      const milestone = (id: string, amount: string, due: string, status: string, quote: string) => client.query(
        `INSERT INTO commercial_payments(workspace_id,case_id,id,sort_order,title,amount,currency,due_date,status,source_quote_id,legal_entity_id) VALUES($1,$2,$3,0,$3,$4,'AED',$5,$6,$7,$8)`,
        [ws, caseId, id, amount, due, status, quote, entity]);
      await milestone("Advance", "42000", "2026-08-05", "verified", "q7");
      await milestone("Progress", "31500", addDays(today, 10), "pending", "q7");
      await milestone("VO-1", "10500", addDays(today, 45), "pending", "v7");
      await milestone("Design", "5000", "2026-07-01", "verified", "qd");
      const clientReceipt = (id: string, paymentId: string, amount: string, status: string, detail: Record<string, string>) => client.query(
        `INSERT INTO commercial_receipts(workspace_id,case_id,id,sort_order,payment_id,legal_entity_id,currency,amount,source,status,reference,detail) VALUES($1,$2,$3,0,$4,$5,'AED',$6,'manual',$7,$3,$8::jsonb)`,
        [ws, caseId, id, paymentId, entity, amount, status, JSON.stringify(detail)]);
      await clientReceipt("r1", "Advance", "42000", "finance_verified", { reportedAt: "2026-08-05T10:00:00Z", verifiedAt: "2026-08-06T05:00:00Z" });
      await clientReceipt("r2", "Progress", "10000", "finance_verified", { reportedAt: "2026-09-30T10:00:00Z", verifiedAt: "2026-09-30T21:00:00Z" });
      await clientReceipt("r3", "Progress", "5000", "reported", { reportedAt: "2026-10-02T10:00:00Z" });
      await clientReceipt("r4", "Design", "5000", "finance_verified", { reportedAt: "2026-07-01T10:00:00Z", verifiedAt: "2026-07-02T10:00:00Z" });
      const allocate = (id: string, receiptId: string, paymentId: string, amount: string, detail: Record<string, string> = {}) => client.query(
        `INSERT INTO commercial_allocations(workspace_id,case_id,id,sort_order,receipt_id,payment_id,legal_entity_id,currency,amount,detail) VALUES($1,$2,$3,0,$4,$5,$6,'AED',$7,$8::jsonb)`,
        [ws, caseId, id, receiptId, paymentId, entity, amount, JSON.stringify(detail)]);
      await allocate("a1", "r1", "Advance", "42000", { createdAt: "2026-08-06T05:00:00Z" });
      await allocate("a2", "r2", "Progress", "10000", { createdAt: "2026-09-30T21:00:00Z" });
      await allocate("a3", "r4", "Design", "5000", { createdAt: "2026-07-02T10:00:00Z" });
      await allocate("a4", "r2", "Progress", "999", { createdAt: "2026-09-30T21:00:00Z", reversedAt: "2026-10-01T08:00:00Z" });
      // Invoiced: the advance (40,000 + 2,000 tax); an invoice credited in full doesn't count.
      const invoice = (number: string, net: string, tax: string, total: string, status: string) => client.query(
        `INSERT INTO client_invoices(id,workspace_id,legal_entity_id,project_id,case_id,payment_id,quote_id,number,issue_date,due_date,currency,net,tax,total,prices_include_tax,milestone_title,customer_name,company_name,issued_by,status)
         VALUES($1,$2,$3,$4,$5,'Advance','q7',$6,'2026-08-05','2026-08-05','AED',$7,$8,$9,false,'Advance','Villa 7 Client','Studio LLC',$10,$11)`,
        [randomUUID(), ws, entity, villa, caseId, number, net, tax, total, people.manager, status]);
      await invoice("INV-1", "40000", "2000", "42000", "issued");
      await invoice("INV-0", "5000", "250", "5250", "credited");
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    // The Ledger on for the company, with the advance invoice and 19,000 of the costs posted so far.
    await tenant(ws, people.manager, (c) => applyTemplate(c, ws, entity, "AE", { actorId: people.manager, startDate: "2026-08-01" }));
    await tenant(ws, people.manager, (c) => c.query("UPDATE books_settings SET enabled = true, version = version + 1 WHERE workspace_id = $1 AND legal_entity_id = $2", [ws, entity]));
    const r = (role: string) => ({ role }) as DraftLine["account"];
    const post = (eventDate: string, type: string, lines: DraftLine[]) => tenant(ws, people.manager, async (c) => {
      const outcome = await postJournal(c, ws, { legalEntityId: entity, eventDate, currency: "AED", source: { type, id: `${run}-${type}`, event: "issued" }, lines });
      if (outcome.status !== "posted") throw new Error(`Not posted: ${JSON.stringify(outcome)}`);
    });
    await post("2026-08-05", "client_invoice", [{ account: r("ar_control"), side: "debit", amount: "42000" }, { account: r("revenue_project"), side: "credit", amount: "40000", projectId: villa },
      { account: r("vat_output"), side: "credit", amount: "2000" }]);
    await post("2026-09-30", "stock_batch", [{ account: r("cost_materials"), side: "debit", amount: "19000", projectId: villa }, { account: r("inventory"), side: "credit", amount: "19000" }]);
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // fixture teardown only
      for (const table of [...BOOKS_TABLES, ...FIXTURE_TABLES]) await client.query(`DELETE FROM ${table} WHERE workspace_id = ANY($1::uuid[])`, [[ws, otherWs]]);
      await client.query("DELETE FROM workspaces WHERE id = ANY($1::uuid[])", [[ws, otherWs]]);
      await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [Object.values(people)]);
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK");
    } finally {
      client.release();
      await pool.end();
    }
  });

  it("works out the P&L by category against the quotation's estimate, with hand-checked figures", async () => {
    const pnl = await as.manager().pnl(actor, ws, villa);
    expect(pnl).toMatchObject({ reference: "PRJ-0007", currency: "AED", contractCurrency: "AED", comparable: true, marginHidden: false, estimate: { lines: 6, missing: 1 }, uncosted: 0 });
    expect(pnl.contract).toMatchObject({ baselineNet: "100000.0000", baselineTotal: "105000.0000", variationsNet: "10000.0000", variationsTotal: "10500.0000", net: "110000.0000", total: "115500.0000" });
    expect(pnl.contract.variations.map((item) => item.label)).toEqual(["VO-1"]);
    expect(pnl.revenue).toEqual({ invoicedNet: "40000.0000", invoicedTotal: "42000.0000", received: "52000.0000" });
    expect(pnl.categories.map((row) => [row.category, row.budget, row.actual, row.committed, row.remaining, row.forecast, row.variance, row.over])).toEqual([
      // Planned 16,000 (20,000 − 4,000 credited); 9,500 received + 100 priced higher on the bill; 9,500 still on order.
      ["materials", "16000.0000", "9600.0000", "9500.0000", "0.0000", "19100.0000", "-3100.0000", true],
      // Planned 36,000 (30,000 + the 6,000 wardrobe); 4,000 issued to the work order.
      ["factory", "36000.0000", "4000.0000", "0.0000", "32000.0000", "36000.0000", "0.0000", false],
      // Planned 8,000; 4,500 accepted + 750 site labour; 4,500 still on order.
      ["subcontract_labour", "8000.0000", "5250.0000", "4500.0000", "0.0000", "9750.0000", "-1750.0000", true],
      ["site_expenses", null, "650.0000", "0.0000", "0.0000", "650.0000", null, false],
      ["other", null, "300.0000", "0.0000", "0.0000", "300.0000", null, false],
    ]);
    expect(pnl.totals).toEqual({ budget: "60000.0000", actual: "19800.0000", committed: "14000.0000", remaining: "32000.0000", forecast: "65800.0000" });
    // So far 40,000 − 19,800; at completion 110,000 − 65,800 = 44,200 (40.2 %, under the firm's 45 %).
    expect(pnl.margin).toEqual({ toDate: "20200.0000", toDatePercent: "50.5", forecast: "44200.0000", forecastPercent: "40.2", target: "45.0" });
    expect(pnl.flags).toEqual([
      { code: "over_budget", category: "materials", amount: "3100.0000" }, { code: "over_budget", category: "subcontract_labour", amount: "1750.0000" },
      { code: "below_target", forecastPercent: "40.2", target: "45.0" }, { code: "estimate_incomplete", count: 1 },
    ]);
    // The Ledger has the invoice and 19,000 of the 19,800 costs posted: revenue agrees, costs are 800 short.
    expect(pnl.basis).toEqual({ source: "operational", ledger: { company: "Studio LLC", currency: "AED", revenue: "40000.0000", cost: "19000.0000",
      revenueDifference: "0.0000", costDifference: "-800.0000", matches: false, journals: `/workspace/ledger/journals?project=${villa}` } });
  });

  it("buckets cash by month on the workspace's calendar, with the wallet, what's due in 90 days and the spending guard", async () => {
    const cash = await as.manager().cashFlow(actor, ws, villa);
    expect(cash).toMatchObject({ currency: "AED", timeZone: "Asia/Dubai", asOf: today, unconverted: 0 });
    expect(cash.months.slice(0, 3)).toEqual([
      { month: "2026-08", in: "42000.0000", out: "0.0000", net: "42000.0000", cumulativeIn: "42000.0000", cumulativeOut: "0.0000", balance: "42000.0000" },
      // The 2,000 advance on the painting order and 750 of site labour.
      { month: "2026-09", in: "0.0000", out: "2750.0000", net: "-2750.0000", cumulativeIn: "42000.0000", cumulativeOut: "2750.0000", balance: "39250.0000" },
      // 10,000 verified at 21:00 UTC on 30 Sep counts in October in Dubai, as does the 200 reimbursed at 21:30 UTC; 5,000 paid on the bill.
      { month: "2026-10", in: "10000.0000", out: "5200.0000", net: "4800.0000", cumulativeIn: "52000.0000", cumulativeOut: "7950.0000", balance: "44050.0000" },
    ]);
    expect(cash.wallet).toEqual({ received: "52000.0000", paid: "7950.0000", balance: "44050.0000" });
    expect(cash.upcoming.buckets.map((bucket) => [bucket.key, bucket.in, bucket.out])).toEqual([
      ["overdue", "0.0000", "0.0000"],
      // The progress payment's 21,500 left; the bill's 5,395 left and the 450 petty cash to reimburse.
      ["days_0_30", "21500.0000", "5845.0000"],
      // VO-1's 10,500; the marble order's 9,500, payable 30 days after it's expected.
      ["days_31_60", "10500.0000", "9500.0000"],
      // The painting order's 4,500 left less the 2,000 already paid in advance.
      ["days_61_90", "0.0000", "2500.0000"],
    ]);
    // The guard's money in hand: 42,000 (fully paid milestones) − 19,800 spent − 14,000 committed.
    expect(cash.spendingLock).toEqual({ guard: "strict", available: "8200.0000", state: "clear" });
  });

  it("shows the project's own team its costs without margins, and nobody else", async () => {
    const pnl = await as.lead().pnl(actor, ws, villa);
    expect(pnl.marginHidden).toBe(true);
    expect(pnl.margin).toEqual({ toDate: null, toDatePercent: null, forecast: null, forecastPercent: null, target: null });
    expect(pnl.flags.map((flag) => flag.code)).toEqual(["over_budget", "over_budget", "estimate_incomplete"]);
    expect(pnl.totals.actual).toBe("19800.0000");
    await expect(as.lead().cashFlow(actor, ws, villa)).resolves.toMatchObject({ wallet: { balance: "44050.0000" } });
    await expect(as.designer().pnl(actor, ws, villa)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(as.designer().profitability(actor, ws)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("lists every project's profitability for the people who see costs", async () => {
    const report = await as.manager().profitability(actor, ws);
    expect(report).toMatchObject({ currency: "AED", marginHidden: false, target: "45.0" });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ projectId: villa, reference: "PRJ-0007", name: "Villa 7", clientName: "Villa 7 Client", href: `/workspace/projects/${villa}/money`,
      contractNet: "110000.0000", variationsNet: "10000.0000", revenue: "40000.0000", received: "52000.0000", cost: "19800.0000", committed: "14000.0000", forecastCost: "65800.0000",
      budget: "60000.0000", margin: "20200.0000", marginPercent: "50.5", forecastMargin: "44200.0000", forecastMarginPercent: "40.2" });
    expect(report.rows[0].flags.map((flag) => flag.code)).toEqual(["over_budget", "over_budget", "below_target", "estimate_incomplete"]);
    const own = await as.lead().profitability(actor, ws);
    expect(own.marginHidden).toBe(true);
    expect(own.rows.map((row) => [row.reference, row.forecastMarginPercent])).toEqual([["PRJ-0007", null]]);
  });

  it("lets Woddy's project_profit answer from Wodana's records next to the Ledger, within the person's permissions", async () => {
    const woddy = (userId: string, granted: string[]) => {
      const registry = AiToolRegistry.catalogue({ books: new ProjectProfitService(access(userId, granted)), projectFinance: new ProjectFinanceService(access(userId, granted)) } as unknown as ToolServices);
      const { context } = toolContext({ actor, workspaceId: ws, runId: "run-1", asker: { userId, membershipId: "m", permissions: new Set(granted), timeZone: "Asia/Dubai", locale: "en" } });
      const tool = registry.get("project_profit")!;
      return (project: string) => tool.run!(context, validateToolInput(tool.parameters, { project })) as Promise<{ data: Record<string, unknown> }>;
    };
    const manager = await woddy(people.manager, ["projects.manage", "projects.view", "commercial.costs.view"])("Villa 7");
    expect(manager.data).toMatchObject({ project: { reference: "PRJ-0007" }, revenue: "40000.0000", totalCost: "19000.0000",
      fromRecords: { agreedBeforeTax: { total: "110000.0000", variations: "10000.0000" }, costsSoFar: "19800.0000", expectedCostAtCompletion: "65800.0000",
        expectedMargin: "44200.0000", expectedMarginPercent: "40.2", targetMarginPercent: "45.0", byCategory: { materials: { estimate: "16000.0000", over: true } } } });
    const lead = await woddy(people.lead, ["projects.view", "projects.costs.view"])("PRJ-0007");
    expect(lead.data).toMatchObject({ marginHidden: true, fromRecords: { marginHidden: true, costsSoFar: "19800.0000" } });
    expect(lead.data.fromRecords).not.toHaveProperty("expectedMargin");
  });

  it("keeps each workspace's projects to itself", async () => {
    await expect(as.other().pnl(actor, otherWs, villa)).rejects.toBeInstanceOf(NotFoundException);
    await expect(as.other().cashFlow(actor, otherWs, villa)).rejects.toBeInstanceOf(NotFoundException);
    const elsewhere = await as.other().profitability(actor, otherWs);
    expect(elsewhere.rows.map((row) => row.reference)).toEqual(["PRJ-0099"]);
    expect(elsewhere.rows[0]).toMatchObject({ contractNet: "0.0000", cost: "0.0000", revenue: "0.0000" });
  });
});
