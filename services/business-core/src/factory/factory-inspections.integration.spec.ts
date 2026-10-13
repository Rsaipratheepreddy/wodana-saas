import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialRepository } from "../commercial/commercial-repository";
import { freezeHash } from "../commercial/commercial.domain";
import type { CommercialData } from "../commercial/commercial.types";
import { InventoryService } from "../inventory/inventory.service";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { DEFAULT_ROLES } from "../project-core/project-checks";
import { ProjectCoreService } from "../project-core/project-core.service";
import { writeInstallationDays } from "../project-core/project-installation";
import { readProjectReadiness } from "../project-core/project-readiness";
import { ProjectWorkService } from "../project-core/project-work.service";
import { OrdersService } from "../purchasing/orders.service";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { inspectionDueSource } from "../reminders/sources/inspections";
import { assertDeliveryCleared, readOpenInspections } from "./factory-inspections";
import { FactoryInspectionsService } from "./factory-inspections.service";
import { FactoryService } from "./factory.service";
import { readProduction } from "./production-status";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const FACTORY = ["factory.view", "factory.manage", "factory.report", "projects.view", "workspace.settings.manage", "stock.manage"];
const PEOPLE = ["manager", "seller", "maker", "checker", "designer", "director", "foreman", "installer"] as const;
type Person = (typeof PEOPLE)[number];
type People = Record<Person, string>;
type World = { client: PoolClient; workspaceId: string; caseId: string; quoteId: string; opportunityId: string; people: People; memberships: People };

/**
 * PLM-150: two design inspections at the factory, run by the designers, with the snag list for the factory; dispatch and
 * delivery wait for the last one.
 */
integration("design inspections at the factory (PLM-150)", () => {
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
    const people = Object.fromEntries(PEOPLE.map((key) => [key, randomUUID()])) as People;
    const memberships = Object.fromEntries(PEOPLE.map((key) => [key, randomUUID()])) as People;
    const names: People = { manager: "Omar Manager", seller: "Sara Seller", maker: "Mo Maker", checker: "Quinn Checker", designer: "Dana Designer", director: "Cleo Director",
      foreman: "Fred Foreman", installer: "Ian Installer" };
    try {
      await client.query("BEGIN");
      for (const key of PEOPLE) await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [people[key], `${people[key].slice(0, 8)}@example.com`, names[key]]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [workspaceId, `fi-${workspaceId.slice(0, 8)}`, people.manager]);
      for (const key of PEOPLE) await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [memberships[key], workspaceId, people[key]]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, workspaceId, party, randomUUID(), randomUUID(), memberships.seller]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunityId, people.manager]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Kitchen')", [kitchen, workspaceId, caseId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','AED')", [workspaceId, caseId, quoteId]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      const run_ = (userId: string) => (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const builder = new QuotationBuilderService({ withPermission: run_(people.manager), withPermissions: run_(people.manager), withAnyPermission: run_(people.manager), hasPermission: async () => true } as never, {} as never);
      await builder.apply(actor, workspaceId, caseId, quoteId, { ops: [
        { op: "upsert", line: { id: "a", title: "Wardrobe", unit: "nos", quantity: "1", rate: "9000", areaId: kitchen } },
        { op: "upsert", line: { id: "b", title: "Vanity", unit: "nos", quantity: "1", rate: "4000", areaId: kitchen } },
      ] });
      await run({ client, workspaceId, caseId, quoteId, opportunityId, people, memberships });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  /** Each command in its own savepoint, as its own transaction would be; `permissions` is all the person holds. */
  function access(w: World, userId: string, permissions: string[]) {
    const savepoint = async <T>(fn: () => Promise<T>) => {
      await w.client.query("SAVEPOINT command");
      try { const result = await fn(); await w.client.query("RELEASE SAVEPOINT command"); return result; }
      catch (error) { await w.client.query("ROLLBACK TO SAVEPOINT command"); throw error; }
    };
    const run = async (_a: unknown, _w: string, code: string | string[], fn: (c: PoolClient, u: { userId: string }) => unknown) => {
      if (!(Array.isArray(code) ? code : [code]).some((item) => permissions.includes(item))) throw new Error("Not allowed");
      return savepoint(() => Promise.resolve(fn(w.client, { userId })));
    };
    return {
      asMember: (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => savepoint(() => Promise.resolve(fn(w.client, { userId }))),
      withPermission: run, withAnyPermission: run,
      hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code),
      grantedPermissions: async (_c: unknown, _w: string, _u: string, codes: string[]) => new Set(codes.filter((code) => permissions.includes(code))),
    } as never;
  }

  /**
   * Accepted and started; both lines made in the factory; the team: the project manager, the designer (inspects), the
   * factory lead (the maker). Inspections on, as `inspections` says.
   */
  async function started(w: World, inspections: Record<string, unknown> = { inspectionsEnabled: true }, team: Partial<Record<Person, string>> = { designer: "designer", maker: "factory_lead" }) {
    const loaded = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!;
    const data = { ...(loaded.content as CommercialData), revision: loaded.revision };
    const quote = data.quotes.find((item) => item.id === w.quoteId)!;
    quote.status = "accepted";
    quote.hash = freezeHash(quote);
    quote.clientDecision = { decision: "accept", quoteHash: quote.hash, selectedOptionLineIds: [], baseTotal: 13000, optionsTotal: 0, acceptedTotal: 13000,
      decidedAt: "2026-09-20T10:00:00.000Z", decidedBy: "Maya Client", method: "signed_document", recordedBy: "Omar Manager" };
    data.agreement = { quoteId: w.quoteId, quoteHash: quote.hash, reference: "AG-7", terms: "", evidence: "signed.pdf", evidenceKind: "operational", status: "executed", executedAt: "2026-09-21T10:00:00.000Z", executedBy: "Omar Manager" };
    data.payments = [{ id: "p1", sourceQuoteId: w.quoteId, title: "Advance", amount: 13000, currency: "AED", dueDate: "", requiredForRelease: true, requiredForProduction: true, status: "verified",
      proof: "bank transfer", reference: "TT-1", evidenceKind: "operational" }] as CommercialData["payments"];
    data.revision = loaded.revision + 1;
    await commercialRepository.save(w.client, w.workspaceId, w.caseId, data);
    const manager = ["projects.manage", "projects.view", "pre_projects.view", "workspace.settings.manage"];
    const core = new ProjectCoreService(access(w, w.people.manager, manager));
    const { projectId } = await core.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.memberships.manager });
    for (const [person, role] of Object.entries(team)) await w.client.query(
      `INSERT INTO project_assignments (workspace_id, project_id, membership_id, is_manager, active, role_keys) VALUES ($1, $2, $3, false, true, ARRAY[$4]::varchar[])`,
      [w.workspaceId, projectId, w.memberships[person as Person], role]);
    await w.client.query(`INSERT INTO project_assignments (workspace_id, project_id, membership_id, is_manager, active, role_keys) VALUES ($1, $2, $3, false, true, ARRAY['installation_lead']::varchar[])`,
      [w.workspaceId, projectId, w.memberships.installer]);
    const stored = new Map<string, Buffer>();
    const storage = { put: async (key: string, body: Buffer) => { stored.set(key, body); }, read: async (key: string) => ({ body: stored.get(key)! }) } as never;
    const factory = (userId: string, permissions = FACTORY) => new FactoryService(access(w, userId, permissions), new OrdersService(access(w, userId, permissions)),
      new InventoryService(access(w, userId, permissions)), storage);
    const inspections_ = (userId: string, permissions: string[]) => new FactoryInspectionsService(access(w, userId, permissions), storage);
    const work = (userId: string, permissions: string[]) => new ProjectWorkService(access(w, userId, permissions));
    const maker = factory(w.people.maker), checker = factory(w.people.checker, ["factory.view", "factory.approve", "projects.view"]);
    const scope = await core.scope(actor, w.workspaceId, projectId);
    let detail = await core.get(actor, w.workspaceId, projectId);
    for (const pkg of scope.packages) detail = await core.command(actor, w.workspaceId, projectId, { action: "save_package", id: pkg.id, name: pkg.name, supply: "make", version: detail.project.version });
    const settings = await maker.settings(actor, w.workspaceId);
    await maker.saveSettings(actor, w.workspaceId, { version: settings.settings.version, requireDrawing: false, requirePayment: false, requireMaterials: false, requireCheck: true, ...inspections });
    const joinery = randomUUID();
    await maker.saveWorkcenter(actor, w.workspaceId, { id: joinery, name: "Joinery", hoursPerDay: "8" });
    const lines = (await core.scope(actor, w.workspaceId, projectId)).lines;
    const designer = inspections_(w.people.designer, ["projects.view"]);
    const pm = inspections_(w.people.manager, manager);
    return { projectId, core, maker, checker, factory, inspections: inspections_, work, designer, pm, joinery, lines };
  }

  const told = async (w: World, event: string, channel = "in_app") => (await w.client.query<{ recipient: string; subject: string; body: string; deepLink: string }>(
    `SELECT recipient_id AS recipient, subject, body, deep_link AS "deepLink" FROM notifications WHERE workspace_id = $1 AND event_type = $2 AND channel = $3 ORDER BY created_at, recipient_id`,
    [w.workspaceId, event, channel])).rows;
  const png = () => sharp({ create: { width: 4, height: 4, channels: 3, background: "#808080" } }).png().toBuffer().then((buffer) => ({ buffer, originalname: "snag.png", mimetype: "image/png", size: buffer.length }));

  /** Planned, released and started (in production). */
  async function inProduction(maker: FactoryService, workspaceId: string, lineId: string, joinery: string) {
    const id = randomUUID();
    let order = await maker.plan(actor, workspaceId, { id, lineId, quantity: "1", workcenterId: joinery, plannedStart: "2026-10-05", plannedEnd: "2026-10-09" });
    order = await maker.command(actor, workspaceId, id, { action: "release", version: order.order.version });
    order = await maker.command(actor, workspaceId, id, { action: "start", version: order.order.version });
    return { id, order };
  }

  /** Reported, approved and checked: ready. */
  async function finish(maker: FactoryService, checker: FactoryService, workspaceId: string, id: string) {
    let order = await maker.order(actor, workspaceId, id);
    const report = randomUUID();
    order = await maker.command(actor, workspaceId, id, { action: "report", id: report, good: "1" });
    order = await checker.command(actor, workspaceId, id, { action: "decide_report", reportId: report, decision: "approve", version: order.order.version });
    return checker.command(actor, workspaceId, id, { action: "check", id: randomUUID(), passed: "1" });
  }

  /** The designer fails a round with a photo and snag lines. */
  async function fail(service: FactoryInspectionsService, workspaceId: string, inspectionId: string, snags: string[]) {
    let round = await service.detail(actor, workspaceId, inspectionId);
    round = await service.uploadPhoto(actor, workspaceId, inspectionId, randomUUID(), await png());
    return service.command(actor, workspaceId, inspectionId, { action: "fail", version: round.row.version, comments: "Not to the drawing", snags: snags.map((title) => ({ title })) });
  }

  /** The factory lead marks every open snag of the round fixed (in the project's task system). */
  async function fixAll(w: World, work: ProjectWorkService, projectId: string, inspectionId: string) {
    const snags = (await w.client.query<{ id: string; version: number }>(`SELECT id, version FROM work_items WHERE workspace_id = $1 AND factory_inspection_id = $2 AND status IN ('todo', 'in_progress') ORDER BY number`,
      [w.workspaceId, inspectionId])).rows;
    for (const snag of snags) await work.command(actor, w.workspaceId, projectId, { action: "update", itemId: snag.id, status: "in_review", version: snag.version });
  }

  const openRound = async (w: World, orderId: string) => (await w.client.query<{ id: string; stage: string; round: number }>(
    `SELECT id, stage, round FROM factory_inspections WHERE workspace_id = $1 AND work_order_id = $2 AND status = 'due'`, [w.workspaceId, orderId])).rows[0] ?? null;

  it("runs Inspection 1 and 2 with the snag list: the designer is told, fails with photos, the factory fixes, it comes back, and dispatch waits for Inspection 2", async () => {
    await world(async (w) => {
      const { projectId, maker, checker, designer, pm, work, inspections, joinery, lines } = await started(w);
      const wardrobe = lines.find((line) => line.title === "Wardrobe")!;
      const { id } = await inProduction(maker, w.workspaceId, wardrobe.id, joinery);
      expect((await w.client.query("SELECT inspection_stages FROM work_orders WHERE id = $1", [id])).rows[0].inspection_stages).toEqual(["raw", "final"]);
      let order = await maker.order(actor, w.workspaceId, id);
      expect([order.next, order.inspection]).toEqual(["request_inspection", expect.objectContaining({ raw: "to_request", final: "to_request" })]);
      // Finished output waits for Inspection 1 (raw material, before the final finish).
      await expect(maker.command(actor, w.workspaceId, id, { action: "report", id: randomUUID(), good: "1" })).rejects.toThrow(/Mark it ready for Inspection 1 before the final finish/);
      // Only the factory marks it ready; the designer can't.
      await expect(factoryAs(w, w.people.designer, ["projects.view"]).command(actor, w.workspaceId, id, { action: "request_inspection", stage: "raw", version: order.order.version })).rejects.toThrow(/Not allowed/);
      await expect(maker.command(actor, w.workspaceId, id, { action: "request_inspection", stage: "final", version: order.order.version })).rejects.toThrow(/once it's made and checked/);
      order = await maker.command(actor, w.workspaceId, id, { action: "request_inspection", stage: "raw", version: order.order.version });
      expect(order.next).toBe("inspection");
      const raw = (await openRound(w, id))!;
      expect(raw).toMatchObject({ stage: "raw", round: 1 });
      // The designer hears it (in the app and by email); the project manager too, as an optional attendee; the maker isn't told of their own step.
      const ready = await told(w, "factory.inspection_ready");
      expect(ready.map((row) => row.recipient).sort()).toEqual([w.people.designer, w.people.manager].sort());
      expect(ready.find((row) => row.recipient === w.people.designer)).toMatchObject({ subject: "Wardrobe is ready for Inspection 1", deepLink: `/workspace/inspections/${raw.id}` });
      expect(ready.find((row) => row.recipient === w.people.manager)?.body).toContain("You may attend.");
      expect((await told(w, "factory.inspection_ready", "email")).length).toBe(2);
      // The open inspection the design calendar reads: who, which item, which project, when.
      const open = await readOpenInspections(w.client, w.workspaceId, { membershipId: w.memberships.designer });
      expect(open).toEqual([expect.objectContaining({ id: raw.id, order: `WO-${String(order.order.number).padStart(4, "0")}`, item: "Wardrobe", projectId,
        stage: "raw", inspectorName: "Dana Designer", inspectorRole: "designer", overdue: false })]);
      // Asked twice: the same round.
      order = await maker.command(actor, w.workspaceId, id, { action: "request_inspection", stage: "raw", version: order.order.version });
      expect((await w.client.query("SELECT count(*)::int AS count FROM factory_inspections WHERE work_order_id = $1", [id])).rows[0].count).toBe(1);

      // The factory can't record its own inspection; someone outside the design team can't either.
      const makerView = inspections(w.people.maker, FACTORY);
      let round = await makerView.detail(actor, w.workspaceId, raw.id);
      expect([round.canRecord, round.why]).toEqual([false, expect.stringContaining("design team records")]);
      await expect(makerView.command(actor, w.workspaceId, raw.id, { action: "pass", version: round.row.version })).rejects.toThrow(/design team records/);
      const foreman = inspections(w.people.foreman, ["factory.view", "factory.approve", "projects.view"]);
      await expect(foreman.command(actor, w.workspaceId, raw.id, { action: "pass", version: round.row.version })).rejects.toThrow(/inspecting designer or a manager/);
      // Failing needs comments, snag lines and a photo.
      round = await designer.detail(actor, w.workspaceId, raw.id);
      expect(round.canRecord).toBe(true);
      await expect(designer.command(actor, w.workspaceId, raw.id, { action: "fail", version: round.row.version, comments: "Gaps", snags: [{ title: "Gap at the top" }] }))
        .rejects.toThrow(/Add a photo/);
      await expect(designer.command(actor, w.workspaceId, raw.id, { action: "fail", version: round.row.version, comments: "", snags: [{ title: "Gap" }] })).rejects.toThrow(/Say what's wrong/);
      round = await fail(designer, w.workspaceId, raw.id, ["Carcass out of square", "Shelf pins missing"]);
      expect(round.row.status).toBe("failed");
      // The snags are the factory's rectification tasks, on the item's scope line, given to the factory lead.
      const snags = (await w.client.query<{ title: string; source: string; severity: string; assignee: string; line: string }>(
        `SELECT title, source, severity, assignee_membership_id AS assignee, boq_line_id AS line FROM work_items WHERE factory_inspection_id = $1 ORDER BY number`, [raw.id])).rows;
      expect(snags).toEqual([{ title: "Carcass out of square", source: "inspection", severity: "major", assignee: w.memberships.maker, line: wardrobe.id },
        { title: "Shelf pins missing", source: "inspection", severity: "major", assignee: w.memberships.maker, line: wardrobe.id }]);
      expect((await told(w, "factory.inspection_snags")).map((row) => [row.recipient, row.body])).toEqual([[w.people.maker, expect.stringContaining("2 snags: Carcass out of square; Shelf pins missing")]]);
      expect((await told(w, "factory.inspection_failed")).map((row) => row.recipient)).toEqual([w.people.manager]);
      order = await maker.order(actor, w.workspaceId, id);
      expect([order.next, order.inspection?.raw]).toEqual(["snags", "snags"]);
      await expect(maker.command(actor, w.workspaceId, id, { action: "request_inspection", stage: "raw", version: order.order.version })).rejects.toThrow(/Fix its 2 snags first/);

      // The factory fixes them: once the last is fixed, the item comes back for round 2 by itself and the designer hears.
      const lead = work(w.people.maker, ["projects.view"]);
      await fixAll(w, lead, projectId, raw.id);
      const again = (await openRound(w, id))!;
      expect(again).toMatchObject({ stage: "raw", round: 2 });
      expect((await told(w, "factory.reinspection_ready")).map((row) => row.recipient).sort()).toEqual([w.people.designer, w.people.manager].sort());
      // The re-inspection was asked for as the factory asked: the maker still can't record it.
      expect((await makerView.detail(actor, w.workspaceId, again.id)).canRecord).toBe(false);
      round = await designer.detail(actor, w.workspaceId, again.id);
      round = await designer.command(actor, w.workspaceId, again.id, { action: "pass", version: round.row.version, comments: "Square now" });
      // Its pass closes the fixed snags of round 1; the factory hears finishing can go ahead.
      expect((await w.client.query("SELECT status FROM work_items WHERE factory_inspection_id = $1", [raw.id])).rows.map((row) => row.status)).toEqual(["done", "done"]);
      expect((await told(w, "factory.inspection_passed")).map((row) => row.recipient)).toEqual([w.people.maker]);
      expect(round.rounds.map((entry) => [entry.stage, entry.round, entry.status, entry.snags])).toEqual([["raw", 1, "failed", 2], ["raw", 2, "passed", 0]]);

      // Finished, reported and checked: ready, and Inspection 2 goes to the designer by itself.
      order = await finish(maker, checker, w.workspaceId, id);
      expect([order.order.status, order.next]).toEqual(["ready", "inspection"]);
      const final = (await openRound(w, id))!;
      expect(final).toMatchObject({ stage: "final", round: 1 });
      expect((await told(w, "factory.inspection_ready")).filter((row) => row.subject.includes("Inspection 2")).map((row) => row.recipient).sort())
        .toEqual([w.people.designer, w.people.manager].sort());
      // The order-ready date is still recorded (Finance's joinery balance), but production reads the quality check until it passes.
      expect(order.order.readyOn).toEqual(expect.any(String));
      expect((await readProduction(w.client, w.workspaceId, projectId)).projects[0].step?.kind).toBe("quality_check");
      expect((await readProjectReadiness(w.client, w.workspaceId, projectId, { columns: ["production"] } as never, { production: true, supply: true, delivery: true })).rows
        .find((row) => row.id === wardrobe.id)?.cells.production).toEqual({ state: "waiting", note: "inspection_due" });
      // Dispatch, a stock move from the factory and booking the delivery are refused until it passes.
      const shipper = factoryAs(w, w.people.maker);
      await expect(shipper.command(actor, w.workspaceId, id, { action: "dispatch", id: randomUUID(), quantity: "1" })).rejects.toThrow(/WO-\d{4} Wardrobe can't go to site yet: Inspection 2 hasn't passed/);
      await expect(writeInstallationDays(w.client, { workspaceId: w.workspaceId, projectId, days: { deliveryOn: "2026-11-01", installationOn: "2026-11-02", note: "" }, actorUserId: w.people.manager,
        canClear: true, team: [] })).rejects.toThrow(/The delivery waits for the design inspection/);

      // Failed twice: round 1 and round 2 of Inspection 2 fail, each with its own snags; round 3 passes.
      await fail(designer, w.workspaceId, final.id, ["Veneer lifting"]);
      await fixAll(w, lead, projectId, final.id);
      const second = (await openRound(w, id))!;
      expect(second).toMatchObject({ stage: "final", round: 2 });
      await fail(designer, w.workspaceId, second.id, ["Handle scratched"]);
      await fixAll(w, lead, projectId, second.id);
      const third = (await openRound(w, id))!;
      expect(third).toMatchObject({ stage: "final", round: 3 });
      // A manager may record it too (the project manager attended).
      round = await pm.detail(actor, w.workspaceId, third.id);
      round = await pm.command(actor, w.workspaceId, third.id, { action: "pass", version: round.row.version });
      await expect(pm.command(actor, w.workspaceId, third.id, { action: "pass", version: round.row.version })).rejects.toThrow(/already recorded/);
      expect(round.rounds.filter((entry) => entry.stage === "final").map((entry) => [entry.round, entry.status])).toEqual([[1, "failed"], [2, "failed"], [3, "passed"]]);
      // The project manager and the factory hear it can go to site; then it can be dispatched.
      expect((await told(w, "factory.dispatch_cleared")).map((row) => row.recipient).sort()).toEqual([w.people.maker, w.people.checker].sort());
      expect((await readProduction(w.client, w.workspaceId, projectId)).projects[0].step?.kind).not.toBe("ready");
      order = await shipper.order(actor, w.workspaceId, id);
      expect(order.next).toBe("send");
      order = await shipper.command(actor, w.workspaceId, id, { action: "dispatch", id: randomUUID(), quantity: "1" });
      expect(order.dispatches).toHaveLength(1);
      expect(await readOpenInspections(w.client, w.workspaceId)).toEqual([]);
    });
  });

  function factoryAs(w: World, userId: string, permissions = FACTORY) {
    return new FactoryService(access(w, userId, permissions), new OrdersService(access(w, userId, permissions)), new InventoryService(access(w, userId, permissions)));
  }

  it("goes to the Creative Director on its projects, says so when nobody inspects, and skips Inspection 1 when the firm keeps one", async () => {
    await world(async (w) => {
      // Designed by the Creative Director: the package is the project's, the director role is on the team.
      const pkg = (await w.client.query<{ id: string }>(`INSERT INTO design_packages (workspace_id, code, name, pricing_method, rate, currency) VALUES ($1, 'creative_director', 'Designed by the CD', 'fixed', 0, 'AED') RETURNING id`,
        [w.workspaceId])).rows[0].id;
      await w.client.query(`INSERT INTO crm_opportunity_discovery (workspace_id, opportunity_id, design_package_id) VALUES ($1, $2, $3)`, [w.workspaceId, w.opportunityId, pkg]);
      // The firm's project roles include its Creative Director.
      await w.client.query(`INSERT INTO workspace_project_settings (workspace_id, roles) VALUES ($1, $2::jsonb) ON CONFLICT (workspace_id) DO UPDATE SET roles = EXCLUDED.roles`,
        [w.workspaceId, JSON.stringify([...DEFAULT_ROLES, { key: "creative_director", label: "Creative Director" }])]);
      const { maker, checker, inspections, joinery, lines } = await started(w,
        { inspectionsEnabled: true, inspectionStages: [{ kind: "final", label: "Design check" }], directorRole: "creative_director", directorPackages: ["creative_director"] },
        { designer: "designer", director: "creative_director", maker: "factory_lead" });
      const { id } = await inProduction(maker, w.workspaceId, lines.find((line) => line.title === "Wardrobe")!.id, joinery);
      // Inspection 1 skipped by configuration: finishing goes on, and only the inspection after finishing is asked for.
      let order = await finish(maker, checker, w.workspaceId, id);
      expect(order.inspection).toMatchObject({ raw: "not_needed", final: "due" });
      const round = (await openRound(w, id))!;
      expect((await w.client.query("SELECT inspector_membership_id AS inspector, inspector_role AS role FROM factory_inspections WHERE id = $1", [round.id])).rows[0])
        .toEqual({ inspector: w.memberships.director, role: "creative_director" });
      expect((await told(w, "factory.inspection_ready")).find((row) => row.recipient === w.people.director)?.subject).toBe("Wardrobe is ready for Design check");
      // The project's designer (not the director here) still records it as an inspecting role.
      expect((await inspections(w.people.designer, ["projects.view"]).detail(actor, w.workspaceId, round.id)).canRecord).toBe(true);

      // A second project item with nobody on the team to inspect: the project manager hears, and records it.
      await w.client.query(`UPDATE project_assignments SET active = false WHERE workspace_id = $1 AND role_keys && ARRAY['designer', 'creative_director']::varchar[]`, [w.workspaceId]);
      const vanity = await inProduction(maker, w.workspaceId, lines.find((line) => line.title === "Vanity")!.id, joinery);
      order = await finish(maker, checker, w.workspaceId, vanity.id);
      const orphan = (await openRound(w, vanity.id))!;
      expect((await w.client.query("SELECT inspector_membership_id AS inspector FROM factory_inspections WHERE id = $1", [orphan.id])).rows[0].inspector).toBeNull();
      expect((await told(w, "factory.inspector_missing")).map((row) => [row.recipient, row.body])).toEqual([[w.people.manager, expect.stringContaining("nobody in the Creative Director role")]]);
      const pm = inspections(w.people.manager, ["projects.manage", "projects.view"]);
      const view = await pm.detail(actor, w.workspaceId, orphan.id);
      expect((await pm.command(actor, w.workspaceId, orphan.id, { action: "pass", version: view.row.version })).row.status).toBe("passed");
      // Overdue inspections go through the reminder engine: the open one is listed with its due day, owned by its inspector.
      const clock = { today: "2099-01-01", timeZone: "Asia/Dubai", start: "09:00", workingDays: [1, 2, 3, 4, 5], holidays: [] };
      const due = await inspectionDueSource.open(w.client as never, w.workspaceId, { clock, now: new Date(), limit: 50 } as never);
      expect(due).toEqual([]);
      const listed = await inspectionDueSource.open(w.client as never, w.workspaceId, { clock: { ...clock, today: (await w.client.query("SELECT due_on::text AS due FROM factory_inspections WHERE id = $1", [round.id])).rows[0].due },
        now: new Date(), limit: 50 } as never);
      expect(listed.map((item) => [item.key, item.ownerMembershipId, item.href])).toEqual([[`inspection:${round.id}`, w.memberships.director, `/workspace/inspections/${round.id}`]]);
      expect(await inspectionDueSource.stillOpen(w.client as never, w.workspaceId, [`inspection:${round.id}`, `inspection:${orphan.id}`])).toEqual(new Set([`inspection:${round.id}`]));
    });
  });

  it("leaves work orders from before inspections alone, never inspects what inspections don't cover, and withdraws a cancelled one", async () => {
    await world(async (w) => {
      const { maker, checker, joinery, lines, projectId } = await started(w, { inspectionsEnabled: false });
      const wardrobe = lines.find((line) => line.title === "Wardrobe")!;
      // Made while inspections were off (or before them): nothing is asked of it, whatever the settings say later.
      const { id } = await inProduction(maker, w.workspaceId, wardrobe.id, joinery);
      await w.client.query("UPDATE work_orders SET inspection_stages = NULL WHERE id = $1", [id]);
      const settings = await maker.settings(actor, w.workspaceId);
      await maker.saveSettings(actor, w.workspaceId, { version: settings.settings.version, inspectionsEnabled: true });
      let order = await finish(maker, checker, w.workspaceId, id);
      expect([order.order.status, order.inspection, await openRound(w, id)]).toEqual(["ready", null, null]);
      order = await factoryAs(w, w.people.maker).command(actor, w.workspaceId, id, { action: "dispatch", id: randomUUID(), quantity: "1" });
      expect(order.dispatches).toHaveLength(1);
      await expect(assertDeliveryCleared(w.client, w.workspaceId, { projectId })).resolves.toBeUndefined();
      // A work order planned now needs them; cancelled while its inspection is open, the inspection is withdrawn.
      const vanity = await inProduction(maker, w.workspaceId, lines.find((line) => line.title === "Vanity")!.id, joinery);
      order = await maker.command(actor, w.workspaceId, vanity.id, { action: "request_inspection", stage: "raw", version: vanity.order.order.version });
      order = await maker.command(actor, w.workspaceId, vanity.id, { action: "cancel", reason: "Client dropped it", version: order.order.version });
      expect((await w.client.query("SELECT status FROM factory_inspections WHERE work_order_id = $1", [vanity.id])).rows).toEqual([{ status: "cancelled" }]);
      expect(await readOpenInspections(w.client, w.workspaceId)).toEqual([]);
    });
  });
});
