import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { TenantDomainsService } from "../src/workspaces/tenant-domains.service.ts";
import { LocalAuthService } from "../src/auth/local-auth.service.ts";

const databaseUrl = process.env.DOMAIN_TEST_DATABASE_URL;
assert.ok(databaseUrl && ["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname),
  "A loopback database is required");
const operatorId = randomUUID();
const firstId = randomUUID();
const secondId = randomUUID();
const suffix = firstId.slice(0, 8);
const firstExternalId = `domain-smoke-first-${suffix}`;
const secondExternalId = `domain-smoke-second-${suffix}`;
const firstSlug = `domain-first-${suffix}`;
const secondSlug = `domain-second-${suffix}`;
const hostname = `portal-${suffix}.example.test`;
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
const database = {
  query: (sql, params) => client.query(sql, params),
  tenantTransaction: async (workspaceId, actorId, work) => {
    await client.query("BEGIN");
    try {
      await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [workspaceId]);
      await client.query("SELECT set_config('app.current_actor_id', $1, true)", [actorId]);
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  },
};
const domains = new TenantDomainsService(database);
let txtAnswers = [];
domains.lookupTxt = async () => txtAnswers;

try {
  await client.query("INSERT INTO users (id, primary_email, display_name) VALUES ($1, $2, 'Domain Operator')",
    [operatorId, `domain-operator-${suffix}@wodana.invalid`]);
  for (const [workspaceId, slug, externalId] of [
    [firstId, firstSlug, firstExternalId], [secondId, secondSlug, secondExternalId],
  ]) {
    await client.query(
      "INSERT INTO workspaces (id, name, slug, default_currency, created_by) VALUES ($1, 'Synthetic domain tenant', $2, 'AED', $3)",
      [workspaceId, slug, operatorId],
    );
    await client.query(
      `INSERT INTO tenant_provisioning_requests
         (external_tenant_id, idempotency_key, request_hash, workspace_id, response_body, expires_at)
       VALUES ($1, $2, $3, $4, '{}'::jsonb, now() + interval '1 hour')`,
      [externalId, randomUUID(), "a".repeat(64), workspaceId],
    );
  }
  let requested;
  await client.query("SET ROLE wodana_app");
  try {
    assert.deepEqual(await domains.list(firstExternalId, operatorId), { platformHostname: `${firstSlug}.wodana.ai`, domains: [] });
    requested = await domains.request(firstExternalId, hostname.toUpperCase(), `domain-key-${suffix}`, operatorId);
  } finally { await client.query("RESET ROLE"); }
  assert.equal(requested.hostname, hostname);
  assert.equal(requested.dns.status, "pending");
  assert.equal(requested.certificate.status, "not_requested");
  assert.equal(requested.routing.status, "not_requested");
  const replayed = await domains.request(firstExternalId, hostname, `domain-key-${suffix}`, operatorId);
  assert.equal(replayed.id, requested.id);
  assert.equal(replayed.replayed, true);
  await assert.rejects(domains.request(firstExternalId, `other-${hostname}`, `domain-key-${suffix}`, operatorId), /another hostname/);
  await assert.rejects(domains.request(secondExternalId, hostname, `other-key-${suffix}`, operatorId), /already reserved/);
  assert.equal((await domains.list(secondExternalId, operatorId)).domains.length, 0);
  await assert.rejects(domains.verify(secondExternalId, requested.id, requested.version, operatorId), /not found/);
  await client.query("UPDATE workspace_domains SET challenge_expires_at = now() - interval '1 minute' WHERE id = $1", [requested.id]);
  await assert.rejects(domains.verify(firstExternalId, requested.id, requested.version, operatorId), /expired/);
  const rotated = await domains.rotateChallenge(firstExternalId, requested.id, requested.version, operatorId);
  assert.notEqual(rotated.dns.record.value, requested.dns.record.value);
  await assert.rejects(domains.verify(firstExternalId, requested.id, requested.version, operatorId), /changed/);
  domains.lookupTxt = async () => { throw Object.assign(new Error("resolver outage"), { code: "SERVFAIL" }); };
  await assert.rejects(domains.verify(firstExternalId, requested.id, rotated.version, operatorId), /temporarily unavailable/);
  domains.lookupTxt = async () => txtAnswers;
  txtAnswers = [[requested.dns.record.value]];
  await assert.rejects(domains.verify(firstExternalId, requested.id, rotated.version, operatorId), /DNS ownership record/);
  txtAnswers = [[rotated.dns.record.value.slice(0, 12), rotated.dns.record.value.slice(12)]];
  const verified = await domains.verify(firstExternalId, requested.id, rotated.version, operatorId);
  assert.equal(verified.dns.status, "verified");
  assert.equal(verified.certificate.status, "manual_setup_required");
  assert.equal(verified.routing.status, "not_requested");
  await assert.rejects(domains.remove(firstExternalId, requested.id, requested.version, operatorId), /changed/);
  const removed = await domains.remove(firstExternalId, requested.id, verified.version, operatorId);
  assert.ok(removed.removedAt);
  assert.equal((await domains.list(firstExternalId, operatorId)).domains.length, 0);
  const second = await domains.request(secondExternalId, hostname, `transfer-key-${suffix}`, operatorId);
  assert.notEqual(second.dns.record.value, requested.dns.record.value);
  await assert.rejects(domains.verify(secondExternalId, second.id, second.version, operatorId), /DNS ownership record/);
  txtAnswers = [[second.dns.record.value]];
  const transferred = await domains.verify(secondExternalId, second.id, second.version, operatorId);
  assert.equal(transferred.dns.status, "verified");
  const publicAuth = new LocalAuthService(database, {}, {}, {}, {});
  await assert.rejects(publicAuth.getTenantBrandingForHost(hostname), /not found/);
  await client.query(
    "INSERT INTO tenant_login_branding (workspace_id, login_slug, display_name) VALUES ($1, $2, 'Synthetic domain tenant')",
    [secondId, secondSlug],
  );
  // Synthetic local evidence only: no certificate or ingress provider was contacted.
  await client.query(
    `UPDATE workspace_domains SET certificate_status = 'issued', certificate_expires_at = now() + interval '10 days',
       routing_status = 'active', routing_activated_at = now() WHERE id = $1`, [second.id],
  );
  // Match the non-BYPASSRLS runtime role. Direct domain reads must remain
  // hidden while the narrowly scoped public sign-in resolver can work.
  await client.query("SET ROLE wodana_app");
  try {
    assert.equal((await client.query("SELECT id FROM workspace_domains WHERE hostname = $1", [hostname])).rowCount, 0);
    assert.equal((await publicAuth.getTenantBrandingForHost(hostname)).loginSlug, secondSlug);
  } finally { await client.query("RESET ROLE"); }
  await client.query("UPDATE workspace_domains SET rollback_status = 'pending' WHERE id = $1", [second.id]);
  await client.query("SET ROLE wodana_app");
  try { await assert.rejects(publicAuth.getTenantBrandingForHost(hostname), /not found/); }
  finally { await client.query("RESET ROLE"); }
  await client.query("UPDATE workspace_domains SET rollback_status = 'none' WHERE id = $1", [second.id]);
  assert.equal((await domains.list(secondExternalId, operatorId)).domains[0].isUsable, true);
  await assert.rejects(domains.remove(secondExternalId, second.id, transferred.version, operatorId), /rolled back/);
  await client.query("UPDATE workspace_domains SET certificate_expires_at = now() - interval '1 minute' WHERE id = $1", [second.id]);
  await client.query("SET ROLE wodana_app");
  try { await assert.rejects(publicAuth.getTenantBrandingForHost(hostname), /not found/); }
  finally { await client.query("RESET ROLE"); }
  const unhealthy = (await domains.list(secondExternalId, operatorId)).domains[0];
  assert.equal(unhealthy.isUsable, false);
  assert.ok(unhealthy.issues.includes("Certificate expired"));
  await client.query("UPDATE workspace_domains SET certificate_expires_at = now() + interval '10 days' WHERE id = $1", [second.id]);
  domains.lookupTxt = async () => { throw Object.assign(new Error("resolver outage"), { code: "SERVFAIL" }); };
  await assert.rejects(domains.recheckOwnership(secondExternalId, second.id, transferred.version, operatorId), /temporarily unavailable/);
  assert.equal((await domains.list(secondExternalId, operatorId)).domains[0].version, transferred.version);
  domains.lookupTxt = async () => txtAnswers;
  const rechecked = await domains.recheckOwnership(secondExternalId, second.id, transferred.version, operatorId);
  assert.equal(rechecked.dns.status, "verified");
  assert.equal(rechecked.isUsable, true);
  txtAnswers = [];
  const lost = await domains.recheckOwnership(secondExternalId, second.id, rechecked.version, operatorId);
  assert.equal(lost.dns.status, "failed");
  assert.equal(lost.routing.status, "failed");
  assert.equal(lost.rollback.status, "pending");
  assert.equal(lost.certificate.status, "issued");
  assert.equal(lost.isUsable, false);
  assert.ok(lost.issues.includes("DNS ownership record is missing"));
  await client.query("SET ROLE wodana_app");
  try { await assert.rejects(publicAuth.getTenantBrandingForHost(hostname), /not found/); }
  finally { await client.query("RESET ROLE"); }
  await assert.rejects(domains.remove(secondExternalId, second.id, lost.version, operatorId), /rolled back/);
  await assert.rejects(domains.rotateChallenge(secondExternalId, second.id, lost.version, operatorId), /rollback/);
  const audit = await client.query("SELECT action FROM platform_operator_audit WHERE actor_user_id = $1", [operatorId]);
  for (const action of ["tenant.domain_requested", "tenant.domain_challenge_rotated", "tenant.domain_dns_verified", "tenant.domain_dns_rechecked", "tenant.domain_removed"]) {
    assert.ok(audit.rows.some((row) => row.action === action), `${action} must be attributed to the operator`);
  }
  console.log("Domain lifecycle local smoke passed: reservation/replay, tenant denial, expired/rotated TXT proof, resolver outage, manual TLS hold, removal/transfer, runtime-role host lookup, certificate expiry and fail-closed DNS-ownership loss with pending rollback.");
} finally {
  await client.query("BEGIN");
  try {
    await client.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only");
    await client.query("DELETE FROM workspaces WHERE id IN ($1, $2) AND slug IN ($3, $4)",
      [firstId, secondId, firstSlug, secondSlug]);
    await client.query("ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only");
    await client.query("DELETE FROM platform_operator_audit WHERE actor_user_id = $1", [operatorId]);
    await client.query("DELETE FROM users WHERE id = $1 AND primary_email = $2",
      [operatorId, `domain-operator-${suffix}@wodana.invalid`]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { await client.end(); }
}
