import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { SaveCatalogRecordDto } from "../src/catalog/catalog.dto";
import { validateCatalogRecord } from "../src/catalog/catalog.service";

async function main() {
const manifestPath = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Pass a prepared Palm Core Collection manifest.");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
  schemaVersion: number;
  source: { itemRows: number; sha256: string };
  approval: { sellingPricesApproved: boolean };
  records: Array<Record<string, any>>;
  assets: Array<{ recordId: string; assetId: string; path: string; sha256: string; byteSize: number }>;
};
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.source.itemRows, 542);
assert.match(manifest.source.sha256, /^[0-9a-f]{64}$/);

const records = new Map(manifest.records.map((record) => [record.id, record]));
assert.equal(records.size, manifest.records.length, "Catalog record IDs must be unique.");
for (const record of manifest.records) {
  const errors = await validate(plainToInstance(SaveCatalogRecordDto, record), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  assert.deepEqual(errors, [], `${record.name}: DTO validation failed.`);
  assert.doesNotThrow(() => validateCatalogRecord(record as SaveCatalogRecordDto), `${record.name}: catalog validation failed.`);
  for (const link of record.links) {
    const target = records.get(link.targetId);
    assert(target, `${record.name}: missing target ${link.targetId}.`);
    assert.equal(target.kind, link.relation === "parent" ? record.kind : link.relation,
      `${record.name}: ${link.relation} points to ${target.kind}.`);
  }
  if (record.kind === "rate_card") assert.equal(manifest.approval.sellingPricesApproved, true,
    "A non-approved manifest must not contain a selling rate.");
}

const assetIds = new Set<string>();
const root = path.dirname(manifestPath);
for (const asset of manifest.assets) {
  assert(records.has(asset.recordId), `${asset.path}: missing catalog owner.`);
  assert(!assetIds.has(asset.assetId), `${asset.path}: duplicate asset ID.`);
  assetIds.add(asset.assetId);
  const filePath = path.resolve(root, asset.path);
  assert(filePath.startsWith(`${root}${path.sep}`), `${asset.path}: unsafe path.`);
  const body = await readFile(filePath);
  assert.equal(body.length, asset.byteSize, `${asset.path}: size changed.`);
  assert.equal(createHash("sha256").update(body).digest("hex"), asset.sha256, `${asset.path}: digest changed.`);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  sourceRows: manifest.source.itemRows,
  records: manifest.records.length,
  assets: manifest.assets.length,
  sellingPricesApproved: manifest.approval.sellingPricesApproved,
})}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
