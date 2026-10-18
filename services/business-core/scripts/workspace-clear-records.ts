// Go-live reset for one workspace: clears its business records and keeps its configuration, by calling
// the same SECURITY DEFINER function as POST /internal/tenants/:id/clear-records.
//
//   Dry run (default, deletes nothing):
//     DATABASE_URL=postgresql://… node --experimental-strip-types scripts/workspace-clear-records.ts --workspace palm-living
//   Apply (one transaction; audited; storage objects are queued for the business-core cleanup worker):
//     … scripts/workspace-clear-records.ts --workspace palm-living --apply --confirm palm-living --operator ops@example.com
//
// Options: --workspace <slug or workspace id> (required), --apply, --confirm <slug> (required with --apply and
// must equal the workspace slug), --operator <email> (required with --apply; the platform user recorded in the
// audit event), --json (machine-readable output), --allow-remote (required for a non-loopback database).
import pg from "pg";

type Row = { tableName: string; disposition: string; rowCount: string; runId: string | null };

function usage(message: string): never {
  process.stderr.write(`${message}\nUsage: workspace-clear-records.ts --workspace <slug|id> [--apply --confirm <slug> --operator <email>] [--json] [--allow-remote]\n`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((value) => value.startsWith("--")));
function option(name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) usage(`${name} needs a value`);
  return value;
}

const known = new Set(["--workspace", "--apply", "--dry-run", "--confirm", "--operator", "--json", "--allow-remote"]);
for (const flag of flags) if (!known.has(flag)) usage(`Unknown option ${flag}`);
const workspace = option("--workspace") ?? usage("--workspace is required");
const apply = flags.has("--apply");
if (apply && flags.has("--dry-run")) usage("Choose either --apply or --dry-run");
const confirm = option("--confirm");
const operatorEmail = option("--operator");
if (apply && !confirm) usage("--apply needs --confirm <workspace slug>");
if (apply && !operatorEmail) usage("--apply needs --operator <email> for the audit record");

const databaseUrl = process.env.DATABASE_URL ?? process.env.MIGRATION_DATABASE_URL;
if (!databaseUrl) usage("DATABASE_URL is required");
const host = new URL(databaseUrl).hostname;
if (!["127.0.0.1", "localhost", "::1", "[::1]", ""].includes(host) && !flags.has("--allow-remote")) {
  usage(`Refusing to connect to ${host} without --allow-remote`);
}

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});
await client.connect();
let exitCode = 0;
try {
  await client.query("BEGIN");
  // The CLI runs as the database owner (like migrations), so it can find the workspace before choosing it.
  const found = await client.query<{ id: string; slug: string; name: string }>(
    `SELECT id::text, slug, name FROM workspaces WHERE slug = $1 OR id::text = $1`, [workspace],
  );
  const target = found.rows[0];
  if (!target) throw new Error(`Workspace ${workspace} was not found`);
  if (apply && confirm !== target.slug) throw new Error(`--confirm must be exactly "${target.slug}"`);

  let operatorId: string | null = null;
  if (apply) {
    const operator = await client.query<{ id: string }>(
      `SELECT id::text FROM users WHERE lower(primary_email) = lower($1)`, [operatorEmail],
    );
    operatorId = operator.rows[0]?.id ?? null;
    if (!operatorId) throw new Error(`No user with email ${operatorEmail}; the operator must be a platform user`);
    await client.query("SELECT set_config('app.current_actor_id', $1, true)", [operatorId]);
  }
  await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [target.id]);
  const result = await client.query<Row>(
    `SELECT table_name AS "tableName", disposition, row_count::text AS "rowCount", run_id::text AS "runId"
       FROM workspace_clear_records($1::uuid, $2::text, $3::boolean)`,
    [target.id, apply ? confirm : target.slug, !apply],
  );
  if (apply) await client.query("COMMIT");
  else await client.query("ROLLBACK");

  const rows = result.rows.filter((row) => Number(row.rowCount) > 0 && row.tableName !== "object storage keys");
  const summary = {
    workspace: { id: target.id, slug: target.slug, name: target.name },
    mode: apply ? "applied" : "dry-run",
    runId: result.rows[0]?.runId ?? null,
    rows: rows.reduce((total, row) => total + Number(row.rowCount), 0),
    objectKeys: Number(result.rows.find((row) => row.tableName === "object storage keys")?.rowCount ?? 0),
    tables: rows.map((row) => ({ table: row.tableName, disposition: row.disposition, rows: Number(row.rowCount) })),
  };
  if (flags.has("--json")) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    const width = Math.max(...summary.tables.map((row) => row.table.length), 10);
    for (const row of summary.tables) {
      process.stdout.write(`${row.table.padEnd(width)}  ${row.disposition.padEnd(12)}  ${row.rows}\n`);
    }
    process.stdout.write(`\n${summary.mode === "applied" ? "Cleared" : "Would clear"} ${summary.rows} rows in ${summary.workspace.slug}` +
      ` (${summary.workspace.id}); ${summary.objectKeys} storage objects ${apply ? "queued for deletion" : "would be queued"}.\n`);
    if (apply) process.stdout.write(`Run ${summary.runId}. The business-core worker deletes the queued objects within a few minutes.\n`);
    else process.stdout.write("Nothing was changed. Re-run with --apply --confirm <slug> --operator <email> to clear.\n");
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  exitCode = 1;
} finally {
  await client.end();
}
process.exit(exitCode);
