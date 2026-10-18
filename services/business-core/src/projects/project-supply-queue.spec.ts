import { describe, expect, it, vi } from 'vitest';
import type { HrmsContext } from '../hrms/hrms-access.service';
import type { Material, Order, ProjectData } from './execution.types';
import type { StockTransfer } from './project-stock.types';
import { readSupplyQueue, supplyQueuePage } from './project-supply-queue';

const projectId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const material = (supply: Material['supply'] = 'company') => ({
  id: 'boards', title: 'MR plywood', supply, required: 10, catalogId: 'catalog', catalogVersion: 1, unit: 'sheet', needBy: '2026-10-01',
  movements: [{ id: 'receipt', kind: 'receive', quantity: 2, reference: 'GRN-1', at: '2026-09-25' }], reservations: [],
}) as Material;
const order = (status: Order['status'] = 'approved') => ({
  id: 'po-1', number: 'PO-1', title: 'MR plywood', status, materialId: 'boards', quantity: 4,
  unit: 'sheet', promisedDate: '2026-09-29', vendor: 'Timber supplier', receipts: [],
}) as Order;
const project = (id: string, materials: Material[], orders: Order[]) => ({
  id, name: id === projectId ? 'Palm Villa' : 'Palm Office', content: { materials, orders } as ProjectData,
});
const transfer = (id: string, destinationId: string) => ({
  id, status: 'approved', quantity: 3, destination: { kind: 'project', id: destinationId, materialId: 'boards' },
}) as StockTransfer;

describe('cross-project supply projection', () => {
  it('shows only uncovered company supply, distinct supplier enquiry and active order, without costs', () => {
    const result = supplyQueuePage([project(projectId, [material(), material('client')], [order(), {...order('enquiry'), id: 'rfq-1', quantity: 1}])], [transfer('move-1', projectId)], true);
    const shortage = result.rows.find(row => row.kind === 'shortage')!;
    expect(shortage).toMatchObject({ projectName: 'Palm Villa', quantity: 1, catalogId: 'catalog', catalogVersion: 1, unit: 'sheet', dueDate: '2026-10-01' });
    expect(shortage.href).toBe(`/workspace/projects/${projectId}/procurement?view=shortages&record=boards`);
    expect(result.rows.filter(row => row.kind === 'shortage')).toHaveLength(1);
    expect(result.rows.find(row => row.kind === 'order')).toMatchObject({ status: 'approved', quantity: 4, supplier: 'Timber supplier' });
    expect(result.rows.find(row => row.kind === 'order')?.orderedQuantity).toBe(4);
    expect(result.rows.find(row => row.kind === 'enquiry')?.href).toContain('view=enquiries');
    expect(JSON.stringify(result)).not.toContain('unitCost');
  });

  it('does not use a transfer for another project even when a source material ID matches', () => {
    const result = supplyQueuePage([project(projectId, [material()], []), project(otherId, [material()], [])], [transfer('move-1', projectId)], false);
    expect(result.rows.find(row => row.projectId === projectId)?.quantity).toBe(5);
    expect(result.rows.find(row => row.projectId === otherId)?.quantity).toBe(8);
    expect(result.canBuy).toBe(false);
  });

  it('hides cancelled and closed orders and does not count a submitted order as received stock', () => {
    const result = supplyQueuePage([project(projectId, [material()], [order('submitted'), {...order('cancelled'), id: 'cancelled'}, {...order('closed'), id: 'closed'}])], [], true);
    expect(result.rows.filter(row => row.kind === 'order')).toHaveLength(1);
    expect(result.rows.find(row => row.kind === 'shortage')?.quantity).toBe(4);
  });

  it('keeps partial receipts visible without turning an unfinished order into stock', () => {
    const partReceived = {...order('acknowledged'), quantity:10, receipts:[{accepted:4,rejected:1}]};
    const result = supplyQueuePage([project(projectId, [material()], [partReceived as Order])], [], true);
    expect(result.rows.find(row => row.kind === 'order')).toMatchObject({orderedQuantity:10,quantity:6});
  });

  it('opens the Shipping section for closure and pending inspection actions', () => {
    const ready = { ...order('acknowledged'), id: 'ready', receipts: [{ accepted: 4, rejected: 0 }] } as Order;
    const inspection = { ...order('acknowledged'), id: 'inspection', receipts: [{ accepted: 1, rejected: 0, pending: 3 }] } as Order;
    const active = { ...order('acknowledged'), id: 'active', receipts: [{ accepted: 1, rejected: 0 }] } as Order;
    const result = supplyQueuePage([project(projectId, [material()], [ready, inspection, active])], [], true);
    const rows = Object.fromEntries(result.rows.filter(row => row.kind === 'order').map(row => [row.sourceId, row]));
    expect(rows.ready).toMatchObject({ quantity: 0, href: `/workspace/projects/${projectId}/procurement?view=deliveries&record=ready` });
    expect(rows.inspection).toMatchObject({ quantity: 3, pendingInspection: 3, href: `/workspace/projects/${projectId}/procurement?view=deliveries&record=inspection` });
    expect(rows.active).toMatchObject({ quantity: 3, href: `/workspace/projects/${projectId}/procurement?view=all&record=active` });
  });

  it('shows returned goods as still due on the existing order, not as a second order request', () => {
    const returnedMaterial = {
      ...material(),
      movements: [
        { id: 'receipt', kind: 'receive', quantity: 10, reference: 'GRN-1', at: '2026-09-20' },
        { id: 'return', kind: 'supplier_return', quantity: 2, reference: 'SR-1', at: '2026-09-25' },
      ],
    } as Material;
    const acknowledged = { ...order('acknowledged'), quantity: 10, receipts: [{ accepted: 10, rejected: 0 }] } as Order;
    const projectWithReturn = {
      ...project(projectId, [returnedMaterial], [acknowledged]),
      content: {
        materials: [returnedMaterial], orders: [acknowledged],
        supplierReturns: [{ id: 'return', orderId: acknowledged.id, quantity: 2, status: 'credited' }],
      } as ProjectData,
    };
    const result = supplyQueuePage([projectWithReturn], [], true);
    expect(result.rows.find(row => row.kind === 'order')).toMatchObject({ orderedQuantity: 10, quantity: 2 });
    expect(result.rows.some(row => row.kind === 'shortage')).toBe(false);
  });


  it('scopes project and transfer queries to the workspace and assigned project IDs', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [project(projectId, [material()], [])] })
      .mockResolvedValueOnce({ rows: [{ content: transfer('move-1', projectId) }] });
    const ctx = { workspaceId: 'workspace', membershipId: 'member', permissions: new Set(['projects.view']), client: { query } } as unknown as HrmsContext;
    const result = await readSupplyQueue(ctx);
    expect(result.rows[0].quantity).toBe(5);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('project_assignments');
    expect(query.mock.calls[0][0]).toContain("'materials',coalesce(e.content->'materials'");
    expect(query.mock.calls[0][0]).toContain("'supplierReturns',coalesce(e.content->'supplierReturns'");
    expect(query.mock.calls[0][0]).toContain('a.active');
    expect(query.mock.calls[0][1]).toEqual(['workspace', 'member', false]);
    expect(query.mock.calls[1][0]).toContain("content->'destination'->>'id'=ANY($2::text[])");
    expect(query.mock.calls[1][1]).toEqual(['workspace', [projectId]]);
  });

  it('reads warehouse stock only for a buyer or manager, scoped to the workspace', async () => {
    const stock = {id:'stock-1',title:'MR plywood',location:'Main warehouse',quantity:20,reserved:3,unit:'sheet'};
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [stock] });
    const ctx = {workspaceId:'workspace',membershipId:'buyer',permissions:new Set(['projects.view','projects.buy']),client:{query}} as unknown as HrmsContext;
    const result = await readSupplyQueue(ctx);
    expect(result).toMatchObject({canBuy:true,canViewInventory:true,stock:[stock]});
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain('FROM project_warehouse_stock');
    expect(query.mock.calls[1][1]).toEqual(['workspace']);
    expect(supplyQueuePage([],[],false,[stock as never],false).stock).toEqual([]);
  });
});
