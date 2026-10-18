import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { CatalogItemImagesService } from "../../catalog-core/catalog-item-images";
import { CatalogV2Service } from "../../catalog-core/catalog-v2.service";
import { actorOf, type Actor, type Core } from "./core";
import type { CollectionManifest, SeedData } from "./data";
import { stableId } from "./ids";

type Item = { id: string; code: string; name: string; version: number };

/**
 * The Core Collection in the catalog that the Catalog page and the quotation picker read (catalog-core): one
 * catalog, a category per collection group, an item per collection piece (and per size option) with its picture.
 * No prices: the workbook's selling prices await Palm's commercial approval, so a picked item says "price
 * unavailable" rather than showing an unapproved rate. Matched by code, so a second run changes nothing.
 */
export async function ensureCoreCollectionItems(core: Core, data: SeedData, workspaceId: string, owner: Actor) {
  if (!data.collection) return;
  const { manifest, dir } = data.collection;
  const actor = actorOf(owner);
  const catalogs = core.get(CatalogV2Service), images = core.get(CatalogItemImagesService);
  const catalogName = manifest.catalog.name;
  const list = (await catalogs.listCatalogs(actor, workspaceId)) as Array<{ id: string; code: string; name: string }>;
  const catalog = list.find((row) => row.name === catalogName) ?? await core.step("catalog-core catalog", `catalog ${catalogName}`, async () => null,
    async () => ({ ...(await catalogs.createCatalog(actor, workspaceId, { name: catalogName, purpose: "sell" })), code: "", name: catalogName })).catch(swallow);
  if (!catalog) return;
  if (list.some((row) => row.id === catalog.id)) core.report.record("catalog-core catalog", "reused");

  // Categories: one per collection group, by name.
  const groups = manifest.records.filter((record) => record.kind === "record_group");
  let structure = (await catalogs.structure(actor, workspaceId, catalog.id)) as { categories: Array<{ id: string; name: string }> };
  const categoryByName = new Map(structure.categories.map((row) => [row.name.trim().toLowerCase(), row.id]));
  for (const group of groups) {
    const key = group.name.trim().toLowerCase();
    if (categoryByName.has(key)) { core.report.record("catalog-core category", "reused"); continue; }
    const made = await core.step("catalog-core category", `category ${group.name}`, async () => null, async () => catalogs.createCategory(actor, workspaceId, catalog.id, { name: group.name })).catch(swallow);
    if (made) categoryByName.set(key, made.id);
  }
  const groupName = new Map(groups.map((group) => [group.id, group.name]));

  // Items: every piece and every size option, coded as the collection codes them.
  const byCode = new Map<string, Item>();
  for (let cursor: string | undefined; ;) {
    const page = (await catalogs.listItems(actor, workspaceId, catalog.id, { limit: 200, cursor })) as { items: Item[]; nextCursor: string | null };
    for (const item of page.items) byCode.set(item.code, item);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  const pieces = manifest.records.filter((record) => record.kind === "work" || record.kind === "variant");
  const itemByRecord = new Map<string, Item>();
  for (const record of pieces) {
    const code = String(record.code ?? "").slice(0, 80);
    const existing = byCode.get(code);
    if (existing) { core.report.record("catalog-core item", "reused"); itemByRecord.set(record.id, existing); continue; }
    const group = (record.links ?? []).map((link) => groupName.get(link.targetId)).find(Boolean);
    const categoryId = group ? categoryByName.get(group.trim().toLowerCase()) ?? null : null;
    const made = await core.step("catalog-core item", `item ${record.name}`, async () => null, async () => catalogs.createItem(actor, workspaceId, catalog.id, {
      code, name: String(record.name).slice(0, 200), itemType: "ready_made", unitCode: "pcs", categoryId, description: description(record, group),
    }) as Promise<Item>).catch(swallow);
    if (made) itemByRecord.set(record.id, made);
  }

  // Pictures: the collection's primary image on its item, from the checksummed artifact; the same id again is reused.
  const root = resolve(dir);
  for (const asset of manifest.assets.filter((row) => row.role === "primary_image")) {
    const item = itemByRecord.get(asset.recordId);
    if (!item) { core.report.record("catalog-core image", "pending", `${asset.path} follows its item`); continue; }
    const imageId = stableId(workspaceId, `catalog-core-image:${asset.assetId}`);
    const current = (await images.list(actor, workspaceId, item.id)) as { images: Array<{ id: string }> };
    if (current.images.some((row) => row.id === imageId)) { core.report.record("catalog-core image", "reused"); continue; }
    if (!core.commit) { core.report.record("catalog-core image", "pending", `${asset.path} would be attached`); continue; }
    const filePath = resolve(root, asset.path);
    if (!filePath.startsWith(`${root}${sep}`)) throw new Error("Asset path escapes the manifest directory.");
    const body = readFileSync(filePath);
    if (createHash("sha256").update(body).digest("hex") !== asset.sha256) throw new Error(`${asset.path}: the file does not match the manifest.`);
    await images.upload(actor, workspaceId, item.id, imageId, { buffer: body, originalname: asset.path.split("/").pop() ?? "picture.png", mimetype: "image/png", size: body.length } as never);
    core.report.record("catalog-core image", "created");
  }
}

/** What the workbook says about the piece: its collection category, sizes, and where it came from. */
function description(record: CollectionManifest["records"][number], group: string | undefined) {
  const attributes = (record.attributes as Array<{ name: string; value: string }> | undefined) ?? [];
  const sizes = attributes.filter((row) => /\((CM|MM)\)$/i.test(row.name) && row.value && !/not listed/i.test(row.value)).map((row) => `${row.name.replace(/\s*\((CM|MM)\)$/i, "").toLowerCase()} ${row.value}`);
  const sheet = attributes.find((row) => row.name === "Source sheet")?.value, row = attributes.find((row) => row.name === "Source row")?.value;
  return [`Palm Living Core Collection${group ? ` · ${group}` : ""}`, sizes.length ? sizes.join(", ") : null, sheet ? `Workbook: ${sheet}${row ? ` row ${row}` : ""}` : null].filter(Boolean).join(". ").slice(0, 2000);
}

function swallow(error: unknown) {
  if ((error as { reason?: string })?.reason) return null;
  throw error;
}
