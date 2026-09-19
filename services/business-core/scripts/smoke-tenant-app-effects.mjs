import assert from "node:assert/strict";
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";

const scrypt = promisify(scryptCallback);
const databaseUrl = process.env.APP_EFFECTS_TEST_DATABASE_URL;
const api = process.env.BUSINESS_CORE_URL ?? "http://127.0.0.1:8022/api/v1";
assert.ok(databaseUrl, "APP_EFFECTS_TEST_DATABASE_URL is required");
assert.ok(["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname), "Use a local test database only");
assert.ok(["localhost", "127.0.0.1", "::1"].includes(new URL(api).hostname), "Use a local API only");

const userId = randomUUID();
const accountId = randomUUID();
const otherAccountId = randomUUID();
const [firstId, secondId, outsiderId] = [randomUUID(), randomUUID(), randomUUID()];
const ids = [firstId, secondId, outsiderId];
const firstLegalEntityId = randomUUID();
const firstBusinessUnitId = randomUUID();
const firstTeamIds = [randomUUID(), randomUUID()];
const suffix = userId.slice(0, 8);
const slugs = [`app-effect-${suffix}-one`, `app-effect-${suffix}-two`, `app-effect-${suffix}-foreign`];
const email = `app-effect-${suffix}@wodana.invalid`;
const password = `${randomBytes(20).toString("base64url")}aA1!`;
const salt = randomBytes(16).toString("hex");
const hash = (await scrypt(password, salt, 64)).toString("hex");
const database = new pg.Client({ connectionString: databaseUrl });
await database.connect();

async function request(path, { token, body, expected = 200, method } = {}) {
  const response = await fetch(`${api}${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  assert.equal(response.status, expected, `${path}: expected ${expected}, received ${response.status}: ${payload?.message ?? "unknown"}`);
  return payload;
}

try {
  await database.query("BEGIN");
  await database.query(`INSERT INTO users (id, primary_email, display_name) VALUES ($1, $2, 'App Effect Tester')`, [userId, email]);
  await database.query(`INSERT INTO local_auth_credentials (user_id, password_hash, password_salt) VALUES ($1, $2, $3)`, [userId, hash, salt]);
  await database.query(`INSERT INTO customer_accounts (id, display_name, organization_limit, created_by) VALUES ($1, 'Synthetic Studio Group', 2, $3), ($2, 'Synthetic Foreign Account', 1, $3)`, [accountId, otherAccountId, userId]);
  for (let index = 0; index < ids.length; index += 1) {
    const workspaceId = ids[index];
    await database.query(`INSERT INTO workspaces (id, name, slug, default_currency, created_by) VALUES ($1, $2, $3, 'AED', $4)`, [workspaceId, `Synthetic Organization ${index + 1}`, slugs[index], userId]);
    await database.query(`INSERT INTO tenant_login_branding (workspace_id, login_slug, display_name, primary_color)
      VALUES ($1, $2, $3, $4)`, [workspaceId, slugs[index], `Synthetic Organization ${index + 1}`, index === 0 ? "#3955CC" : "#8A5A13"]);
    await database.query(`INSERT INTO workspace_onboarding (workspace_id, status, current_step, completed_steps)
      VALUES ($1, 'completed', 'complete', '["workspace_profile","organization","team","integrations"]'::jsonb)`, [workspaceId]);
    await database.query(`INSERT INTO customer_account_organizations (account_id, workspace_id, is_default) VALUES ($1, $2, $3)`, [index === 2 ? otherAccountId : accountId, workspaceId, index !== 1]);
  }
  for (let index = 0; index < 2; index += 1) {
    const workspaceId = ids[index];
    const member = await database.query(`INSERT INTO workspace_memberships (workspace_id, user_id, joined_at) VALUES ($1, $2, now()) RETURNING id`, [workspaceId, userId]);
    if (index === 0) {
      await database.query(`INSERT INTO legal_entities (id,workspace_id,code,display_name,registered_name,country_code,base_currency,locale,timezone)
        VALUES ($1,$2,'SYNTHETIC','Synthetic Organization','Synthetic Organization LLC','AE','AED','en-AE','Asia/Dubai')`, [firstLegalEntityId, workspaceId]);
      await database.query(`INSERT INTO business_units (id,workspace_id,legal_entity_id,code,name,timezone)
        VALUES ($1,$2,$3,'MAIN','Main studio','Asia/Dubai')`, [firstBusinessUnitId, workspaceId, firstLegalEntityId]);
      const crmRole = await database.query(`INSERT INTO roles (workspace_id, code, name) VALUES ($1, 'smoke-crm', 'Smoke CRM') RETURNING id`, [workspaceId]);
      const projectRole = await database.query(`INSERT INTO roles (workspace_id, code, name) VALUES ($1, 'smoke-projects', 'Smoke Projects') RETURNING id`, [workspaceId]);
      await database.query(`INSERT INTO role_permissions (workspace_id, role_id, permission_id)
        SELECT $1, $2, id FROM permissions WHERE code = ANY($3::text[])`, [workspaceId, crmRole.rows[0].id, ["module.organization.read", "crm.leads.view"]]);
      await database.query(`INSERT INTO role_permissions (workspace_id, role_id, permission_id)
        SELECT $1, $2, id FROM permissions WHERE code = ANY($3::text[])`, [workspaceId, projectRole.rows[0].id, ["projects.view", "projects.manage"]]);
      await database.query(`INSERT INTO workspace_teams (id,workspace_id,business_unit_id,code,name)
        VALUES ($1,$3,$4,'SALES','Sales'),($2,$3,$4,'DELIVERY','Delivery')`, [firstTeamIds[0], firstTeamIds[1], workspaceId, firstBusinessUnitId]);
      await database.query(`INSERT INTO workspace_team_members (workspace_id,team_id,membership_id)
        VALUES ($1,$2,$4),($1,$3,$4)`, [workspaceId, firstTeamIds[0], firstTeamIds[1], member.rows[0].id]);
      await database.query(`INSERT INTO workspace_team_roles (workspace_id,team_id,role_id)
        VALUES ($1,$2,$4),($1,$3,$5)`, [workspaceId, firstTeamIds[0], firstTeamIds[1], crmRole.rows[0].id, projectRole.rows[0].id]);
    } else {
      const role = await database.query(`INSERT INTO roles (workspace_id, code, name) VALUES ($1, 'smoke-member', 'Smoke Member') RETURNING id`, [workspaceId]);
      await database.query(`INSERT INTO member_roles (workspace_id, membership_id, role_id) VALUES ($1, $2, $3)`, [workspaceId, member.rows[0].id, role.rows[0].id]);
      await database.query(`INSERT INTO role_permissions (workspace_id, role_id, permission_id)
        SELECT $1, $2, id FROM permissions WHERE code = ANY($3::text[])`, [workspaceId, role.rows[0].id, ["module.organization.read", "hrms.self"]]);
    }
  }
  const firstAccountEntitlement = await database.query(`INSERT INTO account_entitlement_versions
    (account_id,version,plan_code,plan_version,status,sold_modules,limits,reason,created_by)
    VALUES($1,1,'starter',1,'active','["workspace","crm"]'::jsonb,
      '{"seatLimit":5,"projectLimit":25}'::jsonb,'Synthetic CRM-only sold entitlement',$2)
    RETURNING id`, [accountId, userId]);
  await database.query(`INSERT INTO organization_entitlement_allocations
    (workspace_id,account_entitlement_id,version,status,modules,limits,reason,created_by)
    VALUES($1,$2,1,'active','["workspace","crm"]'::jsonb,'{}'::jsonb,
      'Synthetic CRM-only organization allocation',$3)`, [firstId, firstAccountEntitlement.rows[0].id, userId]);
  const billingContract = await database.query(`INSERT INTO account_contract_versions
    (account_id,version,status,plan_code,plan_version,currency,billing_cycle,recurring_amount,
     seat_limit,project_limit,signed_at,term_starts_at,renews_at,reason,created_by)
    VALUES($1,1,'contracted','starter',1,'AED','monthly',1000,5,25,now(),now(),now()+interval '30 days',
      'Synthetic tenant billing access acceptance',$2) RETURNING id`, [accountId, userId]);
  await database.query(`INSERT INTO organization_billing_allocation_versions
    (workspace_id,account_contract_version_id,version,status,allocated_amount,seat_limit,project_limit,reason,created_by)
    VALUES($1,$2,1,'active',1000,5,25,'Synthetic tenant billing allocation acceptance',$3)`,
  [firstId, billingContract.rows[0].id, userId]);
  await database.query(`INSERT INTO account_collection_state_versions
    (account_id,version,status,overdue_amount,currency,next_review_at,reason,created_by)
    VALUES($1,1,'past_due',1000,'AED',now()+interval '1 day',
      'Synthetic past due access-policy acceptance',$2)`, [accountId, userId]);
  await database.query(`INSERT INTO account_billing_documents
    (account_id,document_type,provider,external_reference,document_number,status,currency,total_amount,
     balance_amount,issued_at,due_at,metadata)
    VALUES($1,'invoice','synthetic-provider',$2,$3,'past_due','AED',1000,1000,
      now()-interval '15 days',now()-interval '1 day','{"providerSecret":"must-not-leak"}'::jsonb)`,
  [accountId, `tenant-billing-${suffix}`, `INV-${suffix}`]);
  await database.query("COMMIT");

  const first = await request("/auth/login", { body: { email, password, tenantSlug: slugs[0] }, expected: 201 });
  assert.ok(first.accessToken, "Synthetic member should receive a local tenant session");
  const profile = await request("/me", { token: first.accessToken });
  assert.deepEqual(profile.memberships.map((item) => item.workspaceId).sort(), [firstId, secondId].sort());
  assert.equal(profile.memberships.find((item) => item.workspaceId === firstId).accountId, accountId);
  assert.equal(profile.memberships.find((item) => item.workspaceId === secondId).accountId, accountId);
  assert.deepEqual(profile.memberships.find((item) => item.workspaceId === firstId).roles.sort(), ["smoke-crm", "smoke-projects"]);
  assert.deepEqual(profile.memberships.find((item) => item.workspaceId === firstId).allowedModules, ["workspace", "crm"]);
  const billingAccess = profile.memberships.find((item) => item.workspaceId === firstId).billingAccess;
  assert.equal(billingAccess.state, "past_due");
  assert.equal(billingAccess.effect, "unchanged");
  assert.deepEqual(billingAccess.affectedModules, []);
  assert.deepEqual(profile.memberships.find((item) => item.workspaceId === secondId).allowedModules, ["workspace", "hrms"]);
  assert.equal(profile.memberships.find((item) => item.workspaceId === firstId).workspacePrimaryColor, "#3955CC");
  assert.equal(profile.memberships.some((item) => item.workspaceId === outsiderId), false);
  await request(`/workspaces/${firstId}`, { token: first.accessToken });
  const billing = await request(`/workspaces/${firstId}/billing`, { token: first.accessToken });
  assert.equal(billing.contract.planCode, "starter");
  assert.equal(billing.organizationAllocation.seatLimit, 5);
  assert.equal(billing.collection.status, "past_due");
  assert.equal(billing.accessPolicy.effect, "unchanged");
  assert.deepEqual(billing.accessPolicy.affectedModules, []);
  assert.equal(billing.authority, "account_contract");
  assert.equal(billing.taxCompliance, "unverified");
  assert.equal(billing.documents[0].documentNumber, `INV-${suffix}`);
  assert.equal("externalReference" in billing.documents[0], false);
  assert.equal("metadata" in billing.documents[0], false);
  assert.equal("reason" in billing.collection, false);
  await request(`/workspaces/${firstId}/projects/workflow-templates`, { token: first.accessToken, expected: 403 });
  await request(`/workspaces/${secondId}`, { token: first.accessToken });
  await request(`/workspaces/${outsiderId}`, { token: first.accessToken, expected: 404 });

  const upgradedAccountEntitlement = await database.query(`INSERT INTO account_entitlement_versions
    (account_id,version,plan_code,plan_version,status,sold_modules,limits,reason,created_by)
    VALUES($1,2,'starter',1,'active','["workspace","crm","projects"]'::jsonb,
      '{"seatLimit":5,"projectLimit":25}'::jsonb,'Synthetic project entitlement restoration',$2)
    RETURNING id`, [accountId, userId]);
  await database.query(`INSERT INTO organization_entitlement_allocations
    (workspace_id,account_entitlement_id,version,status,modules,limits,reason,created_by)
    VALUES($1,$2,2,'active','["workspace","crm","projects"]'::jsonb,'{}'::jsonb,
      'Synthetic project organization restoration',$3)`, [firstId, upgradedAccountEntitlement.rows[0].id, userId]);
  const upgradedProfile = await request("/me", { token: first.accessToken });
  assert.deepEqual(upgradedProfile.memberships.find((item) => item.workspaceId === firstId).allowedModules,
    ["workspace", "crm", "projects"]);
  const workflows = await request(`/workspaces/${firstId}/projects/workflow-templates`, { token: first.accessToken });
  const templateId = randomUUID();
  const workflowInput = {
    version: 0,
    code: `entitlement_smoke_${suffix}`,
    name: "Entitlement smoke workflow",
    description: "Disposable workflow proving that module commands use the same entitlement boundary.",
    isDefault: false,
    stages: workflows.defaultTemplate.stages,
  };
  const createdWorkflow = await request(`/workspaces/${firstId}/projects/workflow-templates/${templateId}`, {
    token: first.accessToken,
    body: workflowInput,
    method: "PUT",
  });
  assert.equal(createdWorkflow.id, templateId);

  await database.query(`INSERT INTO organization_entitlement_allocations
    (workspace_id,account_entitlement_id,version,status,modules,limits,reason,created_by)
    VALUES($1,$2,3,'suspended','["workspace","crm","projects"]'::jsonb,'{}'::jsonb,
      'Synthetic module suspension',$3)`, [firstId, upgradedAccountEntitlement.rows[0].id, userId]);
  const moduleSuspended = await request("/me", { token: first.accessToken });
  assert.deepEqual(moduleSuspended.memberships.find((item) => item.workspaceId === firstId).allowedModules, ["workspace"]);
  await request(`/workspaces/${firstId}/projects/workflow-templates/${templateId}`, {
    token: first.accessToken,
    body: { ...workflowInput, version: 1, name: "Suspended command must not apply" },
    method: "PUT",
    expected: 403,
  });

  await database.query(`INSERT INTO organization_entitlement_allocations
    (workspace_id,account_entitlement_id,version,status,modules,limits,reason,created_by)
    VALUES($1,$2,4,'active','["workspace","crm","projects"]'::jsonb,'{}'::jsonb,
      'Synthetic module restoration after suspension',$3)`, [firstId, upgradedAccountEntitlement.rows[0].id, userId]);
  const restoredProfile = await request("/me", { token: first.accessToken });
  assert.deepEqual(restoredProfile.memberships.find((item) => item.workspaceId === firstId).allowedModules,
    ["workspace", "crm", "projects"]);
  const restoredWorkflow = await request(`/workspaces/${firstId}/projects/workflow-templates/${templateId}`, {
    token: first.accessToken,
    body: { ...workflowInput, version: 1, name: "Restored entitlement workflow" },
    method: "PUT",
  });
  assert.equal(restoredWorkflow.version, 2);

  await database.query(`UPDATE workspaces SET status = 'suspended' WHERE id = $1`, [secondId]);
  const suspended = await request("/me", { token: first.accessToken });
  assert.deepEqual(suspended.memberships.map((item) => item.workspaceId), [firstId]);
  assert.deepEqual(suspended.unavailableOrganizations.map((item) => item.workspaceId), [secondId]);
  assert.equal(suspended.unavailableOrganizations[0].workspaceStatus, "suspended");
  await request(`/workspaces/${secondId}`, { token: first.accessToken, expected: 404 });
  await request("/auth/login", { body: { email, password, tenantSlug: slugs[1] }, expected: 401 });

  await database.query(`UPDATE workspace_memberships SET status='suspended',version=version+1 WHERE workspace_id=$1 AND user_id=$2`, [firstId, userId]);
  const revoked = await request("/me", { token: first.accessToken });
  assert.equal(revoked.memberships.some((item) => item.workspaceId === firstId), false);
  await request(`/workspaces/${firstId}`, { token: first.accessToken, expected: 404 });
  await request("/auth/login", { body: { email, password, tenantSlug: slugs[0] }, expected: 401 });
  console.log("Tenant app-effect smoke passed: multi-team inheritance, sold-module downgrade, suspended command denial, restoration, brand effects, account isolation, organization suspension, and member revocation denial.");
} finally {
  await database.query("BEGIN");
  try {
    // The append-only trigger is relaxed only inside this local, exact-ID cleanup transaction.
    await database.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only");
    await database.query(`DELETE FROM workspaces WHERE id = ANY($1::uuid[]) AND slug = ANY($2::text[])`, [ids, slugs]);
    await database.query("ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only");
    await database.query(`DELETE FROM customer_accounts WHERE id = ANY($1::uuid[]) AND created_by = $2`, [[accountId, otherAccountId], userId]);
    await database.query(`DELETE FROM users WHERE id = $1 AND primary_email = $2`, [userId, email]);
    await database.query("COMMIT");
    const remaining = await database.query(`SELECT
      (SELECT count(*)::int FROM workspaces WHERE id = ANY($1::uuid[])) AS workspaces,
      (SELECT count(*)::int FROM customer_accounts WHERE id = ANY($2::uuid[])) AS accounts,
      (SELECT count(*)::int FROM users WHERE id = $3) AS users,
      (SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'audit_events'::regclass AND tgname = 'audit_events_append_only') AS audit_trigger`,
      [ids, [accountId, otherAccountId], userId]);
    assert.deepEqual(remaining.rows[0], { workspaces: 0, accounts: 0, users: 0, audit_trigger: "O" });
  } catch (error) {
    await database.query("ROLLBACK");
    throw error;
  } finally {
    await database.end();
  }
}
