import { ForbiddenException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CatalogV2Service } from "../catalog-core/catalog-v2.service";
import { InventoryService } from "../inventory/inventory.service";
import { SuppliersService } from "../purchasing/suppliers.service";
import { toolContext } from "./ai-tool-context";
import { AiToolRegistry } from "./ai-tools.registry";
import { validateToolInput } from "./tool-kit";
import type { ToolServices } from "./tool-services";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back. Fixtures are
// seeded through the modules' own services as the app role (wodana_app), and Woddy's tools read through them.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

const EVERYTHING = ["ai.suggestions.use", "catalog.view", "catalog.manage", "commercial.estimate", "stock.view", "stock.manage", "stock.adjust", "vendors.view", "vendors.manage"];
const actor = { subject: "s", email: "e", displayName: "d", provider: "local" };

integration("Woddy's product, stock and supplier tools on PostgreSQL", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  type World = {
    client: PoolClient; a: string; b: string; author: string; qs: string; warehouse: string; entity: string;
    /** The services as one person (their permissions), in the tenant transaction of `tenantOf ?? the workspace asked for`. */
    services: (userId: string, granted: string[], tenantOf?: string) => ToolServices;
    /** One of Woddy's tools, run as that person in a workspace. */
    tool: (name: string, workspaceId: string, granted: string[], args: Record<string, unknown>, tenantOf?: string) => Promise<{ data: Record<string, unknown>; sources: Array<{ key: string; type: string; id: string; href?: string | null }> }>;
  };

  async function world(work: (w: World) => Promise<void>) {
    const client = await pool.connect();
    const ids = { a: randomUUID(), b: randomUUID(), author: randomUUID(), qs: randomUUID(), warehouse: randomUUID(), warehouseB: randomUUID(), entity: randomUUID() };
    const tenant = (workspaceId: string, userId: string) => client.query("SELECT set_config('app.current_workspace_id',$1,true), set_config('app.current_actor_id',$2,true)", [workspaceId, userId]);
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica"); // fixtures only: skip provisioning triggers
      for (const [id, name] of [[ids.author, "Ada Author"], [ids.qs, "Quinn QS"]]) {
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `woddy-products-${id.slice(0, 8)}@example.com`, name]);
      }
      for (const [workspaceId, name] of [[ids.a, "Studio A"], [ids.b, "Studio B"]]) {
        await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,$2,$3,'USD',$4)", [workspaceId, name, `woddy-products-${workspaceId.slice(0, 8)}`, ids.author]);
        await client.query("INSERT INTO workspace_memberships (workspace_id, user_id, status) VALUES ($1, $2, 'active')", [workspaceId, ids.author]);
      }
      await client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone)
        VALUES($1,$2,'STA','Studio A Interiors','Studio A Interiors LLC','US','USD','en-US','UTC')`, [ids.entity, ids.a]);
      await client.query("INSERT INTO stock_locations(id,workspace_id,kind,name,is_default) VALUES($1,$2,'warehouse','Main warehouse',true),($3,$4,'warehouse','B warehouse',true)",
        [ids.warehouse, ids.a, ids.warehouseB, ids.b]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("SET LOCAL ROLE wodana_app");
      await tenant(ids.a, ids.author);

      const access = (userId: string, granted: string[], tenantOf?: string) => {
        const has = (code: string) => granted.includes(code);
        const open = async <T>(workspaceId: string, fn: (c: PoolClient, u: { userId: string }) => Promise<T>) => { await tenant(tenantOf ?? workspaceId, userId); return fn(client, { userId }); };
        return {
          asMember: (_a: unknown, workspaceId: string, fn: (c: PoolClient, u: { userId: string }) => Promise<unknown>) => open(workspaceId, fn),
          withPermission: async (_a: unknown, workspaceId: string, code: string, fn: (c: PoolClient, u: { userId: string }) => Promise<unknown>) => {
            if (!has(code)) throw new ForbiddenException(`Permissions required: ${code}`);
            return open(workspaceId, fn);
          },
          withAnyPermission: async (_a: unknown, workspaceId: string, codes: string[], fn: (c: PoolClient, u: { userId: string }) => Promise<unknown>) => {
            if (!codes.some(has)) throw new ForbiddenException(`Any permission required: ${codes.join(", ")}`);
            return open(workspaceId, fn);
          },
          hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => has(code),
        };
      };
      const services = (userId: string, granted: string[], tenantOf?: string) => {
        const as = access(userId, granted, tenantOf) as never;
        return { access: as, catalog: new CatalogV2Service(as, {} as never), inventory: new InventoryService(as), suppliers: new SuppliersService(as) } as unknown as ToolServices;
      };
      const tool: World["tool"] = async (name, workspaceId, granted, args, tenantOf) => {
        const registry = AiToolRegistry.catalogue(services(ids.author, granted, tenantOf));
        const offered = registry.offered(new Set(granted));
        const definition = offered.find((item) => item.name === name);
        if (!definition) throw new Error(`There is no tool called ${name} for this person.`);
        const { context, sources } = toolContext({ actor, workspaceId, runId: randomUUID(), asker: { userId: ids.author, membershipId: "m", permissions: new Set(granted), timeZone: "UTC", locale: "en" } });
        const { data } = await definition.run!(context, validateToolInput(definition.parameters, args));
        return { data: data as Record<string, unknown>, sources };
      };
      await work({ client, ...ids, services, tool });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  /** Studio A's catalogue, stock and suppliers, made through the modules' own commands. */
  async function seed(w: World) {
    const author = w.services(w.author, EVERYTHING), qs = w.services(w.qs, EVERYTHING);
    const supplierId = randomUUID();
    await author.suppliers.save(actor, w.a, { id: supplierId, name: "Stone Co", categories: ["Marble", "Granite"], paymentTerms: "credit", creditDays: 30, contactName: "Rami Stone",
      phone: "+1 555 0100 999", email: "sales@stone.example", notes: "Italian marble slabs, cutting and polishing", entityIds: [w.entity] });
    await author.suppliers.save(actor, w.a, { id: randomUUID(), name: "Loom & Thread", categories: ["Upholstery"], paymentTerms: "upfront" });
    await w.client.query("INSERT INTO supplier_attributes (workspace_id, vendor_id, name, value) VALUES ($1, $2, 'Approval status', 'Nominated for marble'), ($1, $2, 'Second number', '+1 555 0100 777')",
      [w.a, supplierId]);

    const catalog = author.catalog;
    const { id: catalogId } = await catalog.createCatalog(actor, w.a, { name: "Core collection" });
    const { id: sofas } = await catalog.createCategory(actor, w.a, catalogId, { name: "Sofas" });
    const { id: tables } = await catalog.createCategory(actor, w.a, catalogId, { name: "Dining tables" });
    await catalog.createAttribute(actor, w.a, catalogId, { label: "Fabric", valueType: "text" });
    await catalog.createAttribute(actor, w.a, catalogId, { label: "Website link", valueType: "text" });
    const harriet = await catalog.createItem(actor, w.a, catalogId, { code: "HAR-3", name: "Harriet 3 seater", description: "Sofa", itemType: "product", unitCode: "pcs", categoryId: sofas,
      technicalDrawingUrl: "https://drive.example.com/harriet.pdf", values: { fabric: "Boucle ivory", website_link: "https://shop.example.com/harriet" } });
    const lyla = await catalog.createItem(actor, w.a, catalogId, { code: "LYL-6", name: "Lyla dining table", itemType: "product", unitCode: "pcs", categoryId: tables });
    await w.client.query("INSERT INTO catalog_item_dimensions (workspace_id, item_id, width, depth, height, unit, source, updated_by) VALUES ($1, $2, 220, 95, 80, 'cm', 'import', $3)", [w.a, harriet.id, w.author]);
    await w.client.query("INSERT INTO catalog_supplier_links (workspace_id, item_id, vendor_id, cost, currency, preferred) VALUES ($1, $2, $3, 2100, 'USD', true)", [w.a, harriet.id, supplierId]);
    const { id: bookId } = await catalog.createPriceBook(actor, w.a, catalogId, { name: "Retail", currency: "USD" });
    await catalog.setPriceBookStatus(actor, w.a, bookId, { version: 1, status: "active" });
    const harrietPrice = await catalog.savePrice(actor, w.a, bookId, harriet.id, { method: "fixed", price: "4200" });
    await qs.catalog.reviewPrice(actor, w.a, harrietPrice.id, { version: 1, decision: "reviewed" });
    await catalog.reviewPrice(actor, w.a, harrietPrice.id, { version: 2, decision: "active" });
    // Lyla's price is only a draft (as an imported price is until it's reviewed).
    await catalog.savePrice(actor, w.a, bookId, lyla.id, { method: "fixed", price: "3100" });

    const inventory = author.inventory;
    await inventory.command(actor, w.a, { id: randomUUID(), action: "add", locationId: w.warehouse, name: "Carrara marble slab", unit: "sqm", quantity: "40", reason: "Opening stock" });
    await inventory.command(actor, w.a, { id: randomUUID(), action: "add", locationId: w.warehouse, catalogItemId: harriet.id, name: "Harriet 3 seater", unit: "pcs", quantity: "2", reason: "Showroom stock" });
    const marble = (await w.client.query<{ id: string }>(`SELECT id FROM stock_items WHERE workspace_id = $1 AND name = 'Carrara marble slab'`, [w.a])).rows[0].id;
    await inventory.setReorderPoint(actor, w.a, { id: randomUUID(), itemId: marble, reorderAt: "20" });
    // A deal holds 12 of it (a quotation line's soft hold); the deal itself is outside this test.
    await w.client.query("RESET ROLE");
    await w.client.query("SET LOCAL session_replication_role = replica");
    await w.client.query(`INSERT INTO stock_reservations (id, workspace_id, source, source_key, opportunity_id, item_id, location_id, quantity) VALUES ($1, $2, 'quote_line', 'line-1', $3, $4, $5, 12)`,
      [randomUUID(), w.a, randomUUID(), marble, w.warehouse]);
    await w.client.query("SET LOCAL session_replication_role = origin");
    await w.client.query("SET LOCAL ROLE wodana_app");
    return { harriet, lyla, marble, supplierId };
  }

  it("finds a product by its words and gives the live price, size and drawing; a draft price is price on request; cost only with the cost permission", async () => {
    await world(async (w) => {
      const { harriet } = await seed(w);
      const reader = ["ai.suggestions.use", "catalog.view"];
      const { data, sources } = await w.tool("search_catalog", w.a, reader, { text: "Harriet sofa" });
      expect(data.items).toEqual([expect.objectContaining({
        source: "S1", name: "Harriet 3 seater", code: "HAR-3", category: "Sofas", kind: "product", sellingPrice: { amount: "4200.00", currency: "USD", per: "pcs" },
        size: "W 220 × D 95 × H 80 cm", technicalDrawing: "https://drive.example.com/harriet.pdf", websiteLink: "https://shop.example.com/harriet", attributes: [{ Fabric: "Boucle ivory" }],
      })]);
      expect(JSON.stringify(data)).not.toContain("2100");
      expect(sources).toEqual([{ key: "S1", type: "catalog_item", id: harriet.id, label: "Harriet 3 seater", href: "/workspace/catalogs" }]);

      const table = await w.tool("search_catalog", w.a, reader, { text: "lyla" });
      expect(table.data.items).toEqual([expect.objectContaining({ name: "Lyla dining table", sellingPrice: null, priceNote: expect.stringMatching(/^Price on request: .*draft/) })]);
      expect(JSON.stringify(table.data)).not.toContain("3100");
      // By category words too.
      expect((await w.tool("search_catalog", w.a, reader, { text: "dining tables" })).data.count).toBe(1);

      const costed = await w.tool("search_catalog", w.a, [...reader, "commercial.costs.view"], { text: "Harriet" });
      expect((costed.data.items as unknown[])[0]).toMatchObject({ cost: { amount: "2100.00", currency: "USD", supplier: "Stone Co" } });
    });
  });

  it("gives stock on hand, held and free per place, and the low flag after a movement takes it to its reorder point", async () => {
    await world(async (w) => {
      const { marble } = await seed(w);
      const reader = ["ai.suggestions.use", "stock.view"];
      const before = await w.tool("check_stock", w.a, reader, { text: "carrara marble" });
      expect(before.data.items).toEqual([{
        source: "S1", name: "Carrara marble slab", code: null, unit: "sqm", onHand: "40", held: "12", free: "28",
        places: [{ place: "Main warehouse", onHand: "40", held: "12", free: "28", forProjects: "0" }],
        lowStock: false, reorderPoints: [{ place: null, reorderAt: "20", onOrder: "0", low: false, short: false }],
      }]);
      expect(before.sources[0]).toMatchObject({ type: "stock_item", id: marble, href: `/workspace/inventory?item=${marble}` });
      // A count takes it to 30 on hand: 18 free, below the reorder point of 20.
      await w.services(w.author, EVERYTHING).inventory.command(actor, w.a, { id: randomUUID(), action: "count", locationId: w.warehouse, itemId: marble, counted: "30", reason: "Monthly count" });
      const after = await w.tool("check_stock", w.a, reader, { text: "marble" });
      expect(after.data.items).toEqual([expect.objectContaining({ onHand: "30", held: "12", free: "18", lowStock: true })]);
      // A catalogue product's stock is found by its name; one without a reorder point says so.
      const sofa = await w.tool("check_stock", w.a, reader, { text: "Harriet" });
      expect(sofa.data.items).toEqual([expect.objectContaining({ name: "Harriet 3 seater", code: "HAR-3", onHand: "2", free: "2", lowStock: null, reorderNote: "No reorder level set" })]);
    });
  });

  it("finds suppliers by what they supply, with terms, approval and company, and keeps their phone and email out", async () => {
    await world(async (w) => {
      const { supplierId } = await seed(w);
      const { data, sources } = await w.tool("search_suppliers", w.a, ["ai.suggestions.use", "vendors.view"], { text: "marble" });
      expect(data.suppliers).toEqual([expect.objectContaining({
        source: "S1", name: "Stone Co", supplies: ["Marble", "Granite"], approval: "Not reviewed yet", paymentTerms: "On credit, 30 days", contactPerson: "Rami Stone",
        hasPhone: true, hasEmail: true, companies: ["Studio A Interiors"], attributes: [{ "Approval status": "Nominated for marble" }],
      })]);
      for (const secret of ["0100 999", "sales@stone.example", "0100 777"]) expect(JSON.stringify(data)).not.toContain(secret);
      expect(sources[0]).toMatchObject({ type: "supplier", id: supplierId, href: `/workspace/purchasing/suppliers?supplier=${supplierId}` });
      // By words from the notes, and by type.
      expect((await w.tool("search_suppliers", w.a, ["vendors.view"], { text: "polishing" })).data.count).toBe(1);
      expect((await w.tool("search_suppliers", w.a, ["vendors.view"], { text: "upholstery" })).data.suppliers).toEqual([expect.objectContaining({ name: "Loom & Thread", hasPhone: false })]);
    });
  });

  it("offers nothing to a member without the module, and the module itself refuses one who calls anyway", async () => {
    await world(async (w) => {
      await seed(w);
      for (const name of ["search_catalog", "check_stock", "search_suppliers"]) {
        await expect(w.tool(name, w.a, ["ai.suggestions.use", "crm.leads.view"], { text: "marble" })).rejects.toThrow(`There is no tool called ${name}`);
      }
      const services = w.services(w.author, ["ai.suggestions.use"]);
      await expect(services.catalog.findItems(actor, w.a, { search: "Harriet" })).rejects.toThrow(ForbiddenException);
      await expect(services.inventory.lookup(actor, w.a, { search: "marble" })).rejects.toThrow(ForbiddenException);
      await expect(services.suppliers.find(actor, w.a, { search: "marble" })).rejects.toThrow(ForbiddenException);
    });
  });

  it("keeps each workspace's products, stock and suppliers to itself under forced RLS", async () => {
    await world(async (w) => {
      await seed(w);
      const guarded = await w.client.query<{ name: string }>(
        `SELECT relname AS name FROM pg_class WHERE relname = ANY($1::text[]) AND relrowsecurity AND relforcerowsecurity
            AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename = relname AND policyname = 'tenant_isolation') ORDER BY relname`,
        [["catalog_items", "price_entries", "catalog_item_values", "stock_items", "stock_balances", "stock_reservations", "workspace_vendors", "workspace_vendor_sites", "supplier_attributes"]]);
      expect(guarded.rows.map((row) => row.name)).toEqual(["catalog_item_values", "catalog_items", "price_entries", "stock_balances", "stock_items", "stock_reservations", "supplier_attributes", "workspace_vendor_sites", "workspace_vendors"]);
      // Studio B has its own sofa; asking in B finds only B's.
      const inB = w.services(w.author, EVERYTHING);
      const { id: catalogB } = await inB.catalog.createCatalog(actor, w.b, { name: "B collection" });
      await inB.catalog.createItem(actor, w.b, catalogB, { code: "HAR-B", name: "Harriet armchair", itemType: "product", unitCode: "pcs" });
      const all = ["ai.suggestions.use", "catalog.view", "stock.view", "vendors.view"];
      expect((await w.tool("search_catalog", w.b, all, { text: "Harriet" })).data.items).toEqual([expect.objectContaining({ name: "Harriet armchair" })]);
      expect((await w.tool("check_stock", w.b, all, { text: "marble" })).data.count).toBe(0);
      expect((await w.tool("search_suppliers", w.b, all, { text: "marble" })).data.count).toBe(0);
      // Even asked for Studio A by id, a transaction in Studio B's tenant sees none of A's rows.
      expect((await w.tool("search_catalog", w.a, all, { text: "Harriet sofa" }, w.b)).data.count).toBe(0);
      expect((await w.tool("check_stock", w.a, all, { text: "marble" }, w.b)).data.count).toBe(0);
      expect((await w.tool("search_suppliers", w.a, all, { text: "marble" }, w.b)).data.count).toBe(0);
      // And in A's own tenant, everything is there.
      expect((await w.tool("search_catalog", w.a, all, { text: "Harriet sofa" })).data.count).toBe(1);
    });
  });
});
