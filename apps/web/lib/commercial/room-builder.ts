import type { CatalogSelection, Quote, QuoteLine } from './types';
import type { CommercialCatalogChoice } from '@/components/commercial/catalog-picker';
import { newLine } from './client';
import { quotationItemName } from './presentation';
import { selectUnit, updateMaterials } from './materials';
export const selection = (role: string, record: CommercialCatalogChoice): CatalogSelection => ({role,recordId:record.id,version:record.version,snapshot:record});
export function catalogItem(room: string, record: CommercialCatalogChoice, previous = newLine(room)): QuoteLine {
  let line: QuoteLine = {...previous, room, title:quotationItemName(record.name,room), specification:record.description ?? '', material:'', finish:'', customMaterials:[], catalogLinks:[selection('work',record)]};
  const unit = record.links?.find(l => l.role==='unit')?.snapshot;
  if (unit) line=selectUnit(line,selection('unit',unit));
  return line;
}
export function roomNames(quote: Quote) { return [...new Set([...(quote.rooms??[]).map(r=>r.name),...quote.lines.map(l=>l.room)])]; }
export function applyRoom(quote:Quote, original:string|null, name:string, catalog:CommercialCatalogChoice|null, lines:QuoteLine[]):Quote {
  const old = quote.rooms?.find(r=>r.name===original);
  const room={id:old?.id??crypto.randomUUID(),name,...(catalog?{catalog:selection('room',catalog)}:{})};
  const rooms=roomNames(quote).map(name=>name===original?room:quote.rooms?.find(r=>r.name===name)??{id:crypto.randomUUID(),name});
  if(!original||!roomNames(quote).includes(original))rooms.push(room);
  // Replace in place so configuring a room does not reorder the quotation.
  const start=quote.lines.findIndex(l=>l.room===original);
  const remaining=quote.lines.filter(l=>l.room!==original);
  remaining.splice(start<0?remaining.length:start,0,...lines.map(l=>({...l,room:name})));
  return {...quote,rooms,lines:remaining};
}

export function selectVariant(item:QuoteLine, record:CommercialCatalogChoice|null):QuoteLine {
  if(item.catalogLinks?.find(l=>l.role==='variant')?.recordId===record?.id)return item;
  const cleared=updateMaterials(updateMaterials(item,'material',[]),'finish',[]);
  return {...cleared,catalogLinks:[...(cleared.catalogLinks??[]).filter(c=>c.role!=='variant'),...(record?[selection('variant',record)]:[])]};
}
