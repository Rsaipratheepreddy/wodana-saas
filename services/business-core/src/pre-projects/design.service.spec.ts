import {describe,it,expect,vi} from 'vitest';
import {validateDesignTransition,DesignService} from './design.service';
import {BriefService} from './brief.service';
import {plainToInstance} from 'class-transformer';
import {validate} from 'class-validator';
import {SaveBriefEntryDto} from './brief.dto';
import {SaveDesignFolderDto,UploadDesignFilesDto} from './design.dto';
import type {WorkspaceAccessService} from '../workspaces/workspace-access.service';
import type {CrmEventsService} from '../crm/shared/crm-events.service';
import type {BrandAssetStorageService} from '../workspaces/brand-asset-storage.service';
import type {RequestActor} from '../auth/actor';
const actor={} as RequestActor;
describe('design decisions',()=>{
 it.each([['draft','internal_review'],['internal_review','internal_approved'],['internal_approved','client_review'],['client_review','approved']])('allows %s → %s', (from,to)=>expect(()=>validateDesignTransition(from,to,'Confirmed in meeting','Client')).not.toThrow());
 it.each([['draft','approved'],['changes_requested','internal_review'],['approved','client_review'],['internal_review','client_review']])('prevents skipping review: %s → %s',(from,to)=>expect(()=>validateDesignTransition(from,to,'note','Client')).toThrow());
 it('requires a reason for requested changes',()=>expect(()=>validateDesignTransition('internal_review','changes_requested','','')).toThrow('Describe'));
 it('requires client attribution and evidence for a recorded decision',()=>{expect(()=>validateDesignTransition('client_review','approved','Approved','')).toThrow('client name');expect(()=>validateDesignTransition('client_review','changes_requested','','Client')).toThrow();});
 it('allows comments without changing an approved version',()=>expect(()=>validateDesignTransition('approved','comment','Installation note','')).not.toThrow());
 it('rejects empty comments',()=>expect(()=>validateDesignTransition('draft','comment','   ','')).toThrow());
});
describe('design organization contracts',()=>{
 const id='e56299c6-3da3-402a-a9ac-3995bb37b9d4';
 it('accepts a folder linked to a requirement item',async()=>{
  const dto=plainToInstance(SaveDesignFolderDto,{id,version:0,name:'Reception desk',description:'',roomId:id,scopeEntryId:id});
  expect(await validate(dto)).toHaveLength(0);
 });
 it('requires a valid design type for every uploaded file',async()=>{
  const valid=plainToInstance(UploadDesignFilesDto,{folderId:null,roomId:null,scopeEntryId:null,note:'',files:[{id,versionId:id,assetId:id,title:'Reception plan',documentType:'2D floor plan'}]});
  expect(await validate(valid)).toHaveLength(0);
  const invalid=plainToInstance(UploadDesignFilesDto,{folderId:null,roomId:null,scopeEntryId:null,note:'',files:[{id,versionId:id,assetId:id,title:'Reception plan',documentType:'Something vague'}]});
  expect(await validate(invalid)).not.toHaveLength(0);
 });
});
describe('folder and file write safeguards',()=>{
 function make(duplicate=false){
  const query=vi.fn(async(sql:string)=>{
   if(sql.startsWith('SELECT version FROM pre_project_design_folders'))return {rowCount:0,rows:[]};
   if(sql.startsWith('SELECT name FROM pre_project_rooms'))return {rowCount:1,rows:[{name:'Reception'}]};
   if(sql.startsWith('SELECT room_id,title'))return {rowCount:1,rows:[{room_id:'room',title:'Counter'}]};
   if(sql.includes('lower(name)=lower($3)'))return {rowCount:duplicate?1:0,rows:duplicate?[{id:'existing'}]:[]};
   return {rowCount:1,rows:[{id:'new-folder',name:'Reception + Counter'}]};
  });
  const brief={edit:async(_a:unknown,_w:string,_c:string,work:Function)=>work({query},'user'),version:vi.fn()};
  return {query,service:new DesignService({} as WorkspaceAccessService,brief as unknown as BriefService,{record:vi.fn()} as unknown as CrmEventsService)};
 }
 it('rejects duplicate room/item contexts even with a different folder name',async()=>{const {service,query}=make(true);await expect(service.saveFolder(actor,'w','c',{id:'new',version:0,name:'Reception + Counter',description:'',roomId:'room',scopeEntryId:'item'})).rejects.toThrow('already exists');expect(query).toHaveBeenCalledWith(expect.stringContaining('scope_entry_id=$5::uuid'),['w','c','Reception + Counter','new','item','room']);expect(query.mock.calls.some(([sql])=>sql.startsWith('INSERT'))).toBe(false);});
 it('does not accept custom names or unlinked new folders',async()=>{const {service}=make();await expect(service.saveFolder(actor,'w','c',{id:'new',version:0,name:'Random folder',description:'',roomId:'room',scopeEntryId:null})).rejects.toThrow('name must match');await expect(service.saveFolder(actor,'w','c',{id:'new',version:0,name:'Random folder',description:'',roomId:null,scopeEntryId:null})).rejects.toThrow('Choose a room');});
 it('accepts the generated room + item name',async()=>{const {service,query}=make();await service.saveFolder(actor,'w','c',{id:'new',version:0,name:'Reception + Counter',description:'',roomId:'room',scopeEntryId:'item'});expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO pre_project_design_folders'),['w','c','new','Reception + Counter','','room','item','user']);});
});
describe('case write safeguards',()=>{
 it('requires both viewing and editing permissions, and rejects released cases',async()=>{const query=vi.fn(async()=>({rowCount:1,rows:[{status:'released'}]}));const withPermissions=vi.fn(async(_a,_w,_p,work)=>work({query},{userId:'user'}));const service=new BriefService({withPermissions} as unknown as WorkspaceAccessService,{} as CrmEventsService,{} as BrandAssetStorageService);const write=vi.fn();await expect(service.edit(actor,'workspace','case',write)).rejects.toThrow('read-only');expect(withPermissions).toHaveBeenCalledWith(actor,'workspace',['pre_projects.view','pre_projects.edit'],expect.any(Function));expect(write).not.toHaveBeenCalled();});
 it('rejects a stale revision instead of overwriting',()=>{const service=new BriefService({} as WorkspaceAccessService,{} as CrmEventsService,{} as BrandAssetStorageService);expect(()=>service.version(3,2)).toThrow('Someone updated');});
 it('validates duplicate catalog roles',async()=>{const dto=plainToInstance(SaveBriefEntryDto,{catalogLinks:[{role:'work',recordId:'e56299c6-3da3-402a-a9ac-3995bb37b9d4'},{role:'work',recordId:'11911234-8004-4d49-b101-a9743f5ac28e'}]});const errors=await validate(dto);expect(errors.some(e=>e.property==='catalogLinks'&&e.constraints?.arrayUnique)).toBe(true);});
 it('prevents reviewing an older file version',async()=>{const oldId='old';const design={id:'design',version:4,versions:[{id:'current',status:'draft'},{id:oldId,status:'draft'}],activity:[]};const query=vi.fn(async()=>({rowCount:1,rows:[design]}));const brief={edit:async(_a:unknown,_w:string,_c:string,work:Function)=>work({query},'user'),version:vi.fn()};const service=new DesignService({} as WorkspaceAccessService,brief as unknown as BriefService,{} as CrmEventsService);await expect(service.activity(actor,'workspace','case','design',{id:'new',version:4,versionId:oldId,action:'internal_review',note:'',decisionBy:'',contextConfirmed:true})).rejects.toThrow('latest version');expect(query.mock.calls.some(([sql])=>String(sql).startsWith('UPDATE'))).toBe(false);});
});

describe('assigned design review',()=>{
 const make=(permission:boolean,reviewerId:string|null='reviewer')=>{
  const design={id:'design',version:4,versions:[{id:'current',status:'internal_review',reviewerId,createdAt:'2026-01-01T00:00:00Z'}],activity:[]};
  const query=vi.fn(async()=>({rowCount:1,rows:[design]}));
  const brief={edit:async(_a:unknown,_w:string,_c:string,work:Function)=>work({query},'user'),version:vi.fn()};
  const access={hasPermission:vi.fn(async()=>permission)};
  return {service:new DesignService(access as unknown as WorkspaceAccessService,brief as unknown as BriefService,{record:vi.fn()} as unknown as CrmEventsService),query};
 };
 it('rejects unassigned members even if they can review designs',async()=>{
  const {service,query}=make(true);await expect(service.activity(actor,'workspace','case','design',{id:'activity',version:4,versionId:'current',action:'internal_approved',note:'Checked',decisionBy:''})).rejects.toThrow('assigned reviewer');expect(query.mock.calls.some(([sql])=>String(sql).startsWith('UPDATE'))).toBe(false);
 });
 it('requires design review permission for a decision',async()=>{
  const {service}=make(false,'user');await expect(service.activity(actor,'workspace','case','design',{id:'activity',version:4,versionId:'current',action:'internal_approved',note:'Checked',decisionBy:''})).rejects.toThrow('permission');
 });
});

describe('client portal handoff readiness',()=>{
 const make=(portal:{enabled:boolean;hasApprover:boolean}|null)=>{
  const design={id:'design',version:4,versions:[{id:'current',status:'internal_approved'}],activity:[]};
  const query=vi.fn(async(sql:string)=>sql.startsWith('SELECT s.enabled')?{rows:portal?[portal]:[],rowCount:portal?1:0}:{rowCount:1,rows:[design]});
  const brief={edit:async(_a:unknown,_w:string,_c:string,work:Function)=>work({query},'user'),version:vi.fn()};
  return {service:new DesignService({} as WorkspaceAccessService,brief as unknown as BriefService,{record:vi.fn()} as unknown as CrmEventsService),query};
 };
 const input={id:'activity',version:4,versionId:'current',action:'client_review',note:'',decisionBy:''};
 it.each([null,{enabled:false,hasApprover:true}])('blocks handoff when the portal is not enabled',async portal=>{
  const {service,query}=make(portal);await expect(service.activity(actor,'w','c','design',input)).rejects.toThrow('Enable the client portal');
  expect(query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
 });
 it('requires an active client approver',async()=>{
  const {service,query}=make({enabled:true,hasApprover:false});await expect(service.activity(actor,'w','c','design',input)).rejects.toThrow('active client approver');
  expect(query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
 });
 it('shares an internally approved revision when the portal is ready',async()=>{
  const {service,query}=make({enabled:true,hasApprover:true});await service.activity(actor,'w','c','design',input);
  expect(query).toHaveBeenCalledWith(expect.stringContaining('SET status=$4'),['w','design','current','client_review']);
 });
});
