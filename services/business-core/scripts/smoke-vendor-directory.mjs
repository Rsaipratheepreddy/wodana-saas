import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8167/api/v1";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname) || process.env.NODE_ENV === "production")
  throw new Error("Vendor directory smoke runs only against local development.");

async function raw(path, { method = "GET", body, token } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}
async function request(path, options = {}, expected = 200) {
  const result = await raw(path, options);
  assert.equal(result.response.status, expected, `${options.method ?? "GET"} ${path}: ${result.data.message ?? result.response.status}`);
  return result.data;
}

const login = await request("/auth/login", { method: "POST", body: {
  email: "admin@igloarchitects.com", password: "IgloDemo#2026", tenantSlug: "iglo-architects",
} }, 201);
const token = login.accessToken;
const me = await request("/me", { token });
const workspaceId = me.memberships.find((membership) => membership.workspaceSlug === "iglo-architects").workspaceId;
const root = `/workspaces/${workspaceId}/vendors`;
const vendorId = randomUUID();
const siteA = randomUUID();
const siteB = randomUUID();
const taxId = `VAT-${vendorId.slice(0, 8)}`;

const draft = { id: vendorId, version: 0, displayName: `Vendor smoke ${vendorId.slice(0, 8)}`, capabilities: [],
  taxRegistrationNumber: taxId, defaultCurrency: "AED", notes: "Temporary isolated verification." };
let vendor = await request(root, { method: "POST", body: draft, token }, 201);
assert.equal(vendor.status, "draft");
assert.match(vendor.code, /^VENDOR_SMOKE_/);
assert.equal((await request(root, { method: "POST", body: draft, token }, 201)).version, 1, "exact create retry must be idempotent");
await request(root, { method: "POST", body: { ...draft, displayName: "Different intent" }, token }, 409);
await request(`${root}/${vendorId}/lifecycle`, { method: "POST", body: { version: 1, action: "activate" }, token }, 400);
vendor = await request(`${root}/${vendorId}`, { method: "PATCH", body: { version: 1, capabilities: ["materials", "manufacturing"] }, token });
vendor = await request(`${root}/${vendorId}/lifecycle`, { method: "POST", body: { version: vendor.version, action: "activate" }, token }, 201);
assert.equal(vendor.status, "active");
await request(`${root}/${vendorId}`, { method: "PATCH", body: { version: vendor.version, capabilities: [] }, token }, 400);

vendor = await request(`${root}/${vendorId}/sites`, { method: "POST", body: { id: siteA, version: 0, name: "Main store", siteType: "store", isPrimary: true }, token }, 201);
assert.equal(vendor.sites.find((site) => site.id === siteA).isPrimary, true);
assert.equal((await request(`${root}/${vendorId}/sites`, { method: "POST", body: { id: siteA, version: 0, name: "Main store", siteType: "store", isPrimary: true }, token }, 201)).sites.find((site) => site.id === siteA).version, 1);
vendor = await request(`${root}/${vendorId}/sites`, { method: "POST", body: { id: siteB, version: 0, name: "Factory", siteType: "factory", isPrimary: true }, token }, 201);
assert.equal(vendor.sites.filter((site) => site.isPrimary).length, 1);
assert.equal(vendor.sites.find((site) => site.id === siteB).isPrimary, true);
const displaced = vendor.sites.find((site) => site.id === siteA);
assert.equal(displaced.version, 2, "changing the primary site versions the displaced site");
await request(`${root}/${vendorId}/sites/${siteA}`, { method: "PATCH", body: { version: 1, phone: "+971500000000" }, token }, 409);
const primary = vendor.sites.find((site) => site.id === siteB);
vendor = await request(`${root}/${vendorId}/sites/${siteB}/lifecycle`, { method: "POST", body: { version: primary.version, action: "archive", reason: "Temporary closure" }, token }, 201);
assert.equal(vendor.sites.filter((site) => site.status === "active" && site.isPrimary).length, 0);
const archivedSite = vendor.sites.find((site) => site.id === siteB);
vendor = await request(`${root}/${vendorId}/sites/${siteB}/lifecycle`, { method: "POST", body: { version: archivedSite.version, action: "restore", reason: "Reopened" }, token }, 201);
assert.equal(vendor.sites.find((site) => site.id === siteB).isPrimary, false, "restored sites require an explicit primary choice");

const concurrentSites = [randomUUID(), randomUUID()];
const concurrentResults = await Promise.all(concurrentSites.map((id, index) => raw(`${root}/${vendorId}/sites`, {
  method: "POST", token, body: { id, version: 0, name: `Concurrent store ${index + 1}`, siteType: "store", isPrimary: true },
})));
assert.deepEqual(concurrentResults.map((result) => result.response.status).sort(), [201, 201]);
vendor = await request(`${root}/${vendorId}`, { token });
assert.equal(vendor.sites.filter((site) => site.status === "active" && site.isPrimary).length, 1, "concurrent primary selection must converge to one site");

const concurrentVersion = vendor.version;
const concurrentUpdates = await Promise.all([
  raw(`${root}/${vendorId}`, { method: "PATCH", token, body: { version: concurrentVersion, notes: "Concurrent note" } }),
  raw(`${root}/${vendorId}`, { method: "PATCH", token, body: { version: concurrentVersion, displayName: `${draft.displayName} updated` } }),
]);
assert.deepEqual(concurrentUpdates.map((result) => result.response.status).sort(), [200, 409]);
vendor = await request(`${root}/${vendorId}`, { token });

await request(root, { method: "POST", body: { ...draft, id: randomUUID(), displayName: "Duplicate VAT", code: `DUP_${vendorId.slice(0, 8).toUpperCase()}` }, token }, 409);
const matches = await request(`${root}?search=${encodeURIComponent(vendor.code)}&capability=materials`, { token });
assert(matches.data.some((item) => item.id === vendorId));
await request(`${root}/${vendorId}/lifecycle`, { method: "POST", body: { version: vendor.version, action: "archive" }, token }, 400);
vendor = await request(`${root}/${vendorId}/lifecycle`, { method: "POST", body: { version: vendor.version, action: "archive", reason: "End of smoke" }, token }, 201);
assert.equal(vendor.status, "archived");
await request(`${root}/${vendorId}/sites`, { method: "POST", body: { id: randomUUID(), version: 0, name: "Blocked", siteType: "branch" }, token }, 409);
vendor = await request(`${root}/${vendorId}/lifecycle`, { method: "POST", body: { version: vendor.version, action: "restore", reason: "Verify controlled restore" }, token }, 201);
assert.equal(vendor.status, "draft");
vendor = await request(`${root}/${vendorId}/lifecycle`, { method: "POST", body: { version: vendor.version, action: "activate" }, token }, 201);
assert.equal(vendor.status, "active");
await request(`/workspaces/${randomUUID()}/vendors`, { token }, 404);
assert.equal((await raw(root)).response.status, 401);

const terminology = await request(`/workspaces/${workspaceId}/terminology`, { token });
assert.equal(terminology.map.vendor.visibleName, "Vendor");
assert.equal(terminology.map.catalog.visibleName, "Catalog");

console.log(JSON.stringify({ checks: [
  "minimal draft and generated code", "exact retry and conflicting intent", "activation completeness",
  "primary store handoff and exact retry", "concurrent primary convergence", "concurrent profile versioning",
  "stale location update", "archive/restore safety", "duplicate tax identity",
  "search and capability filtering", "workspace membership", "authentication", "configurable terminology",
] }));
