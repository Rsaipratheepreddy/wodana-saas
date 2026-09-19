/**
 * P09.2: restore the disposable Palm fixture into a second local database,
 * compare business lineage and access, exercise the idempotent One Tree
 * mapping there, then prove rollback by restoring the original backup.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import pg from "pg";
import { analyzeJobLineage } from "../src/jobs/job-lineage";
import { loadJobLineageRows } from "../src/jobs/job-lineage.repository";

const run = promisify(execFile);
const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL is required.");
const sourceEndpoint = new URL(sourceUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(sourceEndpoint.hostname)) {
  throw new Error("Palm clone acceptance is restricted to a loopback database.");
}
const sourceDatabase = sourceEndpoint.pathname.slice(1);
if (!/^wodana_funnel_test_[0-9]+_[0-9]+$/.test(sourceDatabase)) {
  throw new Error("Palm clone acceptance requires the disposable Palm funnel database.");
}

const suffix = `${process.pid}_${randomBytes(4).toString("hex")}`;
const cloneDatabase = `wodana_job_smoke_palm_clone_${suffix}`;
if (!/^wodana_job_smoke_palm_clone_[0-9]+_[0-9a-f]{8}$/.test(cloneDatabase)) {
  throw new Error("Refusing to use an unexpected clone database name.");
}
const cloneEndpoint = new URL(sourceUrl);
cloneEndpoint.pathname = `/${cloneDatabase}`;
const cloneUrl = cloneEndpoint.toString();
let tempRoot = "";
let backupPath = "";
const pgEnvironment = {
  ...process.env,
  PGHOST: sourceEndpoint.hostname.replace(/^\[|\]$/g, ""),
  PGPORT: sourceEndpoint.port || "5432",
  ...(sourceEndpoint.username ? { PGUSER: decodeURIComponent(sourceEndpoint.username) } : {}),
  ...(sourceEndpoint.password ? { PGPASSWORD: decodeURIComponent(sourceEndpoint.password) } : {}),
};

const recordTables = [
  "crm_parties",
  "crm_enquiries",
  "crm_leads",
  "crm_opportunities",
  "pre_project_cases",
  "commercial_cases",
  "delivery_projects",
  "project_execution",
  "workspace_catalog_records",
  "job_identities",
  "job_identity_links",
  "one_tree_nodes",
] as const;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stable(child)]),
  );
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

async function palmWorkspaceId(connectionString: string) {
  const client = new pg.Client({ connectionString, application_name: "wodana-palm-clone-discovery" });
  try {
    await client.connect();
    const result = await client.query<{ id: string }>(
      `SELECT id::text FROM workspaces WHERE slug LIKE 'palm-synthetic-%' ORDER BY created_at`,
    );
    assert.equal(result.rowCount, 1, "The disposable database must contain exactly one Palm synthetic workspace.");
    return result.rows[0].id;
  } finally {
    await client.end();
  }
}

async function snapshot(connectionString: string, workspaceId: string) {
  const client = new pg.Client({ connectionString, application_name: "wodana-palm-clone-readonly" });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
    const workspace = await client.query(
      `SELECT status,default_currency AS "defaultCurrency",default_locale AS "defaultLocale",
        default_timezone AS "defaultTimezone",unit_system AS "unitSystem",week_starts_on AS "weekStartsOn"
       FROM workspaces WHERE id=$1`,
      [workspaceId],
    );
    const brand = await client.query(
      `SELECT primary_color AS "primaryColor",secondary_color AS "secondaryColor",
        heading_font AS "headingFont",body_font AS "bodyFont",
        CASE WHEN logo_asset_id IS NULL AND logo_url IS NULL THEN 'missing' ELSE 'configured' END AS logo
       FROM tenant_login_branding WHERE workspace_id=$1`,
      [workspaceId],
    );
    const counts: Record<string, number> = {};
    for (const table of recordTables) {
      const count = await client.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM ${table} WHERE workspace_id=$1`,
        [workspaceId],
      );
      counts[table] = count.rows[0].total;
    }
    const lineageRows = await loadJobLineageRows(client, workspaceId);
    const lineage = analyzeJobLineage(workspaceId, lineageRows);
    const permissionCoverage = await client.query(
      `SELECT permission.code,count(DISTINCT membership.id)::int AS members
       FROM workspace_memberships membership
       JOIN effective_member_roles effective ON effective.workspace_id=membership.workspace_id
         AND effective.membership_id=membership.id
       JOIN role_permissions grant_permission ON grant_permission.workspace_id=membership.workspace_id
         AND grant_permission.role_id=effective.role_id
       JOIN permissions permission ON permission.id=grant_permission.permission_id
       WHERE membership.workspace_id=$1 AND membership.status='active'
       GROUP BY permission.code ORDER BY permission.code`,
      [workspaceId],
    );
    const access = await client.query(
      `SELECT
        (SELECT count(*)::int FROM workspace_memberships WHERE workspace_id=$1 AND status='active') AS members,
        (SELECT count(*)::int FROM member_roles WHERE workspace_id=$1) AS "directRoleGrants",
        (SELECT count(*)::int FROM workspace_teams WHERE workspace_id=$1 AND status='active') AS teams,
        (SELECT count(*)::int FROM workspace_team_members WHERE workspace_id=$1) AS "teamMembers",
        (SELECT count(*)::int FROM workspace_team_roles WHERE workspace_id=$1) AS "teamRoleGrants",
        (SELECT count(*)::int FROM workspace_invitations WHERE workspace_id=$1 AND status='pending' AND expires_at>now()) AS "pendingInvitations",
        (SELECT count(*)::int FROM crm_effective_queue_members WHERE workspace_id=$1) AS "effectiveQueueMembers"`,
      [workspaceId],
    );
    const connections = await client.query(
      `SELECT provider,status,count(*)::int AS total FROM integration_connections
       WHERE workspace_id=$1 AND status<>'revoked' GROUP BY provider,status ORDER BY provider,status`,
      [workspaceId],
    );
    const domains = await client.query(
      `SELECT dns_status AS "dnsStatus",certificate_status AS "certificateStatus",
        routing_status AS "routingStatus",count(*)::int AS total
       FROM workspace_domains WHERE workspace_id=$1 AND removed_at IS NULL
       GROUP BY dns_status,certificate_status,routing_status
       ORDER BY dns_status,certificate_status,routing_status`,
      [workspaceId],
    );
    const workflows = await client.query(
      `SELECT code,status,is_default AS "isDefault",version,
        encode(digest(stages::text,'sha256'),'hex') AS "stagesHash"
       FROM project_workflow_templates WHERE workspace_id=$1 ORDER BY code`,
      [workspaceId],
    );
    const issueCounts = lineage.issues.reduce<Record<string, number>>((result, issue) => {
      const key = `${issue.type}.${issue.code}`;
      result[key] = (result[key] ?? 0) + 1;
      return result;
    }, {});
    const result = {
      workspace: workspace.rows[0],
      brand: brand.rows[0] ?? { logo: "missing" },
      recordCounts: counts,
      lineage: {
        candidateJobs: lineage.candidates.length,
        sourceCounts: Object.fromEntries(
          Object.entries(lineageRows).map(([name, records]) => [name, records.length]),
        ),
        issueCounts,
      },
      access: access.rows[0],
      permissionCoverage: permissionCoverage.rows,
      connections: connections.rows,
      domains: domains.rows,
      workflows: workflows.rows,
    };
    await client.query("ROLLBACK");
    return result;
  } finally {
    await client.end();
  }
}

async function restoreClone() {
  await run("dropdb", ["--force", "--if-exists", cloneDatabase], { env: pgEnvironment });
  await run("createdb", [cloneDatabase], { env: pgEnvironment });
  await run("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl", `--dbname=${cloneUrl}`, backupPath], {
    env: pgEnvironment,
    maxBuffer: 20 * 1024 * 1024,
  });
}

async function mutateClone(workspaceId: string) {
  const client = new pg.Client({ connectionString: cloneUrl, application_name: "wodana-palm-clone-rollback-proof" });
  try {
    await client.connect();
    await client.query("UPDATE workspaces SET status='suspended',version=version+1 WHERE id=$1", [workspaceId]);
  } finally {
    await client.end();
  }
}

async function main() {
  tempRoot = await mkdtemp(join(tmpdir(), "wodana-palm-clone-"));
  backupPath = join(tempRoot, "palm-clone.backup");
  try {
  for (const command of ["pg_dump", "pg_restore", "createdb", "dropdb"]) {
    await run(command, ["--version"], { env: pgEnvironment });
  }
  const sourceWorkspaceId = await palmWorkspaceId(sourceUrl);
  const sourceBefore = await snapshot(sourceUrl, sourceWorkspaceId);
  assert.deepEqual(sourceBefore.lineage.issueCounts, {}, "Source lineage issues must be resolved before clone migration.");
  assert.equal(sourceBefore.connections.length, 0, "Synthetic Palm migration must not carry active provider connections.");
  assert.equal(sourceBefore.domains.length, 0, "Synthetic Palm migration must not carry a live custom domain.");
  assert.equal(sourceBefore.access.pendingInvitations, 0, "Pending invitations require an explicit release decision.");

  await run("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-acl",
    "--serializable-deferrable",
    `--file=${backupPath}`,
    sourceUrl,
  ], { env: pgEnvironment, maxBuffer: 20 * 1024 * 1024 });
  const backupSha256 = createHash("sha256").update(await readFile(backupPath)).digest("hex");
  await restoreClone();

  const cloneWorkspaceId = await palmWorkspaceId(cloneUrl);
  assert.equal(cloneWorkspaceId, sourceWorkspaceId);
  const cloneDryRun = await snapshot(cloneUrl, cloneWorkspaceId);
  assert.equal(digest(cloneDryRun), digest(sourceBefore), "Restored clone must match the source snapshot exactly.");

  const tsx = resolve(process.cwd(), "../../node_modules/.bin/tsx");
  const backfill = resolve(process.cwd(), "scripts/backfill-one-tree.ts");
  await run(tsx, [backfill, cloneWorkspaceId, "--apply"], {
    env: { ...process.env, DATABASE_URL: cloneUrl },
    maxBuffer: 20 * 1024 * 1024,
  });
  const cloneAfterMapping = await snapshot(cloneUrl, cloneWorkspaceId);
  assert.deepEqual(cloneAfterMapping.lineage.issueCounts, {});
  assert.equal(
    cloneAfterMapping.recordCounts.job_identity_links,
    sourceBefore.recordCounts.job_identity_links,
    "Idempotent mapping must not duplicate source links.",
  );
  assert.deepEqual(
    cloneAfterMapping.permissionCoverage,
    sourceBefore.permissionCoverage,
    "Migration must not silently broaden or reduce effective permissions.",
  );

  await mutateClone(cloneWorkspaceId);
  const changed = await snapshot(cloneUrl, cloneWorkspaceId);
  assert.notEqual(digest(changed), digest(sourceBefore), "Rollback proof mutation must be observable.");
  await restoreClone();
  const rolledBack = await snapshot(cloneUrl, cloneWorkspaceId);
  assert.equal(digest(rolledBack), digest(sourceBefore), "Backup restore must recover the exact pre-cutover snapshot.");
  const sourceAfter = await snapshot(sourceUrl, sourceWorkspaceId);
  assert.equal(digest(sourceAfter), digest(sourceBefore), "The source tenant must remain unchanged.");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    fixture: "palm_synthetic_clone",
    workspaceId: sourceWorkspaceId,
    backup: { sha256: backupSha256, verified: true },
    dryRun: {
      snapshotHash: digest(sourceBefore),
      recordCounts: sourceBefore.recordCounts,
      candidateJobs: sourceBefore.lineage.candidateJobs,
      orphanAndLinkIssues: sourceBefore.lineage.issueCounts,
      effectivePermissionRows: sourceBefore.permissionCoverage.length,
      permissionDiffs: 0,
      activeProviderConnections: sourceBefore.connections.length,
      activeCustomDomains: sourceBefore.domains.length,
    },
    apply: { oneTreeReplaySafe: true, sourceUnchanged: true },
    rollback: { restoredSnapshotHash: digest(rolledBack), exact: true },
  }, null, 2)}\n`);
  } finally {
    await run("dropdb", ["--force", "--if-exists", cloneDatabase], { env: pgEnvironment }).catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
