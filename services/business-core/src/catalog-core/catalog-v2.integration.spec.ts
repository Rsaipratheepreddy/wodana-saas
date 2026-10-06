import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CatalogV2Service } from "./catalog-v2.service";

const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("catalog v2 on PostgreSQL", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function scenario(work: (s: { as: (user: "author" | "qs", costs?: boolean) => CatalogV2Service; workspaceId: string; refused: (work: () => Promise<unknown>, message: RegExp | string) => Promise<void> }) => Promise<void>) {
    const client: PoolClient = await pool.connect();
    const workspaceId = randomUUID(), author = randomUUID(), qs = randomUUID();
    try {
      await client.query("BEGIN");
      for (const [id, name] of [[author, "Author"], [qs, "QS"]]) await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [id, `${id}@example.com`, name]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Cat',$2,'AED',$3)", [workspaceId, `cat-${workspaceId.slice(0, 8)}`, author]);
      await client.query("SET LOCAL session_replication_role = origin");
      const as = (user: "author" | "qs", costs = true) => {
        const userId = user === "author" ? author : qs;
        const access = {
          withPermission: (_a: unknown, _w: string, _p: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId }),
          withAnyPermission: async (_a: unknown, _w: string, _p: string[], fn: (c: PoolClient, u: { userId: string }) => unknown) => { if (!costs) throw new Error("forbidden"); return fn(client, { userId }); },
        };
        return new CatalogV2Service(access as never, {} as never);
      };
      // Each request is its own transaction in production; here an expected failure rolls back to a savepoint.
      const refused = async (fn: () => Promise<unknown>, message: RegExp | string) => {
        await client.query("SAVEPOINT expected_failure");
        await expect(fn()).rejects.toThrow(message);
        await client.query("ROLLBACK TO SAVEPOINT expected_failure");
      };
      await work({ as, workspaceId, refused });
    } finally { await client.query("ROLLBACK"); client.release(); }
  }
  const actor = {} as never;

  it("keeps a link to a standard item's technical drawing, kept when an edit leaves it out (PLM-057)", async () => {
    await scenario(async ({ as, workspaceId, refused }) => {
      const author = as("author");
      const { id: catalogId } = await author.createCatalog(actor, workspaceId, { name: "Core collection" });
      await refused(() => author.createItem(actor, workspaceId, catalogId, { code: "SOFA3", name: "Sofa", itemType: "product", unitCode: "pcs", technicalDrawingUrl: "drive/sofa.pdf" }),
        /technical drawing's link/);
      const sofa = await author.createItem(actor, workspaceId, catalogId, { code: "SOFA3", name: "Sofa", itemType: "product", unitCode: "pcs", technicalDrawingUrl: " https://drive.example.com/sofa.pdf " });
      expect(sofa.technicalDrawingUrl).toBe("https://drive.example.com/sofa.pdf");
      const renamed = await author.updateItem(actor, workspaceId, catalogId, sofa.id, { version: sofa.version, code: "SOFA3", name: "Sofa 3 seater", itemType: "product", unitCode: "pcs" });
      expect(renamed.technicalDrawingUrl).toBe("https://drive.example.com/sofa.pdf");
      const cleared = await author.updateItem(actor, workspaceId, catalogId, sofa.id, { version: renamed.version, code: "SOFA3", name: "Sofa 3 seater", itemType: "product", unitCode: "pcs", technicalDrawingUrl: "" });
      expect(cleared.technicalDrawingUrl).toBeNull();
    });
  });

  it("builds a wardrobe from priced components and explains the price", async () => {
    await scenario(async ({ as, workspaceId, refused }) => {
      const author = as("author");
      const { id: catalogId } = await author.createCatalog(actor, workspaceId, { name: "Joinery" });
      const { id: joinery } = await author.createCategory(actor, workspaceId, catalogId, { name: "Wardrobes" });
      await author.createAttribute(actor, workspaceId, catalogId, { label: "Finish", valueType: "choice", choices: ["Acrylic", "Laminate"], categoryId: joinery, required: true });
      const ply = await author.createItem(actor, workspaceId, catalogId, { code: "PLY18", name: "Ply 18mm", itemType: "material", unitCode: "sqft", wastePercent: "10" });
      const hinge = await author.createItem(actor, workspaceId, catalogId, { code: "HNG", name: "Soft-close hinge", itemType: "product", unitCode: "pcs" });
      await refused(() => author.createItem(actor, workspaceId, catalogId, { code: "WR1", name: "Wardrobe", itemType: "assembly", unitCode: "pcs", categoryId: joinery }), "Finish is required");
      const wardrobe = await author.createItem(actor, workspaceId, catalogId, { code: "WR1", name: "Wardrobe", itemType: "assembly", unitCode: "pcs", categoryId: joinery, values: { finish: "acrylic" } });
      await refused(() => author.createItem(actor, workspaceId, catalogId, { code: "WR1", name: "Copy", itemType: "product", unitCode: "pcs" }), /already used/);
      const withBom = await author.setComponents(actor, workspaceId, catalogId, wardrobe.id, { version: wardrobe.version, components: [
        { componentItemId: ply.id, quantityFormula: "width * height / 92903 * 2", unitCode: "sqft" },
        { componentItemId: hinge.id, quantityFormula: "ceil(height / 450) * 2", unitCode: "pcs" },
      ] });
      expect(withBom.components).toHaveLength(2);
      // A hinge cannot contain the wardrobe that contains it.
      await refused(() => author.setComponents(actor, workspaceId, catalogId, hinge.id, { version: hinge.version, components: [{ componentItemId: wardrobe.id, quantityFormula: "1", unitCode: "pcs" }] }), /Only assemblies/);

      const { id: bookId } = await author.createPriceBook(actor, workspaceId, catalogId, { name: "Retail AED", currency: "AED" });
      const plyPrice = await author.savePrice(actor, workspaceId, bookId, ply.id, { method: "fixed", price: "5" });
      const hingePrice = await author.savePrice(actor, workspaceId, bookId, hinge.id, { method: "fixed", price: "12.5" });
      const wardrobePrice = await author.savePrice(actor, workspaceId, bookId, wardrobe.id, { method: "assembly_rollup", labour: "400", marginPercent: "25" });
      await refused(() => author.reviewPrice(actor, workspaceId, plyPrice.id, { version: 1, decision: "reviewed" }), /other than the author/);
      await refused(() => author.reviewPrice(actor, workspaceId, plyPrice.id, { version: 1, decision: "active" }), /reviewed before/);
      for (const entry of [plyPrice, hingePrice, wardrobePrice]) {
        await as("qs").reviewPrice(actor, workspaceId, entry.id, { version: 1, decision: "reviewed" });
        await author.reviewPrice(actor, workspaceId, entry.id, { version: 2, decision: "active" });
      }

      const preview = await author.pricePreview(actor, workspaceId, catalogId, { itemId: wardrobe.id, priceBookId: bookId, quantity: "1", measurements: { width: "1800", height: "2400" } });
      expect(preview.components.map((c) => [c.label, c.perAssembly])).toEqual([["Ply 18mm", "93.000226"], ["Soft-close hinge", "12"]]);
      expect(preview.result).toMatchObject({ available: true });
      if (!preview.result.available) throw new Error();
      expect(preview.result.breakdown.map((line) => line.label)).toEqual(expect.arrayContaining(["Labour", "Margin 25%"]));

      // Without cost access the customer price is shown but not how margin was built.
      const salesView = await as("author", false).pricePreview(actor, workspaceId, catalogId, { itemId: wardrobe.id, priceBookId: bookId, quantity: "1", measurements: { width: "1800", height: "2400" } });
      if (!salesView.result.available) throw new Error();
      expect(salesView.result.breakdown).toEqual([{ label: "Price", amount: salesView.result.total }]);
      const listed = await author.listItems(actor, workspaceId, catalogId, { categoryId: joinery });
      expect(listed.items.map((item: { name: string }) => item.name)).toEqual(["Wardrobe"]);
    });
  });

  it("refuses to archive an item used in an assembly", async () => {
    await scenario(async ({ as, workspaceId, refused }) => {
      const author = as("author");
      const { id: catalogId } = await author.createCatalog(actor, workspaceId, { name: "Kit" });
      const part = await author.createItem(actor, workspaceId, catalogId, { code: "P", name: "Panel", itemType: "material", unitCode: "sqm" });
      const kit = await author.createItem(actor, workspaceId, catalogId, { code: "K", name: "Kitchen run", itemType: "assembly", unitCode: "rft" });
      await author.setComponents(actor, workspaceId, catalogId, kit.id, { version: kit.version, components: [{ componentItemId: part.id, quantityFormula: "length * 0.6", unitCode: "sqm" }] });
      await refused(() => author.archiveItem(actor, workspaceId, catalogId, part.id, part.version), /Used in Kitchen run/);
    });
  });

  it("imports a stock sheet, creating categories, units and attributes, and updates by code on re-import", async () => {
    await scenario(async ({ as, workspaceId }) => {
      const author = as("author");
      const { id: catalogId } = await author.createCatalog(actor, workspaceId, { name: "Materials", purpose: "buy" });
      const rows = [
        { line: 3, category: "Woodstock", code: "W00129", name: "Commercial plywood WBP birch face", attributes: { Size: "4' X 8' X 12MM" } },
        { line: 4, category: "Consumables", name: "Teflon tape", unit: "ROLL", attributes: { Colour: "WHITE" } },
        { line: 5, category: "Paint", code: "CP 003", name: "CP 003 Catalyst @ 50%", unit: "LITER" },
        { line: 6, category: "Paint", code: "CP 003", name: "CP 003 Catalyst @ 50% NY", unit: "LITER" },
      ];
      const preview = await author.importItems(actor, workspaceId, catalogId, { mode: "preview", rows });
      expect(preview.summary).toMatchObject({ create: 3, error: 1, newUnits: ["roll"] });
      const committed = await author.importItems(actor, workspaceId, catalogId, { mode: "commit", rows });
      expect(committed.summary.create).toBe(3);
      const structure = await author.structure(actor, workspaceId, catalogId);
      expect(structure.categories.map((c: { name: string }) => c.name).sort()).toEqual(["Consumables", "Paint", "Woodstock"]);
      expect(structure.units.some((u: { code: string }) => u.code === "roll")).toBe(true);
      const again = await author.importItems(actor, workspaceId, catalogId, { mode: "commit", rows: [{ line: 3, category: "Woodstock", code: "W00129", name: "Birch plywood 12mm", attributes: { Size: "4' X 8' X 12MM" } }] });
      expect(again.rows[0].action).toBe("update");
      const listed = await author.listItems(actor, workspaceId, catalogId, { search: "birch" });
      expect(listed.items).toHaveLength(1);
      expect(listed.items[0]).toMatchObject({ code: "W00129", name: "Birch plywood 12mm", values: { size: "4' X 8' X 12MM" } });
    });
  });
});
