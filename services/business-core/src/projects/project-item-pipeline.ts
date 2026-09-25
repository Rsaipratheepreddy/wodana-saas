import {materialInventory} from "./project-inventory";
import type { ProjectData, ProjectWorkPackage } from './execution.types';

export const itemPipelineStages = [
  { id: 'plan', label: 'Plan' },
  { id: 'source', label: 'Source / build' },
  { id: 'site', label: 'Site work' },
  { id: 'quality', label: 'Quality check' },
  { id: 'handover', label: 'Handover' },
  { id: 'done', label: 'Accepted' },
] as const;
export type ItemPipelineStage = typeof itemPipelineStages[number]['id'];
export type ItemPipeline = {
  id: string;
  stage: ItemPipelineStage;
  next: string;
  target: 'plan' | 'steps' | 'materials' | 'factory' | 'site' | 'quality' | 'complete';
  blocked: string;
  overdue: boolean;
  completedTasks: number;
  totalTasks: number;
  /** Separate quantities per material: unlike units must never be added together. */
  materials: { id: string; required: number; received: number; outstanding: number; unit: string }[];
};

/** Read model only. Navigating a stage never authorizes or changes operational work. */
export function projectItemPipeline(data: ProjectData, today: string): ItemPipeline[] {
  return (data.workPackages ?? []).filter(work => work.status !== 'cancelled').map(work => itemPipeline(data, work, today));
}
function itemPipeline(data: ProjectData, work: ProjectWorkPackage, today: string): ItemPipeline {
  const tasks = data.tasks.filter(task => task.packageId === work.id && task.status !== 'cancelled');
  const taskIds = new Set(tasks.map(task => task.id));
  const materials = data.materials.filter(material => taskIds.has(material.taskId) || Boolean(material.scopeLineId && work.scopeLineIds.includes(material.scopeLineId))).map(material => {
    const position = materialInventory(material, data.orders, [], data.supplierReturns);
    return {id:material.id, required:material.required, received:position.covered, outstanding:position.outstanding, unit:material.unit};
  });
  const factory = tasks.filter(task => task.location === 'factory');
  const site = tasks.filter(task => task.location === 'site');
  const snags = (data.snags ?? []).filter(snag => snag.status !== 'closed' && (taskIds.has(snag.taskId) || (!snag.taskId && Boolean(work.area) && snag.area === work.area)));
  const handovers = (data.handovers ?? []).filter(handover => handover.sourcePackageId === work.id || handover.taskIds.some(id => taskIds.has(id)));
  // A partial/area acceptance cannot complete tasks omitted from its packet.
  const accepted = new Set(handovers.filter(handover => handover.status === 'accepted').flatMap(handover => handover.taskIds));
  const complete = tasks.length > 0 && tasks.every(task => task.status === 'completed');
  const blockedTask = tasks.find(task => ['blocked', 'on_hold'].includes(task.status));
  const result: ItemPipeline = {
    id: work.id, stage: 'plan', next: 'Plan item', target: 'plan',
    blocked: ['blocked', 'on_hold'].includes(work.status) ? work.blocker || 'Item is on hold' : blockedTask?.blocker || (blockedTask ? `${blockedTask.title} is blocked` : ''),
    overdue: Boolean(today && !complete && ((work.plannedEnd && work.plannedEnd < today) || tasks.some(task=>task.status!=="completed"&&task.end&&task.end<today) || data.materials.some(material=>materials.some(item=>item.id===material.id&&item.outstanding>0)&&material.needBy&&material.needBy<today))),
    completedTasks: tasks.filter(task => task.status === 'completed').length, totalTasks: tasks.length, materials,
  };
  const at = (stage: ItemPipelineStage, next: string, target: ItemPipeline['target']) => ({ ...result, stage, next, target });
  if (!work.supplyMethod || !work.siteWork) return result;
  if (!work.ownerId || !tasks.length) return at('plan', !work.ownerId ? 'Assign owner' : 'Add tasks', 'steps');
  if (complete && tasks.every(task => accepted.has(task.id)) && !snags.length) return at('done', 'View acceptance', 'complete');
  // Active installation is visible even when later batches are still in procurement.
  if (site.some(task => task.status === 'in_progress')) return at('site', 'Update site work', 'site');
  if (factory.some(task => task.status !== 'completed')) return at('source', factory.some(task => task.status === 'awaiting_inspection') ? 'Inspect factory work' : materials.some(material => material.outstanding > 0) && !factory.some(task => task.status === 'in_progress') ? 'Source materials' : 'Open factory work', materials.some(material => material.outstanding > 0) && !factory.some(task => ['in_progress', 'awaiting_inspection'].includes(task.status)) ? 'materials' : 'factory');
  if (tasks.some(task => task.status === 'awaiting_inspection') || snags.length) return at('quality', snags.length ? 'Resolve defects' : 'Inspect work', 'quality');
  if (complete) return at('handover', handovers.some(handover => handover.status === 'ready') ? 'Review client handover' : 'Prepare handover', 'complete');
  if (materials.some(material => material.outstanding > 0)) return at('source', data.orders.some(order=>materials.some(material=>material.id===order.materialId&&material.outstanding>0)&&['approved','acknowledged'].includes(order.status))?'Receive materials':'Source materials', 'materials');
  const awaitingFactoryReceipt=site.some(task=>task.status!=='completed'&&(task.predecessors??[]).some(id=>factory.some(task=>task.id===id)&&!(data.dispatches??[]).some(dispatch=>dispatch.taskId===id&&dispatch.receivingTaskId===task.id&&dispatch.status==='received'&&dispatch.accepted>0)));
  if(awaitingFactoryReceipt)return at('source','Receive factory output','factory');
  if (site.some(task => task.status !== 'completed')) return at('site', 'Open site work', 'site');
  return at('source', 'Review work', 'steps');
}
