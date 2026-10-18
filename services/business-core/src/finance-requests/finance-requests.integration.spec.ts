import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { readBoard, readDetail, runCommand, type Ctx } from "./finance-request-commands";
import { readContext, saveRequestSettings } from "./finance-request-options";
import { raiseStageInvoiceRequests } from "./stage-invoice-requests";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Fixtures are committed in their own
// workspaces; every command runs as the app role under forced RLS, as the API does.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

type Person = "sales" | "finance" | "verifier" | "approver" | "payables" | "outsider";

integration("Finance requests on real Postgres (raise, Finance's board, approvals, notices, tenancy)", () => {
  let pool: Pool;
  const workspaceId = randomUUID(), otherWorkspaceId = randomUUID();
  const people: Record<Person, string> = { sales: randomUUID(), finance: randomUUID(), verifier: randomUUID(), approver: randomUUID(), payables: randomUUID(), outsider: randomUUID() };
  const ids = { person: randomUUID(), company: randomUUID(), pipeline: randomUUID(), stage: randomUUID(), opportunity: randomUUID(), entity: randomUUID(), profile: randomUUID(),
    vendor: randomUUID(), salesMembership: randomUUID() };

  async function tenant<T>(ws: string, userId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [ws, userId]);
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

  /** What a person may do, from their roles (the service asks the workspace access check the same question). */
  const ctx = (client: PoolClient, person: Person, ws = workspaceId): Ctx => ({
    workspaceId: ws, userId: people[person],
    can: async (code) => Boolean((await client.query(
      `SELECT 1 FROM workspace_memberships membership JOIN effective_member_roles role ON role.membership_id = membership.id
         JOIN role_permissions granted ON granted.role_id = role.role_id JOIN permissions permission ON permission.id = granted.permission_id
        WHERE membership.workspace_id = $1 AND membership.user_id = $2 AND membership.status = 'active' AND permission.code = $3`, [ws, people[person], code])).rowCount),
  });
  const run = (person: Person, body: Record<string, unknown>) =>
    tenant(workspaceId, people[person], async (client) => readDetail(client, ctx(client, person), await runCommand(client, ctx(client, person), { commandId: randomUUID(), ...body })));
  const view = (person: Person, id: string) => tenant(workspaceId, people[person], (client) => readDetail(client, ctx(client, person), id));

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 4 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [key, id] of Object.entries(people))
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${key}-${id.slice(0, 8)}@example.com`, key[0].toUpperCase() + key.slice(1)]);
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      for (const ws of [workspaceId, otherWorkspaceId])
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Finance firm',$2,'AED',$3)", [ws, `fr-${ws.slice(0, 8)}`, people.finance]);
      const roles: Record<Exclude<Person, "outsider">, string[]> = {
        sales: ["finance_requests.raise", "crm.opportunities.manage"],
        finance: ["finance_requests.raise", "finance_requests.manage", "payables.manage", "commercial.finance.verify"],
        verifier: ["commercial.finance.verify"],
        approver: ["commercial.deal.approve"],
        payables: ["payables.approve"],
      };
      for (const [person, permissions] of Object.entries(roles) as Array<[Exclude<Person, "outsider">, string[]]>) {
        const roleId = randomUUID(), membership = person === "sales" ? ids.salesMembership : randomUUID();
        await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,$3,$3,false)", [roleId, workspaceId, person]);
        await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = ANY($3::text[])", [workspaceId, roleId, permissions]);
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, workspaceId, people[person]]);
        await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [workspaceId, membership, roleId]);
      }
      const outsiderRole = randomUUID(), outsiderMembership = randomUUID();
      await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,'finance','finance',false)", [outsiderRole, otherWorkspaceId]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code LIKE 'finance_requests.%'", [otherWorkspaceId, outsiderRole]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [outsiderMembership, otherWorkspaceId, people.outsider]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [otherWorkspaceId, outsiderMembership, outsiderRole]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,display_name,normalized_name,type,owner_membership_id) VALUES($1,$2,'Mohamed Vora','mohamed vora','person',$3)",
        [ids.person, workspaceId, ids.salesMembership]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,display_name,normalized_name,type) VALUES($1,$2,'Gulf Towers LLC','gulf towers llc','organization')", [ids.company, workspaceId]);
      await client.query("INSERT INTO crm_contact_points(workspace_id,party_id,type,raw_value,normalized_value,is_primary) VALUES($1,$2,'email','mohamed@example.com','mohamed@example.com',true)",
        [workspaceId, ids.person]);
      await client.query("INSERT INTO crm_pipelines(id,workspace_id,code,name) VALUES($1,$2,'sales','Sales')", [ids.pipeline, workspaceId]);
      await client.query("INSERT INTO crm_pipeline_stages(id,workspace_id,pipeline_id,code,name,position) VALUES($1,$2,$3,'won','Won',1)", [ids.stage, workspaceId, ids.pipeline]);
      await client.query("INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,title,reference,owner_membership_id) VALUES($1,$2,$3,$4,$5,'Villa 12','O-0001',$6)",
        [ids.opportunity, workspaceId, ids.person, ids.pipeline, ids.stage, ids.salesMembership]);
      await client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone)
        VALUES($1,$2,'MAIN','Studio Interiors','Studio Interiors LLC','AE','AED','en-AE','Asia/Dubai')`, [ids.entity, workspaceId]);
      await client.query(`INSERT INTO tax_profiles(id,workspace_id,legal_entity_id,name,jurisdiction_code,scheme,effective_from) VALUES($1,$2,$3,'VAT','AE','vat',now())`,
        [ids.profile, workspaceId, ids.entity]);
      await client.query(`INSERT INTO tax_rates(workspace_id,tax_profile_id,code,label,rate,is_default) VALUES($1,$2,'sr','Standard',5,true),($1,$2,'zr','Zero rated',0,false)`,
        [workspaceId, ids.profile]);
      await client.query(`INSERT INTO workspace_vendors(workspace_id,id,code,display_name,tax_registration_number,created_by,updated_by)
        VALUES($1,$2,'NILE','Nile Marble','100123456700003',$3,$3)`, [workspaceId, ids.vendor, people.finance]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    // Finance enters its inbox through the app; nothing is seeded.
    await tenant(workspaceId, people.finance, (client) => saveRequestSettings(client, ctx(client, "finance"), { action: "save_settings", version: 0, financeInbox: "finance@example.com" }));
  });
  afterAll(() => pool?.end());

  const invoice = (patch: Record<string, unknown> = {}) => ({
    action: "submit", id: randomUUID(), kind: "invoice", opportunityId: ids.opportunity, currency: "AED", legalEntityId: ids.entity, invoiceKind: "standard",
    clientEmail: "mohamed@example.com", paymentTerms: "50% deposit, balance before installation", lines: [{ description: "Kitchen joinery", quantity: "1", unitPrice: "10000" }], ...patch,
  });

  it("raises an invoice from the deal: client and salesperson filled, tax-exclusive at the company's rate, emailed to the finance inbox", async () => {
    const context = await tenant(workspaceId, people.sales, (client) => readContext(client, ctx(client, "sales"), { opportunityId: ids.opportunity }));
    expect(context.client).toMatchObject({ id: ids.person, name: "Mohamed Vora", email: "mohamed@example.com" });
    expect(context.companies[0]).toMatchObject({ id: ids.entity, currency: "AED", rates: [{ code: "sr", rate: "5", isDefault: true }, { code: "zr", rate: "0" }] });
    const detail = await run("sales", invoice());
    expect(detail.request).toMatchObject({ reference: "FR-0001", status: "new", kind: "invoice", partyId: ids.person, salespersonId: people.sales, clientName: "Mohamed Vora",
      net: "10000.0000", tax: "500.0000", total: "10500.0000", taxRate: "5.0000", internalNote: null });
    expect(detail.lines).toMatchObject([{ description: "Kitchen joinery", amount: "10000.0000" }]);
    const queued = await tenant(workspaceId, people.finance, async (client) => (await client.query<{ recipient: string; channel: string; code: string }>(
      `SELECT recipient_type AS recipient, channel, event_type AS code FROM notifications WHERE workspace_id = $1 AND deep_link LIKE $2 ORDER BY channel`,
      [workspaceId, `%${detail.request.id}`])).rows);
    expect(queued).toEqual(expect.arrayContaining([{ recipient: "finance_inbox", channel: "email", code: "finance_request.submitted" },
      { recipient: "user", channel: "in_app", code: "finance_request.submitted" }]));
    // In the deal's and client's history (the job timeline and PLM-094 read audit events by the record's id).
    const history = await tenant(workspaceId, people.finance, async (client) => (await client.query<{ type: string }>(
      `SELECT entity_type AS type FROM audit_events WHERE workspace_id = $1 AND action = 'finance_request_raised' AND entity_id = ANY($2::uuid[]) ORDER BY entity_type`,
      [workspaceId, [ids.person, ids.opportunity]])).rows.map((row) => row.type));
    expect(history).toEqual(["crm_opportunity", "crm_party"]);
  });

  it("refuses an invoice without the client's email, a company without its tax number, and a client that isn't one of ours", async () => {
    await expect(run("sales", invoice({ clientEmail: "" }))).rejects.toThrow(/client's email/);
    await expect(run("sales", invoice({ opportunityId: null, partyId: ids.company, clientEmail: "ap@gulf.example" }))).rejects.toThrow(/tax registration number/);
    await expect(run("sales", invoice({ opportunityId: null, partyId: randomUUID() }))).rejects.toThrow(/Client not found/);
    await expect(run("sales", invoice({ lines: [{ description: "Odd", quantity: "1", unitPrice: "10.555" }] }))).rejects.toThrow(/more decimals than AED/);
  });

  it("lets only Finance move it; the requester answers a question and sees Done with the accounting reference", async () => {
    const raised = await run("sales", invoice());
    const id = raised.request.id;
    await expect(run("sales", { action: "start", id, version: raised.request.version })).rejects.toThrow(/Only Finance/);
    const started = await run("finance", { action: "start", id, version: raised.request.version });
    expect(started.request).toMatchObject({ status: "in_progress", handledBy: people.finance });
    await expect(run("finance", { action: "ask", id, version: started.request.version })).rejects.toThrow(/what's missing/);
    // A stale version is refused: someone changed it first.
    await expect(run("finance", { action: "ask", id, version: raised.request.version, note: "Which stage?" })).rejects.toThrow(/changed elsewhere/);
    const asked = await run("finance", { action: "ask", id, version: started.request.version, note: "Which payment stage is this?" });
    expect(asked.request.status).toBe("needs_info");
    expect(asked.canResubmit).toBe(false);
    const mine = await view("sales", id);
    expect(mine.canResubmit).toBe(true);
    const answered = await run("sales", { ...invoice({ id, action: "resubmit", version: asked.request.version, note: "The deposit" }),
      lines: [{ description: "Deposit 50%", quantity: "1", unitPrice: "5000" }] });
    expect(answered.request).toMatchObject({ status: "in_progress", total: "5250.0000" });
    const done = await run("finance", { action: "done", id, version: answered.request.version, financeReference: "INV-1042" });
    expect(done.request).toMatchObject({ status: "done", financeReference: "INV-1042", closedByName: "Finance" });
    expect(done.events.map((event) => event.kind)).toEqual(["submitted", "status", "needs_info", "resubmitted", "done"]);
    const told = await tenant(workspaceId, people.sales, async (client) => (await client.query<{ channel: string }>(
      `SELECT channel FROM notifications WHERE workspace_id = $1 AND recipient_id = $2 AND event_type = 'finance_request.done' AND deep_link LIKE $3 ORDER BY channel`,
      [workspaceId, people.sales, `%${id}`])).rows.map((row) => row.channel));
    expect(told).toEqual(["email", "in_app"]);
  });

  it("runs a command once by its id", async () => {
    const body = invoice();
    const commandId = randomUUID();
    await tenant(workspaceId, people.sales, (client) => runCommand(client, ctx(client, "sales"), { ...body, commandId }));
    await tenant(workspaceId, people.sales, (client) => runCommand(client, ctx(client, "sales"), { ...body, commandId }));
    const count = await tenant(workspaceId, people.finance, async (client) => (await client.query(`SELECT 1 FROM finance_requests WHERE workspace_id = $1 AND id = $2`, [workspaceId, body.id])).rowCount);
    expect(count).toBe(1);
  });

  const plusDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

  /** The client paid 10,000 on the deal (Finance verified it) and reported 2,000 more that Finance hasn't verified: refunds come out of the 10,000. */
  const paidCase = randomUUID();
  async function received() {
    const fixture = await pool.connect();
    try {
      await fixture.query("BEGIN");
      await fixture.query("SET LOCAL session_replication_role = replica");
      if ((await fixture.query("SELECT 1 FROM pre_project_cases WHERE id = $1", [paidCase])).rowCount) { await fixture.query("ROLLBACK"); return; }
      await fixture.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [paidCase, workspaceId, ids.opportunity, people.sales]);
      await fixture.query("INSERT INTO commercial_cases(workspace_id,case_id,content) VALUES($1,$2,'{}'::jsonb)", [workspaceId, paidCase]);
      await fixture.query("INSERT INTO commercial_payments(workspace_id,case_id,id,sort_order,title,amount,currency,status) VALUES ($1,$2,'advance',0,'Advance',12000,'AED','verified')", [workspaceId, paidCase]);
      await fixture.query(`INSERT INTO commercial_receipts(workspace_id,case_id,id,sort_order,payment_id,legal_entity_id,currency,amount,source,status) VALUES
        ($1,$2,'r1',0,'advance',$3,'AED',10000,'manual','finance_verified'), ($1,$2,'r2',1,'advance',$3,'AED',2000,'manual','reported')`, [workspaceId, paidCase, ids.entity]);
      await fixture.query("COMMIT");
    } finally {
      fixture.release();
    }
  }

  it("QA-012: refunds only what the client paid: Finance-verified receipts on the deal, less the refunds already asked for", async () => {
    const method = randomUUID();
    await tenant(workspaceId, people.finance, (client) => saveRequestSettings(client, ctx(client, "finance"), { action: "save_method", id: method, label: "Card refund" }));
    const refund = (amount: string) => ({ action: "submit", id: randomUUID(), kind: "refund", opportunityId: ids.opportunity, currency: "AED", invoiceNumber: "QA-INV-2026-00001",
      reason: "Order cancelled", paymentMethodId: method, lines: [{ description: "Refund", unitPrice: amount }] });
    await expect(run("sales", refund("1500"))).rejects.toThrow("Nothing has been received on this deal in AED yet, so there is nothing to refund.");
    await received();
    await expect(run("sales", refund("99999999"))).rejects.toThrow("A refund can't be more than was received: AED 10,000.00 came in on this deal, so at most AED 10,000.00 can be refunded.");
    await expect(run("sales", refund("1000000000000"))).rejects.toThrow(/at most AED 10,000\.00/);
    const first = await run("sales", refund("6000"));
    expect(first.request).toMatchObject({ total: "6000.0000", status: "new" });
    // What is already asked back counts; the same request sent again is not counted twice.
    await expect(run("sales", refund("4500"))).rejects.toThrow("A refund can't be more than was received: AED 10,000.00 came in on this deal and AED 6,000.00 is already asked back, so at most AED 4,000.00 can be refunded.");
    expect((await run("sales", { ...refund("6000"), id: first.request.id })).request.id).toBe(first.request.id);
    // A rejected refund gives its amount back.
    const finance = await view("finance", first.request.id);
    await run("finance", { action: "reject", id: first.request.id, version: finance.request.version, note: "Raised by mistake" });
    const second = await run("sales", refund("4500"));
    expect(second.request.total).toBe("4500.0000");
    // Leave room for the refunds below.
    const again = await view("finance", second.request.id);
    await run("finance", { action: "reject", id: second.request.id, version: again.request.version, note: "Test" });
  });

  it("holds a refund until it's approved, keeps the bank details with Finance and shows the expected refund day", async () => {
    await received();
    const methodId = randomUUID();
    await tenant(workspaceId, people.finance, (client) => saveRequestSettings(client, ctx(client, "finance"), { action: "save_method", id: methodId, label: "Bank transfer",
      refundGuidance: "Beneficiary is added within 24 hours.", needsBankDetails: true, refundDays: 15 }));
    const refund = { action: "submit", id: randomUUID(), kind: "refund", opportunityId: ids.opportunity, currency: "AED", invoiceNumber: "INV-1042", reason: "Sofa not delivered",
      paymentMethodId: methodId, lines: [{ description: "Sofa", unitPrice: "3200" }] };
    await expect(run("sales", refund)).rejects.toThrow(/bank details/);
    const raised = await run("sales", { ...refund, bankDetails: "IBAN AE07 0331 2345 6789 0123 456" });
    expect(raised.request).toMatchObject({ total: "3200.0000", bankDetails: null, hasBankDetails: true, approvalStatus: "pending" });
    expect(raised.request.expectedRefundOn).toBe(plusDays(raised.request.refundFrom, 15));
    expect(raised.guidance).toBe("Beneficiary is added within 24 hours.");
    const id = raised.request.id;
    const forFinance = await view("finance", id);
    expect(forFinance.request.bankDetails).toBe("IBAN AE07 0331 2345 6789 0123 456");
    expect(forFinance.approval?.steps.map((step) => step.label)).toEqual(["Finance verifies", "Deal File approver"]);
    await expect(run("finance", { action: "done", id, version: forFinance.request.version })).rejects.toThrow(/waiting for approval/);
    // The requester never decides their own; Finance verifies, the Deal File approver approves.
    await expect(run("sales", { action: "decide", id, decision: "approve" })).rejects.toThrow(/your own/);
    await run("verifier", { action: "decide", id, decision: "approve" });
    const approved = await run("approver", { action: "decide", id, decision: "approve" });
    expect(approved.request.approvalStatus).toBe("approved");
    const done = await run("finance", { action: "done", id, version: approved.request.version });
    expect(done.request.status).toBe("done");
  });

  it("gives each refund method its own timeline (PLM-109): the request keeps the days of the method chosen when it was raised", async () => {
    await received();
    const stripe = randomUUID(), tabby = randomUUID();
    const save = (body: Record<string, unknown>) => tenant(workspaceId, people.finance, (client) => saveRequestSettings(client, ctx(client, "finance"), body));
    await save({ action: "save_method", id: stripe, label: "Stripe", refundGuidance: "Refunded to the card through Stripe.", refundDays: "7" });
    await save({ action: "save_method", id: tabby, label: "Tabby" });
    await expect(save({ action: "save_method", id: randomUUID(), label: "Cheque", refundDays: 0 })).rejects.toThrow(/1 to 365/);
    await expect(save({ action: "save_method", id: randomUUID(), label: "Cheque", refundDays: "2.5" })).rejects.toThrow(/1 to 365/);
    const context = await tenant(workspaceId, people.sales, (client) => readContext(client, ctx(client, "sales"), { opportunityId: ids.opportunity }));
    expect(context.methods.filter((method) => [stripe, tabby].includes(method.id)).map((method) => [method.label, method.refundDays]))
      .toEqual([["Stripe", 7], ["Tabby", null]]);
    const refund = (method: string) => ({ action: "submit", id: randomUUID(), kind: "refund", opportunityId: ids.opportunity, currency: "AED", invoiceNumber: "INV-1043",
      reason: "Cushions not delivered", paymentMethodId: method, lines: [{ description: "Cushions", unitPrice: "400" }] });
    const byCard = await run("sales", refund(stripe));
    expect(byCard.request).toMatchObject({ paymentMethod: "Stripe", refundDays: 7, expectedRefundOn: plusDays(byCard.request.refundFrom, 7) });
    expect(byCard.guidance).toBe("Refunded to the card through Stripe.");
    // A method without days shows no date.
    expect((await run("sales", refund(tabby))).request.expectedRefundOn).toBeNull();
    // Finance changes Stripe to 10 days: new refunds use 10, the one already raised keeps its 7.
    const method = (await tenant(workspaceId, people.finance, (client) => readContext(client, ctx(client, "finance"), {}))).methods.find((item) => item.id === stripe)!;
    await save({ action: "save_method", id: stripe, version: method.version, label: "Stripe", refundGuidance: method.refundGuidance, refundDays: 10 });
    expect((await view("sales", byCard.request.id)).request.expectedRefundOn).toBe(plusDays(byCard.request.refundFrom, 7));
    const later = await run("sales", refund(stripe));
    expect(later.request.expectedRefundOn).toBe(plusDays(later.request.refundFrom, 10));
    const audit = await tenant(workspaceId, people.finance, async (client) => (await client.query<{ after: { refundDays: number } }>(
      `SELECT after FROM audit_events WHERE workspace_id = $1 AND action = 'finance_request.method_saved' AND entity_id = $2 ORDER BY occurred_at`, [workspaceId, stripe])).rows
      .map((row) => row.after.refundDays));
    expect(audit).toEqual([7, 10]);
  });

  it("sends a payable back to its requester when its approver returns it, and closes it when rejected", async () => {
    const payable = { action: "submit", id: randomUUID(), kind: "payable", vendorId: ids.vendor, currency: "AED", supplierReference: "Q-778", totalAmount: "10000",
      payNowAmount: "7000", authorisedBy: people.finance, materialLocation: "factory", legalEntityId: ids.entity, paidOnStatement: true };
    await expect(run("finance", { ...payable, payNowAmount: "12000" })).rejects.toThrow(/more than the full amount/);
    const raised = await run("finance", payable);
    expect(raised.request).toMatchObject({ supplierTaxNumber: "100123456700003", balance: "3000.0000", invoicePending: true, approvalStatus: "pending" });
    const returned = await run("payables", { action: "decide", id: raised.request.id, decision: "return", note: "Attach the supplier quote" });
    expect(returned.request).toMatchObject({ status: "needs_info", approvalStatus: "returned" });
    const again = await run("finance", { ...payable, action: "resubmit", id: raised.request.id, version: returned.request.version });
    expect(again.request).toMatchObject({ status: "new", approvalStatus: "pending" });
    const rejected = await run("payables", { action: "decide", id: raised.request.id, decision: "reject", note: "Over budget" });
    expect(rejected.request).toMatchObject({ status: "rejected", closeNote: "Over budget" });
    // Finance checks the statement amount on a closed request too (the SOA arrives later).
    const checked = await run("finance", { action: "update", id: raised.request.id, version: rejected.request.version, statementAmount: "6950", internalNote: "SOA Oct" });
    expect(checked.request).toMatchObject({ statementAmount: "6950.0000", internalNote: "SOA Oct", statementCheckedByName: "Finance" });
  });

  it("shows the requester only their own requests, and nothing across workspaces", async () => {
    const board = await tenant(workspaceId, people.sales, (client) => readBoard(client, ctx(client, "sales")));
    expect(board.canManage).toBe(false);
    expect(board.requests.every((request) => request.requestedBy === people.sales || request.salespersonId === people.sales)).toBe(true);
    expect(board.requests.every((request) => request.internalNote === null)).toBe(true);
    await expect(tenant(workspaceId, people.verifier, (client) => readBoard(client, ctx(client, "verifier")))).rejects.toThrow(/access/);
    const any = board.requests[0].id;
    await expect(tenant(otherWorkspaceId, people.outsider, (client) => readDetail(client, ctx(client, "outsider", otherWorkspaceId), any))).rejects.toThrow(/not found/);
    const outside = await tenant(otherWorkspaceId, people.outsider, (client) => readBoard(client, ctx(client, "outsider", otherWorkspaceId)));
    expect(outside.requests).toEqual([]);
    // RLS also refuses a write into another workspace's request.
    await expect(tenant(otherWorkspaceId, people.outsider, (client) => client.query(`INSERT INTO finance_request_events (id, workspace_id, request_id, kind) VALUES ($1, $2, $3, 'status')`,
      [randomUUID(), workspaceId, any]))).rejects.toThrow(/row-level security/);
  });

  it("raises a reached payment stage's invoice request once, in the salesperson's name, only when the firm turned it on", async () => {
    // The deal's planning case (the refunds above may have made it already: one case per deal).
    await received();
    const caseId = paidCase, projectId = randomUUID();
    const fixture = await pool.connect();
    try {
      await fixture.query("BEGIN");
      await fixture.query("SET LOCAL session_replication_role = replica");
      await fixture.query("INSERT INTO delivery_projects(id,workspace_id,case_id,name,created_by,reference,quote_id,started_at,currency) VALUES($1,$2,$3,'Villa 12',$4,'P-7','q1',now(),'AED')",
        [projectId, workspaceId, caseId, people.sales]);
      await fixture.query(`INSERT INTO project_scope_seals(id,workspace_id,project_id,quote_id,quote_number,revision_label,quote_hash,snapshot,content_hash,currency,total,accepted_at,accepted_by_name,sealed_by)
        VALUES($1,$2,$3,'q1',1,'R1','h','{}'::jsonb,$4,'AED',21000,now(),'Client',$5)`, [randomUUID(), workspaceId, projectId, "0".repeat(64), people.sales]);
      await fixture.query(`INSERT INTO commercial_payments(workspace_id,case_id,id,sort_order,title,amount,currency,due_date,status,source_quote_id) VALUES
        ($1,$2,'deposit',0,'Deposit 50%',10500,'AED',current_date - 1,'pending','q1'),
        ($1,$2,'balance',1,'Balance',10500,'AED',current_date + 30,'pending','q1')`, [workspaceId, caseId]);
      await fixture.query("COMMIT");
    } finally {
      fixture.release();
    }
    const raise = () => tenant(workspaceId, people.finance, (client) => raiseStageInvoiceRequests(client, workspaceId));
    expect(await raise()).toEqual({ raised: 0 });
    await tenant(workspaceId, people.finance, async (client) => saveRequestSettings(client, ctx(client, "finance"), { action: "save_settings",
      version: (await client.query<{ version: number }>("SELECT version FROM finance_request_settings WHERE workspace_id = $1", [workspaceId])).rows[0].version,
      financeInbox: "finance@example.com", stageInvoiceRequests: true }));
    expect(await raise()).toEqual({ raised: 1 });
    expect(await raise()).toEqual({ raised: 0 });
    const board = await tenant(workspaceId, people.finance, (client) => readBoard(client, ctx(client, "finance")));
    expect(board.requests.filter((request) => request.projectId === projectId)).toEqual([expect.objectContaining({
      source: "stage", status: "new", requestedBy: people.sales, paymentStageId: "deposit", paymentStageTitle: "Deposit 50%", clientEmail: "mohamed@example.com",
      net: "10000.0000", tax: "500.0000", total: "10500.0000" })]);
  });
});
