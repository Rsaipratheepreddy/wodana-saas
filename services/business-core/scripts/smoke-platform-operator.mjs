import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import pg from "pg";

const scrypt = promisify(scryptCallback);
const databaseUrl = process.env.PLATFORM_TEST_DATABASE_URL;
assert.ok(databaseUrl, "PLATFORM_TEST_DATABASE_URL is required");
assert.ok(["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname),
  "This smoke may run only against a local database");
const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8021/api/v1";
assert.ok(["localhost", "127.0.0.1", "::1"].includes(new URL(api).hostname),
  "This smoke may run only against a local API");
assert.ok(process.env.BUSINESS_CORE_INTERNAL_TOKEN, "BUSINESS_CORE_INTERNAL_TOKEN is required");

async function request(path, { body, headers = {}, method = body ? "POST" : "GET", expected = 200 } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  assert.equal(response.status, expected,
    `${method} ${path}: expected ${expected}, received ${response.status}: ${payload?.message ?? "unknown"}`);
  return payload;
}

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

const userId = randomUUID();
const reviewerUserId = randomUUID();
const workspaceId = randomUUID();
const targetWorkspaceId = randomUUID();
const accountId = randomUUID();
const visualTenantPrefix = process.env.PLATFORM_TEST_DOMAIN_VISUAL === "true"
  ? "domain-visual"
  : process.env.PLATFORM_TEST_ACCESS_UI_ONLY === "true" ? "access-visual" : "auth-smoke";
const externalTenantId = `${visualTenantPrefix}-operator-${randomUUID()}`;
const targetExternalTenantId = `auth-smoke-target-${randomUUID()}`;
const correlationId = randomUUID();
const email = `operator-smoke-${userId}@wodana.invalid`;
const reviewerEmail = `operator-reviewer-${reviewerUserId}@wodana.invalid`;
const visualSlug = `operator-web-${userId.slice(0, 8)}`;
const visualOwnerEmail = `visual-owner-${userId.slice(0, 8)}@wodana.invalid`;
const capabilityCode = `crm.operator_smoke_${userId.slice(0, 8)}`;
const password = `${randomBytes(20).toString("base64url")}aA1!`;
const salt = randomBytes(16).toString("hex");
const hash = (await scrypt(password, salt, 64)).toString("hex");
const reviewerSalt = randomBytes(16).toString("hex");
const reviewerHash = (await scrypt(password, reviewerSalt, 64)).toString("hex");
const database = new pg.Client({ connectionString: databaseUrl });
let exportObjectKey = null;
await database.connect();

try {
  await database.query(
    `INSERT INTO users (id, primary_email, display_name) VALUES ($1, $2, 'Operator Smoke')`,
    [userId, email],
  );
  await database.query(
    `INSERT INTO local_auth_credentials (user_id, password_hash, password_salt)
     VALUES ($1, $2, $3)`, [userId, hash, salt],
  );
  await database.query(
    `INSERT INTO platform_administrators (user_id) VALUES ($1)`, [userId],
  );
  await database.query(
    `INSERT INTO users (id, primary_email, display_name) VALUES ($1, $2, 'Operator Reviewer')`,
    [reviewerUserId, reviewerEmail],
  );
  await database.query(
    `INSERT INTO local_auth_credentials (user_id, password_hash, password_salt)
     VALUES ($1, $2, $3)`, [reviewerUserId, reviewerHash, reviewerSalt],
  );
  await database.query(
    `INSERT INTO platform_administrators (user_id) VALUES ($1)`, [reviewerUserId],
  );
  await database.query(
    `INSERT INTO workspaces (id, name, slug, default_currency, created_by)
     VALUES ($1, 'Operator Smoke Tenant', $2, 'AED', $3)`,
    [workspaceId, `operator-smoke-${workspaceId.slice(0, 8)}`, userId],
  );
  await database.query(
    `INSERT INTO workspace_subscriptions (workspace_id, currency) VALUES ($1, 'AED')`,
    [workspaceId],
  );
  await database.query(
    `INSERT INTO customer_accounts(id,display_name,created_by) VALUES($1,'Operator Smoke Account',$2)`,
    [accountId, userId],
  );
  await database.query(
    `INSERT INTO customer_account_organizations(account_id,workspace_id,is_default) VALUES($1,$2,true)`,
    [accountId, workspaceId],
  );
  await database.query(
    `INSERT INTO customer_account_contracts
      (account_id,status,plan_code,plan_version,currency,billing_cycle,seat_limit,project_limit,signed_at)
     VALUES($1,'contracted','starter',1,'AED','monthly',7,25,now())`,
    [accountId],
  );
  await database.query(
    `INSERT INTO tenant_provisioning_requests
       (external_tenant_id, idempotency_key, request_hash, workspace_id, response_body, expires_at)
     VALUES ($1, $2, $3, $4, '{}'::jsonb, now() + interval '1 hour')`,
    [externalTenantId, randomUUID(), randomBytes(32).toString("hex"), workspaceId],
  );
  await database.query(
    `INSERT INTO workspaces (id, name, slug, default_currency, created_by)
     VALUES ($1, 'Operator Clone Target', $2, 'AED', $3)`,
    [targetWorkspaceId, `operator-target-${targetWorkspaceId.slice(0, 8)}`, userId],
  );
  await database.query(
    `INSERT INTO workspace_subscriptions (workspace_id, currency) VALUES ($1, 'AED')`,
    [targetWorkspaceId],
  );
  await database.query(
    `INSERT INTO tenant_provisioning_requests
       (external_tenant_id, idempotency_key, request_hash, workspace_id, response_body, expires_at)
     VALUES ($1, $2, $3, $4, '{}'::jsonb, now() + interval '1 hour')`,
    [targetExternalTenantId, randomUUID(), randomBytes(32).toString("hex"), targetWorkspaceId],
  );

  const challenge = await request("/auth/platform/login", {
    body: { email, password }, expected: 201,
  });
  assert.equal(challenge.purpose, "enroll");
  assert.ok(challenge.challengeToken);
  await request("/internal/operator/tenants", {
    headers: { "x-wodana-internal-token": process.env.BUSINESS_CORE_INTERNAL_TOKEN },
    expected: 401,
  });
  await request("/internal/operator/tenants", {
    headers: { "x-wodana-internal-token": process.env.BUSINESS_CORE_INTERNAL_TOKEN,
      "x-wodana-operator-session": "forged-operator-session" },
    expected: 401,
  });
  const setup = await request("/auth/platform/mfa/setup", {
    body: { challengeToken: challenge.challengeToken }, expected: 201,
  });
  assert.match(setup.secret, /^[A-Z2-7]{32}$/);
  const confirmed = await request("/auth/platform/mfa/confirm", {
    body: { challengeToken: challenge.challengeToken, code: totp(setup.secret) }, expected: 201,
  });
  assert.ok(confirmed.sessionToken);
  assert.equal(confirmed.recoveryCodes.length, 10);
  const operatorHeader = { "x-wodana-internal-token": process.env.BUSINESS_CORE_INTERNAL_TOKEN,
    "x-wodana-operator-session": confirmed.sessionToken };
  const reviewerChallenge = await request("/auth/platform/login", {
    body: { email: reviewerEmail, password }, expected: 201,
  });
  const reviewerSetup = await request("/auth/platform/mfa/setup", {
    body: { challengeToken: reviewerChallenge.challengeToken }, expected: 201,
  });
  const reviewerConfirmed = await request("/auth/platform/mfa/confirm", {
    body: { challengeToken: reviewerChallenge.challengeToken, code: totp(reviewerSetup.secret) }, expected: 201,
  });
  const reviewerHeader = { "x-wodana-internal-token": process.env.BUSINESS_CORE_INTERNAL_TOKEN,
    "x-wodana-operator-session": reviewerConfirmed.sessionToken };
  const profile = await request("/auth/platform/session", {
    headers: { authorization: `Bearer ${confirmed.sessionToken}` },
  });
  assert.equal(profile.userId, userId);
  const tenants = await request("/internal/operator/tenants", { headers: operatorHeader });
  assert.ok(Array.isArray(tenants));
  if (process.env.PLATFORM_TEST_DOMAIN_API === "true") {
    const domainHostname = `portal-${userId.slice(0, 8)}.example.test`;
    const domainPath = `/internal/operator/tenants/${externalTenantId}/domains`;
    const domainKey = `domain-smoke-${userId}`;
    const domain = await request(domainPath, {
      headers: { ...operatorHeader, "idempotency-key": domainKey },
      body: { hostname: domainHostname }, expected: 201,
    });
    assert.equal(domain.hostname, domainHostname);
    assert.equal(domain.dns.status, "pending");
    const pendingStatus = await request(`/internal/operator/tenants/${externalTenantId}/status`, { headers: operatorHeader });
    assert.equal(pendingStatus.domain.hostname, domainHostname);
    assert.equal(pendingStatus.domain.customDomainStatus, "requested");
    const domainReplay = await request(domainPath, {
      headers: { ...operatorHeader, "idempotency-key": domainKey },
      body: { hostname: domainHostname }, expected: 201,
    });
    assert.equal(domainReplay.id, domain.id);
    assert.equal(domainReplay.replayed, true);
    const listedDomains = await request(domainPath, { headers: operatorHeader });
    assert.equal(listedDomains.domains.length, 1);
    assert.equal(listedDomains.platformHostname, `operator-smoke-${workspaceId.slice(0, 8)}.wodana.ai`);
    await request(`${domainPath}/${domain.id}/recheck`, {
      headers: operatorHeader, body: { expectedVersion: domain.version }, expected: 409,
    });
    const rotated = await request(`${domainPath}/${domain.id}/rotate-challenge`, {
      headers: operatorHeader, body: { expectedVersion: domain.version }, expected: 201,
    });
    assert.notEqual(rotated.dns.record.value, domain.dns.record.value);
    const removed = await request(`${domainPath}/${domain.id}/remove`, {
      headers: operatorHeader, body: { expectedVersion: rotated.version }, expected: 201,
    });
    assert.ok(removed.removedAt);
    assert.equal((await request(domainPath, { headers: operatorHeader })).domains.length, 0);
    const fallbackStatus = await request(`/internal/operator/tenants/${externalTenantId}/status`, { headers: operatorHeader });
    assert.equal(fallbackStatus.domain.customDomainStatus, "not_configured");
    const domainAudit = await database.query(
      `SELECT action FROM platform_operator_audit WHERE actor_user_id = $1 AND target_id = $2 AND action LIKE 'tenant.domain_%'`,
      [userId, externalTenantId],
    );
    assert.ok(domainAudit.rows.some((row) => row.action === "tenant.domain_requested"));
    assert.ok(domainAudit.rows.some((row) => row.action === "tenant.domain_challenge_rotated"));
    assert.ok(domainAudit.rows.some((row) => row.action === "tenant.domain_removed"));
  }
  const managed = await request(`/internal/operator/tenants/${externalTenantId}/management`, {
    headers: operatorHeader,
  });
  await request(`/internal/operator/tenants/${externalTenantId}/management`, {
    method: "PATCH", expected: 409,
    headers: { ...operatorHeader, "x-request-id": correlationId },
    body: { expectedWorkspaceVersion: managed.workspace.version,
      expectedSubscriptionVersion: managed.subscription.version, seatLimit: 7 },
  });
  await request(`/internal/operator/tenants/${externalTenantId}/management`, {
    method: "PATCH", expected: 409,
    headers: { ...operatorHeader, "x-request-id": correlationId },
    body: { expectedWorkspaceVersion: managed.workspace.version,
      expectedSubscriptionVersion: managed.subscription.version, workspaceStatus: "suspended",
      reason: "Synthetic operator suspension review" },
  });
  const lifecyclePath = `/internal/operator/tenants/${externalTenantId}/operations/lifecycle`;
  const beforeLifecycle = await request(lifecyclePath, { headers: operatorHeader });
  assert.equal(beforeLifecycle.version, 0);
  assert.ok(beforeLifecycle.nextStates.includes("suspended"));
  const suspendKey = randomUUID();
  const suspension = { expectedVersion: 0, to: "suspended", reason: "Synthetic operator suspension review" };
  const suspended = await request(`${lifecyclePath}/transitions`, {
    method: "POST", expected: 201,
    headers: { ...operatorHeader, "x-request-id": correlationId, "idempotency-key": suspendKey },
    body: suspension,
  });
  assert.equal(suspended.state, "suspended");
  assert.equal(suspended.workspaceStatus, "suspended");
  assert.equal(suspended.noticeDeliveryState, "not_configured");
  assert.equal((await request(`${lifecyclePath}/transitions`, {
    method: "POST", expected: 201,
    headers: { ...operatorHeader, "idempotency-key": suspendKey }, body: suspension,
  })).replayed, true);
  await request(`${lifecyclePath}/transitions`, {
    method: "POST", expected: 409,
    headers: { ...operatorHeader, "idempotency-key": suspendKey },
    body: { ...suspension, reason: "A different lifecycle decision reason" },
  });
  await request(`${lifecyclePath}/transitions`, {
    method: "POST", expected: 409,
    headers: { ...operatorHeader, "idempotency-key": randomUUID() }, body: suspension,
  });
  const restored = await request(`${lifecyclePath}/transitions`, {
    method: "POST", expected: 201,
    headers: { ...operatorHeader, "idempotency-key": randomUUID() },
    body: { expectedVersion: 1, to: "trial", reason: "Synthetic operator trial reactivation review" },
  });
  assert.equal(restored.workspaceStatus, "active");
  const currentLifecycle = await request(lifecyclePath, { headers: operatorHeader });
  assert.equal(currentLifecycle.state, "trial");
  assert.equal(currentLifecycle.version, 2);
  assert.equal(currentLifecycle.history.length, 2);
  const updated = await request(`/internal/operator/tenants/${externalTenantId}/management`, { headers: operatorHeader });
  assert.equal(updated.workspace.status, "active");
  const tenantAudit = await database.query(
    `SELECT actor_user_id, correlation_id FROM audit_events
     WHERE workspace_id = $1 AND action = 'tenant.lifecycle_transitioned' ORDER BY occurred_at ASC LIMIT 1`,
    [workspaceId],
  );
  const operatorAudit = await database.query(
    `SELECT actor_user_id, correlation_id FROM platform_operator_audit
     WHERE target_id = $1 AND action = 'tenant.lifecycle_transitioned' ORDER BY created_at ASC LIMIT 1`,
    [externalTenantId],
  );
  assert.equal(tenantAudit.rows[0]?.actor_user_id, userId);
  assert.equal(operatorAudit.rows[0]?.actor_user_id, userId);
  assert.equal(tenantAudit.rows[0]?.correlation_id, correlationId);
  assert.equal(operatorAudit.rows[0]?.correlation_id, correlationId);

  const operationsPath = `/internal/operator/tenants/${externalTenantId}/operations`;
  const billingPath = `${operationsPath}/billing`;
  const billingBefore = await request(billingPath, { headers: operatorHeader });
  assert.equal(billingBefore.authority, "account_contract");
  assert.equal(billingBefore.contract.status, "not_configured");
  const signedAt = new Date(Date.now() - 86_400_000).toISOString();
  const termStartsAt = new Date(Date.now() - 86_400_000).toISOString();
  const renewsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const contract = await request(`${billingPath}/contract`, {
    method: "PATCH", headers: operatorHeader,
    body: { expectedVersion: 0, status: "contracted", planCode: "starter", planVersion: 1,
      currency: "AED", billingCycle: "monthly", recurringAmount: 1000, seatLimit: 7, projectLimit: 25,
      signedAt, termStartsAt, renewsAt, legalEntityReference: "Synthetic Operator Entity",
      terms: { paymentDays: 30 }, reason: "Synthetic versioned account billing contract acceptance" },
  });
  assert.equal(contract.version, 1);
  assert.equal(contract.taxValidationState, "unverified");
  const allocation = await request(`${billingPath}/allocation`, {
    method: "PATCH", headers: operatorHeader,
    body: { expectedVersion: 0, status: "active", allocatedAmount: 1000, seatLimit: 7, projectLimit: 25,
      reason: "Synthetic organization allocation against the account contract" },
  });
  assert.equal(allocation.version, 1);
  const usageSnapshot = await request(`${billingPath}/usage-snapshots`, {
    headers: operatorHeader, expected: 201,
    body: { periodStart: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      periodEnd: new Date().toISOString(), source: "computed" },
  });
  assert.equal(usageSnapshot.source, "computed");
  const invoiceKey = `billing-invoice-${userId}`;
  const invoiceInput = { documentType: "invoice", provider: "wodana", externalReference: `INV-${userId}`,
    documentNumber: `INV-${userId.slice(0, 8)}`, eventType: "created", status: "issued", currency: "AED",
    totalAmount: 1000, balanceAmount: 1000, issuedAt: new Date().toISOString(),
    dueAt: new Date(Date.now() + 14 * 86_400_000).toISOString(), occurredAt: new Date().toISOString(),
    legalEntityReference: "Synthetic Operator Entity", metadata: { synthetic: true } };
  const invoice = await request(`${billingPath}/documents/events`, {
    headers: { ...operatorHeader, "idempotency-key": invoiceKey }, expected: 201, body: invoiceInput,
  });
  assert.equal(invoice.replayed, false);
  const replayedInvoice = await request(`${billingPath}/documents/events`, {
    headers: { ...operatorHeader, "idempotency-key": invoiceKey }, expected: 201, body: invoiceInput,
  });
  assert.equal(replayedInvoice.replayed, true);
  await request(`${billingPath}/documents/events`, {
    headers: { ...operatorHeader, "idempotency-key": `billing-receipt-${userId}` }, expected: 409,
    body: { ...invoiceInput, documentType: "receipt", externalReference: `REC-${userId}`,
      eventType: "provider_notification", status: "verified", balanceAmount: 0 },
  });
  const receiptReference = `REC-FAILED-${userId}`;
  const failedReceipt = await request(`${billingPath}/documents/events`, {
    headers: { ...operatorHeader, "idempotency-key": `billing-receipt-failed-${userId}` }, expected: 201,
    body: { ...invoiceInput, documentType: "receipt", externalReference: receiptReference,
      documentNumber: `REC-${userId.slice(0, 8)}`, eventType: "provider_notification",
      status: "failed", balanceAmount: 1000 },
  });
  assert.equal(failedReceipt.status, "failed");
  const verifiedReceipt = await request(`${billingPath}/documents/events`, {
    headers: { ...operatorHeader, "idempotency-key": `billing-receipt-verified-${userId}` }, expected: 201,
    body: { ...invoiceInput, documentType: "receipt", externalReference: receiptReference,
      documentNumber: `REC-${userId.slice(0, 8)}`, eventType: "finance_verified",
      status: "verified", balanceAmount: 0, settledAt: new Date().toISOString() },
  });
  assert.equal(verifiedReceipt.status, "verified");
  const refundedReceipt = await request(`${billingPath}/documents/events`, {
    headers: { ...operatorHeader, "idempotency-key": `billing-receipt-refunded-${userId}` }, expected: 201,
    body: { ...invoiceInput, documentType: "receipt", externalReference: receiptReference,
      documentNumber: `REC-${userId.slice(0, 8)}`, eventType: "corrected",
      status: "refunded", balanceAmount: 1000, settledAt: new Date().toISOString() },
  });
  assert.equal(refundedReceipt.status, "refunded");
  await request(`${billingPath}/documents/events`, {
    headers: { ...operatorHeader, "idempotency-key": `billing-refund-without-origin-${userId}` }, expected: 409,
    body: { ...invoiceInput, documentType: "receipt", externalReference: `REC-ORPHAN-${userId}`,
      eventType: "corrected", status: "refunded", balanceAmount: 1000 },
  });
  const pastDue = await request(`${billingPath}/collection`, {
    method: "PATCH", headers: operatorHeader,
    body: { expectedVersion: 0, status: "past_due", overdueAmount: 1000, currency: "AED",
      nextReviewAt: new Date(Date.now() + 86_400_000).toISOString(),
      reason: "Synthetic past due collection status requires an explicit review" },
  });
  assert.equal(pastDue.version, 1);
  const currentCollection = await request(`${billingPath}/collection`, {
    method: "PATCH", headers: operatorHeader,
    body: { expectedVersion: 1, status: "current", overdueAmount: 0, currency: "AED",
      reason: "Synthetic collection state restored after verified settlement" },
  });
  assert.equal(currentCollection.status, "current");
  const billingAfter = await request(billingPath, { headers: operatorHeader });
  assert.equal(billingAfter.contract.version, 1);
  assert.equal(billingAfter.organizationAllocation.version, 1);
  assert.equal(billingAfter.documents.length, 2);
  assert.equal(billingAfter.documents.find((document) => document.externalReference === receiptReference)?.status,
    "refunded");
  assert.equal(billingAfter.usageSnapshots.length, 1);
  const catalogPath = "/internal/operator/tenants/platform/entitlement-catalog";
  const catalog = await request(catalogPath, { headers: operatorHeader });
  assert.ok(catalog.plans.some((plan) => plan.code === "starter" && plan.version === 1));
  const capability = await request("/internal/operator/tenants/platform/capabilities", {
    method: "PATCH", headers: operatorHeader,
    body: { code: capabilityCode, module: "crm", releaseState: "internal_preview", expectedVersion: 0,
      reason: "Synthetic unfinished capability remains independent from tenant allocations" },
  });
  assert.equal(capability.version, 1);
  assert.equal(capability.releaseState, "internal_preview");
  const operationsBefore = await request(operationsPath, { headers: operatorHeader });
  assert.equal(operationsBefore.entitlements.status, "not_configured");
  assert.equal(operationsBefore.dataPolicy.status, "not_configured");
  const entitlement = await request(`${operationsPath}/entitlements`, {
    method: "PATCH", headers: operatorHeader,
    body: {
      expectedVersion: 0, planCode: "starter", planVersion: 1, status: "active",
      modules: ["workspace", "crm"], limits: {},
      reason: "Synthetic operator entitlement acceptance",
    },
  });
  assert.deepEqual(entitlement.modules, ["workspace", "crm"]);
  assert.equal(entitlement.customOverride, true);
  const scheduled = await request(`${operationsPath}/entitlements`, {
    method: "PATCH", headers: operatorHeader,
    body: {
      expectedVersion: 1, planCode: "starter", planVersion: 1, status: "scheduled",
      modules: ["workspace", "crm", "projects"], limits: {},
      effectiveFrom: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      reason: "Synthetic future project allocation must not activate early",
    },
  });
  assert.equal(scheduled.status, "scheduled");
  assert.equal(scheduled.version, 2);
  const statusWithEntitlements = await request(`/internal/operator/tenants/${externalTenantId}/status`, { headers: operatorHeader });
  assert.equal(statusWithEntitlements.commercialEntitlements.status, "active");
  assert.deepEqual(statusWithEntitlements.commercialEntitlements.modules, ["workspace", "crm"]);
  const policy = await request(`${operationsPath}/data-policy`, {
    method: "PATCH", headers: operatorHeader,
    body: {
      expectedVersion: 0, storageQuotaBytes: 1024 * 1024 * 1024, retentionDays: 365,
      legalHold: false, scanRequirement: "required", exportBeforeErasure: true,
    },
  });
  assert.equal(policy.scannerStatus, "baseline");
  const support = await request(`${operationsPath}/support-sessions`, {
    headers: operatorHeader, expected: 201,
    body: { accessLevel: "read_only", durationMinutes: 60, reason: "Synthetic support access acceptance request" },
  });
  await request(`${operationsPath}/support-sessions/${support.id}/decision`, {
    headers: operatorHeader, expected: 409,
    body: { expectedVersion: support.version, decision: "approve", reason: "Requester cannot approve this support session" },
  });
  const approvedSupport = await request(`${operationsPath}/support-sessions/${support.id}/decision`, {
    headers: reviewerHeader, expected: 201,
    body: { expectedVersion: support.version, decision: "approve", reason: "Second operator reviewed the support request" },
  });
  assert.equal(approvedSupport.status, "active");
  const operationKey = `tenant-export-${userId}`;
  const exportPlan = await request(`${operationsPath}/plans`, {
    headers: { ...operatorHeader, "idempotency-key": operationKey }, expected: 201,
    body: { operationType: "export", reason: "Synthetic verified tenant export dry run" },
  });
  assert.equal(exportPlan.phase, "dry_run");
  assert.equal(exportPlan.status, "planned");
  const replayedExportPlan = await request(`${operationsPath}/plans`, {
    headers: { ...operatorHeader, "idempotency-key": operationKey }, expected: 201,
    body: { operationType: "export", reason: "Synthetic verified tenant export dry run" },
  });
  assert.equal(replayedExportPlan.id, exportPlan.id);
  await request(`${operationsPath}/plans`, {
    headers: { ...operatorHeader, "idempotency-key": operationKey }, expected: 409,
    body: { operationType: "erasure", reason: "A different operation must not replay this key" },
  });
  const verifiedExport = await request(`${operationsPath}/${exportPlan.id}/decision`, {
    headers: reviewerHeader, expected: 201,
    body: { expectedVersion: exportPlan.version, decision: "approve", reason: "Second operator reviewed the tenant export scope" },
  });
  assert.equal(verifiedExport.status, "succeeded");
  assert.match(verifiedExport.result.sha256, /^[0-9a-f]{64}$/);
  exportObjectKey = verifiedExport.result.objectKey;
  const exportDownload = await fetch(`${api}${operationsPath}/exports/${verifiedExport.result.exportId}/content`, {
    headers: reviewerHeader,
  });
  assert.equal(exportDownload.status, 200);
  const exportBody = Buffer.from(await exportDownload.arrayBuffer());
  assert.equal(createHash("sha256").update(exportBody).digest("hex"), verifiedExport.result.sha256);
  const exportPayload = JSON.parse(exportBody.toString("utf8"));
  assert.equal(exportPayload.externalTenantId, externalTenantId);
  assert.equal(exportPayload.scope, "tenant_records_and_object_manifest");
  assert.ok(exportPayload.tables.some((table) => table.name === "workspace_entitlement_sets"));
  const clonePlan = await request(`${operationsPath}/plans`, {
    headers: { ...operatorHeader, "idempotency-key": `tenant-clone-${userId}` }, expected: 201,
    body: { operationType: "clone", targetExternalTenantId,
      reason: "Synthetic configuration clone with second operator review" },
  });
  assert.equal(clonePlan.status, "planned");
  await request(`${operationsPath}/${clonePlan.id}/decision`, {
    headers: operatorHeader, expected: 409,
    body: { expectedVersion: clonePlan.version, decision: "approve", reason: "Requester cannot approve this configuration clone" },
  });
  const appliedClone = await request(`${operationsPath}/${clonePlan.id}/decision`, {
    headers: reviewerHeader, expected: 201,
    body: { expectedVersion: clonePlan.version, decision: "approve", reason: "Second operator reviewed the clone dry run" },
  });
  assert.equal(appliedClone.status, "succeeded");
  assert.equal(appliedClone.phase, "apply");
  const targetConfiguration = await database.query(
    `SELECT entitlement.modules, policy.retention_days
     FROM workspace_entitlement_sets entitlement
     JOIN workspace_data_policies policy ON policy.workspace_id=entitlement.workspace_id
     WHERE entitlement.workspace_id=$1`, [targetWorkspaceId],
  );
  assert.deepEqual(targetConfiguration.rows[0].modules, ["workspace", "crm"]);
  assert.equal(targetConfiguration.rows[0].retention_days, 365);
  const rollbackPlan = await request(`${operationsPath}/plans`, {
    headers: { ...reviewerHeader, "idempotency-key": `tenant-rollback-${userId}` }, expected: 201,
    body: { operationType: "clone", rollbackOf: clonePlan.id, targetExternalTenantId,
      reason: "Synthetic restoration to the pre-clone target configuration" },
  });
  assert.equal(rollbackPlan.status, "planned");
  const rolledBack = await request(`${operationsPath}/${rollbackPlan.id}/decision`, {
    headers: operatorHeader, expected: 201,
    body: { expectedVersion: rollbackPlan.version, decision: "approve", reason: "Second operator reviewed the rollback dry run" },
  });
  assert.equal(rolledBack.status, "succeeded");
  assert.equal(rolledBack.phase, "rollback");
  const restoredTarget = await database.query(
    `SELECT (SELECT count(*)::int FROM workspace_entitlement_sets WHERE workspace_id=$1) AS entitlements,
            (SELECT count(*)::int FROM workspace_data_policies WHERE workspace_id=$1) AS policies`, [targetWorkspaceId],
  );
  assert.deepEqual(restoredTarget.rows[0], { entitlements: 0, policies: 0 });
  const operationsAfter = await request(operationsPath, { headers: operatorHeader });
  assert.equal(operationsAfter.entitlements.version, 1);
  assert.equal(operationsAfter.entitlementHistory[0].version, 2);
  assert.deepEqual(operationsAfter.entitlementHistory[0].modules, ["workspace", "crm", "projects"]);
  assert.equal(operationsAfter.dataPolicy.version, 1);
  assert.equal(operationsAfter.supportSessions[0].status, "active");
  assert.ok(operationsAfter.operations.some((operation) => operation.id === exportPlan.id));
  await request("/me", { headers: { authorization: `Bearer ${confirmed.sessionToken}` }, expected: 401 });
  await request("/auth/platform/mfa/confirm", {
    body: { challengeToken: challenge.challengeToken, code: "000000" }, expected: 410,
  });

  if (process.env.PLATFORM_TEST_WEB_URL) {
    const web = process.env.PLATFORM_TEST_WEB_URL;
    assert.ok(["localhost", "127.0.0.1", "::1"].includes(new URL(web).hostname),
      "The web smoke may run only against a local web server");
    const webPost = async (action, body, cookie) => {
      const response = await fetch(`${web}/api/internal/auth/${action}`, {
        method: "POST",
        headers: { origin: web, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
        redirect: "manual",
      });
      const payload = await response.json().catch(() => null);
      assert.equal(response.status, 200,
        `Web ${action}: expected 200, received ${response.status}: ${payload?.message ?? "unknown"}`);
      return { response, payload };
    };
    const webChallenge = (await webPost("login", { email, password })).payload;
    assert.equal(webChallenge.purpose, "login");
    const webVerified = await webPost("verify", {
      challengeToken: webChallenge.challengeToken,
      code: confirmed.recoveryCodes[1],
    });
    assert.equal(webVerified.payload.sessionToken, undefined);
    const cookie = webVerified.response.headers.get("set-cookie")?.match(/wodana_operator=[^;]+/)?.[0];
    assert.ok(cookie, "The Next BFF must set a private operator cookie");
    const internalPage = await fetch(`${web}/internal`, { headers: { cookie }, redirect: "manual" });
    assert.equal(internalPage.status, 200, "The operator should reach Wodana Control without tenant membership");
    assert.match(await internalPage.text(), /Tenants/);
    const createPage = await fetch(`${web}/internal/new`, { headers: { cookie }, redirect: "manual" });
    assert.equal(createPage.status, 200, "The operator should reach the dedicated customer setup flow");
    assert.match(await createPage.text(), /Add customer/);
    const profilesResponse = await fetch(`${web}/api/internal/provisioning/profiles`, { headers: { cookie } });
    assert.equal(profilesResponse.status, 200, "The setup profiles BFF should enforce the operator session");
    const profiles = await profilesResponse.json();
    if (process.env.PLATFORM_TEST_ACCESS_UI_ONLY !== "true") {
      assert.ok(profiles.some((profile) => profile.kind === "firm_kit" && profile.code === "design_build" && profile.version === 2));
      assert.equal(profiles.some((profile) => profile.kind === "firm_kit" && profile.version === 1), false);
    }
    if (process.env.PLATFORM_TEST_VISUAL_DIR) {
      const { chromium } = await import("playwright");
      const { resolve } = await import("node:path");
      const browser = await chromium.launch();
      try {
        for (const { name, width, height, colorScheme } of [
          { name: "desktop-light", width: 1440, height: 900, colorScheme: "light" },
          { name: "desktop-dark", width: 1440, height: 900, colorScheme: "dark" },
          { name: "mobile-light", width: 390, height: 844, colorScheme: "light" },
          { name: "mobile-dark", width: 390, height: 844, colorScheme: "dark" },
        ]) {
          const context = await browser.newContext({ viewport: { width, height }, colorScheme });
          await context.addCookies([{ name: "wodana_operator", value: cookie.split("=")[1], url: web }]);
          const page = await context.newPage();
          await page.goto(`${web}/internal`);
          await page.getByRole("row", { name: /Operator Smoke Tenant/ }).click();
          await page.getByLabel("Seat capacity").waitFor();
          await page.getByLabel("Tenant member access").waitFor();
          assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1,
            `${name} tenant access explanation overflows horizontally`);
          await page.screenshot({ path: resolve(process.env.PLATFORM_TEST_VISUAL_DIR, `cp03-access-${name}.png`), fullPage: true, animations: "disabled" });
          if (name === "desktop-light") {
            await page.getByRole("button", { name: "Manage lifecycle" }).click();
            await page.getByRole("heading", { name: "Lifecycle" }).waitFor();
            await page.getByRole("button", { name: "Review lifecycle change" }).waitFor();
            await page.screenshot({ path: resolve(process.env.PLATFORM_TEST_VISUAL_DIR, "cp06-lifecycle-desktop-light.png"), fullPage: true, animations: "disabled" });
          }
          if (process.env.PLATFORM_TEST_ENTITLEMENT_VISUAL === "true") {
            await page.goto(`${web}/internal/tenants/${encodeURIComponent(externalTenantId)}/operations`);
            await page.getByRole("table", { name: "Tenant module access" }).waitFor();
            assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1,
              `${name} entitlement view overflows horizontally`);
            await page.screenshot({ path: resolve(process.env.PLATFORM_TEST_VISUAL_DIR, `cp04-entitlements-${name}.png`), fullPage: true, animations: "disabled" });
            if (name === "desktop-light") {
              await page.getByRole("button", { name: "Review allocation" }).click();
              const review = page.getByRole("dialog", { name: "Apply module allocation?" });
              await review.getByText("Modules removed", { exact: true }).waitFor();
              await page.screenshot({ path: resolve(process.env.PLATFORM_TEST_VISUAL_DIR, "cp04-entitlement-review-desktop-light.png"), fullPage: true, animations: "disabled" });
              await review.getByRole("button", { name: "Keep editing" }).click();
            }
          }
          if (process.env.PLATFORM_TEST_BILLING_VISUAL === "true") {
            await page.goto(`${web}/internal/tenants/${encodeURIComponent(externalTenantId)}/operations`);
            await page.getByLabel("Account billing summary").waitFor();
            assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1,
              `${name} billing view overflows horizontally`);
            await page.screenshot({ path: resolve(process.env.PLATFORM_TEST_VISUAL_DIR, `cp05-billing-${name}.png`), fullPage: true, animations: "disabled" });
            if (name === "desktop-light") {
              const billingRegion = page.getByRole("region", { name: "Billing and usage" });
              await billingRegion.getByRole("button", { name: "Account contract", exact: true }).click();
              await billingRegion.getByRole("button", { name: "Review contract" }).click();
              const review = page.getByRole("dialog", { name: "Version account contract?" });
              await review.getByText("Current-period estimate", { exact: true }).waitFor();
              await page.screenshot({ path: resolve(process.env.PLATFORM_TEST_VISUAL_DIR, "cp05-billing-review-desktop-light.png"), fullPage: true, animations: "disabled" });
              await review.getByRole("button", { name: "Keep editing" }).click();
            }
          }
          if (process.env.PLATFORM_TEST_ACCESS_UI_ONLY === "true") {
            await context.close();
            continue;
          }
          if (process.env.PLATFORM_TEST_DOMAIN_VISUAL === "true") {
            await page.route("**/api/internal/tenants/*/domains", async (route) => {
              await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
                platformHostname: `operator-smoke-${workspaceId.slice(0, 8)}.wodana.ai`,
                domains: [{ id: randomUUID(), hostname: "portal.example.test", version: 1,
                  dns: { status: "pending", record: { type: "TXT", name: "_wodana-verify.portal.example.test", value: "wodana-verify=synthetic-local-proof" }, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), verifiedAt: null },
                  certificate: { status: "not_requested", expiresAt: null }, routing: { status: "not_requested", activatedAt: null },
                  rollback: { status: "none" }, removedAt: null, updatedAt: new Date().toISOString() }],
              }) });
            });
            await page.goto(`${web}/internal`);
            await page.getByRole("row", { name: /Operator Smoke Tenant/ }).click();
            await page.getByText("_wodana-verify.portal.example.test").waitFor();
            assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1,
              `${name} domain operator view overflows horizontally`);
            await page.screenshot({ path: resolve(process.env.PLATFORM_TEST_VISUAL_DIR, `cp02-domain-${name}.png`), fullPage: true, animations: "disabled" });
          }
          await page.goto(`${web}/internal/new`);
          await page.getByRole("heading", { name: "Add customer" }).waitFor();
          await page.getByRole("textbox", { name: /Customer account/ }).fill("Synthetic Design Group");
          await page.getByRole("textbox", { name: /Organization/ }).fill("Synthetic Workshop");
          await page.getByRole("textbox", { name: /Contract contact/ }).fill("Contract Tester");
          await page.getByRole("textbox", { name: /Contact email/ }).fill(`visual-contact-${userId.slice(0, 8)}@wodana.invalid`);
          await page.getByRole("textbox", { name: /Owner name/ }).fill("Owner Tester");
          await page.getByRole("textbox", { name: /Owner email/ }).fill(visualOwnerEmail);
          await page.getByRole("textbox", { name: /Login address/ }).fill(visualSlug);
          assert.ok(await page.getByRole("button", { name: "Review setup" }).isVisible());
          assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, `${name} overflows horizontally`);
          await page.screenshot({ path: resolve(process.env.PLATFORM_TEST_VISUAL_DIR, `cp01-new-${name}.png`), animations: "disabled" });
          await page.getByRole("button", { name: "Review setup" }).click();
          await page.getByRole("button", { name: "Create customer" }).waitFor();
          assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, `${name} review overflows horizontally`);
          await page.screenshot({ path: resolve(process.env.PLATFORM_TEST_VISUAL_DIR, `cp01-review-${name}.png`), animations: "disabled" });
          if (name === "desktop-light") {
            await page.getByRole("button", { name: "Create customer" }).click();
            await page.getByText("Customer and organization created").waitFor();
            assert.ok(await page.getByText("Not sent", { exact: true }).isVisible());
            const invitationResponse = page.waitForResponse((response) => response.url().includes("/owner-invitation/send")
              && response.request().method() === "POST");
            await page.getByRole("button", { name: "Send owner email" }).click();
            const ownerInvitation = await (await invitationResponse).json();
            assert.ok(ownerInvitation.invitationToken, "Unconfigured email must retain a manual owner activation link");
            await page.getByText("Email is not configured").waitFor();
            assert.ok(await page.getByText("Manual activation link").isVisible());
            await page.screenshot({ path: resolve(process.env.PLATFORM_TEST_VISUAL_DIR, "cp01-ready-desktop-light.png"), animations: "disabled" });
            const created = await database.query(
              `SELECT setup.firm_kit_version, workflow.code, delivery.status
               FROM workspaces workspace
               JOIN workspace_setup_versions setup ON setup.workspace_id = workspace.id
               JOIN project_workflow_templates workflow ON workflow.workspace_id = workspace.id AND workflow.is_default
               JOIN workspace_invitation_delivery delivery ON delivery.workspace_id = workspace.id
               WHERE workspace.slug = $1`, [visualSlug],
            );
            assert.deepEqual(created.rows[0], { firm_kit_version: 2, code: "standard_delivery", status: "not_configured" });
            const ownerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
            try {
              const ownerPage = await ownerContext.newPage();
              await ownerPage.goto(`${web}/login?tenant=${visualSlug}&invitation=${encodeURIComponent(ownerInvitation.invitationToken)}`);
              await ownerPage.getByRole("heading", { name: "Create your password" }).waitFor();
              await ownerPage.getByRole("textbox", { name: "New password" }).fill(password);
              await ownerPage.getByRole("textbox", { name: "Confirm password" }).fill(password);
              await ownerPage.getByRole("button", { name: "Activate invitation" }).click();
              await ownerPage.getByRole("heading", { name: "Protect your account" }).waitFor();
              const setupResponse = ownerPage.waitForResponse((response) => response.url().endsWith("/api/auth/mfa/setup")
                && response.request().method() === "POST");
              await ownerPage.getByRole("button", { name: "Set up authenticator" }).click();
              const ownerSetup = await (await setupResponse).json();
              await ownerPage.getByRole("heading", { name: "Connect your authenticator" }).waitFor();
              const code = totp(ownerSetup.secret);
              for (const [index, digit] of [...code].entries()) {
                await ownerPage.locator(`[aria-label="Digit ${index + 1}"]`).fill(digit);
              }
              const confirmResponse = ownerPage.waitForResponse((response) => response.url().endsWith("/api/auth/mfa/confirm")
                && response.request().method() === "POST");
              await ownerPage.getByRole("button", { name: "Confirm authenticator" }).click();
              const ownerRecovery = await (await confirmResponse).json();
              assert.equal(ownerRecovery.recoveryCodes.length, 10);
              await ownerPage.getByRole("heading", { name: "Save your recovery codes" }).waitFor();
              await ownerPage.getByText("I saved these recovery codes").click();
              assert.equal(await ownerPage.getByRole("checkbox", { name: "I saved these recovery codes" }).isChecked(), true);
              await ownerPage.getByRole("button", { name: "Continue to workspace" }).click();
              await ownerPage.waitForURL(/\/onboarding$/, { timeout: 30_000 });
              await ownerPage.getByRole("button", { name: "Open your welcome" }).click();
              await ownerPage.getByRole("button", { name: "Set up your workspace" }).click();
              await ownerPage.getByRole("heading", { name: "Tell us about your company" }).waitFor();
              assert.ok((await ownerPage.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1,
                "Mobile owner onboarding overflows horizontally");
              await ownerPage.screenshot({ path: resolve(process.env.PLATFORM_TEST_VISUAL_DIR, "cp01-owner-onboarding-mobile-light.png"), animations: "disabled" });
              await ownerPage.getByRole("button", { name: "Save and continue" }).click();
              await ownerPage.getByRole("heading", { name: "Set your workspace defaults" }).waitFor();
              await ownerPage.getByRole("button", { name: "Save and continue" }).click();
              await ownerPage.getByRole("heading", { name: "Bring your team with you" }).waitFor();
              await ownerPage.getByRole("button", { name: "Continue" }).click();
              await ownerPage.getByRole("heading", { name: "Connect the tools you use" }).waitFor();
              await ownerPage.getByRole("button", { name: "Finish setup" }).click();
              await ownerPage.getByRole("button", { name: "Enter workspace" }).click();
              await ownerPage.waitForURL(/\/workspace$/, { timeout: 30_000 });
              await ownerPage.goto(`${web}/workspace/crm`);
              assert.equal(ownerPage.url().includes("/login"), false, "The owner must enter the permitted CRM workspace");
              await ownerPage.screenshot({ path: resolve(process.env.PLATFORM_TEST_VISUAL_DIR, "cp01-owner-crm-mobile-light.png"), animations: "disabled" });
              const state = await database.query(
                `SELECT onboarding.status, invitation.status AS invitation_status
                 FROM workspace_onboarding onboarding
                 JOIN workspace_invitations invitation ON invitation.workspace_id = onboarding.workspace_id
                 WHERE onboarding.workspace_id = (SELECT id FROM workspaces WHERE slug = $1)
                   AND invitation.email = $2`, [visualSlug, visualOwnerEmail],
              );
              assert.deepEqual(state.rows[0], { status: "completed", invitation_status: "accepted" });
              if (process.env.PLATFORM_TEST_NATIVE_AUTH === "true") {
                const { AuthClient } = await import("../../../apps/mobile/src/auth/client.ts");
                let savedSession = null;
                const native = new AuthClient({
                  baseUrl: api, tenantSlug: visualSlug,
                  storage: {
                    read: async () => savedSession,
                    write: async (value) => { savedSession = value; },
                    clear: async () => { savedSession = null; },
                  },
                });
                await native.signIn(visualOwnerEmail, password);
                assert.equal(native.getSnapshot().status, "mfa");
                assert.equal(savedSession, null, "Native must not persist a token before MFA");
                await native.verifyMfa(ownerRecovery.recoveryCodes[0]);
                const nativeState = native.getSnapshot();
                assert.equal(nativeState.status, "signedIn");
                assert.equal(nativeState.profile.nextAction, "enter_workspace");
                assert.ok(nativeState.profile.memberships.some((membership) => membership.workspaceSlug === visualSlug
                  && membership.allowedModules.includes("crm")));
                await native.signOut();
                assert.equal(savedSession, null);
              }
            } finally { await ownerContext.close(); }
          }
          await context.close();
        }
      } finally { await browser.close(); }
    }
    await webPost("logout", {}, cookie);
    const revokedPage = await fetch(`${web}/internal`, { headers: { cookie }, redirect: "manual" });
    const revokedHtml = await revokedPage.text();
    assert.ok(revokedPage.status === 307 || revokedHtml.includes("/internal/sign-in"),
      "Logout should redirect the internal page to operator sign-in");
  }

  const accessExplanation = await request(`/internal/operator/tenants/${externalTenantId}/access`, {
    headers: operatorHeader,
  });
  assert.equal(accessExplanation.externalTenantId, externalTenantId);
  assert.equal(accessExplanation.seats.limit, 7);
  assert.ok(Array.isArray(accessExplanation.members));
  assert.ok(!JSON.stringify(accessExplanation).includes("token_hash"));
  await database.query(
    "UPDATE platform_administrators SET role = 'support_observer' WHERE user_id = $1",
    [userId],
  );
  const supportProfile = await request("/auth/platform/session", {
    headers: { authorization: `Bearer ${confirmed.sessionToken}` },
  });
  assert.equal(supportProfile.role, "support_observer");
  assert.deepEqual(supportProfile.permissions, ["tenants.read", "support.request"]);
  await request(`/internal/operator/tenants/${externalTenantId}/access`, { headers: operatorHeader });
  await request(`/internal/operator/tenants/${externalTenantId}/management`, {
    method: "PATCH", headers: operatorHeader, body: {
      expectedWorkspaceVersion: updated.workspace.version,
      expectedSubscriptionVersion: updated.subscription.version,
      seatLimit: 8,
    }, expected: 403,
  });
  await request(`/internal/operator/tenants/${externalTenantId}/operations/support-sessions/example/decision`, {
    body: { decision: "approve", expectedVersion: 1, reason: "Must be denied before route work" },
    headers: operatorHeader, expected: 403,
  });
  await database.query(
    "UPDATE platform_administrators SET role = 'administrator' WHERE user_id = $1",
    [userId],
  );

  await database.query(
    `UPDATE platform_operator_sessions SET expires_at = now() - interval '1 minute'
     WHERE token_hash = encode(digest($1, 'sha256'), 'hex')`,
    [confirmed.sessionToken],
  );
  await request("/auth/platform/session", {
    headers: { authorization: `Bearer ${confirmed.sessionToken}` }, expected: 401,
  });
  await request("/auth/platform/logout", {
    headers: { authorization: `Bearer ${confirmed.sessionToken}` }, expected: 201, method: "POST",
  });
  await request("/auth/platform/session", {
    headers: { authorization: `Bearer ${confirmed.sessionToken}` }, expected: 401,
  });

  const next = await request("/auth/platform/login", { body: { email, password }, expected: 201 });
  assert.equal(next.purpose, "login");
  const verified = await request("/auth/platform/mfa/verify", {
    body: { challengeToken: next.challengeToken, code: confirmed.recoveryCodes[0] }, expected: 201,
  });
  assert.ok(verified.sessionToken);
  await database.query("UPDATE platform_administrators SET status = 'suspended' WHERE user_id = $1", [userId]);
  await request("/auth/platform/session", {
    headers: { authorization: `Bearer ${verified.sessionToken}` }, expected: 401,
  });
  await database.query("UPDATE platform_administrators SET status = 'active' WHERE user_id = $1", [userId]);
  await database.query("UPDATE users SET status = 'suspended' WHERE id = $1", [userId]);
  await request("/auth/platform/session", {
    headers: { authorization: `Bearer ${verified.sessionToken}` }, expected: 401,
  });
  await database.query("UPDATE users SET status = 'active' WHERE id = $1", [userId]);
  await database.query("UPDATE local_auth_credentials SET password_changed_at = now() WHERE user_id = $1", [userId]);
  await request("/auth/platform/session", {
    headers: { authorization: `Bearer ${verified.sessionToken}` }, expected: 401,
  });
  const versionChallenge = await request("/auth/platform/login", { body: { email, password }, expected: 201 });
  const versionSession = await request("/auth/platform/mfa/verify", {
    body: { challengeToken: versionChallenge.challengeToken, code: confirmed.recoveryCodes[2] }, expected: 201,
  });
  await database.query("UPDATE users SET mfa_session_version = mfa_session_version + 1 WHERE id = $1", [userId]);
  await request("/auth/platform/session", {
    headers: { authorization: `Bearer ${versionSession.sessionToken}` }, expected: 401,
  });
  const attempts = await request("/auth/platform/login", { body: { email, password }, expected: 201 });
  for (let index = 0; index < 4; index += 1) {
    await request("/auth/platform/mfa/verify", {
      body: { challengeToken: attempts.challengeToken, code: "invalid-code" }, expected: 401,
    });
  }
  await request("/auth/platform/mfa/verify", {
    body: { challengeToken: attempts.challengeToken, code: "invalid-code" }, expected: 429,
  });
  await request("/auth/platform/mfa/verify", {
    body: { challengeToken: attempts.challengeToken, code: "invalid-code" }, expected: 410,
  });
  const expired = await request("/auth/platform/login", { body: { email, password }, expected: 201 });
  await database.query(
    `UPDATE platform_operator_challenges SET expires_at = now() - interval '1 minute'
     WHERE token_hash = encode(digest($1, 'sha256'), 'hex')`,
    [expired.challengeToken],
  );
  await request("/auth/platform/mfa/verify", {
    body: { challengeToken: expired.challengeToken, code: "invalid-code" }, expected: 410,
  });
  for (let index = 0; index < 5; index += 1) {
    await request("/auth/platform/login", { body: { email, password: "not-the-password" }, expected: 401 });
  }
  await request("/auth/platform/login", { body: { email, password }, expected: 429 });
  console.log(`Platform operator local smoke passed: password lockout, MFA enrollment/expiry/replay/attempts, isolated sessions, operator guard, audited command, entitlement/data-policy/support controls, verified export, two-operator clone and rollback, recovery code, logout, suspension and password change${process.env.PLATFORM_TEST_WEB_URL ? ", web BFF" : ""}${process.env.PLATFORM_TEST_DOMAIN_API === "true" ? ", domain API" : ""}.`);
} finally {
  // audit_events is deliberately append-only. For this local synthetic fixture only,
  // hold an exclusive transaction while the trigger is briefly disabled for cascade cleanup.
  await database.query("BEGIN");
  try {
    await database.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only");
    await database.query("ALTER TABLE tenant_lifecycle_versions DISABLE TRIGGER tenant_lifecycle_append_only");
    await database.query("DELETE FROM tenant_lifecycle_versions WHERE workspace_id = ANY($1::uuid[])", [[workspaceId, targetWorkspaceId]]);
    await database.query("ALTER TABLE tenant_lifecycle_versions ENABLE TRIGGER tenant_lifecycle_append_only");
    const visual = await database.query(
      `SELECT workspace.id, account.id AS account_id FROM workspaces workspace
       LEFT JOIN customer_account_organizations linked ON linked.workspace_id = workspace.id
       LEFT JOIN customer_accounts account ON account.id = linked.account_id
       WHERE workspace.slug = $1`, [visualSlug],
    );
    if (visual.rowCount) {
      await database.query("DELETE FROM workspaces WHERE id = $1 AND slug = $2", [visual.rows[0].id, visualSlug]);
      if (visual.rows[0].account_id) await database.query("DELETE FROM customer_accounts WHERE id = $1", [visual.rows[0].account_id]);
    }
    await database.query("DELETE FROM tenant_provisioning_drafts WHERE slug = $1 AND created_by = $2", [visualSlug, userId]);
    await database.query("DELETE FROM workspaces WHERE id = $1 AND slug = $2", [
      workspaceId, `operator-smoke-${workspaceId.slice(0, 8)}`,
    ]);
    await database.query("DELETE FROM workspaces WHERE id = $1 AND slug = $2", [
      targetWorkspaceId, `operator-target-${targetWorkspaceId.slice(0, 8)}`,
    ]);
    await database.query("ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only");
    await database.query("DELETE FROM platform_capability_flags WHERE code=$1 AND updated_by=$2", [capabilityCode, userId]);
    await database.query("DELETE FROM platform_operator_audit WHERE actor_user_id = ANY($1::uuid[])", [[userId, reviewerUserId]]);
    await database.query("DELETE FROM customer_accounts WHERE id=$1 AND created_by=$2", [accountId, userId]);
    await database.query("DELETE FROM users WHERE primary_email = $1", [visualOwnerEmail]);
    await database.query("DELETE FROM users WHERE id = $1 AND primary_email = $2", [userId, email]);
    await database.query("DELETE FROM users WHERE id = $1 AND primary_email = $2", [reviewerUserId, reviewerEmail]);
    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  } finally {
    await database.end();
    if (exportObjectKey && !process.env.OBJECT_STORAGE_BUCKET) {
      await rm(resolve(process.env.BRAND_ASSET_STORAGE_DIR ?? ".data/workspace-brand-assets", exportObjectKey), { force: true });
    }
  }
}
