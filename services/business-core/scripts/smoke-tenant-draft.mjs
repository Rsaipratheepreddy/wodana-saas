import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";

const scrypt = promisify(scryptCallback);
const databaseUrl = process.env.PROVISION_DRAFT_TEST_DATABASE_URL;
const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8023/api/v1";
const internalToken = process.env.BUSINESS_CORE_INTERNAL_TOKEN;
const expectedDeliveryStatus = process.env.EXPECTED_DELIVERY_STATUS ?? "not_configured";
assert.ok(databaseUrl && ["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname), "Local test database required");
assert.ok(["localhost", "127.0.0.1", "::1"].includes(new URL(api).hostname), "Local API required");
assert.ok(internalToken, "Local internal token required");
assert.ok(["not_configured", "failed"].includes(expectedDeliveryStatus), "Expected delivery must be a safe failure state");

function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const letter of secret) bits += alphabet.indexOf(letter).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function request(path, { method = "GET", body, headers = {}, expected = 200 } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  assert.equal(response.status, expected, `${method} ${path}: expected ${expected}, got ${response.status}: ${payload?.message ?? "unknown"}`);
  return payload;
}

const operatorId = randomUUID();
const suffix = operatorId.slice(0, 8);
const email = `draft-operator-${suffix}@wodana.invalid`;
const ownerEmail = `draft-owner-${suffix}@wodana.invalid`;
const password = `${randomBytes(20).toString("base64url")}aA1!`;
const salt = randomBytes(16).toString("hex");
const hash = (await scrypt(password, salt, 64)).toString("hex");
const externalTenantId = `draft-smoke-${suffix}`;
const slug = `draft-smoke-${suffix}`;
const draftKey = `draft-create-${suffix}`;
const provisionKey = `draft-provision-${suffix}`;
const takenWorkspaceId = randomUUID();
const takenSlug = `draft-taken-${suffix}`;
const database = new pg.Client({ connectionString: databaseUrl });
await database.connect();
let workspaceId = null;
let accountId = null;
let draftId = null;
const extraDraftIds = [];

try {
  await database.query(`INSERT INTO users (id, primary_email, display_name) VALUES ($1, $2, 'Draft Operator')`, [operatorId, email]);
  await database.query(`INSERT INTO local_auth_credentials (user_id, password_hash, password_salt) VALUES ($1, $2, $3)`, [operatorId, hash, salt]);
  await database.query(`INSERT INTO platform_administrators (user_id) VALUES ($1)`, [operatorId]);
  await database.query(`INSERT INTO users (primary_email, display_name) VALUES ($1, 'Existing Owner Name')`, [ownerEmail]);
  await database.query(
    `INSERT INTO workspaces (id, name, slug, default_currency, created_by)
     VALUES ($1, 'Synthetic Existing Workspace', $2, 'AED', $3)`,
    [takenWorkspaceId, takenSlug, operatorId],
  );
  const challenge = await request("/auth/platform/login", { method: "POST", body: { email, password }, expected: 201 });
  const mfa = await request("/auth/platform/mfa/setup", { method: "POST", body: { challengeToken: challenge.challengeToken }, expected: 201 });
  const session = await request("/auth/platform/mfa/confirm", {
    method: "POST", body: { challengeToken: challenge.challengeToken, code: totp(mfa.secret) }, expected: 201,
  });
  const operatorHeaders = {
    "x-wodana-internal-token": internalToken,
    "x-wodana-operator-session": session.sessionToken,
  };
  await request("/internal/operator/tenant-drafts/setup-profiles", {
    headers: { "x-wodana-internal-token": internalToken }, expected: 401,
  });
  const profiles = await request("/internal/operator/tenant-drafts/setup-profiles", { headers: operatorHeaders });
  assert.ok(profiles.some((profile) => profile.kind === "region" && profile.code === "AE" && profile.version === 1));
  assert.ok(profiles.some((profile) => profile.kind === "firm_kit" && profile.code === "design_build" && profile.version === 2));
  assert.equal(profiles.some((profile) => profile.kind === "firm_kit" && profile.version === 1), false);
  const input = {
    externalTenantId,
    account: { displayName: "Synthetic Parent Group", contactName: "Contract Contact", contactEmail: `contract-${suffix}@wodana.invalid` },
    organization: {
      name: "Synthetic Workshop", slug, defaultCurrency: "AED", defaultLocale: "en-AE",
      defaultTimezone: "Asia/Dubai", unitSystem: "metric", weekStartsOn: 1,
      firstLegalEntity: {
        code: `DS${suffix.toUpperCase()}`, displayName: "Synthetic Workshop", registeredName: "Synthetic Workshop LLC",
        countryCode: "AE", baseCurrency: "AED", locale: "en-AE", timezone: "Asia/Dubai",
      },
    },
    owner: { email: ownerEmail, displayName: "Owner Tester" },
    defaults: { region: { code: "AE", version: 1 }, firmKit: { code: "design_build", version: 2 }, plan: { code: "starter", version: 1 } },
  };
  const expiringInput = { ...input, externalTenantId: `${externalTenantId}-expiring`,
    organization: { ...input.organization, slug: `${slug}-expiring` } };
  const expiring = await request("/internal/operator/tenant-drafts", {
    method: "POST", headers: { ...operatorHeaders, "idempotency-key": `draft-expire-${suffix}` },
    body: expiringInput, expected: 201,
  });
  extraDraftIds.push(expiring.id);
  await database.query(`UPDATE tenant_provisioning_drafts SET reservation_expires_at = now() - interval '1 minute' WHERE id = $1`, [expiring.id]);
  const replacement = await request("/internal/operator/tenant-drafts", {
    method: "POST", headers: { ...operatorHeaders, "idempotency-key": `draft-replace-${suffix}` },
    body: { ...expiringInput, externalTenantId: `${externalTenantId}-replacement` }, expected: 201,
  });
  extraDraftIds.push(replacement.id);
  const released = await request(`/internal/operator/tenant-drafts/${expiring.id}`, { headers: operatorHeaders });
  assert.equal(released.status, "expired");
  const created = await request("/internal/operator/tenant-drafts", {
    method: "POST", headers: { ...operatorHeaders, "idempotency-key": draftKey }, body: input, expected: 201,
  });
  draftId = created.id;
  assert.equal(created.status, "draft");
  assert.equal(created.account.displayName, "Synthetic Parent Group");
  assert.equal(created.owner.email, ownerEmail);
  assert.equal(JSON.stringify(created).includes("invitationToken"), false);
  const replay = await request("/internal/operator/tenant-drafts", {
    method: "POST", headers: { ...operatorHeaders, "idempotency-key": draftKey }, body: input, expected: 201,
  });
  assert.equal(replay.id, draftId);
  assert.equal(replay.replayed, true);
  await request("/internal/operator/tenant-drafts", {
    method: "POST", headers: { ...operatorHeaders, "idempotency-key": `draft-collision-${suffix}` },
    body: { ...input, externalTenantId: `${externalTenantId}-collision` }, expected: 409,
  });
  await request("/internal/operator/tenant-drafts", {
    method: "POST", headers: { ...operatorHeaders, "idempotency-key": `draft-existing-${suffix}` },
    body: { ...input, externalTenantId: `${externalTenantId}-existing`,
      organization: { ...input.organization, slug: takenSlug } }, expected: 409,
  });
  await request("/internal/operator/tenant-drafts", {
    method: "POST", headers: { ...operatorHeaders, "idempotency-key": `draft-profile-${suffix}` },
    body: { ...input, externalTenantId: `${externalTenantId}-profile`,
      organization: { ...input.organization, slug: `${slug}-profile` },
      defaults: { ...input.defaults, plan: { code: "starter", version: 99 } } }, expected: 400,
  });
  await request("/internal/operator/tenant-drafts", {
    method: "POST", headers: { ...operatorHeaders, "idempotency-key": draftKey },
    body: { ...input, account: { ...input.account, displayName: "Different parent" } }, expected: 409,
  });
  await request(`/internal/operator/tenant-drafts/${draftId}/provision`, {
    method: "POST", headers: { ...operatorHeaders, "idempotency-key": provisionKey },
    body: { expectedVersion: created.version + 1 }, expected: 409,
  });
  const provisioned = await request(`/internal/operator/tenant-drafts/${draftId}/provision`, {
    method: "POST", headers: { ...operatorHeaders, "idempotency-key": provisionKey },
    body: { expectedVersion: created.version }, expected: 201,
  });
  assert.equal(provisioned.draft.status, "provisioned");
  assert.equal(provisioned.tenant.account.displayName, "Synthetic Parent Group");
  assert.equal(provisioned.tenant.workspace.name, "Synthetic Workshop");
  assert.equal(provisioned.tenant.ownerInvitation.deliveryStatus, "not_requested");
  assert.ok(provisioned.tenant.ownerInvitation.invitationToken);
  workspaceId = provisioned.tenant.workspace.id;
  accountId = provisioned.tenant.account.id;
  // Simulate a lost response after the core commit but before draft finalization.
  await database.query(
    `UPDATE tenant_provisioning_drafts SET status = 'provisioning', workspace_id = NULL,
       version = version + 1 WHERE id = $1 AND workspace_id = $2`,
    [draftId, workspaceId],
  );
  const again = await request(`/internal/operator/tenant-drafts/${draftId}/provision`, {
    method: "POST", headers: { ...operatorHeaders, "idempotency-key": provisionKey },
    body: { expectedVersion: created.version }, expected: 201,
  });
  assert.equal(again.tenant.ownerInvitation.invitationToken, null);
  assert.equal(again.draft.workspaceId, workspaceId);
  const safeRead = await request(`/internal/operator/tenants/${externalTenantId}`, { headers: operatorHeaders });
  assert.equal(safeRead.ownerInvitation.invitationToken, null);
  assert.equal(safeRead.account.contractContactEmail, input.account.contactEmail);
  assert.equal(safeRead.account.contractStatus, "trial_uncontracted");
  const setupVersion = await database.query(
    `SELECT region_code, region_version, firm_kit_code, firm_kit_version, plan_code FROM workspace_setup_versions WHERE workspace_id = $1`,
    [workspaceId],
  );
  assert.deepEqual(setupVersion.rows[0], { region_code: "AE", region_version: 1, firm_kit_code: "design_build", firm_kit_version: 2, plan_code: "starter" });
  const workflow = await database.query(
    `SELECT code, version, is_default, stages FROM project_workflow_templates WHERE workspace_id = $1`, [workspaceId],
  );
  assert.equal(workflow.rowCount, 1);
  assert.equal(workflow.rows[0].code, "standard_delivery");
  assert.equal(workflow.rows[0].version, 1);
  assert.equal(workflow.rows[0].is_default, true);
  assert.deepEqual(workflow.rows[0].stages.map((stage) => stage.key), ["planning", "delivery", "handover", "completed"]);
  const account = await database.query(
    `SELECT display_name, contract_contact_email FROM customer_accounts WHERE id = $1`, [accountId],
  );
  assert.equal(account.rows[0].display_name, "Synthetic Parent Group");
  assert.equal(account.rows[0].contract_contact_email, input.account.contactEmail);
  const contract = await database.query(
    `SELECT status, plan_code, plan_version, seat_limit, project_limit
     FROM customer_account_contracts WHERE account_id = $1`, [accountId],
  );
  assert.deepEqual(contract.rows[0], {
    status: "trial_uncontracted", plan_code: "starter", plan_version: 1, seat_limit: 5, project_limit: 25,
  });
  await database.query("BEGIN");
  try {
    await database.query("SET LOCAL ROLE wodana_app");
    const isolated = await database.query(`SELECT count(*)::int AS count FROM customer_account_contracts WHERE account_id = $1`, [accountId]);
    assert.equal(isolated.rows[0].count, 0);
    await database.query("SELECT set_config('app.current_workspace_id', $1, true)", [workspaceId]);
    const visible = await database.query(`SELECT count(*)::int AS count FROM customer_account_contracts WHERE account_id = $1`, [accountId]);
    assert.equal(visible.rows[0].count, 1);
    await database.query("ROLLBACK");
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  }
  const owner = await database.query(`SELECT display_name FROM users WHERE primary_email = $1`, [ownerEmail]);
  assert.equal(owner.rows[0].display_name, "Existing Owner Name");
  await database.query(
    `UPDATE workspace_invitations SET expires_at = now() - interval '1 minute'
     WHERE workspace_id = $1 AND email = $2 AND status = 'pending'`,
    [workspaceId, ownerEmail],
  );
  await request("/auth/invitations/activate", {
    method: "POST", body: { invitationToken: provisioned.tenant.ownerInvitation.invitationToken, password }, expected: 410,
  });
  await request(`/internal/operator/tenants/${externalTenantId}/owner-invitation/send`, {
    method: "POST", headers: operatorHeaders, expected: 400,
  });
  const invitation = await request(`/internal/operator/tenants/${externalTenantId}/owner-invitation/send`, {
    method: "POST", headers: { ...operatorHeaders, "idempotency-key": `owner-send-${suffix}` }, expected: 201,
  });
  assert.equal(invitation.deliveryStatus, expectedDeliveryStatus);
  assert.notEqual(invitation.invitationToken, provisioned.tenant.ownerInvitation.invitationToken);
  const sendReplay = await request(`/internal/operator/tenants/${externalTenantId}/owner-invitation/send`, {
    method: "POST", headers: { ...operatorHeaders, "idempotency-key": `owner-send-${suffix}` }, expected: 201,
  });
  assert.equal(sendReplay.replayed, true);
  assert.equal(sendReplay.invitationToken, null);
  assert.equal(sendReplay.deliveryStatus, expectedDeliveryStatus);
  const renewed = await request(`/internal/operator/tenants/${externalTenantId}/owner-invitation/resend`, {
    method: "POST", headers: operatorHeaders, expected: 201,
  });
  assert.equal(renewed.deliveryStatus, expectedDeliveryStatus);
  assert.notEqual(renewed.invitationToken, invitation.invitationToken);
  const superseded = await request(`/internal/operator/tenants/${externalTenantId}/owner-invitation/send`, {
    method: "POST", headers: { ...operatorHeaders, "idempotency-key": `owner-send-${suffix}` }, expected: 201,
  });
  assert.equal(superseded.deliveryStatus, "superseded");
  const status = await request(`/internal/operator/tenants/${externalTenantId}/status`, { headers: operatorHeaders });
  assert.equal(status.ownerInvitation.deliveryStatus, expectedDeliveryStatus);
  assert.equal(status.ownerInvitation.deliveryAttempts, 2);
  await request("/auth/invitations/activate", {
    method: "POST", body: { invitationToken: invitation.invitationToken, password }, expected: 404,
  });
  const activated = await request("/auth/invitations/activate", {
    method: "POST", body: { invitationToken: renewed.invitationToken, password }, expected: 201,
  });
  assert.equal(activated.selectedWorkspaceId, workspaceId);
  assert.equal(activated.profile.nextAction, "start_onboarding");
  assert.equal(activated.mfa.enrollmentRequired, true);
  await request("/auth/invitations/activate", {
    method: "POST", body: { invitationToken: renewed.invitationToken, password }, expected: 410,
  });
  const ownerHeaders = { authorization: `Bearer ${activated.accessToken}` };
  const setup = await request("/security/mfa/totp/setup", {
    method: "POST", headers: ownerHeaders,
    body: { workspaceId, refreshToken: activated.refreshToken },
  });
  assert.match(setup.secret, /^[A-Z2-7]{32}$/);
  const ownerMfa = await request("/security/mfa/totp/confirm", {
    method: "POST", headers: ownerHeaders,
    body: { workspaceId, refreshToken: activated.refreshToken, code: totp(setup.secret) },
  });
  assert.equal(ownerMfa.enabled, true);
  assert.equal(ownerMfa.recoveryCodes.length, 10);
  const ownerMfaHeaders = { authorization: `Bearer ${ownerMfa.accessToken}` };
  const onboarding = await request(`/workspaces/${workspaceId}/onboarding`, { headers: ownerMfaHeaders });
  assert.equal(onboarding.status, "not_started");
  await request(`/workspaces/${workspaceId}/onboarding/complete`, {
    method: "POST", headers: ownerMfaHeaders, body: { version: onboarding.version }, expected: 422,
  });
  const progressed = await request(`/workspaces/${workspaceId}/onboarding`, {
    method: "PATCH", headers: ownerMfaHeaders,
    body: { version: onboarding.version, currentStep: "team", completedSteps: ["workspace_profile", "organization"] },
  });
  assert.equal(progressed.status, "in_progress");
  const completed = await request(`/workspaces/${workspaceId}/onboarding/complete`, {
    method: "POST", headers: ownerMfaHeaders, body: { version: progressed.version }, expected: 201,
  });
  assert.equal(completed.status, "completed");
  const signedIn = await request("/auth/login", {
    method: "POST", body: { email: ownerEmail, password, tenantSlug: slug }, expected: 201,
  });
  assert.equal(signedIn.mfaRequired, true);
  const verified = await request("/auth/mfa/verify", {
    method: "POST", body: { challengeToken: signedIn.challengeToken, code: ownerMfa.recoveryCodes[0] }, expected: 201,
  });
  assert.equal(verified.profile.nextAction, "enter_workspace");
  const profile = await request("/me", { headers: { authorization: `Bearer ${verified.accessToken}` } });
  const ownerMembership = profile.memberships.find((membership) => membership.workspaceId === workspaceId);
  assert.equal(ownerMembership.status, "active");
  assert.equal(ownerMembership.onboarding.status, "completed");
  assert.ok(ownerMembership.allowedModules.includes("workspace"));
  const audit = await database.query(
    `SELECT action FROM platform_operator_audit WHERE actor_user_id = $1 AND target_id = $2`,
    [operatorId, externalTenantId],
  );
  assert.ok(audit.rows.some((row) => row.action === "tenant.draft_created"));
  assert.ok(audit.rows.some((row) => row.action === "tenant.draft_provisioned"));
  assert.ok(audit.rows.some((row) => row.action === "tenant.owner_invitation_delivery_attempted"));
  console.log(`Tenant draft smoke passed: separate account/contact, pinned defaults, slug reservation, lost-response retry, tracked ${expectedDeliveryStatus} email delivery, expired/rotated invite denial, owner activation/MFA/onboarding, audited commands.`);
} finally {
  if (!workspaceId) {
    const registered = await database.query(
      `SELECT registry.workspace_id AS id FROM tenant_provisioning_requests registry
       JOIN workspaces workspace ON workspace.id = registry.workspace_id
       WHERE registry.external_tenant_id = $1 AND workspace.slug = $2`,
      [externalTenantId, slug],
    );
    workspaceId = registered.rows[0]?.id ?? null;
  }
  if (!accountId && workspaceId) {
    const linked = await database.query(
      `SELECT account.id FROM customer_account_organizations linked
       JOIN customer_accounts account ON account.id = linked.account_id
       WHERE linked.workspace_id = $1 AND account.external_customer_id = $2`,
      [workspaceId, externalTenantId],
    );
    accountId = linked.rows[0]?.id ?? null;
  }
  if (!draftId) {
    const found = await database.query(`SELECT id FROM tenant_provisioning_drafts WHERE external_tenant_id = $1`, [externalTenantId]);
    draftId = found.rows[0]?.id ?? null;
  }
  await database.query("BEGIN");
  try {
    await database.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only");
    if (workspaceId) await database.query(`DELETE FROM workspaces WHERE id = $1 AND slug = $2`, [workspaceId, slug]);
    await database.query(`DELETE FROM workspaces WHERE id = $1 AND slug = $2`, [takenWorkspaceId, takenSlug]);
    await database.query("ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only");
    if (accountId) await database.query(`DELETE FROM customer_accounts WHERE id = $1 AND external_customer_id = $2`, [accountId, externalTenantId]);
    if (draftId) await database.query(`DELETE FROM tenant_provisioning_drafts WHERE id = $1 AND external_tenant_id = $2`, [draftId, externalTenantId]);
    if (extraDraftIds.length) await database.query(
      `DELETE FROM tenant_provisioning_drafts WHERE id = ANY($1::uuid[])
       AND external_tenant_id IN ($2, $3)`,
      [extraDraftIds, `${externalTenantId}-expiring`, `${externalTenantId}-replacement`],
    );
    await database.query(`DELETE FROM platform_operator_audit WHERE actor_user_id = $1`, [operatorId]);
    await database.query(`DELETE FROM users WHERE primary_email = $1`, [ownerEmail]);
    await database.query(`DELETE FROM users WHERE id = $1 AND primary_email = $2`, [operatorId, email]);
    await database.query("COMMIT");
    const remaining = await database.query(`SELECT
      (SELECT count(*)::int FROM tenant_provisioning_drafts
       WHERE external_tenant_id = ANY($3::varchar[])) AS drafts,
      (SELECT count(*)::int FROM customer_accounts WHERE external_customer_id = $1) AS accounts,
      (SELECT count(*)::int FROM workspaces WHERE slug = $2) AS workspaces`,
      [externalTenantId, slug, [externalTenantId, `${externalTenantId}-expiring`, `${externalTenantId}-replacement`]]);
    assert.deepEqual(remaining.rows[0], { drafts: 0, accounts: 0, workspaces: 0 });
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  } finally {
    await database.end();
  }
}
