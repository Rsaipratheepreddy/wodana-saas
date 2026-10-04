import type { PoolClient } from "pg";
import { recordAudit } from "../../audit/record-audit";
import { flowChecksum, type FlowDefinition } from "./flow-definition";
import { STARTER_FLOW_CODES, STARTER_FLOWS, starterFlow } from "./starter-flows";

type Db = Pick<PoolClient, "query">;

/** The flow a job runs: a published version of the workspace's flow, or the built-in starter when there is none. */
export type ResolvedFlow = {
  code: string;
  name: string;
  flowId: string | null;
  versionId: string | null;
  version: number | null;
  source: "starter" | "published" | "built_in";
  definition: FlowDefinition;
};

type VersionRow = { flowId: string; code: string; name: string; versionId: string; version: number; source: "starter" | "published"; definition: FlowDefinition };
const VERSION_COLUMNS = `flow.id AS "flowId", flow.code, flow.name, version.id AS "versionId", version.version, version.source, version.definition`;

const resolved = (row: VersionRow): ResolvedFlow => ({ ...row, source: row.source });

/**
 * Plan §5a, F2: every workspace gets the starter flows on first read, inside its own tenant transaction. Idempotent
 * and safe under concurrency (unique keys with ON CONFLICT DO NOTHING); a flow a firm already has is left alone.
 */
export async function ensureStarterFlows(db: Db, workspaceId: string) {
  const present = new Set((await db.query<{ code: string }>(
    `SELECT flow.code FROM crm_flows flow
      WHERE flow.workspace_id = $1 AND flow.code = ANY($2::text[])
        AND EXISTS (SELECT 1 FROM crm_flow_versions version WHERE version.workspace_id = flow.workspace_id AND version.flow_id = flow.id)`,
    [workspaceId, STARTER_FLOW_CODES])).rows.map((row) => row.code));
  for (const code of STARTER_FLOW_CODES) {
    if (present.has(code)) continue;
    const starter = STARTER_FLOWS[code];
    await db.query(`INSERT INTO crm_flows (workspace_id, code, name) VALUES ($1, $2, $3) ON CONFLICT (workspace_id, code) DO NOTHING`, [workspaceId, code, starter.name]);
    const flow = (await db.query<{ id: string }>(`SELECT id FROM crm_flows WHERE workspace_id = $1 AND code = $2`, [workspaceId, code])).rows[0];
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO crm_flow_versions (workspace_id, flow_id, version, definition, checksum, source)
       SELECT $1, $2, 1, $3::jsonb, $4, 'starter'
        WHERE NOT EXISTS (SELECT 1 FROM crm_flow_versions WHERE workspace_id = $1 AND flow_id = $2)
       ON CONFLICT (workspace_id, flow_id, version) DO NOTHING RETURNING id`,
      [workspaceId, flow.id, JSON.stringify(starter.definition), flowChecksum(starter.definition)]);
    if (inserted.rowCount) await recordAudit(db, {
      workspaceId, actorUserId: null, source: "internal", action: "crm.flow.seeded.v1", entityType: "crm_flow", entityId: flow.id,
      after: { code, version: 1, versionId: inserted.rows[0].id },
    });
  }
}

/** The latest version of the workspace's active flow with this code. */
export async function latestFlowVersion(db: Db, workspaceId: string, code: string): Promise<ResolvedFlow | null> {
  const row = (await db.query<VersionRow>(
    `SELECT ${VERSION_COLUMNS} FROM crm_flows flow
       JOIN LATERAL (SELECT * FROM crm_flow_versions candidate WHERE candidate.workspace_id = flow.workspace_id AND candidate.flow_id = flow.id
                      ORDER BY candidate.version DESC LIMIT 1) version ON true
      WHERE flow.workspace_id = $1 AND flow.code = $2 AND flow.status = 'active'`,
    [workspaceId, code])).rows[0];
  return row ? resolved(row) : null;
}

/** True when the workspace's flow with this code was copied (directly or through earlier copies) from `ancestorId`. */
async function splitFrom(db: Db, workspaceId: string, code: string, ancestorId: string) {
  const row = (await db.query(
    `WITH RECURSIVE lineage(id, parent, depth) AS (
       SELECT id, split_from_flow_id, 0 FROM crm_flows WHERE workspace_id = $1 AND code = $2
       UNION ALL
       SELECT flow.id, flow.split_from_flow_id, lineage.depth + 1 FROM crm_flows flow JOIN lineage ON flow.id = lineage.parent
        WHERE flow.workspace_id = $1 AND lineage.depth < 20)
     SELECT 1 FROM lineage WHERE parent = $3 LIMIT 1`,
    [workspaceId, code, ancestorId])).rowCount;
  return Boolean(row);
}

export async function flowVersionById(db: Db, workspaceId: string, versionId: string): Promise<ResolvedFlow | null> {
  const row = (await db.query<VersionRow>(
    `SELECT ${VERSION_COLUMNS} FROM crm_flow_versions version JOIN crm_flows flow ON flow.workspace_id = version.workspace_id AND flow.id = version.flow_id
      WHERE version.workspace_id = $1 AND version.id = $2`,
    [workspaceId, versionId])).rows[0];
  return row ? resolved(row) : null;
}

/**
 * The flow a job runs (engine rules 3 and 4). A job keeps the version it pinned; it pins the latest version of its
 * enquiry type's flow the first time it needs one (lazy, idempotent, audited), and re-pins only when its enquiry
 * type now points at a different flow. An unknown code runs the basic flow; with nothing published, the built-in
 * starter applies so nothing breaks while a firm configures. Pinning does not bump the job's version: it is a fact
 * about the configuration the job runs, not an edit a user makes.
 */
export async function opportunityFlow(db: Db, input: { workspaceId: string; opportunityId: string; code: string | null; pinnedVersionId: string | null; actorUserId?: string | null }): Promise<ResolvedFlow> {
  const { workspaceId, opportunityId, pinnedVersionId } = input;
  const code = input.code || "basic";
  if (pinnedVersionId) {
    const pinned = await flowVersionById(db, workspaceId, pinnedVersionId);
    if (pinned && pinned.code === code) return pinned;
    // The type's flow was split from the one the job pinned (one enquiry type, one flow): the job keeps its version.
    if (pinned?.flowId && await splitFrom(db, workspaceId, code, pinned.flowId)) return pinned;
  }
  await ensureStarterFlows(db, workspaceId);
  const latest = await latestFlowVersion(db, workspaceId, code) ?? (code === "basic" ? null : await latestFlowVersion(db, workspaceId, "basic"));
  if (!latest) {
    const starter = starterFlow(code);
    return { code: starter.code, name: starter.name, flowId: null, versionId: null, version: null, source: "built_in", definition: starter.definition };
  }
  if (latest.versionId !== pinnedVersionId) {
    const pinned = await db.query(
      `UPDATE crm_opportunities SET flow_version_id = $3 WHERE workspace_id = $1 AND id = $2 AND flow_version_id IS DISTINCT FROM $3::uuid`,
      [workspaceId, opportunityId, latest.versionId]);
    if (pinned.rowCount) await recordAudit(db, {
      workspaceId, actorUserId: input.actorUserId ?? null, source: "internal", action: "crm.opportunity.flow_pinned.v1", entityType: "crm_opportunity", entityId: opportunityId,
      before: { flowVersionId: pinnedVersionId }, after: { flowVersionId: latest.versionId, flow: latest.code, version: latest.version },
    });
  }
  return latest;
}
