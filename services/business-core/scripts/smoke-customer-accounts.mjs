import assert from "node:assert/strict";
import pg from "pg";

const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8000/api/v1";
const internalToken = process.env.BUSINESS_CORE_INTERNAL_TOKEN ?? "local-development-token";
const databaseUrl = process.env.CUSTOMER_ACCOUNTS_TEST_DB;
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

assert.ok(databaseUrl, "CUSTOMER_ACCOUNTS_TEST_DB is required for the membership trigger check");

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

const login = await request("/auth/login", {
  expected: 201,
  body: {
    email: "admin@igloarchitects.com",
    password: "IgloDemo#2026",
    tenantSlug: "iglo-architects",
  },
});
const authorization = { authorization: `Bearer ${login.accessToken}` };
const sourceWorkspaceId = login.profile.memberships.find(
  (membership) => membership.workspaceSlug === "iglo-architects",
).workspaceId;

const before = await request(`/workspaces/${sourceWorkspaceId}/account`, { headers: authorization });
assert.equal(before.organizationCount, 1);
assert.equal(before.organizationLimit, 1);
assert.equal(before.organizations.length, 1);
assert.equal(before.organizations[0].isDefault, true);

const requestedBody = {
  name: "Palm Living UAE",
  slug: `palm-living-${runId}`,
  defaultCurrency: "AED",
  defaultLocale: "en-AE",
  defaultTimezone: "Asia/Dubai",
  unitSystem: "metric",
  weekStartsOn: 1,
  firstLegalEntity: {
    code: `P${runId.replaceAll("-", "").slice(-7).toUpperCase()}`,
    displayName: "Palm Living UAE",
    registeredName: "Palm Living UAE LLC",
    countryCode: "AE",
    baseCurrency: "AED",
    locale: "en-AE",
    timezone: "Asia/Dubai",
  },
  reason: "Separate UAE operating organization",
};
const idempotencyKey = `multi-org:${runId}`;
const created = await request(`/workspaces/${sourceWorkspaceId}/account/organization-requests`, {
  expected: 201,
  headers: { ...authorization, "idempotency-key": idempotencyKey },
  body: requestedBody,
});
assert.equal(created.status, "pending");
assert.equal(created.replayed, false);

const replayed = await request(`/workspaces/${sourceWorkspaceId}/account/organization-requests`, {
  expected: 201,
  headers: { ...authorization, "idempotency-key": idempotencyKey },
  body: requestedBody,
});
assert.equal(replayed.id, created.id);
assert.equal(replayed.replayed, true);

await request(`/workspaces/${sourceWorkspaceId}/account/organization-requests`, {
  expected: 409,
  headers: { ...authorization, "idempotency-key": idempotencyKey },
  body: { ...requestedBody, name: "Changed Organization" },
});

const beforeApprovalProfile = await request("/me", { headers: authorization });
assert.equal(beforeApprovalProfile.memberships.length, 1);

await request(`/internal/organization-requests/${created.id}/approve`, {
  expected: 409,
  headers: { "x-wodana-internal-token": internalToken },
  body: { expectedVersion: created.version },
});

const approved = await request(`/internal/organization-requests/${created.id}/approve`, {
  headers: { "x-wodana-internal-token": internalToken },
  body: {
    expectedVersion: created.version,
    organizationLimit: 2,
    decisionReason: "Approved for the UAT account",
  },
});
assert.equal(approved.status, "approved");
assert.equal(approved.organizationLimit, 2);
assert.equal(approved.organization.workspace.slug, requestedBody.slug);

const approvalReplay = await request(`/internal/organization-requests/${created.id}/approve`, {
  headers: { "x-wodana-internal-token": internalToken },
  body: { expectedVersion: created.version },
});
assert.equal(approvalReplay.replayed, true);

const afterProfile = await request("/me", { headers: authorization });
const sameAccountMemberships = afterProfile.memberships.filter(
  (membership) => membership.accountId === before.id,
);
assert.equal(sameAccountMemberships.length, 2);
assert.equal(sameAccountMemberships.filter((membership) => membership.isDefaultOrganization).length, 1);

const after = await request(`/workspaces/${sourceWorkspaceId}/account`, { headers: authorization });
assert.equal(after.organizationCount, 2);
assert.equal(after.organizationLimit, 2);
assert.equal(after.organizations.length, 2);
assert.equal(after.organizations.find((organization) => organization.slug === requestedBody.slug).isDefault, false);

const database = new pg.Client({ connectionString: databaseUrl });
await database.connect();
try {
  await database.query("BEGIN");
  const member = await database.query(
    `INSERT INTO users (primary_email, display_name)
     VALUES ($1, 'Organization Member') RETURNING id`,
    [`organization-member-${runId}@example.com`],
  );
  await database.query("SELECT set_config('app.current_workspace_id', $1, true)", [
    approved.organization.workspace.id,
  ]);
  await database.query("SELECT set_config('app.current_actor_id', $1, true)", [member.rows[0].id]);
  await database.query(
    `INSERT INTO workspace_memberships (workspace_id, user_id, status, joined_at)
     VALUES ($1, $2, 'active', now())`,
    [approved.organization.workspace.id, member.rows[0].id],
  );
  const accountMembership = await database.query(
    `SELECT role, status FROM customer_account_memberships
     WHERE account_id = $1 AND user_id = $2`,
    [before.id, member.rows[0].id],
  );
  assert.equal(accountMembership.rowCount, 1);
  assert.deepEqual(accountMembership.rows[0], { role: "member", status: "active" });
  await database.query("COMMIT");
} catch (error) {
  await database.query("ROLLBACK");
  throw error;
} finally {
  await database.end();
}

const outsiderSlug = `other-account-${runId}`;
const outsider = await request("/internal/tenants", {
  expected: 201,
  headers: {
    "x-wodana-internal-token": internalToken,
    "idempotency-key": `other-account:${runId}`,
  },
  body: {
    externalTenantId: outsiderSlug,
    owner: { email: `${outsiderSlug}@example.com`, displayName: "Other Account Owner" },
    name: "Other Customer Account",
    slug: outsiderSlug,
    defaultCurrency: "AED",
    defaultLocale: "en-AE",
    defaultTimezone: "Asia/Dubai",
    unitSystem: "metric",
    weekStartsOn: 1,
    firstLegalEntity: {
      code: `O${runId.replaceAll("-", "").slice(-7).toUpperCase()}`,
      displayName: "Other Customer Account",
      registeredName: "Other Customer Account LLC",
      countryCode: "AE",
      baseCurrency: "AED",
      locale: "en-AE",
      timezone: "Asia/Dubai",
    },
  },
});
await request(`/workspaces/${outsider.workspace.id}/account`, {
  expected: 404,
  headers: authorization,
});

process.stdout.write(`${JSON.stringify({
  ok: true,
  safeguards: [
    "one default organization",
    "request idempotency",
    "request mutation rejection",
    "no access before approval",
    "organization limit enforcement",
    "atomic approval and provisioning",
    "approval replay safety",
    "same-account switch metadata",
    "workspace-member account discovery",
    "single default preservation",
    "cross-account denial",
  ],
}, null, 2)}\n`);
