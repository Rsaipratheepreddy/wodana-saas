import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const web = process.env.WEB_BASE_URL ?? "http://127.0.0.1:3175";
const { QA_WORKSPACE_ID: workspaceId, QA_TENANT_SLUG: slug, QA_CASE_ID: caseId } = process.env;
if (!["127.0.0.1", "localhost"].includes(new URL(web).hostname) || !slug?.endsWith("-local-qa") || !workspaceId || !caseId)
  throw new Error("Set a disposable local QA workspace, slug and case; remote URLs are not allowed.");
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

  stage = "included requirement";
  const suffix = Date.now().toString(36).toUpperCase(), roomId = randomUUID(), scopeId = randomUUID();
  const title = `QA confirmed wardrobe ${suffix}`;
  const content = `/api/workspace/pre-projects/${caseId}`;
  await api(`${content}/rooms`, "PUT", { id: roomId, version: 0, name: `QA room ${suffix}` });
  await api(`${content}/entries`, "PUT", { id: scopeId, version: 0, kind: "requirement", title, roomId,
    note: "Client requested a fitted wardrobe for local verification.", category: "Joinery", priority: "must_have",
    scopeStatus: "included", reviewStatus: "reviewed", quantity: 1, unit: "nos", referenceUrl: "", avoid: "",
    source: "client", assetIds: [], catalogLinks: [] });
  await api(`${content}/specifications/${scopeId}`, "PUT", { version: 0,
    refinedRequirement: "One fitted wardrobe with soft-close doors.", construction: "Joinery",
    inclusions: "Wardrobe carcass and doors", exclusions: "Loose furniture", assumptions: "Final dimensions to be confirmed on site",
    materials: [], dimensions: [], designRefs: [] });
  const before = await api(`${content}/definition-baselines`);
  assert.equal(before.draft.readyToPublish, true, JSON.stringify(before.draft.issues));

  stage = "client definition confirmation UI";
  await page.goto(`${web}/workspace/pre-projects/cases/${caseId}/definition`);
  await page.getByRole("button", { name: "Send for confirmation" }).click();
  await page.getByText("Awaiting client confirmation").first().waitFor();
  await page.getByRole("button", { name: "Record offline decision" }).click();
  const dialog = page.getByRole("dialog", { name: "Record client decision" });
  await dialog.getByLabel("Client name").fill("Local QA client");
  await dialog.getByLabel("Evidence reference").fill("Local QA meeting record");
  await dialog.getByRole("button", { name: "Save decision" }).click();
  await page.getByText("Client confirmed").first().waitFor();
  const confirmed = await api(`${content}/definition-baselines`);
  assert.equal(confirmed.confirmed, true);

  stage = "confirmed-scope quotation composer UI";
  const commercial = `/api/commercial/cases/${caseId}`;
  const state = await api(commercial);
  const quote = state.data.quotes.find((item) => item.status === "draft");
  assert.ok(quote, "A draft quotation is required for the local composer smoke.");
  await page.goto(`${web}/workspace/pre-projects/cases/${caseId}/quotations?quote=${quote.id}`);
  const composer = page.getByRole("region", { name: "Build from confirmed scope" });
  await composer.getByRole("button", { name: "Open" }).click();
  await composer.getByText(/Client-confirmed version/).waitFor();
  await composer.getByRole("button", { name: "Prepare items from scope" }).click();
  await composer.getByText(new RegExp(title)).waitFor();
  await composer.getByRole("button", { name: /Add \d+ selected/ }).click();
  await composer.getByText(/items? added/).waitFor();
  const saved = (await api(commercial)).data.quotes.find((item) => item.id === quote.id);
  assert.ok(saved.lines.some((line) => line.scopeId === scopeId), "The confirmed requirement must be linked to the quotation item.");
  console.log(JSON.stringify({ ok: true, caseId, quoteId: quote.id, scopeId, baselineId: confirmed.current.id, flow: ["reviewed_requirement", "definition_publish_ui", "offline_client_decision_ui", "confirmed_scope_proposal_ui", "linked_quote_line"] }));
} catch (error) {
  console.error(`Local definition-composer smoke failed at ${stage}: ${String(error)}`);
  console.error((await page.locator("body").innerText().catch(() => "")).slice(-1500));
  process.exitCode = 1;
} finally {
  await browser.close();
}
