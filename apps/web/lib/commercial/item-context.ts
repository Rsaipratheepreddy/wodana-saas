import { tKey } from '@/lib/i18n/keys';
import type { AssistCatalogRecord, AssistLink } from './quotation-assist';
import type { CommercialCatalogChoice } from '@/components/commercial/catalog-picker';
export type ReferencePrice={label:string;amount:number;currency:string;basis:string};
export type RecipeMaterial={id:string;name:string;specification:string;quantity:string;choices:CommercialCatalogChoice[];prices:ReferencePrice[]};
export type ItemContext={materials:RecipeMaterial[];prices:ReferencePrice[]};
export type ContextRecord=AssistCatalogRecord&{content?:AssistCatalogRecord['content']&{attributes?:{name:string;value:string}[]}};
export function masterCatalogId(records:ContextRecord[]):string|undefined { const catalogs=records.filter(r=>r.kind==='catalog_group'); return (catalogs.find(r=>r.content?.attributes?.some(a=>a.name==='Default catalog'&&a.value==='true'))??catalogs[0])?.id; }
export function itemContext(records:ContextRecord[],links:AssistLink[],workId:string,variantId?:string):ItemContext {
  const index=new Map(records.map(r=>[r.id,r]));
  const outgoing=new Map<string,AssistLink[]>();
  for(const link of links){const rows=outgoing.get(link.recordId);if(rows)rows.push(link);else outgoing.set(link.recordId,[link]);}
  const targets=(id:string,roles:string[])=>(outgoing.get(id)??[]).filter(l=>roles.includes(l.relation)).map(l=>index.get(l.targetId)).filter((r):r is ContextRecord=>!!r);
  const materialKinds=['material','sku','hardware','consumable','finish'];
  const belongs=(id:string,role:string,target:string)=>(outgoing.get(id)??[]).some(l=>l.relation===role&&l.targetId===target);
  const work=index.get(workId),variant=variantId?index.get(variantId):undefined;
  if(work?.kind!=='work'||(variantId&&(variant?.kind!=='variant'||!belongs(variantId,'work',workId))))return {materials:[],prices:[]};
  const templates=records.filter(r=>r.kind==='construction'&&r.content?.configuration?.recordRole==='template'&&belongs(r.id,'work',workId));
  const components=records.filter(r=>r.kind==='construction'&&r.content?.configuration?.recordRole==='component'&&(belongs(r.id,'work',workId)||templates.some(t=>belongs(r.id,'parent',t.id)))&&(!targets(r.id,['variant']).length||!!variantId&&belongs(r.id,'variant',variantId)));
  const covered=new Set(components.flatMap(r=>targets(r.id,materialKinds).map(m=>m.id)));
  const direct=[...targets(workId,materialKinds),...(variantId?targets(variantId,materialKinds):[])].filter(r=>!covered.has(r.id));
  const price=(r:ContextRecord):ReferencePrice[]=>{
    const attrs=r.content?.attributes??[];const unit=attrs.find(a=>a.name.toLowerCase()==='unit')?.value??targets(r.id,['unit'])[0]?.name??tKey('Unit not specified');
    const imported=attrs.flatMap(a=>{const key=a.name.toLowerCase().replace(/\s+/g,'_');const match=key.match(/^((?:.*price.*|estimated_cost))_(inr|aed|usd)$/);const n=Number(a.value.replace(/,/g,''));if(!match||!Number.isFinite(n)||n<0||!a.value.trim())return [];return [{label:`Source ${match[1].replaceAll('_',' ')}`,amount:n,currency:match[2].toUpperCase(),basis:key.match(/_per_(.+?)_(?:inr|aed|usd)$/)?.[1]?.replaceAll('_',' ')??unit}];});
    const prices=records.filter(p=>p.kind==='rate_card'&&belongs(p.id,r.kind,r.id)).flatMap(p=>{const c=p.content?.configuration,amount=Number(c?.amount),currency=String(c?.currency??'');if(!c||!Number.isFinite(amount)||!/^[A-Z]{3}$/.test(currency))return [];return [{label:String(c.priceType??tKey('Reference price')),amount,currency,basis:targets(p.id,['unit'])[0]?.name??tKey('Unit not specified')}];});
    return [...imported,...prices];
  };
  const choice=(r:ContextRecord):CommercialCatalogChoice=>({id:r.id,name:r.name,code:r.code,kind:r.kind,version:r.version,catalogId:r.catalogId,catalogName:r.catalogName,configuration:r.content?.configuration});
  const rows=[...components,...new Map(direct.map(r=>[r.id,r])).values()];
  return {materials:rows.map(r=>{const materials=materialKinds.includes(r.kind)?[r]:targets(r.id,materialKinds);return {id:r.id,name:r.name,specification:String(r.content?.configuration?.selectionSource??r.content?.description??''),quantity:String(r.content?.configuration?.quantity??r.content?.attributes?.find(a=>a.name==='quantity')?.value??''),choices:materials.map(choice),prices:materials.flatMap(price)};}),prices:[...price(work),...(variant?price(variant):[])]};
}
