import { randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CatalogV2Service } from "../catalog-core/catalog-v2.service";
import { commercialRepository } from "../commercial/commercial-repository";
import { freezeHash } from "../commercial/commercial.domain";
import type { CommercialData } from "../commercial/commercial.types";
import { FactoryService } from "../factory/factory.service";
import { InventoryService } from "../inventory/inventory.service";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { OrdersService } from "../purchasing/orders.service";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { ProjectCoreService } from "./project-core.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const MANAGE = ["projects.manage", "projects.view", "pre_projects.view", "pre_projects.edit", "workspace.settings.manage", "stock.manage", "catalog.view", "catalog.manage"];
const FACTORY = ["factory.view", "factory.manage", "factory.report", "factory.approve", "projects.view", "workspace.settings.manage", "stock.manage", "catalog.view"];
const TEAM = ["projects.view", "pre_projects.view", "catalog.view"];

type People = { manager: string; seller: string; maker: string; techie: string };
type World = { client: PoolClient; workspaceId: string; caseId: string; quoteId: string; opportunityId: string; catalogId: string; sofa: string; people: People; memberships: People; today: string };

const plus = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);

/**
 * PLM-162 / PLM-166 (recipes verified by the factory, factory requirements per custom line), PLM-165 (the technical
 * handover pack) and PLM-174 (the path E checks on the route and before a work order is released).
 */
integration("technical handover, factory requirements and the path E checks (PLM-162, 165, 166, 174)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(run: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), quoteId = randomUUID(), party = randomUUID(), opportunityId = randomUUID(), lounge = randomUUID();
    const catalogId = randomUUID(), sofa = randomUUID(), board = randomUUID(), upholstery = randomUUID();
    const people: People = { manager: randomUUID(), seller: randomUUID(), maker: randomUUID(), techie: randomUUID() };
    const memberships: People = { manager: randomUUID(), seller: randomUUID(), maker: randomUUID(), techie: randomUUID() };
    const names: People = { manager: "Omar Manager", seller: "Sara Seller", maker: "Faris Factory", techie: "Tara Technical" };
    try {
      await client.query("BEGIN");
      for (const key of Object.keys(people) as Array<keyof People>)
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [people[key], `${people[key].slice(0, 8)}@example.com`, names[key]]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','UTC',$3)", [workspaceId, `th-${workspaceId.slice(0, 8)}`, people.manager]);
      for (const key of Object.keys(people) as Array<keyof People>)
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [memberships[key], workspaceId, people[key]]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      // A bespoke furniture job (path E).
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at,furniture_path)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now(),'bespoke')`, [opportunityId, workspaceId, party, randomUUID(), randomUUID(), memberships.seller]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunityId, people.manager]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Lounge')", [lounge, workspaceId, caseId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','AED')", [workspaceId, caseId, quoteId]);
      // The catalogue: a sofa assembly with a structured recipe (board per unit, labour with hours), not verified yet.
      await client.query("INSERT INTO catalogs(id,workspace_id,code,name,purpose) VALUES($1,$2,'furniture','Furniture','sell')", [catalogId, workspaceId]);
      await client.query("INSERT INTO catalog_items(id,workspace_id,catalog_id,code,name,item_type,unit_code) VALUES($1,$2,$3,'SOFA-1','Sofa','assembly','pcs'),($4,$2,$3,'MDF-18','18mm MDF','material','pcs'),($5,$2,$3,'UPH','Upholstery','service','hr')",
        [sofa, workspaceId, catalogId, board, upholstery]);
      await client.query(`INSERT INTO catalog_components(workspace_id,parent_item_id,component_item_id,quantity_formula,unit_code,sort_order,component_type,quantity_basis,batch_size,labour_hours)
        VALUES($1,$2,$3,'2','pcs',0,'board','per_unit',NULL,NULL),($1,$2,$4,'1','hr',1,'labour','per_unit',NULL,'3.5')`, [workspaceId, sofa, board, upholstery]);
      await client.query("SET LOCAL session_replication_role = origin");
      await seedDefaultNotificationTemplates(client, workspaceId);
      const today = (await client.query<{ today: string }>("SELECT (now() AT TIME ZONE 'UTC')::date::text AS today")).rows[0].today;
      const run_ = (userId: string) => (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const builder = new QuotationBuilderService({ withPermission: run_(people.manager), withPermissions: run_(people.manager), withAnyPermission: run_(people.manager), hasPermission: async () => true } as never, {} as never);
      await builder.apply(actor, workspaceId, caseId, quoteId, { ops: [
        { op: "upsert", line: { id: "a", title: "Sofa", unit: "pcs", quantity: "2", rate: "4000", areaId: lounge } },
        { op: "upsert", line: { id: "b", title: "Wardrobe", unit: "pcs", quantity: "1", rate: "3000", areaId: lounge } },
      ] });
      // The sofa is the catalogue's; the wardrobe is bespoke with its size and material on the line.
      await client.query(`UPDATE commercial_quote_lines SET catalog_item_id = $3 WHERE workspace_id = $1 AND quote_id = $2 AND id = 'a'`, [workspaceId, quoteId, sofa]);
      await client.query(`UPDATE commercial_quote_lines SET width = 180, height = 240, dimension_unit = 'cm', material = 'MR MDF' WHERE workspace_id = $1 AND quote_id = $2 AND id = 'b'`, [workspaceId, quoteId]);
      await run({ client, workspaceId, caseId, quoteId, opportunityId, catalogId, sofa, people, memberships, today });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  /** Permission checks as the person has them; each command in a savepoint, so a refused one leaves nothing behind. */
  const access = (w: World, userId: string, permissions: string[]) => {
    const run = async (_a: unknown, _w: string, code: string | string[], fn: (c: PoolClient, u: { userId: string }) => unknown) => {
      if (!(Array.isArray(code) ? code : [code]).some((item) => permissions.includes(item))) throw new ForbiddenException("Not allowed");
      await w.client.query("SAVEPOINT command");
      try { const result = await fn(w.client, { userId }); await w.client.query("RELEASE SAVEPOINT command"); return result; }
      catch (error) { await w.client.query("ROLLBACK TO SAVEPOINT command"); throw error; }
    };
    const member = async (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => run(_a, _w, permissions, fn);
    return { asMember: member, withPermission: run, withAnyPermission: run, withPermissions: run,
      hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code) } as never;
  };

  const told = async (w: World, event: string, channel = "in_app") => (await w.client.query<{ recipient: string; subject: string; deepLink: string }>(
    `SELECT recipient_id AS recipient, subject, deep_link AS "deepLink" FROM notifications WHERE workspace_id = $1 AND event_type = $2 AND channel = $3 ORDER BY created_at, recipient_id`,
    [w.workspaceId, event, channel])).rows;
  const audited = async (w: World, action: string) => (await w.client.query<{ count: string }>(`SELECT count(*)::text AS count FROM audit_events WHERE workspace_id = $1 AND action = $2`, [w.workspaceId, action])).rows[0].count;

  /** The accepted, paid quote; a route whose Production stage holds the path E checks; the project started with its team; both lines made in the factory. */
  async function started(w: World) {
    const loaded = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!;
    const data = { ...(loaded.content as CommercialData), revision: loaded.revision };
    const quote = data.quotes.find((item) => item.id === w.quoteId)!;
    quote.status = "accepted";
    quote.hash = freezeHash(quote);
    quote.clientDecision = { decision: "accept", quoteHash: quote.hash, selectedOptionLineIds: [], baseTotal: 11000, optionsTotal: 0, acceptedTotal: 11000,
      decidedAt: "2026-09-20T10:00:00.000Z", decidedBy: "Maya Client", method: "signed_document", recordedBy: "Omar Manager" };
    data.agreement = { quoteId: w.quoteId, quoteHash: quote.hash, reference: "AG-7", terms: "", evidence: "signed.pdf", evidenceKind: "operational", status: "executed", executedAt: "2026-09-21T10:00:00.000Z", executedBy: "Omar Manager" };
    data.payments = [{ id: "p1", sourceQuoteId: w.quoteId, title: "Advance", amount: 11000, currency: "AED", dueDate: "", requiredForRelease: true, requiredForProduction: true, status: "verified",
      proof: "bank transfer", reference: "TT-1", evidenceKind: "operational" }] as CommercialData["payments"];
    data.revision = loaded.revision + 1;
    await commercialRepository.save(w.client, w.workspaceId, w.caseId, data);
    await w.client.query(`UPDATE commercial_quotes SET status = 'accepted' WHERE workspace_id = $1 AND id = $2`, [w.workspaceId, w.quoteId]);
    const core = new ProjectCoreService(access(w, w.people.manager, MANAGE));
    const settings = await core.saveTemplate(actor, w.workspaceId, { name: "Bespoke", isDefault: true, stages: [
      { name: "Production", ownerRole: "factory_lead", checks: [{ kind: "technical_handover_accepted" }, { kind: "factory_requirements_confirmed" }, { kind: "qs_approved" }, { kind: "everything_made" }] },
      { name: "Handover", ownerRole: "project_manager", checks: [{ kind: "confirm", label: "Keys handed over" }] },
    ] });
    const templateId = settings.templates.find((template) => template.name === "Bespoke")!.id;
    const { projectId } = await core.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.memberships.manager, templateId });
    let detail = await core.get(actor, w.workspaceId, projectId);
    for (const [role, membershipId] of [["factory_lead", w.memberships.maker], ["technical_designer", w.memberships.techie], ["account_manager", w.memberships.seller]] as const)
      detail = await core.command(actor, w.workspaceId, projectId, { action: "set_member", role, membershipId, version: detail.project.version });
    const scope = await core.scope(actor, w.workspaceId, projectId);
    for (const title of ["Sofa", "Wardrobe"]) {
      const lineId = scope.lines.find((line) => line.title === title)!.id;
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_package", name: title, supply: "make", version: detail.project.version });
      const created = (await core.scope(actor, w.workspaceId, projectId)).packages.find((entry) => entry.name === title)!;
      detail = await core.command(actor, w.workspaceId, projectId, { action: "assign_lines", lineIds: [lineId], packageId: created.id, version: detail.project.version });
    }
    const as = (userId: string, permissions: string[]) => new ProjectCoreService(access(w, userId, permissions));
    const factory = (userId: string, permissions = FACTORY) => new FactoryService(access(w, userId, permissions), new OrdersService(access(w, userId, permissions)),
      new InventoryService(access(w, userId, permissions)), { put: async () => undefined, read: async () => ({ body: Buffer.alloc(0) }) } as never);
    const version = async () => (await core.get(actor, w.workspaceId, projectId)).project.version;
    const lines = (await core.scope(actor, w.workspaceId, projectId)).lines;
    return { core, projectId, as, factory, version, sofa: lines.find((line) => line.title === "Sofa")!, wardrobe: lines.find((line) => line.title === "Wardrobe")! };
  }

  it("takes quantities only from a verified recipe, lets the factory lead confirm a custom line, and hands the pack over for the technical team to accept", async () => {
    await world(async (w) => {
      const { core, projectId, as, version, sofa, wardrobe } = await started(w);
      const techie = as(w.people.techie, TEAM), seller = as(w.people.seller, TEAM), maker = as(w.people.maker, FACTORY);

      // PLM-166: nothing is guessed. The sofa's recipe isn't verified, the wardrobe has none: both need factory requirements.
      let pack = await core.technicalHandover(actor, w.workspaceId, projectId);
      expect(pack.status).toBe("draft");
      expect(pack.rows.map((row) => [row.title, row.requirements, row.drawing?.needed])).toEqual([["Sofa", "needs_requirements", true], ["Wardrobe", "needs_requirements", true]]);
      expect(pack.requirements.find((row) => row.title === "Sofa")!.recipe).toEqual({ state: "unverified", components: 2 });
      expect(pack.rows.find((row) => row.title === "Wardrobe")!.size).toBe("180 × 240 cm");
      expect(pack.missing).toBeGreaterThan(0);

      // The factory verifies the sofa's recipe (who and when): its quantities are worked out for the line, by kind.
      const catalog = new CatalogV2Service(access(w, w.people.maker, FACTORY), {} as never);
      const item = await catalog.getItem(actor, w.workspaceId, w.catalogId, w.sofa);
      expect(item.canVerifyRecipe).toBe(true);
      await expect(new CatalogV2Service(access(w, w.people.seller, TEAM), {} as never).verifyRecipe(actor, w.workspaceId, w.catalogId, w.sofa, { version: item.version, verified: true })).rejects.toBeInstanceOf(ForbiddenException);
      const verified = await catalog.verifyRecipe(actor, w.workspaceId, w.catalogId, w.sofa, { version: item.version, verified: true });
      expect(verified.recipeVerified).toMatchObject({ byName: "Faris Factory" });
      pack = await core.technicalHandover(actor, w.workspaceId, projectId);
      const sofaRow = pack.requirements.find((row) => row.title === "Sofa")!;
      expect(sofaRow.state).toBe("verified");
      expect(sofaRow.recipe.state === "verified" && sofaRow.recipe.lines.map((line) => [line.componentType, line.label, line.quantity, line.hours])).toEqual([["board", "18mm MDF", "4", null], ["labour", "Upholstery", "2", "7"]]);
      expect(sofaRow.recipe.state === "verified" && sofaRow.recipe.labourHours).toBe("7");
      expect(await audited(w, "catalog.recipe_verified")).toBe("1");

      // A changed recipe is unverified again, so its quantities aren't used until someone checks it.
      const author = new CatalogV2Service(access(w, w.people.manager, MANAGE), {} as never);
      const changed = await author.setComponents(actor, w.workspaceId, w.catalogId, w.sofa, { version: verified.version, components: verified.components.map((component) => ({
        componentItemId: component.componentItemId, quantityFormula: component.quantityFormula, unitCode: component.unitCode,
        componentType: component.componentType ?? undefined, quantityBasis: component.quantityBasis ?? undefined, batchSize: component.batchSize, labourHours: component.labourHours })) });
      expect(changed.recipeVerified).toBeNull();
      expect((await core.technicalHandover(actor, w.workspaceId, projectId)).requirements.find((row) => row.title === "Sofa")!.state).toBe("needs_requirements");
      await catalog.verifyRecipe(actor, w.workspaceId, w.catalogId, w.sofa, { version: changed.version, verified: true });

      // The wardrobe: the factory records its requirements (pending), only the factory lead confirms them, and editing reopens them.
      await maker.command(actor, w.workspaceId, projectId, { action: "save_factory_requirement", lineId: wardrobe.id, version: await version(),
        items: [{ componentType: "board", name: "18mm MR MDF", quantity: "3", unit: "sheet" }, { componentType: "hardware", name: "Soft-close hinges", quantity: "8", unit: "pcs" }], labourHours: "12", notes: "Edge banding on site" });
      pack = await core.technicalHandover(actor, w.workspaceId, projectId);
      let record = pack.requirements.find((row) => row.title === "Wardrobe")!;
      expect(record.state).toBe("pending");
      expect(record.factory).toMatchObject({ status: "pending", labourHours: "12", notes: "Edge banding on site", items: [expect.objectContaining({ componentType: "board", quantity: "3" }), expect.objectContaining({ componentType: "hardware", quantity: "8" })] });
      await expect(techie.command(actor, w.workspaceId, projectId, { action: "confirm_factory_requirement", lineId: wardrobe.id, version: await version() })).rejects.toBeInstanceOf(ForbiddenException);
      await maker.command(actor, w.workspaceId, projectId, { action: "confirm_factory_requirement", lineId: wardrobe.id, requirementVersion: record.factory!.version, version: await version() });
      record = (await core.technicalHandover(actor, w.workspaceId, projectId)).requirements.find((row) => row.title === "Wardrobe")!;
      expect(record.state).toBe("confirmed");
      expect(record.factory).toMatchObject({ status: "confirmed", confirmedByName: "Faris Factory" });
      expect((await told(w, "project.factory_requirements_confirmed")).map((row) => row.recipient)).toEqual([w.people.manager]);
      // A stale version is refused; an edit after confirmation reopens the record and the factory lead hears.
      await expect(maker.command(actor, w.workspaceId, projectId, { action: "save_factory_requirement", lineId: wardrobe.id, version: await version(), requirementVersion: 1, items: [], labourHours: "10", notes: "" }))
        .rejects.toBeInstanceOf(ConflictException);
      await seller.command(actor, w.workspaceId, projectId, { action: "save_factory_requirement", lineId: wardrobe.id, version: await version(), requirementVersion: record.factory!.version,
        items: record.factory!.items.map(({ componentType, name, quantity, unit, note }) => ({ componentType, name, quantity, unit, note })), labourHours: "14", notes: "Edge banding on site" });
      record = (await core.technicalHandover(actor, w.workspaceId, projectId)).requirements.find((row) => row.title === "Wardrobe")!;
      expect(record.state).toBe("pending");
      expect((await told(w, "project.factory_requirements_reopened")).map((row) => row.recipient).sort()).toEqual([w.people.maker, w.people.manager].sort());
      await maker.command(actor, w.workspaceId, projectId, { action: "confirm_factory_requirement", lineId: wardrobe.id, requirementVersion: record.factory!.version, version: await version() });

      // PLM-174 on the route: the Production stage waits for the handover; the requirements and QS pass already.
      let detail = await core.get(actor, w.workspaceId, projectId);
      const production = () => detail.stages.find((stage) => stage.name === "Production")!.checks;
      expect(production().map((check) => [check.kind, check.passed])).toEqual([["technical_handover_accepted", false], ["factory_requirements_confirmed", true], ["qs_approved", true], ["everything_made", false]]);

      // Guide step 17: the material coordinator completed the material list (every detail and a sample photo) before technical starts.
      await w.client.query("SET LOCAL session_replication_role = replica");
      await w.client.query(`INSERT INTO project_material_items (id, workspace_id, project_id, position, name, code, supplier, quantity, unit, boq_line_ids, brand, colour, size, finish, sample_photo_asset_id)
        VALUES (gen_random_uuid(), $1, $2, 1, 'Oak veneer', 'OK-12', 'Board Co', 4, 'sheet', ARRAY[$3::uuid], 'Egger', 'Natural', '2800 x 2070', 'Matt', gen_random_uuid())`,
        [w.workspaceId, projectId, wardrobe.id]);
      await w.client.query("SET LOCAL session_replication_role = origin");
      // PLM-165: sales hands the pack over; the technical team hears (in the app and by email) and can't accept it while items are missing.
      await seller.command(actor, w.workspaceId, projectId, { action: "hand_over_technical", note: "Check the sofa arm height", version: await version() });
      pack = await core.technicalHandover(actor, w.workspaceId, projectId);
      expect(pack.status).toBe("handed_over");
      expect(pack.handedOver).toMatchObject({ byName: "Sara Seller", note: "Check the sofa arm height" });
      expect((await told(w, "project.technical_handover")).map((row) => [row.recipient, row.deepLink])).toEqual([[w.people.techie, `/workspace/projects/${projectId}/scope?view=technical`]]);
      expect((await told(w, "project.technical_handover", "email")).length).toBe(1);
      await expect(techie.command(actor, w.workspaceId, projectId, { action: "accept_technical_handover", handoverVersion: pack.version, version: await version() })).rejects.toThrow(/still missing/);
      await expect(seller.command(actor, w.workspaceId, projectId, { action: "accept_technical_handover", handoverVersion: pack.version, version: await version() })).rejects.toBeInstanceOf(ForbiddenException);

      // Each missing item is marked not applicable with a reason (who and when are kept); then the technical team accepts.
      for (const row of pack.rows) for (const item of row.missing)
        await techie.command(actor, w.workspaceId, projectId, { action: "waive_handover_item", lineId: row.lineId, item, reason: `Not needed for ${row.title}`, version: await version() });
      pack = await core.technicalHandover(actor, w.workspaceId, projectId);
      expect(pack.missing).toBe(0);
      expect(Object.values(pack.rows.find((row) => row.title === "Sofa")!.waivers).every((waiver) => waiver.byName === "Tara Technical")).toBe(true);
      await techie.command(actor, w.workspaceId, projectId, { action: "accept_technical_handover", handoverVersion: pack.version, version: await version() });
      pack = await core.technicalHandover(actor, w.workspaceId, projectId);
      expect(pack.status).toBe("accepted");
      expect(pack.accepted).toMatchObject({ byName: "Tara Technical" });
      expect((await told(w, "project.technical_handover_accepted")).map((row) => row.recipient).sort()).toEqual([w.people.manager, w.people.seller].sort());
      // Accepted is final for the hand-over; the route's check passes.
      await expect(seller.command(actor, w.workspaceId, projectId, { action: "hand_over_technical", note: "", version: await version() })).rejects.toBeInstanceOf(ConflictException);
      detail = await core.get(actor, w.workspaceId, projectId);
      expect(production().filter((check) => check.kind !== "everything_made").every((check) => check.passed)).toBe(true);
      for (const action of ["project.hand_over_technical", "project.accept_technical_handover", "project.waive_handover_item", "project.confirm_factory_requirement", "project.save_factory_requirement"])
        expect(Number(await audited(w, action))).toBeGreaterThan(0);
    });
  });

  it("holds a bespoke job's work order until the handover is accepted and its requirements are settled, where the firm asks; never on another job", async () => {
    await world(async (w) => {
      const { projectId, factory, wardrobe, sofa } = await started(w);
      const maker = factory(w.people.maker);
      const current = await maker.settings(actor, w.workspaceId);
      expect(current.settings).toMatchObject({ requireTechnicalHandover: false, requireFactoryRequirements: false, requireQs: false });
      await maker.saveSettings(actor, w.workspaceId, { version: current.settings.version, requireDrawing: false, requirePayment: false, requireMaterials: false,
        requireTechnicalHandover: true, requireFactoryRequirements: true, requireQs: true });
      const joinery = randomUUID();
      await maker.saveWorkcenter(actor, w.workspaceId, { id: joinery, name: "Joinery", hoursPerDay: "8" });
      const id = randomUUID();
      let order = await maker.plan(actor, w.workspaceId, { id, lineId: wardrobe.id, quantity: "1", workcenterId: joinery, plannedStart: w.today, plannedEnd: plus(w.today, 5) });
      const check = (key: string) => order.releaseChecks.find((entry) => entry.key === key);
      expect(check("technical_handover")).toMatchObject({ passed: false });
      expect(check("factory_requirements")).toMatchObject({ passed: false, missing: expect.stringContaining("no verified recipe") });
      expect(check("qs")).toMatchObject({ passed: true });
      expect(order.requirements).toEqual({ settled: false, state: "needs_requirements" });
      await expect(maker.command(actor, w.workspaceId, id, { action: "release", version: order.order.version })).rejects.toBeInstanceOf(ConflictException);

      // A verified recipe settles the sofa's line without a factory record.
      const catalog = new CatalogV2Service(access(w, w.people.maker, FACTORY), {} as never);
      const item = await catalog.getItem(actor, w.workspaceId, w.catalogId, w.sofa);
      await catalog.verifyRecipe(actor, w.workspaceId, w.catalogId, w.sofa, { version: item.version, verified: true });
      const sofaOrder = await maker.plan(actor, w.workspaceId, { id: randomUUID(), lineId: sofa.id, quantity: "2", workcenterId: joinery, plannedStart: w.today, plannedEnd: plus(w.today, 5) });
      expect(sofaOrder.releaseChecks.find((entry) => entry.key === "factory_requirements")).toMatchObject({ passed: true });
      expect(sofaOrder.requirements).toEqual({ settled: true, state: "verified" });

      // Off the bespoke path the three checks don't apply at all.
      await w.client.query("SET LOCAL session_replication_role = replica");
      await w.client.query(`UPDATE crm_opportunities SET furniture_path = NULL WHERE workspace_id = $1 AND id = $2`, [w.workspaceId, w.opportunityId]);
      await w.client.query("SET LOCAL session_replication_role = origin");
      order = await maker.order(actor, w.workspaceId, id);
      expect(order.releaseChecks.map((entry) => entry.key)).not.toEqual(expect.arrayContaining(["technical_handover", "factory_requirements", "qs"]));
      void projectId;
    });
  });
});
