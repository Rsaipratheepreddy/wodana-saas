import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const web = process.env.WEB_BASE_URL ?? "http://127.0.0.1:3175";
const { QA_WORKSPACE_ID: workspaceId, QA_TENANT_SLUG: slug, QA_CASE_ID: caseId } = process.env;
if (!["127.0.0.1", "localhost"].includes(new URL(web).hostname) || !slug?.endsWith("-local-qa") || !workspaceId || !caseId)
  throw new Error("Set the disposable local QA workspace, slug and case; remote URLs are not allowed.");
const sessionPath = join(tmpdir(), `wodana-local-qa-${workspaceId}.json`);
if (!existsSync(sessionPath)) throw new Error("Run the local pre-execution smoke once to establish a QA session.");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: sessionPath });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
let stage = "session";
try {
  await page.goto(`${web}/workspace`);
  assert.equal(new URL(page.url()).pathname, "/workspace", "The disposable QA session must still be active.");
  async function api(path, method = "GET", body) {
    const url = new URL(path, web);
    url.searchParams.set("workspaceId", workspaceId);
    const response = await page.request.fetch(url.toString(), { method, ...(body === undefined ? {} : { data: body }) });
    const data = await response.json().catch(() => null);
    assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${JSON.stringify(data)}`);
    return data;
  }

  stage = "verified local price book";
  const suffix = Date.now().toString(36).toUpperCase();
  const catalogId = randomUUID(), unitId = randomUUID(), workId = randomUUID(), rateId = randomUUID();
  await api("/api/workspace/catalog/collections", "POST", { id: catalogId, name: `Local QA price book ${suffix}`, starter: false });
  const base = (kind, id, code, name) => ({ catalogId, id, version: 0, kind, code, name, description: "Disposable local QA fixture", market: "AE", aliases: [], attributes: [], sizes: [], sources: [], links: [], specificationStatus: "workspace_verified", dimension: "none" });
  const unit = await api("/api/workspace/catalog/records", "PUT", { ...base("unit", unitId, `NOS_${suffix}`, `Each ${suffix}`), dimension: "count", baseFactor: 1 });
  const work = await api("/api/workspace/catalog/records", "PUT", { ...base("work", workId, `JOINERY_${suffix}`, `QA joinery ${suffix}`), commerce: { pricingMode: "fixed" }, links: [{ relation: "unit", targetId: unitId }] });
  await api("/api/workspace/catalog/records", "PUT", { ...base("rate_card", rateId, `SALE_${suffix}`, `QA selling price ${suffix}`), links: [{ relation: "unit", targetId: unitId }, { relation: "work", targetId: workId }], configuration: { amount: 275, currency: "AED", effectiveFrom: "2026-01-01", costIncludes: "labour", taxIncluded: "no", priceType: "selling" } });

  stage = "quotation save";
  const commercial = `/api/commercial/cases/${caseId}`;
  const state = await api(commercial);
  const quote = state.data.quotes.find((item) => item.status === "draft");
  assert.ok(quote, "The local QA case needs a draft quotation.");
  const lineId = randomUUID(), title = `QA priced wardrobe ${suffix}`;
  quote.lines.push({ id: lineId, room: "Local QA", title, specification: "Disposable selling-price check", material: "", finish: "", quantity: 2, unit: unit.code, unitCost: 0, rate: 0, pricingMode: "item", catalogLinks: [
    { role: "work", recordId: work.id, version: work.version, snapshot: work },
    { role: "unit", recordId: unit.id, version: unit.version, snapshot: unit },
  ] });
  await api(commercial, "POST", { action: "save", revision: state.data.revision, quoteId: quote.id, quote });
  const priced = (await api(commercial)).data.quotes.find((item) => item.id === quote.id).lines.find((item) => item.id === lineId);
  assert.equal(priced.rate, 275);
  assert.equal(priced.catalogPrice?.status, "resolved");

  stage = "browser price refresh";
  await page.goto(`${web}/workspace/pre-projects/cases/${caseId}/quotations?quote=${quote.id}`);
  const table = page.getByRole("region", { name: "Editable quotation table" });
  await table.getByLabel(`Quantity for ${title}`).fill("3");
  await table.getByLabel(`Quantity for ${title}`).press("Tab");
  await table.getByText("Price needs refresh").waitFor();
  await table.getByRole("button", { name: "Check price" }).click();
  await table.getByText("Catalog price").waitFor();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("status").getByText("Quotation saved.").waitFor();
  const saved = (await api(commercial)).data.quotes.find((item) => item.id === quote.id).lines.find((item) => item.id === lineId);
  assert.equal(saved.quantity, 3);
  assert.equal(saved.rate, 275);
  assert.equal(saved.catalogPrice.status, "resolved");
  assert.equal(saved.catalogPrice.quantity, 3);
  assert.equal(saved.catalogPriceRequest, undefined);
  console.log(JSON.stringify({ ok: true, caseId, quoteId: quote.id, catalogId, lineId, flow: ["verified_selling_price", "quotation_auto_price", "browser_price_refresh", "authoritative_save"] }));
} catch (error) {
  console.error(`Local catalogue price smoke failed at ${stage}: ${String(error)}`);
  console.error((await page.locator("body").innerText().catch(() => "")).slice(-1200));
  process.exitCode = 1;
} finally {
  await browser.close();
}
