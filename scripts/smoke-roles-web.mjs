import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8164/api/v1";
const web = process.env.WEB_BASE_URL ?? "http://127.0.0.1:3165";
const internalToken = process.env.BUSINESS_CORE_INTERNAL_TOKEN ?? "local-development-token";
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const slug = `role-smoke-${runId}`;

const provision = await fetch(`${api}/internal/tenants`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-wodana-internal-token": internalToken,
    "idempotency-key": `roles-web-${runId}`,
  },
  body: JSON.stringify({
    externalTenantId: `roles-web-${runId}`,
    owner: { email: `owner-${runId}@example.com`, displayName: "Workspace Owner" },
    name: "Roles Smoke Workspace",
    slug,
    defaultCurrency: "AED",
    defaultLocale: "en-AE",
    defaultTimezone: "Asia/Dubai",
    unitSystem: "metric",
    weekStartsOn: 1,
    firstLegalEntity: {
      code: "ROLE",
      displayName: "Roles Smoke Workspace",
      registeredName: "Roles Smoke Workspace LLC",
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
const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const owner = await ownerContext.newPage();
const browserErrors = [];
owner.on("pageerror", (error) => browserErrors.push(`owner: ${error.message}`));
owner.setDefaultTimeout(20_000);
let stage = "owner activation";
let activePage = owner;

async function activateInvitation(page, token) {
  await page.goto(`${web}/login?tenant=${slug}&invitation=${token}`);
  await page.getByRole("heading", { name: "Create your password" }).waitFor();
  const password = `LocalRoles#${runId}Aa1!`;
  await page.getByRole("textbox", { name: "New password" }).fill(password);
  await page.getByRole("textbox", { name: "Confirm password" }).fill(password);
  await page.getByRole("button", { name: "Activate invitation" }).click();
  await page.waitForFunction(() => location.pathname === "/onboarding"
    || location.pathname === "/workspace"
    || Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.includes("Set up later")));
  const setupLater = page.getByRole("button", { name: "Set up later" });
  if (await setupLater.isVisible().catch(() => false)) await setupLater.click();
  await page.waitForURL((url) => ["/onboarding", "/workspace"].includes(url.pathname), { waitUntil: "load" });
}

async function invite(email, roleCodes) {
  const response = await owner.request.post(`${web}/api/workspace/members/invitations`, {
    data: { workspaceId: tenant.workspace.id, email, roleCodes, teamIds: [] },
  });
  const payload = await response.json();
  assert.equal(response.status(), 201, JSON.stringify(payload));
  assert.ok(payload.invitationToken, "Local invitation must include an activation token");
  return payload.invitationToken;
}

async function backend(path, { token, method = "GET", data, expected = 200 }) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(data ? { "content-type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const payload = await response.json().catch(() => null);
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  return payload;
}

async function accessToken(context) {
  const token = (await context.cookies(web)).find((cookie) => cookie.name === "wodana_access")?.value;
  assert.ok(token, "The signed-in browser context needs an access token");
  return token;
}

try {
  await activateInvitation(owner, tenant.ownerInvitation.invitationToken);
  stage = "owner onboarding";
  await owner.waitForURL(/\/onboarding$/, { timeout: 30_000 });
  await owner.getByRole("heading", { name: "Tell us about your company" }).waitFor();
  await owner.getByRole("button", { name: /Save and continue/ }).click();
  await owner.getByRole("heading", { name: "Set your workspace defaults" }).waitFor();
  await owner.getByRole("button", { name: /Save and continue/ }).click();
  await owner.getByRole("heading", { name: "Seats & people" }).waitFor();
  await owner.getByRole("button", { name: "Skip for now" }).click();
  await owner.getByRole("heading", { name: "Connect the tools you use" }).waitFor();
  await owner.getByRole("button", { name: /Finish setup/ }).click();
  await owner.getByRole("button", { name: "Enter workspace" }).click();
  await owner.waitForURL(/\/workspace$/, { timeout: 30_000 });

  stage = "owner role creation";
  await owner.goto(`${web}/workspace/roles`);
  await owner.getByRole("heading", { name: "Roles & permissions" }).waitFor();
  await owner.getByRole("button", { name: "Custom role" }).click();
  const dialog = owner.getByRole("dialog", { name: "Create custom role" });
  await dialog.getByRole("textbox", { name: "Role name" }).fill("Role viewer");
  const roleCreated = owner.waitForResponse((response) => response.url().endsWith("/api/workspace/roles")
    && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Save role" }).click();
  const createdRole = await (await roleCreated).json();
  assert.equal(createdRole.code, "role_viewer");
  await owner.getByText("Role viewer was saved.").waitFor();
  const readSwitch = owner.getByRole("switch", { name: "Role viewer: View roles and permissions" });
  await readSwitch.locator("xpath=ancestor::label").click();
  assert.equal(await readSwitch.isChecked(), true);
  await owner.getByRole("button", { name: "Save changes" }).click();
  await owner.getByText("Role viewer permissions updated.").waitFor();

  stage = "permission catalogue parity";
  const ownerToken = await accessToken(ownerContext);
  const definitions = await backend("/reference/permissions", { token: ownerToken });
  const fixtureSource = readFileSync(new URL("../apps/web/lib/workspace/roles-permissions.ts", import.meta.url), "utf8");
  const fixtureList = fixtureSource.match(/const FIXTURE_PERMISSION_CODES = \[([\s\S]*?)\] as const;/)?.[1];
  assert.ok(fixtureList, "The web permission fixture must be present");
  const fixtureCodes = [...fixtureList.matchAll(/"([a-z0-9_.]+)"/g)].map((match) => match[1]);
  assert.deepEqual(fixtureCodes.sort(), definitions.map((permission) => permission.code).sort());
  const roleForPeopleRead = (await backend(`/workspaces/${tenant.workspace.id}/roles`, { token: ownerToken }))
    .find((role) => role.id === createdRole.id);
  await backend(`/workspaces/${tenant.workspace.id}/roles/${createdRole.id}`, {
    token: ownerToken, method: "PATCH",
    data: { version: roleForPeopleRead.version, permissionCodes: [...roleForPeopleRead.permissions, "module.members.read"] },
  });

  stage = "restricted invitation";
  const restrictedToken = await invite(`viewer-${runId}@example.com`, ["role_viewer"]);
  const restrictedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const restricted = await restrictedContext.newPage();
  restricted.on("pageerror", (error) => browserErrors.push(`restricted: ${error.message}`));
  restricted.setDefaultTimeout(20_000);
  activePage = restricted;
  await activateInvitation(restricted, restrictedToken);
  await restricted.goto(`${web}/workspace/roles`);
  await restricted.getByRole("heading", { name: "Roles & permissions" }).waitFor();
  assert.equal(await restricted.getByRole("button", { name: "Custom role" }).count(), 0);
  assert.equal(await restricted.getByRole("button", { name: /Actions for/ }).count(), 0);
  assert.equal(await restricted.getByRole("button", { name: "Save changes" }).count(), 0);
  assert.ok((await restricted.getByRole("switch").count()) > 0, "Read-only member should see the permission catalogue");
  await restricted.goto(`${web}/workspace/members`);
  await restricted.getByRole("region", { name: "People" }).waitFor();
  assert.equal(await restricted.getByRole("button", { name: "Invite with details" }).count(), 0);
  await restricted.getByText(/Your access is read-only/).waitFor();
  const denied = await restricted.request.post(`${web}/api/workspace/roles`, {
    data: {
      workspaceId: tenant.workspace.id,
      code: "unexpected_editor",
      name: "Unexpected editor",
      permissionCodes: ["workspace.roles.manage"],
    },
  });
  assert.equal(denied.status(), 403, await denied.text());
  assert.ok(await restricted.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1));

  stage = "scoped people delegation";
  const restrictedTokenForApi = await accessToken(restrictedContext);
  const currentRole = (await backend(`/workspaces/${tenant.workspace.id}/roles`, { token: ownerToken }))
    .find((role) => role.id === createdRole.id);
  await backend(`/workspaces/${tenant.workspace.id}/roles/${createdRole.id}`, {
    token: ownerToken, method: "PATCH",
    data: {
      version: currentRole.version,
      permissionCodes: [...new Set([...currentRole.permissions, "module.members.write", "module.members.edit"])],
    },
  });
  const restrictedProfile = await backend("/me", { token: restrictedTokenForApi });
  assert.ok(restrictedProfile.memberships[0].allowedPermissions.includes("module.members.write"));
  await restricted.reload();
  await restricted.getByRole("button", { name: "Invite with details" }).waitFor();
  assert.equal(await restricted.getByRole("button", { name: "Actions for Workspace Owner" }).count(), 0);
  await restricted.getByRole("button", { name: "Invite with details" }).click();
  const scopedInviteDialog = restricted.getByRole("dialog", { name: "Invite a member" });
  assert.equal(await scopedInviteDialog.getByRole("checkbox", { name: /Owner/ }).count(), 0);
  assert.equal(await scopedInviteDialog.getByRole("checkbox", { name: /Administrator/ }).count(), 0);
  await scopedInviteDialog.getByRole("button", { name: "Cancel" }).click();
  await backend(`/workspaces/${tenant.workspace.id}/invitations`, {
    token: restrictedTokenForApi, method: "POST", expected: 403,
    data: { email: `unwanted-owner-${runId}@example.com`, roleCodes: ["owner"] },
  });
  await backend(`/workspaces/${tenant.workspace.id}/invitations`, {
    token: restrictedTokenForApi, method: "POST", expected: 403,
    data: { email: `unwanted-finance-${runId}@example.com`, roleCodes: ["finance_reviewer"] },
  });
  await backend(`/workspaces/${tenant.workspace.id}/invitations`, {
    token: restrictedTokenForApi, method: "POST", expected: 201,
    data: { email: `permitted-peer-${runId}@example.com`, roleCodes: ["role_viewer"] },
  });
  const privilegedInvitation = await backend(`/workspaces/${tenant.workspace.id}/invitations`, {
    token: ownerToken, method: "POST", expected: 201,
    data: { email: `privileged-pending-${runId}@example.com`, roleCodes: ["owner"] },
  });
  await backend(`/workspaces/${tenant.workspace.id}/invitations/${privilegedInvitation.id}/resend`, {
    token: restrictedTokenForApi, method: "POST", expected: 403,
  });
  await backend(`/workspaces/${tenant.workspace.id}/invitations/${privilegedInvitation.id}`, {
    token: restrictedTokenForApi, method: "DELETE", expected: 403,
  });
  const ownerMembership = (await backend(`/workspaces/${tenant.workspace.id}/members`, { token: ownerToken }))
    .find((member) => member.email === tenant.ownerInvitation.email);
  await backend(`/workspaces/${tenant.workspace.id}/members/${ownerMembership.id}`, {
    token: restrictedTokenForApi, method: "PATCH", expected: 403,
    data: { version: ownerMembership.version, roleCodes: ["viewer"] },
  });

  stage = "team-inherited role";
  const members = await backend(`/workspaces/${tenant.workspace.id}/members`, { token: ownerToken });
  const restrictedMembership = members.find((member) => member.email === `viewer-${runId}@example.com`);
  assert.ok(restrictedMembership?.id);
  const businessUnit = await backend(`/workspaces/${tenant.workspace.id}/business-units`, {
    token: ownerToken, method: "POST", expected: 201,
    data: { legalEntityId: tenant.legalEntity.id, code: "STUDIO", name: "Studio", type: "studio", timezone: "Asia/Dubai" },
  });
  await backend(`/workspaces/${tenant.workspace.id}/teams`, {
    token: ownerToken, method: "POST", expected: 201,
    data: {
      businessUnitId: businessUnit.id, code: "ROLE_TEAM", name: "Role test team",
      memberIds: [restrictedMembership.id], roleIds: [createdRole.id], queueIds: [],
    },
  });
  await backend(`/workspaces/${tenant.workspace.id}/members/${restrictedMembership.id}`, {
    token: ownerToken, method: "PATCH",
    data: { version: restrictedMembership.version, roleCodes: [] },
  });
  const inheritedMember = (await backend(`/workspaces/${tenant.workspace.id}/members`, { token: ownerToken }))
    .find((member) => member.id === restrictedMembership.id);
  assert.deepEqual(inheritedMember.roles, []);
  assert.ok(inheritedMember.inheritedRoles.includes("role_viewer"));
  const inheritedProfile = await backend("/me", { token: restrictedTokenForApi });
  assert.ok(inheritedProfile.memberships[0].allowedPermissions.includes("module.roles.read"));
  const roles = await backend(`/workspaces/${tenant.workspace.id}/roles`, { token: ownerToken });
  const assignedRole = roles.find((role) => role.id === createdRole.id);
  assert.equal(assignedRole.teamCount, 1);
  assert.equal(assignedRole.memberCount, 0);
  await backend(`/workspaces/${tenant.workspace.id}/roles/${createdRole.id}?version=${assignedRole.version}`, {
    token: ownerToken, method: "DELETE", expected: 409,
  });
  await restricted.goto(`${web}/workspace/roles`);
  await restricted.getByRole("heading", { name: "Roles & permissions" }).waitFor();
  assert.equal(await restricted.getByRole("button", { name: "Custom role" }).count(), 0);

  stage = "administrator invitation";
  const adminToken = await invite(`admin-${runId}@example.com`, ["administrator"]);
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminContext.newPage();
  admin.on("pageerror", (error) => browserErrors.push(`admin: ${error.message}`));
  admin.setDefaultTimeout(20_000);
  activePage = admin;
  await activateInvitation(admin, adminToken);
  await admin.goto(`${web}/workspace/roles`);
  await admin.getByRole("heading", { name: "Roles & permissions" }).waitFor();
  await admin.getByRole("button", { name: "Custom role" }).waitFor();
  assert.deepEqual(browserErrors, []);

  process.stdout.write(`${JSON.stringify({ ok: true, checks: [
    "owner created and saved role permissions through the UI",
    "fixture permission catalogue matched the migrated backend catalogue",
    "restricted member read the roles and People pages without mutation controls",
    "restricted member role creation was denied by the backend",
    "scoped People editor could invite within own access but could not assign Owner or Finance, edit Owner, or renew/cancel a privileged invitation",
    "team-inherited role retained read access with no direct role and blocked deletion",
    "non-owner administrator retained role creation access",
    "mobile restricted view had no horizontal page overflow",
  ] }, null, 2)}\n`);
} catch (error) {
  const visible = await activePage.locator("body").innerText().catch(() => "");
  process.stderr.write(`Roles browser smoke failed at ${stage}. Visible text: ${visible.slice(0, 1200)}\n`);
  throw error;
} finally {
  await browser.close();
}
