/**
 * Tenant-scoped Job identity preflight. Default is READ ONLY.
 * --apply is deliberately limited to an isolated, disposable local database.
 * The source record tables are never rewritten.
 */
import pg from "pg";
import { analyzeJobLineage, type JobLineageLink } from "../src/jobs/job-lineage";
import { loadJobLineageRows } from "../src/jobs/job-lineage.repository";
import { ensureJobForSource } from "../src/jobs/job-identity.store";

const workspaceId = process.argv[2];
const apply = process.argv[3] === "--apply";
if (!workspaceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId))
  throw new Error("Pass one valid workspace UUID; this command never scans all tenants.");
if (process.argv.length > (apply ? 4 : 3)) throw new Error("Usage: backfill-job-identity <workspace-uuid> [--apply]");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
const endpoint = new URL(connectionString);
if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))
  throw new Error("Job backfill is restricted to a local database or clone tunnel.");
if (apply && !endpoint.pathname.startsWith("/wodana_job_smoke_"))
  throw new Error("--apply is restricted to a disposable local wodana_job_smoke_* database.");

function sourceKey(link: JobLineageLink): string {
  return `${link.type}:${link.type === "quote" ? `${link.caseId}:` : ""}${link.id}`;
}

async function main() {
  const client = new pg.Client({ connectionString, application_name: "wodana-job-backfill-local" });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
    const rows = await loadJobLineageRows(client, workspaceId);
    const report = analyzeJobLineage(workspaceId, rows);
    const roots = await client.query<{ id: string; root_type: string; root_id: string }>(
      `SELECT id,root_type,root_id::text FROM job_identities WHERE workspace_id=$1`, [workspaceId],
    );
    const links = await client.query<{ source_key: string; job_id: string; status: string }>(
      `SELECT source_key,job_id,status FROM job_identity_links WHERE workspace_id=$1`, [workspaceId],
    );
    const rootJobs = new Map(roots.rows.map((row) => [`${row.root_type}:${row.root_id}`, row.id]));
    const existingLinks = new Map(links.rows.map((row) => [row.source_key, row]));
    const conflicts: string[] = [];
    let proposedLinks = 0;
    for (const candidate of report.candidates) {
      const rootJobId = rootJobs.get(`${candidate.root.type}:${candidate.root.id}`);
      for (const link of candidate.links) {
        const existing = existingLinks.get(sourceKey(link));
        if (!existing) proposedLinks++;
        else if (existing.status !== "active" || !rootJobId || existing.job_id !== rootJobId)
          conflicts.push(`${link.type}:existing_link_requires_review`);
      }
    }
    const summary = {
      workspaceId,
      mode: apply ? "local_apply" : "dry_run",
      sourceCounts: Object.fromEntries(Object.entries(rows).map(([name, records]) => [name, records.length])),
      candidateJobs: report.candidates.length,
      newRoots: report.candidates.filter((candidate) => !rootJobs.has(`${candidate.root.type}:${candidate.root.id}`)).length,
      newLinks: proposedLinks,
      lineageIssues: report.issues.reduce<Record<string, number>>((counts, issue) => {
        const name = `${issue.type}.${issue.code}`;
        counts[name] = (counts[name] ?? 0) + 1;
        return counts;
      }, {}),
      linkConflicts: conflicts.length,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    await client.query("ROLLBACK");
    if (report.issues.length || conflicts.length)
      throw new Error("Job backfill rejected: review lineage issues and existing links before any write.");
    if (!apply) return;

    const candidates = [...report.candidates].sort((a, b) =>
      `${a.root.type}:${a.root.id}`.localeCompare(`${b.root.type}:${b.root.id}`));
    const batchSize = 50;
    for (let start = 0; start < candidates.length; start += batchSize) {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      try {
        await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [workspaceId]);
        for (const candidate of candidates.slice(start, start + batchSize)) {
          const root = await ensureJobForSource(client, workspaceId, candidate.root, null, "backfill");
          for (const link of candidate.links) {
            const linked = await ensureJobForSource(client, workspaceId, link, null, "backfill");
            if (linked.id !== root.id) throw new Error("Source lineage resolved to a different Job; batch rolled back.");
          }
        }
        await client.query("COMMIT");
        process.stdout.write(`Committed candidate roots ${start + 1}–${Math.min(start + batchSize, candidates.length)} of ${candidates.length}.\n`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
