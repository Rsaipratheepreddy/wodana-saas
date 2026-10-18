import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { recordAudit } from "../../audit/record-audit";
import { UNRESOLVED_ENQUIRY_TYPE } from "../leads/lead-options";
import { flowChecksum } from "./flow-definition";
import { ensureStarterFlows } from "./flow-store";
import { STARTER_FLOWS } from "./starter-flows";

type Db = Pick<PoolClient, "query">;

/**
 * The code a new flow is stored under (its enquiry type points at it): the name in lower-case letters, digits and _,
 * or a stable hash of the name when it has too few Latin letters (an Arabic name, for instance).
 */
export function flowCodeFor(name: string) {
  const slug = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^[^a-z]+/, "").slice(0, 40).replace(/_+$/, "");
  return slug.length >= 2 ? slug : `flow_${createHash("sha256").update(name.trim()).digest("hex").slice(0, 8)}`;
}

/** The base code, or the base with a number after it, whichever no flow in the workspace has yet. */
export async function freeFlowCode(db: Db, workspaceId: string, base: string) {
  const taken = new Set((await db.query<{ code: string }>(`SELECT code FROM crm_flows WHERE workspace_id = $1`, [workspaceId])).rows.map((row) => row.code));
  if (!taken.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const suffix = `_${index}`;
    const code = `${base.slice(0, 40 - suffix.length)}${suffix}`;
    if (!taken.has(code)) return code;
  }
}

type TypeRow = { id: string; code: string; label: string; flow: string | null; ownedFlowId: string | null; ownedCode: string | null };
type FlowRow = { id: string; code: string; status: string; ownerId: string | null };

const ENQUIRY_TYPES = `FROM crm_taxonomy_options choice
  JOIN crm_taxonomies taxonomy ON taxonomy.workspace_id = choice.workspace_id AND taxonomy.id = choice.taxonomy_id AND taxonomy.code = 'enquiry_type'
  LEFT JOIN crm_flows owned ON owned.workspace_id = choice.workspace_id AND owned.enquiry_type_option_id = choice.id
  WHERE choice.workspace_id = $1 AND choice.status = 'active' AND choice.code <> $2`;

/**
 * QA-002 repair: an enquiry type that should start from another starter flow (design, fit_out, furniture) but still
 * owns the untouched copy of Basic it was given (one version, the Basic starter's steps, never published over) takes
 * that flow's steps: the untouched copy is archived (a starter flow is only let go), the type points at the wanted flow,
 * and `ensureEnquiryTypeFlows` links it (or gives it its own copy). Its jobs move to the new steps on their next read,
 * as when a type's flow changes (E2-1, audited). Anything a firm edited is left alone. Idempotent; `dryRun` only says
 * which types would change. Returns the codes of the types repaired (or to repair).
 */
export async function repairStarterFlows(db: Db, workspaceId: string, wanted: ReadonlyMap<string, string>, options: { actorUserId?: string | null; dryRun?: boolean } = {}) {
  await ensureEnquiryTypeFlows(db, workspaceId, { actorUserId: options.actorUserId });
  const basic = flowChecksum(STARTER_FLOWS.basic.definition);
  const rows = (await db.query<{ id: string; code: string; flow: string | null; flowId: string; flowCode: string; versions: number; checksum: string | null; source: string | null }>(
    `SELECT choice.id, choice.code, choice.flow, owned.id AS "flowId", owned.code AS "flowCode",
            (SELECT count(*)::int FROM crm_flow_versions version WHERE version.workspace_id = owned.workspace_id AND version.flow_id = owned.id) AS versions,
            (SELECT version.checksum FROM crm_flow_versions version WHERE version.workspace_id = owned.workspace_id AND version.flow_id = owned.id ORDER BY version.version DESC LIMIT 1) AS checksum,
            (SELECT version.source FROM crm_flow_versions version WHERE version.workspace_id = owned.workspace_id AND version.flow_id = owned.id ORDER BY version.version DESC LIMIT 1) AS source
     ${ENQUIRY_TYPES} AND owned.id IS NOT NULL ORDER BY choice.position, choice.label, choice.id`, [workspaceId, UNRESOLVED_ENQUIRY_TYPE])).rows;
  const repaired: string[] = [];
  for (const row of rows) {
    const target = wanted.get(row.code);
    if (!target || target === "basic" || !STARTER_FLOWS[target] || row.flowCode === target) continue;
    if (row.versions !== 1 || row.checksum !== basic || row.source !== "starter") continue; // the firm's own steps
    repaired.push(row.code);
    if (options.dryRun) continue;
    await db.query(
      `UPDATE crm_flows SET enquiry_type_option_id = NULL, status = CASE WHEN code = ANY($3::text[]) THEN status ELSE 'archived' END, updated_by = $4, updated_at = now()
        WHERE workspace_id = $1 AND id = $2`, [workspaceId, row.flowId, Object.keys(STARTER_FLOWS), options.actorUserId ?? null]);
    await db.query(`UPDATE crm_taxonomy_options SET flow = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, row.id, target]);
    await recordAudit(db, {
      workspaceId, actorUserId: options.actorUserId ?? null, source: "internal", action: "crm.enquiry_type.flow_repaired.v1", entityType: "crm_taxonomy_option", entityId: row.id,
      before: { flow: row.flow, flowId: row.flowId, flowCode: row.flowCode, steps: "basic" }, after: { flow: target },
    });
  }
  if (repaired.length && !options.dryRun) await ensureEnquiryTypeFlows(db, workspaceId, { actorUserId: options.actorUserId });
  return repaired;
}

/**
 * Plan §5a: one enquiry type, one flow. The product shows enquiry types, each with its own steps; the flow is how those
 * steps are stored. Run on read inside the tenant transaction, this makes the data match (idempotent, audited):
 *   * a type that already owns a flow keeps it, and its `flow` code is put back to that flow's code if it drifted;
 *   * a type whose flow nobody owns yet takes it (an unset or unknown flow means Basic, as it always did);
 *   * a type whose flow another type already owns gets its own copy of that flow's latest version (a split). Jobs
 *     pinned to the shared flow keep their pinned version (see `opportunityFlow`).
 * Types listed in `fromBasic` (just added in Settings) that name no flow start from the Basic starter instead of a copy.
 * "Not sure yet" never gets a flow.
 */
export async function ensureEnquiryTypeFlows(db: Db, workspaceId: string, options: { actorUserId?: string | null; fromBasic?: ReadonlySet<string> } = {}) {
  await ensureStarterFlows(db, workspaceId);
  const drift = await db.query(`SELECT 1 ${ENQUIRY_TYPES} AND (owned.id IS NULL OR choice.flow IS DISTINCT FROM owned.code) LIMIT 1`, [workspaceId, UNRESOLVED_ENQUIRY_TYPE]);
  if (!drift.rowCount) return;
  // One upgrade at a time per workspace: a second reader waits, then finds nothing left to do.
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended('crm_enquiry_type_flows:' || $1::text, 0))`, [workspaceId]);
  const types = (await db.query<TypeRow>(
    `SELECT choice.id, choice.code, choice.label, choice.flow, owned.id AS "ownedFlowId", owned.code AS "ownedCode"
     ${ENQUIRY_TYPES} ORDER BY choice.position, choice.label, choice.id FOR UPDATE OF choice`, [workspaceId, UNRESOLVED_ENQUIRY_TYPE])).rows;
  const flows = (await db.query<FlowRow>(
    `SELECT id, code, status, enquiry_type_option_id AS "ownerId" FROM crm_flows WHERE workspace_id = $1 FOR UPDATE`, [workspaceId])).rows;
  const actorUserId = options.actorUserId ?? null;

  const pointAt = async (type: TypeRow, code: string) => {
    if (type.flow === code) return;
    await db.query(`UPDATE crm_taxonomy_options SET flow = $3, version = version + 1, updated_at = now() WHERE workspace_id = $1 AND id = $2`, [workspaceId, type.id, code]);
    await recordAudit(db, {
      workspaceId, actorUserId, source: "internal", action: "crm.enquiry_type.flow_changed.v1", entityType: "crm_taxonomy_option", entityId: type.id,
      before: { flow: type.flow }, after: { flow: code },
    });
  };

  for (const type of types) {
    if (type.ownedFlowId) {
      await pointAt(type, type.ownedCode!);
      continue;
    }
    const fresh = options.fromBasic?.has(type.id) && !type.flow;
    const named = fresh ? undefined : flows.find((flow) => flow.code === type.flow && flow.status === "active")
      ?? flows.find((flow) => flow.code === "basic" && flow.status === "active");
    if (named && !named.ownerId) {
      await db.query(`UPDATE crm_flows SET enquiry_type_option_id = $3 WHERE workspace_id = $1 AND id = $2 AND enquiry_type_option_id IS NULL`, [workspaceId, named.id, type.id]);
      named.ownerId = type.id;
      await recordAudit(db, {
        workspaceId, actorUserId, source: "internal", action: "crm.enquiry_type.flow_linked.v1", entityType: "crm_flow", entityId: named.id,
        after: { enquiryTypeId: type.id, enquiryType: type.code, code: named.code },
      });
      await pointAt(type, named.code);
      continue;
    }
    // Another type owns that flow (or there is none): this type gets its own copy.
    const source = named ? (await db.query<{ id: string; definition: unknown; checksum: string; source: string; publishedBy: string | null }>(
      `SELECT id, definition, checksum, source, published_by AS "publishedBy" FROM crm_flow_versions WHERE workspace_id = $1 AND flow_id = $2 ORDER BY version DESC LIMIT 1`,
      [workspaceId, named.id])).rows[0] : undefined;
    const definition = source?.definition ?? STARTER_FLOWS.basic.definition;
    const code = await freeFlowCode(db, workspaceId, flowCodeFor(type.label));
    const flow = (await db.query<{ id: string }>(
      `INSERT INTO crm_flows (workspace_id, code, name, enquiry_type_option_id, split_from_flow_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
      [workspaceId, code, type.label.slice(0, 120), type.id, source ? named!.id : null, actorUserId])).rows[0];
    const version = (await db.query<{ id: string }>(
      `INSERT INTO crm_flow_versions (workspace_id, flow_id, version, definition, checksum, source, published_by)
       VALUES ($1, $2, 1, $3::jsonb, $4, $5, $6) RETURNING id`,
      [workspaceId, flow.id, JSON.stringify(definition), source?.checksum ?? flowChecksum(STARTER_FLOWS.basic.definition), source?.source ?? "starter", source?.publishedBy ?? null])).rows[0];
    flows.push({ id: flow.id, code, status: "active", ownerId: type.id });
    await recordAudit(db, {
      workspaceId, actorUserId, source: "internal", action: source ? "crm.flow.split.v1" : "crm.flow.created.v1", entityType: "crm_flow", entityId: flow.id,
      before: source ? { flowId: named!.id, code: named!.code, versionId: source.id } : null,
      after: { code, version: 1, versionId: version.id, enquiryTypeId: type.id, enquiryType: type.code, ...(source ? {} : { from: { starter: "basic" } }) },
    });
    await pointAt(type, code);
  }
}
