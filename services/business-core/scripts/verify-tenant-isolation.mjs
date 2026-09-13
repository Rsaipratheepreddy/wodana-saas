import assert from "node:assert/strict";
import pg from "pg";

const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required");
}

const intentionalExceptions = [
  "client_portal_settings",
  "commercial_reconciliation_jobs",
  "project_vendor_access",
  "tenant_login_branding",
  "tenant_provisioning_requests",
];

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});

try {
  await client.connect();
  const result = await client.query(
    `SELECT table_name AS "tableName"
     FROM information_schema.columns column_definition
     JOIN pg_class relation ON relation.relname = column_definition.table_name
     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE column_definition.table_schema = 'public'
       AND column_definition.column_name = 'workspace_id'
       AND namespace.nspname = 'public'
       AND relation.relkind = 'r'
       AND relation.relrowsecurity = false
     ORDER BY table_name`,
  );
  const actual = result.rows.map(({ tableName }) => tableName);
  assert.deepEqual(
    actual,
    intentionalExceptions,
    `Unexpected workspace tables without RLS: ${JSON.stringify(actual)}`,
  );
  process.stdout.write(`${JSON.stringify({
    ok: true,
    rlsExceptions: actual,
    rule: "Any new workspace table without RLS fails this verification.",
  }, null, 2)}\n`);
} finally {
  await client.end();
}
