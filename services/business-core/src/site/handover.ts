import type { PoolClient } from "pg";

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
