import assert from "node:assert/strict";

const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8000/api/v1";
const internalToken = process.env.BUSINESS_CORE_INTERNAL_TOKEN ?? "local-development-token";
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const tenantSlug = `auth-smoke-${runId}`;
const email = `auth-${runId}@example.com`;
const firstPassword = "SmokeAuth#2026";
const secondPassword = "SmokeReset#2026";

async function request(path, { body, headers = {}, method = body ? "POST" : "GET", expected = 200 } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) },
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

const provisioned = await request("/internal/tenants", {
  expected: 201,
  headers: {
    "x-wodana-internal-token": internalToken,
    "idempotency-key": `auth-smoke:${runId}`,
  },
  body: {
    externalTenantId: `auth-smoke-${runId}`,
    owner: { email, displayName: "Auth Smoke Owner" },
    name: "Auth Smoke Architects",
    slug: tenantSlug,
    defaultCurrency: "AED",
    defaultLocale: "en-AE",
    defaultTimezone: "Asia/Dubai",
    unitSystem: "metric",
    weekStartsOn: 1,
    firstLegalEntity: {
      code: `A${runId.replaceAll("-", "").slice(-7)}`,
      displayName: "Auth Smoke Architects",
      registeredName: "Auth Smoke Architects LLC",
      countryCode: "AE",
      baseCurrency: "AED",
      locale: "en-AE",
      timezone: "Asia/Dubai",
    },
  },
});
assert.ok(provisioned.ownerInvitation.invitationToken);

const branding = await request(`/auth/tenant/${tenantSlug}`);
assert.deepEqual(branding, {
  displayName: "Auth Smoke Architects",
  loginSlug: tenantSlug,
  logoUrl: null,
});

const activated = await request("/auth/invitations/activate", {
  expected: 201,
  body: { invitationToken: provisioned.ownerInvitation.invitationToken, password: firstPassword },
});
assert.equal(activated.profile.nextAction, "start_onboarding");

const login = await request("/auth/login", {
  expected: 201,
  body: { email, password: firstPassword, tenantSlug },
});
assert.equal(login.profile.primaryEmail, email);
assert.ok(login.accessToken);
assert.ok(login.refreshToken);

const refreshed = await request("/auth/refresh", {
  expected: 201,
  body: { refreshToken: login.refreshToken },
});
assert.notEqual(refreshed.refreshToken, login.refreshToken);

const recovery = await request("/auth/password/forgot", {
  expected: 201,
  body: { email, tenantSlug },
});
assert.ok(recovery.developmentResetToken);
await request("/auth/password/reset", {
  expected: 201,
  body: { resetToken: recovery.developmentResetToken, password: secondPassword },
});
await request("/auth/refresh", {
  expected: 401,
  body: { refreshToken: refreshed.refreshToken },
});
await request("/auth/login", {
  expected: 401,
  body: { email, password: firstPassword, tenantSlug },
});
const relogin = await request("/auth/login", {
  expected: 201,
  body: { email, password: secondPassword, tenantSlug },
});
await request("/auth/logout", {
  expected: 201,
  body: { refreshToken: relogin.refreshToken },
});
await request("/auth/refresh", {
  expected: 401,
  body: { refreshToken: relogin.refreshToken },
});

process.stdout.write(`${JSON.stringify({
  ok: true,
  flow: ["provisioned", "branded", "activated", "signed_in", "refreshed", "recovered", "reset", "signed_out"],
}, null, 2)}\n`);
