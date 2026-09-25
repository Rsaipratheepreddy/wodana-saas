import {describe,it,expect} from 'vitest';
import {emptyProject,publicProject} from './execution.domain';

describe('client delay alerts',()=>{
 it('uses the provided local day, excludes private milestones and clears accepted milestones',()=>{
  const d=emptyProject();d.milestones=[{id:'m',title:'Installation',dueDate:'2026-09-20',baselineDate:'2026-09-20',ownerId:'private-owner',taskIds:[],visibleToClient:true,evidence:'Private evidence'},{id:'private',title:'Internal margin review',dueDate:'2026-09-01',baselineDate:'2026-09-01',ownerId:'private-owner',taskIds:[],visibleToClient:false,evidence:''}];
  expect(publicProject('p','Villa',d,'2026-09-20').alerts).toEqual([]);
  const alerts=publicProject('p','Villa',d,'2026-09-21').alerts;
  expect(alerts).toEqual([expect.objectContaining({id:'milestone:m',kind:'milestone'})]);
  expect(JSON.stringify(alerts)).not.toMatch(/private-owner|Private evidence|margin/);
  d.milestones[0].acceptedAt='2026-09-21';expect(publicProject('p','Villa',d,'2026-09-21').alerts).toEqual([]);
 });
 it('does not disclose an unlinked internal purchase',()=>{
  const d=emptyProject();d.orders=[{id:'o',number:'PO-1',title:'Private equipment',vendor:'Supplier',vendorContact:'private',kind:'material',materialId:'',taskId:'',quantity:2,unit:'nos',unitCost:100,currency:'AED',promisedDate:'2026-09-01',status:'acknowledged',acknowledgement:'',receipts:[]}];
  expect(publicProject('p','Villa',d,'2026-09-21').alerts).toEqual([]);
 });
});
