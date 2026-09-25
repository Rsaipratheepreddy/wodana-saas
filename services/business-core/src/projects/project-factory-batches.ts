import { ConflictException } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import type { ProjectData, Task } from './execution.types';
import {activeReleasedScopeLines} from './project-scope-lines';
import {factoryQcQuantity} from './project-inventory';

export function factoryTaskSnapshot(data: ProjectData, task: Task) {
  const lines = activeReleasedScopeLines(data);
  return {
    taskId: task.id, title: task.title, area: task.area, packageId: task.packageId ?? '',
    quantity: task.quantity, unit: task.unit, resourceId: task.resourceId, ownerId: task.ownerId,
    start: task.start, end: task.end, drawingId: task.drawingId,
    scopeIds: [...task.scopeIds].sort(),
    scope: lines.filter(line => task.scopeIds.includes(line.id)).sort((a,b)=>a.id.localeCompare(b.id)),
    drawing: data.documents.find(document => document.id === task.drawingId) ?? null,
  };
}
export type FactorySnapshot = ReturnType<typeof factoryTaskSnapshot>;
export type FactoryAllocation = {projectId:string;projectName:string;revision:number;snapshot:FactorySnapshot};
export type FactoryBatch = {
  id:string;name:string;operation:string;compatibility:string;resourceId:string;resourceName:string;
  ownerId:string;ownerName:string;start:string;end:string;createdBy:string;createdAt:string;
  cancelled?:{by:string;at:string;reason:string};
};
export type FactoryAllocationView = FactoryAllocation & {
  approved:number;dispatched:number;received:number;rejected:number;returned:number;
  qc:string;status:string;changed:boolean;booked:boolean;
};
export type FactoryBatchView = FactoryBatch & {version:number;state:string;allocations:FactoryAllocationView[]};
export type FactoryCandidate = FactoryAllocation & {key:string;resourceName:string};
export type FactoryBatchesState = {
  canManage:boolean;batches:FactoryBatchView[];candidates:FactoryCandidate[];
  resources:{id:string;name:string}[];members:{id:string;name:string}[];
};

export function assertUnstartedFactoryTask(data:ProjectData,task:Task) {
  if (task.location !== 'factory' || task.status !== 'planned' || !(task.quantity > 0) || !Number.isFinite(task.quantity) ||
    data.tasks.some(child=>child.parentId===task.id&&child.status!=='cancelled') || task.approved > 0 ||
    data.reports.some(report=>report.entries.some(entry=>entry.taskId===task.id)) ||
    (data.dispatches??[]).some(dispatch=>dispatch.taskId===task.id))
    throw new ConflictException('Choose planned leaf factory tasks without production or dispatch history.');
}

export function assertCompatibleFactoryTasks(allocations:FactoryAllocation[],resourceId:string) {
  if (!allocations.length || allocations.some(item=>item.snapshot.resourceId!==resourceId || item.snapshot.unit!==allocations[0].snapshot.unit))
    throw new ConflictException('Batch tasks must share the selected workshop and quantity unit.');
}

export function assertFactoryScope(snapshot:FactorySnapshot) {
  if(!snapshot.scopeIds.length || snapshot.scope.length!==snapshot.scopeIds.length)
    throw new ConflictException('Link each factory task to its released BOQ scope before grouping it.');
}

export function factoryAllocationView(allocation:FactoryAllocation,data:ProjectData,booked:boolean):FactoryAllocationView {
  const task=data.tasks.find(task=>task.id===allocation.snapshot.taskId);
  const dispatches=(data.dispatches??[]).filter(item=>item.taskId===allocation.snapshot.taskId&&['dispatched','received'].includes(item.status));
  const latest=task?.inspections?.at(-1);
  return {...allocation,approved:task?.approved??0,status:task?.status??'missing',booked,
    changed:!task || !isDeepStrictEqual(factoryTaskSnapshot(data,task),allocation.snapshot),
    qc:task?.factoryLots?.some(lot=>lot.status==='rework')?'rework':task?.factoryLots?.some(lot=>lot.status!=='cancelled')?(factoryQcQuantity(task)>=task.approved?'passed':'pending'):latest?(latest.passed?(latest.quantity>=(task?.approved??0)&&latest.unit===task?.unit?'passed':'pending'):'rework'):(task?.inspectionRequired?'pending':'not_required'),
    dispatched:dispatches.reduce((sum,item)=>sum+item.quantity-(item.returnedToFactory??0),0),
    received:dispatches.filter(item=>item.status==='received').reduce((sum,item)=>sum+item.accepted,0),
    rejected:dispatches.reduce((sum,item)=>sum+item.rejected,0),
    returned:dispatches.reduce((sum,item)=>sum+(item.returnedToFactory??0),0),
  };
}

export function factoryBatchState(batch:FactoryBatch,allocations:FactoryAllocationView[]) {
  if(batch.cancelled)return 'cancelled';
  if(allocations.some(item=>item.changed||['missing','cancelled'].includes(item.status)))return 'needs_review';
  if(allocations.every(item=>item.received>=item.snapshot.quantity))return 'received';
  if(allocations.some(item=>item.qc==='rework'||item.rejected>item.returned))return 'rework';
  if(allocations.every(item=>item.dispatched>=item.snapshot.quantity))return 'dispatched';
  if(allocations.every(item=>item.status==='completed'&&['passed','not_required'].includes(item.qc)))return 'ready_to_dispatch';
  if(allocations.some(item=>item.status==='awaiting_inspection'))return 'qc';
  if(allocations.some(item=>item.approved>0||item.status!=='planned'))return 'in_progress';
  return 'planned';
}
