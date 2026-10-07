import { randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ItemReadinessService } from "../catalog-core/item-readiness.service";
import { commercialRepository } from "../commercial/commercial-repository";
import { freezeHash } from "../commercial/commercial.domain";
import type { CommercialData } from "../commercial/commercial.types";
import { QuotationBuilderService } from "../quotation/quotation-builder.service";
import { ProjectCoreService } from "./project-core.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;
const MANAGE = ["projects.manage", "projects.view", "pre_projects.view", "workspace.settings.manage", "catalog.view", "catalog.manage"];

type World = { client: PoolClient; workspaceId: string; caseId: string; quoteId: string; manager: string; membership: string; sofa: string; catalogId: string };

/** Item readiness: a project's lines and a catalogue's items, each column worked out from the records, and the firm's settings. */
integration("item readiness (catalogue and project)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(run: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), caseId = randomUUID(), quoteId = randomUUID(), party = randomUUID(), opportunityId = randomUUID(), bedroom = randomUUID();
    const manager = randomUUID(), membership = randomUUID(), catalogId = randomUUID(), sofa = randomUUID(), materials = randomUUID(), hours = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Omar Manager')", [manager, `${manager.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','UTC',$3)", [workspaceId, `ir-${workspaceId.slice(0, 8)}`, manager]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, workspaceId, manager]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa 12','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunityId, workspaceId, party, randomUUID(), randomUUID(), membership]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [caseId, workspaceId, opportunityId, manager]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Bedroom')", [bedroom, workspaceId, caseId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [workspaceId, caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','AED')", [workspaceId, caseId, quoteId]);
      // The catalogue: a sofa imported from a product sheet (its size, and the sheet's materials and hours columns as attributes).
      await client.query("INSERT INTO catalogs(id,workspace_id,code,name,purpose) VALUES($1,$2,'furniture','Furniture','sell')", [catalogId, workspaceId]);
      await client.query("INSERT INTO catalog_attributes(id,workspace_id,catalog_id,code,label,value_type) VALUES($1,$2,$3,'materials_needed','Materials Needed','text'),($4,$2,$3,'hours_needed','Hours Needed','text')",
        [materials, workspaceId, catalogId, hours]);
      await client.query("INSERT INTO catalog_items(id,workspace_id,catalog_id,code,name,item_type,unit_code) VALUES($1,$2,$3,'SOFA-1','Sofa','product','pcs')", [sofa, workspaceId, catalogId]);
      await client.query("INSERT INTO catalog_item_values(workspace_id,item_id,attribute_id,value) VALUES($1,$2,$3,'Wood, fabric, foam'),($1,$2,$4,'Carpentry 12 hours')", [workspaceId, sofa, materials, hours]);
      await client.query("INSERT INTO catalog_item_dimensions(workspace_id,item_id,width,depth,height,unit,source,updated_by) VALUES($1,$2,220,95,80,'cm','import',$3)", [workspaceId, sofa, manager]);
      await client.query("SET LOCAL session_replication_role = origin");
      const run_ = (fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: manager });
      const builder = new QuotationBuilderService({ withPermission: (_a: unknown, _w: string, _p: unknown, fn: never) => run_(fn), withPermissions: (_a: unknown, _w: string, _p: unknown, fn: never) => run_(fn),
        withAnyPermission: (_a: unknown, _w: string, _p: unknown, fn: never) => run_(fn), hasPermission: async () => true } as never, {} as never);
      await builder.apply(actor, workspaceId, caseId, quoteId, { ops: [
        { op: "upsert", line: { id: "a", title: "Sofa", unit: "pcs", quantity: "1", rate: "4000", areaId: bedroom } },
        { op: "upsert", line: { id: "b", title: "Wardrobe", unit: "pcs", quantity: "2", rate: "3000", areaId: bedroom } },
      ] });
      await run({ client, workspaceId, caseId, quoteId, manager, membership, sofa, catalogId });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const access = (w: World, permissions: string[]) => {
    const run = async (_a: unknown, _w: string, code: string | string[], fn: (c: PoolClient, u: { userId: string }) => unknown) => {
      if (!(Array.isArray(code) ? code : [code]).some((item) => permissions.includes(item))) throw new ForbiddenException("Not allowed");
      await w.client.query("SAVEPOINT command");
      try { const result = await fn(w.client, { userId: w.manager }); await w.client.query("RELEASE SAVEPOINT command"); return result; }
      catch (error) { await w.client.query("ROLLBACK TO SAVEPOINT command"); throw error; }
    };
    return { asMember: (_a: unknown, _w: string, fn: never) => run(_a, _w, permissions, fn), withPermission: run, withAnyPermission: run, withPermissions: run,
      hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => permissions.includes(code) } as never;
  };

  /** The quote accepted and the project started; the sofa line is the catalogue's sofa, the wardrobe is bespoke with its size and material on the line. */
  async function started(w: World) {
    await w.client.query(`UPDATE commercial_quote_lines SET catalog_item_id = $3 WHERE workspace_id = $1 AND quote_id = $2 AND id = 'a'`, [w.workspaceId, w.quoteId, w.sofa]);
    await w.client.query(`UPDATE commercial_quote_lines SET width = 180, height = 240, dimension_unit = 'cm', material = 'MR MDF' WHERE workspace_id = $1 AND quote_id = $2 AND id = 'b'`, [w.workspaceId, w.quoteId]);
    const loaded = (await commercialRepository.load(w.client, w.workspaceId, w.caseId))!;
    const data = { ...(loaded.content as CommercialData), revision: loaded.revision };
    const quote = data.quotes.find((item) => item.id === w.quoteId)!;
    quote.status = "accepted";
    quote.hash = freezeHash(quote);
    quote.clientDecision = { decision: "accept", quoteHash: quote.hash, selectedOptionLineIds: [], baseTotal: 10000, optionsTotal: 0, acceptedTotal: 10000,
      decidedAt: "2026-09-20T10:00:00.000Z", decidedBy: "Maya Client", method: "signed_document", recordedBy: "Omar Manager" };
    data.agreement = { quoteId: w.quoteId, quoteHash: quote.hash, reference: "AG-7", terms: "", evidence: "signed.pdf", evidenceKind: "operational", status: "executed", executedAt: "2026-09-21T10:00:00.000Z", executedBy: "Omar Manager" };
    data.payments = [{ id: "p1", sourceQuoteId: w.quoteId, title: "Advance", amount: 10000, currency: "AED", dueDate: "", requiredForRelease: true, requiredForProduction: true, status: "verified",
      proof: "bank transfer", reference: "TT-1", evidenceKind: "operational" }] as CommercialData["payments"];
    data.revision = loaded.revision + 1;
    await commercialRepository.save(w.client, w.workspaceId, w.caseId, data);
    const core = new ProjectCoreService(access(w, MANAGE));
    const settings = await core.saveTemplate(actor, w.workspaceId, { name: "Joinery", isDefault: true, stages: [
      { name: "Technical drawings", ownerRole: "technical_designer", checks: [{ kind: "drawings_uploaded" }] },
      { name: "Handover", ownerRole: "project_manager", checks: [{ kind: "confirm", label: "Keys handed over" }] },
    ] });
    const templateId = settings.templates.find((template) => template.name === "Joinery")!.id;
    const { projectId } = await core.start(actor, w.workspaceId, w.caseId, { quoteId: w.quoteId, leadMembershipId: w.membership, templateId });
    // The wardrobe is made in the factory, the sofa bought ready-made.
    let detail = await core.get(actor, w.workspaceId, projectId);
    const scope = await core.scope(actor, w.workspaceId, projectId);
    for (const title of ["Sofa", "Wardrobe"]) {
      const lineId = scope.lines.find((line) => line.title === title)!.id;
      detail = await core.command(actor, w.workspaceId, projectId, { action: "save_package", name: title, supply: title === "Sofa" ? "ready_made" : "make", version: detail.project.version });
      const created = (await core.scope(actor, w.workspaceId, projectId)).packages.find((entry) => entry.name === title)!;
      detail = await core.command(actor, w.workspaceId, projectId, { action: "assign_lines", lineIds: [lineId], packageId: created.id, version: detail.project.version });
    }
    return { core, projectId };
  }

  it("works out each project line's readiness from the catalogue, the quotation line and the project's records", async () => {
    await world(async (w) => {
      const { core, projectId } = await started(w);
      const readiness = await core.readiness(actor, w.workspaceId, projectId);
      expect(readiness.columns).toEqual(["picture", "size", "drawing", "materials", "labour", "selection", "purchase", "production", "delivery"]);
      const sofa = readiness.rows.find((row) => row.title === "Sofa")!, wardrobe = readiness.rows.find((row) => row.title === "Wardrobe")!;
      expect(sofa).toMatchObject({ code: "SOFA-1", catalogItemId: w.sofa, catalogId: w.catalogId, areaName: "Bedroom", quantity: "1.0000" });
      expect(sofa.cells).toMatchObject({
        picture: { state: "missing" }, size: { state: "done" }, drawing: { state: "missing" },
        materials: { state: "done", note: "from_sheet", detail: "Wood, fabric, foam" }, labour: { state: "done", note: "from_sheet", detail: "Carpentry 12 hours" },
        production: { state: "not_needed" }, delivery: { state: "waiting", note: "not_installed" },
      });
      // Bought ready-made: on the project's list to buy until it is ordered.
      expect(sofa.cells.purchase).toEqual({ state: "missing", note: "required" });
      expect(wardrobe.cells).toMatchObject({
        picture: { state: "missing" }, size: { state: "done" }, drawing: { state: "missing" },
        materials: { state: "done", note: "from_quote", detail: "MR MDF" }, labour: { state: "missing" }, production: { state: "missing" }, purchase: { state: "not_needed" },
      });
      expect(wardrobe.missing).toBe(4);

      // The firm's settings: hide the picture and stop counting the sheet's hours as labour.
      const service = new ItemReadinessService(access(w, MANAGE));
      const current = await service.settings(actor, w.workspaceId);
      expect(current).toMatchObject({ saved: false, version: 0, materialAttributes: ["materials_needed"], labourAttributes: ["hours_needed"] });
      const requestId = randomUUID();
      const columns = ["size", "price", "drawing", "materials", "labour", "selection", "purchase", "production", "delivery"];
      const saved = await service.saveSettings(actor, w.workspaceId, { requestId, version: 0, columns, materialAttributes: ["materials_needed"], labourAttributes: [] });
      expect(saved).toMatchObject({ saved: true, version: 1, columns, labourAttributes: [] });
      // The same request again changes nothing; an old version is refused.
      expect(await service.saveSettings(actor, w.workspaceId, { requestId, version: 0, columns, materialAttributes: ["materials_needed"], labourAttributes: [] })).toMatchObject({ version: 1 });
      await expect(service.saveSettings(actor, w.workspaceId, { requestId: randomUUID(), version: 0, columns, materialAttributes: [], labourAttributes: [] })).rejects.toBeInstanceOf(ConflictException);
      expect((await w.client.query(`SELECT 1 FROM audit_events WHERE workspace_id = $1 AND action = 'catalog.readiness_settings_saved.v1'`, [w.workspaceId])).rowCount).toBe(1);

      const after = await core.readiness(actor, w.workspaceId, projectId);
      expect(after.columns).not.toContain("picture");
      expect(after.rows.find((row) => row.title === "Sofa")!.cells.labour.state).toBe("not_needed");

      // The catalogue's view of the same sofa.
      const catalog = await service.catalog(actor, w.workspaceId, w.catalogId, {});
      expect(catalog.columns).toEqual(["size", "price", "drawing", "materials", "labour"]);
      expect(catalog.rows).toEqual([expect.objectContaining({ id: w.sofa, code: "SOFA-1", missing: 2 })]);
      expect(catalog.rows[0].cells).toMatchObject({ picture: { state: "missing" }, size: { state: "done" }, price: { state: "missing" }, materials: { note: "from_sheet" } });
      expect(catalog.canManage).toBe(true);

      // Changing the settings takes catalog.manage.
      const viewer = new ItemReadinessService(access(w, ["catalog.view"]));
      await expect(viewer.saveSettings(actor, w.workspaceId, { requestId: randomUUID(), version: 1, columns })).rejects.toBeInstanceOf(ForbiddenException);
      expect((await viewer.catalog(actor, w.workspaceId, w.catalogId, { search: "sofa" })).canManage).toBe(false);
    });
  });

  it("keeps the settings to the workspace: forced row-level security with the tenant policy", async () => {
    const client = await pool.connect();
    try {
      const table = (await client.query<{ forced: boolean; enabled: boolean }>(`SELECT relforcerowsecurity AS forced, relrowsecurity AS enabled FROM pg_class WHERE relname = 'workspace_readiness_settings'`)).rows[0];
      expect(table).toEqual({ forced: true, enabled: true });
      expect((await client.query(`SELECT 1 FROM pg_policies WHERE tablename = 'workspace_readiness_settings' AND policyname = 'tenant_isolation'`)).rowCount).toBe(1);
    } finally { client.release(); }
  });
});
