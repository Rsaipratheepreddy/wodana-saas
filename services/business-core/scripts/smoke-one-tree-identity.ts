/** Synthetic-only P03.1 smoke. Run after smoke-job-identity --seed-only and Job backfill. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { JobsService } from "../src/jobs/jobs.service";
import { syncOneTreeFromCase } from "../src/jobs/one-tree.store";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
const endpoint = new URL(connectionString);
if (!(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) && endpoint.pathname.startsWith('/wodana_job_smoke_')))
  throw new Error("One Tree smoke requires a disposable local wodana_job_smoke_* database.");

async function main() {
  const client = new pg.Client({ connectionString, application_name: "wodana-one-tree-smoke" });
  try {
    await client.connect();
    await client.query("BEGIN");
    const seed = await client.query<{ workspaceId: string; caseId: string; userId: string; jobId: string }>(
      `SELECT case_record.workspace_id::text AS "workspaceId",case_record.id::text AS "caseId",
              case_record.created_by::text AS "userId",link.job_id::text AS "jobId"
         FROM pre_project_cases case_record JOIN job_identity_links link
           ON link.workspace_id=case_record.workspace_id AND link.record_type='case'
          AND link.record_id=case_record.id::text AND link.status='active' LIMIT 1`,
    );
    assert(seed.rows[0], "seeded case needs an active Job link");
    const { workspaceId, caseId, userId, jobId } = seed.rows[0];
    const roomId = randomUUID();
    const itemId = randomUUID();
    const evidenceId = randomUUID();
    await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
    await client.query(
      `INSERT INTO pre_project_briefs(case_id,workspace_id,content,updated_by)
       VALUES($1,$2,$3,$4)`,
      [caseId, workspaceId, { location: "Synthetic villa", propertyType: "Residential" }, userId],
    );
    await client.query(
      `INSERT INTO pre_project_rooms(id,workspace_id,case_id,name) VALUES($1,$2,$3,'Kitchen')`,
      [roomId, workspaceId, caseId],
    );
    await client.query(
      `INSERT INTO pre_project_brief_entries(id,workspace_id,case_id,room_id,kind,title,scope_status,review_status,created_by,updated_by)
       VALUES($1,$2,$3,$4,'requirement','Base cabinets','included','reviewed',$5,$5)`,
      [itemId, workspaceId, caseId, roomId, userId],
    );
    await client.query(
      `INSERT INTO pre_project_site_records(id,workspace_id,case_id,kind,title,status,version,content,created_by,updated_by)
       VALUES($1,$2,$3,'observation','Access check','open',1,$4,$5,$5)`,
      [evidenceId, workspaceId, caseId, { id: evidenceId, kind: 'observation', title: 'Access check', status: 'open', version: 1, assetIds: [] }, userId],
    );
    const first = await syncOneTreeFromCase(client, workspaceId, caseId, userId);
    assert.equal(first.synced, true);
    assert.equal(first.rooms, 1);
    assert.equal(first.items, 1);
    const nodes = await client.query<{ id: string; kind: string; parentId: string | null; status: string }>(
      `SELECT id::text,kind,parent_id::text AS "parentId",status FROM one_tree_nodes
        WHERE workspace_id=$1 AND job_id=$2 ORDER BY kind,id`, [workspaceId, jobId],
    );
    assert.equal(nodes.rowCount, 3);
    assert(nodes.rows.some((row) => row.kind === 'room' && row.id === roomId && row.parentId === first.siteId));
    assert(nodes.rows.some((row) => row.kind === 'item' && row.id === itemId && row.parentId === roomId));
    assert(!nodes.rows.some((row) => row.kind === 'zone'), "empty zones must not be invented");
    const evidence = await client.query<{ siteId: string }>(
      `SELECT site_id::text AS "siteId" FROM pre_project_site_records WHERE workspace_id=$1 AND id=$2`,
      [workspaceId, evidenceId],
    );
    assert.equal(evidence.rows[0].siteId, first.siteId);

    await client.query(`UPDATE pre_project_rooms SET name='Kitchen and pantry',version=2 WHERE workspace_id=$1 AND id=$2`, [workspaceId, roomId]);
    await syncOneTreeFromCase(client, workspaceId, caseId, userId);
    const roomHistory = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM one_tree_node_revisions WHERE workspace_id=$1 AND node_id=$2`,
      [workspaceId, roomId],
    );
    assert.equal(roomHistory.rows[0].count, 2, "rename keeps the ID and appends a revision");
    await client.query(`UPDATE pre_project_brief_entries SET scope_status='excluded',version=2 WHERE workspace_id=$1 AND id=$2`, [workspaceId, itemId]);
    await syncOneTreeFromCase(client, workspaceId, caseId, userId);
    const item = await client.query<{ status: string; id: string }>(
      `SELECT status,id::text FROM one_tree_nodes WHERE workspace_id=$1 AND id=$2`, [workspaceId, itemId],
    );
    assert.deepEqual(item.rows[0], { status: 'archived', id: itemId });

    const access = { withPermission: async (_actor: unknown, _workspace: string, permission: string, work: Function) => {
      assert.equal(permission, 'pre_projects.view'); return work(client, { userId });
    } };
    const projection = await new JobsService(access as never).tree({} as never, workspaceId, jobId);
    assert.equal(projection.schemaVersion, 1);
    assert.deepEqual(projection.counts, { site: 1, room: 1, zone: 0, item: 0 });
    assert(projection.nodes.some((node) => node.id === itemId && node.status === 'archived'));

    await client.query(`UPDATE pre_project_brief_entries SET room_id=NULL,version=3 WHERE workspace_id=$1 AND id=$2`,[workspaceId,itemId]);
    await client.query(`DELETE FROM pre_project_rooms WHERE workspace_id=$1 AND id=$2`,[workspaceId,roomId]);
    await syncOneTreeFromCase(client,workspaceId,caseId,userId);
    const removedRoom=await client.query<{status:string;id:string}>(`SELECT status,id::text FROM one_tree_nodes WHERE workspace_id=$1 AND id=$2`,[workspaceId,roomId]);
    assert.deepEqual(removedRoom.rows[0],{status:'archived',id:roomId},'a removed source room must remain as archived lineage');
    const afterRemoval=await new JobsService(access as never).tree({} as never,workspaceId,jobId);
    assert.deepEqual(afterRemoval.counts,{site:1,room:0,zone:0,item:0});

    const otherWorkspace = await client.query<{ id: string }>(`SELECT id::text FROM workspaces WHERE id<>$1 LIMIT 1`, [workspaceId]);
    assert(otherWorkspace.rows[0]);
    await client.query("SET LOCAL ROLE wodana_app");
    await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [otherWorkspace.rows[0].id]);
    const hidden = await client.query(`SELECT 1 FROM one_tree_nodes WHERE id=$1`, [roomId]);
    assert.equal(hidden.rowCount, 0, "RLS must hide another tenant's tree");
    await client.query("ROLLBACK");
    process.stdout.write("One Tree smoke passed: stable IDs, revisions, source deletion archival, evidence link, API projection and RLS.\n");
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
