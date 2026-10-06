import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialRepository } from "../commercial/commercial-repository";
import { freezeHash } from "../commercial/commercial.domain";
import type { CommercialData } from "../commercial/commercial.types";
import { FactoryService } from "../factory/factory.service";
import { processFactoryDeadlines } from "../factory/factory-reminders";
import { InventoryService } from "../inventory/inventory.service";
import { processStockLevels } from "../inventory/stock-levels";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { ProjectCoreService } from "../project-core/project-core.service";
import { ProjectWorkService } from "../project-core/project-work.service";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { OrdersService } from "./orders.service";
import { tellOverOrdered } from "./purchasing-changes";
import { tellMaterialsReady } from "./materials-ready";
import { closeSettledBlockers, raiseLateBlockers, readLineBlockers } from "./purchasing-blockers";
import { ReceivingService } from "./receiving.service";
import { SuppliersService } from "./suppliers.service";
import { answerSiteAccess, arrangeSiteAccess, readClientSiteAccess, readSiteAccess } from "../site/site-access";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const ALL = ["vendors.view", "vendors.manage", "vendors.approve", "purchasing.view", "purchasing.manage", "purchasing.approve", "stock.view", "stock.manage", "stock.adjust", "stock.receive",
  "stock.inspect", "workspace.settings.manage", "payables.view", "projects.manage", "projects.view"];
const FACTORY = ["factory.view", "factory.manage", "factory.report", "factory.approve"];

type World = {
  client: PoolClient; workspaceId: string; caseId: string; quoteId: string; manager: string; designer: string; managerMembership: string; designerMembership: string;
  core: ProjectCoreService; work: ProjectWorkService;
};

/**
 * Operations v2 (purchasing, stock and factory as one flow): a project on hold holds its ordering, shipments
 * are followed inside the order, a late line blocks the work that needs it, low stock is told once and
 * restocked onto its item, and made goods refused at site go back to be made again.
 */
integration("operations v2 (plan §6.14–6.16, D-8, D-11, D-20, D-26, D-38, D-41, D-45)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(run: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), quoteId = randomUUID(), manager = randomUUID(), designer = randomUUID();
    const managerMembership = randomUUID(), designerMembership = randomUUID(), party = randomUUID(), opportunity = randomUUID(), kitchen = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Omar Manager'),($3,$4,'Dana Buyer')", [manager, `${manager.slice(0, 8)}@example.com`, designer, `${designer.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [workspaceId, `ops-${workspaceId.slice(0, 8)}`, manager]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active')", [managerMembership, workspaceId, manager, designerMembership, designer]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, workspaceId, party, randomUUID(), randomUUID(), designerMembership]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunity, manager]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Kitchen')", [kitchen, workspaceId, caseId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','AED')", [workspaceId, caseId, quoteId]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      const run_ = (userId: string) => (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const member = (userId: string) => (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const access = (userId: string) => ({ asMember: member(userId), withPermission: run_(userId), withAnyPermission: run_(userId),
        hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => ["projects.manage", "projects.view", "pre_projects.view", "workspace.settings.manage"].includes(code) } as never);
      const builder = new QuotationBuilderService({ withPermission: run_(manager), withPermissions: run_(manager), withAnyPermission: run_(manager), hasPermission: async () => true } as never, {} as never);
      await builder.apply(actor, workspaceId, caseId, quoteId, { ops: [
        { op: "upsert", line: { id: "a", title: "Kitchen cabinets", unit: "m", quantity: "4.5", rate: "1200", areaId: kitchen } },
        { op: "upsert", line: { id: "b", title: "Worktop", unit: "m²", quantity: "2.25", rate: "800", areaId: kitchen } },
      ] });
      await run({ client, workspaceId, caseId, quoteId, manager, designer, managerMembership, designerMembership, core: new ProjectCoreService(access(manager)), work: new ProjectWorkService(access(manager)) });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  /** The client accepted, the project started with a buying company and an approved supplier; services per person. */
  async function started(w: World, settings: { threshold?: string | null; inspection?: boolean } = {}) {
    const loaded = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!;
    const data = { ...(loaded.content as CommercialData), revision: loaded.revision };
    const quote = data.quotes.find((item) => item.id === w.quoteId)!;
    quote.status = "accepted";
    quote.hash = freezeHash(quote);
    const total = 4.5 * 1200 + 2.25 * 800;
    quote.clientDecision = { decision: "accept", quoteHash: quote.hash, selectedOptionLineIds: [], baseTotal: total, optionsTotal: 0, acceptedTotal: total,
      decidedAt: "2026-09-20T10:00:00.000Z", decidedBy: "Maya Client", method: "signed_document", recordedBy: "Omar Manager" };
    data.agreement = { quoteId: w.quoteId, quoteHash: quote.hash, reference: "AG-7", terms: "", evidence: "signed.pdf", evidenceKind: "operational", status: "executed", executedAt: "2026-09-21T10:00:00.000Z", executedBy: "Omar Manager" };
    data.payments = [{ id: "p1", sourceQuoteId: w.quoteId, title: "Advance", amount: total, dueDate: "", requiredForRelease: true, requiredForProduction: true, status: "verified", proof: "bank transfer",
      reference: "TT-1", evidenceKind: "operational" }];
    data.revision = loaded.revision + 1;
    await commercialRepository.save(w.client, w.workspaceId, w.caseId, data);
    const { projectId } = await w.core.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.managerMembership });
    const company = randomUUID(), vendor = randomUUID(), profile = randomUUID();
    await w.client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone) VALUES($1,$2,'FAC','Studio Furniture','Studio Furniture LLC','AE','AED','en-AE','Asia/Dubai')`, [company, w.workspaceId]);
    await w.client.query(`INSERT INTO tax_profiles(id,workspace_id,legal_entity_id,name,jurisdiction_code,scheme,prices_include_tax,effective_from,version) VALUES($1,$2,$3,'VAT','AE','vat',false,now(),1)`, [profile, w.workspaceId, company]);
    await w.client.query(`INSERT INTO tax_rates(workspace_id,tax_profile_id,code,label,rate,is_default) VALUES($1,$2,'standard','Standard','5',true)`, [w.workspaceId, profile]);
    // Each call is its own transaction, as in the app: a command that fails part-way leaves nothing behind.
    const access = (userId: string, permissions: string[]) => {
      const run = async (_a: unknown, _w: string, code: string | string[], fn: (c: PoolClient, u: { userId: string }) => unknown) => {
        if (!(Array.isArray(code) ? code : [code]).some((item) => permissions.includes(item))) throw new Error("Not allowed");
        await w.client.query("SAVEPOINT command");
        try { const result = await fn(w.client, { userId }); await w.client.query("RELEASE SAVEPOINT command"); return result; }
        catch (error) { await w.client.query("ROLLBACK TO SAVEPOINT command"); throw error; }
      };
      return { withPermission: run, withAnyPermission: run, hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code) } as never;
    };
    const as = (userId: string, permissions = ALL) => ({
      orders: new OrdersService(access(userId, permissions)), receiving: new ReceivingService(access(userId, permissions)), stock: new InventoryService(access(userId, permissions)),
      suppliers: new SuppliersService(access(userId, permissions)),
      factory: new FactoryService(access(userId, permissions), new OrdersService(access(userId, permissions)), new InventoryService(access(userId, permissions))),
    });
    await w.client.query(`INSERT INTO workspace_purchasing_settings (workspace_id, approval_threshold, require_material_signoff, require_approved_supplier, require_inspection) VALUES ($1, $2, false, true, $3)`,
      [w.workspaceId, settings.threshold === undefined ? null : settings.threshold, settings.inspection ?? false]);
    const buyer = as(w.designer), manager = as(w.manager);
    const saved = await buyer.suppliers.save(actor, w.workspaceId, { id: vendor, version: 0, name: "Nile Timber", entityIds: [company], email: "orders@nile.example" });
    await manager.suppliers.approve(actor, w.workspaceId, vendor, { version: saved.suppliers[0].version, approval: "approved" });
    // The buyer holds purchasing.manage and stock.manage for the notices that go by permission.
    const role = randomUUID();
    await w.client.query("INSERT INTO roles (id, workspace_id, code, name) VALUES ($1, $2, 'buyer', 'Buyer')", [role, w.workspaceId]);
    await w.client.query("INSERT INTO role_permissions (workspace_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE code IN ('purchasing.manage', 'stock.manage')", [w.workspaceId, role]);
    await w.client.query("INSERT INTO member_roles (workspace_id, membership_id, role_id) VALUES ($1, $2, $3)", [w.workspaceId, w.designerMembership, role]);
    return { projectId, company, vendor, buyer, manager, as };
  }

  /** Draft → placed → sent, as the buyer. */
  async function placeOrder(orders: OrdersService, workspaceId: string, vendor: string, lines: unknown[], extra: Record<string, unknown> = {}) {
    const id = randomUUID();
    let state = await orders.create(actor, workspaceId, { id, vendorId: vendor, lines, ...extra });
    state = await orders.command(actor, workspaceId, id, { action: "submit", version: state.order.version, ...extra });
    state = await orders.command(actor, workspaceId, id, { action: "send", version: state.order.version });
    return state;
  }

  const told = async (w: World, event: string) => (await w.client.query<{ recipient: string; subject: string; body: string }>(
    "SELECT recipient_id AS recipient, subject, body FROM notifications WHERE workspace_id = $1 AND event_type = $2 AND channel = 'in_app' ORDER BY created_at", [w.workspaceId, event])).rows;

  it("holds ordering for a project on hold until someone says why; the reason stays on the order and the manager hears (D-8)", async () => {
    await world(async (w) => {
      const { projectId, vendor, buyer } = await started(w);
      let detail = await w.core.get(actor, w.workspaceId, projectId);
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer", quantity: "20", unit: "sheets", clientChoice: false, version: detail.project.version });
      await w.client.query("UPDATE delivery_projects SET status = 'on_hold', hold_reason = 'Client travelling', held_at = now(), held_by = $2 WHERE id = $1", [projectId, w.manager]);
      const oak = (await buyer.orders.needs(actor, w.workspaceId)).needs.find((need) => need.title === "Oak veneer")!;
      expect(oak.projectStatus).toBe("on_hold");
      const id = randomUUID();
      let order = await buyer.orders.create(actor, w.workspaceId, { id, vendorId: vendor, lines: [{ source: "material", materialItemId: oak.sourceId, quantity: "20", unitPrice: "90" }] });
      expect(order.holdProjects.map((project) => project.id)).toEqual([projectId]);
      await expect(buyer.orders.command(actor, w.workspaceId, id, { action: "submit", version: order.order.version })).rejects.toThrow(/PRJ-0001 is on hold\. Say why this order goes ahead anyway/);
      order = await buyer.orders.command(actor, w.workspaceId, id, { action: "submit", version: order.order.version, holdReason: "Client asked to keep the veneer reserved" });
      expect([order.order.status, order.order.holdOverrideReason, order.order.holdOverrideByName, order.holdProjects]).toEqual(["approved", "Client asked to keep the veneer reserved", "Dana Buyer", []]);
      expect(order.events.map((event) => event.kind)).toContain("hold_override");
      expect((await told(w, "purchasing.hold_override")).map((row) => row.recipient)).toEqual([w.manager]);
      // Sending goes ahead on the same reason; nobody is chased to order for a project on hold.
      order = await buyer.orders.command(actor, w.workspaceId, id, { action: "send", version: order.order.version });
      expect(order.order.status).toBe("sent");
    });
  });

  it("follows shipments inside the order and lists each order's due date, lines to come and shipment; a later arrival tells the buyer and the manager once", async () => {
    await world(async (w) => {
      const { projectId, vendor, buyer, manager } = await started(w);
      const cabinets = (await w.core.scope(actor, w.workspaceId, projectId)).lines.find((line) => line.title === "Kitchen cabinets")!;
      let detail = await w.core.get(actor, w.workspaceId, projectId);
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer", quantity: "20", unit: "sheets", clientChoice: false, boqLineIds: [cabinets.id], version: detail.project.version });
      const oak = (await buyer.orders.needs(actor, w.workspaceId)).needs.find((need) => need.title === "Oak veneer")!;
      let order = await placeOrder(buyer.orders, w.workspaceId, vendor, [{ source: "material", materialItemId: oak.sourceId, quantity: "20", unitPrice: "90" }], { expectedDate: "2026-10-12" });
      const shipment = randomUUID();
      await expect(buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "track", version: order.order.version, shipmentId: shipment })).rejects.toThrow(/Add the carrier/);
      await expect(buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "track", version: order.order.version, shipmentId: shipment, carrier: "Aramex", trackingUrl: "aramex.com/1" }))
        .rejects.toThrow(/starts with https/);
      order = await buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "track", version: order.order.version, shipmentId: shipment, carrier: "Aramex", trackingRef: "AX-77",
        trackingUrl: "https://aramex.example/AX-77", status: "in_transit", shippedOn: "2026-10-01", eta: "2026-10-10" });
      expect(order.shipments.map((row) => [row.carrier, row.trackingRef, row.status, row.eta])).toEqual([["Aramex", "AX-77", "in_transit", "2026-10-10"]]);
      // The list shows what's still to come, when it's due and where the shipment is.
      const listed = (await buyer.orders.list(actor, w.workspaceId)).orders.find((row) => row.id === order.order.id)!;
      expect([listed.linesLeft, listed.due, listed.shipment, listed.projects.map((project) => project.status)]).toEqual([1, "2026-10-12", { status: "in_transit", eta: "2026-10-10", carrier: "Aramex" }, ["active"]]);
      // A stale version is refused; a later arrival tells the buyer and the manager, once for that date.
      await expect(buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "track", version: order.order.version, shipmentId: shipment, shipmentVersion: 0, carrier: "Aramex", eta: "2026-10-15" }))
        .rejects.toThrow(/Someone else changed this shipment/);
      order = await buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "track", version: order.order.version, shipmentId: shipment, shipmentVersion: order.shipments[0].version,
        carrier: "Aramex", trackingRef: "AX-77", status: "delayed", eta: "2026-10-15", note: "Held at customs" });
      expect((await told(w, "purchasing.shipment_late")).map((row) => [row.recipient, row.body])).toEqual([[w.manager, "Nile Timber: now arrives 2026-10-15 (was 2026-10-10): Held at customs"]]);
      // It arrives: the order's still to come falls to nothing and the shipment is marked arrived by the buyer.
      await manager.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order.order.id, place: `site:${projectId}`, receivedOn: "2026-09-28", lines: [{ orderLineId: order.lines[0].id, received: "20" }] });
      const after = (await buyer.orders.list(actor, w.workspaceId)).orders.find((row) => row.id === order.order.id)!;
      expect([after.status, after.linesLeft, after.due]).toEqual(["received", 0, null]);
    });
  });

  it("lists what's on its way to a project's site: supplier orders delivering there and moves to it (D-20)", async () => {
    await world(async (w) => {
      const { projectId, vendor, buyer } = await started(w);
      let detail = await w.core.get(actor, w.workspaceId, projectId);
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer", quantity: "20", unit: "sheets", clientChoice: false, version: detail.project.version });
      const oak = (await buyer.orders.needs(actor, w.workspaceId)).needs.find((need) => need.title === "Oak veneer")!;
      const toSite = await placeOrder(buyer.orders, w.workspaceId, vendor, [{ source: "material", materialItemId: oak.sourceId, quantity: "12", unitPrice: "90" }], { deliverTo: "site", expectedDate: "2026-10-09" });
      await placeOrder(buyer.orders, w.workspaceId, vendor, [{ source: "material", materialItemId: oak.sourceId, quantity: "8", unitPrice: "90" }], { deliverTo: "warehouse", overReason: "Stock" });
      // Free glue at the warehouse goes to the site.
      const place = randomUUID();
      await buyer.stock.saveLocation(actor, w.workspaceId, { id: place, kind: "warehouse", name: "Main store" });
      let stock = await buyer.stock.command(actor, w.workspaceId, { id: randomUUID(), action: "add", locationId: place, name: "Wood glue", unit: "nos", quantity: "10", reason: "Opening stock" });
      const glue = stock.rows.find((row) => row.itemName === "Wood glue")!;
      await buyer.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: toSite.order.id, place: `site:${projectId}`, receivedOn: "2026-09-27", lines: [{ orderLineId: toSite.lines[0].id, received: "2" }] });
      const site = (await buyer.stock.locations(actor, w.workspaceId)).locations.find((row) => row.kind === "site")!;
      const move = await buyer.stock.send(actor, w.workspaceId, { id: randomUUID(), fromLocationId: place, toLocationId: site.id, lines: [{ itemId: glue.itemId, quantity: "4" }] });
      const coming = await buyer.receiving.arrivals(actor, w.workspaceId, projectId);
      expect(coming.orders.map((row) => [row.number, row.items.map((item) => [item.description, item.left])])).toEqual([[toSite.order.number, [["Oak veneer", "10"]]]]);
      expect(coming.moves.map((row) => [row.id, row.items, row.toProjectId])).toEqual([[move.transfer.id, "Wood glue", projectId]]);
      expect([coming.canReceive, coming.canReceiveMoves]).toEqual([true, true]);
      stock = await buyer.stock.stock(actor, w.workspaceId);
      expect(stock.inTransit).toBe(1);
    });
  });

  it("asks the client to confirm site access for the supplier's day, gives the supervisor a task, and moves the delivery with a reason (D-29)", async () => {
    await world(async (w) => {
      const { projectId, vendor, buyer } = await started(w);
      // Days from the workspace's today, so the test holds on any date.
      const today = (await w.client.query<{ day: string }>("SELECT (now() AT TIME ZONE 'Asia/Dubai')::date::text AS day")).rows[0].day;
      const plus = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
      const supervisor = randomUUID(), supervisorMembership = randomUUID(), grant = randomUUID();
      await w.client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Sami Supervisor')", [supervisor, `${supervisor.slice(0, 8)}@example.com`]);
      await w.client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [supervisorMembership, w.workspaceId, supervisor]);
      await w.client.query("INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager,active,role_keys) VALUES($1,$2,$3,false,true,ARRAY['site_supervisor'])",
        [w.workspaceId, projectId, supervisorMembership]);
      await w.client.query("INSERT INTO client_portal_settings(workspace_id,slug,enabled) VALUES($1,'studio',true)", [w.workspaceId]);
      await w.client.query("INSERT INTO client_portal_grants(id,workspace_id,case_id,name,phone,role,email) VALUES($1,$2,$3,'Maya Client','+15550100','approver','maya@example.com')",
        [grant, w.workspaceId, w.caseId]);
      let detail = await w.core.get(actor, w.workspaceId, projectId);
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer", quantity: "20", unit: "sheets", clientChoice: false, version: detail.project.version });
      const oak = (await buyer.orders.needs(actor, w.workspaceId)).needs.find((need) => need.title === "Oak veneer")!;
      let order = await placeOrder(buyer.orders, w.workspaceId, vendor, [{ source: "material", materialItemId: oak.sourceId, quantity: "20", unitPrice: "90" }], { deliverTo: "site", expectedDate: plus(10) });
      expect(await readSiteAccess(w.client, w.workspaceId, projectId)).toEqual([]);

      // The supplier confirms a day: the client is asked (in the portal and by email) and the supervisor gets a task for it.
      order = await buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "confirm", version: order.order.version, promisedDate: plus(5) });
      let [request] = await readSiteAccess(w.client, w.workspaceId, projectId);
      expect([request.status, request.date, request.items, request.orderNumber]).toEqual(["waiting", plus(5), "Oak veneer", order.order.number]);
      const task = (await w.client.query<{ id: string; title: string; due: string; assignee: string }>(
        `SELECT id, title, due_date::text AS due, assignee_membership_id AS assignee FROM work_items WHERE workspace_id = $1 AND project_id = $2 AND type = 'task'`, [w.workspaceId, projectId])).rows;
      expect(task.map((row) => [row.title, row.due, row.assignee])).toEqual([[`Meet delivery ${order.order.number} on site`, plus(5), supervisorMembership]]);
      expect((await told(w, "work.assigned")).map((row) => row.recipient)).toEqual([supervisor]);
      const asked = async () => (await w.client.query<{ subject: string }>(
        "SELECT subject FROM notifications WHERE workspace_id = $1 AND event_type = 'portal.site_access' AND recipient_type = 'portal_contact' ORDER BY created_at, subject", [w.workspaceId])).rows;
      expect((await asked()).map((row) => row.subject)).toEqual([expect.stringMatching(/^Confirm site access for /)]);
      expect((await buyer.receiving.arrivals(actor, w.workspaceId, projectId)).orders.map((row) => [row.number, row.access?.status])).toEqual([[order.order.number, "waiting"]]);
      // The same day again asks nothing new.
      order = await buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "confirm", version: order.order.version, promisedDate: plus(5) });
      expect((await asked()).length).toBe(1);

      // The client can't make it: they say why and which day suits; the supervisor and the manager hear it.
      const move = { requestId: request.id, decision: "move", reason: "Nobody home that day", preferredDate: plus(7) };
      await expect(answerSiteAccess(w.client, w.workspaceId, { projectId, grantId: grant, name: "Maya Client", body: { ...move, version: request.version + 1 } })).rejects.toThrow(/changed/);
      await expect(answerSiteAccess(w.client, w.workspaceId, { projectId, grantId: grant, name: "Maya Client", body: { ...move, reason: " ", version: request.version } })).rejects.toThrow(/Say why/);
      await answerSiteAccess(w.client, w.workspaceId, { projectId, grantId: grant, name: "Maya Client", body: { ...move, version: request.version } });
      [request] = await readSiteAccess(w.client, w.workspaceId, projectId);
      expect([request.status, request.clientReason, request.clientDate, request.answeredBy]).toEqual(["move_asked", "Nobody home that day", plus(7), "Maya Client"]);
      expect((await told(w, "site.access_move_asked")).map((row) => row.recipient).sort()).toEqual([supervisor, w.manager].sort());

      // The manager moves it to that day, charged: the order's line is promised for it, the task moves, the client is asked again, the buyer hears.
      await expect(arrangeSiteAccess(w.client, w.workspaceId, projectId, w.manager, request.id, { action: "reschedule", version: request.version, date: plus(7) })).rejects.toThrow(/Say why/);
      await arrangeSiteAccess(w.client, w.workspaceId, projectId, w.manager, request.id, { action: "reschedule", version: request.version, date: plus(7), reason: "Client away", chargeable: true });
      const [moved] = await readSiteAccess(w.client, w.workspaceId, projectId);
      expect([moved.status, moved.date, moved.movedFrom, moved.moveReason, moved.chargeable]).toEqual(["waiting", plus(7), plus(5), "Client away", true]);
      expect((await w.client.query("SELECT promised_date::text AS day FROM purchase_order_lines WHERE workspace_id = $1 AND order_id = $2", [w.workspaceId, order.order.id])).rows).toEqual([{ day: plus(7) }]);
      expect((await w.client.query("SELECT id, due_date::text AS due FROM work_items WHERE workspace_id = $1 AND project_id = $2 AND type = 'task'", [w.workspaceId, projectId])).rows)
        .toEqual([{ id: task[0].id, due: plus(7) }]);
      expect((await asked()).length).toBe(2);
      expect((await told(w, "site.delivery_moved")).map((row) => row.recipient).sort()).toEqual([supervisor, w.designer].sort());
      expect((await buyer.orders.get(actor, w.workspaceId, order.order.id)).events.map((event) => event.kind)).toContain("delivery_moved");

      // The client confirms the new day; the portal shows it confirmed.
      await answerSiteAccess(w.client, w.workspaceId, { projectId, grantId: grant, name: "Maya Client", body: { requestId: moved.id, decision: "confirm", version: moved.version } });
      expect((await readClientSiteAccess(w.client, w.workspaceId, projectId, today)).map((row) => [row.date, row.status])).toEqual([[plus(7), "confirmed"]]);
      expect((await told(w, "site.access_confirmed")).map((row) => row.recipient).sort()).toEqual([supervisor, w.manager].sort());

      // Cancelled, nothing is coming: the request closes and the task is cancelled.
      order = await buyer.orders.get(actor, w.workspaceId, order.order.id);
      await buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "cancel", version: order.order.version, reason: "Supplier out of stock" });
      expect(await readSiteAccess(w.client, w.workspaceId, projectId)).toEqual([]);
      expect((await w.client.query("SELECT status FROM work_items WHERE id = $1", [task[0].id])).rows[0].status).toBe("cancelled");
    });
  });

  it("raises one blocker when a line arrives after the work that needs it, owned by the buyer, told to the manager; the goods in close it (D-11)", async () => {
    await world(async (w) => {
      const { projectId, vendor, buyer, manager } = await started(w);
      const scope = await w.core.scope(actor, w.workspaceId, projectId);
      const [kitchen] = scope.packages;
      const cabinets = scope.lines.find((line) => line.title === "Kitchen cabinets")!;
      let detail = await w.core.get(actor, w.workspaceId, projectId);
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer", quantity: "20", unit: "sheets", clientChoice: false, boqLineIds: [cabinets.id], version: detail.project.version });
      const fit = randomUUID(), drawings = randomUUID();
      await w.work.command(actor, w.workspaceId, projectId, { action: "create", id: drawings, title: "Shop drawings", packageId: kitchen.id, startDate: "2026-10-01", dueDate: "2026-10-02" });
      await w.work.command(actor, w.workspaceId, projectId, { action: "create", id: fit, title: "Fit on site", packageId: kitchen.id, startDate: "2026-10-05", dueDate: "2026-10-09", needsMaterials: true });
      const oak = (await buyer.orders.needs(actor, w.workspaceId)).needs.find((need) => need.title === "Oak veneer")!;
      // Promised for the 7th, needed from the 5th: the fitting is held up.
      let order = await placeOrder(buyer.orders, w.workspaceId, vendor, [{ source: "material", materialItemId: oak.sourceId, quantity: "20", unitPrice: "90" }]);
      order = await buyer.orders.command(actor, w.workspaceId, order.order.id, { action: "confirm", version: order.order.version, lines: [{ lineId: order.lines[0].id, promisedDate: "2026-10-07" }] });
      expect(await raiseLateBlockers(w.client, w.workspaceId, "2026-09-30")).toBe(1);
      expect(await raiseLateBlockers(w.client, w.workspaceId, "2026-09-30")).toBe(0);
      const [blocker] = await readLineBlockers(w.client, w.workspaceId, { projectId });
      expect([blocker.title, blocker.status, blocker.blocks, blocker.orderNumber]).toEqual([`Waiting on ${order.order.number} · Oak veneer`, "todo", 1, order.order.number]);
      const item = (await w.client.query<{ assignee: string; type: string }>("SELECT assignee_membership_id AS assignee, type FROM work_items WHERE id = $1", [blocker.workItemId])).rows[0];
      expect(item).toEqual({ assignee: w.designerMembership, type: "blocker" });
      const links = (await w.client.query<{ successor: string }>("SELECT successor_id AS successor FROM work_item_links WHERE predecessor_id = $1", [blocker.workItemId])).rows;
      expect(links).toEqual([{ successor: fit }]);
      expect((await told(w, "purchasing.blocking_work")).map((row) => row.recipient).sort()).toEqual([w.designer, w.manager].sort());
      expect((await buyer.orders.get(actor, w.workspaceId, order.order.id)).blockers.map((row) => row.workItemId)).toEqual([blocker.workItemId]);
      // Half arrives: still blocked. The rest arrives: the blocker closes by itself and the fitting can start.
      await manager.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order.order.id, place: `site:${projectId}`, receivedOn: "2026-09-27", lines: [{ orderLineId: order.lines[0].id, received: "10" }] });
      expect(await readLineBlockers(w.client, w.workspaceId, { projectId })).toHaveLength(1);
      await manager.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order.order.id, place: `site:${projectId}`, receivedOn: "2026-09-28", lines: [{ orderLineId: order.lines[0].id, received: "10" }] });
      expect(await readLineBlockers(w.client, w.workspaceId, { projectId })).toEqual([]);
      const closed = (await w.client.query<{ status: string }>("SELECT status FROM work_items WHERE id = $1", [blocker.workItemId])).rows[0];
      expect(closed.status).toBe("done");
      expect(await closeSettledBlockers(w.client, w.workspaceId, {}, null)).toBe(0);
    });
  });

  it("tells the people who keep and buy stock once when free stock goes short, counts restock orders as coming, and lands restocked goods on the item", async () => {
    await world(async (w) => {
      const { vendor, buyer, manager } = await started(w);
      const place = randomUUID();
      await buyer.stock.saveLocation(actor, w.workspaceId, { id: place, kind: "warehouse", name: "Main store" });
      let stock = await buyer.stock.command(actor, w.workspaceId, { id: randomUUID(), action: "add", locationId: place, name: "Wood glue", unit: "nos", quantity: "10", reason: "Opening stock" });
      const glue = stock.rows.find((row) => row.itemName === "Wood glue")!;
      const point = randomUUID();
      await expect(buyer.stock.setReorderPoint(actor, w.workspaceId, { id: point, itemId: glue.itemId, reorderAt: "abc" })).rejects.toThrow(/Reorder at must be a number/);
      stock = await buyer.stock.setReorderPoint(actor, w.workspaceId, { id: point, itemId: glue.itemId, locationId: place, reorderAt: "6", reorderQuantity: "24", vendorId: vendor });
      expect(stock.reorderPoints.map((row) => [row.itemName, row.free, row.low, row.short])).toEqual([["Wood glue", "10.0000", false, false]]);
      await expect(buyer.stock.setReorderPoint(actor, w.workspaceId, { id: randomUUID(), itemId: glue.itemId, locationId: place, reorderAt: "2" })).rejects.toThrow(/already has a reorder point/);
      // Counted down to 5: short, and the storekeeper-buyer hears once.
      stock = await manager.stock.command(actor, w.workspaceId, { id: randomUUID(), action: "count", locationId: place, itemId: glue.itemId, counted: "5", reason: "Spilt" });
      expect(stock.reorderPoints[0]).toMatchObject({ free: "5.0000", low: true, short: true });
      expect((await told(w, "stock.low")).map((row) => [row.recipient, row.subject])).toEqual([[w.designer, "Stock is low: Wood glue"]]);
      expect(await processStockLevels(w.client, w.workspaceId)).toBe(0);
      // A restock order for the item: still low, no longer short (it's coming), and it lands on the same item.
      const order = await placeOrder(buyer.orders, w.workspaceId, vendor, [{ source: "free", stockItemId: glue.itemId, quantity: "24", unitPrice: "8" }], { deliverTo: "warehouse" });
      expect([order.lines[0].description, order.lines[0].unit, order.lines[0].stockItemId]).toEqual(["Wood glue", "nos", glue.itemId]);
      await expect(buyer.orders.create(actor, w.workspaceId, { id: randomUUID(), vendorId: vendor, lines: [{ source: "free", stockItemId: glue.itemId, quantity: "1", unit: "box" }] }))
        .rejects.toThrow(/order Wood glue in nos/);
      stock = await buyer.stock.stock(actor, w.workspaceId);
      expect(stock.reorderPoints[0]).toMatchObject({ onOrder: "24.0000", low: true, short: false });
      await manager.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order.order.id, place, receivedOn: "2026-09-28", lines: [{ orderLineId: order.lines[0].id, received: "24" }] });
      stock = await buyer.stock.stock(actor, w.workspaceId);
      expect(stock.rows.filter((row) => row.itemId === glue.itemId).map((row) => row.onHand)).toEqual(["29.0000"]);
      expect(stock.reorderPoints[0]).toMatchObject({ free: "29.0000", onOrder: "0.0000", low: false });
      expect(await processStockLevels(w.client, w.workspaceId)).toBe(0);
      expect((await w.client.query("SELECT low_since FROM stock_reorder_points WHERE id = $1", [point])).rows[0].low_since).toBeNull();
      stock = await buyer.stock.setReorderPoint(actor, w.workspaceId, { id: point, version: stock.reorderPoints[0].version, remove: true });
      expect(stock.reorderPoints).toEqual([]);
    });
  });

  it("sends made goods refused at site back on a return trip, raises a snag, and remakes them on the same work order without counting them twice", async () => {
    await world(async (w) => {
      const { projectId, buyer, as } = await started(w);
      const maker = as(w.designer, [...ALL, ...FACTORY]).factory;
      const checker = as(w.manager, ["factory.view", "factory.approve"]).factory;
      const scope = await w.core.scope(actor, w.workspaceId, projectId);
      const cabinets = scope.lines.find((line) => line.title === "Kitchen cabinets")!;
      let detail = await w.core.get(actor, w.workspaceId, projectId);
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "save_package", id: scope.packages[0].id, name: "Kitchen joinery", supply: "make", version: detail.project.version });
      const settings = await maker.settings(actor, w.workspaceId);
      await maker.saveSettings(actor, w.workspaceId, { version: settings.settings.version, requireDrawing: false, requirePayment: false, requireMaterials: false });
      const joinery = randomUUID(), wo = randomUUID();
      await maker.saveWorkcenter(actor, w.workspaceId, { id: joinery, name: "Joinery", hoursPerDay: "8" });
      // No hours given: 8 hours a day over its 5 working days.
      let order = await maker.plan(actor, w.workspaceId, { id: wo, lineId: cabinets.id, quantity: "3", workcenterId: joinery, plannedStart: "2026-10-05", plannedEnd: "2026-10-09" });
      expect(order.order.plannedHours).toBe("40.00");
      expect([order.next, (await maker.state(actor, w.workspaceId)).orders.find((row) => row.id === wo)!.next]).toEqual(["release", "release"]);
      order = await maker.command(actor, w.workspaceId, wo, { action: "release", version: order.order.version });
      order = await maker.command(actor, w.workspaceId, wo, { action: "start", version: order.order.version });
      const made = randomUUID();
      order = await maker.command(actor, w.workspaceId, wo, { action: "report", id: made, good: "3" });
      expect(order.next).toBe("approve");
      order = await checker.command(actor, w.workspaceId, wo, { action: "decide_report", reportId: made, decision: "approve", version: order.order.version });
      order = await checker.command(actor, w.workspaceId, wo, { action: "check", id: randomUUID(), passed: "3" });
      expect([order.order.status, order.atFactory, order.next]).toEqual(["ready", "3.0000", "send"]);
      const trip = randomUUID();
      order = await maker.command(actor, w.workspaceId, wo, { action: "dispatch", id: trip, quantity: "3" });
      const move = await buyer.stock.transfer(actor, w.workspaceId, trip);
      await expect(buyer.stock.transferCommand(actor, w.workspaceId, trip, { action: "receive", lines: [{ id: move.lines[0].id, received: "3", rejected: "4", rejectReason: "Veneer lifted" }] }))
        .rejects.toThrow(/more is refused than arrived/);
      await expect(buyer.stock.transferCommand(actor, w.workspaceId, trip, { action: "receive", lines: [{ id: move.lines[0].id, received: "3", rejected: "1" }] })).rejects.toThrow(/Say why/);
      const arrived = await buyer.stock.transferCommand(actor, w.workspaceId, trip, { action: "receive", lines: [{ id: move.lines[0].id, received: "3", rejected: "1", rejectReason: "Veneer lifted on a door" }] });
      expect([arrived.transfer.rejected, arrived.transfer.returnNumber !== null, arrived.lines[0].rejected]).toEqual([true, true, "1.0000"]);
      // Back in production for one; the site keeps two; a snag follows the refusal; the factory lead and manager hear.
      order = await maker.order(actor, w.workspaceId, wo);
      expect([order.order.status, order.order.passed, order.order.reworked, order.order.left, order.next]).toEqual(["in_production", "2.0000", "1.0000", "1.0000", "report"]);
      expect(order.dispatches.map((row) => [row.rejected, row.rejectReason, row.returnStatus])).toEqual([["1.0000", "Veneer lifted on a door", "in_transit"]]);
      expect(order.reworks.map((row) => [row.quantity, row.source])).toEqual([["1.0000", "site"]]);
      const snags = (await w.client.query<{ title: string }>("SELECT title FROM work_items WHERE project_id = $1 AND type = 'snag'", [projectId])).rows;
      expect(snags).toEqual([{ title: `Move ${move.transfer.number}: goods refused at site` }]);
      expect((await told(w, "factory.rework")).map((row) => row.recipient)).toEqual([w.manager]);
      let stock = await buyer.stock.stock(actor, w.workspaceId);
      expect(stock.rows.filter((row) => row.itemName === "Kitchen cabinets" && Number(row.onHand) > 0).map((row) => [row.locationKind, row.onHand])).toEqual([["site", "2.0000"]]);
      // The return trip can't be called off; it arrives at the factory and is taken back into production.
      const back = arrived.transfer.returnId!;
      await expect(buyer.stock.transferCommand(actor, w.workspaceId, back, { action: "cancel", reason: "No truck" })).rejects.toThrow(/receive this trip when it arrives/);
      await buyer.stock.transferCommand(actor, w.workspaceId, back, { action: "receive" });
      stock = await buyer.stock.stock(actor, w.workspaceId);
      expect(stock.rows.filter((row) => row.itemName === "Kitchen cabinets" && Number(row.onHand) > 0).map((row) => [row.locationKind, row.onHand])).toEqual([["site", "2.0000"]]);
      // Remade and checked again: one at the factory to send, ready once more; the stage counts three.
      const again = randomUUID();
      order = await maker.command(actor, w.workspaceId, wo, { action: "report", id: again, good: "1" });
      order = await checker.command(actor, w.workspaceId, wo, { action: "decide_report", reportId: again, decision: "approve", version: order.order.version });
      order = await checker.command(actor, w.workspaceId, wo, { action: "check", id: randomUUID(), passed: "1" });
      expect([order.order.status, order.order.passed, order.atFactory]).toEqual(["ready", "3.0000", "1.0000"]);
    });
  });

  it("releases work only on an approved drawing picked from the project's designs; a newer revision holds released work once (D-26), and lists next steps and what blocks release (D-45)", async () => {
    await world(async (w) => {
      const { projectId, as } = await started(w);
      const maker = as(w.designer, [...ALL, ...FACTORY]).factory;
      const approver = as(w.manager, ["factory.view", "factory.approve"]).factory;
      const scope = await w.core.scope(actor, w.workspaceId, projectId);
      const cabinets = scope.lines.find((line) => line.title === "Kitchen cabinets")!;
      let detail = await w.core.get(actor, w.workspaceId, projectId);
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "save_package", id: scope.packages[0].id, name: "Kitchen joinery", supply: "make", version: detail.project.version });
      const settings = await maker.settings(actor, w.workspaceId);
      await maker.saveSettings(actor, w.workspaceId, { version: settings.settings.version, requireDrawing: true, requirePayment: false, requireMaterials: false });
      const joinery = randomUUID(), wo = randomUUID();
      await maker.saveWorkcenter(actor, w.workspaceId, { id: joinery, name: "Joinery" });
      let order = await maker.plan(actor, w.workspaceId, { id: wo, lineId: cabinets.id, quantity: "3", workcenterId: joinery, plannedStart: "2026-10-05", plannedEnd: "2026-10-09" });
      const board = await maker.state(actor, w.workspaceId);
      // The workspace's day, as a date the list compares due dates with.
      expect(board.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      let row = board.orders.find((item) => item.id === wo)!;
      expect([row.next, row.mine, row.blocked.map((check) => check.key)]).toEqual(["fix", true, ["drawing"]]);
      // The kitchen's technical drawing: R1 approved internally, R2 still a draft.
      const design = randomUUID(), r1 = randomUUID(), r2 = randomUUID(), asset = randomUUID();
      await w.client.query("SET LOCAL session_replication_role = replica");
      await w.client.query(`INSERT INTO pre_project_designs (id, workspace_id, case_id, title, document_type, created_by) VALUES ($1, $2, $3, 'Kitchen elevations', 'technical_drawing', $4)`, [design, w.workspaceId, w.caseId, w.manager]);
      await w.client.query(`INSERT INTO pre_project_design_versions (id, workspace_id, case_id, design_id, number, asset_id, status, created_by) VALUES ($1, $2, $3, $4, 1, $5, 'internal_approved', $6), ($7, $2, $3, $4, 2, $5, 'draft', $6)`,
        [r1, w.workspaceId, w.caseId, design, asset, w.manager, r2]);
      await w.client.query("SET LOCAL session_replication_role = origin");
      order = await maker.order(actor, w.workspaceId, wo);
      expect(order.designs.map((item) => [item.title, item.number])).toEqual([["Kitchen elevations", 1]]);
      await expect(maker.command(actor, w.workspaceId, wo, { action: "approve_drawing", versionId: r2, version: order.order.version })).rejects.toThrow(/Kitchen elevations R2 isn't approved/);
      order = await maker.command(actor, w.workspaceId, wo, { action: "approve_drawing", versionId: r1, version: order.order.version });
      expect([order.order.drawingRef, order.order.drawingNewer, order.next]).toEqual(["Kitchen elevations R1", null, "release"]);
      order = await maker.command(actor, w.workspaceId, wo, { action: "release", version: order.order.version });
      // R2 goes to the client: released work on R1 stops once, and the approvers hear.
      await w.client.query("SET LOCAL session_replication_role = replica");
      await w.client.query("UPDATE pre_project_design_versions SET status = 'client_review' WHERE id = $1", [r2]);
      await w.client.query("SET LOCAL session_replication_role = origin");
      expect((await processFactoryDeadlines(w.client, w.workspaceId)).sent).toBeGreaterThan(0);
      order = await maker.order(actor, w.workspaceId, wo);
      expect([order.order.status, order.order.holdKind, order.order.drawingNewer, order.next]).toEqual(["on_hold", "drawing", 2, "decide_drawing"]);
      expect((await told(w, "factory.drawing_stale")).map((item) => item.recipient)).toEqual([w.manager]);
      const sent = (await told(w, "factory.drawing_stale")).length;
      await processFactoryDeadlines(w.client, w.workspaceId);
      expect((await told(w, "factory.drawing_stale")).length).toBe(sent);
      row = (await approver.state(actor, w.workspaceId)).orders.find((item) => item.id === wo)!;
      expect([row.next, row.mine]).toEqual(["decide_drawing", true]);
    });
  });

  it("tells the people who buy when a change leaves a project over-ordered (D-41), and shows which variation changed it", async () => {
    await world(async (w) => {
      const { projectId, vendor, buyer } = await started(w);
      let detail = await w.core.get(actor, w.workspaceId, projectId);
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer", quantity: "20", unit: "sheets", clientChoice: false, version: detail.project.version });
      const oak = (await buyer.orders.needs(actor, w.workspaceId)).needs.find((need) => need.title === "Oak veneer")!;
      await placeOrder(buyer.orders, w.workspaceId, vendor, [{ source: "material", materialItemId: oak.sourceId, quantity: "26", unitPrice: "90" }], { overReason: "Offcuts" });
      expect(await tellOverOrdered(w.client, w.workspaceId, projectId, w.manager, { id: randomUUID(), label: "VO-1" })).toBe(1);
      expect((await told(w, "purchasing.over_ordered")).map((row) => [row.recipient, row.subject, row.body]))
        .toEqual([[w.designer, "VO-1 leaves orders past what PRJ-0001 · Villa 12 needs", "Ordered past what's needed now: Oak veneer +6 sheets."]]);
    });
  });

  it("shows each line's status from its records, and tells the manager and the factory lead once when everything is in (PLM-072, PLM-074)", async () => {
    await world(async (w) => {
      const { projectId, vendor, buyer } = await started(w);
      const lead = randomUUID(), leadMembership = randomUUID();
      await w.client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Faisal Factory')", [lead, `${lead.slice(0, 8)}@example.com`]);
      await w.client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [leadMembership, w.workspaceId, lead]);
      await w.client.query("INSERT INTO project_assignments(workspace_id,project_id,membership_id,is_manager,active,role_keys) VALUES($1,$2,$3,false,true,ARRAY['factory_lead'])", [w.workspaceId, projectId, leadMembership]);
      const cabinets = (await w.core.scope(actor, w.workspaceId, projectId)).lines.find((line) => line.title === "Kitchen cabinets")!;
      const detail = await w.core.get(actor, w.workspaceId, projectId);
      await w.core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer", quantity: "20", unit: "sheets", clientChoice: false, boqLineIds: [cabinets.id], version: detail.project.version });
      const mine = async () => (await buyer.orders.needs(actor, w.workspaceId)).needs.filter((need) => need.projectId === projectId);
      const statuses = async () => Object.fromEntries((await mine()).map((need) => [need.title, need.status]));
      let needs = await mine();
      expect(needs.length).toBeGreaterThan(0);
      expect(new Set(Object.values(await statuses()))).toEqual(new Set(["required"]));

      // Everything goes on one placed order: each line is ordered.
      const order = await placeOrder(buyer.orders, w.workspaceId, vendor, needs.map((need) => need.source === "material"
        ? { source: "material", materialItemId: need.sourceId, quantity: need.required, unitPrice: "90" } : { source: "line", boqLineId: need.sourceId, quantity: need.required, unitPrice: "100" }));
      expect(new Set(Object.values(await statuses()))).toEqual(new Set(["ordered"]));
      const oakLine = order.lines.find((line) => line.description === "Oak veneer")!;

      // Part of the veneer arrives: still ordered, and nobody is told.
      await buyer.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order.order.id, place: `site:${projectId}`, receivedOn: "2026-09-28", lines: [{ orderLineId: oakLine.id, received: "12" }] });
      expect((await statuses())["Oak veneer"]).toBe("ordered");
      expect(await told(w, "purchasing.materials_ready")).toEqual([]);

      // The rest arrives: every line is received, and the manager and the factory lead hear, in the app and by email.
      await buyer.receiving.receive(actor, w.workspaceId, { id: randomUUID(), orderId: order.order.id, place: `site:${projectId}`, receivedOn: "2026-09-29",
        lines: order.lines.map((line) => ({ orderLineId: line.id, received: line.id === oakLine.id ? "8" : line.quantity })) });
      needs = await mine();
      expect(new Set(needs.map((need) => need.status))).toEqual(new Set(["received"]));
      const ready = await told(w, "purchasing.materials_ready");
      expect(ready.map((row) => row.recipient).sort()).toEqual([w.manager, lead].sort());
      expect(ready[0]).toMatchObject({ subject: "Materials are in for PRJ-0001 · Villa 12", body: `All ${needs.length} lines are received.` });
      const emails = async () => (await w.client.query("SELECT 1 FROM notifications WHERE workspace_id = $1 AND event_type = 'purchasing.materials_ready' AND channel = 'email'", [w.workspaceId])).rowCount;
      expect(await emails()).toBe(2);

      // Exactly once: checking again (a retry, another delivery, a daily run) tells nobody again.
      expect(await tellMaterialsReady(w.client, w.workspaceId, [projectId], null)).toBe(0);
      expect((await told(w, "purchasing.materials_ready")).length).toBe(2);
      expect(await emails()).toBe(2);
      expect((await w.client.query("SELECT lines FROM project_materials_ready WHERE workspace_id = $1 AND project_id = $2", [w.workspaceId, projectId])).rows).toEqual([{ lines: needs.length }]);

      // An approved site report installs all the cabinets: the veneer bought for them is installed.
      const report = randomUUID();
      await w.client.query(`INSERT INTO site_reports(id,workspace_id,project_id,report_date,author_id,status,submitted_at,decided_by,decided_at)
        VALUES($1,$2,$3,'2026-10-02',$4,'approved',now(),$5,now())`, [report, w.workspaceId, projectId, w.manager, w.designer]);
      await w.client.query("INSERT INTO site_report_lines(id,workspace_id,report_id,boq_line_id,installed) VALUES($1,$2,$3,$4,$5)", [randomUUID(), w.workspaceId, report, cabinets.id, cabinets.quantity]);
      expect((await statuses())["Oak veneer"]).toBe("installed");
    });
  });

  it("orders for a project only once the client's payment for its order is in, and drafts one order per supplier in one go (PLM-071)", async () => {
    await world(async (w) => {
      const { projectId, vendor, buyer, manager, company } = await started(w);
      let detail = await w.core.get(actor, w.workspaceId, projectId);
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Oak veneer", quantity: "20", unit: "sheets", clientChoice: false, version: detail.project.version });
      detail = await w.core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Brass handles", quantity: "12", unit: "pcs", clientChoice: false, version: detail.project.version });
      await w.client.query("UPDATE workspace_purchasing_settings SET require_client_payment = true WHERE workspace_id = $1", [w.workspaceId]);
      const mine = async () => (await buyer.orders.needs(actor, w.workspaceId)).needs.filter((need) => need.projectId === projectId && need.source === "material");
      // The quotation's release payment is verified: nothing waits.
      expect((await mine()).map((need) => need.blocked)).toEqual([null, null]);
      const pay = async (status: "pending" | "verified") => {
        const loaded = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!;
        const data = { ...(loaded.content as CommercialData), revision: loaded.revision + 1 };
        data.payments = data.payments.map((payment) => ({ ...payment, status }));
        await commercialRepository.save(w.client, w.workspaceId, w.caseId, data);
      };
      await pay("pending");
      const needs = await mine();
      expect(needs.map((need) => need.blocked)).toEqual(["client_payment", "client_payment"]);
      // Two suppliers, one draft each, in one go; the same batch again changes nothing.
      const other = randomUUID();
      const saved = await buyer.suppliers.save(actor, w.workspaceId, { id: other, version: 0, name: "Brass Co", entityIds: [company], email: "sales@brass.example" });
      await manager.suppliers.approve(actor, w.workspaceId, other, { version: saved.suppliers.find((row: { id: string }) => row.id === other)!.version, approval: "approved" });
      const [oak, brass] = [needs.find((need) => need.title === "Oak veneer")!, needs.find((need) => need.title === "Brass handles")!];
      const batch = { orders: [
        { id: randomUUID(), vendorId: vendor, lines: [{ source: "material", materialItemId: oak.sourceId, quantity: "20", unitPrice: "90" }] },
        { id: randomUUID(), vendorId: other, lines: [{ source: "material", materialItemId: brass.sourceId, quantity: "12", unitPrice: "15" }] },
      ] };
      const created = await buyer.orders.createMany(actor, w.workspaceId, batch);
      expect(created.orders.map((order) => [order.supplierName, order.lines])).toEqual([["Nile Timber", 1], ["Brass Co", 1]]);
      expect((await buyer.orders.createMany(actor, w.workspaceId, batch)).orders.map((order) => order.id)).toEqual(created.orders.map((order) => order.id));
      expect((await buyer.orders.list(actor, w.workspaceId)).orders).toHaveLength(2);
      await expect(buyer.orders.createMany(actor, w.workspaceId, { orders: [{ ...batch.orders[0], id: randomUUID() }, { ...batch.orders[0], id: randomUUID() }] })).rejects.toThrow(/One order per supplier/);
      // Placing waits for the payment; once Finance verifies it, the order goes out.
      const draft = await buyer.orders.get(actor, w.workspaceId, created.orders[0].id);
      await expect(buyer.orders.command(actor, w.workspaceId, draft.order.id, { action: "submit", version: draft.order.version })).rejects.toThrow(/client's payment for PRJ-0001 isn't in yet/);
      await pay("verified");
      const placed = await buyer.orders.command(actor, w.workspaceId, draft.order.id, { action: "submit", version: draft.order.version });
      expect(placed.order.status).toBe("approved");
    });
  });
});
