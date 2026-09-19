import assert from "node:assert/strict";
import { chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const web = process.env.WEB_BASE_URL ?? "http://127.0.0.1:3175";
if (!["127.0.0.1", "localhost"].includes(new URL(web).hostname)) {
  throw new Error("The pre-execution smoke may only run against a local web server.");
}
const { QA_WORKSPACE_ID: workspaceId, QA_TENANT_SLUG: slug, QA_OWNER_EMAIL: email, QA_OWNER_PASSWORD: password } = process.env;
if (!workspaceId || !slug || !email) throw new Error("Set QA_WORKSPACE_ID, QA_TENANT_SLUG and QA_OWNER_EMAIL.");
if (!slug.endsWith("-local-qa")) throw new Error("This smoke is restricted to a disposable local QA tenant.");

const browser = await chromium.launch({ headless: true });
const sessionPath = join(tmpdir(), `wodana-local-qa-${workspaceId}.json`);
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(existsSync(sessionPath) ? { storageState: sessionPath } : {}) });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
let stage = "sign-in";
try {
  await page.goto(`${web}/workspace`);
  if (new URL(page.url()).pathname !== "/workspace") {
    if (!password) throw new Error("The saved local QA session expired. Set QA_OWNER_PASSWORD once to renew it.");
    await page.goto(`${web}/login?tenant=${encodeURIComponent(slug)}`);
    await page.getByRole("textbox", { name: "Work email" }).fill(email);
    await page.getByRole("textbox", { name: "Password" }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForFunction(() => location.pathname === "/workspace" || document.body.innerText.includes("Device limit reached") || document.body.innerText.includes("Set up later"));
    const oldDevice = page.getByRole("button", { name: "Log out device" }).first();
    if (await oldDevice.isVisible()) {
      await oldDevice.click();
      await page.waitForFunction(() => location.pathname === "/workspace" || document.body.innerText.includes("Set up later"));
    }
    const deferMfa = page.getByRole("button", { name: "Set up later" });
    if (await deferMfa.isVisible()) await deferMfa.click();
  }
  await page.waitForURL(/\/workspace$/, { timeout: 30_000 });
  await context.storageState({ path: sessionPath });
  chmodSync(sessionPath, 0o600);

  const crm = async (path, { method = "GET", body } = {}) => {
    const url = new URL(`/api/workspace/crm/data/${path}`, web);
    url.searchParams.set("workspaceId", workspaceId);
    const response = await page.request.fetch(url.toString(), { method, ...(body === undefined ? {} : { data: body }) });
    const data = await response.json().catch(() => null);
    assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${JSON.stringify(data)}`);
    return data;
  };

  stage = "CRM configuration";
  const members = await crm("members");
  const owner = members.find((member) => member.roles.includes("owner"));
  assert.ok(owner?.id, "The local QA owner must have an active membership.");
  const pipelines = await crm("pipelines");
  const pipeline = pipelines.find((item) => item.status === "active") ?? await crm("pipelines", { method: "POST", body: {
    code: "local_qa_sales", name: "Local QA sales", isDefault: true,
    stages: [{ code: "qualified", name: "Qualified", position: 1, probability: 40, forecastCategory: "pipeline", entryRequirements: {} }],
  } });
  const settings = await crm("settings");
  const existingForm = settings.qualificationForms.find((item) => item.status === "active" && item.code.startsWith("local_qa_") && item.questions.some((question) => question.key === "scope_confirmed"));
  if (!existingForm) {
    const form = await crm("qualification-forms", { method: "POST", body: {
      code: `local_qa_${Date.now()}`, name: "Local QA qualification",
      questions: [
        { key: "scope_confirmed", label: "Scope confirmed", dataType: "boolean", required: true, position: 1 },
        { key: "property_type", label: "Property type", dataType: "select", required: true, position: 2, configuration: { options: ["Villa", "Apartment"] } },
      ],
    } });
    await crm(`qualification-forms/${form.id}`, { method: "PATCH", body: { version: form.version, status: "active" } });
  }

  stage = "create enquiry";
  const name = `Local QA client ${Date.now()}`;
  await page.goto(`${web}/workspace/crm/leads`);
  await page.getByRole("button", { name: "Add enquiry" }).click();
  await page.getByRole("textbox", { name: "Customer name" }).fill(name);
  await page.getByRole("textbox", { name: "Email" }).fill(`qa-${Date.now()}@example.com`);
  await page.getByText("Assignment", { exact: true }).locator("..").getByRole("button").click();
  await page.getByRole("option", { name: "Leave unassigned" }).click();
  await page.getByRole("button", { name: "Create enquiry" }).click();
  await page.getByText(name).first().waitFor();
  const leads = await crm("leads?limit=100");
  const lead = leads.data.find((item) => item.partyName === name);
  assert.ok(lead, "The sample enquiry must appear in CRM.");

  stage = "qualification UI";
  await page.goto(`${web}/workspace/crm/leads?lead=${lead.id}`);
  await page.getByRole("button", { name: "Qualification", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Local QA qualification" });
  await dialog.getByRole("button", { name: "Scope confirmed" }).click();
  await page.getByRole("option", { name: "Yes" }).click();
  await dialog.getByRole("button", { name: "Property type" }).click();
  await page.getByRole("option", { name: "Villa" }).click();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const qualified = await crm(`leads/${lead.id}`);
  assert.equal(qualified.qualificationState.ready, true);
  assert.equal(qualified.qualification.find((answer) => answer.questionKey === "scope_confirmed")?.value, true);
  assert.equal(qualified.qualification.find((answer) => answer.questionKey === "property_type")?.value, "Villa");

  stage = "opportunity conversion";
  const opportunity = await crm(`leads/${lead.id}/qualify`, { method: "POST", body: {
    leadVersion: qualified.version, partyId: lead.partyId, pipelineId: pipeline.id,
    ownerMembershipId: owner.id, title: `Local QA interior project ${Date.now()}`,
    nextActionAt: new Date(Date.now() + 86_400_000).toISOString(),
  } });
  assert.equal(opportunity.leadId, lead.id);

  stage = "pre-execution start";
  await page.goto(`${web}/workspace/pre-projects`);
  await page.getByRole("button", { name: `Start ${opportunity.title}` }).click();
  await page.waitForURL(/\/workspace\/pre-projects\/cases\//, { timeout: 30_000 });
  const caseId = page.url().match(/\/cases\/([^/?]+)/)?.[1];
  assert.ok(caseId);
  const caseResponse = await page.request.get(`${web}/api/workspace/pre-projects/${caseId}?workspaceId=${workspaceId}`);
  assert.equal(caseResponse.status(), 200, await caseResponse.text());
  const prepared = await caseResponse.json();
  assert.equal(prepared.opportunityId, opportunity.id);
  stage = "case lifecycle UI";
  await page.goto(`${web}/workspace/pre-projects/cases/${caseId}/overview`);
  await page.getByRole("button", { name: "Edit case" }).click();
  await page.getByLabel("Priority").selectOption("high");
  await page.getByRole("button", { name: "Save case" }).click();
  await page.getByRole("status").getByText("Case details updated.").waitFor();
  await page.getByRole("button", { name: "Put on hold" }).click();
  const holdDialog = page.getByRole("dialog", { name: "Put on hold" });
  await holdDialog.getByLabel("Reason *").fill("Waiting for local QA scope review");
  await holdDialog.getByRole("button", { name: "Put on hold" }).click();
  await page.getByRole("button", { name: "Resume" }).click();
  await page.getByRole("dialog", { name: "Resume" }).getByRole("button", { name: "Resume" }).click();
  await page.getByRole("button", { name: "Put on hold" }).waitFor();
  stage = "scope confirmation";
  await page.goto(`${web}/workspace/pre-projects/cases/${caseId}/definition`);
  await page.getByRole("heading", { name: "Scope confirmation" }).waitFor();
  await page.getByRole("region", { name: "Scope to finish" }).waitFor();
  const definitionResponse = await page.request.get(`${web}/api/workspace/pre-projects/${caseId}/definition-baselines?workspaceId=${workspaceId}`);
  assert.equal(definitionResponse.status(), 200, await definitionResponse.text());
  assert.equal((await definitionResponse.json()).draft.readyToPublish, false);
  stage = "quotation composer gate";
  await page.goto(`${web}/workspace/pre-projects/cases/${caseId}/quotations`);
  await page.getByRole("button", { name: "Create quotation" }).click();
  await page.waitForURL(/quote=[0-9a-f-]{36}/, { timeout: 30_000 });
  await page.getByRole("region", { name: "Build from confirmed scope" }).getByRole("button", { name: "Open" }).click();
  await page.getByText("Client confirmation needed").waitFor();
  await page.getByText(/Confirm the current requirements in/).waitFor();
  console.log(JSON.stringify({ ok: true, workspaceId, leadId: lead.id, opportunityId: opportunity.id, caseId, flow: ["authenticated_qa_session", "enquiry_ui", "tenant_qualification_ui", "opportunity_conversion", "case_profile_and_lifecycle_ui", "scope_readiness_ui", "quotation_composer_gate"] }));
} catch (error) {
  console.error(`Local pre-execution smoke failed at ${stage}: ${String(error)}`);
  console.error((await page.locator("body").innerText().catch(() => "")).slice(-1600));
  process.exitCode = 1;
} finally {
  await browser.close();
}
