import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8168/api/v1";
if (!["127.0.0.1", "localhost"].includes(new URL(base).hostname) || process.env.NODE_ENV === "production")
  throw new Error("Supplier-offer smoke runs only against local development.");

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
const vendorsRoot = `/workspaces/${workspaceId}/vendors`;
const offersRoot = `/workspaces/${workspaceId}/supplier-offers`;
const catalogRoot = `/workspaces/${workspaceId}/catalog`;

await request(`${catalogRoot}/starter`, { method: "POST", body: {}, token }, 201);
const catalogBefore = await request(catalogRoot, { token });
const target = catalogBefore.items.find((item) => item.kind === "material" && item.links?.some((link) => link.relation === "unit"));
assert(target, "starter catalog needs a material with a unit");
const unitId = target.links.find((link) => link.relation === "unit").targetId;
const unit = catalogBefore.items.find((item) => item.id === unitId);
assert(unit && unit.kind === "unit" && unit.catalogId === target.catalogId);

async function activeVendor(name, withSite = false) {
  const id = randomUUID();
  let vendor = await request(vendorsRoot, { method: "POST", token, body: {
    id, version: 0, displayName: name, capabilities: ["materials"], defaultCurrency: "AED",
  } }, 201);
  vendor = await request(`${vendorsRoot}/${id}/lifecycle`, { method: "POST", token, body: { version: vendor.version, action: "activate" } }, 201);
  if (!withSite) return { vendor, site: null };
  const siteId = randomUUID();
  vendor = await request(`${vendorsRoot}/${id}/sites`, { method: "POST", token, body: {
    id: siteId, version: 0, name: "Main supplier store", siteType: "store", isPrimary: true,
  } }, 201);
  return { vendor, site: vendor.sites.find((candidate) => candidate.id === siteId) };
}

const zeta = await activeVendor(`Zeta supplier ${randomUUID().slice(0, 8)}`, true);
const alpha = await activeVendor(`Alpha supplier ${randomUUID().slice(0, 8)}`);
await activeVendor(`Unsourced directory vendor ${randomUUID().slice(0, 8)}`);
assert(!JSON.stringify(await request(`${vendorsRoot}/${zeta.vendor.id}`, { token })).includes('"amount"'), "vendor directory must not expose supplier prices");

const draftId = randomUUID();
const draft = { id: draftId, version: 0, vendorId: zeta.vendor.id, vendorSiteId: zeta.site.id,
  catalogRecordId: target.id, notes: "Incomplete draft is intentional." };
let first = await request(offersRoot, { method: "POST", token, body: draft }, 201);
assert.equal(first.status, "draft");
assert.equal((await request(offersRoot, { method: "POST", token, body: draft }, 201)).version, 1);
await request(offersRoot, { method: "POST", token, body: { ...draft, vendorId: alpha.vendor.id } }, 409);
await request(`${offersRoot}/${draftId}/lifecycle`, { method: "POST", token, body: {
  requestId: randomUUID(), version: first.version, action: "activate",
} }, 400);
first = await request(`${offersRoot}/${draftId}`, { method: "PATCH", token, body: {
  version: first.version, unitRecordId: unitId, supplierSku: "SUP-001", amount: 100, currency: "AED",
  minimumOrderQuantity: 5, orderMultiple: 5, leadTimeDays: 7, effectiveFrom: "2026-01-01",
  sourceType: "vendor_quote", sourceReference: "ZETA-Q-001", taxTreatment: "exclusive",
  inclusions: ["delivery"], terms: "Seven-day quotation terms.",
} });
await request(`${offersRoot}/${draftId}`, { method: "PATCH", token, body: { version: first.version, amount: 0, sourceType: "vendor_quote" } }, 400);

const competitorId = randomUUID();
const competitor = await request(offersRoot, { method: "POST", token, body: {
  id: competitorId, version: 0, vendorId: zeta.vendor.id, vendorSiteId: zeta.site.id,
  catalogRecordId: target.id, unitRecordId: unitId, amount: 105, currency: "AED",
  effectiveFrom: "2026-01-01", sourceType: "price_list", sourceReference: "ZETA-LIST-2026",
  taxTreatment: "exclusive",
} }, 201);
const firstCommand = { requestId: randomUUID(), version: first.version, action: "activate" };
const secondCommand = { requestId: randomUUID(), version: competitor.version, action: "activate" };
const concurrent = await Promise.all([
  raw(`${offersRoot}/${draftId}/lifecycle`, { method: "POST", token, body: firstCommand }),
  raw(`${offersRoot}/${competitorId}/lifecycle`, { method: "POST", token, body: secondCommand }),
]);
assert.deepEqual(concurrent.map((result) => result.response.status).sort(), [201, 409]);
const winnerIndex = concurrent.findIndex((result) => result.response.status === 201);
const winnerId = winnerIndex === 0 ? draftId : competitorId;
const winnerCommand = winnerIndex === 0 ? firstCommand : secondCommand;
const winner = concurrent[winnerIndex].data;
const replay = await request(`${offersRoot}/${winnerId}/lifecycle`, { method: "POST", token, body: winnerCommand }, 201);
assert.deepEqual(replay, winner, "exact lifecycle retries must return the stored response");
await request(`${offersRoot}/${winnerId}/lifecycle`, { method: "POST", token, body: {
  ...winnerCommand, action: "archive", reason: "Different intent",
} }, 409);
await request(`${offersRoot}/${winnerId}`, { method: "PATCH", token, body: { version: winner.version, amount: 1 } }, 409);

const tier = await request(offersRoot, { method: "POST", token, body: {
  id: randomUUID(), version: 0, vendorId: zeta.vendor.id, vendorSiteId: zeta.site.id,
  catalogRecordId: target.id, unitRecordId: unitId, amount: 90, currency: "AED", quantityFrom: 10,
  minimumOrderQuantity: 10, orderMultiple: 5, effectiveFrom: "2026-01-01",
  sourceType: "contract", sourceReference: "ZETA-TIER-10", taxTreatment: "exclusive",
} }, 201);
await request(`${offersRoot}/${tier.id}/lifecycle`, { method: "POST", token, body: {
  requestId: randomUUID(), version: tier.version, action: "activate",
} }, 201);

const alphaOffer = await request(offersRoot, { method: "POST", token, body: {
  id: randomUUID(), version: 0, vendorId: alpha.vendor.id, catalogRecordId: target.id,
  unitRecordId: unitId, amount: 200, currency: "AED", effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31", sourceType: "vendor_quote", sourceReference: "ALPHA-Q-1",
  taxTreatment: "inclusive", inclusions: ["warranty"],
} }, 201);
await request(`${offersRoot}/${alphaOffer.id}/lifecycle`, { method: "POST", token, body: {
  requestId: randomUUID(), version: alphaOffer.version, action: "activate",
} }, 201);

const optionsQuery = `catalogRecordId=${target.id}&unitRecordId=${unitId}&currency=AED&quantity=15&validOn=2026-09-15`;
const options = await request(`${offersRoot}/options?${optionsQuery}`, { token });
assert.equal(options.options.length, 2, "one applicable tier per vendor/location must be returned");
assert.equal(options.options[0].vendorId, alpha.vendor.id, "choices are stable by vendor name, not cheapest price");
assert.deepEqual(options.options.map((offer) => offer.amount), [200, 90]);
assert.equal((await request(`${offersRoot}/options?${optionsQuery.replace("quantity=15", "quantity=5")}`, { token })).options.find((offer) => offer.vendorId === zeta.vendor.id).quantityFrom, null);
assert.equal((await request(`${offersRoot}/options?${optionsQuery.replace("currency=AED", "currency=USD")}`, { token })).options.length, 0);
assert.match((await request(`${offersRoot}/options?${optionsQuery.replace("&validOn=2026-09-15", "")}`, { token })).validOn, /^\d{4}-\d{2}-\d{2}$/, "default validity date must use the workspace calendar");
await request(`${offersRoot}/options?${optionsQuery.replace("validOn=2026-09-15", "validOn=2026-99-99")}`, { token }, 400);

const currentSite = (await request(`${vendorsRoot}/${zeta.vendor.id}`, { token })).sites.find((site) => site.id === zeta.site.id);
await request(`${vendorsRoot}/${zeta.vendor.id}/sites/${zeta.site.id}/lifecycle`, { method: "POST", token, body: {
  version: currentSite.version, action: "archive", reason: "Should be blocked",
} }, 409);
const currentVendor = await request(`${vendorsRoot}/${zeta.vendor.id}`, { token });
await request(`${vendorsRoot}/${zeta.vendor.id}/lifecycle`, { method: "POST", token, body: {
  version: currentVendor.version, action: "archive", reason: "Should be blocked",
} }, 409);
await request(`${catalogRoot}/records/${target.id}`, { method: "PATCH", token, body: { version: target.version, archived: true } }, 409);

const catalogAfter = await request(catalogRoot, { token });
assert.equal(catalogAfter.items.find((item) => item.id === target.id).version, target.version, "supplier offers must not mutate catalog masters");
const listed = await request(`${offersRoot}?catalogRecordId=${target.id}&search=${encodeURIComponent("ZETA")}`, { token });
assert(listed.data.some((offer) => offer.vendorId === zeta.vendor.id));
await request(`/workspaces/${randomUUID()}/supplier-offers`, { token }, 404);
assert.equal((await raw(offersRoot)).response.status, 401);

console.log(JSON.stringify({ checks: [
  "optional zero/many vendor linkage", "incomplete drafts", "catalog/unit/vendor/site validation",
  "missing versus included zero cost", "concurrent overlap prevention", "idempotent lifecycle commands",
  "active-offer immutability", "quantity tiers separate from MOQ/order multiple", "dated/currency applicability",
  "workspace-local default validity date", "no automatic cheapest selection", "vendor/site/catalog archive guards", "catalog master stability",
  "cost response separation", "workspace membership and authentication",
] }));
