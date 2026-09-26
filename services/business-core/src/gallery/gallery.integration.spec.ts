import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GalleryService } from "./gallery.service";

const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const actor = { subject: "t", provider: "local", email: "t@example.com", displayName: "T" } as never;

integration("company gallery", () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: databaseUrl }); });
  afterAll(() => pool.end());

  it("is created from the workspace, holds items and catalog products, publishes only with a live form, and is read by its link", async () => {
    const client = await pool.connect();
    const ws = randomUUID(), user = randomUUID(), catalog = randomUUID(), item = randomUUID(), form = randomUUID(), book = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,'Owner')", [user, `${user.slice(0, 8)}@example.com`]);
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [ws]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,default_timezone,created_by) VALUES($1,'Palm Studio',$2,'AED','Asia/Dubai',$3)", [ws, `palm-${ws.slice(0, 6)}`, user]);
      await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [randomUUID(), ws, user]);
      await client.query("INSERT INTO catalogs(id,workspace_id,code,name) VALUES($1,$2,'core','Core')", [catalog, ws]);
      await client.query("INSERT INTO catalog_items(id,workspace_id,catalog_id,code,name,item_type,unit_code,description) VALUES($1,$2,$3,'WRD','Wardrobe','assembly','nos','Hinged')", [item, ws, catalog]);
      await client.query("INSERT INTO price_books(id,workspace_id,catalog_id,name,currency,status) VALUES($1,$2,$3,'Retail','AED','active')", [book, ws, catalog]);
      await client.query("INSERT INTO price_entries(workspace_id,price_book_id,item_id,method,price,status) VALUES($1,$2,$3,'fixed',7200,'active')", [ws, book, item]);
      await client.query("INSERT INTO crm_lead_forms(id,workspace_id,token,draft,status,created_by) VALUES($1,$2,$3,'{}','draft',$4)", [form, ws, "t".repeat(32), user]);
      await client.query("SET LOCAL session_replication_role = origin");
      const run = (_a: unknown, _w: string, ...rest: unknown[]) => (rest[rest.length - 1] as (c: PoolClient, u: { userId: string }) => unknown)(client, { userId: user });
      const database = { query: (text: string, values: unknown[]) => client.query(text, values), tenantTransaction: (_w: string, _a: string, work: (c: PoolClient) => unknown) => work(client) };
      const forms = { publicForm: async () => ({ title: "Enquiry", questions: [] }), submit: async (_token: string, input: unknown) => ({ received: true, input }) };
      const service = new GalleryService({ asMember: run, withPermission: run, withAnyPermission: run, hasPermission: async () => true } as never, database as never, {} as never, forms as never);

      const first = await service.get(actor, ws);
      expect(first.settings).toMatchObject({ slug: `palm-${ws.slice(0, 6)}`, status: "draft", headline: "Palm Studio", leadFormId: null });
      const service1 = randomUUID();
      await service.saveItem(actor, ws, { id: service1, kind: "service", title: "Full home interiors", body: "Design to handover", priceFrom: "150000", priceUnit: "per villa" });
      await service.saveItem(actor, ws, { id: randomUUID(), kind: "testimonial", title: "Maya R.", subtitle: "Jumeirah villa", body: "They made it easy.", rating: 5 });
      await expect(service.saveItem(actor, ws, { id: randomUUID(), kind: "brochure", title: "X" })).rejects.toThrow(/service, product/);
      const imported = await service.importCatalog(actor, ws, { itemIds: [item] });
      expect(imported.added).toBe(1);
      expect(imported.items.find((row) => row.kind === "product")).toMatchObject({ title: "Wardrobe", priceFrom: "7200.00", priceUnit: "nos", catalogItemId: item });
      expect((await service.importCatalog(actor, ws, { itemIds: [item] })).added).toBe(0);

      // The public link doesn't work until the gallery is published, and publishing needs a live enquiry form.
      await expect(service.publicGallery(first.settings.slug)).rejects.toThrow(/not found/);
      let settings = await service.saveSettings(actor, ws, { version: first.settings.version, leadFormId: form, headline: "Homes made calm", slug: "palm-studio-gallery" });
      await expect(service.saveSettings(actor, ws, { version: settings.version, status: "published" })).rejects.toThrow(/Publish that enquiry form/);
      await client.query("UPDATE crm_lead_forms SET status = 'published', published = '{}' WHERE id = $1", [form]);
      settings = await service.saveSettings(actor, ws, { version: settings.version, status: "published", showPrices: true });
      expect(settings).toMatchObject({ status: "published", slug: "palm-studio-gallery" });
      const page = await service.publicGallery("palm-studio-gallery");
      expect(page.settings).toMatchObject({ headline: "Homes made calm", showPrices: true });
      expect(page.settings).not.toHaveProperty("leadFormId");
      expect(page.items.map((row) => row.kind).sort()).toEqual(["product", "service", "testimonial"]);
      expect(page.form).toMatchObject({ title: "Enquiry" });

      // A visitor's list goes through the firm's form, with the picked items' names.
      const sent = await service.publicEnquiry("palm-studio-gallery", { requestId: randomUUID(), revision: "r", answers: {}, serviceConsent: true, selection: [service1] }) as unknown as { input: { selection: string[]; link: { placement: string } } };
      expect(sent.input.selection).toEqual(["Full home interiors"]);
      expect(sent.input.link.placement).toBe("gallery");

      // Switching off "My list" closes enquiries from the gallery.
      settings = await service.saveSettings(actor, ws, { version: settings.version, display: { list: false, search: false } });
      expect(settings.display).toMatchObject({ list: false, search: false, descriptions: true });
      expect((await service.publicGallery("palm-studio-gallery")).form).toBeNull();
      await expect(service.publicEnquiry("palm-studio-gallery", { requestId: randomUUID(), revision: "r", answers: {}, serviceConsent: true })).rejects.toThrow(/isn't taking enquiries/);
      await expect(service.saveSettings(actor, ws, { version: settings.version, display: { list: "yes" } })).rejects.toThrow(/yes or no/);

      await service.saveSettings(actor, ws, { version: settings.version, status: "draft" });
      await expect(service.publicGallery("palm-studio-gallery")).rejects.toThrow(/not found/);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
