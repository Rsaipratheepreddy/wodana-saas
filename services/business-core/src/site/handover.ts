import { ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { raiseSnag } from "../project-core/project-work";
import { startWarranty } from "./warranty";

type Db = Pick<PoolClient, "query">;

/** Whether accepted packs cover the project: a whole-project pack, or every one of its areas (a project with no areas needs a whole-project pack). */
export function handedOver(packs: Array<{ status: string; areaIds: string[] }>, areaIds: string[]) {
  const accepted = packs.filter((pack) => pack.status === "accepted");
  if (accepted.some((pack) => !pack.areaIds.length)) return true;
  if (!areaIds.length) return false;
  const covered = new Set(accepted.flatMap((pack) => pack.areaIds));
  return areaIds.every((id) => covered.has(id));
}

/** Whether the client accepted the project's handover: its packs against its areas (the stage check "The client accepted the handover"). */
export async function projectHandedOver(db: Db, workspaceId: string, project: { id: string; caseId: string }) {
  return handedOver(
    (await db.query<{ status: string; areaIds: string[] }>(`SELECT status, area_ids AS "areaIds" FROM handover_packs WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, project.id])).rows,
    (await db.query<{ id: string }>(`SELECT id FROM pre_project_rooms WHERE workspace_id = $1 AND case_id = $2`, [workspaceId, project.caseId])).rows.map((row) => row.id));
}

/**
 * The client's decision on an issued pack, recorded by staff or given in the portal. Accepted: only while no
 * critical snag is open where the client takes over; the warranty of what it covers starts that day, and
 * what's still outstanding becomes minor snags from the client. Refused with why: a major snag, and a new
 * draft revision with the same documents to issue once it's fixed. Snags carry the staff member who
 * recorded it, or (from the portal) the person who issued the pack.
 */
export async function decideHandoverPack(db: Db, workspaceId: string, projectId: string, pack: { id: string; revision: number; title: string; areaIds: string[] }, input: {
  decision: "accept" | "refuse"; decidedOn: string; decidedByName: string; method: string; outstanding: string[]; reason: string;
  recordedBy: string | null; grantId: string | null; staffId: string;
}) {
  const within = (areaId: string | null) => !pack.areaIds.length || !areaId || pack.areaIds.includes(areaId);
  const from = input.grantId ? " (client portal)" : "";
  if (input.decision === "accept") {
    const critical = (await db.query<{ number: number; areaId: string | null }>(
      `SELECT number, area_id AS "areaId" FROM work_items WHERE workspace_id = $1 AND project_id = $2 AND type = 'snag' AND severity = 'critical' AND status NOT IN ('done', 'cancelled')`,
      [workspaceId, projectId])).rows.filter((snag) => within(snag.areaId));
    if (critical.length)
      throw new ConflictException(input.grantId ? "There's still a critical fix open in this handover. Your project team will let you know when it's ready."
        : `Close the critical snag${critical.length === 1 ? "" : "s"} first: ${critical.map((snag) => `#${snag.number}`).join(", ")}.`);
    await db.query(`UPDATE handover_packs SET status = 'accepted', decided_on = $3, decided_by_name = $4, decision_method = $5, decision_note = $6, recorded_by = $7,
      decided_by_grant_id = $8, version = version + 1 WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, pack.id, input.decidedOn, input.decidedByName, input.method, input.outstanding.join("\n").slice(0, 1000), input.recordedBy, input.grantId]);
    const warrantyStarted = await startWarranty(db, workspaceId, { projectId, packId: pack.id, areaIds: pack.areaIds, startsOn: input.decidedOn });
    for (const item of input.outstanding)
      await raiseSnag(db, workspaceId, { projectId, title: item, description: `Outstanding at handover (R${pack.revision})${from}`, severity: "minor", source: "client", actorId: input.staffId });
    return { warrantyStarted, next: null as string | null };
  }
  await db.query(`UPDATE handover_packs SET status = 'refused', decided_on = $3, decided_by_name = $4, decision_method = $5, decision_note = $6, recorded_by = $7,
    decided_by_grant_id = $8, version = version + 1 WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, pack.id, input.decidedOn, input.decidedByName, input.method, input.reason, input.recordedBy, input.grantId]);
  await raiseSnag(db, workspaceId, { projectId, title: `Handover refused: ${input.reason}`.slice(0, 300), description: `R${pack.revision} refused by ${input.decidedByName}${from}.`,
    severity: "major", source: "client", actorId: input.staffId });
  const next = randomUUID();
  const revision = (await db.query<{ next: number }>(`SELECT coalesce(max(revision), 0) + 1 AS next FROM handover_packs WHERE workspace_id = $1 AND project_id = $2`, [workspaceId, projectId])).rows[0].next;
  await db.query(`INSERT INTO handover_packs (id, workspace_id, project_id, revision, title, area_ids, replaces_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [next, workspaceId, projectId, revision, pack.title, pack.areaIds, pack.id, input.staffId]);
  await db.query(
    `INSERT INTO handover_documents (id, workspace_id, pack_id, kind, title, original_name, mime_type, byte_size, object_key, sha256, created_by)
     SELECT gen_random_uuid(), workspace_id, $3, kind, title, original_name, mime_type, byte_size, object_key, sha256, $4 FROM handover_documents WHERE workspace_id = $1 AND pack_id = $2`,
    [workspaceId, pack.id, next, input.staffId]);
  return { warrantyStarted: 0, next };
}
