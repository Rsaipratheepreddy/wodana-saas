/**
 * Tenant-scoped P03.1 tree preflight. Default is READ ONLY.
 * --apply is deliberately limited to an isolated local wodana_job_smoke_* DB.
 */
import pg from "pg";
import { syncOneTreeFromCase } from "../src/jobs/one-tree.store";

const workspaceId = process.argv[2];
const apply = process.argv[3] === "--apply";
if (!workspaceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId))
  throw new Error("Pass one valid workspace UUID; this command never scans all tenants.");
if (process.argv.length > (apply ? 4 : 3)) throw new Error("Usage: backfill-one-tree <workspace-uuid> [--apply]");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
const endpoint = new URL(connectionString);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname))
  throw new Error("One Tree backfill is restricted to a local database or clone tunnel.");
if (apply && !endpoint.pathname.startsWith('/wodana_job_smoke_'))
  throw new Error("--apply is restricted to a disposable local wodana_job_smoke_* database.");

async function report(client: pg.Client) {
  const result = await client.query<{
    caseId: string; actorUserId: string; hasJob: boolean; roomCount: number;
    includedItemCount: number; nodeCount: number; unmappedSiteRecordCount: number;
  }>(
    `SELECT case_record.id::text AS "caseId",case_record.created_by::text AS "actorUserId",
            EXISTS(SELECT 1 FROM job_identity_links link WHERE link.workspace_id=case_record.workspace_id
              AND link.record_type='case' AND link.record_id=case_record.id::text AND link.status='active') AS "hasJob",
            (SELECT count(*)::int FROM pre_project_rooms room WHERE room.workspace_id=case_record.workspace_id AND room.case_id=case_record.id) AS "roomCount",
            (SELECT count(*)::int FROM pre_project_brief_entries item WHERE item.workspace_id=case_record.workspace_id
              AND item.case_id=case_record.id AND item.kind='requirement' AND item.scope_status='included' AND item.archived_at IS NULL) AS "includedItemCount",
            (SELECT count(*)::int FROM one_tree_nodes node WHERE node.workspace_id=case_record.workspace_id AND node.case_id=case_record.id) AS "nodeCount",
            (SELECT count(*)::int FROM pre_project_site_records evidence WHERE evidence.workspace_id=case_record.workspace_id
              AND evidence.case_id=case_record.id AND evidence.site_id IS NULL) AS "unmappedSiteRecordCount"
       FROM pre_project_cases case_record WHERE case_record.workspace_id=$1 ORDER BY case_record.id`,
    [workspaceId],
  );
  return result.rows;
}

async function main() {
  const client = new pg.Client({ connectionString, application_name: "wodana-one-tree-backfill-local" });
  try {
    await client.connect();
    await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
    await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
    const before = await report(client);
    if (apply) {
      for (const row of before) await syncOneTreeFromCase(client, workspaceId, row.caseId, row.actorUserId);
    }
    const after = apply ? await report(client) : before;
    const summary = {
      workspaceId,
      mode: apply ? "apply" : "dry-run",
      cases: before.length,
      casesMissingJob: before.filter((row) => !row.hasJob).length,
      rooms: before.reduce((sum, row) => sum + row.roomCount, 0),
      includedItems: before.reduce((sum, row) => sum + row.includedItemCount, 0),
      nodesBefore: before.reduce((sum, row) => sum + row.nodeCount, 0),
      nodesAfter: after.reduce((sum, row) => sum + row.nodeCount, 0),
      unmappedSiteRecordsBefore: before.reduce((sum, row) => sum + row.unmappedSiteRecordCount, 0),
      unmappedSiteRecordsAfter: after.reduce((sum, row) => sum + row.unmappedSiteRecordCount, 0),
    };
    if (apply && summary.casesMissingJob) throw new Error("One or more cases have no active Job link. Run and review the Job identity preflight first.");
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
