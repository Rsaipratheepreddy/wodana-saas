import type { PoolClient } from "pg";
import { caseWonAreas, shownAreas, type WonArea } from "../crm/flows/flow-won-areas";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-098: the areas a project shows after Won — the ones its enquiry type's path uses, plus any area that already
 * holds a record (a plan with work, factory work or a slot, project purchases, a delivery or installation day), so
 * hiding an area never hides data. A path without its own setting shows every area.
 */
export async function projectAreas(db: Db, workspaceId: string, projectId: string, caseId: string | null): Promise<Record<WonArea, boolean>> {
  const configured = caseId ? (await caseWonAreas(db, workspaceId, caseId)).areas : null;
  if (!configured || ["planning", "production", "supply", "delivery"].every((area) => configured.includes(area as WonArea)))
    return { planning: true, production: true, supply: true, delivery: true, selection: configured?.includes("selection") ?? true };
  const present = (await db.query<Record<WonArea, boolean>>(
    `SELECT EXISTS (SELECT 1 FROM work_items item WHERE item.workspace_id = project.workspace_id AND item.project_id = project.id AND item.type <> 'snag') AS planning,
            (project.factory_slot_on IS NOT NULL OR EXISTS (SELECT 1 FROM work_orders wo WHERE wo.workspace_id = project.workspace_id AND wo.project_id = project.id)) AS production,
            EXISTS (SELECT 1 FROM purchase_order_lines line WHERE line.workspace_id = project.workspace_id AND line.project_id = project.id) AS supply,
            (project.delivery_on IS NOT NULL OR project.installation_on IS NOT NULL) AS delivery,
            false AS selection
       FROM delivery_projects project WHERE project.workspace_id = $1 AND project.id = $2`, [workspaceId, projectId])).rows[0];
  return shownAreas(configured, present ?? {});
}
