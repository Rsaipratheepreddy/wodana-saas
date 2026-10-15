import type { PoolClient } from "pg";
import { commercialRepository } from "../commercial/commercial-repository";
import type { CommercialData } from "../commercial/commercial.types";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-164: the records one job runs through, from the accepted quotation onward, each by its own id for a link to the live
 * record: the quotation, the Deal File, the project, and the purchase orders and work orders raised for the project.
 */
export type RecordLinks = {
  caseId: string;
  quote: { id: string; number: number; title: string } | null;
  dealFile: { id: string; reference: string } | null;
  project: { id: string; reference: string; name: string };
  purchaseOrders: Array<{ id: string; number: string; status: string }>;
  workOrders: Array<{ id: string; number: number; status: string }>;
};

/** The linked records of one project; null when the project isn't there. */
export async function readRecordLinks(db: Db, workspaceId: string, projectId: string): Promise<RecordLinks | null> {
  const project = (await db.query<{ id: string; caseId: string; reference: string; name: string; quoteId: string | null }>(
    `SELECT id, case_id AS "caseId", reference, name, quote_id AS "quoteId" FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0];
  if (!project) return null;
  const quote = project.quoteId ? (await db.query<{ id: string; number: number; title: string }>(
    `SELECT id, number, title FROM commercial_quotes WHERE workspace_id = $1 AND case_id = $2 AND id = $3`, [workspaceId, project.caseId, project.quoteId])).rows[0] ?? null : null;
  const commercial = (await commercialRepository.load(db as PoolClient, workspaceId, project.caseId))?.content as CommercialData | undefined;
  const dealFile = commercial?.dealFile ? { id: commercial.dealFile.id, reference: commercial.dealFile.reference } : null;
  const purchaseOrders = (await db.query<{ id: string; number: string; status: string }>(
    `SELECT DISTINCT purchase.id, purchase.number, purchase.status
       FROM purchase_order_lines ordered
       JOIN purchase_orders purchase ON purchase.workspace_id = ordered.workspace_id AND purchase.id = ordered.order_id
       LEFT JOIN work_orders work ON work.workspace_id = ordered.workspace_id AND work.id = ordered.work_order_id
      WHERE ordered.workspace_id = $1 AND (ordered.project_id = $2 OR work.project_id = $2) AND purchase.status <> 'cancelled'
      ORDER BY purchase.number`, [workspaceId, projectId])).rows;
  const workOrders = (await db.query<{ id: string; number: number; status: string }>(
    `SELECT id, number, status FROM work_orders WHERE workspace_id = $1 AND project_id = $2 AND status <> 'cancelled' ORDER BY number`, [workspaceId, projectId])).rows;
  return { caseId: project.caseId, quote, dealFile, project: { id: project.id, reference: project.reference, name: project.name }, purchaseOrders, workOrders };
}
