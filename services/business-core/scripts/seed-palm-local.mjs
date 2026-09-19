import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { palmLivingBrandFixture, palmLivingCatalogImport } from "./palm-living-fixture.mjs";

const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8166/api/v1";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(api).hostname)) {
  throw new Error("Palm local seeding is restricted to a loopback Business Core.");
}
const actor = {
  "x-wodana-user-subject": "palm-living-local-operations",
  "x-wodana-user-email": "operations@palmlivingae.com",
  "x-wodana-user-name": "Palm Living Operations",
};

async function request(path, { body, method = body === undefined ? "GET" : "POST", expected = method === "POST" ? 201 : 200 } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { ...actor, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}

let profile = await request("/me");
let membership = profile.memberships.find((row) => row.workspaceSlug === "palm-living");
if (!membership) {
  const created = await request("/workspaces", {
    body: {
      name: "Palm Living",
      slug: "palm-living",
      defaultCurrency: "AED",
      defaultLocale: "en-AE",
      defaultTimezone: "Asia/Dubai",
      unitSystem: "metric",
      weekStartsOn: 1,
      firstLegalEntity: {
        code: "PALM",
        displayName: "Palm Living",
        registeredName: "Palm Living",
        countryCode: "AE",
        baseCurrency: "AED",
        locale: "en-AE",
        timezone: "Asia/Dubai",
      },
    },
  });
  membership = { workspaceId: created.workspace.id, workspaceSlug: created.workspace.slug };
}

const workspaceId = membership.workspaceId;
const detail = await request(`/workspaces/${workspaceId}`);
const appearance = await request(`/workspaces/${workspaceId}/appearance`, {
  method: "PUT",
  expected: 200,
  body: {
    workspaceVersion: detail.workspace.version,
    primaryColor: palmLivingBrandFixture.primaryColor,
    secondaryColor: palmLivingBrandFixture.secondaryColor,
    headingFont: palmLivingBrandFixture.headingFont.token,
    bodyFont: palmLivingBrandFixture.bodyFont.token,
  },
});

const catalogId = "4a1fe7ea-f2eb-5a83-9e0a-e41a4556ce96";
await request(`/workspaces/${workspaceId}/catalog/collections`, {
  body: {
    id: catalogId,
    name: "Palm Living electrical materials",
    description: "Client-supplied electrical materials pending commercial and stock review.",
    starter: false,
  },
});
const source = palmLivingCatalogImport(catalogId);
const preview = await request(`/workspaces/${workspaceId}/catalog/import`, { body: { ...source, dryRun: true } });
const imported = await request(`/workspaces/${workspaceId}/catalog/import`, { body: { ...source, dryRun: false } });
assert.equal(preview.created + preview.reused, 41);
assert.equal(imported.created + imported.reused, 41);

const publicBrand = await request("/auth/tenant/palm-living");
assert.equal(publicBrand.primaryColor, "#E4E3DE");
assert.equal(publicBrand.secondaryColor, "#000000");
profile = await request("/me");
assert(profile.memberships.some((row) => row.workspaceId === workspaceId && row.workspaceBodyFont === "montserrat"));

process.stdout.write(`${JSON.stringify({
  ok: true,
  workspaceId,
  workspaceVersion: appearance.workspace.version,
  catalogue: { id: catalogId, records: 41, created: imported.created, reused: imported.reused },
  operator: actor["x-wodana-user-email"],
  brand: {
    primaryColor: appearance.primaryColor,
    secondaryColor: appearance.secondaryColor,
    headingFont: appearance.headingFont,
    bodyFont: appearance.bodyFont,
  },
  runId: randomUUID(),
}, null, 2)}\n`);
