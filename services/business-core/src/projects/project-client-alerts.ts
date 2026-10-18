import type {ProjectData} from './execution.types';
import {activeReleasedScopeLines} from './project-work-packages';
import {acceptedOrderQuantity} from './project-inventory';

export type ClientProjectAlert = {
  id:string; kind:'delivery'|'work'|'milestone'; title:string;
  message:string; dueDate:string; expectedDate?:string;
};

/** Live, client-safe exceptions. Receiving/QC remain the source of truth. */
export function clientProjectAlerts(data:ProjectData,today:string):ClientProjectAlert[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || data.phase==='completed') return [];
  const alerts:ClientProjectAlert[]=[];
  const scope=activeReleasedScopeLines(data);
  for(const order of data.orders){
    if(!['approved','acknowledged'].includes(order.status)) continue;
    const received=acceptedOrderQuantity(data,order);
    if(received>=order.quantity) continue;
    const material=data.materials.find(m=>m.id===order.materialId);
    const task=data.tasks.find(t=>t.id===(order.taskId||material?.taskId));
    const item=scope.find(s=>s.id===material?.scopeLineId||task?.scopeIds.includes(s.id));
    if(!item) continue; // Never expose an unlinked internal procurement record.
    const expected=order.shipments?.at(-1)?.expectedDate||order.promisedDate;
    const due=order.baselinePromisedDate||order.promisedDate;
    if(!due || !(due<today || expected>due)) continue;
    alerts.push({id:`delivery:${order.id}`,kind:'delivery',title:`Delivery delayed · ${item.title}`,
      message:received>0?'Part of this delivery is still outstanding.':'This delivery is later than planned.',
      dueDate:due,...(expected>due?{expectedDate:expected}:{})});
  }
  const shared=data.reports.filter(r=>r.status==='approved'&&r.publishedAt&&!data.reports.some(n=>n.status==='approved'&&n.publishedAt&&n.supersedes===r.id));
  for(const dispatch of data.dispatches??[]){
    if(dispatch.status!=='dispatched'||!dispatch.dueDate||dispatch.dueDate>=today) continue;
    const task=data.tasks.find(t=>t.id===dispatch.receivingTaskId||t.id===dispatch.taskId);
    const item=scope.find(s=>task?.scopeIds.includes(s.id));
    if(item) alerts.push({id:`dispatch:${dispatch.id}`,kind:'delivery',title:`Site delivery delayed · ${item.title}`,message:'This factory delivery has not yet been received on site.',dueDate:dispatch.dueDate});
  }
  const sharedIds=new Set(shared.flatMap(r=>r.entries.map(e=>e.taskId)));
  for(const task of data.tasks){
    if(!sharedIds.has(task.id)||['completed','cancelled'].includes(task.status)) continue;
    const latest=shared.filter(r=>r.entries.some(e=>e.taskId===task.id)).sort((a,b)=>b.date.localeCompare(a.date)||(b.publishedAt??'').localeCompare(a.publishedAt??''))[0];
    const delayed=task.end&&task.end<today;
    const risk=latest?.scheduleImpact&&latest.scheduleImpact!=='none';
    if(!delayed&&!risk) continue;
    alerts.push({id:`work:${task.id}`,kind:'work',title:`${delayed?'Work overdue':'Schedule update'} · ${task.title}`,
      message:latest?.clientSummary||'Your team is reviewing the schedule for this work.',dueDate:task.end});
  }
  for(const milestone of data.milestones??[]){
    if(milestone.visibleToClient&&!milestone.acceptedAt&&milestone.dueDate&&milestone.dueDate<today)
      alerts.push({id:`milestone:${milestone.id}`,kind:'milestone',title:`Milestone overdue · ${milestone.title}`,message:'This milestone has not yet been accepted. Your team will confirm the next steps.',dueDate:milestone.dueDate});
  }
  return alerts.sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.id.localeCompare(b.id));
}
