import type { HrmsContext } from '../hrms/hrms-access.service';
import type { Material, Order, ProjectData } from './execution.types';
import { materialInventory, orderReceivingPosition } from './project-inventory';
import type { StockTransfer, WarehouseStock } from './project-stock.types';

export type SupplyQueueRow = {
  id: string;
  projectId: string;
  projectName: string;
  sourceId: string;
  kind: 'shortage' | 'enquiry' | 'order';
  title: string;
  status: string;
  quantity: number;
  orderedQuantity?: number;
  pendingInspection?: number;
  catalogId?: string;
  catalogVersion?: number;
  unit: string;
  dueDate: string;
  supplier: string;
  href: string;
};

export type SupplyQueuePage = { rows: SupplyQueueRow[]; canBuy: boolean; canViewInventory: boolean; stock: WarehouseStock[] };
type SupplyProject = { id: string; name: string; content: Pick<ProjectData, 'materials' | 'orders' | 'supplierReturns'> };

const projectHref = (projectId: string, view: string, recordId: string) =>
  `/workspace/projects/${encodeURIComponent(projectId)}/procurement?view=${view}&record=${encodeURIComponent(recordId)}`;

/** Read-only workspace projection. Source records and all purchasing commands stay with their projects. */
export function supplyQueuePage(projects: SupplyProject[], transfers: StockTransfer[], canBuy: boolean, stock: WarehouseStock[] = [], canViewInventory = canBuy): SupplyQueuePage {
  const rows: SupplyQueueRow[] = [];
  for (const project of projects) {
    const materials: Material[] = project.content.materials ?? [];
    const orders: Order[] = project.content.orders ?? [];
    const incomingTransfers = transfers.filter(transfer => transfer.destination.kind === 'project' && transfer.destination.id === project.id);
    for (const material of materials) {
      if (material.supply !== 'company') continue;
      const toOrder = materialInventory(material, orders, incomingTransfers, project.content.supplierReturns).shortfall;
      if (toOrder <= 0) continue;
      rows.push({
        id: `${project.id}:shortage:${material.id}`, projectId: project.id, projectName: project.name,
        sourceId: material.id, kind: 'shortage', title: material.title, status: 'To order',
        quantity: toOrder, catalogId: material.catalogId, catalogVersion: material.catalogVersion,
        unit: material.unit, dueDate: material.needBy ?? '', supplier: '',
        href: projectHref(project.id, 'shortages', material.id),
      });
    }
    for (const order of orders) {
      if (['cancelled', 'closed'].includes(order.status)) continue;
      const kind = order.status === 'enquiry' ? 'enquiry' : 'order';
      const receiving = orderReceivingPosition(project.content, order);
      const readyToClose = order.status === 'acknowledged' && order.quantity > 0 && receiving.accepted >= order.quantity;
      rows.push({
        id: `${project.id}:${kind}:${order.id}`, projectId: project.id, projectName: project.name,
        sourceId: order.id, kind, title: order.title, status: order.status,
        quantity: Math.max(0, order.quantity - receiving.accepted),
        orderedQuantity: kind === 'order' ? order.quantity : undefined,
        ...(receiving.pendingInspection > 0 ? { pendingInspection: receiving.pendingInspection } : {}),
        unit: order.unit, dueDate: order.promisedDate ?? '', supplier: order.vendor ?? '',
        href: projectHref(project.id, kind === 'enquiry' ? 'enquiries' : readyToClose || receiving.pendingInspection > 0 ? 'deliveries' : 'all', order.id),
      });
    }
  }
  rows.sort((a, b) => (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31') || a.projectName.localeCompare(b.projectName) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return { rows, canBuy, canViewInventory, stock: canViewInventory ? stock : [] };
}

export async function readSupplyQueue(ctx: HrmsContext): Promise<SupplyQueuePage> {
  const canBuy = ctx.permissions.has('projects.buy');
  const canViewInventory = canBuy || ctx.permissions.has('projects.manage');
  const projects = (await ctx.client.query<SupplyProject>(`
    SELECT p.id,p.name,jsonb_build_object(
      'materials',coalesce(e.content->'materials','[]'::jsonb),
      'orders',coalesce(e.content->'orders','[]'::jsonb),
      'supplierReturns',coalesce(e.content->'supplierReturns','[]'::jsonb)
    ) AS content FROM delivery_projects p
    JOIN project_execution_view e ON e.workspace_id=p.workspace_id AND e.project_id=p.id
    WHERE p.workspace_id=$1 AND p.status<>'archived'
      AND ($3 OR EXISTS(SELECT 1 FROM project_assignments a WHERE a.workspace_id=p.workspace_id
        AND a.project_id=p.id AND a.membership_id=$2 AND a.active))
    ORDER BY p.id`, [ctx.workspaceId, ctx.membershipId, ctx.permissions.has('projects.manage')])).rows;
  const transfers = projects.length ? (await ctx.client.query<{ content: StockTransfer }>(`
    SELECT content FROM project_stock_transfers WHERE workspace_id=$1
      AND content->'destination'->>'kind'='project'
      AND content->'destination'->>'id'=ANY($2::text[])`,
  [ctx.workspaceId, projects.map(project => project.id)])).rows.map(row => row.content) : [];
  const stock = canViewInventory ? (await ctx.client.query<WarehouseStock>(`
    SELECT id,location,catalog_id AS "catalogId",catalog_version AS "catalogVersion",title,unit,
      quantity::float,reserved::float FROM project_warehouse_stock
    WHERE workspace_id=$1 ORDER BY location,title,id`, [ctx.workspaceId])).rows : [];
  return supplyQueuePage(projects, transfers, canBuy, stock, canViewInventory);
}
