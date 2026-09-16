/** Guarded local-only reset for the Iglo demo customer. */
import pg from "pg";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const expected = {
  confirmation: "DELETE_LOCAL_IGLO",
  email: "admin@igloarchitects.com",
  externalTenantId: "demo-iglo-architects",
  slug: "iglo-architects",
};
const confirmation = option("--confirm");
const workspaceId = option("--workspace-id");
if (confirmation !== expected.confirmation || !/^[a-f0-9-]{36}$/i.test(workspaceId ?? "")) {
  throw new Error("Supply --confirm DELETE_LOCAL_IGLO and the exact --workspace-id.");
}

const quote = (value) => `"${value.replaceAll('"', '""')}"`;
const database = new pg.Client({ database: "wodana", host: "/tmp" });
await database.connect();

try {
  const environment = (await database.query(
    `SELECT current_database() AS database, inet_server_addr() AS address,
            role.rolsuper, role.rolbypassrls
     FROM pg_roles role WHERE role.rolname = current_user`,
  )).rows[0];
  if (environment.database !== "wodana" || environment.address !== null
    || (!environment.rolsuper && !environment.rolbypassrls)) {
    throw new Error("Reset is restricted to the local wodana database and its migration owner.");
  }

  const workspace = (await database.query(
    `SELECT workspace.id, workspace.slug, workspace.name,
            provisioning.external_tenant_id AS "externalTenantId"
     FROM workspaces workspace
     LEFT JOIN tenant_provisioning_requests provisioning ON provisioning.workspace_id = workspace.id
     WHERE workspace.id = $1 AND workspace.slug = $2`,
    [workspaceId, expected.slug],
  )).rows[0];
  if (!workspace || workspace.externalTenantId !== expected.externalTenantId) {
    throw new Error("Workspace identity does not match the local Iglo demo. No changes made.");
  }

  const owner = (await database.query(
    `SELECT user_record.id
     FROM users user_record
     JOIN workspace_memberships membership ON membership.user_id = user_record.id
     WHERE user_record.primary_email = $1 AND membership.workspace_id = $2`,
    [expected.email, workspaceId],
  )).rows[0];
  if (!owner) throw new Error("The expected Iglo owner was not found. No changes made.");
  const outsideMemberships = Number((await database.query(
    "SELECT count(*) AS count FROM workspace_memberships WHERE user_id = $1 AND workspace_id <> $2",
    [owner.id, workspaceId],
  )).rows[0].count);
  if (outsideMemberships !== 0) throw new Error("The Iglo owner belongs to another workspace. No changes made.");

  const account = (await database.query(
    `SELECT account.id FROM customer_accounts account
     JOIN customer_account_organizations linked ON linked.account_id = account.id
     WHERE linked.workspace_id = $1`,
    [workspaceId],
  )).rows[0];
  if (!account) throw new Error("The Iglo customer account was not found. No changes made.");

  await database.query("BEGIN");
  await database.query("SET LOCAL statement_timeout = '60s'");
  // Local reset only: bypass append-only and FK triggers inside this guarded transaction.
  // A UUID reference scan below prevents the transaction from committing orphans.
  await database.query("SET LOCAL session_replication_role = 'replica'");

  const scopedTables = (await database.query(
    `SELECT namespace.nspname AS schema, relation.relname AS table
     FROM pg_attribute column_record
     JOIN pg_class relation ON relation.oid = column_record.attrelid AND relation.relkind IN ('r', 'p')
     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public' AND column_record.attname = 'workspace_id'
       AND relation.relname <> 'workspaces' AND NOT column_record.attisdropped
     ORDER BY relation.relname`,
  )).rows;
  const deleted = [];
  for (const table of scopedTables) {
    const result = await database.query(
      `DELETE FROM ${quote(table.schema)}.${quote(table.table)} WHERE workspace_id = $1`,
      [workspaceId],
    );
    deleted.push({ table: table.table, rows: result.rowCount ?? 0 });
  }

  const directReferences = async (parentTable, id) => {
    const references = (await database.query(
      `SELECT child_namespace.nspname AS schema, child.relname AS table,
              child_column.attname AS column
       FROM pg_constraint constraint_record
       JOIN pg_class parent ON parent.oid = constraint_record.confrelid
       JOIN pg_namespace parent_namespace ON parent_namespace.oid = parent.relnamespace
       JOIN pg_class child ON child.oid = constraint_record.conrelid
       JOIN pg_namespace child_namespace ON child_namespace.oid = child.relnamespace
       JOIN pg_attribute child_column
         ON child_column.attrelid = child.oid
        AND child_column.attnum = constraint_record.conkey[1]
       WHERE constraint_record.contype = 'f'
         AND array_length(constraint_record.conkey, 1) = 1
         AND parent_namespace.nspname = 'public' AND parent.relname = $1`,
      [parentTable],
    )).rows;
    for (const reference of references) {
      if (reference.table === parentTable) continue;
      const result = await database.query(
        `DELETE FROM ${quote(reference.schema)}.${quote(reference.table)} WHERE ${quote(reference.column)} = $1`,
        [id],
      );
      deleted.push({ table: reference.table, rows: result.rowCount ?? 0 });
    }
  };

  await directReferences("customer_accounts", account.id);
  await directReferences("workspaces", workspaceId);
  await directReferences("users", owner.id);
  const deleteByColumn = async (columnName, id, excludedTable) => {
    const tables = (await database.query(
      `SELECT namespace.nspname AS schema, relation.relname AS table
       FROM pg_attribute column_record
       JOIN pg_class relation ON relation.oid = column_record.attrelid AND relation.relkind IN ('r', 'p')
       JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public' AND column_record.attname = $1
         AND relation.relname <> $2 AND NOT column_record.attisdropped
       ORDER BY relation.relname`,
      [columnName, excludedTable],
    )).rows;
    for (const table of tables) {
      const result = await database.query(
        `DELETE FROM ${quote(table.schema)}.${quote(table.table)} WHERE ${quote(columnName)} = $1`,
        [id],
      );
      deleted.push({ table: table.table, rows: result.rowCount ?? 0 });
    }
  };
  await deleteByColumn("account_id", account.id, "customer_accounts");
  await deleteByColumn("user_id", owner.id, "users");
  await database.query("DELETE FROM customer_accounts WHERE id = $1", [account.id]);
  await database.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
  await database.query("DELETE FROM users WHERE id = $1", [owner.id]);

  const uuidColumns = (await database.query(
    `SELECT namespace.nspname AS schema, relation.relname AS table, column_record.attname AS column
     FROM pg_attribute column_record
     JOIN pg_class relation ON relation.oid = column_record.attrelid AND relation.relkind IN ('r', 'p')
     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     JOIN pg_type type_record ON type_record.oid = column_record.atttypid
     WHERE namespace.nspname = 'public' AND type_record.typname = 'uuid'
       AND NOT column_record.attisdropped
     ORDER BY relation.relname, column_record.attname`,
  )).rows;
  const remainingReferences = [];
  for (const column of uuidColumns) {
    const result = await database.query(
      `SELECT count(*)::int AS count FROM ${quote(column.schema)}.${quote(column.table)}
       WHERE ${quote(column.column)} = ANY($1::uuid[])`,
      [[workspaceId, account.id, owner.id]],
    );
    if (result.rows[0].count > 0) remainingReferences.push({ ...column, rows: result.rows[0].count });
  }
  if (remainingReferences.length) {
    throw new Error(`Reset would leave UUID references: ${JSON.stringify(remainingReferences)}`);
  }
  await database.query("COMMIT");

  const remaining = await database.query(
    `SELECT
      (SELECT count(*)::int FROM workspaces WHERE id = $1) AS workspaces,
      (SELECT count(*)::int FROM users WHERE id = $2) AS users,
      (SELECT count(*)::int FROM customer_accounts WHERE id = $3) AS accounts,
      (SELECT count(*)::int FROM tenant_provisioning_requests WHERE external_tenant_id = $4) AS provisioning`,
    [workspaceId, owner.id, account.id, expected.externalTenantId],
  );
  console.log(JSON.stringify({ reset: expected.slug, removedTables: deleted.filter((item) => item.rows > 0), remaining: remaining.rows[0] }, null, 2));
} catch (error) {
  await database.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await database.end();
}
