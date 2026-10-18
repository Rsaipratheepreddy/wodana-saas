import { catalogStructure, type CatalogRecord } from "./catalog";
export const priceableKinds = catalogStructure.rate_card.links.map(l=>l.relation).filter(r=>!["unit","rate_zone","record_group"].includes(r));
export function recordPrices(record:CatalogRecord,items:CatalogRecord[]) {
  return items.filter(r=>r.kind==="rate_card"&&!r.archived&&r.catalogId===record.catalogId&&(r.id===record.id||r.links.some(l=>l.relation===record.kind&&l.targetId===record.id)));
}
// Display source amounts without making them dated, approved price-book entries.
// Currency must be explicit in the source column; arbitrary numbers are not prices.
export type ImportedPrice={key:string;label:string;amount:number;currency:string;formatted:string};
export function importedPrices(record:CatalogRecord):ImportedPrice[] {
  return record.attributes.flatMap(attribute=>{
    const key=attribute.name.trim().toLowerCase().replace(/\s+/g,'_');
    const match=key.match(/^((?:.*price.*|estimated_cost))_(inr|aed|usd)$/);
    if(!match||!/^\d+(?:\.\d+)?$/.test(attribute.value.trim()))return [];
    const amount=Number(attribute.value),currency=match[2].toUpperCase();
    if(!Number.isFinite(amount))return [];
    const label=match[1].replaceAll('_',' ');
    return [{key:attribute.name,label:label.charAt(0).toUpperCase()+label.slice(1),amount,currency,
      formatted:new Intl.NumberFormat('en-IN',{style:'currency',currency,maximumFractionDigits:2}).format(amount)}];
  });
}
export function sourcePriceBasis(price:ImportedPrice,record:CatalogRecord) {
 const per=price.key.toLowerCase().match(/_per_(.+?)_(?:inr|aed|usd)$/)?.[1];
 const sourceUnit=record.attributes.find(a=>a.name.toLowerCase()==='unit')?.value??(record.kind==='variant'?'item':undefined);
 const unit=per&&per!=='unit'?per:sourceUnit;
 return unit?`Per ${{sqft:'sq.ft',sqm:'sq.m',ltr:'litre',pipe:'pipe'}[unit]??unit.replaceAll('_',' ')}`:'Select price unit';
}
export function draftFromImportedPrice(record:CatalogRecord,price:ImportedPrice,items:CatalogRecord[],blank:CatalogRecord):CatalogRecord {
 const per=price.key.toLowerCase().match(/_per_(.+?)_(?:inr|aed|usd)$/)?.[1];
 const sourceUnit=record.kind==='variant'&&price.key.toLowerCase()==='estimated_cost_inr'?'piece':record.attributes.find(a=>a.name.toLowerCase()==='unit')?.value;
 const currentId=record.links.find(l=>l.relation==='unit')?.targetId;
 const units=items.filter(r=>r.kind==='unit'&&!r.archived&&r.catalogId===record.catalogId);
 const canonical:Record<string,string[]>={sqft:['sqft','sq.ft','square foot'],sqm:['sqm','sq.m','square metre','square meter'],ltr:['ltr','litre','liter','l'],sheet:['sheet','sheet (product-specific)'],box:['box','box (product-specific)'],kg:['kg','kilogram'],meter:['meter','metre','m'],piece:['piece','each']};
 const sourceBasis=(!per||per==='unit'?sourceUnit:per)?.trim().toLowerCase();
 const aliases=sourceBasis?Object.values(canonical).find(names=>names.includes(sourceBasis))??[sourceBasis]:[];
 const matches=units.filter(u=>[u.name,...u.aliases].some(s=>aliases.includes(s.toLowerCase())));
 // Resolve the original source basis, even if the tenant has since changed the record's unit.
 // Per-pack/pipe amounts must never inherit a per-litre/metre unit.
 const unitId=!sourceBasis?currentId:matches.some(u=>u.id===currentId)?currentId:matches.length===1?matches[0].id:undefined;
 const priceType=price.key.toLowerCase().startsWith('selling_')?'selling':price.key.toLowerCase().startsWith('purchase_')?'purchase':price.key.toLowerCase().startsWith('base_')||price.key.toLowerCase().startsWith('cost_')||price.key.toLowerCase().startsWith('estimated_cost_')?'cost':undefined;
 return {...blank,links:[...blank.links.filter(l=>l.relation!=='unit'),...(unitId?[{relation:'unit',targetId:unitId}]:[])],configuration:{amount:price.amount,currency:price.currency,...(priceType?{priceType}:{}),reference:`Imported ${price.key}${sourceUnit?` · source unit ${sourceUnit}`:''}`}};
}
