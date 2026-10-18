import { ConfigService } from "@nestjs/config";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvalStatus } from "../approvals/approval-engine.api";
import { readBudget } from "../client-portal/portal-budget";
import { chooseAlternative } from "../client-portal/portal-alternatives";
import { decidePortalChange, raiseChange, readPortalChanges } from "../client-portal/portal-changes";
import { ledgerDecision, readDesignChoices } from "../client-portal/portal-design-decisions";
import { readPortalSettings } from "../client-portal/portal-settings";
import type { PortalContact } from "../client-portal/portal-auth";
import { addEntry, addVersion, decideVersion, lockLedger, readLedger } from "../design/design-ledger.store";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { EsignService } from "../proposals/esign.service";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { ChangeRequestsService } from "./change-requests.service";
import { readChange } from "./change-request.store";
import { requestLedgerChangeApproval } from "./ledger-change-approval";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Fixtures are committed in their own
// workspaces; every command runs as the app role (wodana_app, forced RLS) in its own committed transaction, so
// replays, stale versions, separation of duties and tenants are real.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const NIL = "00000000-0000-4000-8000-000000000000";

type Seed = {
  workspaceId: string; caseId: string; projectId: string; ops: string; approver: string; grantId: string; viewerGrantId: string; quoteId: string;
  allowanceLine: string; worktopLine: string; categoryId: string; oakItem: string; walnutItem: string; ashItem: string; pineItem: string; poId: string;
};

integration("change requests, the client's budget and alternatives on real Postgres (§6.20, R1, R2, R11, E5-1, M-5)", { timeout: 60_000 }, () => {
  let pool: Pool;
  let storage: BrandAssetStorageService;
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 6 });
    storage = new BrandAssetStorageService(new ConfigService({ BRAND_ASSET_STORAGE_DIR: await mkdtemp(join(tmpdir(), "wodana-changes-")) }));
  });
  afterAll(() => pool.end());

  async function asApp<T>(workspaceId: string, actorId: string, work: (client: PoolClient) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE wodana_app");
      await client.query("SELECT set_config('app.current_workspace_id', $1, true), set_config('app.current_actor_id', $2, true)", [workspaceId, actorId]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async function seed(): Promise<Seed> {
    const ids: Seed = { workspaceId: randomUUID(), caseId: randomUUID(), projectId: randomUUID(), ops: randomUUID(), approver: randomUUID(), grantId: randomUUID(), viewerGrantId: randomUUID(),
      quoteId: randomUUID(), allowanceLine: "allow-1", worktopLine: "worktop-1", categoryId: randomUUID(), oakItem: randomUUID(), walnutItem: randomUUID(), ashItem: randomUUID(),
      pineItem: randomUUID(), poId: randomUUID() };
    const opsMembership = randomUUID(), approverMembership = randomUUID(), party = randomUUID(), opportunity = randomUUID(), role = randomUUID(), catalog = randomUUID(), book = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Omar Ops'),($3,$4,'Ada Approver')", [ids.ops, `${ids.ops.slice(0, 8)}@example.com`, ids.approver, `${ids.approver.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [ids.workspaceId, `cr-${ids.workspaceId.slice(0, 8)}`, ids.ops]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active')", [opsMembership, ids.workspaceId, ids.ops, approverMembership, ids.approver]);
      // Ada holds the change approver's permission (the E3 default policy for change requests).
      await client.query("INSERT INTO roles(id,workspace_id,code,name,is_system) VALUES($1,$2,'change_approver','Change approver',false)", [role, ids.workspaceId]);
      await client.query("INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT $1,$2,id FROM permissions WHERE code = 'commercial.approve'", [ids.workspaceId, role]);
      await client.query("INSERT INTO member_roles(workspace_id,membership_id,role_id) VALUES($1,$2,$3)", [ids.workspaceId, approverMembership, role]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, ids.workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, ids.workspaceId, party, randomUUID(), randomUUID(), opsMembership]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [ids.caseId, ids.workspaceId, opportunity, ids.ops]);
      await client.query("INSERT INTO client_portal_grants(id,workspace_id,case_id,name,phone,role,email) VALUES($1,$2,$3,'Maya Client','+971500000001','approver','maya@example.com'),($4,$2,$3,'Omar Client','+971500000002','viewer',NULL)",
        [ids.grantId, ids.workspaceId, ids.caseId, ids.viewerGrantId]);
      // The project, handed over on Thursday 15 Oct 2026; the working week is Monday to Friday (no calendar, no region pack).
      await client.query("INSERT INTO delivery_projects(id,workspace_id,case_id,name,reference,quote_id,started_at,created_by,status,promise_date,currency) VALUES($1,$2,$3,'Villa fit-out','P-7',$5,now(),$4,'active','2026-10-15','AED')",
        [ids.projectId, ids.workspaceId, ids.caseId, ids.ops, ids.quoteId]);
      // The accepted quotation: 120 000.50 with a worktop line and a 5 000 lighting allowance.
      await client.query(`INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency,total,detail)
        VALUES($1,$2,$3,0,1,'quotation','main','accepted','Main quote','AED',120000.5,'{"clientDecision":{"acceptedTotal":120000.5,"decidedAt":"2026-09-20T10:00:00.000Z"}}')`, [ids.workspaceId, ids.caseId, ids.quoteId]);
      await client.query(`INSERT INTO commercial_quote_lines(workspace_id,case_id,quote_id,id,sort_order,title,quantity,unit,unit_cost,rate,kind) VALUES
        ($1,$2,$3,$4,0,'Worktop',2.25,'m²',333,800,'item'), ($1,$2,$3,$5,1,'Lighting allowance',1,'sum',NULL,5000,'allowance')`, [ids.workspaceId, ids.caseId, ids.quoteId, ids.worktopLine, ids.allowanceLine]);
      // The catalogue: veneers with selling prices and stock (R2).
      await client.query("INSERT INTO catalogs(id,workspace_id,code,name) VALUES($1,$2,'main','Main')", [catalog, ids.workspaceId]);
      await client.query("INSERT INTO catalog_categories(id,workspace_id,catalog_id,code,name) VALUES($1,$2,$3,'veneer','Veneer')", [ids.categoryId, ids.workspaceId, catalog]);
      for (const [id, code, name] of [[ids.oakItem, "oak", "Oak veneer"], [ids.walnutItem, "walnut", "Walnut veneer"], [ids.ashItem, "ash", "Ash veneer"], [ids.pineItem, "pine", "Pine veneer"]])
        await client.query("INSERT INTO catalog_items(id,workspace_id,catalog_id,category_id,code,name,item_type,unit_code) VALUES($1,$2,$3,$4,$5,$6,'material','sqm')", [id, ids.workspaceId, catalog, ids.categoryId, code, name]);
      await client.query("INSERT INTO price_books(id,workspace_id,catalog_id,name,currency,status,effective_from) VALUES($1,$2,$3,'Retail','AED','active','2026-01-01')", [book, ids.workspaceId, catalog]);
      for (const [item, price, cost] of [[ids.oakItem, "80", "40"], [ids.walnutItem, "120", "60"], [ids.ashItem, "70", "SECRET"], [ids.pineItem, "60", "30"]])
        await client.query("INSERT INTO price_entries(workspace_id,price_book_id,item_id,method,price,cost,status) VALUES($1,$2,$3,'fixed',$4,$5,'active')", [ids.workspaceId, book, item, price, cost === "SECRET" ? "11" : cost]);
      const location = randomUUID(), stock = randomUUID();
      await client.query("INSERT INTO stock_locations(id,workspace_id,kind,name) VALUES($1,$2,'warehouse','Main store')", [location, ids.workspaceId]);
      await client.query("INSERT INTO stock_items(id,workspace_id,catalog_item_id,name,unit,normal_key) VALUES($1,$2,$3,'Walnut veneer','sqm','walnut veneer|sqm')", [stock, ids.workspaceId, ids.walnutItem]);
      await client.query("INSERT INTO stock_balances(workspace_id,item_id,location_id,on_hand) VALUES($1,$2,$3,40)", [ids.workspaceId, stock, location]);
      // An open purchase order for the oak veneer on this project (M-5).
      await client.query(`INSERT INTO purchase_orders(id,workspace_id,number,legal_entity_id,vendor_id,currency,status,payment_terms,created_by,approved_at,sent_at) VALUES($1,$2,'PO-0042',$3,$4,'AED','sent','on_delivery',$5,now(),now())`,
        [ids.poId, ids.workspaceId, randomUUID(), randomUUID(), ids.ops]);
      await client.query(`INSERT INTO purchase_order_lines(id,workspace_id,order_id,project_id,source,description,quantity,unit,unit_price,net,tax,total) VALUES($1,$2,$3,$4,'free','Oak veneer',12.5,'sqm',40,500,0,500)`,
        [randomUUID(), ids.workspaceId, ids.poId, ids.projectId]);
      await seedDefaultNotificationTemplates(client, ids.workspaceId);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    // The material list, confirmed and locked at the design sign-off; then the oak changes to smoked oak after the lock.
    await asApp(ids.workspaceId, ids.ops, async (client) => {
      const entry = { id: randomUUID(), versionId: randomUUID(), kind: "material", title: "Oak veneer", quantity: "12.5", unit: "sqm", unitPrice: "80", source: "showroom",
        saidAt: new Date(Date.now() - 60_000).toISOString(), catalogItemId: ids.oakItem };
      await addEntry(client, ids.workspaceId, ids.caseId, entry, { userId: ids.ops });
      await decideVersion(client, ids.workspaceId, ids.caseId, entry.id, entry.versionId, { decision: "confirmed", method: "in_person", decidedBy: "Maya Client", recordedBy: ids.ops });
      await lockLedger(client, ids.workspaceId, ids.caseId, ids.ops, "design_sign_off", null);
    });
    return ids;
  }

  function access(userId: string, permissions: string[]) {
    const self = {
      withPermission: (actor: unknown, workspaceId: string, permission: string, work: (client: PoolClient, user: { userId: string }) => Promise<unknown>) => self.withPermissions(actor, workspaceId, [permission], work),
      withPermissions: async (_actor: unknown, workspaceId: string, required: string[], work: (client: PoolClient, user: { userId: string }) => Promise<unknown>) => {
        if (!required.every((permission) => permissions.includes(permission))) throw new ForbiddenException(`Permissions required: ${required.join(", ")}`);
        return asApp(workspaceId, userId, (client) => work(client, { userId }));
      },
      hasPermission: async (_client: unknown, _workspaceId: string, _user: string, permission: string) => permissions.includes(permission),
    };
    return self;
  }
  const STAFF = ["pre_projects.view", "pre_projects.edit"];
  const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
  const config = new ConfigService({ WEB_ORIGIN: "https://app.example.com", NODE_ENV: "test" });
  const sentLinks: Array<{ to: string; link: string }> = [];
  const sentCodes: Array<{ to: string; code: string }> = [];
  const mailer = {
    sendSignatureRequest: async (input: { to: string; signUrl: string }) => { sentLinks.push({ to: input.to, link: input.signUrl }); return { status: "sent" }; },
    sendSignedCopy: async () => ({ status: "sent" }),
    sendPortalCode: async (input: { to: string; code: string }) => { sentCodes.push({ to: input.to, code: input.code }); return { status: "sent" }; },
  };
  const database = {
    query: (text: string, values?: unknown[]) => pool.query(text, values),
    tenantTransaction: (workspaceId: string, actorId: string, work: (client: PoolClient) => Promise<unknown>) => asApp(workspaceId, actorId, work),
  };
  function services(ids: Seed, userId: string, permissions = STAFF) {
    const esign = new EsignService(database as never, access(userId, permissions) as never, storage, {} as never, mailer as never, config);
    return { changes: new ChangeRequestsService(access(userId, permissions) as never, esign, storage), esign };
  }

  /** The client's side: their contact and grant, the portal settings, and a code check that passes only for `good`. */
  function portal(ids: Seed, grantId = ids.grantId, good = "123456") {
    const role = grantId === ids.grantId ? "approver" as const : "viewer" as const;
    const contact: PortalContact = { sessionId: randomUUID(), phone: "+971500000001", name: "Maya Client", nameConfirmed: true,
      grants: [{ id: grantId, caseId: ids.caseId, name: role === "approver" ? "Maya Client" : "Omar Client", role, email: null, confirmed: true, demo: false }] };
    return <T>(work: (ctx: never) => Promise<T>) => asApp(ids.workspaceId, NIL, async (client) =>
      work({ db: client, workspaceId: ids.workspaceId, contact, settings: await readPortalSettings(client, ids.workspaceId), today: "2026-10-06",
        verify: async (_purpose: string, _challenge: string, code: string) => code === good } as never));
  }

  /** The oak changed after sign-off (smoked oak at 100/sqm, +4 days): the change a request carries. */
  async function smokedOak(ids: Seed) {
    return asApp(ids.workspaceId, ids.ops, async (client) => {
      const ledger = await readLedger(client, ids.workspaceId, ids.caseId);
      const oak = ledger.entries[0];
      const versionId = randomUUID();
      await addVersion(client, ids.workspaceId, ids.caseId, oak.id, { versionId, entryVersion: oak.version, title: "Smoked oak veneer", quantity: "12.5", unit: "sqm", unitPrice: "100",
        timeImpactDays: 4, source: "meeting", saidAt: new Date(Date.now() - 30_000).toISOString(), catalogItemId: ids.oakItem }, { userId: ids.ops });
      // As the design service does: a change after sign-off opens the case's ledger-change approval (E3).
      await requestLedgerChangeApproval(client, ids.workspaceId, ids.caseId, ids.ops);
      return { entryId: oak.id, versionId };
    });
  }

  const draft = (ids: Seed, oak: { entryId: string; versionId: string }, overrides: Record<string, unknown> = {}) => ({
    id: randomUUID(), title: "Smoked oak and a shelf", kind: "replacement", description: "Darker veneer; one more shelf.", designImpact: "Kitchen elevation C updated.", timeImpactDays: 4,
    lines: [
      { id: randomUUID(), source: "ledger", action: "replace", title: "Smoked oak veneer", ledgerEntryId: oak.entryId, ledgerVersionId: oak.versionId },
      { id: randomUUID(), source: "custom", action: "add", title: "Extra shelf", quantity: "2", unit: "nos", unitPrice: "450.50" },
      { id: randomUUID(), source: "quote_line", action: "omit", title: "Worktop", quoteId: ids.quoteId, quoteLineId: ids.worktopLine, quantity: "0.25", unit: "m²", unitPrice: "800" },
      { id: randomUUID(), source: "allowance", action: "draw", title: "Pendant lights", quoteId: ids.quoteId, quoteLineId: ids.allowanceLine, quantity: "1", unitPrice: "5600" },
    ],
    ...overrides,
  });

  it("assesses a change, approves it on E3, and the client approves it in the portal with a code: relock, open orders, handover, budget (E5-1, M-5, R1)", async () => {
    const ids = await seed();
    const oak = await smokedOak(ids);
    const ops = services(ids, ids.ops).changes;
    const ada = services(ids, ids.approver, ["pre_projects.view"]).changes;
    const viewerOnly = services(ids, ids.ops, ["pre_projects.view"]).changes;
    const input = draft(ids, oak);
    await expect(viewerOnly.create(actor, ids.workspaceId, ids.caseId, input)).rejects.toBeInstanceOf(ForbiddenException);
    let view = await ops.create(actor, ids.workspaceId, ids.caseId, input);
    // Replay: the same command returns the change; the same id with other content is refused.
    view = await ops.create(actor, ids.workspaceId, ids.caseId, input);
    expect(view.changes).toHaveLength(1);
    await expect(ops.create(actor, ids.workspaceId, ids.caseId, { ...input, title: "Other" })).rejects.toBeInstanceOf(ConflictException);
    let change = view.changes[0];
    // Exact money: +250.00 (oak) + 901.00 (shelf) − 200.00 (worktop) + 5600.00 (allowance draw) = 6551.00; 4 working days from Thu 15 Oct → Wed 21 Oct.
    expect(change).toMatchObject({ reference: "CR-001", status: "draft", priceImpact: "6551.00", allowanceDraw: "5600.00", handoverBefore: "2026-10-15", handoverAfter: "2026-10-21" });
    expect(change.lines.map((line) => line.amount)).toEqual(["250.00", "901.00", "-200.00", "5600.00"]);
    expect(view.sources.ledgerChanges).toEqual([expect.objectContaining({ versionId: oak.versionId, priceImpact: "250.00" })]);
    // A stale edit is refused; a fresh one saves.
    await expect(ops.save(actor, ids.workspaceId, ids.caseId, change.id, { ...input, version: change.version - 1 })).rejects.toThrow(/another window/);
    view = await ops.save(actor, ids.workspaceId, ids.caseId, change.id, { ...input, version: change.version });
    change = view.changes[0];
    // The client sees nothing while the team assesses it.
    expect(await portal(ids)((ctx) => readPortalChanges((ctx as { db: PoolClient }).db, ids.workspaceId, (ctx as { contact: PortalContact }).contact.grants[0], ids.caseId, true))).toEqual([]);
    view = await ops.submit(actor, ids.workspaceId, ids.caseId, change.id, { version: change.version });
    change = view.changes[0];
    expect(change.approval).toMatchObject({ kind: "change_request", status: "pending", amount: "6551", currency: "AED" });
    // Separation of duties: the requester can't approve their own change; Ada can.
    await expect(ops.decide(actor, ids.workspaceId, ids.caseId, change.id, { decision: "approve" })).rejects.toThrow(/your own/);
    const commandId = randomUUID();
    view = await ada.decide(actor, ids.workspaceId, ids.caseId, change.id, { decision: "approve", approvalVersion: change.approval!.version, commandId });
    // A replay of the same decision decides once; a stale version is refused.
    await ada.decide(actor, ids.workspaceId, ids.caseId, change.id, { decision: "approve", commandId });
    change = view.changes[0];
    expect(change).toMatchObject({ status: "with_client", approval: { status: "approved" } });
    expect(change.events.map((event) => event.event)).toEqual(["raised", "edited", "submitted", "approved_internal"]);

    // The client: the viewer reads it but can't decide; a wrong code decides nothing; the decision-maker approves.
    const seen = await portal(ids, ids.viewerGrantId)((ctx) => readPortalChanges((ctx as { db: PoolClient }).db, ids.workspaceId, (ctx as { contact: PortalContact }).contact.grants[0], ids.caseId, true));
    expect(seen).toEqual([expect.objectContaining({ id: change.id, status: "waiting", priceImpact: "6551.00", canDecide: false, handoverAfter: "2026-10-21" })]);
    await expect(portal(ids, ids.viewerGrantId)((ctx) => decidePortalChange(ctx, { caseId: ids.caseId, changeId: change.id, decision: "accept", code: "123456" }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(portal(ids)((ctx) => decidePortalChange(ctx, { caseId: ids.caseId, changeId: change.id, decision: "accept", code: "000000", version: change.version }))).rejects.toThrow(/code/);
    await expect(portal(ids)((ctx) => decidePortalChange(ctx, { caseId: ids.caseId, changeId: change.id, decision: "accept", code: "123456", version: change.version - 1 }))).rejects.toThrow(/updated/);
    const decided = await portal(ids)((ctx) => decidePortalChange(ctx, { caseId: ids.caseId, changeId: change.id, decision: "accept", code: "123456", version: change.version }));
    expect(decided.audit).toMatchObject({ decision: "approve", status: "approved", replayed: false });
    expect((await portal(ids)((ctx) => decidePortalChange(ctx, { caseId: ids.caseId, changeId: change.id, decision: "accept", code: "123456" }))).audit).toMatchObject({ replayed: true });

    view = await ops.list(actor, ids.workspaceId, ids.caseId);
    change = view.changes[0];
    expect(change).toMatchObject({ status: "approved", decisionMethod: "portal", decidedByName: "Maya Client", lockNumber: 2, handoverAfter: "2026-10-21" });
    // M-5: the open order for the oak is listed; the handover date moved.
    expect(change.purchaseOrders).toEqual([{ purchaseOrderId: ids.poId, number: "PO-0042", status: "sent", matchedOn: "Oak veneer" }]);
    const promise = await asApp(ids.workspaceId, ids.ops, (client) => client.query("SELECT promise_date::text AS d FROM delivery_projects WHERE id = $1", [ids.projectId]));
    expect(promise.rows[0].d).toBe("2026-10-21");
    // E5-1: the ledger is locked again with the smoked oak, confirmed by the client; the ledger-change approval closed.
    const ledger = await asApp(ids.workspaceId, ids.ops, (client) => readLedger(client, ids.workspaceId, ids.caseId));
    expect(ledger).toMatchObject({ state: "locked", lock: { number: 2, reason: "change_approved" } });
    expect(ledger.entries[0].current).toMatchObject({ id: oak.versionId, status: "confirmed", confirmationMethod: "portal", confirmedByName: "Maya Client" });
    expect((await asApp(ids.workspaceId, ids.ops, (client) => approvalStatus(client, ids.workspaceId, "ledger_change", ids.caseId)))?.status).toBe("cancelled");
    // R1: 120 000.50 agreed + 951.00 change (6551.00 less the 5600.00 drawn on the allowance) + 600.00 allowance overrun = 121 551.50.
    const budget = await asApp(ids.workspaceId, ids.ops, async (client) => readBudget(client, ids.workspaceId, ids.caseId, "AED",
      await readPortalChanges(client, ids.workspaceId, { id: ids.grantId, caseId: ids.caseId, name: "Maya", role: "approver", email: null, confirmed: true, demo: false }, ids.caseId, true)));
    expect(budget).toMatchObject({ agreed: "120000.50", changesTotal: "951.00", allowanceIncluded: "5000.00", allowanceSpent: "5600.00", allowanceOverrun: "600.00", forecast: "121551.50",
      changes: [{ kind: "change_request", id: change.id, reference: "CR-001", amount: "951.00", method: "portal" }] });
    expect(JSON.stringify(budget)).not.toMatch(/333|unitCost|cost/);
    // The team heard the decision; nothing is decided twice.
    const told = await asApp(ids.workspaceId, ids.ops, (client) => client.query(`SELECT count(*)::int AS n FROM notifications WHERE workspace_id = $1 AND event_type = 'change_request.decided' AND recipient_id = $2`, [ids.workspaceId, ids.ops]));
    expect(told.rows[0].n).toBeGreaterThan(0);
    await expect(ops.withdraw(actor, ids.workspaceId, ids.caseId, change.id, { version: change.version, reason: "x" })).rejects.toThrow(/already approved/);

    // Another tenant sees and changes nothing.
    const other = await seed();
    await expect(asApp(other.workspaceId, other.ops, (client) => readChange(client, other.workspaceId, ids.caseId, change.id))).rejects.toBeInstanceOf(NotFoundException);
    await expect(services(other, other.ops).changes.submit(actor, other.workspaceId, ids.caseId, change.id, { version: change.version })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns, resends, signs a change by link without a login (R11), and keeps a declined change declined", async () => {
    const ids = await seed();
    const { changes: ops, esign } = services(ids, ids.ops);
    const ada = services(ids, ids.approver, ["pre_projects.view"]).changes;
    const input = { id: randomUUID(), title: "Extra shelf", kind: "addition", lines: [{ id: randomUUID(), source: "custom", action: "add", title: "Shelf", quantity: "1", unitPrice: "450.50" }] };
    let change = (await ops.create(actor, ids.workspaceId, ids.caseId, input)).changes[0];
    change = (await ops.submit(actor, ids.workspaceId, ids.caseId, change.id, { version: change.version })).changes[0];
    // Returned with a note: back to draft; sending to sign before approval is refused.
    await expect(ada.decide(actor, ids.workspaceId, ids.caseId, change.id, { decision: "return" })).rejects.toThrow(/Say what needs to change/);
    change = (await ada.decide(actor, ids.workspaceId, ids.caseId, change.id, { decision: "return", note: "Use the oak shelf" })).changes[0];
    expect(change.status).toBe("draft");
    await expect(ops.send(actor, ids.workspaceId, ids.caseId, change.id, { commandId: randomUUID() })).rejects.toThrow(/Approve the change inside the firm first/);
    change = (await ops.submit(actor, ids.workspaceId, ids.caseId, change.id, { version: change.version })).changes[0];
    change = (await ada.decide(actor, ids.workspaceId, ids.caseId, change.id, { decision: "approve" })).changes[0];
    // The link goes by email to the decision-maker; the same command returns it without a second email.
    const commandId = randomUUID();
    const sent = await ops.send(actor, ids.workspaceId, ids.caseId, change.id, { commandId });
    expect(sent.emailed).toBe("maya@example.com");
    const again = await ops.send(actor, ids.workspaceId, ids.caseId, change.id, { commandId });
    expect([again.link, sentLinks.filter((item) => item.link === sent.link)]).toEqual([null, [{ to: "maya@example.com", link: sent.link }]]);
    const token = new URL(sent.link!).pathname.split("/").pop()!;
    const page = await esign.view(token);
    expect(page).toMatchObject({ state: "open", document: { reference: "CR-001", amount: "450.5000", currency: "AED" }, signer: { name: "Maya Client" } });
    await expect(esign.sign(token, { documentSha256: "0".repeat(64), name: "Maya Client", consent: true, signature: { kind: "typed", text: "Maya Client" } }, { ip: "203.0.113.9" })).rejects.toThrow(/changed/);
    // §0.3 P4: the signer confirms a one-time code before signing.
    await expect(esign.sign(token, { documentSha256: page.document.sha256, name: "Maya Client", consent: true, signature: { kind: "typed", text: "Maya Client" } }, { ip: "203.0.113.9" }))
      .rejects.toThrow(/Confirm the code/);
    expect(await esign.sendCode(token, { channel: "email" })).toMatchObject({ channel: "email", sentTo: expect.stringContaining("@example.com") });
    expect(await esign.verifyCode(token, { code: sentCodes.at(-1)!.code })).toEqual({ verified: true, message: null });
    const signed = await esign.sign(token, { documentSha256: page.document.sha256, name: "Maya Client", consent: true, signature: { kind: "typed", text: "Maya Client" } }, { ip: "203.0.113.9", userAgent: "test" });
    expect(signed).toMatchObject({ state: "signed", replayed: false });
    expect((await esign.sign(token, { documentSha256: page.document.sha256 }, {})).replayed).toBe(true);
    change = (await ops.list(actor, ids.workspaceId, ids.caseId)).changes[0];
    expect(change).toMatchObject({ status: "approved", decisionMethod: "signed_link", decidedByName: "Maya Client", signing: { status: "signed" } });
    // The signed copy is a document card in the client's portal.
    const choices = await portal(ids)((ctx) => readPortalChanges((ctx as { db: PoolClient }).db, ids.workspaceId, (ctx as { contact: PortalContact }).contact.grants[0], ids.caseId, true));
    expect(choices[0]).toMatchObject({ status: "approved", signed: true, method: "signed_link" });

    // A change the client raised: with the team until assessed; declined after it's sent, it stays declined.
    const raisedId = randomUUID();
    await portal(ids)((ctx) => raiseChange(ctx, { caseId: ids.caseId, id: raisedId, title: "Wallpaper in the study", description: "A green one" }));
    await expect(portal(ids, ids.viewerGrantId)((ctx) => raiseChange(ctx, { caseId: ids.caseId, id: randomUUID(), title: "x" }))).rejects.toBeInstanceOf(ForbiddenException);
    let raised = (await ops.list(actor, ids.workspaceId, ids.caseId)).changes.find((item) => item.id === raisedId)!;
    expect(raised).toMatchObject({ status: "draft", raisedByClient: true, raisedByName: "Maya Client" });
    const raisedNotice = await asApp(ids.workspaceId, ids.ops, (client) => client.query(`SELECT count(*)::int AS n FROM notifications WHERE workspace_id = $1 AND event_type = 'change_request.raised'`, [ids.workspaceId]));
    expect(raisedNotice.rows[0].n).toBeGreaterThan(0);
    raised = (await ops.save(actor, ids.workspaceId, ids.caseId, raisedId, { title: "Wallpaper in the study", version: raised.version, timeImpactDays: 1,
      lines: [{ id: randomUUID(), source: "custom", action: "add", title: "Wallpaper", quantity: "14", unit: "sqm", unitPrice: "35" }] })).changes.find((item) => item.id === raisedId)!;
    raised = (await ops.submit(actor, ids.workspaceId, ids.caseId, raisedId, { version: raised.version })).changes.find((item) => item.id === raisedId)!;
    await ada.decide(actor, ids.workspaceId, ids.caseId, raisedId, { decision: "approve" });
    await expect(portal(ids)((ctx) => decidePortalChange(ctx, { caseId: ids.caseId, changeId: raisedId, decision: "decline" }))).rejects.toThrow(/Say why/);
    await portal(ids)((ctx) => decidePortalChange(ctx, { caseId: ids.caseId, changeId: raisedId, decision: "decline", note: "Too dark" }));
    await expect(portal(ids)((ctx) => decidePortalChange(ctx, { caseId: ids.caseId, changeId: raisedId, decision: "accept", code: "123456" }))).rejects.toThrow(/already declined/);
    raised = (await ops.list(actor, ids.workspaceId, ids.caseId)).changes.find((item) => item.id === raisedId)!;
    expect(raised).toMatchObject({ status: "declined", declineNote: "Too dark" });
  });

  it("offers up to three alternatives when the client declines a choice, in stock first, and writes the pick to the ledger (R2)", async () => {
    const ids = await seed();
    const run = portal(ids);
    const read = () => run((ctx) => readDesignChoices((ctx as { db: PoolClient }).db, ids.workspaceId, (ctx as { contact: PortalContact }).contact.grants[0], ids.caseId, true));
    // A new choice after sign-off: the client is asked to confirm it, and declines.
    const entry = await asApp(ids.workspaceId, ids.ops, async (client) => {
      const created = { id: randomUUID(), versionId: randomUUID(), kind: "material", title: "Oak veneer (doors)", quantity: "10", unit: "sqm", unitPrice: "80", source: "showroom",
        saidAt: new Date(Date.now() - 60_000).toISOString(), catalogItemId: ids.oakItem };
      await addEntry(client, ids.workspaceId, ids.caseId, created, { userId: ids.ops });
      return created;
    });
    await run((ctx) => ledgerDecision(ctx, { caseId: ids.caseId, entryId: entry.id, versionId: entry.versionId, decision: "decline", note: "Too light" }));
    const declined = (await read()).choices.find((choice) => choice.entryId === entry.id)!;
    // Walnut is in stock (first, though over budget); ash and pine are within the 800.00 budget; the oak itself is never offered.
    expect(declined.alternatives.map((item) => [item.title, item.inStock, item.inBudget, item.lineTotal])).toEqual([
      ["Walnut veneer", true, false, "1200.00"], ["Ash veneer", false, true, "700.00"], ["Pine veneer", false, true, "600.00"]]);
    expect(JSON.stringify(declined.alternatives)).not.toMatch(/"11"|cost|40\.0/);
    // A viewer can't choose; the decision-maker picks ash: a new confirmed version, written by the client.
    await expect(portal(ids, ids.viewerGrantId)((ctx) => chooseAlternative(ctx, { caseId: ids.caseId, alternativeId: declined.alternatives[1].id }))).rejects.toBeInstanceOf(ForbiddenException);
    const chosen = await run((ctx) => chooseAlternative(ctx, { caseId: ids.caseId, alternativeId: declined.alternatives[1].id }));
    expect((await run((ctx) => chooseAlternative(ctx, { caseId: ids.caseId, alternativeId: declined.alternatives[1].id }))).audit).toMatchObject({ replayed: true });
    await expect(run((ctx) => chooseAlternative(ctx, { caseId: ids.caseId, alternativeId: declined.alternatives[0].id }))).rejects.toThrow(/changed since/);
    const ledger = await asApp(ids.workspaceId, ids.ops, (client) => readLedger(client, ids.workspaceId, ids.caseId));
    expect(ledger.entries.find((item) => item.id === entry.id)!.current).toMatchObject({ id: chosen.versionId, number: 2, title: "Ash veneer", unitPrice: "70.00", priceImpact: "-100.00",
      status: "confirmed", confirmationMethod: "portal", fromPortal: true, afterLock: true });
    expect((await read()).choices.find((choice) => choice.entryId === entry.id)!.alternatives).toEqual([]);
  });
});
