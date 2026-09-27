import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { CatalogAssetsService } from "../../catalog/catalog-assets.service";
import { CatalogService } from "../../catalog/catalog.service";
import { CatalogAssetUploadQueryDto, CreateCatalogDto, ImportCatalogDto } from "../../catalog/catalog.dto";
import { actorOf, type Actor, type Core } from "./core";
import type { CollectionManifest, SeedData } from "./data";

export type CollectionRecord = { id: string; name: string; kind: string; version: number; primaryAsset: { id: string } | null };

/**
 * The Core Collection from its prepared, checksummed manifest: the catalog, its records in dependency-ordered
 * batches through the catalog import (a re-import of an identical record is "reused"), then every image that
 * is not there yet. The same batching as scripts/apply-palm-core-collection.mjs.
 */
export async function ensureCoreCollection(core: Core, data: SeedData, workspaceId: string, owner: Actor): Promise<Map<string, CollectionRecord>> {
  const actor = actorOf(owner);
  const catalog = core.get(CatalogService);
  const assets = core.get(CatalogAssetsService);
  if (!data.collection) {
    core.report.notes.push("SEED_CORE_COLLECTION_DIR is not set or has no manifest.json; the Core Collection was not loaded.");
    return new Map();
  }
  const { manifest, dir } = data.collection;
  if (manifest.schemaVersion !== 1 || manifest.source.itemRows !== 542 || !/^[0-9a-f]{64}$/.test(manifest.source.sha256) || manifest.records.length < 500)
    throw new Error("The Core Collection manifest is not the reviewed release (schema 1, 542 source rows, 635 records).");
  const catalogId = manifest.catalog.id;
  const list = async () => (await catalog.list(actor, workspaceId, { catalogId })) as { items: Array<CollectionRecord & { catalogId: string | null }> };
  let items = (await list()).items;
  const group = items.find((record) => record.id === catalogId && record.kind === "catalog_group");
  if (!group) {
    const made = await core.step("catalog", `catalog ${manifest.catalog.name}`, async () => null, async () =>
      catalog.createCatalog(actor, workspaceId, await core.validated(CreateCatalogDto, { id: catalogId, name: manifest.catalog.name, description: manifest.catalog.description, starter: false }))).catch(() => null);
    if (!made) {
      core.report.record("catalog record", "pending", `${manifest.records.length} records and ${manifest.assets.length} images follow the catalog`);
      return new Map();
    }
    items = (await list()).items;
  } else core.report.record("catalog", "reused");
  let byId = new Map(items.map((record) => [record.id, record]));
  const recordsById = new Map(manifest.records.map((record) => [record.id, record]));
  for (const record of manifest.records) {
    if (record.catalogId !== catalogId || record.version !== 0) throw new Error(`${record.name}: prepared imports belong to the catalog and start at version zero.`);
    for (const link of record.links ?? []) if (!recordsById.has(link.targetId)) throw new Error(`${record.name}: missing manifest dependency ${link.targetId}.`);
  }
  for (const batch of batches(manifest)) {
    const staged = new Set(batch.map((record) => record.id));
    const references = [...new Set(batch.flatMap((record) => record.links ?? []).map((link) => link.targetId).filter((id) => !staged.has(id)))].map((id) => {
      const existing = byId.get(id);
      if (!existing) throw new Error(`Catalog import: dependency ${id} has not been imported.`);
      return { id, version: existing.version };
    });
    const missing = batch.filter((record) => !byId.has(record.id)).length;
    if (!missing) { for (let index = 0; index < batch.length; index += 1) core.report.record("catalog record", "reused"); continue; }
    if (!core.commit) { core.report.record("catalog record", "pending", `${missing} of ${batch.length} records in this batch would be imported`); continue; }
    const body = await core.validated(ImportCatalogDto, { catalogId, records: batch, references, dryRun: false });
    const applied = (await catalog.importRecords(actor, workspaceId, body)) as { created: number; reused: number };
    for (let index = 0; index < applied.created; index += 1) core.report.record("catalog record", "created");
    for (let index = 0; index < applied.reused; index += 1) core.report.record("catalog record", "reused");
    byId = new Map((await list()).items.map((record) => [record.id, record]));
  }
  const root = resolve(dir);
  for (const asset of manifest.assets) {
    if (!byId.has(asset.recordId)) { core.report.record("catalog image", "pending", `${asset.path} follows its record`); continue; }
    const existing = (await assets.list(actor, workspaceId, asset.recordId, true)) as { items: Array<{ id: string }> };
    if (existing.items.some((item) => item.id === asset.assetId)) { core.report.record("catalog image", "reused"); continue; }
    if (!core.commit) { core.report.record("catalog image", "pending", `${asset.path} would be uploaded`); continue; }
    const filePath = resolve(root, asset.path);
    if (!filePath.startsWith(`${root}${sep}`)) throw new Error("Asset path escapes the manifest directory.");
    const content = readFileSync(filePath);
    if (content.length !== asset.byteSize || createHash("sha256").update(content).digest("hex") !== asset.sha256) throw new Error(`${asset.path}: the file does not match the manifest.`);
    const query = await core.validated(CatalogAssetUploadQueryDto, { role: asset.role, altText: asset.altText, sortOrder: asset.sortOrder });
    await assets.upload(actor, workspaceId, asset.recordId, asset.assetId, query, { buffer: content, originalname: asset.path.split("/").pop() ?? "image.png", mimetype: "image/png", size: content.length } as never);
    core.report.record("catalog image", "created");
  }
  return new Map((await list()).items.filter((record) => record.catalogId === catalogId).map((record) => [record.id, record]));
}

/** Foundations first (units, groups), then whole product families, then rate cards; at most 450 records a batch. */
function batches(manifest: CollectionManifest) {
  const foundations = manifest.records.filter((record) => ["unit", "record_group"].includes(record.kind));
  const works = manifest.records.filter((record) => record.kind === "work");
  const variantsByWork = new Map<string, CollectionManifest["records"]>();
  for (const variant of manifest.records.filter((record) => record.kind === "variant")) {
    const workId = variant.links?.find((link) => link.relation === "work")?.targetId;
    if (!workId) throw new Error(`${variant.name}: variant has no prepared item.`);
    variantsByWork.set(workId, [...(variantsByWork.get(workId) ?? []), variant]);
  }
  const families: CollectionManifest["records"][] = [];
  let chunk: CollectionManifest["records"] = [];
  for (const work of works) {
    const family = [work, ...(variantsByWork.get(work.id) ?? [])];
    if (chunk.length && chunk.length + family.length > 450) { families.push(chunk); chunk = []; }
    chunk.push(...family);
  }
  if (chunk.length) families.push(chunk);
  const rates = manifest.records.filter((record) => record.kind === "rate_card");
  const rateBatches = Array.from({ length: Math.ceil(rates.length / 450) }, (_, index) => rates.slice(index * 450, (index + 1) * 450));
  return [foundations, ...families, ...rateBatches].filter((batch) => batch.length);
}
