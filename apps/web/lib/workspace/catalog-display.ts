import { type CatalogRecord, type CatalogSize } from './catalog';
import { importedPrices } from './catalog-prices';

export const attributeKey=(name:string)=>name.trim().toLowerCase().replace(/\s+/g,'_');
const labels:Record<string,string>={
 min_sqft:'Minimum area (sq.ft)',max_sqft:'Maximum area (sq.ft)',typical_qty:'Typical quantity',is_modular:'Modular item',
 min_distance_km:'Minimum distance (km)',max_distance_km:'Maximum distance (km)',origin_country:'Country of origin',
 sub_category:'Subcategory',representative_name:'Material name',sku_reference:'SKU reference',
 base_price_inr:'Base price (INR)',selling_price_inr:'Selling price (INR)',markup_percent:'Source markup (%)',
 estimated_cost_inr:'Estimated cost (INR)',estimated_timeline_days:'Estimated duration (days)',
 sqft_per_sheet:'Area per sheet (sq.ft)',sqft_per_box:'Area per box (sq.ft)',pieces_per_box:'Pieces per box',
 coverage_sqft_per_ltr:'Coverage per litre (sq.ft)',pack_size_ltr:'Pack size (litres)',
 conversion_to_base:'Source conversion factor',base_unit:'Source base unit',dimension_type:'Source dimension',
 is_water_resistant:'Water resistant',is_termite_resistant:'Termite resistant',is_active:'Active',is_optional:'Optional component',
 is_washable:'Washable',is_modular_item:'Modular item',cct_k:'Colour temperature (K)',cri:'Colour rendering index',
 voc_level:'VOC level',gsm:'Fabric weight (g/m²)',ac_rating:'Abrasion rating',pei_rating:'Wear resistance rating',
};
export function attributeLabel(name:string) {
 const key=attributeKey(name);if(labels[key])return labels[key];
 const words=name.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ').trim();
 return (words.charAt(0).toUpperCase()+words.slice(1)).replace(/\b(mm|cm|kg|ltr|sqft|sqm|inr|aed|usd|id|sku|bom|bwp|mdf|wpc|ip)\b/gi,word=>({inr:'INR',aed:'AED',usd:'USD',id:'ID',sku:'SKU',bom:'BoM',bwp:'BWP',mdf:'MDF',wpc:'WPC',ip:'IP',sqft:'sq.ft',sqm:'sq.m',ltr:'litre'}[word.toLowerCase()]??word.toLowerCase()));
}
export function attributeValue(name:string,value:string) {
 if(value==='true')return 'Yes';if(value==='false')return 'No';
 const currency=attributeKey(name).match(/_(inr|aed|usd)$/)?.[1].toUpperCase();
 if(currency&&/^\d+(?:\.\d+)?$/.test(value))return new Intl.NumberFormat('en-IN',{style:'currency',currency,maximumFractionDigits:2}).format(Number(value));
 if(/^[+-]?\d+(?:\.\d+)?$/.test(value)&&!/(?:^|_)(?:id|code)$/.test(attributeKey(name)))return new Intl.NumberFormat('en-IN',{maximumFractionDigits:6}).format(Number(value));
 return value;
}
export function displayAttributes(record:CatalogRecord,items:CatalogRecord[]) {
 const sourcePriceKeys=new Set(importedPrices(record).map(p=>p.key));
 const names=new Set([record.name,...record.links.map(l=>items.find(r=>r.id===l.targetId)?.name??'')]);
 const specifications:typeof record.attributes=[],importDetails:typeof record.attributes=[];
 for(const a of record.attributes){
  const key=attributeKey(a.name);
  const duplicateName=key.endsWith('_name')&&([...names].includes(a.value)||record.name.includes(a.value));
  const duplicateDescription=key==='description'&&a.value===record.description;
  const metadata=key.startsWith('source_')||key.endsWith('_id')||duplicateName||duplicateDescription||(key==='unit'&&record.links.some(l=>l.relation==='unit'));
  if(metadata)importDetails.push(a);else if(!sourcePriceKeys.has(a.name))specifications.push(a);
 }
 return {specifications,importDetails};
}
export function sizeDetails(size:CatalogSize) {
 const result:Array<{label:string;value:string}>=[];
 for(const [key,label] of [['lengthMm','Length'],['widthMm','Width'],['thicknessMm','Thickness'],['diameterMm','Diameter']] as const){
  if(size[key]!=null)result.push({label,value:`${new Intl.NumberFormat('en-IN',{maximumFractionDigits:3}).format(size[key])} mm`});
 }
 if(size.packQuantity!=null)result.push({label:'Pack contents',value:`${size.packQuantity} ${size.packUnit??''}`.trim()});
 return result;
}
