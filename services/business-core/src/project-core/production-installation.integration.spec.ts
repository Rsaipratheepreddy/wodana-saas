import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialRepository } from "../commercial/commercial-repository";
import { freezeHash } from "../commercial/commercial.domain";
import type { CommercialData } from "../commercial/commercial.types";
import { remindSamplesDue } from "../factory/factory-samples";
import { FactorySamplesService } from "../factory/factory-samples.service";
import { FactoryService } from "../factory/factory.service";
import { InventoryService } from "../inventory/inventory.service";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { OrdersService } from "../purchasing/orders.service";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { SiteService } from "../site/site.service";
import { ProjectCoreService } from "./project-core.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const MANAGE = ["projects.manage", "projects.view", "pre_projects.view", "pre_projects.edit", "workspace.settings.manage", "stock.manage"];
const FACTORY = ["factory.view", "factory.manage", "factory.report", "factory.approve", "projects.view", "workspace.settings.manage", "stock.manage"];

type People = { manager: string; seller: string; maker: string; checker: string; designer: string };
type World = { client: PoolClient; workspaceId: string; caseId: string; quoteId: string; opportunityId: string; people: People; memberships: People; today: string };

const plus = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);

/**
 * PLM-063 (production status and schedule from the work orders), PLM-069 (delivery and installation, scheduled by the
 * installation team, read from the records), PLM-055 (the designer told at the key moments) and PLM-061 (sample
 * requests the factory marks ready).
 */
integration("production, delivery and installation, keep informed, samples (PLM-055, 061, 063, 069)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(run: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), quoteId = randomUUID(), party = randomUUID(), opportunityId = randomUUID(), kitchen = randomUUID();
    const people: People = { manager: randomUUID(), seller: randomUUID(), maker: randomUUID(), checker: randomUUID(), designer: randomUUID() };
    const memberships: People = { manager: randomUUID(), seller: randomUUID(), maker: randomUUID(), checker: randomUUID(), designer: randomUUID() };
    const names: People = { manager: "Omar Manager", seller: "Sara Seller", maker: "Faris Factory", checker: "Quinn Checker", designer: "Dana Designer" };
    try {
      await client.query("BEGIN");
      for (const key of Object.keys(people) as Array<keyof People>)
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [people[key], `${people[key].slice(0, 8)}@example.com`, names[key]]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','UTC',$3)", [workspaceId, `pi-${workspaceId.slice(0, 8)}`, people.manager]);
      for (const key of Object.keys(people) as Array<keyof People>)
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [memberships[key], workspaceId, people[key]]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, workspaceId, party, randomUUID(), randomUUID(), memberships.seller]);
      // The opportunity's dedicated designer: told while the project names nobody as its designer.
      await client.query("INSERT INTO crm_opportunity_designer(workspace_id,opportunity_id,membership_id) VALUES($1,$2,$3)", [workspaceId, opportunityId, memberships.designer]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunityId, people.manager]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Kitchen')", [kitchen, workspaceId, caseId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','AED')", [workspaceId, caseId, quoteId]);
      // The people who run the factory hold factory.manage through a role (they hear about samples).
      const role = randomUUID();
      await client.query("INSERT INTO roles (id, workspace_id, code, name) VALUES ($1, $2, 'factory', 'Factory')", [role, workspaceId]);
      await client.query("INSERT INTO role_permissions (workspace_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE code = 'factory.manage'", [workspaceId, role]);
      await client.query("INSERT INTO member_roles (workspace_id, membership_id, role_id) VALUES ($1, $2, $3)", [workspaceId, memberships.maker, role]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      const today = (await client.query<{ today: string }>("SELECT (now() AT TIME ZONE 'UTC')::date::text AS today")).rows[0].today;
      const run_ = (userId: string) => (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const builder = new QuotationBuilderService({ withPermission: run_(people.manager), withPermissions: run_(people.manager), withAnyPermission: run_(people.manager), hasPermission: async () => true } as never, {} as never);
      await builder.apply(actor, workspaceId, caseId, quoteId, { ops: [
        { op: "upsert", line: { id: "a", title: "Kitchen cabinets", unit: "m", quantity: "4", rate: "1200", areaId: kitchen } },
        { op: "upsert", line: { id: "b", title: "Wardrobe", unit: "nos", quantity: "2", rate: "3000", areaId: kitchen } },
      ] });
      await run({ client, workspaceId, caseId, quoteId, opportunityId, people, memberships, today });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  /** Permission checks as the person has them; each command in a savepoint, so a refused one leaves nothing behind. */
  const access = (w: World, userId: string, permissions: string[]) => {
    const run = async (_a: unknown, _w: string, code: string | string[], fn: (c: PoolClient, u: { userId: string }) => unknown) => {
      if (!(Array.isArray(code) ? code : [code]).some((item) => permissions.includes(item))) throw new Error("Not allowed");
      await w.client.query("SAVEPOINT command");
      try { const result = await fn(w.client, { userId }); await w.client.query("RELEASE SAVEPOINT command"); return result; }
      catch (error) { await w.client.query("ROLLBACK TO SAVEPOINT command"); throw error; }
    };
    const member = async (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => run(_a, _w, permissions, fn);
    return { asMember: member, withPermission: run, withAnyPermission: run, withPermissions: run,
      hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code) } as never;
  };

  const told = async (w: World, event: string, channel = "in_app") => (await w.client.query<{ recipient: string; subject: string; body: string; deepLink: string }>(
    `SELECT recipient_id AS recipient, subject, body, deep_link AS "deepLink" FROM notifications WHERE workspace_id = $1 AND event_type = $2 AND channel = $3 ORDER BY created_at, recipient_id`,
    [w.workspaceId, event, channel])).rows;

  /** The accepted, paid quote; the route Palm configures (the factory team also installs); the project started; both lines made in the factory. */
  async function started(w: World) {
    const loaded = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!;
    const data = { ...(loaded.content as CommercialData), revision: loaded.revision };
    const quote = data.quotes.find((item) => item.id === w.quoteId)!;
    quote.status = "accepted";
    quote.hash = freezeHash(quote);
    quote.clientDecision = { decision: "accept", quoteHash: quote.hash, selectedOptionLineIds: [], baseTotal: 10800, optionsTotal: 0, acceptedTotal: 10800,
      decidedAt: "2026-09-20T10:00:00.000Z", decidedBy: "Maya Client", method: "signed_document", recordedBy: "Omar Manager" };
    data.agreement = { quoteId: w.quoteId, quoteHash: quote.hash, reference: "AG-7", terms: "", evidence: "signed.pdf", evidenceKind: "operational", status: "executed", executedAt: "2026-09-21T10:00:00.000Z", executedBy: "Omar Manager" };
    data.payments = [{ id: "p1", sourceQuoteId: w.quoteId, title: "Advance", amount: 10800, currency: "AED", dueDate: "", requiredForRelease: true, requiredForProduction: true, status: "verified",
      proof: "bank transfer", reference: "TT-1", evidenceKind: "operational" }] as CommercialData["payments"];
    data.revision = loaded.revision + 1;
    await commercialRepository.save(w.client, w.workspaceId, w.caseId, data);
    const core = new ProjectCoreService(access(w, w.people.manager, MANAGE));
    const settings = await core.saveTemplate(actor, w.workspaceId, { name: "Joinery", isDefault: true, stages: [
      { name: "Technical drawings", ownerRole: "technical_designer", checks: [{ kind: "drawings_uploaded" }] },
      { name: "Production", ownerRole: "factory_lead", checks: [{ kind: "everything_made" }] },
      { name: "Delivery and installation", ownerRole: "factory_lead", checks: [{ kind: "installation_scheduled" }, { kind: "goods_delivered" }, { kind: "installation_done" }] },
      { name: "Handover", ownerRole: "project_manager", checks: [{ kind: "confirm", label: "Keys handed over" }] },
    ] });
    const templateId = settings.templates.find((template) => template.name === "Joinery")!.id;
    const { projectId } = await core.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.memberships.manager, templateId });
    let detail = await core.get(actor, w.workspaceId, projectId);
    detail = await core.command(actor, w.workspaceId, projectId, { action: "set_member", role: "factory_lead", membershipId: w.memberships.maker, version: detail.project.version });
    const scope = await core.scope(actor, w.workspaceId, projectId);
    for (const pkg of scope.packages)
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_package", id: pkg.id, name: pkg.name, supply: "make", version: detail.project.version });
    const factory = (userId: string, permissions = FACTORY) => new FactoryService(access(w, userId, permissions), new OrdersService(access(w, userId, permissions)),
      new InventoryService(access(w, userId, permissions)), { put: async () => undefined, read: async () => ({ body: Buffer.alloc(0) }) } as never);
    const maker = factory(w.people.maker), checker = factory(w.people.checker, ["factory.view", "factory.approve"]);
    const current = await maker.settings(actor, w.workspaceId);
    await maker.saveSettings(actor, w.workspaceId, { version: current.settings.version, requireDrawing: false, requirePayment: false, requireMaterials: false, requireCheck: true });
    const joinery = randomUUID();
    await maker.saveWorkcenter(actor, w.workspaceId, { id: joinery, name: "Joinery", hoursPerDay: "8" });
    return { core, projectId, maker, checker, joinery, lines: (await core.scope(actor, w.workspaceId, projectId)).lines };
  }

  async function makeIt(maker: FactoryService, checker: FactoryService, workspaceId: string, id: string, quantity: string) {
    let order = await maker.order(actor, workspaceId, id);
    const report = randomUUID();
    order = await maker.command(actor, workspaceId, id, { action: "report", id: report, good: quantity });
    order = await checker.command(actor, workspaceId, id, { action: "decide_report", reportId: report, decision: "approve", version: order.order.version });
    return checker.command(actor, workspaceId, id, { action: "check", id: randomUUID(), passed: quantity });
  }

  it("follows production from the work orders, schedules delivery and installation by the installation team, and keeps the designer informed", async () => {
    await world(async (w) => {
      const { core, projectId, maker, checker, joinery, lines } = await started(w);
      // The technical drawings stage opened its task: the dedicated designer hears the drawings started (once, also by email).
      expect((await told(w, "project.drawings_started")).map((row) => row.recipient)).toEqual([w.people.designer]);
      expect((await told(w, "project.drawings_started", "email")).length).toBe(1);

      // PLM-063: a project with scope made in the factory and no work orders yet has no step; its planned dates follow the work orders.
      expect((await maker.production(actor, w.workspaceId)).projects).toEqual([expect.objectContaining({ projectId, step: null, orders: 0 })]);
      const cabinets = lines.find((line) => line.title === "Kitchen cabinets")!, wardrobe = lines.find((line) => line.title === "Wardrobe")!;
      const first = randomUUID(), second = randomUUID();
      await maker.plan(actor, w.workspaceId, { id: first, lineId: cabinets.id, quantity: "4", workcenterId: joinery, plannedStart: w.today, plannedEnd: plus(w.today, 9) });
      await maker.plan(actor, w.workspaceId, { id: second, lineId: wardrobe.id, quantity: "2", workcenterId: joinery, plannedStart: plus(w.today, 2), plannedEnd: plus(w.today, 13) });
      let row = (await maker.production(actor, w.workspaceId)).projects[0];
      expect(row).toMatchObject({ step: { kind: "scheduled", label: "" }, planned: { start: w.today, end: plus(w.today, 13), days: 14 }, actual: { start: null, days: null }, orders: 2, ready: 0 });

      // Starting the first work order starts production: the designer hears once, however many start.
      for (const id of [first, second]) {
        let order = await maker.order(actor, w.workspaceId, id);
        order = await maker.command(actor, w.workspaceId, id, { action: "release", version: order.order.version });
        await maker.command(actor, w.workspaceId, id, { action: "start", version: order.order.version });
      }
      expect((await told(w, "project.production_started")).map((item) => item.recipient)).toEqual([w.people.designer]);
      row = (await maker.production(actor, w.workspaceId)).projects[0];
      expect(row).toMatchObject({ step: { kind: "in_production" }, actual: { start: w.today, end: null, days: 1 }, late: false });

      // Made and reported: waiting for its check reads as Quality check; once both pass, Ready.
      const report = randomUUID();
      let order = await maker.command(actor, w.workspaceId, first, { action: "report", id: report, good: "4" });
      order = await checker.command(actor, w.workspaceId, first, { action: "decide_report", reportId: report, decision: "approve", version: order.order.version });
      await makeIt(maker, checker, w.workspaceId, second, "2");
      expect((await maker.production(actor, w.workspaceId)).projects[0].step?.kind).toBe("quality_check");
      await checker.command(actor, w.workspaceId, first, { action: "check", id: randomUUID(), passed: "4" });
      row = (await maker.production(actor, w.workspaceId)).projects[0];
      expect(row).toMatchObject({ step: { kind: "ready" }, actual: { start: w.today, end: w.today, days: 1 }, orders: 2, ready: 2 });
      // The firm's own words for its steps show on the project too.
      const factorySettings = await maker.settings(actor, w.workspaceId);
      await expect(maker.saveSettings(actor, w.workspaceId, { version: factorySettings.settings.version, productionSteps: [{ kind: "ready", label: "" }] })).rejects.toThrow(/between 2 and 4/);
      await maker.saveSettings(actor, w.workspaceId, { version: factorySettings.settings.version, productionWeeks: 8,
        productionSteps: [{ kind: "scheduled", label: "" }, { kind: "in_production", label: "Making" }, { kind: "ready", label: "Ready for delivery" }] });
      let detail = await core.get(actor, w.workspaceId, projectId);
      expect(detail.production).toMatchObject({ step: { kind: "ready", label: "Ready for delivery" }, overTarget: false });

      // The drawings stage is skipped, production finishes: delivery and installation opens a task for the installation team (the factory lead).
      const stageOf = (name: string) => detail.stages.find((stage) => stage.name === name)!;
      detail = await core.command(actor, w.workspaceId, projectId, { action: "skip_stage", stageId: stageOf("Technical drawings").id, reason: "Standard sizes", version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "complete_stage", stageId: stageOf("Production").id, version: detail.project.version });
      expect(stageOf("Delivery and installation").status).toBe("current");
      const task = async () => (await w.client.query<{ title: string; status: string; assignee: string | null }>(
        `SELECT title, status, assignee_membership_id AS assignee FROM work_items WHERE workspace_id = $1 AND project_id = $2 AND stage_check = 'installation_scheduled_1'`,
        [w.workspaceId, projectId])).rows[0];
      expect(await task()).toEqual({ title: "Schedule delivery and installation", status: "todo", assignee: w.memberships.maker });
      expect(detail.installation).toMatchObject({ deliveryOn: null, installationOn: null, delivery: "not_booked", installation: "not_started", inRoute: true });

      // The account manager isn't the installation team; delivery can't come after the installation day.
      const seller = new ProjectCoreService(access(w, w.people.seller, ["projects.view"]));
      await expect(seller.command(actor, w.workspaceId, projectId, { action: "schedule_installation", installationOn: plus(w.today, 5), version: detail.project.version }))
        .rejects.toThrow(/installation team/);
      const installer = new ProjectCoreService(access(w, w.people.maker, ["projects.view"]));
      await expect(installer.command(actor, w.workspaceId, projectId, { action: "schedule_installation", deliveryOn: plus(w.today, 6), installationOn: plus(w.today, 5),
        version: detail.project.version })).rejects.toThrow(/Delivery can't be after/);
      await expect(installer.command(actor, w.workspaceId, projectId, { action: "schedule_installation", deliveryOn: plus(w.today, 3), version: detail.project.version }))
        .rejects.toThrow(/installation day/);
      detail = await installer.command(actor, w.workspaceId, projectId, { action: "schedule_installation", deliveryOn: plus(w.today, 3), installationOn: plus(w.today, 5),
        note: "Crane booked", version: detail.project.version });
      expect(detail.installation).toMatchObject({ deliveryOn: plus(w.today, 3), installationOn: plus(w.today, 5), note: "Crane booked", setByName: "Faris Factory",
        delivery: "booked", installation: "not_started" });
      expect(detail.canScheduleInstallation).toBe(true);
      // The project manager and the designer hear the day (by email too); the installer doesn't hear their own step; the task closed.
      const scheduled = await told(w, "project.installation_scheduled");
      expect(scheduled.map((item) => item.recipient).sort()).toEqual([w.people.manager, w.people.designer].sort());
      expect(scheduled[0].body).toContain("Crane booked");
      expect((await told(w, "project.installation_scheduled", "email")).length).toBe(2);
      expect((await task()).status).toBe("done");

      // Delivered once everything made left the factory and arrived on site.
      const inventory = new InventoryService(access(w, w.people.manager, MANAGE));
      for (const [id, quantity] of [[first, "4"], [second, "2"]] as const) {
        const move = randomUUID();
        await maker.command(actor, w.workspaceId, id, { action: "dispatch", id: move, quantity });
        expect((await core.get(actor, w.workspaceId, projectId)).installation.delivery).toBe(id === first ? "booked" : "part_delivered");
        await inventory.transferCommand(actor, w.workspaceId, move, { action: "receive" });
      }
      detail = await core.get(actor, w.workspaceId, projectId);
      expect(detail.installation.delivery).toBe("delivered");

      // Installation follows the site work: started, then signed off.
      const site = new SiteService(access(w, w.people.manager, MANAGE));
      await site.command(actor, w.workspaceId, projectId, { action: "start_site" });
      expect((await core.get(actor, w.workspaceId, projectId)).installation.installation).toBe("in_progress");
      await site.command(actor, w.workspaceId, projectId, { action: "finish_site" });
      detail = await core.get(actor, w.workspaceId, projectId);
      expect(detail.installation.installation).toBe("done");
      expect(stageOf("Delivery and installation")).toMatchObject({ ready: true });

      // Keep informed is configuration: the account manager instead of the designer hears a new installation day.
      const projectSettings = await core.settings(actor, w.workspaceId);
      expect(projectSettings.settings.keepInformed).toEqual({ drawings_started: ["designer"], production_started: ["designer"], installation_scheduled: ["designer"] });
      await core.saveSettings(actor, w.workspaceId, { version: projectSettings.settings.version, keepInformed: { installation_scheduled: ["account_manager"] } });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "schedule_installation", deliveryOn: plus(w.today, 3), installationOn: plus(w.today, 6), version: detail.project.version });
      // The first day went to the manager and the designer; the new day to the installer and the account manager (the manager acted).
      expect((await told(w, "project.installation_scheduled")).map((item) => item.recipient).sort())
        .toEqual([w.people.manager, w.people.designer, w.people.maker, w.people.seller].sort());
    });
  });

  it("lets the designer add product details for the technical team without undoing the client's sign-off", async () => {
    await world(async (w) => {
      const { core, projectId } = await started(w);
      let detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "set_member", role: "technical_designer", membershipId: w.memberships.checker, version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "set_member", role: "designer", membershipId: w.memberships.designer, version: detail.project.version });
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_material", name: "Walnut veneer", specification: "Crown cut", version: detail.project.version });
      const materials = await core.materials(actor, w.workspaceId, projectId);
      const item = materials.items[0];
      const designer = new ProjectCoreService(access(w, w.people.designer, ["projects.view"]));
      detail = await designer.command(actor, w.workspaceId, projectId, { action: "set_material_details", itemId: item.id, note: "Book-matched, grain vertical on the doors", version: detail.project.version });
      const after = await core.materials(actor, w.workspaceId, projectId);
      expect(after.items[0]).toMatchObject({ teamNote: "Book-matched, grain vertical on the doors", teamNoteByName: "Dana Designer", specification: "Crown cut" });
      // The technical team hears it; the material list's state is unchanged.
      expect((await told(w, "project.material_details")).map((row) => row.recipient)).toEqual([w.people.checker]);
      expect(after.state).toBe(materials.state);
      // The same details again change nothing.
      const version = detail.project.version;
      detail = await designer.command(actor, w.workspaceId, projectId, { action: "set_material_details", itemId: item.id, note: "Book-matched, grain vertical on the doors", version });
      expect(detail.project.version).toBe(version);
    });
  });

  it("takes a sample request before the material selection, tells the factory, and the designer when it's ready", async () => {
    await world(async (w) => {
      // The case's material selection appointment, four days from today.
      const activity = randomUUID();
      await w.client.query("SET LOCAL session_replication_role = replica");
      await w.client.query("INSERT INTO crm_activities(id,workspace_id,opportunity_id,type,title) VALUES($1,$2,$3,'meeting','Material selection')", [activity, w.workspaceId, w.opportunityId]);
      await w.client.query("INSERT INTO design_journeys(workspace_id,case_id) VALUES($1,$2)", [w.workspaceId, w.caseId]);
      await w.client.query("INSERT INTO design_journey_stages(workspace_id,case_id,stage,position,status,activity_id) VALUES($1,$2,'material_selection',4,'active',$3)", [w.workspaceId, w.caseId, activity]);
      await w.client.query("INSERT INTO crm_appointments(workspace_id,activity_id,starts_at,ends_at,timezone) VALUES($1,$2,$3,$4,'UTC')",
        [w.workspaceId, activity, `${plus(w.today, 4)}T10:00:00Z`, `${plus(w.today, 4)}T11:00:00Z`]);
      await w.client.query("SET LOCAL session_replication_role = origin");
      const designer = new FactorySamplesService(access(w, w.people.designer, ["pre_projects.view", "pre_projects.edit"]));
      const maker = new FactorySamplesService(access(w, w.people.maker, ["factory.view", "factory.manage"]));
      const seller = new FactorySamplesService(access(w, w.people.seller, ["pre_projects.view", "pre_projects.edit"]));

      let view = await designer.list(actor, w.workspaceId, w.caseId);
      expect(view).toMatchObject({ samples: [], appointmentOn: plus(w.today, 4), suggestedDueOn: plus(w.today, 3), canRequest: true, canMake: false });
      const id = randomUUID();
      const ask = { id, caseId: w.caseId, title: "Veneer control sample · Walnut", note: "Two panels, matt lacquer" };
      await expect(designer.request(actor, w.workspaceId, { ...ask, dueOn: plus(w.today, 4) })).rejects.toThrow(/before the material selection/);
      await expect(designer.request(actor, w.workspaceId, { ...ask, dueOn: plus(w.today, -1) })).rejects.toThrow(/past/);
      await expect(designer.request(actor, w.workspaceId, { ...ask, title: " ", dueOn: plus(w.today, 2) })).rejects.toThrow(/Say which sample/);
      view = await designer.request(actor, w.workspaceId, { ...ask, dueOn: plus(w.today, 2) });
      // Asked twice (a retry), it's one request.
      view = await designer.request(actor, w.workspaceId, { ...ask, dueOn: plus(w.today, 2) });
      expect(view.samples).toEqual([expect.objectContaining({ id, number: 1, status: "requested", dueOn: plus(w.today, 2), requestedByName: "Dana Designer", caseReference: "O-1",
        clientName: "Maya Client", appointmentOn: plus(w.today, 4) })]);
      // The factory hears it (in the app and by email); the designer doesn't hear their own request.
      expect((await told(w, "factory.sample_requested")).map((row) => row.recipient)).toEqual([w.people.maker]);
      expect((await told(w, "factory.sample_requested", "email")).length).toBe(1);
      // The factory sees every request; the design team only a case's.
      expect((await maker.list(actor, w.workspaceId, null)).samples.map((sample) => sample.id)).toEqual([id]);
      await expect(designer.list(actor, w.workspaceId, null)).rejects.toThrow(/access to the factory/);

      // Only the factory marks it ready, on the version it read; the designer hears it.
      await expect(seller.command(actor, w.workspaceId, id, { action: "ready", version: 1 })).rejects.toThrow(/Only the factory/);
      await expect(maker.command(actor, w.workspaceId, id, { action: "ready", version: 0 })).rejects.toThrow(/Someone else changed/);
      view = await maker.command(actor, w.workspaceId, id, { action: "ready", note: "At the showroom desk", version: 1 });
      expect(view.samples[0]).toMatchObject({ status: "ready", readyByName: "Faris Factory", readyNote: "At the showroom desk" });
      expect((await told(w, "factory.sample_ready")).map((row) => row.recipient)).toEqual([w.people.designer]);
      await expect(maker.command(actor, w.workspaceId, id, { action: "ready", version: 2 })).rejects.toThrow(/already ready/);

      // A sample due today and not ready reminds the factory once; withdrawing it needs a reason and its requester (or a manager).
      const late = randomUUID();
      await designer.request(actor, w.workspaceId, { id: late, caseId: w.caseId, title: "Oak sample", dueOn: w.today });
      expect(await remindSamplesDue(w.client, w.workspaceId, w.today)).toBe(1);
      expect(await remindSamplesDue(w.client, w.workspaceId, w.today)).toBe(0);
      expect((await told(w, "factory.sample_due")).map((row) => row.recipient)).toEqual([w.people.maker]);
      await expect(seller.command(actor, w.workspaceId, late, { action: "cancel", reason: "Not needed", version: 1 })).rejects.toThrow(/whoever asked/);
      await expect(designer.command(actor, w.workspaceId, late, { action: "cancel", version: 1 })).rejects.toThrow(/Say why/);
      view = await designer.command(actor, w.workspaceId, late, { action: "cancel", reason: "Client chose walnut", version: 1, caseId: w.caseId });
      // Open requests first, then by the day they were due.
      expect(view.samples.map((sample) => [sample.title, sample.status])).toEqual([["Oak sample", "cancelled"], ["Veneer control sample · Walnut", "ready"]]);
      const audit = (await w.client.query<{ action: string }>(`SELECT action FROM audit_events WHERE workspace_id = $1 AND entity_type = 'sample_request' ORDER BY occurred_at, action`,
        [w.workspaceId])).rows.map((row) => row.action);
      expect(audit.sort()).toEqual(["sample_request.cancel", "sample_request.created", "sample_request.created", "sample_request.ready"].sort());
    });
  });
});
