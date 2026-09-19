import { ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { canonicalHash } from "../crm/shared/crm-types";
import { treeCandidates, type TreeCandidate, type TreeItemSource, type TreeRoomSource } from "./one-tree";

type NodeInput = TreeCandidate | {
  id: string;
  kind: "site";
  parentId: null;
  sourceType: "case";
  sourceVersion: number;
  status: "active";
  label: string;
  snapshot: Record<string, unknown>;
  sourceHash: string;
};

export type OneTreeSyncResult = {
  synced: boolean;
  reason: "ok" | "missing_job";
  jobId: string | null;
  siteId: string | null;
  rooms: number;
  items: number;
};

async function jobForCase(client: PoolClient, workspaceId: string, caseId: string): Promise<string | null> {
  const result = await client.query<{ jobId: string }>(
    `SELECT job_id::text AS "jobId" FROM job_identity_links
      WHERE workspace_id=$1 AND record_type='case' AND record_id=$2 AND status='active'`,
    [workspaceId, caseId],
  );
  return result.rows[0]?.jobId ?? null;
}

async function reviseNode(
  client: PoolClient,
  workspaceId: string,
  nodeId: string,
  input: NodeInput,
  actorUserId: string | null,
) {
  await client.query(
    `INSERT INTO one_tree_node_revisions
      (workspace_id,node_id,revision,source_version,source_hash,label,snapshot,created_by)
     SELECT $1,$2,COALESCE(max(revision),0)+1,$3,$4,$5,$6,$7
       FROM one_tree_node_revisions WHERE workspace_id=$1 AND node_id=$2
     ON CONFLICT(workspace_id,node_id,source_hash) DO NOTHING`,
    [workspaceId, nodeId, input.sourceVersion, input.sourceHash, input.label, input.snapshot, actorUserId],
  );
}

async function syncNode(
  client: PoolClient,
  workspaceId: string,
  jobId: string,
  caseId: string,
  input: NodeInput,
  actorUserId: string | null,
) {
  const sourceId = input.kind === "site" ? caseId : input.id;
  const current = await client.query<{
    id: string; jobId: string; kind: string; parentId: string | null; status: string;
  }>(
    `SELECT id::text,job_id::text AS "jobId",kind,parent_id::text AS "parentId",status
       FROM one_tree_nodes
      WHERE workspace_id=$1 AND case_id=$2 AND source_type=$3 AND source_id=$4
      FOR UPDATE`,
    [workspaceId, caseId, input.sourceType, sourceId],
  );
  const row = current.rows[0];
  if (row && (row.id !== input.id || row.jobId !== jobId || row.kind !== input.kind))
    throw new ConflictException("This discovery record is linked to a different Job tree. Review the lineage before changing it.");
  if (!row) {
    await client.query(
      `INSERT INTO one_tree_nodes
        (id,workspace_id,job_id,case_id,parent_id,kind,source_type,source_id,status,created_by,archived_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::varchar,$10,CASE WHEN $9::text='archived' THEN now() ELSE NULL END)`,
      [input.id, workspaceId, jobId, caseId, input.parentId, input.kind, input.sourceType, sourceId, input.status, actorUserId],
    );
  } else if (row.parentId !== input.parentId || row.status !== input.status) {
    await client.query(
      `UPDATE one_tree_nodes SET parent_id=$4,status=$5::varchar,version=version+1,
         archived_at=CASE WHEN $5::text='archived' THEN COALESCE(archived_at,now()) ELSE NULL END
       WHERE workspace_id=$1 AND case_id=$2 AND id=$3`,
      [workspaceId, caseId, input.id, input.parentId, input.status],
    );
  }
  await reviseNode(client, workspaceId, input.id, input, actorUserId);
}

/**
 * Synchronizes stable navigation identities from authoritative discovery rows.
 * It never changes brief, room, specification, survey, design, catalogue or quote facts.
 */
export async function syncOneTreeFromCase(
  client: PoolClient,
  workspaceId: string,
  caseId: string,
  actorUserId: string | null,
): Promise<OneTreeSyncResult> {
  const jobId = await jobForCase(client, workspaceId, caseId);
  if (!jobId) return { synced: false, reason: "missing_job", jobId: null, siteId: null, rooms: 0, items: 0 };

  const source = await client.query<{
    caseVersion: number; briefVersion: number; location: string; propertyType: string;
  }>(
    `SELECT case_record.version AS "caseVersion",COALESCE(brief.version,0) AS "briefVersion",
            COALESCE(brief.content->>'location','') AS location,
            COALESCE(brief.content->>'propertyType','') AS "propertyType"
       FROM pre_project_cases case_record
       LEFT JOIN pre_project_briefs brief ON brief.workspace_id=case_record.workspace_id AND brief.case_id=case_record.id
      WHERE case_record.workspace_id=$1 AND case_record.id=$2`,
    [workspaceId, caseId],
  );
  if (!source.rows[0]) throw new ConflictException("The Job tree source case no longer exists.");
  const existingSite = await client.query<{ id: string }>(
    `SELECT id::text FROM one_tree_nodes
      WHERE workspace_id=$1 AND case_id=$2 AND kind='site' AND source_type='case' AND source_id=$2`,
    [workspaceId, caseId],
  );
  const siteId = existingSite.rows[0]?.id ?? randomUUID();
  const siteSnapshot = {
    location: source.rows[0].location,
    propertyType: source.rows[0].propertyType,
  };
  await syncNode(client, workspaceId, jobId, caseId, {
    id: siteId,
    kind: "site",
    parentId: null,
    sourceType: "case",
    sourceVersion: Math.max(source.rows[0].caseVersion, source.rows[0].briefVersion),
    status: "active",
    label: source.rows[0].location.trim() || source.rows[0].propertyType.trim() || "Project site",
    snapshot: siteSnapshot,
    sourceHash: canonicalHash(siteSnapshot),
  }, actorUserId);

  const rooms = await client.query<TreeRoomSource>(
    `SELECT id::text,version,name,catalog_record_id::text AS "catalogRecordId",catalog_snapshot AS "catalogSnapshot"
       FROM pre_project_rooms WHERE workspace_id=$1 AND case_id=$2 ORDER BY created_at,id`,
    [workspaceId, caseId],
  );
  const items = await client.query<TreeItemSource>(
    `SELECT id::text,version,title,room_id::text AS "roomId",category,priority,
            scope_status AS "scopeStatus",review_status AS "reviewStatus",quantity::text,unit,
            archived_at AS "archivedAt"
       FROM pre_project_brief_entries
      WHERE workspace_id=$1 AND case_id=$2 AND kind='requirement' ORDER BY created_at,id`,
    [workspaceId, caseId],
  );
  const existingItems = await client.query<{ id: string }>(
    `SELECT id::text FROM one_tree_nodes WHERE workspace_id=$1 AND case_id=$2 AND kind='item'`,
    [workspaceId, caseId],
  );
  const existingRooms = await client.query<{id:string;label:string;sourceVersion:number;snapshot:Record<string,unknown>}>(
    `SELECT node.id::text,revision.label,revision.source_version AS "sourceVersion",revision.snapshot
       FROM one_tree_nodes node
       JOIN LATERAL (SELECT label,source_version,snapshot FROM one_tree_node_revisions
         WHERE workspace_id=node.workspace_id AND node_id=node.id ORDER BY revision DESC LIMIT 1) revision ON true
      WHERE node.workspace_id=$1 AND node.case_id=$2 AND node.kind='room'`,[workspaceId,caseId]);
  const candidates = treeCandidates(siteId, rooms.rows, items.rows, new Set(existingItems.rows.map((item) => item.id)),new Map(existingRooms.rows.map(room=>[room.id,room])));
  for (const candidate of candidates)
    await syncNode(client, workspaceId, jobId, caseId, candidate, actorUserId);

  // Current site evidence belongs to the case's primary site. Explicit multi-site
  // assignment can be introduced without changing these stable record IDs.
  await client.query(
    `UPDATE pre_project_site_records SET site_id=$3
      WHERE workspace_id=$1 AND case_id=$2 AND site_id IS NULL`,
    [workspaceId, caseId, siteId],
  );
  return {
    synced: true,
    reason: "ok",
    jobId,
    siteId,
    rooms: candidates.filter((candidate) => candidate.kind === "room").length,
    items: candidates.filter((candidate) => candidate.kind === "item").length,
  };
}
