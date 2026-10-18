import { ConflictException } from '@nestjs/common';
import type { ProjectData } from './execution.types';

export function acceptedServiceQuantity(data: ProjectData, taskId: string) {
  return data.orders.filter(order => order.kind === 'subcontract' && order.taskId === taskId)
    .reduce((total, order) => total + order.receipts.reduce((sum, receipt) => sum + receipt.accepted, 0), 0);
}

/** Measured services use approved task output, never a warehouse receipt alone. */
export function assertServiceAcceptance(data: ProjectData, order: ProjectData['orders'][number], increment: number) {
  if (order.kind !== 'subcontract') return;
  const task = data.tasks.find(task => task.id === order.taskId);
  if (!task) throw new ConflictException('Link the subcontract order to its measured work task before accepting service.');
  if (task.unit !== order.unit) throw new ConflictException('Service order and task units must match. Record a measured task for this service unit.');
  let eligible = task.approved;
  if (task.inspectionRequired && task.status !== 'completed') {
    const batches = task.location === 'factory' ? task.factoryLots : task.installationBatches;
    eligible = Math.min(eligible, (batches ?? []).filter(batch => batch.status === 'passed').reduce((sum, batch) => sum + batch.quantity, 0));
  }
  if (acceptedServiceQuantity(data, task.id) + increment > eligible + 0.000001)
    throw new ConflictException(`Only ${eligible} ${task.unit} of approved, inspected work is available for service acceptance. Review existing service certificates and task output.`);
}
