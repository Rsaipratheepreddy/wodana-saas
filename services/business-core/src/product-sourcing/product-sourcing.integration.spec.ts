import { ForbiddenException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CatalogV2Service } from "../catalog-core/catalog-v2.service";
import { FitCheckService } from "./fit-check.service";
import { orderFitProblem } from "./fit-check.store";
import { LinkPreviewService } from "./link-preview.service";
import { ProductClipService } from "./product-clip.service";
import type { SafeFetchOptions } from "./safe-fetch";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Every service call runs as the
// app role (wodana_app, forced RLS) in its own committed transaction, so replays, stale versions and tenants are real.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration("product sourcing (plan §6.7a batch 3) on a real database", { timeout: 60_000 }, () => {
  let pool: Pool;
  let png: Buffer;
  const workspaces: string[] = [];
  const objects = new Map<string, Buffer>();
  const storage = { put: async (key: string, body: Buffer) => { objects.set(key, body); }, read: async (key: string) => { const body = objects.get(key); if (!body) throw new Error("missing"); return { body }; } };
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString(), max: 8 });
    png = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 120, g: 140, b: 110 } } }).png().toBuffer();
    process.env.AI_PROVIDER = "bedrock";
  });
  afterAll(async () => {
    for (const id of workspaces) await pool.query("DELETE FROM workspaces WHERE id = $1", [id]).catch(() => undefined);
    await pool.end();
    delete process.env.AI_PROVIDER;
  });

  async function asApp<T>(workspaceId: string, actorId: string, work: (client: PoolClient) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE wodana_app");
      await client.query("SELECT set_config('app.current_workspace_id', $1, true), set_config('app.current_actor_id', $2, true)", [workspaceId, actorId]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async function seed(unitSystem: "metric" | "imperial" = "metric") {
    const workspaceId = randomUUID(), userId = randomUUID(), approver = randomUUID(), caseId = randomUUID(), projectId = randomUUID(), vendorId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      for (const [id, name] of [[userId, "Dana Designer"], [approver, "Omar Approver"]]) await client.query("INSERT INTO users(id, primary_email, display_name) VALUES ($1, $2, $3)", [id, `${id}@example.com`, name]);
      await client.query("INSERT INTO workspaces(id, name, slug, default_currency, unit_system, created_by) VALUES ($1, 'Studio', $2, 'GBP', $4, $3)", [workspaceId, `ps-${workspaceId.slice(0, 8)}`, userId, unitSystem]);
      await client.query("INSERT INTO pre_project_cases(id, workspace_id, opportunity_id, created_by) VALUES ($1, $2, $3, $4)", [caseId, workspaceId, randomUUID(), userId]);
      await client.query("INSERT INTO delivery_projects(id, workspace_id, case_id, name, created_by) VALUES ($1, $2, $3, 'Villa', $4)", [projectId, workspaceId, caseId, userId]);
      await client.query("INSERT INTO workspace_vendors(workspace_id, id, code, display_name, created_by, updated_by) VALUES ($1, $2, 'NORDLI', 'Nordli Furniture', $3, $3)", [workspaceId, vendorId, userId]);
      await client.query(`INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
        VALUES ($1, 'sourcing.fit_override', 'in_app', 'en', 1, 'approved', 'Fit check overridden · {{item}}', '{{actor}}: {{reason}}', '["item","clientName","actor","reason"]', now())`, [workspaceId]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    workspaces.push(workspaceId);
    return { workspaceId, userId, approver, caseId, projectId, vendorId };
  }

  function services(userId: string, permissions: string[]) {
    const granted = new Set(permissions);
    const run = async (workspaceId: string, required: string[], any: boolean, work: (client: PoolClient, user: { userId: string }) => Promise<unknown>) => {
      if (any ? !required.some((code) => granted.has(code)) : !required.every((code) => granted.has(code))) throw new ForbiddenException(`Permissions required: ${required.join(", ")}`);
      return asApp(workspaceId, userId, (client) => work(client, { userId }));
    };
    const access = {
      withPermission: (_a: unknown, w: string, p: string, work: never) => run(w, [p], false, work),
      withAnyPermission: (_a: unknown, w: string, p: string[], work: never) => run(w, p, true, work),
      hasPermission: async (_c: unknown, _w: string, _u: string, code: string) => granted.has(code),
    } as never;
    const ai = { configured: true, run: async (_a: unknown, _w: string, call: { feature: string; validate: (value: unknown) => unknown }) => {
      if (!granted.has("ai.suggestions.use")) throw new ForbiddenException("AI not allowed");
      return call.validate({ fields: { finish: { value: "Matt lacquer", confidence: 0.85, evidence: "Finish: matt lacquer" }, lead_time_days: { value: "42", confidence: 0.99, evidence: "Lead time 6 weeks" } } });
    } } as never;
    const catalogs = new CatalogV2Service(access, ai);
    const pages: Record<string, { body: Buffer; contentType: string }> = {
      "https://shop.example.com/halden": { contentType: "text/html; charset=utf-8", body: Buffer.from(`<html><head><title>Halden</title>
        <script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "Halden 3-seat sofa", sku: "HAL-3", brand: "Nordli", image: "https://cdn.example.com/halden.png",
          width: { value: 228, unitCode: "CMT" }, depth: { value: 95, unitCode: "CMT" }, height: { value: 82, unitCode: "CMT" }, offers: { price: "2450.00", priceCurrency: "GBP" } })}</script>
        </head><body><p>Finish: matt lacquer. Lead time 6 weeks.</p></body></html>`) },
      "https://cdn.example.com/halden.png": { contentType: "image/png", body: png },
      "https://www.canva.com/design/DAFmood01/view": { contentType: "text/html", body: Buffer.from(`<html><head><meta property="og:title" content="Living room moodboard"><meta property="og:image" content="https://cdn.example.com/halden.png"></head></html>`) },
    };
    const fetcher = async (url: string, _options: SafeFetchOptions) => { const found = pages[url]; if (!found) throw new Error("offline"); return { finalUrl: url, status: 200, ...found }; };
    return {
      clips: new ProductClipService(access, ai, storage as never, catalogs).useFetcher(fetcher),
      previews: new LinkPreviewService(access, storage as never).useFetcher(fetcher),
      fits: new FitCheckService(access),
      catalogs,
    };
  }
  const actor = {} as never;
  const MANAGER = ["catalog.view", "catalog.manage", "ai.suggestions.use", "supplier_offers.view", "pre_projects.view", "pre_projects.edit", "purchasing.manage"];

  it("clips a product page into a catalog item with provenance; replays, stale saves, permissions and tenants", async () => {
    const ws = await seed();
    const svc = services(ws.userId, MANAGER);
    const catalog = await svc.catalogs.createCatalog(actor, ws.workspaceId, { name: "Furniture" });
    const clipId = randomUUID();
    const read = await svc.clips.read(actor, ws.workspaceId, { clipId, catalogId: catalog.id, url: "https://shop.example.com/halden" });
    expect(read.aiStatus).toBe("used");
    expect(read.aiModel).toBeTruthy();
    const proposed = Object.fromEntries(read.fields.map((field) => [field.field, [field.proposedValue, field.source]]));
    expect(proposed).toMatchObject({ name: ["Halden 3-seat sofa", "structured_data"], width: ["228", "structured_data"], price: ["2450", "structured_data"], finish: ["Matt lacquer", "ai"], lead_time_days: ["42", "page_text"] });
    expect(read.fields.find((field) => field.field === "finish")).toMatchObject({ confidence: 0.85, evidence: "Finish: matt lacquer" });
    expect(read.images).toHaveLength(1);
    expect(read.defaults).toEqual({ unit: "cm", currency: "GBP" });

    // The same read again returns it; another link with the same id is refused.
    expect((await svc.clips.read(actor, ws.workspaceId, { clipId, catalogId: catalog.id, url: "https://shop.example.com/halden" })).id).toBe(clipId);
    await expect(svc.clips.read(actor, ws.workspaceId, { clipId, catalogId: catalog.id, url: "https://shop.example.com/other" })).rejects.toThrow(/another link/);
    // Private addresses are refused before any fetch.
    await expect(svc.clips.read(actor, ws.workspaceId, { clipId: randomUUID(), catalogId: catalog.id, url: "http://169.254.169.254/latest" })).rejects.toThrow(/public internet/);

    // Someone without catalog.manage can't read or save.
    const viewer = services(ws.userId, ["catalog.view"]);
    await expect(viewer.clips.read(actor, ws.workspaceId, { clipId: randomUUID(), catalogId: catalog.id, url: "https://shop.example.com/halden" })).rejects.toBeInstanceOf(ForbiddenException);

    const values = { ...Object.fromEntries(read.fields.map((field) => [field.field, field.proposedValue])), name: "Halden sofa", colour: "Moss", description: null };
    const input = { version: read.version, code: "HAL-3", itemType: "product" as const, unitCode: "pcs", values, imageIds: read.images.map((image) => image.id), vendorId: ws.vendorId };
    await expect(viewer.clips.save(actor, ws.workspaceId, clipId, input)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.clips.save(actor, ws.workspaceId, clipId, { ...input, version: read.version + 1 })).rejects.toThrow(/changed/);
    const saved = await svc.clips.save(actor, ws.workspaceId, clipId, input);
    expect(saved.status).toBe("saved");
    const decisions = Object.fromEntries(saved.fields.map((field) => [field.field, field.decision]));
    expect(decisions).toMatchObject({ name: "edited", width: "accepted", finish: "accepted", colour: "added" });
    expect(saved.fields.find((field) => field.field === "name")).toMatchObject({ finalValue: "Halden sofa", confirmedBy: ws.userId, confirmedByName: "Dana Designer" });
    // A replayed save returns the same item; nothing is created twice.
    const again = await svc.clips.save(actor, ws.workspaceId, clipId, input);
    expect(again.itemId).toBe(saved.itemId);
    await expect(svc.clips.save(actor, ws.workspaceId, clipId, { ...input, version: saved.version })).rejects.toThrow(/already in the catalog/);

    const rows = await asApp(ws.workspaceId, ws.userId, async (client) => ({
      items: (await client.query(`SELECT name, description FROM catalog_items WHERE workspace_id = $1`, [ws.workspaceId])).rows,
      size: (await client.query(`SELECT width::text, depth::text, height::text, unit, source FROM catalog_item_dimensions WHERE workspace_id = $1`, [ws.workspaceId])).rows,
      images: (await client.query(`SELECT count(*)::int AS n FROM catalog_item_images WHERE workspace_id = $1`, [ws.workspaceId])).rows[0].n,
      link: (await client.query(`SELECT cost::text, currency, lead_time_days, product_url FROM catalog_supplier_links WHERE workspace_id = $1`, [ws.workspaceId])).rows,
      audit: (await client.query(`SELECT action FROM audit_events WHERE workspace_id = $1 AND entity_type = 'product_clip' ORDER BY occurred_at`, [ws.workspaceId])).rows.map((row) => row.action),
    }));
    expect(rows.items).toEqual([{ name: "Halden sofa", description: "Brand: Nordli\nFinish: Matt lacquer\nColour: Moss" }]);
    expect(rows.size).toEqual([{ width: "228.00", depth: "95.00", height: "82.00", unit: "cm", source: "clipper" }]);
    expect(rows.images).toBe(1);
    expect(rows.link).toEqual([{ cost: "2450.000000", currency: "GBP", lead_time_days: 42, product_url: "https://shop.example.com/halden" }]);
    expect(rows.audit).toEqual(["catalog.product_clip_read.v1", "catalog.product_clip_saved.v1"]);
    const source = await svc.clips.itemSource(actor, ws.workspaceId, saved.itemId!);
    expect(source.source?.finalUrl).toBe("https://shop.example.com/halden");
    expect(source.size).toMatchObject({ width: "228.00", unit: "cm" });

    // Another workspace sees none of it (forced RLS), even with the ids.
    const other = await seed();
    const outsider = services(other.userId, MANAGER);
    await expect(outsider.clips.get(actor, other.workspaceId, clipId)).rejects.toThrow(/not read yet/);
    const leaked = await asApp(other.workspaceId, other.userId, async (client) => (await client.query(`SELECT count(*)::int AS n FROM product_clips WHERE id = $1`, [clipId])).rows[0].n);
    expect(leaked).toBe(0);
    await expect(asApp(other.workspaceId, other.userId, (client) => client.query(
      `INSERT INTO product_clips (id, workspace_id, catalog_id, source_url, final_url, host, ai_status, fetched_at, created_by) VALUES ($1, $2, $3, 'https://a.example.com', 'https://a.example.com', 'a.example.com', 'off', now(), $4)`,
      [randomUUID(), ws.workspaceId, catalog.id, other.userId]))).rejects.toThrow(/row-level security/);
  });

  it("keeps a Canva link card with its thumbnail copied into storage", async () => {
    const ws = await seed();
    const svc = services(ws.userId, MANAGER);
    const card = await svc.previews.preview(actor, ws.workspaceId, "https://www.canva.com/design/DAFmood01/view");
    expect(card).toMatchObject({ provider: "canva", title: "Living room moodboard", hasImage: true, status: "ok", host: "www.canva.com" });
    expect((await svc.previews.image(actor, ws.workspaceId, card.id)).contentType).toBe("image/webp");
    expect((await svc.previews.preview(actor, ws.workspaceId, "https://www.canva.com/design/DAFmood01/view")).id).toBe(card.id);
    const unreadable = await svc.previews.preview(actor, ws.workspaceId, "https://www.canva.com/design/DAFgone/view");
    expect(unreadable).toMatchObject({ status: "unavailable", hasImage: false, title: null });
    await expect(svc.previews.preview(actor, ws.workspaceId, "http://www.canva.com/design/x")).rejects.toThrow(/https/);
    await expect(services(ws.userId, ["purchasing.view"]).previews.preview(actor, ws.workspaceId, "https://www.canva.com/design/DAFmood01/view")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("fit check: access points, a failing item, a stale and a valid override, and the ordering block", async () => {
    const ws = await seed();
    const svc = services(ws.userId, MANAGER);
    const catalog = await svc.catalogs.createCatalog(actor, ws.workspaceId, { name: "Loose furniture" });
    const sofa = await svc.catalogs.createItem(actor, ws.workspaceId, catalog.id, { code: "SOFA", name: "Halden sofa", itemType: "product", unitCode: "pcs" });
    const lamp = await svc.catalogs.createItem(actor, ws.workspaceId, catalog.id, { code: "LAMP", name: "Lamp", itemType: "product", unitCode: "pcs" });
    await svc.clips.saveDimensions(actor, ws.workspaceId, sofa.id, { version: 0, width: "228", depth: "95", height: "82", unit: "cm" });
    await expect(svc.clips.saveDimensions(actor, ws.workspaceId, sofa.id, { version: 0, width: "228", depth: "95", height: "82", unit: "cm" })).rejects.toThrow(/changed/);

    // No access points yet: unknown, a warning only.
    expect((await svc.fits.check(actor, ws.workspaceId, ws.caseId, [sofa.id])).items[0]).toMatchObject({ result: { status: "unknown", reason: "no_access_points" }, blocksOrdering: false });

    const doorId = randomUUID();
    const door = { version: 0, route: "Main", position: 0, kind: "door", label: "Apartment door", width: "31.5", height: "80", unit: "in" };
    const created = await svc.fits.saveAccessPoint(actor, ws.workspaceId, ws.caseId, doorId, door);
    expect(created).toMatchObject({ label: "Apartment door", width: "31.50", version: 1 });
    expect((await svc.fits.saveAccessPoint(actor, ws.workspaceId, ws.caseId, doorId, door)).version).toBe(1); // replayed create
    await expect(svc.fits.saveAccessPoint(actor, ws.workspaceId, ws.caseId, doorId, { ...door, version: 5 })).rejects.toThrow(/Someone changed/);
    await expect(services(ws.userId, ["pre_projects.view"]).fits.saveAccessPoint(actor, ws.workspaceId, ws.caseId, randomUUID(), door)).rejects.toBeInstanceOf(ForbiddenException);

    const [failing, small] = (await svc.fits.check(actor, ws.workspaceId, ws.caseId, [sofa.id, lamp.id])).items;
    expect(failing).toMatchObject({ itemId: sofa.id, result: { status: "does_not_fit" }, blocksOrdering: true, override: null });
    expect(small).toMatchObject({ itemId: lamp.id, result: { status: "unknown", reason: "item_size_missing" }, blocksOrdering: false });

    // Ordering is blocked while it fails.
    const orderId = randomUUID(), materialId = randomUUID();
    const raw = await pool.connect();
    try {
      await raw.query("BEGIN"); await raw.query("SET LOCAL session_replication_role = replica");
      await raw.query("INSERT INTO project_material_items (id, workspace_id, project_id, catalog_item_id, name) VALUES ($1, $2, $3, $4, 'Halden sofa')", [materialId, ws.workspaceId, ws.projectId, sofa.id]);
      await raw.query("INSERT INTO purchase_order_lines (id, workspace_id, order_id, project_id, source, material_item_id, description, quantity, unit_price, net, tax, total) VALUES ($1, $2, $3, $4, 'material', $5, 'Halden sofa', 1, 2450, 2450, 0, 2450)",
        [randomUUID(), ws.workspaceId, orderId, ws.projectId, materialId]);
      await raw.query("COMMIT");
    } finally { raw.release(); }
    expect(await asApp(ws.workspaceId, ws.userId, (client) => orderFitProblem(client, ws.workspaceId, orderId))).toMatch(/Halden sofa doesn't fit/);

    // An override needs the inputs the person saw; a reason; the right permission.
    await expect(svc.fits.override(actor, ws.workspaceId, ws.caseId, { id: randomUUID(), itemId: sofa.id, inputsHash: "0".repeat(64), reason: "Comes in parts", context: "ordering" })).rejects.toThrow(/changed/);
    await expect(services(ws.userId, ["pre_projects.view"]).fits.override(actor, ws.workspaceId, ws.caseId, { id: randomUUID(), itemId: sofa.id, inputsHash: failing.inputsHash, reason: "x y z", context: "ordering" })).rejects.toBeInstanceOf(ForbiddenException);
    const overrideId = randomUUID();
    const decided = await svc.fits.override(actor, ws.workspaceId, ws.caseId, { id: overrideId, itemId: sofa.id, inputsHash: failing.inputsHash, reason: "Arms come off; supplier confirmed", context: "ordering" });
    expect(decided).toMatchObject({ blocksOrdering: false, override: { id: overrideId, reason: "Arms come off; supplier confirmed", overriddenByName: "Dana Designer" } });
    expect((await svc.fits.override(actor, ws.workspaceId, ws.caseId, { id: overrideId, itemId: sofa.id, inputsHash: failing.inputsHash, reason: "Arms come off; supplier confirmed", context: "ordering" })).override?.id).toBe(overrideId);
    expect(await asApp(ws.workspaceId, ws.userId, (client) => orderFitProblem(client, ws.workspaceId, orderId))).toBeNull();
    const audit = await asApp(ws.workspaceId, ws.userId, async (client) => (await client.query(`SELECT action FROM audit_events WHERE workspace_id = $1 AND action LIKE 'sourcing.%'`, [ws.workspaceId])).rows.map((row) => row.action));
    expect(audit).toEqual(["sourcing.fit_overridden.v1"]);

    // A re-measured door is new input: the override no longer applies.
    await svc.fits.saveAccessPoint(actor, ws.workspaceId, ws.caseId, doorId, { ...door, version: 1, width: "31" });
    expect((await svc.fits.check(actor, ws.workspaceId, ws.caseId, [sofa.id])).items[0]).toMatchObject({ blocksOrdering: true, override: null });
    // A second route that works (a wide service door) lets it through without an override.
    await svc.fits.saveAccessPoint(actor, ws.workspaceId, ws.caseId, randomUUID(), { version: 0, route: "Service", position: 0, kind: "door", label: "Service door", width: "120", height: "220", unit: "cm" });
    expect((await svc.fits.check(actor, ws.workspaceId, ws.caseId, [sofa.id])).items[0]).toMatchObject({ result: { status: "fits" }, blocksOrdering: false });
    await svc.fits.archiveAccessPoint(actor, ws.workspaceId, ws.caseId, doorId, 2);
    expect((await svc.fits.accessPoints(actor, ws.workspaceId, ws.caseId)).points.map((point) => point.label)).toEqual(["Service door"]);

    // Another tenant can't read this case's access points.
    const other = await seed();
    await expect(services(other.userId, MANAGER).fits.accessPoints(actor, other.workspaceId, ws.caseId)).rejects.toThrow(/Case not found/);
  });

  it("the site visit's Access step: the region's unit, a lift and a stair turn on one route, and only the sizes each kind has", async () => {
    const ws = await seed("imperial");
    const svc = services(ws.userId, MANAGER);
    // An imperial firm measures in inches; a metric one in centimetres (the step's default unit).
    expect(await svc.fits.accessPoints(actor, ws.workspaceId, ws.caseId)).toEqual({ points: [], defaultUnit: "in" });
    const metric = await seed();
    expect((await services(metric.userId, MANAGER).fits.accessPoints(actor, metric.workspaceId, metric.caseId)).defaultUnit).toBe("cm");

    const catalog = await svc.catalogs.createCatalog(actor, ws.workspaceId, { name: "Loose furniture" });
    const sofa = await svc.catalogs.createItem(actor, ws.workspaceId, catalog.id, { code: "SOFA", name: "Halden sofa", itemType: "product", unitCode: "pcs" });
    await svc.clips.saveDimensions(actor, ws.workspaceId, sofa.id, { version: 0, width: "228", depth: "95", height: "82", unit: "cm" });

    // Recorded in the order they're walked: the lobby door, the lift, the stair up to the flat.
    const steps = [
      { kind: "door", label: "Lobby door", width: "60", height: "84", turnWidth: "40" },
      { kind: "lift", label: "Service lift", width: "42", height: "84", cabinWidth: "60", cabinDepth: "80", cabinHeight: "96" },
      { kind: "stair", label: "Half-landing", width: "40", height: "90", turnWidth: "40" },
    ];
    for (const [position, step] of steps.entries())
      await svc.fits.saveAccessPoint(actor, ws.workspaceId, ws.caseId, randomUUID(), { version: 0, route: "Main", position, unit: "in", ...step });
    const { points } = await svc.fits.accessPoints(actor, ws.workspaceId, ws.caseId);
    expect(points.map((point) => [point.kind, point.unit, point.turnWidth, point.cabinDepth])).toEqual([["door", "in", null, null], ["lift", "in", null, "80.00"], ["stair", "in", "40.00", null]]);

    const [fit] = (await svc.fits.check(actor, ws.workspaceId, ws.caseId, [sofa.id])).items;
    expect(fit.result.routes).toHaveLength(1);
    expect(fit.result.routes[0].points.map((point) => [point.label, point.missing])).toEqual([["Lobby door", []], ["Service lift", []], ["Half-landing", []]]);
    expect(fit.result.routes[0].points.every((point) => point.status !== "unknown")).toBe(true);
    // A step left half-measured (no cabin) says what's missing rather than guessing.
    await svc.fits.saveAccessPoint(actor, ws.workspaceId, ws.caseId, randomUUID(), { version: 0, route: "Goods", position: 0, kind: "lift", label: "Goods lift", width: "48", height: "90", unit: "in" });
    const goods = (await svc.fits.check(actor, ws.workspaceId, ws.caseId, [sofa.id])).items[0].result.routes.find((route) => route.route === "Goods")!;
    expect(goods.points[0]).toMatchObject({ status: "unknown", missing: ["cabin"] });
  });
});
