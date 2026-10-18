import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Reads only the catalog, so it can
// also be pointed at a restored production dump. Every table with a workspace_id column is a tenant table.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

// Read before a tenant is known (sign-in, MFA, vendor links, login branding), by a leased cross-tenant job, or by
// guarded operator routes before a workspace exists. Same list as scripts/verify-tenant-isolation.mjs.
const WITHOUT_RLS = [
  "auth_mfa_challenges",
  "commercial_reconciliation_jobs",
  "customer_account_organizations",
  "mfa_security_events",
  "project_vendor_access",
  "tenant_login_branding",
  "tenant_provisioning_drafts",
  "tenant_provisioning_requests",
];

// RLS is on but not forced: SECURITY DEFINER claim functions (owned by the table owner) read them across workspaces
// for the outbox and CRM timers. The app role is never the owner, so RLS still applies to every API request.
const RLS_NOT_FORCED = [
  "automation_waits",
  "crm_sequence_enrollments",
  "crm_sequences",
  "crm_sla_instances",
  "outbox_events",
];

// Forced RLS with their own per-command policies instead of the single tenant_isolation policy.
const OWN_POLICIES = ["tenant_lifecycle_versions"];

const APP_ROLE = "wodana_app";

interface TenantTable {
  name: string;
  owner: string;
  rls: boolean;
  forced: boolean;
  tenantIsolation: boolean;
  policies: number;
}

integration("tenant isolation on every workspace table (forced RLS + tenant_isolation)", () => {
  let pool: Pool;
  let tables: TenantTable[];

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const result = await pool.query<TenantTable>(
      `SELECT relation.relname AS name, pg_get_userbyid(relation.relowner) AS owner,
              relation.relrowsecurity AS rls, relation.relforcerowsecurity AS forced,
              EXISTS (SELECT 1 FROM pg_policy policy WHERE policy.polrelid = relation.oid
                      AND policy.polname = 'tenant_isolation') AS "tenantIsolation",
              (SELECT count(*)::int FROM pg_policy policy WHERE policy.polrelid = relation.oid) AS policies
       FROM pg_class relation
       JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p')
         AND EXISTS (SELECT 1 FROM pg_attribute attribute WHERE attribute.attrelid = relation.oid
                     AND attribute.attname = 'workspace_id' AND NOT attribute.attisdropped)
       ORDER BY relation.relname`,
    );
    tables = result.rows;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("finds the tenant tables", () => {
    expect(tables.length).toBeGreaterThan(100);
  });

  it("enables RLS on every tenant table except the documented pre-tenant ones", () => {
    expect(tables.filter((table) => !table.rls).map((table) => table.name)).toEqual(WITHOUT_RLS);
  });

  it("forces RLS on every tenant table except the documented cross-tenant claim tables", () => {
    expect(tables.filter((table) => table.rls && !table.forced).map((table) => table.name)).toEqual(RLS_NOT_FORCED);
  });

  it("gives every RLS table a tenant_isolation policy (or its own documented policies)", () => {
    expect(tables.filter((table) => table.rls && table.policies === 0).map((table) => table.name)).toEqual([]);
    expect(tables.filter((table) => table.rls && !table.tenantIsolation).map((table) => table.name)).toEqual(OWN_POLICIES);
  });

  it("runs the app as a role that cannot bypass RLS and owns no tenant table", async () => {
    const role = await pool.query<{ superuser: boolean; bypass: boolean }>(
      "SELECT rolsuper AS superuser, rolbypassrls AS bypass FROM pg_roles WHERE rolname = $1",
      [APP_ROLE],
    );
    expect(role.rows).toEqual([{ superuser: false, bypass: false }]);
    expect(tables.filter((table) => table.owner === APP_ROLE).map((table) => table.name)).toEqual([]);
  });
});
