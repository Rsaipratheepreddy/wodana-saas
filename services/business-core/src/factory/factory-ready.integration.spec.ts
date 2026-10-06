import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialRepository } from "../commercial/commercial-repository";
import { freezeHash } from "../commercial/commercial.domain";
import type { CommercialData } from "../commercial/commercial.types";
import { InventoryService } from "../inventory/inventory.service";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { ProjectCoreService } from "../project-core/project-core.service";
import { OrdersService } from "../purchasing/orders.service";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { FactoryService } from "./factory.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const FACTORY = ["factory.view", "factory.manage", "factory.report", "factory.approve", "projects.view", "workspace.settings.manage"];

type People = { manager: string; seller: string; maker: string; checker: string; finance: string; installer: string };
type World = { client: PoolClient; workspaceId: string; caseId: string; quoteId: string; people: People; memberships: People };

/**
 * PLM-064, PLM-065, PLM-067: a quality check with its note, the order-ready date, Finance and the account
 * manager told when an order is ready, the delivery team told when everything is ready, and the payment
 * stage tied to the orders reminded once when they're all ready.
 */
integration("factory order ready (PLM-064, PLM-065, PLM-067)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(run: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), quoteId = randomUUID(), party = randomUUID(), opportunity = randomUUID(), kitchen = randomUUID();
    const people = { manager: randomUUID(), seller: randomUUID(), maker: randomUUID(), checker: randomUUID(), finance: randomUUID(), installer: randomUUID() };
    const memberships = { manager: randomUUID(), seller: randomUUID(), maker: randomUUID(), checker: randomUUID(), finance: randomUUID(), installer: randomUUID() };
    const names: Record<keyof People, string> = { manager: "Omar Manager", seller: "Sara Seller", maker: "Mo Maker", checker: "Quinn Checker", finance: "Fay Finance", installer: "Ian Installer" };
    try {
      await client.query("BEGIN");
      for (const key of Object.keys(people) as Array<keyof People>)
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [people[key], `${people[key].slice(0, 8)}@example.com`, names[key]]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [workspaceId, `fr-${workspaceId.slice(0, 8)}`, people.manager]);
      for (const key of Object.keys(people) as Array<keyof People>)
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [memberships[key], workspaceId, people[key]]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      // The seller owns the opportunity, so the project names them its account manager.
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, workspaceId, party, randomUUID(), randomUUID(), memberships.seller]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunity, people.manager]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Kitchen')", [kitchen, workspaceId, caseId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','AED')", [workspaceId, caseId, quoteId]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      const run_ = (userId: string) => (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const builder = new QuotationBuilderService({ withPermission: run_(people.manager), withPermissions: run_(people.manager), withAnyPermission: run_(people.manager), hasPermission: async () => true } as never, {} as never);
      await builder.apply(actor, workspaceId, caseId, quoteId, { ops: [
        { op: "upsert", line: { id: "a", title: "Kitchen cabinets", unit: "m", quantity: "4.5", rate: "1200", areaId: kitchen } },
        { op: "upsert", line: { id: "b", title: "Worktop", unit: "m²", quantity: "2.25", rate: "800", areaId: kitchen } },
      ] });
      await run({ client, workspaceId, caseId, quoteId, people, memberships });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  /** Accepted with a 50% advance (paid) and a 50% joinery balance (owed); the project started with its team; services per person. */
  async function started(w: World) {
    const loaded = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!;
    const data = { ...(loaded.content as CommercialData), revision: loaded.revision };
    const quote = data.quotes.find((item) => item.id === w.quoteId)!;
    quote.status = "accepted";
    quote.hash = freezeHash(quote);
    const total = 4.5 * 1200 + 2.25 * 800;
    quote.clientDecision = { decision: "accept", quoteHash: quote.hash, selectedOptionLineIds: [], baseTotal: total, optionsTotal: 0, acceptedTotal: total,
      decidedAt: "2026-09-20T10:00:00.000Z", decidedBy: "Maya Client", method: "signed_document", recordedBy: "Omar Manager" };
    data.agreement = { quoteId: w.quoteId, quoteHash: quote.hash, reference: "AG-7", terms: "", evidence: "signed.pdf", evidenceKind: "operational", status: "executed", executedAt: "2026-09-21T10:00:00.000Z", executedBy: "Omar Manager" };
    data.payments = [
      { id: "p1", sourceQuoteId: w.quoteId, title: "Advance", amount: total / 2, currency: "AED", dueDate: "", requiredForRelease: true, requiredForProduction: true, status: "verified", proof: "bank transfer", reference: "TT-1", evidenceKind: "operational" },
      { id: "p2", sourceQuoteId: w.quoteId, title: "Joinery balance", amount: total / 2, currency: "AED", dueDate: "", requiredForRelease: false, requiredForProduction: false, status: "pending", proof: "", reference: "" },
    ] as CommercialData["payments"];
    data.revision = loaded.revision + 1;
    await commercialRepository.save(w.client, w.workspaceId, w.caseId, data);
    const access = (userId: string, permissions: string[]) => {
      const run = async (_a: unknown, _w: string, code: string | string[], fn: (c: PoolClient, u: { userId: string }) => unknown) => {
        if (!(Array.isArray(code) ? code : [code]).some((item) => permissions.includes(item))) throw new Error("Not allowed");
        await w.client.query("SAVEPOINT command");
        try { const result = await fn(w.client, { userId }); await w.client.query("RELEASE SAVEPOINT command"); return result; }
        catch (error) { await w.client.query("ROLLBACK TO SAVEPOINT command"); throw error; }
      };
      return { asMember: (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(w.client, { userId }), withPermission: run, withAnyPermission: run,
        hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code) || ["projects.manage", "projects.view", "pre_projects.view", "workspace.settings.manage"].includes(code) } as never;
    };
    const core = new ProjectCoreService(access(w.people.manager, ["projects.manage", "projects.view", "pre_projects.view", "workspace.settings.manage"]));
    const { projectId } = await core.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.memberships.manager });
    // The installation lead on the team; Finance manages receivables (the team has no Finance member).
    await w.client.query(`INSERT INTO project_assignments (workspace_id, project_id, membership_id, is_manager, active, role_keys) VALUES ($1, $2, $3, false, true, ARRAY['installation_lead']::varchar[])`,
      [w.workspaceId, projectId, w.memberships.installer]);
    const role = randomUUID();
    await w.client.query("INSERT INTO roles (id, workspace_id, code, name) VALUES ($1, $2, 'accounts', 'Accounts')", [role, w.workspaceId]);
    await w.client.query("INSERT INTO role_permissions (workspace_id, role_id, permission_id) SELECT $1, $2, id FROM permissions WHERE code = 'receivables.manage'", [w.workspaceId, role]);
    await w.client.query("INSERT INTO member_roles (workspace_id, membership_id, role_id) VALUES ($1, $2, $3)", [w.workspaceId, w.memberships.finance, role]);
    // Photos land in a stand-in for object storage.
    const stored = new Map<string, Buffer>();
    const storage = { put: async (key: string, body: Buffer) => { stored.set(key, body); }, read: async (key: string) => ({ body: stored.get(key)! }) } as never;
    const factory = (userId: string, permissions = FACTORY) => new FactoryService(access(userId, permissions), new OrdersService(access(userId, permissions)), new InventoryService(access(userId, permissions)),
      storage);
    const maker = factory(w.people.maker), checker = factory(w.people.checker, ["factory.view", "factory.approve"]);
    // Both lines made in the factory; no drawing, payment or materials gate; checks required.
    const scope = await core.scope(actor, w.workspaceId, projectId);
    let detail = await core.get(actor, w.workspaceId, projectId);
    for (const pkg of scope.packages) {
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_package", id: pkg.id, name: pkg.name, supply: "make", version: detail.project.version });
    }
    const settings = await maker.settings(actor, w.workspaceId);
    await maker.saveSettings(actor, w.workspaceId, { version: settings.settings.version, requireDrawing: false, requirePayment: false, requireMaterials: false, requireCheck: true });
    const joinery = randomUUID();
    await maker.saveWorkcenter(actor, w.workspaceId, { id: joinery, name: "Joinery", hoursPerDay: "8" });
    return { projectId, maker, checker, factory, joinery, lines: (await core.scope(actor, w.workspaceId, projectId)).lines };
  }

  const told = async (w: World, event: string, channel = "in_app") => (await w.client.query<{ recipient: string; subject: string; body: string; deepLink: string }>(
    `SELECT recipient_id AS recipient, subject, body, deep_link AS "deepLink" FROM notifications WHERE workspace_id = $1 AND event_type = $2 AND channel = $3 ORDER BY created_at, recipient_id`,
    [w.workspaceId, event, channel])).rows;

  /** Planned, released, started, reported by the maker, approved and checked by the checker (with a note). */
  async function makeIt(maker: FactoryService, checker: FactoryService, workspaceId: string, id: string, quantity: string, note: string) {
    let order = await maker.order(actor, workspaceId, id);
    order = await maker.command(actor, workspaceId, id, { action: "release", version: order.order.version });
    order = await maker.command(actor, workspaceId, id, { action: "start", version: order.order.version });
    const report = randomUUID();
    order = await maker.command(actor, workspaceId, id, { action: "report", id: report, good: quantity });
    order = await checker.command(actor, workspaceId, id, { action: "decide_report", reportId: report, decision: "approve", version: order.order.version });
    return checker.command(actor, workspaceId, id, { action: "check", id: randomUUID(), passed: quantity, note });
  }

  it("records the check's note and the ready date, tells Finance and the account manager, then the delivery team and the client once everything is ready", async () => {
    await world(async (w) => {
      const { projectId, maker, checker, factory, joinery, lines } = await started(w);
      const cabinets = lines.find((line) => line.title === "Kitchen cabinets")!, worktop = lines.find((line) => line.title === "Worktop")!;
      // The client can be reached by email through the portal.
      await w.client.query("INSERT INTO client_portal_settings (workspace_id, slug, enabled) VALUES ($1, $2, true)", [w.workspaceId, `fr-${w.workspaceId.slice(0, 8)}`]);
      await w.client.query("INSERT INTO client_portal_grants (workspace_id, case_id, name, phone, role, email) VALUES ($1, $2, 'Maya Client', '+971500000001', 'approver', 'maya@example.com')", [w.workspaceId, w.caseId]);

      const first = randomUUID(), second = randomUUID();
      let order = await maker.plan(actor, w.workspaceId, { id: first, lineId: cabinets.id, quantity: "4.5", workcenterId: joinery, plannedStart: "2026-10-05", plannedEnd: "2026-10-09" });
      expect(order.payments.map((payment) => [payment.id, payment.title, payment.status])).toEqual([["p1", "Advance", "verified"], ["p2", "Joinery balance", "pending"]]);
      await expect(maker.command(actor, w.workspaceId, first, { action: "link_payment", paymentId: "nope", version: order.order.version })).rejects.toThrow(/payment stage of this project/);
      await expect(checker.command(actor, w.workspaceId, first, { action: "link_payment", paymentId: "p2", version: order.order.version })).rejects.toThrow(/can't change work orders/);
      order = await maker.command(actor, w.workspaceId, first, { action: "link_payment", paymentId: "p2", version: order.order.version });
      expect(order.order.readyPaymentId).toBe("p2");
      // The next work order of the project is tied to the same stage.
      const planned = await maker.plan(actor, w.workspaceId, { id: second, lineId: worktop.id, quantity: "2.25", workcenterId: joinery, plannedStart: "2026-10-05", plannedEnd: "2026-10-09" });
      expect(planned.order.readyPaymentId).toBe("p2");

      order = await makeIt(maker, checker, w.workspaceId, first, "4.5", "Doors aligned, edges sealed");
      // The checker adds the check's photo: one per check, the same upload twice changes nothing.
      const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#808080" } }).png().toBuffer();
      const file = { buffer: png, originalname: "check.png", mimetype: "image/png", size: png.length };
      const photo = randomUUID(), checkId = order.checks[0].id;
      await expect(factory(w.people.finance, ["factory.view"]).uploadCheckPhoto(actor, w.workspaceId, first, checkId, photo, file)).rejects.toThrow(/Not allowed/);
      order = await checker.uploadCheckPhoto(actor, w.workspaceId, first, checkId, photo, file);
      order = await checker.uploadCheckPhoto(actor, w.workspaceId, first, checkId, photo, file);
      await expect(checker.uploadCheckPhoto(actor, w.workspaceId, first, checkId, randomUUID(), file)).rejects.toThrow(/already has its photo/);
      expect(order.checks[0].photoId).toBe(photo);
      expect((await checker.checkPhoto(actor, w.workspaceId, photo, true)).contentType).toBe("image/webp");
      const today = (await w.client.query<{ today: string }>("SELECT (now() AT TIME ZONE 'Asia/Dubai')::date::text AS today")).rows[0].today;
      expect([order.order.status, order.order.readyOn, order.checks.map((check) => [check.note, check.checkedByName])])
        .toEqual(["ready", today, [["Doors aligned, edges sealed", "Quinn Checker"]]]);
      // Finance and the account manager hear, in the app and by email; the checker doesn't hear about their own check.
      expect((await told(w, "factory.order_ready")).map((row) => row.recipient).sort()).toEqual([w.people.finance, w.people.seller].sort());
      expect((await told(w, "factory.order_ready", "email")).map((row) => row.recipient).sort()).toEqual([w.people.finance, w.people.seller].sort());
      expect((await told(w, "factory.order_ready"))[0]).toMatchObject({ subject: expect.stringContaining("Kitchen cabinets is ready"), deepLink: `/workspace/projects/${projectId}/money` });
      // The worktop tied to the same stage is still to make: no reminder yet, and the project isn't all made.
      expect([order.readyReminder, (await told(w, "factory.project_ready")).length]).toEqual([null, 0]);

      order = await makeIt(maker, checker, w.workspaceId, second, "2.25", "");
      // Everything is made: the project manager and the installation lead hear; the client is reminded of the joinery balance once.
      expect((await told(w, "factory.project_ready")).map((row) => row.recipient).sort()).toEqual([w.people.manager, w.people.installer].sort());
      expect((await told(w, "factory.project_ready", "email")).length).toBe(2);
      expect(order.readyReminder).toMatchObject({ readyOn: today, outcome: "sent", channel: "email" });
      expect((await w.client.query("SELECT payment_id FROM crm_payment_reminders WHERE workspace_id = $1", [w.workspaceId])).rows).toEqual([{ payment_id: "p2" }]);
      expect((await w.client.query("SELECT count(*)::int AS count FROM notifications WHERE workspace_id = $1 AND event_type = 'portal.payment_due'", [w.workspaceId])).rows[0].count).toBe(1);
      const second_ = (await told(w, "factory.order_ready")).filter((row) => row.subject.startsWith("Worktop"));
      expect(second_[0].body).toContain("The client was reminded to pay Joinery balance.");

      // Tied again, or ready again: the stage's reminder never goes twice.
      order = await maker.command(actor, w.workspaceId, second, { action: "link_payment", paymentId: "p2", version: order.order.version });
      expect((await w.client.query("SELECT count(*)::int AS count FROM factory_ready_reminders WHERE workspace_id = $1", [w.workspaceId])).rows[0].count).toBe(1);
      expect((await w.client.query("SELECT count(*)::int AS count FROM notifications WHERE workspace_id = $1 AND event_type = 'portal.payment_due'", [w.workspaceId])).rows[0].count).toBe(1);

      // The ready date is corrected to an earlier day, never a future one.
      await expect(checker.command(actor, w.workspaceId, second, { action: "set_ready_date", readyOn: "2999-01-01", version: order.order.version })).rejects.toThrow(/future/);
      order = await checker.command(actor, w.workspaceId, second, { action: "set_ready_date", readyOn: today, version: order.order.version });
      expect(order.order.readyOn).toBe(today);
      await expect(maker.command(actor, w.workspaceId, second, { action: "set_ready_date", readyOn: today, version: order.order.version - 1 })).rejects.toThrow(/Someone else changed/);
    });
  });

  it("says why the client wasn't reminded when payment reminders are off, and waits for the rest of the project before telling the delivery team", async () => {
    await world(async (w) => {
      const { maker, checker, joinery, lines } = await started(w);
      const cabinets = lines.find((line) => line.title === "Kitchen cabinets")!;
      await w.client.query(`INSERT INTO crm_client_message_rules (workspace_id, event, enabled) VALUES ($1, 'payments.reminder', false)`, [w.workspaceId]);
      const id = randomUUID();
      let order = await maker.plan(actor, w.workspaceId, { id, lineId: cabinets.id, quantity: "4.5", workcenterId: joinery });
      order = await maker.command(actor, w.workspaceId, id, { action: "update", plannedStart: "2026-10-05", plannedEnd: "2026-10-09", version: order.order.version });
      order = await maker.command(actor, w.workspaceId, id, { action: "link_payment", paymentId: "p2", version: order.order.version });
      // Only the cabinets are tied to the stage, so it's due when they're ready (the worktop isn't planned).
      order = await makeIt(maker, checker, w.workspaceId, id, "4.5", "");
      expect(order.readyReminder).toMatchObject({ outcome: "reminders_off", channel: null });
      expect((await told(w, "factory.order_ready"))[0].body).toContain("payment reminders are off");
      expect((await told(w, "factory.project_ready")).length).toBe(0);
      expect((await w.client.query("SELECT count(*)::int AS count FROM crm_payment_reminders WHERE workspace_id = $1", [w.workspaceId])).rows[0].count).toBe(0);
    });
  });
});
