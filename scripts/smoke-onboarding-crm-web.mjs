import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";

const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8165/api/v1";
const web = process.env.WEB_BASE_URL ?? "http://127.0.0.1:3165";
const internalToken = process.env.BUSINESS_CORE_INTERNAL_TOKEN ?? "local-development-token";
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const slug = "plm";
const customerName = `Palm sample ${runId}`;

const provision = await fetch(`${api}/internal/tenants`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-wodana-internal-token": internalToken,
    "idempotency-key": `web-smoke-${runId}`,
  },
  body: JSON.stringify({
    externalTenantId: `web-smoke-${runId}`,
    owner: { email: `owner-${runId}@example.com`, displayName: "Palm Owner" },
    name: "Palm Living Test",
    slug,
    defaultCurrency: "AED",
    defaultLocale: "en-AE",
    defaultTimezone: "Asia/Dubai",
    unitSystem: "metric",
    weekStartsOn: 1,
    firstLegalEntity: {
      code: "PLM",
      displayName: "Palm Living Test",
      registeredName: "Palm Living Test LLC",
      countryCode: "AE",
      baseCurrency: "AED",
      locale: "en-AE",
      timezone: "Asia/Dubai",
    },
  }),
});
const tenant = await provision.json();
assert.equal(provision.status, 201, JSON.stringify(tenant));
assert.ok(tenant.ownerInvitation.invitationToken);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(20_000);
let stage = "invitation";
try {
  await page.goto(`${web}/login?tenant=${slug}&invitation=${tenant.ownerInvitation.invitationToken}`);
  await page.getByRole("heading", { name: "Create your password" }).waitFor();
  await page.getByRole("textbox", { name: "New password" }).fill(`LocalSmoke#${runId}Aa1!`);
  await page.getByRole("textbox", { name: "Confirm password" }).fill(`LocalSmoke#${runId}Aa1!`);
  await page.getByRole("button", { name: "Activate invitation" }).click();
  await page.waitForFunction(() => location.pathname === "/onboarding"
    || Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.includes("Set up later")));
  const setupLater = page.getByRole("button", { name: "Set up later" });
  if (await setupLater.isVisible().catch(() => false)) await setupLater.click();

  stage = "onboarding";
  await page.waitForURL(/\/onboarding$/, { timeout: 30_000 });
  await page.getByRole("heading", { name: "Tell us about your company" }).waitFor();
  if (process.env.PALM_LOGO_PNG) {
    await page.getByLabel("Choose company logo").setInputFiles(process.env.PALM_LOGO_PNG);
    await page.getByText("Company logo saved").waitFor();
    const logo = await page.request.get(`${web}/api/auth/tenant-logo/${slug}`);
    assert.equal(logo.status(), 200, await logo.text());
    assert.match(logo.headers()["content-type"] ?? "", /^image\/(?:png|webp)/);
  }
  await page.getByRole("button", { name: /Save and continue/ }).click();
  await page.getByRole("heading", { name: "Set your workspace defaults" }).waitFor();
  await page.getByRole("button", { name: /Save and continue/ }).click();
  await page.getByRole("heading", { name: "Seats & people" }).waitFor();
  // A workspace without a seat plan shows no seat error; invitations are still checked on the server.
  assert.equal(await page.getByText("Seat availability could not be loaded").count(), 0);
  await page.getByRole("button", { name: /^(Continue|Skip for now)/ }).click();
  await page.getByRole("heading", { name: "Connect the tools you use" }).waitFor();
  await page.getByRole("button", { name: /Finish setup/ }).click();
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await page.waitForURL(/\/workspace$/, { timeout: 30_000 });

  if ((process.env.WODANA_CRM_ONLY_WORKSPACE_SLUGS ?? "").split(",").includes(slug)) {
    stage = "CRM-first rollout";
    await page.goto(`${web}/workspace/pre-projects`);
    await page.waitForURL(/\/workspace\/coming-soon\?module=pre-project$/);
    await page.getByRole("heading", { name: "Pre-execution is being prepared for your team." }).waitFor();
    await page.goto(`${web}/workspace/projects`);
    await page.waitForURL(/\/workspace\/coming-soon\?module=projects$/);
  }

  stage = "CRM enquiry";
  const crm = async (path, { method = "GET", body } = {}) => {
    const url = new URL(`/api/workspace/crm/data/${path}`, web);
    url.searchParams.set("workspaceId", tenant.workspace.id);
    const response = await page.request.fetch(url.toString(), {
      method, ...(body ? { data: body } : {}),
    });
    const data = await response.json().catch(() => null);
    assert.equal(response.status(), method === "POST" ? 201 : 200, `${method} ${path}: ${response.status()} ${JSON.stringify(data)}`);
    return data;
  };
  const members = await crm("members");
  const owner = members.find((member) => member.roles.includes("owner"));
  assert.ok(owner?.id, "The activated owner needs an active membership");
  const queue = await crm("queues", { method: "POST", body: { code: "sales", name: "Sales team", isFallback: true } });
  await crm(`queues/${queue.id}/members`, { method: "PUT", body: { membershipId: owner.id, capacity: 100, weight: 1, isAvailable: true } });
  const options = await crm("lead-options");
  assert.ok(options.channels.company.some((channel) => channel.id === "instagram"));

  await page.goto(`${web}/workspace/crm/leads`);
  await page.getByRole("button", { name: "New enquiry" }).click();
  await page.getByRole("textbox", { name: "Customer name" }).fill(customerName);
  await page.getByRole("textbox", { name: "Email" }).fill(`customer-${runId}@example.com`);
  await page.getByText("Assignment", { exact: true }).locator("..").getByRole("button").click();
  await page.getByRole("option", { name: "Leave unassigned" }).click();
  await page.getByRole("button", { name: "Create enquiry" }).click();
  await page.getByText(customerName).first().waitFor();

  stage = "CRM readback";
  const response = await page.request.get(`${web}/api/workspace/crm/data/leads?workspaceId=${tenant.workspace.id}`);
  assert.equal(response.status(), 200, await response.text());
  const leads = await response.json();
  assert.ok(leads.data.some((lead) => lead.partyName === customerName));

  stage = "social shared form";
  const draftForm = await crm("lead-forms", { method: "POST", body: {} });
  const form = await crm(`lead-forms/${draftForm.id}`, { method: "PATCH", body: {
    version: draftForm.version, action: "publish",
    draft: { ...draftForm.draft, title: "Palm Living project enquiry", source: "company", channel: "instagram" },
  } });
  const publicResponse = await page.request.get(`${api}/public/crm/lead-forms/${form.token}`);
  assert.equal(publicResponse.status(), 200);
  const publicForm = await publicResponse.json();
  assert.equal(publicForm.branding.displayName, "Palm Living Test");
  assert.equal(publicForm.source, undefined);
  assert.equal(publicForm.channel, undefined);
  assert.ok(publicForm.questions.every((question) => question.field === undefined));
  const publicPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await publicPage.goto(`${web}/enquiry/${form.token}`);
    await publicPage.getByRole("heading", { name: "Palm Living project enquiry" }).waitFor();
    await publicPage.getByText("Palm Living Test", { exact: true }).waitFor();
    await publicPage.getByRole("textbox", { name: "Your name" }).fill(`Social customer ${runId}`);
    await publicPage.getByRole("textbox", { name: "Mobile number" }).fill("+971501234567");
    await publicPage.getByRole("textbox", { name: "Property location" }).fill("Dubai Marina");
    await publicPage.getByRole("button", { name: /What can we help with/ }).click();
    await publicPage.getByRole("option", { name: "Not Sure Yet" }).click();
    await publicPage.getByRole("button", { name: "Submit enquiry" }).click();
    await publicPage.getByRole("heading", { name: "Thank you for your enquiry" }).waitFor();
  } finally { await publicPage.close(); }
  const socialLeads = await crm("leads?limit=100");
  const socialLead = socialLeads.data.find((lead) => lead.partyName === `Social customer ${runId}`);
  assert.ok(socialLead, "The shared form response must appear in CRM");
  assert.equal(socialLead.source, "company");
  assert.equal(socialLead.channel, "instagram");
  assert.equal(socialLead.intakeMethod, "form");
  assert.equal(socialLead.ownerMembershipId, owner.id);
  const socialDetail = await crm(`leads/${socialLead.id}`);
  assert.equal(socialDetail.enquiry.details.location, "Dubai Marina");
  assert.equal(socialDetail.enquiry.originalSubmission.formAnswers.length, form.draft.questions.length);

  stage = "shared-link channel attribution";
  for (const channel of ["whatsapp", "linkedin", "tiktok", "website", "walk_in"]) {
    const created = await crm("lead-forms", { method: "POST", body: {} });
    const published = await crm(`lead-forms/${created.id}`, { method: "PATCH", body: {
      version: created.version, action: "publish",
      draft: { ...created.draft, title: `${channel} test enquiry`, source: "company", channel },
    } });
    const live = await (await page.request.get(`${api}/public/crm/lead-forms/${published.token}`)).json();
    const values = { displayName: `${channel} customer ${runId}`, mobile: `+97150${String(Math.floor(Math.random() * 1_000_0000)).padStart(7, "0")}`, location: "Dubai", serviceType: "not_sure", budgetRange: "", email: "", summary: "" };
    const answers = Object.fromEntries(published.draft.questions.map((question) => [question.id, values[question.field] ?? ""]));
    const submitted = await page.request.post(`${api}/public/crm/lead-forms/${published.token}`, { data: { requestId: randomUUID(), revision: live.revision, answers, serviceConsent: true } });
    assert.equal(submitted.status(), 201, `${channel}: ${await submitted.text()}`);
    const listed = await crm(`leads?search=${encodeURIComponent(`${channel} customer ${runId}`)}`);
    assert.ok(listed.data.some((lead) => lead.channel === channel && lead.intakeMethod === "form" && lead.ownerMembershipId === owner.id), `${channel} enquiry was not routed`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, workspaceId: tenant.workspace.id, flow: ["invitation", "onboarding_ui", "workspace_ui", "crm_create_ui", "crm_readback", "branded_shared_form", "social_channel_routing"] }, null, 2)}\n`);
} catch (error) {
  const visibleText = await page.locator("body").innerText().catch(() => "");
  process.stderr.write(`Browser flow failed at ${stage}. Visible page text: ${visibleText.slice(0, 1200)}\n`);
  throw error;
} finally {
  await browser.close();
}
