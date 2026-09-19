/** Read-only, loopback-only pre-backfill report. Run with `npx tsx` and a workspace UUID. */
import pg from "pg";
import { analyzeJobLineage } from "../src/jobs/job-lineage";
import { loadJobLineageRows } from "../src/jobs/job-lineage.repository";

const workspaceId = process.argv[2];
if (!workspaceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId))
  throw new Error("Pass one valid workspace UUID; this report does not scan all tenants.");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
const endpoint = new URL(connectionString);
if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))
  throw new Error("The Job lineage report is restricted to a local database or clone tunnel.");

async function main() {
const client = new pg.Client({
  connectionString,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  application_name: "wodana-job-lineage-readonly",
});

try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  await client.query("SELECT set_config('app.current_workspace_id', $1, true)", [workspaceId]);
  const rows = await loadJobLineageRows(client, workspaceId);
  const report = analyzeJobLineage(workspaceId, rows);
  process.stdout.write(`${JSON.stringify({
    workspaceId,
    sourceCounts: Object.fromEntries(Object.entries(rows).map(([name, records]) => [name, records.length])),
    candidateJobs: report.candidates.length,
    directOpportunityJobs: report.candidates.filter((candidate) => candidate.root.type === "opportunity").length,
    issueCounts: report.issues.reduce<Record<string, number>>((counts, issue) => {
      const key = `${issue.type}.${issue.code}`;
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
    // No names, email, phone, original payload, private quote text or other PII.
  }, null, 2)}\n`);
  await client.query("ROLLBACK");
} finally {
  await client.end();
}
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
