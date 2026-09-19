import structure from "../../../../packages/contracts/catalog-structure.json";
export type CatalogKind = keyof typeof structure;
export type CatalogField = {key:string;label:string;type:string;options?:string[];min?:number;max?:number};
export type CatalogDefinition = {label:string;singular:string;group:string;description:string;fields:CatalogField[];links:{relation:string;label:string;multiple:boolean;required:boolean}[]};
export const catalogStructure:Record<CatalogKind,CatalogDefinition> = structure;
export const catalogSections = (Object.entries(catalogStructure) as [CatalogKind,CatalogDefinition][]).map(([kind,definition])=>({kind,...definition}));
export type CatalogSize = {label:string;lengthMm?:number;widthMm?:number;thicknessMm?:number;diameterMm?:number;packQuantity?:number;packUnit?:string;sourceUrl?:string;note?:string};
export type CatalogRecord = {
 catalogId?:string;id:string;version:number;kind:CatalogKind;code:string;name:string;description:string;market:string;aliases:string[];
 recordType?:"item"|"variant"|"assembly"|"assembly_component"|"catalog_record";
 attributes:{name:string;value:string}[];sizes:CatalogSize[];sources:{title:string;url:string;checkedOn:string}[];
 links:{relation:string;targetId:string}[];specificationStatus:string;dimension:string;baseFactor?:number;
 archived:boolean;starterVersion:string|null;updatedAt:string;
 primaryAsset?:{id:string;recordId:string;name:string;mimeType:string;hasPreview:boolean}|null;
 configuration?:Record<string,string|number>;
};
export type CatalogPageData = {workspaceId:string;overview?:boolean;componentCounts?:{id:string;count:number}[];currency?:string;legalEntities?:{id:string;name:string;baseCurrency:string}[];canManage:boolean;canViewCosts?:boolean;priceVisibility?:"selling_only"|"selling_and_cost";items:CatalogRecord[];starter:{version:string;count:number;market:string};error?:string};
export const statusLabels:Record<string,string> = {reference:"Reference",needs_specification:"To specify",workspace_verified:"Workspace verified"};
export function filterCatalog(items:CatalogRecord[],kind:CatalogKind,search:string,category:string,status:string,archived:boolean) {
 const q=search.trim().toLowerCase(); const names=new Map(items.map(r=>[r.id,r.name]));
 return items.filter(r=>r.kind===kind&&r.archived===archived&&(!status||r.specificationStatus===status)&&(!category||r.links.some(l=>l.targetId===category)||(kind==="work"&&!r.links.some(l=>l.relation==="room")))&&(!q||[r.name,r.code,r.description,...r.aliases,...r.sizes.map(s=>s.label),...r.links.map(l=>names.get(l.targetId)),...r.attributes.flatMap(a=>[a.name,a.value]),...Object.values(r.configuration??{})].join(" ").toLowerCase().includes(q))).sort((a,b)=>a.name.localeCompare(b.name));
}
export function blankCatalogRecord(kind:CatalogKind):CatalogRecord { return {id:crypto.randomUUID(),version:0,kind,code:"",name:"",description:"",market:"CUSTOM",aliases:[],attributes:[],sizes:[],sources:[],links:[],specificationStatus:"needs_specification",dimension:kind==="unit"?"pack":"none",archived:false,starterVersion:null,updatedAt:""}; }
export function savePayload(record:CatalogRecord) { const {archived:_a,starterVersion:_s,updatedAt:_u,primaryAsset:_p,...input}=record; return input; }
export function safeSourceUrl(url:string) { try {const u=new URL(url);return ["http:","https:"].includes(u.protocol)?u.href:undefined;}catch{return undefined;} }
