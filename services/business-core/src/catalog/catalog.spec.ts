import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe,expect,it,vi } from "vitest";
import { CATALOG_STARTER } from "./catalog-starter";
import { SaveCatalogRecordDto } from "./catalog.dto";
import { CatalogService,validateCatalogRecord } from "./catalog.service";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import type { CrmEventsService } from "../crm/shared/crm-events.service";
import type { RequestActor } from "../auth/actor";

const actor={subject:"test",provider:"development"} as RequestActor;
const catalogId="ffffffff-ffff-4fff-afff-ffffffffffff";
const room={...CATALOG_STARTER.find(r=>r.kind==="room")!,catalogId};
describe("starter catalog integrity",()=>{
 it("validates every record, stable identifier and typed reference",async()=>{
  expect(new Set(CATALOG_STARTER.map(r=>r.id)).size).toBe(CATALOG_STARTER.length);
  expect(new Set(CATALOG_STARTER.map(r=>`${r.kind}:${r.code}`)).size).toBe(CATALOG_STARTER.length);
  expect(new Set(CATALOG_STARTER.map(r=>`${r.kind}:${r.name.toLowerCase()}`)).size).toBe(CATALOG_STARTER.length);
  for(const row of CATALOG_STARTER) {
   expect(await validate(plainToInstance(SaveCatalogRecordDto,row),{whitelist:true,forbidNonWhitelisted:true}),row.name).toEqual([]);
   expect(()=>validateCatalogRecord(row),row.name).not.toThrow();
   for(const link of row.links) expect(CATALOG_STARTER.find(r=>r.id===link.targetId)?.kind,`${row.name}:${link.relation}`).toBe(link.relation==="parent"?row.kind:link.relation);
  }
 });
 it("retains exact published formats without creating unsupported combinations",()=>{
  const mdf=CATALOG_STARTER.find(r=>r.name.startsWith("Greenpanel Exterior"))!;
  expect(mdf.sizes).toHaveLength(10);
  expect(mdf.sizes.every(s=>!s.thicknessMm||!s.lengthMm)).toBe(true);
  const gypsum=CATALOG_STARTER.find(r=>r.name.startsWith("Gyproc Gypboard"))!;
  expect(gypsum.sizes).toHaveLength(5);
  expect(gypsum.sizes.every(s=>s.widthMm===1219)).toBe(true);
  const paint=CATALOG_STARTER.find(r=>r.name.startsWith("Asian Paints Royale"))!;
  expect(paint.sizes.map(s=>s.packQuantity)).toEqual([1,3.6,16.5,18]);
 });
 it("rejects dimensional and unit mistakes",()=>{
  const material=structuredClone(CATALOG_STARTER.find(r=>r.kind==="material")!);
  expect(()=>validateCatalogRecord({...material,sizes:[{label:"unknown size"}]})).toThrow("dimension or pack");
  expect(()=>validateCatalogRecord({...material,sizes:[{label:"1 L",packQuantity:1}]})).toThrow("both pack");
  expect(()=>validateCatalogRecord({...room,links:[{relation:"unit",targetId:material.id}]})).toThrow("relationship");
  expect(()=>validateCatalogRecord({...room,kind:"unit",dimension:"pack",baseFactor:32})).toThrow("Pack conversions");
  expect(()=>validateCatalogRecord({...material,specificationStatus:"reference",sources:[]})).toThrow("source");
 });
 it("accepts reviewable sellable records without changing existing catalog defaults",async()=>{
  const work=structuredClone(CATALOG_STARTER.find(r=>r.kind==="work")!);
  const reviewed={...work,commerce:{pricingMode:"on_request" as const},provenance:{namespace:"xlsx:palm-living",sourceKey:"chairs/aria",sourceFingerprint:"a".repeat(64),reviewStatus:"needs_review" as const,sourceFileName:"Core Collection.xlsx",sourceSheet:"Chairs",sourceRow:7}};
  expect(await validate(plainToInstance(SaveCatalogRecordDto,reviewed),{whitelist:true,forbidNonWhitelisted:true})).toEqual([]);
  expect(()=>validateCatalogRecord(reviewed)).not.toThrow();
  expect(()=>validateCatalogRecord({...room,commerce:{pricingMode:"fixed"}})).toThrow("sellable");
 });
});
describe("factory and on-site master structure",()=>{
 const row=(code:string)=>structuredClone(CATALOG_STARTER.find(r=>r.code===code)!);
 it("keeps factory installation on site, parent slots distinct and commercial suggestions unapproved",()=>{
  const factory=row("EXEC-FACTORY");const install=row("SP-CARP-INST");
  expect(install.kind).toBe("site_process");expect(install.links).toContainEqual({relation:"execution",targetId:factory.id});
  const slots=CATALOG_STARTER.filter(r=>r.kind==="construction"&&r.configuration?.recordRole==="component"&&r.links.some(l=>l.relation==="parent"&&l.targetId===row("ICT-WARD").id));
  expect(slots).toHaveLength(9);
  for(const r of CATALOG_STARTER.filter(r=>["tax","commercial_rule","wastage_rule"].includes(r.kind))) {
   expect(r.configuration?.approvedPercent).toBeUndefined();expect(r.configuration?.approvedValue).toBeUndefined();expect(r.specificationStatus).toBe("needs_specification");
  }
  expect(row("MEAS-STONE").configuration?.formula).toBe("finished_length * finished_depth");
  expect(row("TAX-UAE-EXEMPT").configuration?.treatment).toBe("exempt");
  expect(row("TAX-UAE-ZERO").configuration?.treatment).toBe("zero_rated");
 });
 it("rejects unknown settings, invalid units and unsupported approval values",()=>{
  const process=row("FP-CUT-PANEL");
  expect(()=>validateCatalogRecord({...process,configuration:{setupMinutes:-1}})).toThrow("valid setup");
  expect(()=>validateCatalogRecord({...process,configuration:{executeScript:"alert(1)"}})).toThrow("Unknown configuration");
  expect(()=>validateCatalogRecord({...process,links:process.links.filter(l=>l.relation!=="unit")})).not.toThrow();
  expect(()=>validateCatalogRecord({...process,specificationStatus:"workspace_verified",links:process.links.filter(l=>l.relation!=="unit")})).toThrow("measurement unit");
  expect(()=>validateCatalogRecord({...row("WST-PLY"),specificationStatus:"workspace_verified"})).toThrow("workspace allowance");
  expect(()=>validateCatalogRecord({...row("COM-MAR-TGT"),configuration:{ruleGroup:"Margin",approvedValue:100}})).toThrow("less than 100");
  expect(()=>validateCatalogRecord({...row("TAX-UAE-ZERO"),configuration:{treatment:"zero_rated",approvedPercent:5}})).toThrow("zero rate");
 });
 it("requires one rate target, explicit currency, dates and inclusions",()=>{
  const process=row("FP-CUT-PANEL");
  const rate={...room,kind:"rate_card",links:[process.links.find(l=>l.relation==="unit")!,{relation:"factory_process",targetId:process.id}],configuration:{amount:50,currency:"INR",effectiveFrom:"2026-09-07",priceType:"cost",costIncludes:"labour_and_machine",taxIncluded:"no"}};
  expect(()=>validateCatalogRecord(rate)).not.toThrow();
  expect(()=>validateCatalogRecord({...rate,links:rate.links.filter(l=>l.relation!=="unit")})).toThrow("measurement unit");
  expect(()=>validateCatalogRecord({...rate,links:rate.links.slice(0,1)})).toThrow("exactly one");
  expect(()=>validateCatalogRecord({...rate,links:[...rate.links,{relation:"site_process",targetId:row("SP-CARP-INST").id}]})).toThrow("exactly one");
  expect(()=>validateCatalogRecord({...rate,configuration:{...rate.configuration,effectiveTo:"2026-01-01"}})).toThrow("end date");
  expect(()=>validateCatalogRecord({...rate,configuration:{...rate.configuration,effectiveFrom:"2026-02-31"}})).toThrow("valid effective");
  expect(()=>validateCatalogRecord({...rate,configuration:{...rate.configuration,costIncludes:"unconfirmed"}})).toThrow("cost inclusions");
 });
});
function setup(current:unknown=null,targets:unknown[]=[],canManageCosts=true) {
 const query=vi.fn(async(sql:string)=>{
  if(sql.includes("kind='catalog_group'"))return {rows:[{id:catalogId,kind:"catalog_group",archived:false}],rowCount:1};
  if(sql.includes("content,version")&&sql.includes("AND id=$2"))return {rows:current?[current]:[],rowCount:current?1:0};
  if(sql.startsWith("SELECT id,kind,archived"))return {rows:targets,rowCount:targets.length};
  return {rows:[],rowCount:0};
 });
 const withPermissions=vi.fn(async(_a,_w,_p,fn)=>fn({query},{userId:"user"}));
 const hasPermission=vi.fn(async(_client,_workspace,_user,permission)=>permission==="supplier_offers.manage"?canManageCosts:true);
 const record=vi.fn();
 return {service:new CatalogService({withPermissions,hasPermission} as unknown as WorkspaceAccessService,{record} as unknown as CrmEventsService),query,withPermissions,hasPermission,record};
}
describe("workspace catalog writes",()=>{
 it("blocks conversion changes to a referenced unit before writing data",async()=>{
  const unit={...CATALOG_STARTER.find(r=>r.kind==="unit"&&r.dimension==="length")!,catalogId,version:1};
  const current={...unit,content:{dimension:unit.dimension,baseFactor:unit.baseFactor}};
  const {service,query}=setup(current);
  const original=query.getMockImplementation()!;
  query.mockImplementation(async(sql:string)=>sql.includes("FROM workspace_catalog_links WHERE")?{rows:[{}],rowCount:1}:original(sql));
  await expect(service.save(actor,"workspace",{...unit,baseFactor:unit.baseFactor!*2})).rejects.toThrow("already linked");
  expect(query.mock.calls.some(([sql])=>/^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
 });

 it("permits basic custom records and groups, and rejects invalid group defaults",()=>{
  expect(()=>validateCatalogRecord({...room,kind:"custom",links:[],configuration:{}})).not.toThrow();
  expect(()=>validateCatalogRecord({...room,kind:"record_group",links:[],configuration:{defaultKind:"room"}})).not.toThrow();
  expect(()=>validateCatalogRecord({...room,kind:"record_group",links:[],configuration:{defaultKind:"catalog_group"}})).toThrow("record type");
 });
 it("rejects membership in a group from another catalog",async()=>{
  const group=CATALOG_STARTER.find(r=>r.kind==="record_group")!;
  const {service,query}=setup(null,[{id:group.id,kind:"record_group",archived:false,catalogId:"other",content:{}}]);
  await expect(service.save(actor,"workspace",{...room,links:[{relation:"record_group",targetId:group.id}]})).rejects.toThrow("same catalog");
  expect(query.mock.calls.some(([sql])=>/^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
 });
 it("reserves a reviewed source identity for one record in each catalog",async()=>{
  const work={...structuredClone(CATALOG_STARTER.find(r=>r.kind==="work")!),catalogId,commerce:{pricingMode:"fixed" as const},provenance:{namespace:"xlsx:client",sourceKey:"chairs/aria",sourceFingerprint:"b".repeat(64),reviewStatus:"needs_review" as const}};
  const {service,query}=setup();
  const original=query.getMockImplementation()!;
  query.mockImplementation(async(sql:string)=>sql.includes("content->'provenance'->>'sourceKey'")?{rows:[{}],rowCount:1}:original(sql));
  await expect(service.save(actor,"workspace",work)).rejects.toThrow("source row");
  expect(query.mock.calls.some(([sql])=>/^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
 });
 it("rejects duplicate source identities inside one reviewed import batch",async()=>{
  const template=structuredClone(CATALOG_STARTER.find(r=>r.kind==="work")!);
  const provenance={namespace:"xlsx:client",sourceKey:"chairs/aria",sourceFingerprint:"c".repeat(64),reviewStatus:"needs_review" as const};
  const records=[
   {...template,id:"10000000-0000-4000-a000-000000000001",catalogId,version:0,code:"IMPORT_ONE",name:"Imported one",provenance},
   {...template,id:"10000000-0000-4000-a000-000000000002",catalogId,version:0,code:"IMPORT_TWO",name:"Imported two",provenance},
  ];
  const {service,query}=setup();
  await expect(service.importRecords(actor,"workspace",{catalogId,dryRun:true,records,references:[]})).rejects.toThrow("Duplicate import source key");
  expect(query.mock.calls.some(([sql])=>/^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
 });
 it("validates the entire bulk selection before changing any membership",async()=>{
  const {service,query}=setup();
  query.mockImplementation(async(sql:string)=> {
   if(sql.includes("kind='catalog_group'"))return {rows:[{id:catalogId}],rowCount:1};
   if(sql.includes("id=ANY"))return {rows:[{id:room.id,catalogId,kind:"room",version:2,archived:false,content:{links:[]}}],rowCount:1};
   return {rows:[],rowCount:0};
  });
  await expect(service.organize(actor,"workspace",{catalogId,action:"move",records:[{id:room.id,version:1}]})).rejects.toThrow("changed");
  expect(query.mock.calls.some(([sql])=>/^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
 });
 it("moves a record without changing its identity or other typed links",async()=>{
  const group=CATALOG_STARTER.find(r=>r.kind==="record_group")!;
  const original={...room,version:1,archived:false,content:{description:"Keep this",links:[{relation:"parent",targetId:"parent"}]}};
  let updated=original;
  const {service,query}=setup();
  query.mockImplementation(async(sql:string,args?:unknown[])=>{
   if(sql.includes("kind='catalog_group'"))return {rows:[{id:catalogId}],rowCount:1};
   if(sql.includes("id=ANY"))return {rows:[original],rowCount:1};
   if(sql.startsWith("UPDATE")){updated={...original,content:args?.[2] as typeof original.content,version:2};return {rows:[],rowCount:1};}
   if(sql.includes("AND id=$2"))return {rows:args?.[1]===group.id?[{...group,catalogId,archived:false}]:[updated],rowCount:1};
   return {rows:[],rowCount:0};
  });
  const result=await service.organize(actor,"workspace",{catalogId,action:"move",groupId:group.id,records:[{id:room.id,version:1}]});
  expect(result[0]).toMatchObject({id:room.id,code:room.code,name:room.name,description:"Keep this",version:2,links:[{relation:"parent",targetId:"parent"},{relation:"record_group",targetId:group.id}]});
 });
 it("allows named catalogs without prescribing categories or a record type",()=>{
  expect(()=>validateCatalogRecord({...room,kind:"catalog_group",name:"XYZ",configuration:{},links:[]})).not.toThrow();
 });
 it("rejects links to a different catalog before writing",async()=>{
  const work=CATALOG_STARTER.find(r=>r.kind==="work")!;
  const {service,query}=setup(null,[{id:room.id,kind:"room",archived:false,catalogId:"another-catalog",content:{}}]);
  await expect(service.save(actor,"workspace",{...work,catalogId,links:[{relation:"room",targetId:room.id}]})).rejects.toThrow("same catalog");
  expect(query.mock.calls.some(([sql])=>/^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
 });
 it("requires manage permission and rejects stale updates before mutation",async()=>{
  const {service,query,withPermissions}=setup({...room,version:2,content:{},archived:false});
  await expect(service.save(actor,"workspace",{...room,version:1})).rejects.toThrow("changed");
  expect(withPermissions).toHaveBeenCalledWith(actor,"workspace",["catalog.view","catalog.manage"],expect.any(Function));
  expect(query.mock.calls.some(([sql])=>/^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
 });
 it("requires sourcing permission before a catalog manager can write internal costs",async()=>{
  const process=CATALOG_STARTER.find(r=>r.code==="FP-CUT-PANEL")!;
  const rate={...room,kind:"rate_card" as const,links:[process.links.find(l=>l.relation==="unit")!,{relation:"factory_process",targetId:process.id}],configuration:{amount:50,currency:"AED",effectiveFrom:"2026-09-18",priceType:"cost",costIncludes:"labour_and_machine",taxIncluded:"no"}};
  const {service,query}=setup(null,[],false);
  await expect(service.save(actor,"workspace",rate)).rejects.toThrow("Supplier cost management permission");
  expect(query.mock.calls.some(([sql])=>/^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
 });
 it("rejects references unavailable in the current workspace",async()=>{
  const {service,query}=setup();const material=CATALOG_STARTER.find(r=>r.kind==="material")!;
  await expect(service.save(actor,"workspace",material)).rejects.toThrow("from this workspace");
  expect(query.mock.calls.some(([sql])=>/^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
 });
 it("deduplicates an exact create retry without auditing or updating again",async()=>{
  const {id,version,kind,code,name,catalogId:ownerId,...content}=room;
  const {service,record,query}=setup({id,kind,code,name,catalogId:ownerId,content,version:1,archived:false});
  await expect(service.save(actor,"workspace",plainToInstance(SaveCatalogRecordDto,room))).resolves.toMatchObject({id,version:1});
  expect(record).not.toHaveBeenCalled();expect(query.mock.calls.some(([sql])=>/^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false);
 });
});

it("returns selling prices but redacts internal costs from a catalogue-only response",async()=>{
 const base={catalogId,version:1,archived:false,starterVersion:null,updatedAt:"2026-09-18T00:00:00Z"};
 const rows=[
  {...base,id:"10000000-0000-4000-a000-000000000001",kind:"work",code:"ITEM",name:"Item",content:{description:"",attributes:[{name:"estimated_cost_aed",value:"100"},{name:"selling_price_aed",value:"150"}]}},
  {...base,id:"10000000-0000-4000-a000-000000000002",kind:"rate_card",code:"COST",name:"Cost",content:{configuration:{priceType:"cost",amount:100}}},
  {...base,id:"10000000-0000-4000-a000-000000000003",kind:"rate_card",code:"SELL",name:"Sell",content:{configuration:{priceType:"selling",amount:150}}},
 ];
 const query=vi.fn(async(sql:string)=>{
  if(sql.includes("ORDER BY kind,name"))return {rows,rowCount:rows.length};
  if(sql.includes("default_currency"))return {rows:[{defaultCurrency:"AED"}],rowCount:1};
  if(sql.includes("FROM legal_entities"))return {rows:[{id:"entity",name:"Palm Living",baseCurrency:"AED"}],rowCount:1};
  return {rows:[],rowCount:0};
 });
 const hasPermission=vi.fn(async(_c,_w,_u,permission)=>permission==="catalog.manage");
 const withPermission=vi.fn(async(_a,_w,_p,fn)=>fn({query},{userId:"user"}));
 const service=new CatalogService({withPermission,hasPermission} as unknown as WorkspaceAccessService,{record:vi.fn()} as unknown as CrmEventsService);
 const result=await service.list(actor,"workspace",{catalogId});
 expect(result).toMatchObject({canViewCosts:false,priceVisibility:"selling_only",currency:"AED",legalEntities:[{baseCurrency:"AED"}]});
 expect(result.items.map(item=>item.id)).toEqual([rows[0].id,rows[2].id]);
 expect(result.items[0].attributes).toEqual([{name:"selling_price_aed",value:"150"}]);
});
