import type { PoolClient } from "pg";
import { readDrawingItems } from "../project-core/project-drawing-needs";

type Db = Pick<PoolClient, "query">;

/** The project's technical drawings (Scope › Drawings) as the work order reads them: their latest revision and the client's decision. */
export type ProjectDrawing = { number: number; status: string; decidedOn: string | null; decidedByName: string | null };

/**
 * The drawing a work order is made to, and whether it counts as approved:
 * - the drawing recorded on the work order itself, until a newer revision of that design exists;
 * - otherwise the project's technical drawings, once the client approved their latest revision (a new revision
 *   waiting for the client stops it again);
 * - otherwise, for a standard piece that needs no technical drawings, its catalogue item's drawing.
 */
export type WorkOrderDrawing = { source: "work_order" | "project" | "catalogue" | null; approved: boolean; project: ProjectDrawing | null };

export function decideWorkOrderDrawing(input: {
  recorded: boolean; newer: number | null; project: ProjectDrawing | null;
  /** The work order's scope line as Scope › Drawings sees it: whether it needs drawings, and its catalogue drawing. */
  line: { needed: boolean; catalogDrawingUrl: string | null } | null;
}): WorkOrderDrawing {
  if (input.recorded) return { source: "work_order", approved: !input.newer, project: input.project };
  if (input.project?.status === "approved") return { source: "project", approved: true, project: input.project };
  if (input.line && !input.line.needed && input.line.catalogDrawingUrl) return { source: "catalogue", approved: true, project: input.project };
  return { source: null, approved: false, project: input.project };
}

/** The latest revision of a project's technical drawings, or null when none was uploaded. */
export async function readProjectDrawing(db: Db, workspaceId: string, projectId: string): Promise<ProjectDrawing | null> {
  return (await db.query<ProjectDrawing>(
    `SELECT revision.number, revision.status, revision.decided_on::text AS "decidedOn", revision.decided_by_name AS "decidedByName"
       FROM project_drawing_revisions revision WHERE revision.workspace_id = $1 AND revision.project_id = $2 ORDER BY revision.number DESC LIMIT 1`,
    [workspaceId, projectId])).rows[0] ?? null;
}

/** The drawing one work order is made to (see `decideWorkOrderDrawing`). */
export async function readWorkOrderDrawing(db: Db, workspaceId: string, order: { id: string; projectId: string; boqLineId: string; drawingNewer: number | null }) {
  const recorded = Boolean((await db.query<{ at: string | null }>(`SELECT drawing_approved_at AS at FROM work_orders WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, order.id])).rows[0]?.at);
  const project = await readProjectDrawing(db, workspaceId, order.projectId);
  // The line's own drawing need is read only when nothing else already decides it.
  const line = recorded || project?.status === "approved" ? null
    : (await readDrawingItems(db, workspaceId, order.projectId)).find((item) => item.lineId === order.boqLineId) ?? null;
  return decideWorkOrderDrawing({ recorded, newer: order.drawingNewer, project, line });
}
