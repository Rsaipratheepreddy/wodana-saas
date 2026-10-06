import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialRepository } from "../commercial/commercial-repository";
import { freezeHash } from "../commercial/commercial.domain";
import type { CommercialData } from "../commercial/commercial.types";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { FulfilmentService } from "../fulfilment/fulfilment.service";
import { ProjectCoreService } from "../project-core/project-core.service";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { TeamCalendarsService } from "../team-calendars/team-calendars.service";
import { LogisticsService } from "./logistics.service";
import { processLogisticsAlerts } from "./logistics.store";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const MANAGE = ["projects.manage", "projects.view", "pre_projects.view", "pre_projects.edit", "workspace.settings.manage", "stock.manage"];
const LOGISTICS = ["logistics.manage", "factory.view", "projects.view"];

type People = { manager: string; seller: string; booker: string; installer: string };
type World = { client: PoolClient; workspaceId: string; caseId: string; quoteId: string; people: People; memberships: People; today: string; dealId: string };

const plus = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
const pdf = (text: string) => ({ buffer: Buffer.from(`%PDF-1.4\n${text}\n%%EOF`), originalname: "permit.pdf", mimetype: "application/pdf", size: 40 });

/**
 * PLM-135 (people booked by name from a saved list or free text, vehicles and drivers on deliveries that can't be
 * double-booked, the separate production and installation calendar) and PLM-136 (Permit collection, a mandatory stage
 * after Ready and before Delivery/Installation; the permit on the project and the Deal File; no delivery or
 * installation without it, Furniture Only deals included).
 */
integration("factory and installation bookings: people by name, vehicles, building permits (PLM-135, PLM-136)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(run: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), quoteId = randomUUID(), party = randomUUID(), opportunityId = randomUUID(), kitchen = randomUUID(), dealId = randomUUID();
    const people: People = { manager: randomUUID(), seller: randomUUID(), booker: randomUUID(), installer: randomUUID() };
    const memberships: People = { manager: randomUUID(), seller: randomUUID(), booker: randomUUID(), installer: randomUUID() };
    const names: People = { manager: "Omar Manager", seller: "Sara Seller", booker: "Junaid Factory", installer: "Ivan Installer" };
    try {
      await client.query("BEGIN");
      for (const key of Object.keys(people) as Array<keyof People>)
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [people[key], `${people[key].slice(0, 8)}@example.com`, names[key]]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','UTC',$3)", [workspaceId, `lg-${workspaceId.slice(0, 8)}`, people.manager]);
      for (const key of Object.keys(people) as Array<keyof People>)
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [memberships[key], workspaceId, people[key]]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, workspaceId, party, randomUUID(), randomUUID(), memberships.seller]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunityId, people.manager]);
      // A Furniture Only order (path B, in stock, delivered) won without a project.
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at,status,furniture_path)
        VALUES($1,$2,$3,$4,$5,$6,'Sofa set','O-2','lead_qualification',repeat('c',64),'{}',repeat('d',64),now(),'won','in_stock_delivery')`, [dealId, workspaceId, party, randomUUID(), randomUUID(), memberships.seller]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Kitchen')", [kitchen, workspaceId, caseId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','AED')", [workspaceId, caseId, quoteId]);
      // The factory manager books through a role holding logistics.manage (they hear about deliveries with no team named).
      const role = randomUUID();
      await client.query("INSERT INTO roles (id, workspace_id, code, name) VALUES ($1, $2, 'logistics', 'Logistics')", [role, workspaceId]);
      await client.query("INSERT INTO role_permissions (workspace_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE code = 'logistics.manage'", [workspaceId, role]);
      await client.query("INSERT INTO member_roles (workspace_id, membership_id, role_id) VALUES ($1, $2, $3)", [workspaceId, memberships.booker, role]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      const today = (await client.query<{ today: string }>("SELECT (now() AT TIME ZONE 'UTC')::date::text AS today")).rows[0].today;
      const run_ = (userId: string) => (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const builder = new QuotationBuilderService({ withPermission: run_(people.manager), withPermissions: run_(people.manager), withAnyPermission: run_(people.manager), hasPermission: async () => true } as never, {} as never);
      await builder.apply(actor, workspaceId, caseId, quoteId, { ops: [{ op: "upsert", line: { id: "a", title: "Kitchen cabinets", unit: "m", quantity: "4", rate: "1200", areaId: kitchen } }] });
      await run({ client, workspaceId, caseId, quoteId, people, memberships, today, dealId });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  /** Permission checks as the person has them; each command in a savepoint, so a refused one leaves nothing behind. */
  const access = (w: World, userId: string, permissions: string[]) => {
    const run = async (_a: unknown, _w: string, code: string | string[], fn: (c: PoolClient, u: { userId: string; displayName: string }) => unknown) => {
      if (!(Array.isArray(code) ? code : [code]).some((item) => permissions.includes(item))) throw new Error("Not allowed");
      await w.client.query("SAVEPOINT command");
      try { const result = await fn(w.client, { userId, displayName: "Someone" }); await w.client.query("RELEASE SAVEPOINT command"); return result; }
      catch (error) { await w.client.query("ROLLBACK TO SAVEPOINT command"); throw error; }
    };
    const member = async (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => run(_a, _w, permissions, fn);
    return { asMember: member, withPermission: run, withAnyPermission: run, withPermissions: run,
      hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code) } as never;
  };
  const stored = new Map<string, Buffer>();
  const storage = { put: async (key: string, body: Buffer) => { stored.set(key, body); }, read: async (key: string) => ({ body: stored.get(key)! }) } as never;

  const told = async (w: World, event: string, channel = "in_app") => (await w.client.query<{ recipient: string; subject: string; body: string }>(
    `SELECT recipient_id AS recipient, subject, body FROM notifications WHERE workspace_id = $1 AND event_type = $2 AND channel = $3 ORDER BY created_at, recipient_id`,
    [w.workspaceId, event, channel])).rows;

  /** The accepted, paid quote; a route whose delivery stage checks the building permit (or not); the project started with its installer. */
  async function started(w: World, permit = true) {
    const loaded = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!;
    const data = { ...(loaded.content as CommercialData), revision: loaded.revision };
    const quote = data.quotes.find((item) => item.id === w.quoteId)!;
    quote.status = "accepted";
    quote.hash = freezeHash(quote);
    quote.clientDecision = { decision: "accept", quoteHash: quote.hash, selectedOptionLineIds: [], baseTotal: 4800, optionsTotal: 0, acceptedTotal: 4800,
      decidedAt: "2026-09-20T10:00:00.000Z", decidedBy: "Maya Client", method: "signed_document", recordedBy: "Omar Manager" };
    data.agreement = { quoteId: w.quoteId, quoteHash: quote.hash, reference: "AG-7", terms: "", evidence: "signed.pdf", evidenceKind: "operational", status: "executed", executedAt: "2026-09-21T10:00:00.000Z", executedBy: "Omar Manager" };
    data.payments = [{ id: "p1", sourceQuoteId: w.quoteId, title: "Advance", amount: 4800, currency: "AED", dueDate: "", requiredForRelease: true, requiredForProduction: true, status: "verified",
      proof: "bank transfer", reference: "TT-1", evidenceKind: "operational" }] as CommercialData["payments"];
    data.revision = loaded.revision + 1;
    await commercialRepository.save(w.client, w.workspaceId, w.caseId, data);
    const core = new ProjectCoreService(access(w, w.people.manager, MANAGE));
    const settings = await core.saveTemplate(actor, w.workspaceId, { name: "Fit-out", isDefault: true, stages: [
      // PLM-136: Permit collection after Ready and before Delivery/Installation.
      ...(permit ? [{ name: "Permit collection", ownerRole: "installation_lead", checks: [{ kind: "permit_collected" }] }] : []),
      { name: "Delivery and installation", ownerRole: "installation_lead", checks: [{ kind: "installation_scheduled" }, { kind: "goods_delivered" }, { kind: "installation_done" }] },
      { name: "Handover", ownerRole: "project_manager", checks: [{ kind: "confirm", label: "Keys handed over" }] },
    ] });
    const templateId = settings.templates.find((template) => template.name === "Fit-out")!.id;
    const { projectId } = await core.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.memberships.manager, templateId });
    let detail = await core.get(actor, w.workspaceId, projectId);
    detail = await core.command(actor, w.workspaceId, projectId, { action: "set_member", role: "installation_lead", membershipId: w.memberships.installer, version: detail.project.version });
    const booker = new LogisticsService(access(w, w.people.booker, LOGISTICS), storage);
    return { core, projectId, booker };
  }

  const task = async (w: World, projectId: string, kind: string) => (await w.client.query<{ title: string; status: string; assignee: string | null }>(
    `SELECT title, status, assignee_membership_id AS assignee FROM work_items WHERE workspace_id = $1 AND project_id = $2 AND stage_check LIKE $3`,
    [w.workspaceId, projectId, `${kind}%`])).rows[0];

  it("PLM-135: books people by name (saved or free text), a vehicle and a driver; a person booked twice warns, a vehicle can't be", async () => {
    await world(async (w) => {
      const { projectId, booker } = await started(w, false);
      // The vehicles list lives in Settings: a name or plate, used once; version-checked.
      const van = randomUUID(), truck = randomUUID();
      let vehicles = await booker.saveVehicle(actor, w.workspaceId, { id: van, version: 0, name: "Van 2", plate: "DXB A 1234", kind: "Van", capacityNote: "1.5 t" });
      vehicles = await booker.saveVehicle(actor, w.workspaceId, { id: truck, version: 0, plate: "DXB B 99", kind: "Truck" });
      expect(vehicles.vehicles.map((item: { name: string }) => item.name)).toEqual(["DXB B 99", "Van 2"]);
      await expect(booker.saveVehicle(actor, w.workspaceId, { id: randomUUID(), version: 0, name: "van 2" })).rejects.toThrow(/exists/);
      await expect(booker.saveVehicle(actor, w.workspaceId, { id: van, version: 0, name: "Van 2" })).rejects.toThrow(/changed/);
      const settings = await booker.saveSettings(actor, w.workspaceId, { version: 0, permitWarningDays: 5 });
      expect(settings).toMatchObject({ permitWarningDays: 5, dealDeliveryPermit: false });

      // People by name (and phone), without a login; typed as free text they're saved for next time; the same name and phone is the same person.
      const ali = await booker.addPerson(actor, w.workspaceId, { id: randomUUID(), name: " Ali  Khan ", phone: "+971501234567", trade: "Installer" });
      expect(ali).toMatchObject({ name: "Ali Khan", phone: "+971501234567", trade: "Installer" });
      expect((await booker.addPerson(actor, w.workspaceId, { id: randomUUID(), name: "ali khan", phone: "+971501234567", trade: "Installer" })).id).toBe(ali.id);
      const sam = await booker.addPerson(actor, w.workspaceId, { id: randomUUID(), name: "Sam", phone: "", trade: "Helper" });
      const omar = await booker.addPerson(actor, w.workspaceId, { id: randomUUID(), name: "Omar Driver", phone: "+971509999999", trade: "Driver" });
      expect((await w.client.query(`SELECT 1 FROM users WHERE display_name = 'Ali Khan'`)).rowCount).toBe(0);
      expect((await booker.options(actor, w.workspaceId)).workers.map((worker: { name: string }) => worker.name)).toEqual(["Ali Khan", "Omar Driver", "Sam"]);

      // The calendar books the delivery with the crew, the vehicle and the driver: the project's manager and installer hear it.
      const day = plus(w.today, 3);
      let booking = await booker.save(actor, w.workspaceId, { kind: "delivery", projectId, day, was: { start: null }, version: 0,
        people: [{ workerId: ali.id, lead: true }, { workerId: sam.id }], vehicleId: van, driverWorkerId: omar.id, note: "Gate 4" });
      expect(booking).toMatchObject({ start: day, version: 1, vehicle: { id: van, name: "Van 2" }, driver: { id: omar.id, name: "Omar Driver" }, note: "Gate 4", warnings: [] });
      expect(booking.people).toEqual([{ id: ali.id, name: "Ali Khan", lead: true }, { id: sam.id, name: "Sam", lead: false }]);
      const heard = await told(w, "logistics.booked");
      expect(heard.map((row) => row.recipient).sort()).toEqual([w.people.manager, w.people.installer].sort());
      expect(heard[0].body).toContain("Crew: Ali Khan (lead), Sam. Vehicle: Van 2. Driver: Omar Driver.");
      expect((await told(w, "logistics.booked", "email")).length).toBe(2);

      // The separate production and installation calendar shows who goes; the person and vehicle filters read its ids.
      const calendars = new TeamCalendarsService(access(w, w.people.booker, LOGISTICS));
      let view = await calendars.entries(actor, w.workspaceId, "logistics", w.today, plus(w.today, 7));
      expect(view.canBook).toBe(true);
      expect(view.entries.find((item) => item.key === `delivery:${projectId}`))
        .toMatchObject({ projectId, ownerName: "Ali Khan", crew: { vehicle: { name: "Van 2" }, driver: { name: "Omar Driver" }, version: 1 } });

      // The installation on the same day with the driver among the installers warns (a person booked twice), without blocking.
      booking = await booker.save(actor, w.workspaceId, { kind: "installation", projectId, day, was: { start: null }, version: 0, people: [{ workerId: omar.id, lead: true }] });
      expect(booking.warnings).toEqual([expect.objectContaining({ kind: "person", id: omar.id, name: "Omar Driver", key: `delivery:${projectId}`, what: "delivery" })]);

      // A Furniture Only deal's delivery is booked from the same calendar: the van is already out that day, so it can't go.
      const deal = { kind: "delivery", opportunityId: w.dealId };
      expect((await booker.conflicts(actor, w.workspaceId, { ...deal, day, workerIds: [], vehicleId: van })).warnings).toEqual([expect.objectContaining({ kind: "vehicle", id: van })]);
      await expect(booker.save(actor, w.workspaceId, { ...deal, day, was: { start: null }, version: 0, vehicleId: van, driverWorkerId: sam.id }))
        .rejects.toThrow("Van 2 is already out that day: delivery · PRJ-");
      expect((await w.client.query(`SELECT delivery_on FROM crm_deal_fulfilment WHERE workspace_id = $1 AND opportunity_id = $2`, [w.workspaceId, w.dealId])).rows[0]?.delivery_on ?? null).toBeNull();
      booking = await booker.save(actor, w.workspaceId, { ...deal, day, was: { start: null }, version: 0, vehicleId: truck, driverWorkerId: sam.id });
      expect(booking).toMatchObject({ kind: "delivery", opportunityId: w.dealId, project: "O-2 · Maya Client", start: day, vehicle: { name: "DXB B 99" }, driver: { name: "Sam" } });
      expect(booking.warnings).toEqual([expect.objectContaining({ kind: "person", id: sam.id, key: `delivery:${projectId}` })]);
      view = await calendars.entries(actor, w.workspaceId, "logistics", w.today, plus(w.today, 7));
      expect(view.entries.find((item) => item.key === `deal-delivery:${w.dealId}`))
        .toMatchObject({ kind: "delivery", opportunityId: w.dealId, href: `/workspace/crm/opportunities?record=${w.dealId}`, crew: { vehicle: { name: "DXB B 99" } } });
      // The deal shows its delivery's vehicle and driver.
      const fulfilment = new FulfilmentService(access(w, w.people.booker, ["stock.manage", "crm.opportunities.view"]));
      expect((await fulfilment.view(actor, w.workspaceId, w.dealId)).delivery).toMatchObject({ on: day, vehicle: { name: "DXB B 99" }, driver: { name: "Sam" } });

      // A vehicle and a driver only go on deliveries; stale versions and moved days are refused.
      await expect(booker.save(actor, w.workspaceId, { kind: "installation", projectId, version: 1, vehicleId: van })).rejects.toThrow(/deliveries/);
      await expect(booker.save(actor, w.workspaceId, { kind: "delivery", projectId, version: 0, note: "x" })).rejects.toThrow(/Someone changed/);
      await expect(booker.save(actor, w.workspaceId, { kind: "delivery", projectId, day: plus(w.today, 4), was: { start: plus(w.today, 1) }, version: 1 })).rejects.toThrow(/moved meanwhile/);
      await expect(booker.save(actor, w.workspaceId, { kind: "delivery", projectId, day: plus(w.today, 5), was: { start: day }, version: 1 })).rejects.toThrow(/after the installation/);
      // Moving keeps the crew.
      await booker.save(actor, w.workspaceId, { kind: "installation", projectId, day: plus(w.today, 6), was: { start: day }, version: 1 });
      booking = await booker.save(actor, w.workspaceId, { kind: "delivery", projectId, day: plus(w.today, 5), was: { start: day }, version: 1 });
      expect(booking).toMatchObject({ start: plus(w.today, 5), version: 1, vehicle: { id: van } });
      // The seller isn't the project's team nor a booker; the installer is.
      const seller = new LogisticsService(access(w, w.people.seller, ["projects.view"]), storage);
      await expect(seller.save(actor, w.workspaceId, { kind: "delivery", projectId, day: plus(w.today, 4), version: 1 })).rejects.toThrow(/Only the factory and logistics team/);
      const installer = new LogisticsService(access(w, w.people.installer, ["projects.view"]), storage);
      expect((await installer.save(actor, w.workspaceId, { kind: "delivery", projectId, day: plus(w.today, 4), version: 1 })).start).toBe(plus(w.today, 4));
      // A route without the permit check delivers without one (existing workspaces keep working).
      expect((await installer.permits(actor, w.workspaceId, { projectId })).required).toBe(false);
      // Cancelling clears the day and the crew.
      await booker.cancel(actor, w.workspaceId, { kind: "delivery", projectId, was: { start: plus(w.today, 4) } });
      expect(await booker.booking(actor, w.workspaceId, { kind: "delivery", projectId })).toMatchObject({ start: null, people: [], vehicle: null });
    });
  });

  it("PLM-136: Permit collection is mandatory before delivery and installation, recorded with its type, reference, days and file, and alerted ahead", async () => {
    await world(async (w) => {
      const { core, projectId, booker } = await started(w);
      let detail = await core.get(actor, w.workspaceId, projectId);
      const stage = (name: string) => detail.stages.find((item) => item.name === name)!;
      // The Permit collection stage opens its task for the installation team and can't be skipped.
      expect(stage("Permit collection").status).toBe("current");
      expect(await task(w, projectId, "permit_collected")).toMatchObject({ title: "Collect the building permit", status: "todo" });
      await expect(core.command(actor, w.workspaceId, projectId, { action: "skip_stage", stageId: stage("Permit collection").id, reason: "Villa", version: detail.project.version }))
        .rejects.toThrow("The building permit is mandatory; this stage can't be skipped.");
      // No permit: neither the delivery nor the installation is booked, from the calendar or the project.
      const ivan = await booker.addPerson(actor, w.workspaceId, { id: randomUUID(), name: "Ivan Crew", phone: "", trade: "Installer" });
      await expect(booker.save(actor, w.workspaceId, { kind: "delivery", projectId, day: plus(w.today, 7), version: 0 })).rejects.toThrow("Collect the building permit before booking the delivery.");
      await expect(booker.save(actor, w.workspaceId, { kind: "installation", projectId, day: plus(w.today, 8), version: 0 })).rejects.toThrow("Collect the building permit before booking the installation.");
      await expect(core.command(actor, w.workspaceId, projectId, { action: "schedule_installation", deliveryOn: plus(w.today, 7), installationOn: plus(w.today, 14), version: detail.project.version }))
        .rejects.toThrow(/building permit/);

      // Someone is booked to collect it: a permit entry on the calendar.
      const permitId = randomUUID();
      const planned = await booker.save(actor, w.workspaceId, { kind: "permit", projectId, permitId, day: plus(w.today, 1), was: { start: null }, version: 0, people: [{ workerId: ivan.id, lead: true }] });
      expect(planned).toMatchObject({ kind: "permit", permitId, start: plus(w.today, 1), people: [{ name: "Ivan Crew", lead: true }] });
      const calendars = new TeamCalendarsService(access(w, w.people.booker, LOGISTICS));
      expect((await calendars.entries(actor, w.workspaceId, "logistics", w.today, plus(w.today, 9))).entries.find((item) => item.kind === "permit"))
        .toMatchObject({ key: `permit:${permitId}`, recordId: permitId, status: "planned", crew: { people: [{ name: "Ivan Crew" }] } });

      // Collected: its type, reference, the days it's valid, the file and who collected it. The task closes; the team hears it.
      await expect(booker.collectPermit(actor, w.workspaceId, { projectId }, permitId, { permitNumber: "", validFrom: w.today, validTo: plus(w.today, 10) }, pdf("a"))).rejects.toThrow(/number/);
      await expect(booker.collectPermit(actor, w.workspaceId, { projectId }, permitId, { permitNumber: "P-1", validFrom: plus(w.today, 10), validTo: w.today }, pdf("a"))).rejects.toThrow(/end before/);
      let permits = await booker.collectPermit(actor, w.workspaceId, { projectId }, permitId,
        { permitType: "Building access", permitNumber: "BP-2026-77", validFrom: w.today, validTo: plus(w.today, 10), collectedByWorkerId: ivan.id }, pdf("a"));
      expect(permits).toMatchObject({ required: true, valid: true,
        permits: [expect.objectContaining({ id: permitId, status: "collected", permitType: "Building access", permitNumber: "BP-2026-77", collectedBy: "Ivan Crew", fileName: "permit.pdf" })] });
      expect((await booker.collectPermit(actor, w.workspaceId, { projectId }, permitId, { permitNumber: "BP-2026-77", validFrom: w.today, validTo: plus(w.today, 10) }, pdf("a"))).permits.length).toBe(1);
      expect(await task(w, projectId, "permit_collected")).toMatchObject({ status: "done" });
      expect((await told(w, "logistics.permit_collected")).map((row) => row.recipient).sort()).toEqual([w.people.manager, w.people.installer].sort());
      expect((await booker.permitFile(actor, w.workspaceId, permitId)).contentType).toBe("application/pdf");
      // The same permit shows on the deal (the Deal File).
      expect((await booker.permits(actor, w.workspaceId, { opportunityId: (await w.client.query<{ id: string }>(
        `SELECT opportunity_id AS id FROM pre_project_cases WHERE workspace_id = $1 AND id = $2`, [w.workspaceId, w.caseId])).rows[0].id })).permits.map((item: { id: string }) => item.id)).toEqual([permitId]);
      detail = await core.get(actor, w.workspaceId, projectId);
      detail = await core.command(actor, w.workspaceId, projectId, { action: "complete_stage", stageId: stage("Permit collection").id, version: detail.project.version });
      expect(stage("Delivery and installation").status).toBe("current");

      // Now the delivery and installation book inside the permit's days, and not past them.
      await expect(booker.save(actor, w.workspaceId, { kind: "installation", projectId, day: plus(w.today, 12), version: 0 })).rejects.toThrow(/ends on .* before the installation day/);
      await booker.save(actor, w.workspaceId, { kind: "installation", projectId, day: plus(w.today, 8), was: { start: null }, version: 0 });
      const delivery = await booker.save(actor, w.workspaceId, { kind: "delivery", projectId, day: plus(w.today, 7), was: { start: null }, version: 0 });
      expect(delivery.start).toBe(plus(w.today, 7));
      expect((await calendars.entries(actor, w.workspaceId, "logistics", w.today, plus(w.today, 9))).entries.find((item) => item.key === `delivery:${projectId}`))
        .toMatchObject({ permit: { covered: true, validTo: plus(w.today, 10) } });

      // The permit is withdrawn (a wrong file): the daily run raises it, once.
      await booker.saveSettings(actor, w.workspaceId, { version: 0, permitWarningDays: 30 });
      permits = await booker.cancelPermit(actor, w.workspaceId, { projectId }, permitId, { version: permits.permits[0].version, reason: "Wrong building" });
      expect(permits).toMatchObject({ valid: false, permits: [] });
      expect(await processLogisticsAlerts(w.client, w.workspaceId)).toEqual({ sent: 2 });
      expect(await processLogisticsAlerts(w.client, w.workspaceId)).toEqual({ sent: 0 });
      expect((await told(w, "logistics.permit_missing"))[0].subject).toContain("No building permit for the delivery");
      expect((await told(w, "logistics.permit_missing", "email")).length).toBe(2);

      // A new permit that ends before the installation day is raised at once.
      await booker.collectPermit(actor, w.workspaceId, { projectId }, randomUUID(), { permitNumber: "BP-2026-78", validFrom: w.today, validTo: plus(w.today, 7) }, pdf("b"));
      expect(await processLogisticsAlerts(w.client, w.workspaceId)).toEqual({ sent: 2 });
      expect((await told(w, "logistics.permit_expiring"))[0].body).toContain("before the installation on");
    });
  });

  it("PLM-136: a Furniture Only deal is delivered only with its permit, where the firm asks deals for one", async () => {
    await world(async (w) => {
      const booker = new LogisticsService(access(w, w.people.booker, LOGISTICS), storage);
      const fulfilment = new FulfilmentService(access(w, w.people.booker, ["stock.manage", "crm.opportunities.view"]));
      // Off by default: the deal books its delivery as before.
      let view = await fulfilment.view(actor, w.workspaceId, w.dealId);
      expect(view.permit).toMatchObject({ required: false });
      await booker.saveSettings(actor, w.workspaceId, { version: 0, dealDeliveryPermit: true });
      view = await fulfilment.view(actor, w.workspaceId, w.dealId);
      expect(view.permit).toMatchObject({ required: true, valid: false });
      await expect(fulfilment.command(actor, w.workspaceId, w.dealId, { action: "book_delivery", date: plus(w.today, 2), commandId: randomUUID(), version: view.version }))
        .rejects.toThrow("Collect the building permit before booking the delivery.");
      // Recorded on the deal: the delivery goes ahead, from the deal or the calendar.
      await booker.collectPermit(actor, w.workspaceId, { opportunityId: w.dealId }, randomUUID(),
        { permitType: "Delivery access", permitNumber: "DA-9", validFrom: w.today, validTo: plus(w.today, 5) }, pdf("deal"));
      view = await fulfilment.view(actor, w.workspaceId, w.dealId);
      view = await fulfilment.command(actor, w.workspaceId, w.dealId, { action: "book_delivery", date: plus(w.today, 2), commandId: randomUUID(), version: view.version });
      expect(view).toMatchObject({ delivery: { on: plus(w.today, 2) }, permit: { required: true, valid: true, validTo: plus(w.today, 5) } });
      await expect(booker.save(actor, w.workspaceId, { kind: "delivery", opportunityId: w.dealId, day: plus(w.today, 9), was: { start: plus(w.today, 2) }, version: 0 }))
        .rejects.toThrow(/ends on/);
      // Taken home (path A) never needs one.
      await w.client.query("SET LOCAL session_replication_role = replica");
      await w.client.query(`UPDATE crm_opportunities SET furniture_path = 'take_home_now' WHERE workspace_id = $1 AND id = $2`, [w.workspaceId, w.dealId]);
      await w.client.query("SET LOCAL session_replication_role = origin");
      expect((await booker.permits(actor, w.workspaceId, { opportunityId: w.dealId })).required).toBe(false);
    });
  });
});
