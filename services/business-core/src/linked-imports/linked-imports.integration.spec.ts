import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CatalogV2Service } from "../catalog-core/catalog-v2.service";
import { InventoryService } from "../inventory/inventory.service";
import { seedDefaultNotificationTemplates } from "../notifications/default-templates";
import { SuppliersService } from "../purchasing/suppliers.service";
import { readLetterhead } from "../workspaces/entity-letterhead";
import { LinkedImportsService } from "./linked-imports.service";
import type { SourceSheet } from "./linked-import-source";
import { SheetSourceError } from "./sheet-source.service";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = {} as never;

type World = {
  client: PoolClient; workspaceId: string; owner: string; clerk: string; warehouse: string; showroom: string; connectionId: string;
  as: (userId: string) => LinkedImportsService; sheets: { read: ReturnType<typeof vi.fn> }; inventory: InventoryService; catalogs: CatalogV2Service;
};

// Fixtures shaped like a firm's stock list and product list.
const stockList = (rows: string[][]): SourceSheet[] => [{ name: "Stock", rows: [["Materials stock list"], ["Code", "Item", "Unit", "Qty", "Location", "Cost"], ...rows] }];
const STOCK_MAPPING = { columns: { Code: "code", Item: "name", Unit: "unit", Qty: "quantity", Location: "location", Cost: "cost" } };
const productList = (sofas: string[][], chairs: string[][] = []): SourceSheet[] => [
  { name: "Sofas", rows: [["Code", "Name", "Unit", "Cost", "Price", "Production time", "Fabric"], ...sofas] },
  { name: "Chairs", rows: [["Code", "Name", "Unit", "Cost", "Price", "Production time", "Fabric"], ...chairs] },
];
const PRODUCT_MAPPING = { columns: { Code: "code", Name: "name", Unit: "unit", Cost: "cost", Price: "price", "Production time": "productionDays", Fabric: "attribute" } };

// A firm's supplier list: no codes, names as the key, a combined contact cell, a TRN column and extra columns.
const supplierList = (rows: string[][]): SourceSheet[] => [{ name: "Suppliers", rows: [["Company Name", "Contact Person", "Mobile", "Email", "TRN", "Payment Terms", "Supplier Type", "Directors Approved"], ...rows] }];
const SUPPLIER_MAPPING = { columns: { "Company Name": "name", "Contact Person": "contactName", Mobile: "phone", Email: "email", TRN: "taxNumber", "Payment Terms": "paymentTerms",
  "Supplier Type": "categories", "Directors Approved": "attribute" } };

integration("linked spreadsheet imports (PLM-073, PLM-124, PLM-111)", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function world(run: (world: World) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), owner = randomUUID(), clerk = randomUUID(), warehouse = randomUUID(), showroom = randomUUID(), connectionId = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Rana Owner'),($3,$4,'Sam Clerk')", [owner, `${owner.slice(0, 8)}@example.com`, clerk, `${clerk.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Studio',$2,'AED','Asia/Dubai',$3)", [workspaceId, `imp-${workspaceId.slice(0, 8)}`, owner]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active'),($4,$2,$5,'active')", [randomUUID(), workspaceId, owner, randomUUID(), clerk]);
      await client.query("SET LOCAL session_replication_role = origin");
      await client.query("INSERT INTO stock_locations(id,workspace_id,kind,name,is_default) VALUES($1,$2,'warehouse','Main warehouse',true),($3,$2,'other','Showroom',false)", [warehouse, workspaceId, showroom]);
      await client.query(`INSERT INTO integration_connections(id,workspace_id,provider,display_name,status,granted_scopes) VALUES($1,$2,'google_workspace','Google','connected',$3::jsonb)`,
        [connectionId, workspaceId, JSON.stringify(["openid", "https://www.googleapis.com/auth/drive.file"])]);
      await seedDefaultNotificationTemplates(client, workspaceId);
      const run_ = (userId: string) => (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId });
      const access = (userId: string) => ({ asMember: (_a: unknown, _w: string, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(client, { userId }),
        withPermission: run_(userId), withPermissions: run_(userId), withAnyPermission: run_(userId), hasPermission: async () => true } as never);
      const db = { query: (text: string, values?: unknown[]) => client.query(text, values), tenantTransaction: (_w: string, _a: string, fn: (c: PoolClient) => unknown) => fn(client) } as never;
      const inventory = new InventoryService(access(owner));
      const catalogs = new CatalogV2Service(access(owner), {} as never);
      const sheets = { read: vi.fn() };
      const as = (userId: string) => new LinkedImportsService(access(userId), db, new InventoryService(access(userId)), new CatalogV2Service(access(userId), {} as never), sheets as never,
        new SuppliersService(access(userId)));
      await run({ client, workspaceId, owner, clerk, warehouse, showroom, connectionId, as, sheets, inventory, catalogs });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const free = async (w: World, code: string, place: string) => (await w.client.query<{ onHand: string }>(
    `SELECT balance.on_hand::text AS "onHand" FROM stock_balances balance JOIN stock_items item ON item.id = balance.item_id
      WHERE balance.workspace_id = $1 AND item.code = $2 AND balance.location_id = $3 AND balance.project_id IS NULL`, [w.workspaceId, code, place])).rows[0]?.onHand ?? "0";
  const movements = async (w: World) => (await w.client.query<{ code: string; quantity: string; reason: string; unitCost: string | null }>(
    `SELECT item.code, movement.quantity::text AS quantity, movement.reason, movement.unit_cost::text AS "unitCost" FROM stock_movements movement
       JOIN stock_items item ON item.id = movement.item_id WHERE movement.workspace_id = $1 ORDER BY movement.seq`, [w.workspaceId])).rows;

  it("imports a stock list as counts, changes nothing on a re-run, follows the sheet and flags codes that leave it", async () => {
    await world(async (w) => {
      const service = w.as(w.owner);
      const first = stockList([["MAT-001", "Oak veneer 0.6mm", "sqm", "120", "", "18.50"], ["MAT-002", "Velvet – Sage", "m", "1,240.5", "Showroom", "AED 42"]]);
      const draft = { target: "stock", source: "upload", name: "Stock list", locationId: w.warehouse, mapping: STOCK_MAPPING, sheets: first };
      const preview = await service.preview(actor, w.workspaceId, draft);
      expect(preview.summary).toEqual({ added: 2, changed: 0, unchanged: 0, errors: 0, missing: 0 });
      expect(preview.rows.map((row) => [row.key, row.outcome, row.changes])).toEqual([
        ["MAT-001", "added", ["Main warehouse: 0 → 120 sqm"]], ["MAT-002", "added", ["Showroom: 0 → 1240.5 m"]]]);
      // Nothing is written by a preview.
      expect(await movements(w)).toEqual([]);
      await expect(service.apply(actor, w.workspaceId, { ...draft, runId: randomUUID(), expectedFingerprint: "0".repeat(64) })).rejects.toThrow(/changed since the preview/);

      const runId = randomUUID();
      const linked = await service.apply(actor, w.workspaceId, { ...draft, runId, expectedFingerprint: preview.fingerprint });
      expect(linked.runs[0]).toMatchObject({ status: "applied", trigger: "manual", added: 2, changed: 0, errors: 0 });
      expect(linked.link).toMatchObject({ source: "upload", schedule: "off", setsStock: true, ownerId: w.owner });
      expect(await free(w, "MAT-001", w.warehouse)).toBe("120.0000");
      expect(await free(w, "MAT-002", w.showroom)).toBe("1240.5000");
      expect(await movements(w)).toEqual([
        { code: "MAT-001", quantity: "120.0000", reason: "Linked sheet import", unitCost: "18.5000" },
        { code: "MAT-002", quantity: "1240.5000", reason: "Linked sheet import", unitCost: "42.0000" }]);
      const audit = (await w.client.query<{ action: string }>(`SELECT action FROM audit_events WHERE workspace_id = $1 ORDER BY occurred_at, action`, [w.workspaceId])).rows.map((row) => row.action);
      expect(audit).toEqual(expect.arrayContaining(["linked_import.linked", "linked_import.applied", "stock.count"]));

      // The same request again is the same run; the same data again changes nothing.
      expect((await service.apply(actor, w.workspaceId, { ...draft, runId })).runs).toHaveLength(1);
      const linkId = linked.link.id;
      const again = await service.refresh(actor, w.workspaceId, linkId, { runId: randomUUID(), sheets: first });
      expect(again.runs[0]).toMatchObject({ status: "applied", added: 0, changed: 0, unchanged: 2, missing: 0 });
      expect(await movements(w)).toHaveLength(2);

      // Stock used in Wodana isn't put back while the sheet's number stays the same; a new number in the sheet is counted.
      const place = (await w.client.query(`SELECT id, kind, name, project_id AS "projectId", is_default AS "isDefault", active FROM stock_locations WHERE id = $1`, [w.warehouse])).rows[0];
      const oak = (await w.client.query<{ id: string }>(`SELECT id FROM stock_items WHERE workspace_id = $1 AND code = 'MAT-001'`, [w.workspaceId])).rows[0].id;
      await w.inventory.countWith(w.client, w.workspaceId, w.clerk, { batchId: randomUUID(), itemId: oak, location: place, owner: null, counted: "100", reason: "Cut for a job", movedOn: "2026-10-06" });
      expect((await service.refresh(actor, w.workspaceId, linkId, { runId: randomUUID(), sheets: first })).runs[0]).toMatchObject({ changed: 0, unchanged: 2 });
      expect(await free(w, "MAT-001", w.warehouse)).toBe("100.0000");
      const second = stockList([["MAT-001", "Oak veneer 0.6 mm", "sqm", "90", "", "18.50"], ["MAT-003", "Brass handle", "pcs", "ten", "", ""]]);
      const partial = await service.refresh(actor, w.workspaceId, linkId, { runId: randomUUID(), sheets: second });
      expect(partial.runs[0]).toMatchObject({ status: "partial", added: 0, changed: 1, errors: 1, missing: 1 });
      expect(partial.rows.map((row: { key: string; outcome: string; message: string }) => [row.key, row.outcome, row.message])).toEqual([
        ["MAT-003", "error", "Quantity isn't a number (ten)."],
        ["MAT-002", "missing", "Not in the sheet any more."],
        ["MAT-001", "changed", "Name Oak veneer 0.6mm → Oak veneer 0.6 mm; Main warehouse: 100 → 90 sqm"],
      ]);
      expect(await free(w, "MAT-001", w.warehouse)).toBe("90.0000");
      // A code that left the sheet is flagged, never deleted.
      expect(await free(w, "MAT-002", w.showroom)).toBe("1240.5000");
      expect((await w.client.query(`SELECT 1 FROM import_link_records WHERE workspace_id = $1 AND key_value = 'MAT-002' AND missing_since IS NOT NULL`, [w.workspaceId])).rowCount).toBe(1);

      // With quantities off, only the item's details follow the sheet.
      await expect(service.settings(actor, w.workspaceId, linkId, { version: 99, setsStock: false })).rejects.toThrow(/Someone else changed/);
      await service.settings(actor, w.workspaceId, linkId, { version: partial.link.version, setsStock: false });
      await service.refresh(actor, w.workspaceId, linkId, { runId: randomUUID(), sheets: stockList([["MAT-001", "Oak veneer", "sqm", "5", "", ""]]) });
      expect(await free(w, "MAT-001", w.warehouse)).toBe("90.0000");
      expect((await w.client.query(`SELECT name FROM stock_items WHERE id = $1`, [oak])).rows[0].name).toBe("Oak veneer");
      // A manual run by the owner tells nobody.
      expect((await w.client.query(`SELECT 1 FROM notifications WHERE workspace_id = $1 AND event_type LIKE 'linked_import.%'`, [w.workspaceId])).rowCount).toBe(0);
    });
  });

  it("imports a product list into the catalog through its own commands, with prices drafted for review", async () => {
    await world(async (w) => {
      const service = w.as(w.owner);
      const { id: catalogId } = await w.catalogs.createCatalog(actor, w.workspaceId, { name: "Core Collection" });
      const first = productList([["SOF-1", "Aria sofa", "pcs", "4,100", "9,800", "21", "Boucle"], ["SOF-1", "Aria sofa copy", "", "", "", "", ""]], [["CHR-1", "Luna chair", "", "800", "1,950", "", ""]]);
      const draft = { target: "catalog", source: "upload", name: "Core Collection", catalogId, itemType: "ready_made", mapping: PRODUCT_MAPPING, sheets: first };
      const preview = await service.preview(actor, w.workspaceId, draft);
      expect(preview.summary).toEqual({ added: 2, changed: 0, unchanged: 0, errors: 1, missing: 0 });
      expect(preview.rows[0]).toMatchObject({ key: "SOF-1", outcome: "error", message: "Code SOF-1 is on another row." });
      const linked = await service.apply(actor, w.workspaceId, { ...draft, runId: randomUUID(), expectedFingerprint: preview.fingerprint });
      expect(linked.runs[0]).toMatchObject({ status: "partial", added: 2, errors: 1 });
      const items = (await w.client.query(
        `SELECT item.code, item.name, item.item_type AS type, item.unit_code AS unit, item.production_days AS days, category.name AS category,
                entry.method, entry.price::text AS price, entry.cost::text AS cost, entry.status, book.currency
           FROM catalog_items item LEFT JOIN catalog_categories category ON category.id = item.category_id
           LEFT JOIN price_entries entry ON entry.item_id = item.id AND entry.status <> 'expired' LEFT JOIN price_books book ON book.id = entry.price_book_id
          WHERE item.workspace_id = $1 ORDER BY item.code`, [w.workspaceId])).rows;
      expect(items).toEqual([
        { code: "CHR-1", name: "Luna chair", type: "ready_made", unit: "pcs", days: null, category: "Chairs", method: "fixed", price: "1950.000000", cost: "800.000000", status: "draft", currency: "AED" },
        { code: "SOF-1", name: "Aria sofa", type: "ready_made", unit: "pcs", days: 21, category: "Sofas", method: "fixed", price: "9800.000000", cost: "4100.000000", status: "draft", currency: "AED" },
      ]);
      const fabric = (await w.client.query(`SELECT value.value FROM catalog_item_values value JOIN catalog_attributes attribute ON attribute.id = value.attribute_id
        WHERE value.workspace_id = $1 AND attribute.label = 'Fabric'`, [w.workspaceId])).rows;
      expect(fabric).toEqual([{ value: "Boucle" }]);

      const linkId = linked.link.id;
      const fixed = productList([["SOF-1", "Aria sofa", "pcs", "4,100", "9,800", "21", "Boucle"]], [["CHR-1", "Luna chair", "", "800", "1,950", "", ""]]);
      expect((await service.refresh(actor, w.workspaceId, linkId, { runId: randomUUID(), sheets: fixed })).runs[0]).toMatchObject({ status: "applied", added: 0, changed: 0, unchanged: 2 });
      const repriced = productList([["SOF-1", "Aria sofa", "pcs", "4,100", "10,200", "25", "Velvet"]], [["CHR-1", "Luna chair", "", "800", "1,950", "", ""]]);
      const changed = await service.refresh(actor, w.workspaceId, linkId, { runId: randomUUID(), sheets: repriced });
      expect(changed.rows[0]).toMatchObject({ key: "SOF-1", outcome: "changed", message: "Production time 21 → 25 days; Fabric; Price 9800 → 10200 (draft until reviewed)" });
      const prices = (await w.client.query(`SELECT entry.price::text AS price, entry.status FROM price_entries entry JOIN catalog_items item ON item.id = entry.item_id
        WHERE item.workspace_id = $1 AND item.code = 'SOF-1' ORDER BY entry.created_at, entry.status`, [w.workspaceId])).rows;
      expect(prices).toEqual(expect.arrayContaining([{ price: "9800.000000", status: "expired" }, { price: "10200.000000", status: "draft" }]));
      expect((await w.client.query(`SELECT count(*)::int AS count FROM catalog_items WHERE workspace_id = $1`, [w.workspaceId])).rows[0].count).toBe(2);
    });
  });

  it("keeps a materials list without quantities: every item listed at nothing on hand, with its tab as the category", async () => {
    await world(async (w) => {
      const service = w.as(w.owner);
      const sheets: SourceSheet[] = [
        { name: "HARDWARE", rows: [["Code", "Item", "Unit"], ["HW-1", "Hinge", "pcs"], ["HW-2", "Drawer runner", "pair"]] },
        { name: "Paint", rows: [["Code", "Item", "Unit"], ["PT-1", "Primer", "l"]] },
      ];
      const draft = { target: "stock", source: "upload", name: "Materials", locationId: w.warehouse, mapping: { columns: { Code: "code", Item: "name", Unit: "unit" } }, sheets };
      const preview = await service.preview(actor, w.workspaceId, draft);
      await service.apply(actor, w.workspaceId, { ...draft, runId: randomUUID(), expectedFingerprint: preview.fingerprint });
      const state = await w.inventory.stock(actor, w.workspaceId) as { rows: unknown[]; items: Array<{ itemCode: string; category: string }> };
      expect(state.rows).toEqual([]);
      expect(state.items.map((item) => [item.itemCode, item.category])).toEqual([["HW-2", "Hardware"], ["HW-1", "Hardware"], ["PT-1", "Paint"]]);
      // A tab renamed in the sheet moves its items on the next refresh.
      const link = (await w.client.query<{ id: string }>(`SELECT id FROM import_links WHERE workspace_id = $1`, [w.workspaceId])).rows[0].id;
      const moved = await service.refresh(actor, w.workspaceId, link, { runId: randomUUID(), sheets: [{ ...sheets[0], name: "Fittings" }, sheets[1]] });
      expect(moved.runs[0]).toMatchObject({ changed: 2, unchanged: 1 });
      expect((await w.client.query(`SELECT category FROM stock_items WHERE workspace_id = $1 AND code = 'HW-1'`, [w.workspaceId])).rows[0].category).toBe("Fittings");
    });
  });

  it("imports a collection sheet of category blocks without codes: names as keys, drawings from cell links, sizes from plain cells", async () => {
    await world(async (w) => {
      const service = w.as(w.owner);
      const { id: catalogId } = await w.catalogs.createCatalog(actor, w.workspaceId, { name: "Collection" });
      // The catalog's own category, which the sheet's "ARMCHAIRS" block names in capitals and the plural.
      await w.catalogs.createCategory(actor, w.workspaceId, catalogId, { name: "Armchair" });
      const heading = ["REMARKS", "ITEM", "DESCRIPTION", "IMAGE", "HEIGHT (CM)", "LENGTH (CM)", "DEPTH (CM)", "PRICE (AED)", "Technical Drawing", "Materials Needed", "Hours Needed"];
      const sheet = (width: string, depth = "120 cm"): SourceSheet[] => [{ name: "Living", rows: [
        ["", "", "", "", "", "", "", "", "", "Add more sofas"],
        ["", "SOFA"],
        heading,
        ["", "SOFA", "Aria Sofa - 3 seater", "", "Total H 108 cm - seat H 53 cm", width, "120 cm", "AED23,500.00", "Aria Sofa-3 Seater", "Wood, fabric, foam", "Carpentry 12 hours"],
        ["Add to the brochure", "", "", "", "", "", "", "", "", "", ""],
        ["", "SOFA", "Aria Sofa - 4 seater", "", "", "400 cm", depth, "28500", "no cad file", "", ""],
        [],
        ["", "ARMCHAIRS"],
        heading,
        ["", "CHAIR", "Luna Chair", "", "80", "70", "75", "ENQUIRE NOW", "", "", ""],
      ], links: { "3:8": "https://drive.example/file/aria-3.pdf" } }];
      const mapping = { columns: { ITEM: "attribute", DESCRIPTION: "name", "HEIGHT (CM)": "height", "LENGTH (CM)": "width", "DEPTH (CM)": "depth", "PRICE (AED)": "price",
        "Technical Drawing": "technicalDrawing", "Materials Needed": "attribute", "Hours Needed": "attribute" } };
      const draft = { target: "catalog", source: "upload", name: "Collection", catalogId, itemType: "ready_made", mapping, sheets: sheet("300 cm") };
      const preview = await service.preview(actor, w.workspaceId, draft);
      expect(preview.summary).toEqual({ added: 3, changed: 0, unchanged: 0, errors: 0, missing: 0 });
      expect(preview.rows.map((row) => [row.key, row.message])).toEqual([
        ["SOFA / Aria Sofa - 3 seater", "No unit: set to pieces. Height isn't one number, so it's kept in Size notes."],
        ["SOFA / Aria Sofa - 4 seater", "No unit: set to pieces. No link to a technical drawing in no cad file."],
        ["ARMCHAIRS / Luna Chair", "No unit: set to pieces. No selling price: ENQUIRE NOW."],
      ]);
      const linked = await service.apply(actor, w.workspaceId, { ...draft, runId: randomUUID(), expectedFingerprint: preview.fingerprint });
      expect(linked.runs[0]).toMatchObject({ status: "applied", added: 3 });
      expect((linked as { records?: unknown[] }).records).toEqual(expect.arrayContaining([expect.objectContaining({ sheet: "Living", line: 4, images: 0 })]));
      const items = (await w.client.query(
        `SELECT item.code, item.name, category.name AS category, item.technical_drawing_url AS drawing, size.width::text AS width, size.depth::text AS depth, size.height::text AS height,
                size.unit, size.source, entry.price::text AS price
           FROM catalog_items item LEFT JOIN catalog_categories category ON category.id = item.category_id
           LEFT JOIN catalog_item_dimensions size ON size.item_id = item.id LEFT JOIN price_entries entry ON entry.item_id = item.id AND entry.status <> 'expired'
          WHERE item.workspace_id = $1 ORDER BY item.code`, [w.workspaceId])).rows;
      expect(items).toEqual([
        { code: "ARIA-SOFA-3-SEATER", name: "Aria Sofa - 3 seater", category: "Sofa", drawing: "https://drive.example/file/aria-3.pdf", width: "300.00", depth: "120.00", height: null, unit: "cm", source: "import", price: "23500.000000" },
        { code: "ARIA-SOFA-4-SEATER", name: "Aria Sofa - 4 seater", category: "Sofa", drawing: null, width: "400.00", depth: "120.00", height: null, unit: "cm", source: "import", price: "28500.000000" },
        { code: "LUNA-CHAIR", name: "Luna Chair", category: "Armchair", drawing: null, width: "70.00", depth: "75.00", height: "80.00", unit: "cm", source: "import", price: null },
      ]);
      // A new category is named in Title Case; one the catalog has is matched however the sheet writes it.
      expect((await w.client.query(`SELECT name FROM catalog_categories WHERE workspace_id = $1 ORDER BY name`, [w.workspaceId])).rows.map((row) => row.name)).toEqual(["Armchair", "Sofa"]);
      const kept = (await w.client.query(`SELECT attribute.label, value.value FROM catalog_item_values value JOIN catalog_attributes attribute ON attribute.id = value.attribute_id
        JOIN catalog_items item ON item.id = value.item_id WHERE item.code = 'ARIA-SOFA-3-SEATER' AND item.workspace_id = $1 ORDER BY attribute.label`, [w.workspaceId])).rows;
      expect(kept).toEqual([{ label: "Hours Needed", value: "Carpentry 12 hours" }, { label: "ITEM", value: "SOFA" },
        { label: "Materials Needed", value: "Wood, fabric, foam" }, { label: "Size notes", value: "Height: Total H 108 cm - seat H 53 cm" }]);

      // The same sheet again changes nothing; a new length is a size change.
      const linkId = linked.link.id;
      expect((await service.refresh(actor, w.workspaceId, linkId, { runId: randomUUID(), sheets: sheet("300 cm") })).runs[0]).toMatchObject({ status: "applied", added: 0, changed: 0, unchanged: 3 });
      const resized = await service.refresh(actor, w.workspaceId, linkId, { runId: randomUUID(), sheets: sheet("3,100 mm") });
      expect(resized.rows.find((row: { key: string }) => row.key === "SOFA / Aria Sofa - 3 seater")).toMatchObject({ outcome: "changed",
        message: "Height isn't one number, so it's kept in Size notes. Width 300 → 310 cm" });
      expect((await w.client.query(`SELECT size.width::text AS width, size.version FROM catalog_item_dimensions size JOIN catalog_items item ON item.id = size.item_id
        WHERE item.code = 'ARIA-SOFA-3-SEATER' AND item.workspace_id = $1`, [w.workspaceId])).rows).toEqual([{ width: "310.00", version: 2 }]);
      // A second link over the same catalog finds the items by name in their category.
      const again = await service.preview(actor, w.workspaceId, { ...draft, name: "Collection copy", sheets: sheet("310 cm") });
      expect(again.summary).toMatchObject({ added: 0, errors: 0, unchanged: 3 });

      // Text an earlier import kept under a size heading is cleared on the next run; a size cell with no figure is no size.
      const legacy = await w.catalogs.insertAttribute(w.client, w.workspaceId, catalogId, { label: "DEPTH (CM)", valueType: "text" }, w.owner);
      await w.client.query(`INSERT INTO catalog_item_values (workspace_id, item_id, attribute_id, value) SELECT $1, item.id, $2, 'Sizes are currently not listed on our website'
        FROM catalog_items item WHERE item.workspace_id = $1 AND item.code = 'ARIA-SOFA-4-SEATER'`, [w.workspaceId, legacy.id]);
      const cleaned = await service.refresh(actor, w.workspaceId, linkId, { runId: randomUUID(), sheets: sheet("3,100 mm", "Sizes are currently not listed on our website") });
      expect(cleaned.runs[0]).toMatchObject({ status: "applied", changed: 1, unchanged: 2 });
      expect(cleaned.rows.find((row: { key: string }) => row.key === "SOFA / Aria Sofa - 4 seater")).toMatchObject({ outcome: "changed",
        message: "No link to a technical drawing in no cad file. No depth given. DEPTH (CM) cleared" });
      expect((await w.client.query(`SELECT count(*)::int AS count FROM catalog_item_values WHERE workspace_id = $1 AND attribute_id = $2`, [w.workspaceId, legacy.id])).rows[0].count).toBe(0);
      expect((await w.client.query(`SELECT size.depth::text AS depth FROM catalog_item_dimensions size JOIN catalog_items item ON item.id = size.item_id
        WHERE item.code = 'ARIA-SOFA-4-SEATER' AND item.workspace_id = $1`, [w.workspaceId])).rows).toEqual([{ depth: "120.00" }]);
      expect((await service.refresh(actor, w.workspaceId, linkId, { runId: randomUUID(), sheets: sheet("3,100 mm", "Sizes are currently not listed on our website") })).runs[0])
        .toMatchObject({ status: "applied", changed: 0, unchanged: 3 });
    });
  });

  it("refreshes a linked Google Sheet on its schedule as its owner, and tells the owner once when it fails", async () => {
    await world(async (w) => {
      const service = w.as(w.owner);
      w.sheets.read.mockResolvedValue({ title: "Stock", sheets: stockList([["MAT-001", "Oak veneer", "sqm", "10", "", ""]]), rowCounts: {} });
      await expect(service.apply(actor, w.workspaceId, { target: "stock", source: "google_sheet", name: "Stock", locationId: w.warehouse, mapping: STOCK_MAPPING,
        connectionId: w.connectionId, spreadsheetId: "x".repeat(44), schedule: "weekly", runId: randomUUID() })).rejects.toThrow(/how often/);
      const linked = await w.as(w.clerk).apply(actor, w.workspaceId, { target: "stock", source: "google_sheet", name: "Stock", locationId: w.warehouse, mapping: STOCK_MAPPING,
        connectionId: w.connectionId, spreadsheetId: "x".repeat(44), runId: randomUUID() });
      expect(linked.link).toMatchObject({ schedule: "hourly", ownerId: w.clerk });
      expect(w.sheets.read).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: w.workspaceId, connectionId: w.connectionId, spreadsheetId: "x".repeat(44), sheetName: null }));
      // Nothing is due within the hour.
      expect(await service.runDue()).toMatchObject({ links: 0 });

      await w.client.query(`UPDATE import_links SET next_run_at = now() - interval '1 minute' WHERE id = $1`, [linked.link.id]);
      w.sheets.read.mockResolvedValue({ title: "Stock", sheets: stockList([["MAT-001", "Oak veneer", "sqm", "14", "", ""]]), rowCounts: {} });
      expect(await service.runDue()).toMatchObject({ links: 1, failed: 0 });
      expect(await free(w, "MAT-001", w.warehouse)).toBe("14.0000");
      const run = (await w.client.query(`SELECT trigger, started_by AS "startedBy", status FROM import_runs WHERE link_id = $1 ORDER BY started_at DESC, trigger DESC LIMIT 1`, [linked.link.id])).rows[0];
      expect(run).toEqual({ trigger: "schedule", startedBy: null, status: "applied" });
      const actorOf = (await w.client.query(`SELECT actor_id AS "actorId" FROM stock_movements WHERE workspace_id = $1 ORDER BY seq DESC LIMIT 1`, [w.workspaceId])).rows[0];
      expect(actorOf.actorId).toBe(w.clerk);

      w.sheets.read.mockRejectedValue(new SheetSourceError("Wodana can't open this sheet any more."));
      for (let attempt = 0; attempt < 2; attempt++) {
        await w.client.query(`UPDATE import_links SET next_run_at = now() - interval '1 minute' WHERE id = $1`, [linked.link.id]);
        expect(await service.runDue()).toMatchObject({ links: 1, failed: 1 });
      }
      const notices = (await w.client.query(`SELECT recipient_id AS "to", channel, subject, body FROM notifications WHERE workspace_id = $1 AND event_type = 'linked_import.failed' ORDER BY channel`,
        [w.workspaceId])).rows;
      expect(notices).toEqual([
        { to: w.clerk, channel: "email", subject: "Stock didn't refresh", body: "Wodana can't open this sheet any more.\n\nOpen the import to check the link." },
        { to: w.clerk, channel: "in_app", subject: "Stock didn't refresh", body: "Wodana can't open this sheet any more." },
      ]);
      const detail = await service.detail(actor, w.workspaceId, linked.link.id);
      expect(detail.runs[0]).toMatchObject({ status: "failed", message: "Wodana can't open this sheet any more." });

      // Stop linking: the schedule stops.
      await service.settings(actor, w.workspaceId, linked.link.id, { version: detail.link.version, archive: true });
      await w.client.query(`UPDATE import_links SET next_run_at = now() - interval '1 minute' WHERE id = $1`, [linked.link.id]);
      expect(await service.runDue()).toMatchObject({ links: 0 });
    });
  });
  it("imports a supplier list through the supplier register's checks, by name, and flags suppliers that leave it", async () => {
    await world(async (w) => {
      await w.client.query(`UPDATE workspaces SET default_locale = 'en-AE' WHERE id = $1`, [w.workspaceId]);
      const service = w.as(w.owner);
      const suppliers = new SuppliersService({ withPermission: (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(w.client, { userId: w.owner }),
        hasPermission: async () => true } as never);
      // Already in the register: matched by its name, its tax number kept.
      await suppliers.save(actor, w.workspaceId, { id: randomUUID(), name: "Nile Marble & Granite", taxRegistrationNumber: "100111222300003", categories: ["Marble"] });
      const factory = randomUUID();
      await w.client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone) VALUES($1,$2,'FAC','Factory','Studio Furniture LLC','AE','AED','en-AE','Asia/Dubai')`,
        [factory, w.workspaceId]);
      const first = supplierList([
        ["SIOM Marble", "Ramiz", "052 846 6806", "sales@siom.ae", "100 1234 5670 0003", "50/50", "Marble, Stone", "Approved"],
        ["Nile Marble & Granite", "Mohamed", "+971 50 765 4321", "", "", "SOA end of month", "Granite", ""],
        ["Bad TRN Trading", "", "", "", "12345", "", "", ""],
        ["Copy Cat LLC", "", "", "", "100-1112-2230-0003", "", "", ""],
        ["SIOM Marble", "", "", "", "", "", "", ""],
      ]);
      const draft = { target: "suppliers", source: "upload", name: "Factory suppliers", legalEntityId: factory, mapping: SUPPLIER_MAPPING, sheets: first };
      const preview = await service.preview(actor, w.workspaceId, draft);
      expect(preview.summary).toEqual({ added: 1, changed: 1, unchanged: 1, errors: 2, missing: 0 });
      // A supplier on two rows is one supplier.
      expect(preview.rows.map((row) => [row.key, row.outcome, row.message])).toEqual([
        ["Bad TRN Trading", "error", "TRN should look like 100123456700003."],
        ["Copy Cat LLC", "error", "Another supplier has this tax number."],
        ["SIOM Marble", "added", ""],
        ["Nile Marble & Granite", "changed", ""],
        ["SIOM Marble", "unchanged", "Same supplier as Suppliers row 2."],
      ]);
      const linked = await service.apply(actor, w.workspaceId, { ...draft, runId: randomUUID(), expectedFingerprint: preview.fingerprint });
      expect(linked.runs[0]).toMatchObject({ status: "partial", added: 1, changed: 1, errors: 2 });
      expect(linked.link).toMatchObject({ target: "suppliers", legalEntityId: factory, legalEntityName: "Factory" });
      const state = await suppliers.list(actor, w.workspaceId);
      const siom = state.suppliers.find((item) => item.name === "SIOM Marble")!;
      // The phone in the region's international form, the TRN normalised, the terms read from words, the extra column kept.
      expect(siom).toMatchObject({ code: "SIOM-MARBLE", contactName: "Ramiz", phone: "+971528466806", email: "sales@siom.ae", taxRegistrationNumber: "100123456700003",
        paymentTerms: "split", advancePercent: "50.00", categories: ["Marble", "Stone"], entityIds: [factory], attributes: [{ name: "Directors Approved", value: "Approved" }] });
      const nile = state.suppliers.find((item) => item.name === "Nile Marble & Granite")!;
      expect(nile).toMatchObject({ taxRegistrationNumber: "100111222300003", phone: "+971507654321", paymentTerms: "statement", categories: ["Marble", "Granite"], entityIds: [factory] });
      expect(state.suppliers.some((item) => item.name === "Bad TRN Trading" || item.name === "Copy Cat LLC")).toBe(false);
      const audit = (await w.client.query<{ action: string }>(`SELECT action FROM audit_events WHERE workspace_id = $1`, [w.workspaceId])).rows.map((row) => row.action);
      expect(audit).toEqual(expect.arrayContaining(["linked_import.linked", "linked_import.partial", "supplier.created", "supplier.changed", "supplier.attributes_changed"]));

      // The same list again changes nothing; a supplier that leaves it is flagged, never removed.
      const again = await service.refresh(actor, w.workspaceId, linked.link.id, { runId: randomUUID(), sheets: first });
      expect(again.runs[0]).toMatchObject({ added: 0, changed: 0, unchanged: 3, errors: 2 });
      const later = await service.refresh(actor, w.workspaceId, linked.link.id, { runId: randomUUID(), sheets: supplierList([first[0].rows[1]]) });
      expect(later.runs[0]).toMatchObject({ unchanged: 1, missing: 1 });
      expect(later.rows).toEqual(expect.arrayContaining([expect.objectContaining({ key: "Nile Marble & Granite", outcome: "missing" })]));
      expect((await suppliers.list(actor, w.workspaceId)).suppliers.filter((item) => item.status !== "archived")).toHaveLength(2);

      // A second list is its own source.
      const second = await service.apply(actor, w.workspaceId, { target: "suppliers", source: "upload", name: "Showroom suppliers", runId: randomUUID(),
        mapping: { columns: { Code: "code", Name: "name" } }, sheets: [{ name: "Sheet1", rows: [["Code", "Name"], ["sup-9", "Gulf Lighting"]] }] });
      expect(second.runs[0]).toMatchObject({ added: 1 });
      expect((await suppliers.list(actor, w.workspaceId)).suppliers.find((item) => item.name === "Gulf Lighting")).toMatchObject({ code: "SUP-9" });
      expect((await service.overview(actor, w.workspaceId, { target: "suppliers" })).links.map((link) => link.name).sort()).toEqual(["Factory suppliers", "Showroom suppliers"]);
    });
  });

  it("imports one company's supplier list per tab: a supplier on two tabs buys for both; a shared phone is left out; only filling in keeps what's known", async () => {
    await world(async (w) => {
      await w.client.query(`UPDATE workspaces SET default_locale = 'en-AE' WHERE id = $1`, [w.workspaceId]);
      const [factory, interiors] = [randomUUID(), randomUUID()];
      for (const [id, code] of [[factory, "FAC"], [interiors, "INT"]])
        await w.client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone) VALUES($1,$2,$3,$3,$3,'AE','AED','en-AE','Asia/Dubai')`, [id, w.workspaceId, code]);
      const service = w.as(w.owner);
      const heading = ["Supplier Type", "Company Name", "Contact Person / Number", "Email"];
      const sheets: SourceSheet[] = [
        { name: "Factory", rows: [heading, ["Factory suppliers"], ["MARBLE"], ["Marble", "Stone Co", "Ramiz - +971 52 846 6806", ""], ["Paint", "Paint Co", "Sara - 050 111 2222", "x@paint.example"]] },
        { name: "Interiors", rows: [heading, ["Lighting", "Stone Co", "", "hello@stone.example"], ["Lighting", "Lamp Co", "+971 52 846 6806", ""]] },
        { name: "Spend", rows: [["Company Name", "Jan"], ["Stone Co", "100"]] },
      ];
      const mapping = { columns: { "Supplier Type": "categories", "Company Name": "name", "Contact Person / Number": "contact", Email: "email" }, entities: { Factory: factory, Interiors: interiors } };
      const draft = { target: "suppliers", source: "upload", name: "Suppliers", mapping, sheets };
      const preview = await service.preview(actor, w.workspaceId, draft);
      expect(preview.summary).toEqual({ added: 3, changed: 0, unchanged: 1, errors: 0, missing: 0 });
      expect(preview.skippedTabs).toEqual(["Spend"]);
      expect(preview.rows.find((row) => row.key === "Lamp Co")?.message).toBe("Another supplier has the phone +971528466806, so it wasn't imported.");
      await service.apply(actor, w.workspaceId, { ...draft, runId: randomUUID(), expectedFingerprint: preview.fingerprint });
      const suppliers = new SuppliersService({ withPermission: (_a: unknown, _w: string, _p: unknown, fn: (c: PoolClient, u: { userId: string }) => unknown) => fn(w.client, { userId: w.owner }),
        hasPermission: async () => true } as never);
      const stone = (await suppliers.list(actor, w.workspaceId)).suppliers.find((item) => item.name === "Stone Co")!;
      expect(stone).toMatchObject({ contactName: "Ramiz", phone: "+971528466806", email: "hello@stone.example", categories: ["Marble", "Lighting"] });
      expect([...stone.entityIds].sort()).toEqual([factory, interiors].sort());

      // A second list only fills in: a known supplier's contact stays; what it's missing is added.
      const chain = await service.preview(actor, w.workspaceId, { target: "suppliers", source: "upload", name: "Chain", mapping: { columns: { "Company Name": "name", "Contact Person": "contactName", Location: "address" }, fillOnly: true },
        sheets: [{ name: "Chain", rows: [["Company Name", "Contact Person", "Location"], ["stone co.", "Someone else", "Al Quoz"]] }] });
      expect(chain.rows).toEqual([expect.objectContaining({ key: "stone co.", outcome: "changed", changes: ["Address"] })]);
    });
  });

  it("reads a business's letterhead: legal name, licence, tax number, address, contact and footer", async () => {
    await world(async (w) => {
      const entity = randomUUID();
      await w.client.query(`INSERT INTO legal_entities(id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone,tax_registration_number,registration_number,address,phone,email,letterhead_footer)
        VALUES($1,$2,'PLI','Palm','Studio Interiors LLC','AE','AED','en-AE','Asia/Dubai','100123456700003','TL-55','{"line1":"Office 4","city":"Dubai"}','+97141234567','hello@studio.example','Registered in Dubai')`,
        [entity, w.workspaceId]);
      expect(await readLetterhead(w.client, w.workspaceId, entity)).toMatchObject({ legalName: "Studio Interiors LLC", taxLabel: "TRN", taxNumber: "100123456700003", licenceNumber: "TL-55",
        address: "Office 4, Dubai", phone: "+97141234567", email: "hello@studio.example", footer: "Registered in Dubai", logoUrl: null, headerUrl: null });
      expect(await readLetterhead(w.client, w.workspaceId, randomUUID())).toBeNull();
    });
  });
});
