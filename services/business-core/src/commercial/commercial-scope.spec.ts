import {describe,it,expect,vi} from 'vitest';
import {importedScopeDetails, importedScopeCatalogLinks} from './commercial-scope';
import {CommercialService} from './commercial.service';
import type {WorkspaceAccessService} from '../workspaces/workspace-access.service';
import type {ConfigService} from '@nestjs/config';
import type {CatalogSellingPriceService} from './catalog-selling-price.service';
import type {PreProjectReadinessService} from '../pre-projects/pre-project-readiness.service';
import type {Quote} from './commercial.types';
describe('Preparation to commercial scope',()=>{
 it('carries versioned specification material links without duplicating or importing excluded products',()=>{
  const snapshot={id:'m1',name:'Plywood',code:'PLY18',version:4,kind:'material',catalogId:'cat'};
  const selected={role:'material',recordId:'m1',version:4,snapshot};
  const links=importedScopeCatalogLinks({catalogLinks:[selected],specification:{materials:[{status:'selected',catalog:{material:snapshot,finish:{...snapshot,id:'f1',kind:'finish'}}},{status:'not_applicable',catalog:{material:{...snapshot,id:'unused'}}}]}});
  expect(links.map(link=>link.recordId)).toEqual(['m1','f1']);expect(links[1].version).toBe(4);
 });
 it('carries material and finish choices even without a detailed specification',()=>{expect(importedScopeDetails({note:'Install cabinet',catalogLinks:[{role:'material',snapshot:{name:'Oak veneer'}},{role:'finish',snapshot:{name:'Matte'}}]})).toEqual({specification:'Install cabinet',material:'Oak veneer',finish:'Matte'});});
 it('preserves product codes, brand, finishes, construction and measurement qualification',()=>{const result=importedScopeDetails({specification:{refinedRequirement:'Wardrobe',construction:'18 mm carcass',materials:[{application:'Shutter',productCode:'OAK-01',finishCode:'F2',status:'selected',catalog:{material:{name:'Oak'},brand:{name:'Sample brand'},finish:{name:'Matte'}}},{application:'Carcass',productName:'Plywood',status:'proposed'},{application:'Unused',productName:'Removed',status:'not_applicable'}],dimensions:[{name:'Width',approximate:2400,unit:'mm'}]}});expect(result.material).toBe('Shutter: Oak · Sample brand · OAK-01\nCarcass: Plywood: Proposed');expect(result.finish).toBe('Matte · F2');expect(result.specification).toContain('Width: 2400 mm (approx.)');expect(result.specification).toContain('18 mm carcass');});
 it('seeds every preparation room into a quotation without duplicating an imported room',async()=>{const service=new CommercialService({} as WorkspaceAccessService,{} as ConfigService,{} as CatalogSellingPriceService,{} as PreProjectReadinessService),snapshot={id:'catalog-room',name:'Reception',code:'REC',kind:'room',version:3,catalogId:'master'},query=vi.fn().mockResolvedValue({rows:[{id:'room-1',name:'Reception',catalogRecordId:'catalog-room',catalogSnapshot:snapshot},{id:'room-2',name:'Meeting room'}]}),quote={rooms:[{id:'room-1',name:'Reception'}],lines:[]} as Quote;await (service as unknown as {seedPreparationRooms:(client:{query:typeof query},workspaceId:string,caseId:string,quote:Quote)=>Promise<void>}).seedPreparationRooms({query},'workspace','case',quote);expect(quote.rooms?.map(room=>room.name)).toEqual(['Reception','Meeting room']);expect(query).toHaveBeenCalledWith(expect.stringContaining('pre_project_rooms'),['workspace','case']);});
});
