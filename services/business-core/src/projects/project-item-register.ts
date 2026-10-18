import type {ProjectData, ProjectState, ReleasedScopeLine, Task} from './execution.types';
import type {StockTransfer} from './project-stock.types';
import {activeReleasedScopeLines} from './project-scope-lines';
import {acceptedOrderQuantity,materialInventory} from './project-inventory';
import {projectItemPipeline} from './project-item-pipeline';
import {currentRfas, rfaAffectedScope, rfaReadiness} from './project-rfa';
import type {CommercialData} from '../commercial/commercial.types';

export type ItemRegisterSection = 'scope'|'plan'|'approvals'|'materials'|'orders'|'shipping'|'tasks'|'quality'|'handover';
export type ItemRegisterRow = {
  id:string; title:string; area:string; image?:string; scope:ReleasedScopeLine; packageIds:string[]; taskIds:string[];
  materialIds:string[]; orderIds:string[]; rfqIds:string[]; documentIds:string[]; rfaIds:string[];
  dispatchIds:string[]; snagIds:string[]; handoverIds:string[]; ownerIds:string[];
  sourceQuoteId:string; sourceQuoteNumber:number; dueDate:string; blocked:string; overdue:boolean;
  approvals:string; materials:string; purchasing:string; shipping:string; factory:string; site:string; quality:string; handover:string;
  suppliers:string[]; commitments:{currency:string;amount:number}[];
  quantities:ReturnType<typeof materialInventory>[];
  next:{label:string;section:ItemRegisterSection};
};
const taskSummary=(tasks:Task[])=>!tasks.length?'Not planned':`${tasks.filter(task=>task.status==='completed').length} / ${tasks.length} complete${tasks.some(task=>['blocked','on_hold'].includes(task.status))?' · blocked':tasks.some(task=>task.status==='in_progress')?' · active':''}`;

/** Derived view only. Shared records must not be summed across item rows. */
export function projectItemRegister(data:ProjectData,today='',transfers:StockTransfer[]=[],images:Record<string,string>={}):ItemRegisterRow[]{
  const pipeline=new Map(projectItemPipeline(data,today).map(item=>[item.id,item]));
  return activeReleasedScopeLines(data).map(scope=>{
    const packages=(data.workPackages??[]).filter(work=>work.status!=='cancelled'&&work.scopeLineIds.includes(scope.id));
    const packageIds=packages.map(work=>work.id);
    const tasks=data.tasks.filter(task=>task.status!=='cancelled'&&(task.scopeIds.includes(scope.id)||!!task.packageId&&packageIds.includes(task.packageId)));
    const taskIds=tasks.map(task=>task.id);
    const materials=data.materials.filter(material=>material.scopeLineId?material.scopeLineId===scope.id:!!material.taskId&&taskIds.includes(material.taskId));
    const materialIds=materials.map(material=>material.id);
    const orders=data.orders.filter(order=>order.status!=='cancelled'&&(order.materialId?materialIds.includes(order.materialId):order.rfqSnapshot?.scopeLineId?order.rfqSnapshot.scopeLineId===scope.id:!!order.taskId&&taskIds.includes(order.taskId)));
    const rfqs=orders.filter(order=>order.status==='enquiry'), purchases=orders.filter(order=>order.status!=='enquiry');
    const documents=data.documents.filter(document=>document.scopeLineIds?.includes(scope.id));
    const rfas=currentRfas(data).filter(request=>rfaAffectedScope(data,request).includes(scope.id));
    const dispatches=(data.dispatches??[]).filter(dispatch=>dispatch.status!=='cancelled'&&(taskIds.includes(dispatch.taskId)||taskIds.includes(dispatch.receivingTaskId)));
    const snags=data.snags.filter(snag=>!!snag.taskId&&taskIds.includes(snag.taskId));
    const handovers=data.handovers.filter(handover=>(!!handover.sourcePackageId&&packageIds.includes(handover.sourcePackageId))||handover.taskIds.some(id=>taskIds.includes(id)));
    const quantities=materials.map(material=>materialInventory(material,data.orders,transfers,data.supplierReturns));
    const committed=orders.filter(order=>['approved','acknowledged','closed'].includes(order.status));
    const commitments=new Map<string,number>();
    for(const order of committed)commitments.set(order.currency,(commitments.get(order.currency)??0)+order.quantity*order.unitCost);
    const received=committed.filter(order=>acceptedOrderQuantity(data,order)>0).length;
    const pendingQc=orders.some(order=>order.receipts.some(receipt=>(receipt.pending??0)>0));
    // Tracking rows are successive events, not additive shipment quantities.
    const inTransit=orders.filter(order=>order.shipments?.at(-1)?.status==='dispatched').length+dispatches.filter(dispatch=>dispatch.status==='dispatched').length;
    const openSnags=snags.filter(snag=>snag.status!=='closed');
    const pipelineRows=packageIds.flatMap(id=>pipeline.get(id)?[pipeline.get(id)!]:[]);
    const rfaBlock=rfaReadiness(data,[scope.id]);
    const blocked=rfaBlock||pipelineRows.find(item=>item.blocked)?.blocked||tasks.find(task=>['blocked','on_hold'].includes(task.status))?.blocker||'';
    const nextPipeline=pipelineRows.find(item=>item.blocked)||pipelineRows.find(item=>item.stage!=='done')||pipelineRows[0];
    const targetMap={plan:'plan',steps:'tasks',materials:'materials',factory:'tasks',site:'tasks',quality:'quality',complete:'handover'} as const;
    const next:ItemRegisterRow['next']=rfaBlock?{label:'Resolve approval',section:'approvals'}:nextPipeline?{label:nextPipeline.next,section:targetMap[nextPipeline.target]}:{label:'Plan delivery',section:'plan'};
    const variation=(data.variations??[]).find(variation=>variation.direction!=='deduction'&&variation.lines.some(line=>line.id===scope.id));
    return {id:scope.id,title:scope.title,area:scope.room||'Unassigned',image:scope.photo||images[scope.id],scope,packageIds,taskIds,materialIds,
      orderIds:purchases.map(order=>order.id),rfqIds:rfqs.map(order=>order.id),documentIds:documents.map(document=>document.id),rfaIds:rfas.map(request=>request.id),
      dispatchIds:dispatches.map(dispatch=>dispatch.id),snagIds:snags.map(snag=>snag.id),handoverIds:handovers.map(handover=>handover.id),
      ownerIds:[...new Set([...packages.map(work=>work.ownerId),...tasks.map(task=>task.ownerId)].filter(Boolean))],
      sourceQuoteId:variation?.quoteId??data.scope?.quoteId??'',sourceQuoteNumber:variation?.number??data.scope?.quoteNumber??0,
      dueDate:packages.map(work=>work.plannedEnd).filter(Boolean).sort().at(-1)||tasks.map(task=>task.end).filter(Boolean).sort().at(-1)||'',
      blocked,overdue:pipelineRows.some(item=>item.overdue)||tasks.some(task=>task.status!=='completed'&&!!task.end&&!!today&&task.end<today),
      approvals:rfaBlock?'Action needed':rfas.some(request=>!['approved','withdrawn'].includes(request.status))?'Awaiting approval':rfas.some(request=>request.status==='approved')?'Approved':documents.some(doc=>doc.status==='approved')?'Approved document':'Not requested',
      materials:!materials.length?'Not planned':`${quantities.filter(position=>position.outstanding===0).length} / ${materials.length} covered`,
      purchasing:!purchases.length?rfqs.length?`${rfqs.length} open RFQs`:'Not ordered':`${purchases.length} POs · ${committed.length} committed${purchases.some(order=>order.status==='submitted')?' · approval pending':''}`,
      shipping:pendingQc?'Receipt QC pending':inTransit?`${inTransit} in transit`:received?`${received} POs with receipts`:dispatches.some(dispatch=>dispatch.status==='received')?'Factory output received':orders.some(order=>order.shipments?.length)?'Tracking available':'No shipment recorded',
      factory:taskSummary(tasks.filter(task=>task.location==='factory')),site:taskSummary(tasks.filter(task=>task.location==='site')),
      quality:openSnags.length?`${openSnags.length} open defects`:tasks.some(task=>task.status==='awaiting_inspection')?'Inspection pending':tasks.length&&tasks.every(task=>task.status==='completed')?'Work complete':'Not complete',
      handover:!handovers.length?'Not prepared':`${handovers.filter(handover=>handover.status==='accepted').length} / ${handovers.length} accepted`,
      suppliers:[...new Set(orders.map(order=>order.vendor).filter(Boolean))],commitments:[...commitments].map(([currency,amount])=>({currency,amount})),quantities,next};
  });
}

export function registerForState(state:ProjectState){return projectItemRegister(state.data,state.today??'',state.stockTransfers??[],state.itemImages??{});}

/** Older releases omitted photos. Read the exact accepted source, not a newer
 * quotation with similar names, and do not rewrite the historical scope. */
export function projectItemImages(data:ProjectData,commercial?:CommercialData):Record<string,string>{
 const images:Record<string,string>={};
 const sources=[...(data.scope?[data.scope]:[]),...(data.variations??[]).filter(variation=>variation.direction!=='deduction')];
 for(const source of sources){const quote=commercial?.quotes.find(quote=>quote.id===source.quoteId&&quote.status==='accepted');for(const line of source.lines){const photo=line.photo||quote?.lines.find(item=>item.id===line.id)?.photo;if(photo&&photo.length<=60000&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo))images[line.id]=photo;}}
 return images;
}
