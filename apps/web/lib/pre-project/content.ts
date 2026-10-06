import type { NoteDocument } from '../crm/note-document';
import { tKey, type MessageKey, type Translate } from '../i18n/keys';
import { readWithin } from '../workspace/read-within';
export type CatalogChoice={links?:Array<{role:string;recordId:string;snapshot:CatalogChoice}>;id:string;name:string;code:string;kind:string;version:number;catalogId:string;catalogName?:string;description?:string;attributes?:Array<{name:string;value:string}>;configuration?:Record<string,string|number>;commerce?:{pricingMode:'unpriced'|'fixed'|'on_request'};primaryAsset?:{id:string;recordId:string;name:string;mimeType:string;hasPreview:boolean}};
export type ScopeLink={role:string;recordId:string;snapshot:CatalogChoice};
export type CaseRoom={id:string;name:string;version:number;catalogRecordId?:string|null;catalogSnapshot?:CatalogChoice|null};
export type CaseAsset={id:string;name:string;mimeType:string;byteSize:number;hasPreview:boolean};
export const briefFields={goals:tKey('Goals & requirements'),propertyType:tKey('Property type'),location:tKey('Site location'),area:tKey('Property area'),budget:tKey('Budget notes / range'),timeline:tKey('Target timeline'),decisionMakers:tKey('Decision makers'),people:tKey('Who will use the space?'),preferences:tKey('Style & material preferences'),retainedItems:tKey('Items to retain'),exclusions:tKey('Known exclusions'),constraints:tKey('Site constraints')};
export type CaseBrief=Record<keyof typeof briefFields,string>&{version:number;updatedAt?:string|null;currencyCode:string;budgetAmount:string};
export type ScopeEntry={document?:NoteDocument|null;pinned?:boolean;scopeNote?:string;specification?:ItemSpecification|null;id:string;version:number;kind:'requirement'|'note'|'inspiration'|'file';title:string;roomId:string|null;roomName?:string|null;note:string;category:string;priority:string;scopeStatus:string;reviewStatus:string;quantity:number|null;unit:string;referenceUrl:string;avoid:string;source:string;assets:CaseAsset[];catalogLinks:ScopeLink[];archivedAt:string|null;updatedAt?:string;createdByName?:string;/** Added by someone on the client's side, in the portal. */fromClient?:boolean;requirementIds?:string[];board?:MoodboardPlacement|null};
export type MoodboardPlacement={x:number;y:number;width:number;z:number;sentiment:'love'|'avoid'};
export type DiscoveryCoverage={roomCount:number;coveredRoomCount:number;uncoveredRooms:Array<{id:string;name:string}>;wholeProjectRequirementCount:number;undecidedItemIds:string[];clientDraftItemIds:string[];missingMeasurementItemIds:string[];verifiedMeasurementItemIds:string[]};
export type CaseContent={workspaceId:string;caseId:string;brief:CaseBrief;rooms:CaseRoom[];entries:ScopeEntry[];coverage:DiscoveryCoverage;canEdit:boolean;caseStatus:string;fromCrm:boolean;crmContext:{description:string|null;opportunityAmount:string|null;currencyCode:string|null}};
export type DesignVersion={reviewerId?:string|null;createdBy?:string;includedClientRounds?:number|null;clientReviewExpiresAt?:string|null;id:string;number:number;note:string;status:string;asset:CaseAsset;createdAt:string;createdByName:string};
export type DesignActivity={reviewerId?:string|null;decisionSource?:string|null;decisionAt?:string|null;id:string;versionId:string;action:string;note:string;decisionBy:string;createdAt:string;createdByName:string};
export type CaseDesign={stage?:string|null;threads?:DesignThread[];clientRoundsUsed?:number;folderId?:string|null;id:string;version:number;title:string;documentType:string;description:string;roomId:string|null;roomName?:string|null;scopeEntryId:string|null;scopeTitle?:string|null;scopeArchived?:boolean;archivedAt:string|null;updatedAt:string;versions:DesignVersion[];activity:DesignActivity[]};
export const documentTypes=[
 tKey('Concept / mood board'),
 tKey('Material / finish board'),
 tKey('Space plan / furniture layout'),
 tKey('2D floor plan'),
 tKey('Demolition / partition plan'),
 tKey('Reflected ceiling plan'),
 tKey('Lighting plan'),
 tKey('Power / data plan'),
 tKey('Flooring / finish plan'),
 tKey('Furniture / FF&E plan'),
 tKey('Elevation'),
 tKey('Section'),
 tKey('Joinery / millwork detail'),
 tKey('Construction detail'),
 tKey('3D model'),
 tKey('3D render / visualization'),
 tKey('Material / finish specification'),
 tKey('Door / hardware schedule'),
 tKey('Fixture / equipment schedule'),
 tKey('Signage / wayfinding'),
 tKey('Code / egress plan'),
 tKey('MEP coordination'),
 tKey('As-built / record drawing'),
 tKey('Presentation / client approval'),
 tKey('Other'),
] as const;
export const scopeLabels:Record<string,MessageKey>={included:tKey('Included'),excluded:tKey('Not included'),later:tKey('Later phase'),not_possible:tKey('Not possible'),undecided:tKey('To decide'),must_have:tKey('Need — essential'),preferred:tKey('Want — preferred'),optional:tKey('Optional — nice to have'),captured:tKey('Client draft'),reviewed:tKey('Consultant confirmed'),clarification:tKey('Needs clarification'),requirement:tKey('Scope item'),note:tKey('Note'),inspiration:tKey('Inspiration'),file:tKey('Reference file')};
/** A scope, priority or review label in the person's language; unknown values show as sent. */
export function scopeLabel(t:Translate,value:string){const label=scopeLabels[value];return label?t(label):value;}
export function deriveDiscoveryCoverage(rooms:CaseRoom[],entries:ScopeEntry[],verifiedMeasurementItemIds:string[]=[]):DiscoveryCoverage {
 const active=entries.filter(entry=>entry.kind==='requirement'&&!entry.archivedAt);const covered=new Set(active.flatMap(entry=>entry.roomId?[entry.roomId]:[]));const verified=new Set(verifiedMeasurementItemIds);const included=active.filter(entry=>entry.scopeStatus==='included');
 return {roomCount:rooms.length,coveredRoomCount:rooms.filter(room=>covered.has(room.id)).length,uncoveredRooms:rooms.filter(room=>!covered.has(room.id)).map(({id,name})=>({id,name})),wholeProjectRequirementCount:active.filter(entry=>!entry.roomId).length,undecidedItemIds:active.filter(entry=>entry.scopeStatus==='undecided').map(entry=>entry.id),clientDraftItemIds:active.filter(entry=>entry.source==='client'&&entry.reviewStatus!=='reviewed').map(entry=>entry.id),missingMeasurementItemIds:included.filter(entry=>!verified.has(entry.id)).map(entry=>entry.id),verifiedMeasurementItemIds:included.filter(entry=>verified.has(entry.id)).map(entry=>entry.id)};
}
export const designStatus:Record<string,MessageKey>={draft:tKey('Draft'),internal_review:tKey('Internal review'),internal_approved:tKey('Internally approved'),client_review:tKey('Awaiting client decision'),approved:tKey('Client approved'),changes_requested:tKey('Changes requested'),rejected:tKey('Rejected'),expired:tKey('Review expired'),superseded:tKey('Superseded'),no_file:tKey('File needed')};
/** A design status label in the person's language; unknown values show as sent. */
export function designStatusLabel(t:Translate,value:string){const label=designStatus[value];return label?t(label):value;}
export function blankEntry(roomId:string|null=null):ScopeEntry {return {id:crypto.randomUUID(),version:0,kind:'requirement',title:'',roomId,note:'',category:'General',priority:'preferred',scopeStatus:'undecided',reviewStatus:'captured',quantity:null,unit:'nos',referenceUrl:'',avoid:'',source:'team',assets:[],catalogLinks:[],archivedAt:null};}
export function entryPayload(entry:ScopeEntry) {const {id,version,kind,title,roomId,note,category,priority,scopeStatus,reviewStatus,quantity,unit,referenceUrl,avoid,source}=entry;return {...(entry.document?{document:entry.document}:{}),...(entry.scopeNote!==undefined?{scopeNote:entry.scopeNote}:{}),...(entry.pinned!==undefined?{pinned:entry.pinned}:{}),id,version,kind,title,roomId,note,category,priority,scopeStatus,reviewStatus,quantity,unit,referenceUrl,avoid,source,assetIds:entry.assets.map(a=>a.id),catalogLinks:entry.catalogLinks.map(({role,recordId})=>({role,recordId})),...(entry.requirementIds!==undefined&&entry.kind==='inspiration'?{requirementIds:entry.requirementIds}:{})};}
export function designPayload(d:CaseDesign) {return {id:d.id,version:d.version,title:d.title,folderId:d.folderId??null,documentType:d.documentType,description:d.description,roomId:d.roomId,scopeEntryId:d.scopeEntryId,includedClientRounds:d.versions[0]?.includedClientRounds??null,archived:Boolean(d.archivedAt)};}
export function designRoundLabel(used:number,included:number|null|undefined) {if(included==null)return 'Not configured';return `${used} of ${included} used${used>included?' · over allowance':''}`;}
export function caseApi(workspaceId:string,caseId:string,path:string) {return `/api/workspace/pre-projects/${caseId}/${path}${path.includes('?')?'&':'?'}workspaceId=${workspaceId}`;}
export async function caseRequest<T>(workspaceId:string,caseId:string,path:string,method='GET',input?:unknown):Promise<T> {
 const run=async()=>{
  const response=await fetch(caseApi(workspaceId,caseId,path),{method,headers:input instanceof FormData?undefined:{'content-type':'application/json'},body:input===undefined?undefined:input instanceof FormData?input:JSON.stringify(input)});
  const payload=await response.json().catch(()=>null);if(!response.ok)throw new Error(Array.isArray(payload?.message)?payload.message.join('. '):payload?.message??tKey('Could not save. Your changes are still available.'));return payload;
 };
 // A read that never answers fails in time, so the screen shows its error and Retry rather than a skeleton forever.
 return method==='GET'?readWithin(run()):run();
}
export function formatCaseMoney(value:string|null|undefined,currency:string,locale:string,t:Translate) {if(value==null||value==='')return t('Not set');const n=Number(value);if(!Number.isFinite(n))return t('Not set');try{return new Intl.NumberFormat(locale,{style:'currency',currency,currencyDisplay:'code'}).format(n);}catch{return `${currency} ${value}`;}}
export function parseScopePaste(text:string,roomId:string|null):ScopeEntry[] {
 const lines=text.trim().split(/\r?\n/).filter(l=>l.trim());if(lines.length>100)throw new Error('Paste up to 100 rows at a time.');
 return lines.map((line,index)=>{const cells=line.split('\t');if(cells.length>4)throw new Error(`Row ${index+1}: use Item, Quantity, Unit and Notes columns.`);const [name,quantity='',unit='nos',note='']=cells.map(s=>s.trim());const amount=quantity===''?null:Number(quantity);
 if(!name||name.length>240)throw new Error(`Row ${index+1}: enter an item name up to 240 characters.`);
 if(amount!==null&&(!Number.isFinite(amount)||amount<=0||amount>1e9||!/^\d+(\.\d{1,4})?$/.test(quantity)))throw new Error(`Row ${index+1}: enter a positive quantity with up to 4 decimals.`);
 if(unit.length>20||note.length>6000)throw new Error(`Row ${index+1}: unit or notes are too long.`);
 return {...blankEntry(roomId),title:name,quantity:amount,unit:unit||'nos',note};});
}
export type ItemMaterial={id:string;application:string;materialId:string|null;brandId:string|null;finishId:string|null;productName:string;productCode:string;finishCode:string;stockSize:string;status:string;selectedBy:string;selectedAt:string|null;evidence:string;assetIds:string[];assets?:CaseAsset[];catalog?:Partial<Record<string,CatalogChoice>>;recordingSource?:string};
export type ItemDimension={id:string;name:string;unit:string;basis:string;approximate:number|null;measured:number|null;source:string;evidence:string;approximateMetres?:number|null;measuredMetres?:number|null;verification?:string;siteSurvey?:{id:string;version:number;status:string;verifiedAt?:string|null;verifiedBy?:string|null}};
export type ItemDesignRef={versionId:string;usage:string;sheet:string;currentStatus?:string;snapshot?:{id:string;designId:string;number:number;status:string;title:string;documentType:string;fileName:string;assetId:string}};
export type ItemSpecification={requirement?:{id:string;version:number;title:string;note:string;quantity:string|null;unit:string;roomId:string|null;roomName:string|null;scopeStatus:string;catalogLinks:ScopeLink[]};version:number;refinedRequirement:string;construction:string;inclusions:string;exclusions:string;assumptions:string;materials:ItemMaterial[];dimensions:ItemDimension[];designRefs:ItemDesignRef[];createdAt?:string;recordedBy?:string};
export function blankSpecification():ItemSpecification{return {version:0,refinedRequirement:'',construction:'',inclusions:'',exclusions:'',assumptions:'',materials:[],dimensions:[],designRefs:[]};}
export function specificationPayload(s:ItemSpecification) {return {version:s.version,refinedRequirement:s.refinedRequirement,construction:s.construction,inclusions:s.inclusions,exclusions:s.exclusions,assumptions:s.assumptions,materials:s.materials.map(m=>({id:m.id,application:m.application,materialId:m.materialId,brandId:m.brandId,finishId:m.finishId,productName:m.productName,productCode:m.productCode,finishCode:m.finishCode,stockSize:m.stockSize,status:m.status,selectedBy:m.selectedBy,selectedAt:m.selectedAt,evidence:m.evidence,assetIds:m.assetIds})),dimensions:s.dimensions.map(d=>({id:d.id,name:d.name,unit:d.unit,basis:d.basis,approximate:d.approximate,measured:d.measured,source:d.source,evidence:d.evidence})),designRefs:s.designRefs.map(d=>({versionId:d.versionId,usage:d.usage,sheet:d.sheet}))};}

export function updateItemMaterial(current:ItemMaterial,patch:Partial<ItemMaterial>):ItemMaterial {
 const changed=(["application","materialId","brandId","finishId","productName","productCode","finishCode","stockSize"] as const).some(key=>key in patch&&patch[key]!==current[key]);
 return {...current,...patch,...(current.status==='selected'&&changed?{status:'proposed',selectedBy:'',selectedAt:null,evidence:'',assetIds:[],assets:[]}:{} )};
}

export function chooseItemMaterial(current:ItemMaterial,value:CatalogChoice|null):ItemMaterial {
 if(!value)return updateItemMaterial(current,{materialId:null,catalog:{...current.catalog,material:undefined} as ItemMaterial['catalog']});
 if(value.id===current.materialId)return current;
 const single=(role:string)=>{const links=value.links?.filter(link=>link.role===role)??[];return links.length===1?links[0].snapshot:undefined;};
 const brand=single('brand'),finish=single('finish');
 return updateItemMaterial(current,{materialId:value.id,brandId:brand?.id??null,finishId:finish?.id??null,productName:value.name,productCode:String(value.configuration?.manufacturerCode??''),finishCode:String(value.configuration?.finishCode??''),stockSize:String(value.configuration?.format??''),catalog:{material:value,...(brand?{brand}:{}),...(finish?{finish}:{})}});
}

export type DesignFolder={reviewerId?:string|null;approvedVersions?:string[]|null;approvedAt?:string|null;id:string;name:string;description:string;roomId:string|null;roomName?:string|null;scopeEntryId:string|null;scopeTitle?:string|null;version:number};
export type DesignOptions={members?:Array<{id:string;name:string}>;folders:DesignFolder[];reviewers:Array<{id:string;name:string}>;actorId:string;canReview:boolean;canRecordClient:boolean;portal?:{enabled:boolean;slug:string|null;hasApprover:boolean}};

export type DesignThread={anchor?:{x:number;y:number}|null;mentions?:string[];id:string;versionId:string;title:string;blocking:boolean;status:string;version:number;createdBy:string;createdByName:string;/** The audience switch: the client sees it in their portal. */clientVisible?:boolean;/** Started by the client in their portal. */fromClient?:boolean;createdAt:string;resolvedAt:string|null;resolvedByName:string|null;messages:Array<{id:string;body:string;createdBy:string;createdByName:string;createdAt:string;fromClient?:boolean}>};

/** Saves a project room (new or renamed); rooms come from the catalog or are typed as custom ones. */
export function saveCaseRoom(workspaceId:string,caseId:string,room:CaseRoom):Promise<CaseRoom>{return caseRequest<CaseRoom>(workspaceId,caseId,'rooms','PUT',{id:room.id,version:room.version,name:room.name,catalogRecordId:room.catalogRecordId??null});}
