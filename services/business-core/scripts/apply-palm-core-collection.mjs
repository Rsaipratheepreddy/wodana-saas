import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const argumentsSet = new Set(process.argv.slice(2));
const positional = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const manifestPath = path.resolve(positional[0] ?? "");
const commit = argumentsSet.has("--commit");
const allowRemote = argumentsSet.has("--allow-remote");
if (!positional[0]) throw new Error("Usage: node apply-palm-core-collection.mjs MANIFEST [--commit] [--allow-remote]");

const manifestBody = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestBody);
assert.equal(manifest.schemaVersion, 1, "Unsupported Palm collection manifest version.");
assert.equal(manifest.source?.itemRows, 542, "The reviewed Palm collection must contain 542 source rows.");
assert.match(manifest.source?.sha256 ?? "", /^[0-9a-f]{64}$/);
assert.match(manifest.catalog?.id ?? "", /^[0-9a-f-]{36}$/i);
assert(Array.isArray(manifest.records) && manifest.records.length > 500, "The manifest is incomplete.");
assert(Array.isArray(manifest.assets), "The manifest asset list is missing.");

const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8166/api/v1";
const endpoint = new URL(api);
const local = ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname);
if (!local && !allowRemote) throw new Error("Remote Palm imports require --allow-remote.");
if (!local && commit) {
  const expected = `palm-living:${manifest.source.sha256.slice(0, 12)}`;
  assert.equal(process.env.PALM_TENANT_APPLY_CONFIRM, expected,
    `Set PALM_TENANT_APPLY_CONFIRM=${expected} after reviewing this exact source manifest.`);
}

const headers = process.env.WODANA_ACCESS_TOKEN
  ? { authorization: `Bearer ${process.env.WODANA_ACCESS_TOKEN}` }
  : process.env.WODANA_COOKIE
    ? { cookie: process.env.WODANA_COOKIE }
    : local
      ? {
          "x-wodana-user-subject": "palm-living-local-operations",
          "x-wodana-user-email": "operations@palmlivingae.com",
          "x-wodana-user-name": "Palm Living Operations",
        }
      : {};
if (!local && !Object.keys(headers).length)
  throw new Error("Remote Palm imports require WODANA_ACCESS_TOKEN or WODANA_COOKIE for the authorized operator.");

async function request(resource, { body, method = body === undefined ? "GET" : "POST", expected = [200, 201] } = {}) {
  const response = await fetch(`${api}${resource}`, {
    method,
    headers: { ...headers, ...(body === undefined || body instanceof FormData ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!(Array.isArray(expected) ? expected : [expected]).includes(response.status))
    throw new Error(`${method} ${resource}: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

const profile = await request("/me");
const membership = profile.memberships?.find((row) => row.workspaceSlug === "palm-living");
assert(membership?.workspaceId, "The authenticated operator is not an active Palm Living workspace member.");
const workspaceId = membership.workspaceId;
const catalogId = manifest.catalog.id;

let current = await request(`/workspaces/${workspaceId}/catalog?catalogId=${catalogId}`);
let items = current.items ?? [];
const catalog = items.find((record) => record.id === catalogId && record.kind === "catalog_group");
if (!catalog && !commit) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    previewOnly: true,
    workspaceId,
    catalogId,
    sourceSha256: manifest.source.sha256,
    note: "Catalog does not exist. Re-run with --commit after reviewing the manifest to create it and execute API dry-runs before each batch.",
  }, null, 2)}\n`);
  process.exit(0);
}
if (!catalog) {
  await request(`/workspaces/${workspaceId}/catalog/collections`, {
    body: { id: catalogId, name: manifest.catalog.name, description: manifest.catalog.description, starter: false },
  });
}

const refresh = async () => {
  current = await request(`/workspaces/${workspaceId}/catalog?catalogId=${catalogId}`);
  items = current.items ?? [];
  return new Map(items.map((record) => [record.id, record]));
};
let currentById = await refresh();

const recordsById = new Map(manifest.records.map((record) => [record.id, record]));
for (const record of manifest.records) {
  assert.equal(record.catalogId, catalogId, `${record.name}: wrong catalog.`);
  assert.equal(record.version, 0, `${record.name}: prepared imports must start at version zero.`);
  for (const link of record.links ?? [])
    assert(recordsById.has(link.targetId), `${record.name}: missing manifest dependency ${link.targetId}.`);
}

const foundations = manifest.records.filter((record) => ["unit", "record_group"].includes(record.kind));
const works = manifest.records.filter((record) => record.kind === "work");
const variants = manifest.records.filter((record) => record.kind === "variant");
const rates = manifest.records.filter((record) => record.kind === "rate_card");
const variantsByWork = new Map();
for (const variant of variants) {
  const workId = variant.links.find((link) => link.relation === "work")?.targetId;
  assert(workId && works.some((work) => work.id === workId), `${variant.name}: variant has no prepared item.`);
  variantsByWork.set(workId, [...(variantsByWork.get(workId) ?? []), variant]);
}

function chunksOfFamilies(limit = 450) {
  const chunks = [];
  let chunk = [];
  for (const work of works) {
    const family = [work, ...(variantsByWork.get(work.id) ?? [])];
    assert(family.length <= limit, `${work.name}: product family exceeds one import batch.`);
    if (chunk.length && chunk.length + family.length > limit) { chunks.push(chunk); chunk = []; }
    chunk.push(...family);
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}
const chunks = [foundations, ...chunksOfFamilies(), ...Array.from({ length: Math.ceil(rates.length / 450) }, (_, index) => rates.slice(index * 450, (index + 1) * 450))]
  .filter((batch) => batch.length);

const batchResults = [];
for (const [index, records] of chunks.entries()) {
  const stagedIds = new Set(records.map((record) => record.id));
  const referenceIds = new Set(records.flatMap((record) => record.links ?? []).map((link) => link.targetId).filter((id) => !stagedIds.has(id)));
  const references = [...referenceIds].map((id) => {
    const existing = currentById.get(id);
    assert(existing, `Batch ${index + 1}: dependency ${id} has not been imported.`);
    return { id, version: existing.version };
  });
  const preview = await request(`/workspaces/${workspaceId}/catalog/import`, { body: { catalogId, records, references, dryRun: true } });
  assert.equal(preview.preview, true);
  if (!commit) {
    batchResults.push({ batch: index + 1, records: records.length, preview });
    continue;
  }
  const applied = await request(`/workspaces/${workspaceId}/catalog/import`, { body: { catalogId, records, references, dryRun: false } });
  batchResults.push({ batch: index + 1, records: records.length, created: applied.created, reused: applied.reused });
  currentById = await refresh();
}

let uploaded = 0, reusedAssets = 0;
if (commit) {
  const root = path.dirname(manifestPath);
  for (const [index, asset] of manifest.assets.entries()) {
    const filePath = path.resolve(root, asset.path);
    assert(filePath.startsWith(`${root}${path.sep}`), "Asset path escapes the manifest directory.");
    const content = await readFile(filePath);
    assert.equal(content.length, asset.byteSize, `${asset.path}: byte size changed.`);
    assert.equal(createHash("sha256").update(content).digest("hex"), asset.sha256, `${asset.path}: digest changed.`);
    const existing = await request(`/workspaces/${workspaceId}/catalog/records/${asset.recordId}/assets?includeArchived=true`);
    if (existing.items?.some((item) => item.id === asset.assetId)) {
      reusedAssets += 1;
      continue;
    }
    const form = new FormData();
    form.set("file", new Blob([content]), path.basename(asset.path));
    const query = new URLSearchParams({ role: asset.role, altText: asset.altText, sortOrder: String(asset.sortOrder) });
    await request(`/workspaces/${workspaceId}/catalog/records/${asset.recordId}/assets/${asset.assetId}?${query}`, { body: form });
    uploaded += 1;
    if ((index + 1) % 25 === 0) process.stderr.write(`Palm collection media: ${index + 1}/${manifest.assets.length}\n`);
  }
}

const finalRecords = commit ? (await refresh()) : currentById;
const preparedPresent = manifest.records.filter((record) => finalRecords.has(record.id)).length;
process.stdout.write(`${JSON.stringify({
  ok: true,
  committed: commit,
  workspaceId,
  catalogId,
  sourceSha256: manifest.source.sha256,
  approval: manifest.approval,
  preparedRecords: manifest.records.length,
  preparedPresent,
  batches: batchResults,
  assets: { prepared: manifest.assets.length, uploaded, reused: reusedAssets },
}, null, 2)}\n`);
