import type { StockTransfer } from "./project-stock.types";
import type { Dispatch } from './execution-controls.types';
import type { Material, Order, ProjectData, Task } from './execution.types';

export function factoryQcQuantity(task:Task) {
  const lots=(task.factoryLots??[]).filter(lot=>lot.status!=='cancelled');
  if(lots.length)return Math.min(task.approved,lots.filter(lot=>lot.status==='passed').reduce((total,lot)=>total+lot.quantity,0));
  if(!task.inspectionRequired)return task.approved;
  const inspection=task.inspections?.at(-1);
  return inspection?.passed&&inspection.unit===task.unit?Math.min(task.approved,inspection.quantity):0;
}

const quantity = (value: number) => Math.max(0, Math.round(value * 1e6) / 1e6);

/** Accepted goods or service quantity still retained after a dispatched supplier return. */
export function acceptedOrderQuantity(data: Pick<ProjectData, 'supplierReturns'>, order: Order) {
  const returned = (data.supplierReturns ?? [])
    .filter(record => record.orderId === order.id && ['dispatched', 'credited'].includes(record.status))
    .reduce((total, record) => total + record.quantity, 0);
  return quantity(order.receipts.reduce((total, receipt) => total + receipt.accepted, 0) - returned);
}

/** Pending inspection is physically on site but is not accepted stock or a new shipment. */
export function orderReceivingPosition(data: Pick<ProjectData, 'supplierReturns'>, order: Order) {
  const accepted = acceptedOrderQuantity(data, order);
  const pendingInspection = quantity(order.receipts.reduce((total, receipt) => total + (receipt.pending ?? 0), 0));
  return { accepted, pendingInspection, remainingToArrive: quantity(order.quantity - accepted - pendingInspection) };
}

/** One quantity calculation for API, purchasing and UI. Orders never create stock. */
export function materialInventory(material: Material, orders: Order[] = [], transfers: StockTransfer[] = [], supplierReturns: ProjectData['supplierReturns'] = []) {
  const sum = (kinds: Material['movements'][number]['kind'][]) => material.movements.reduce((n, m) => n + (kinds.includes(m.kind) ? m.quantity : 0), 0);
  const received = sum(['receive']);
  const issued = quantity(sum(['issue']) - sum(['return']));
  const lost = sum(['waste', 'supplier_return', 'transfer_out']);
  const onHand = quantity(received - issued - lost);
  const reserved = quantity((material.reservations ?? []).reduce((n, r) => n + r.quantity, 0));
  const linked = orders.filter(order => order.materialId === material.id);
  const outstanding = (order: Order) => quantity(order.quantity - acceptedOrderQuantity({ supplierReturns }, order));
  const incoming = linked.filter(o => ['approved', 'acknowledged'].includes(o.status)).reduce((n, o) => n + outstanding(o), 0);
  const pendingApproval = linked.filter(o => o.status === 'submitted').reduce((n, o) => n + outstanding(o), 0);
  const transferIncoming = transfers.filter(t=>t.destination.kind==='project'&&t.destination.materialId===material.id&&['approved','dispatched'].includes(t.status)).reduce((n,t)=>n+t.quantity,0);
  const covered = quantity(received - lost);
  return {
    id: material.id, required: material.required, unit: material.unit,
    received, onHand, reserved, available: quantity(onHand - reserved), issued,
    covered, transferIncoming:quantity(transferIncoming), incoming: quantity(incoming + transferIncoming), pendingApproval: quantity(pendingApproval),
    outstanding: quantity(material.required - covered),
    shortfall: quantity(material.required - covered - incoming - pendingApproval - transferIncoming),
  };
}

/** Rejected output must physically return AND pass correction review before reuse. */
export function recoveredFactoryQuantity(data:ProjectData, dispatch:Dispatch) {
  return dispatch.rejectionSnagId && data.snags.some(s=>s.id===dispatch.rejectionSnagId&&s.status==='closed')
    ? Math.min(dispatch.rejected,dispatch.returnedToFactory??0) : 0;
}

/** Finished output remains separate from raw materials and is created only by QC approval.
 * Dispatch reservations, physical transit and accepted site custody are mutually exclusive.
 * These are projections of existing transactions, never a second copy of stock.
 */
export function projectInventory(data: ProjectData, transfers: StockTransfer[] = []) {
  return {
    materials: data.materials.map(material => materialInventory(material, data.orders, transfers, data.supplierReturns)),
    factory: data.tasks.filter(task => task.location === 'factory' && task.status !== 'cancelled').map(task => {
      const dispatches = (data.dispatches ?? []).filter(d => d.taskId === task.id && d.status !== 'cancelled');
      const dispatched = dispatches.filter(d => ['dispatched', 'received'].includes(d.status)).reduce((n, d) => n + d.quantity, 0);
      const reserved = dispatches.filter(d => d.status === 'ready').reduce((n, d) => n + d.quantity, 0);
      const inTransit = dispatches.filter(d => d.status === 'dispatched').reduce((n, d) => n + d.quantity, 0);
      const received = dispatches.filter(d => d.status === 'received');
      const accepted = received.reduce((n, d) => n + d.accepted, 0);
      const rejected = received.reduce((n, d) => n + d.rejected, 0);
      const recovered = received.reduce((n,d)=>n+recoveredFactoryQuantity(data,d),0);
      const onHand = quantity(factoryQcQuantity(task) - dispatched + recovered);
      return { taskId: task.id, title: task.title, unit: task.unit, required: task.quantity,
        approved: task.approved, remainingToBuild: quantity(task.quantity - task.approved),
        onHand, reserved: quantity(reserved), available: quantity(onHand - reserved),
        inTransit: quantity(inTransit), accepted: quantity(accepted), rejected: quantity(rejected - recovered),
        deliveries: dispatches.map(d => ({id:d.id, receivingTaskId:d.receivingTaskId, destination:d.destination, status:d.status, quantity:d.quantity, accepted:d.accepted, rejected:d.rejected})),
      };
    }),
  };
}
export type ProjectInventory = ReturnType<typeof projectInventory>;
