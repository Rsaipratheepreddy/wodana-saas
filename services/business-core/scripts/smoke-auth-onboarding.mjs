import assert from "node:assert/strict";

const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8010/api/v1";
const internalToken = process.env.BUSINESS_CORE_INTERNAL_TOKEN ?? "local-development-token";
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const ownerEmail = `owner-${runId}@example.com`;
const owner = {
  "x-wodana-user-subject": `owner-${runId}`,
  "x-wodana-user-email": ownerEmail,
  "x-wodana-user-name": "Provisioned Owner",
};

async function request(path, {
  body,
  headers = {},
  method = body ? "POST" : "GET",
  expected = 200,
} = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...headers,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: expected ${expected}, got ${response.status}: ${JSON.stringify(payload)}`,
  );
  return payload;
}

const externalTenantId = `internal-${runId}`;
const idempotencyKey = `provision:${externalTenantId}`;
const provisionBody = {
  externalTenantId,
  owner: { email: ownerEmail, displayName: "Provisioned Owner" },
  name: "Provisioned Tenant",
  slug: `provisioned-${runId}`,
  defaultCurrency: "AED",
  defaultLocale: "en-AE",
  defaultTimezone: "Asia/Dubai",
  unitSystem: "metric",
  weekStartsOn: 1,
  firstLegalEntity: {
    code: `P${runId.replaceAll("-", "").slice(-8)}`,
    displayName: "Provisioned Tenant",
    registeredName: "Provisioned Tenant LLC",
    countryCode: "AE",
    baseCurrency: "AED",
    locale: "en-AE",
    timezone: "Asia/Dubai",
  },
};
const internalHeaders = {
  "x-wodana-internal-token": internalToken,
  "idempotency-key": idempotencyKey,
};

const provisioned = await request("/internal/tenants", {
  body: provisionBody,
  expected: 201,
  headers: internalHeaders,
});
assert.equal(provisioned.replayed, false);
assert.equal(provisioned.onboarding.status, "not_started");
assert.ok(provisioned.ownerInvitation.invitationToken);

const replayed = await request("/internal/tenants", {
  body: provisionBody,
  expected: 201,
  headers: internalHeaders,
});
assert.equal(replayed.replayed, true);
assert.equal(replayed.ownerInvitation.invitationToken, null);

await request("/internal/tenants", {
  body: { ...provisionBody, name: "Changed Tenant" },
  expected: 409,
  headers: internalHeaders,
});
const status = await request(`/internal/tenants/${externalTenantId}`, {
  headers: { "x-wodana-internal-token": internalToken },
});
assert.equal(status.workspace.id, provisioned.workspace.id);

const rotated = await request(
  `/internal/tenants/${externalTenantId}/owner-invitation/resend`,
  {
    expected: 201,
    headers: { "x-wodana-internal-token": internalToken },
    method: "POST",
  },
);
assert.notEqual(rotated.invitationToken, provisioned.ownerInvitation.invitationToken);

const beforeAcceptance = await request("/me", { headers: owner });
assert.equal(beforeAcceptance.nextAction, "accept_invitation");
assert.equal(beforeAcceptance.pendingInvitations[0].id, provisioned.ownerInvitation.id);
await request(`/workspaces/invitations/${provisioned.ownerInvitation.id}/accept`, {
  expected: 201,
  headers: owner,
  method: "POST",
});
const afterAcceptance = await request("/me", { headers: owner });
assert.equal(afterAcceptance.nextAction, "start_onboarding");

const firstStep = await request(`/workspaces/${provisioned.workspace.id}/onboarding`, {
  body: {
    version: 1,
    currentStep: "organization",
    completedSteps: ["workspace_profile"],
  },
  headers: owner,
  method: "PATCH",
});
const secondStep = await request(`/workspaces/${provisioned.workspace.id}/onboarding`, {
  body: {
    version: firstStep.version,
    currentStep: "team",
    completedSteps: ["workspace_profile", "organization"],
  },
  headers: owner,
  method: "PATCH",
});
await request(`/workspaces/${provisioned.workspace.id}/onboarding/complete`, {
  body: { version: secondStep.version },
  expected: 201,
  headers: owner,
});
const ready = await request("/me", { headers: owner });
assert.equal(ready.nextAction, "enter_workspace");
const completedStatus = await request(`/internal/tenants/${externalTenantId}`, {
  headers: { "x-wodana-internal-token": internalToken },
});
assert.equal(completedStatus.ownerInvitation.status, "accepted");
assert.equal(completedStatus.onboarding.status, "completed");

process.stdout.write(`${JSON.stringify({
  ok: true,
  externalTenantId,
  workspaceId: provisioned.workspace.id,
  flow: ["provisioned", "invited", "accepted", "onboarded", "ready"],
}, null, 2)}\n`);
