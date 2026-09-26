import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commercialRepository } from "../commercial/commercial-repository";
import { totals } from "../commercial/commercial.domain";
import { QuotationBuilderService } from "./quotation-builder.service";
import { copyBuilderData } from "./quote-revision";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
type Ids = { workspaceId: string; caseId: string; quoteId: string; kitchen: string; living: string; plywood: string; wardrobe: string; fitting: string; photo: string };
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

integration("quotation builder (plan §6.8)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function withQuote(work: (client: PoolClient, ids: Ids, service: QuotationBuilderService) => Promise<void>, permissions: { costs?: boolean } = {}) {
    const client = await pool.connect();
    const ids: Ids = { workspaceId: randomUUID(), caseId: randomUUID(), quoteId: randomUUID(), kitchen: randomUUID(), living: randomUUID(), plywood: randomUUID(), wardrobe: randomUUID(), fitting: randomUUID(), photo: randomUUID() };
    const user = randomUUID(), membership = randomUUID(), party = randomUUID(), opportunity = randomUUID(), catalog = randomUUID(), book = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Sam Estimator')", [user, `${user.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [ids.workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [ids.workspaceId, `qb-${ids.workspaceId.slice(0, 8)}`, user]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [membership, ids.workspaceId, user]);
      await client.query("INSERT INTO crm_parties(id,workspace_id,type,display_name,normalized_name) VALUES($1,$2,'person','Maya Client','maya client')", [party, ids.workspaceId]);
      await client.query(`INSERT INTO crm_opportunities(id,workspace_id,party_id,pipeline_id,stage_id,owner_membership_id,title,reference,conversion_origin,conversion_request_hash,qualification_evidence,qualification_evidence_hash,converted_at)
        VALUES($1,$2,$3,$4,$5,$6,'Villa','O-1','lead_qualification',repeat('a',64),'{}',repeat('b',64),now())`, [opportunity, ids.workspaceId, party, randomUUID(), randomUUID(), membership]);
      await client.query("INSERT INTO pre_project_cases(id,workspace_id,opportunity_id,created_by) VALUES($1,$2,$3,$4)", [ids.caseId, ids.workspaceId, opportunity, user]);
      await client.query("INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$3,$4,'Kitchen'),($2,$3,$4,'Living room')", [ids.kitchen, ids.living, ids.workspaceId, ids.caseId]);
      await client.query("INSERT INTO commercial_cases(workspace_id,case_id,revision,content) VALUES($1,$2,1,'{}')", [ids.workspaceId, ids.caseId]);
      await client.query("INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,status,title,currency) VALUES($1,$2,$3,0,1,'quotation','main','draft','Main quote','AED')", [ids.workspaceId, ids.caseId, ids.quoteId]);
      // A small catalog: plywood per sqm, fitting labour per hour, and a wardrobe made of both.
      await client.query("INSERT INTO catalogs(id,workspace_id,code,name) VALUES($1,$2,'core','Core')", [catalog, ids.workspaceId]);
      await client.query("INSERT INTO catalog_units(workspace_id,code,label,kind,to_base) VALUES($1,'sqm','m²','area',1),($1,'nos','Each','count',1),($1,'hr','Hour','time',1)", [ids.workspaceId]);
      await client.query(`INSERT INTO catalog_items(id,workspace_id,catalog_id,code,name,item_type,unit_code,description,waste_percent) VALUES
        ($1,$4,$5,'PLY18','Plywood 18 mm','material','sqm','Moisture-resistant',10),($2,$4,$5,'WRD','Wardrobe','assembly','nos','Floor-to-ceiling, hinged',NULL),($3,$4,$5,'FIT','Fitting','service','hr','',NULL)`,
        [ids.plywood, ids.wardrobe, ids.fitting, ids.workspaceId, catalog]);
      await client.query("INSERT INTO catalog_components(workspace_id,parent_item_id,component_item_id,quantity_formula,unit_code,sort_order) VALUES($1,$2,$3,'width * height * 2','sqm',0),($1,$2,$4,'4','hr',1)", [ids.workspaceId, ids.wardrobe, ids.plywood, ids.fitting]);
      await client.query("INSERT INTO price_books(id,workspace_id,catalog_id,name,currency,status) VALUES($1,$2,$3,'Retail','AED','active')", [book, ids.workspaceId, catalog]);
      await client.query(`INSERT INTO price_entries(workspace_id,price_book_id,item_id,method,price,rate,cost,markup_percent,margin_percent,status) VALUES
        ($1,$2,$3,'cost_plus',NULL,NULL,50,40,NULL,'active'),($1,$2,$4,'per_measure',NULL,60,NULL,NULL,NULL,'active'),($1,$2,$5,'assembly_rollup',NULL,NULL,NULL,NULL,20,'active')`,
        [ids.workspaceId, book, ids.plywood, ids.fitting, ids.wardrobe]);
      await client.query("SET LOCAL session_replication_role = origin");
      const run = (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId: user });
      const files = new Map<string, Buffer>();
      const storage = { put: async (key: string, body: Buffer) => { files.set(key, body); }, read: async (key: string) => ({ body: files.get(key)! }) };
      files.set("case/photo/original", Buffer.from("png-bytes"));
      await client.query(`INSERT INTO pre_project_brief_assets(id,workspace_id,case_id,original_name,mime_type,byte_size,object_key,preview_key,sha256,created_by) VALUES($1,$2,$3,'tv.png','image/png',9,'case/photo/original',NULL,repeat('c',64),$4)`, [ids.photo, ids.workspaceId, ids.caseId, user]);
      const service = new QuotationBuilderService({ withPermission: run, withPermissions: run, withAnyPermission: run, hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => code.startsWith("commercial.costs") ? permissions.costs !== false : true } as never, storage as never);
      await work(client, ids, service);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("fills a line from the catalog, works out quantity from a formula and prices the build-up", async () => {
    await withQuote(async (client, ids, service) => {
      const hits = await service.search(actor, ids.workspaceId, ids.caseId, ids.quoteId, "ply");
      expect(hits.items).toEqual([expect.objectContaining({ name: "Plywood 18 mm", unitCode: "sqm", rate: "70.00" })]);

      let state = await service.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId, { ops: [
        { op: "catalog", itemId: ids.plywood, line: { id: "l1", areaId: ids.kitchen, formula: "area * 1.05", length: "4", width: "0.6" } },
        { op: "catalog", itemId: ids.wardrobe, line: { id: "l2", areaId: ids.living, width: "1.2", height: "2.4", quantity: "2" } },
      ] });
      const ply = state.lines.find((line) => line.id === "l1")!;
      expect(ply).toMatchObject({ title: "Plywood 18 mm", unit: "sqm", quantity: "2.52", rate: "70", unitCost: "50", formulaError: null });
      const wardrobe = state.lines.find((line) => line.id === "l2")!;
      // per wardrobe: plywood 1.2 × 2.4 × 2 = 5.76 + 10 % waste = 6.336 × 70 = 443.52; fitting 4 × 60 = 240; ×1.2 margin on sells without a rate? rates exist, so margin applies only to cost-based rows
      expect(wardrobe.pricingMode).toBe("build_up");
      expect(wardrobe.components.map((part) => part.name)).toEqual(["Plywood 18 mm", "Fitting"]);
      expect(wardrobe.rate).toBe("683.52");
      expect(state.pricing.subtotal).toBe(String((2.52 * 70 + 2 * 683.52).toFixed(2)));
      expect(state.pricing.areas.map((area) => area.key).sort()).toEqual([ids.kitchen, ids.living].sort());

      // The existing flows price the stored quote exactly as the builder does.
      const stored = (await commercialRepository.load(client, ids.workspaceId, ids.caseId))!.content.quotes![0];
      expect(totals(stored).total).toBe(Number(state.pricing.total));
      expect((await client.query("SELECT revision FROM commercial_cases WHERE case_id = $1", [ids.caseId])).rows[0].revision).toBeGreaterThan(1);

      state = await service.setDiscount(actor, ids.workspaceId, ids.caseId, ids.quoteId, { scope: "area", target: ids.living, kind: "percent", value: "10" });
      expect(state.pricing.discounts.section).toBe("136.70");
      state = await service.setQuoteTax(actor, ids.workspaceId, ids.caseId, ids.quoteId, { taxRate: "5" });
      expect(state.pricing.tax).toBe(((Number(state.pricing.net)) * 0.05).toFixed(2));
    });
  });

  it("refuses a stale edit with the current line, accepts a replay, and keeps build-ups through a case save", async () => {
    await withQuote(async (client, ids, service) => {
      let state = await service.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId, { ops: [{ op: "upsert", line: { id: "a", title: "Demolish wall", kind: "dismantle", unit: "m²", quantity: "6", rate: "45" } }] });
      const line = state.lines[0];
      state = await service.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId, { ops: [{ op: "upsert", line: { id: "a", version: line.version, rate: "50" } }] });
      // The same request again (e.g. a retry after a dropped connection) is accepted as done.
      state = await service.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId, { ops: [{ op: "upsert", line: { id: "a", version: line.version, rate: "50" } }] });
      expect(state.lines[0]).toMatchObject({ rate: "50", version: 2 });
      // Someone else's stale edit is refused.
      await expect(service.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId, { ops: [{ op: "upsert", line: { id: "a", version: 1, rate: "40" } }] })).rejects.toThrow(/just changed/);

      await service.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId, { ops: [{ op: "catalog", itemId: ids.wardrobe, line: { id: "w", width: "1", height: "2" } }] });
      const loaded = (await commercialRepository.load(client, ids.workspaceId, ids.caseId))!;
      await commercialRepository.save(client, ids.workspaceId, ids.caseId, { ...loaded.content, revision: loaded.revision + 1 } as never);
      const parts = (await client.query("SELECT count(*)::int AS count FROM commercial_quote_line_components WHERE case_id = $1 AND line_id = 'w'", [ids.caseId])).rows[0].count;
      expect(parts).toBe(2);
    });
  });

  it("validates moves, formulas and client-supplied items, and hides costs without permission", async () => {
    await withQuote(async (_client, ids, service) => {
      await expect(service.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId, { ops: [{ op: "upsert", line: { id: "m", title: "Move TV unit", kind: "relocate", areaId: ids.living } }] })).rejects.toThrow(/moves from/);
      await expect(service.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId, { ops: [{ op: "upsert", line: { id: "f", title: "Tiles", formula: "depth * 2" } }] })).rejects.toThrow(/Unknown value: depth/);
      const state = await service.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId, { ops: [
        { op: "upsert", line: { id: "m", title: "Move TV unit", kind: "relocate", fromAreaId: ids.kitchen, areaId: ids.living, unit: "job", rate: "300" } },
        { op: "upsert", line: { id: "c", title: "Client's chandelier", kind: "client_supplied", rate: "999", unitCost: "10" } },
      ] });
      expect(state.lines.find((line) => line.id === "c")!.rate).toBe("0");
      expect(state.pricing.total).toBe("300.00");
    }, {});
    await withQuote(async (_client, ids, service) => {
      const state = await service.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId, { ops: [{ op: "upsert", line: { id: "x", title: "Panel", rate: "100", unitCost: "60" } }] });
      expect(state.canViewCosts).toBe(false);
      expect(state.lines[0].unitCost).toBeNull();
      expect(state.pricing.margin).toBeNull();
    }, { costs: false });
  });

  it("won't edit a sent quote", async () => {
    await withQuote(async (client, ids, service) => {
      await client.query("UPDATE commercial_quotes SET status = 'issued' WHERE id = $1", [ids.quoteId]);
      await expect(service.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId, { ops: [{ op: "upsert", line: { id: "a", title: "X" } }] })).rejects.toThrow(/new revision/);
    });
  });

  it("keeps payment milestones that total 100 % and carries build-ups and discounts into a new revision", async () => {
    await withQuote(async (client, ids, service) => {
      await expect(service.setPaymentTerms(actor, ids.workspaceId, ids.caseId, ids.quoteId, { terms: [{ id: "a", title: "Advance", percent: 40, trigger: "On acceptance", requiredForRelease: true }] })).rejects.toThrow(/100%/);
      const state = await service.setPaymentTerms(actor, ids.workspaceId, ids.caseId, ids.quoteId, { terms: [
        { id: "a", title: "Advance", percent: 40, trigger: "On acceptance", requiredForRelease: true },
        { id: "b", title: "Before carpentry", percent: 60, trigger: "Joinery starts", requiredForRelease: false },
      ] });
      expect(state.quote.paymentTerms).toHaveLength(2);
      expect(state.flow).toMatchObject({ internalReview: true, reviewAction: "approve" });
      expect(state.family.map((item) => item.number)).toEqual([1]);

      await service.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId, { ops: [{ op: "catalog", itemId: ids.wardrobe, line: { id: "w", width: "1", height: "2" } }] });
      await service.setDiscount(actor, ids.workspaceId, ids.caseId, ids.quoteId, { scope: "quote", target: "", kind: "percent", value: "5" });
      const next = randomUUID();
      await client.query(`INSERT INTO commercial_quotes(workspace_id,case_id,id,sort_order,number,kind,round,family_id,status,title,currency) VALUES($1,$2,$3,1,2,'quotation','main',$4,'draft','Main quote','AED')`, [ids.workspaceId, ids.caseId, next, ids.quoteId]);
      await client.query(`INSERT INTO commercial_quote_lines(workspace_id,case_id,quote_id,id,sort_order,title,quantity,unit,unit_cost,rate,pricing_mode,width,height) SELECT workspace_id,case_id,$3,id,sort_order,title,quantity,unit,unit_cost,rate,pricing_mode,width,height FROM commercial_quote_lines WHERE case_id=$1 AND quote_id=$2`, [ids.caseId, ids.quoteId, next]);
      await copyBuilderData(client, ids.workspaceId, ids.caseId, ids.quoteId, next);
      const revised = await service.builder(actor, ids.workspaceId, ids.caseId, next);
      expect(revised.lines[0].components).toHaveLength(2);
      expect(revised.discounts).toEqual([expect.objectContaining({ scope: "quote", kind: "percent", value: "5" })]);
      expect(revised.family.map((item) => item.number)).toEqual([1, 2]);
    });
  });

  it("saves an area as a template and lists it ready to insert", async () => {
    await withQuote(async (_client, ids, service) => {
      await service.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId, { ops: [
        { op: "catalog", itemId: ids.wardrobe, line: { id: "w", areaId: ids.kitchen, width: "1", height: "2" } },
        { op: "upsert", line: { id: "p", title: "Paint walls", unit: "sqm", formula: "wall", length: "4", height: "2.7", rate: "18", areaId: ids.kitchen } },
        { op: "upsert", line: { id: "x", title: "Elsewhere", rate: "1", areaId: ids.living } },
      ] });
      const id = randomUUID();
      await service.saveTemplate(actor, ids.workspaceId, ids.caseId, ids.quoteId, { id, name: "Kitchen basics", scope: "area", target: ids.kitchen });
      await expect(service.saveTemplate(actor, ids.workspaceId, ids.caseId, ids.quoteId, { id: randomUUID(), name: "Kitchen basics", scope: "area", target: ids.kitchen })).rejects.toThrow(/already exists/);
      const { templates } = await service.templates(actor, ids.workspaceId);
      const saved = templates.find((template) => template.id === id)!;
      expect(saved.lines.map((line) => line.title)).toEqual(["Wardrobe", "Paint walls"]);
      expect(saved.lines[0]).toMatchObject({ catalogItemId: ids.wardrobe, pricingMode: "build_up", width: "1", height: "2" });
      expect(saved.lines[0].components).toHaveLength(2);
      expect(saved.lines[1]).toMatchObject({ formula: "wall", length: "4", height: "2.7", rate: "18" });
    });
  });

  it("gives a line a picture and adds a custom line to the catalog, picture and price included", async () => {
    await withQuote(async (client, ids, service) => {
      let state = await service.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId, { ops: [{ op: "upsert", line: { id: "tv", title: "Walnut TV unit", unit: "Nos", rate: "6400", unitCost: "4000", imageAssetId: ids.photo, areaId: ids.living } }] });
      expect(state.lines[0].imageAssetId).toBe(ids.photo);
      await expect(service.apply(actor, ids.workspaceId, ids.caseId, ids.quoteId, { ops: [{ op: "upsert", line: { id: "x", title: "X", imageAssetId: randomUUID() } }] })).rejects.toThrow(/Upload the picture/);
      state = await service.addToCatalog(actor, ids.workspaceId, ids.caseId, ids.quoteId, "tv", { version: state.lines[0].version });
      const line = state.lines.find((item) => item.id === "tv")!;
      expect(line.catalogItemId).toBeTruthy();
      expect(line.catalogImageId).toBeTruthy();
      const item = (await client.query(`SELECT item.code, item.name, item.unit_code, entry.price::text AS price FROM catalog_items item JOIN price_entries entry ON entry.item_id = item.id WHERE item.id = $1`, [line.catalogItemId])).rows[0];
      expect(item).toMatchObject({ code: "WALNUT-TV-UNIT", name: "Walnut TV unit", unit_code: "nos" });
      expect(Number(item.price)).toBe(6400);
      // Next time it's in the catalog, with its picture.
      const hits = await service.search(actor, ids.workspaceId, ids.caseId, ids.quoteId, "walnut");
      expect(hits.items[0]).toMatchObject({ name: "Walnut TV unit", rate: "6400.000000", imageId: line.catalogImageId });
      // Doing it again changes nothing.
      const again = await service.addToCatalog(actor, ids.workspaceId, ids.caseId, ids.quoteId, "tv", { version: line.version });
      expect(again.lines.find((item) => item.id === "tv")!.catalogItemId).toBe(line.catalogItemId);
    });
  });
});
