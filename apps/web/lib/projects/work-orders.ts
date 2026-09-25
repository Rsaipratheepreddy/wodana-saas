import type { ProjectState, ProjectWorkPackage } from './execution';
import { quantityToSource } from './purchasing';
export const supplyLabels = { make:'Make ourselves', buy:'Buy finished', subcontract:'Subcontract', client:'Client supplied' };
export const siteLabels = { none:'No site work', delivery:'Delivery only', install:'Installation', site_work:'Site work' };
export function workOrderDetails(state: ProjectState, work: ProjectWorkPackage) {
  const tasks = state.data.tasks.filter(task=>task.packageId===work.id && task.status!=='cancelled');
  const materials = state.data.materials.filter(material=>tasks.some(task=>task.id===material.taskId) || Boolean(material.scopeLineId && work.scopeLineIds.includes(material.scopeLineId)));
  const orders = state.data.orders.filter(order=>order.status!=='cancelled' && (tasks.some(task=>task.id===order.taskId) || materials.some(material=>material.id===order.materialId)));
  const designs = state.data.documents.filter(doc=>doc.status==='approved' && doc.scopeLineIds?.some(id=>work.scopeLineIds.includes(id)));
  const missing = materials.filter(material=>material.supply==='company' && quantityToSource(material,state.data.orders,[],state.data.supplierReturns)>0);
  const stage = work.status==='completed' ? 'Complete' : work.status==='blocked' || work.status==='on_hold' ? 'On hold' : tasks.some(task=>task.status==='awaiting_inspection') ? 'Inspection' : work.status==='in_progress' || tasks.some(task=>task.status==='in_progress') ? 'In progress' : work.status==='ready' ? 'Ready' : !work.supplyMethod || !work.siteWork || !tasks.length ? 'Needs planning' : 'Waiting for requirements';
  const next = stage==='Complete' ? 'Review handover' : stage==='On hold' ? work.blocker || 'Resolve the blocker' : stage==='Inspection' ? 'Inspect reported work' : stage==='In progress' ? 'Update progress' : !work.supplyMethod || !work.siteWork ? 'Choose supply and site work' : !tasks.length ? 'Plan the first task' : !work.ownerId ? 'Assign a responsible person' : missing.length ? `Source ${missing.length} requirement${missing.length===1?'':'s'}` : tasks.some(task=>task.location!=='office') && !designs.length ? 'Link approved drawings' : stage==='Ready' ? 'Start the next ready task' : 'Review readiness checks';
  return { tasks, materials, orders, designs, stage, next };
}
