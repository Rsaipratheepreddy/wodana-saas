import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const web = process.env.WEB_BASE_URL ?? "http://127.0.0.1:3175";
const { QA_WORKSPACE_ID: workspaceId, QA_TENANT_SLUG: slug, QA_OWNER_EMAIL: email, QA_OWNER_PASSWORD: password } = process.env;
if (!["127.0.0.1", "localhost"].includes(new URL(web).hostname) || !slug?.endsWith("-local-qa") || !workspaceId) {
  throw new Error("A disposable local QA tenant and local web URL are required.");
}
const session = join(tmpdir(), `wodana-local-qa-${workspaceId}.json`);
if (!existsSync(session)) throw new Error("Run local pre-execution smoke first to establish a QA session.");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: session, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
let stage = "session";
try {
  await page.goto(`${web}/workspace/crm/leads`);
  if (new URL(page.url()).pathname === "/login") {
    if (!email || !password) throw new Error("The saved QA session expired. Set QA_OWNER_EMAIL and QA_OWNER_PASSWORD to renew it.");
    await page.goto(`${web}/login?tenant=${encodeURIComponent(slug)}`);
    await page.getByRole("textbox", { name: "Work email" }).fill(email);
    await page.getByRole("textbox", { name: "Password" }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/workspace(?:\/crm\/leads)?$/, { timeout: 30_000 });
    await page.goto(`${web}/workspace/crm/leads`);
  }
  assert.equal(new URL(page.url()).pathname, "/workspace/crm/leads");
  await context.storageState({ path: session });
  chmodSync(session, 0o600);
  const api = async (path, method = "GET", body) => {
    const url = new URL(`/api/workspace/crm/data/${path}`, web);
    url.searchParams.set("workspaceId", workspaceId);
    const response = await page.request.fetch(url.toString(), { method, ...(body === undefined ? {} : { data: body }) });
    const data = await response.json().catch(() => null);
    assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${JSON.stringify(data)}`);
    return data;
  };

  stage = "routing";
  const members = await api("members");
  const owner = members.find(member => member.roles.includes("owner"));
  assert.ok(owner?.id);
  const queues = await api("queues");
  const queue = queues.find(item => item.isFallback && item.status === "active")
    ?? await api("queues", "POST", { code: `local_qa_alerts_${Date.now()}`, name: "Local QA Sales", isFallback: true });
  await api(`queues/${queue.id}/members`, "PUT", { membershipId: owner.id, capacity: 1000, isAvailable: true });
  const choices = await api("lead-options");
  const source = choices.sources.find(item => item.id === "company") ?? choices.sources[0];
  const channel = choices.channels[source.id]?.find(item => item.id === "website") ?? choices.channels[source.id]?.[0];
  const serviceType = choices.enquiryTypes[0];
  assert.ok(source && channel && serviceType);

  stage = "new enquiry";
  const requestId = randomUUID();
  const response = await page.request.post(`${web}/api/workspace/crm/leads`, { data: {
    workspaceId, requestId, displayName: `Local alert QA ${Date.now()}`,
    email: `alert-${requestId}@example.com`, title: "Local notification test",
    source: source.id, channel: channel.id, serviceType: serviceType.id,
    assignment: { mode: "automatic" },
  } });
  const created = await response.json().catch(() => null);
  assert.ok(response.ok(), `Create enquiry: ${response.status()} ${JSON.stringify(created)}`);
  assert.equal(created.status, "ready");
  assert.ok(created.leadId);

  stage = "recipient inbox";
  const alerts = await api("notifications");
  const alert = alerts.find(item => item.deepLink === `/workspace/crm/leads?lead=${created.leadId}`);
  assert.equal(alert?.subject, "New enquiry assigned");
  await page.reload();
  await page.getByRole("button", { name: /Notifications, .* unread/ }).click();
  const dialog = page.getByRole("dialog", { name: "Notifications" });
  await dialog.getByRole("link", { name: /New enquiry assigned/ }).first().waitFor();
  assert.equal(await dialog.locator(`a[href="/workspace/crm/leads?lead=${created.leadId}"]`).count(), 1);
  await Promise.all([
    page.waitForResponse(result => result.url().includes(`/notifications/${alert.id}/read`) && result.status() === 201),
    dialog.locator(`a[href="/workspace/crm/leads?lead=${created.leadId}"]`).click(),
  ]);
  assert.ok((await api("notifications")).find(item => item.id === alert.id)?.readAt);
  console.log(JSON.stringify({ ok: true, workspaceId, leadId: created.leadId, assignmentAlert: "browser-visible-and-read", delivery: "local-in-app" }));
} catch (error) {
  throw new Error(`Local assignment-alert smoke failed at ${stage}: ${error.message}`);
} finally {
  await browser.close();
}
