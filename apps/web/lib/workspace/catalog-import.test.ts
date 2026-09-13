import {describe,expect,it} from 'vitest';
import {blankCatalogRecord,type CatalogRecord} from './catalog';
import {parseDelimitedCatalog,prepareCatalogImport,suggestImportMapping,guessImportHeader,type ImportOptions} from './catalog-import';
const options:ImportOptions={catalogId:'catalog',kind:'material',groupId:'',createReferences:false,priceDefaults:{}};
const existing=(kind:CatalogRecord['kind'],name:string,id:string)=>({...blankCatalogRecord(kind),catalogId:'catalog',id,name,code:id.toUpperCase(),version:1});
const unit={...existing('unit','Square foot','sqft'),dimension:'area',baseFactor:.09290304,aliases:['sq.ft']};
const brand=existing('brand','Century','century');
function prepare(text:string,opts:Partial<ImportOptions>={},items:CatalogRecord[]=[unit,brand]){
 const rows=parseDelimitedCatalog(text),kind=opts.kind??options.kind;
 return prepareCatalogImport({name:'Source',rows},0,suggestImportMapping(rows[0],kind),items,{...options,...opts});
}
describe('catalog import preparation',()=>{
 it('maps product identity independently of preceding brand columns',()=>{
  expect(suggestImportMapping(['master_id','brand_name','representative_name','unit'],'material')).toEqual(['code','link:brand','name','link:unit']);
  expect(suggestImportMapping(['brand_id','brand_name','product_name','hardware_id'],'hardware')).toEqual(['link:brand','attribute:1','name','code']);
  expect(suggestImportMapping(['element_id','room_id','room_name','element_name'],'work')).toEqual(['code','link:room','attribute:2','name']);
  expect(suggestImportMapping(['brand_id','brand_name'],'brand')).toEqual(['code','name']);
 });
 it('parses Excel paste and CSV quoted separators/newlines without executing content',()=>{
  expect(parseDelimitedCatalog('Name,Notes\r\n"Board, white","Line 1\nLine 2"')).toEqual([['Name','Notes'],['Board, white','Line 1\nLine 2']]);
  expect(parseDelimitedCatalog('Name\tNotes\nPanel\t=1+1')[1][1]).toBe('=1+1');
  expect(()=>parseDelimitedCatalog('Name\n"unfinished')).toThrow('unfinished');
 });
 it('finds header rows without treating a title as data',()=>{
  expect(guessImportHeader([['Material catalog'],[],['MaterialName','Unit','Brand'],['Plywood','sq.ft','Century']],'material')).toBe(2);
 });
 it('preserves extra specifications and links known units/brands by exact aliases',()=>{
  const plan=prepare('Name,Unit,Brand,Grade,Group\nPlywood,sq.ft,Century,BWP,Our materials');
  expect(plan.errors).toEqual([]);const material=plan.records.find(r=>r.kind==='material')!;
  expect(material.attributes).toEqual([{name:'Grade',value:'BWP'}]);
  expect(material.links).toEqual(expect.arrayContaining([{relation:'unit',targetId:'sqft'},{relation:'brand',targetId:'century'}]));
  expect(plan.records.filter(r=>r.kind==='record_group')).toHaveLength(1);
 });
 it('blocks unknown units even when simple reference creation is enabled',()=>{
  const plan=prepare('Name,Unit,Brand\nPlywood,mystery area,My brand',{createReferences:true});
  expect(plan.errors.join(' ')).toContain('mystery area');
  expect(plan.records.some(r=>r.kind==='unit')).toBe(false);
 });
 it('shows new name-only references in the review when opted in',()=>{
  const plan=prepare('Name,Unit,Brand\nPlywood,Square foot,My brand',{createReferences:true});
  expect(plan.errors).toEqual([]);expect(plan.records.some(r=>r.kind==='brand'&&r.name==='My brand')).toBe(true);
  expect(plan.rows.some(r=>r.name==='My brand'&&r.sourceRow===0)).toBe(true);
 });
 it('keeps existing records unchanged and rejects duplicates within the source',()=>{
  const old=existing('material','Plywood','plywood');const before=structuredClone(old);
  const plan=prepare('Name,Description\nPlywood,Changed description',{},[old]);
  expect(plan.records).toHaveLength(0);expect(plan.skipped).toBe(1);expect(old).toEqual(before);
  expect(prepare('Name\nPlywood\nPlywood').errors.join(' ')).toContain('Duplicate');
 });
 it('requires explicit unit dimensions and factors rather than inferring from names',()=>{
  expect(prepare('Name,Dimension,BaseFactor\nMy foot,length,0.3048',{kind:'unit'}).records[0]).toMatchObject({dimension:'length',baseFactor:.3048});
  expect(prepare('Name\nSquare foot',{kind:'unit'},[]).errors.join(' ')).toContain('measurement type');
  expect(prepare('Name,Dimension,BaseFactor\nSheet,pack,32',{kind:'unit'}).errors.join(' ')).toContain('universal');
 });
 it('resolves forward parent references without relying on worksheet order',()=>{
  const plan=prepare('Name,Parent\nGuest bedroom,Bedroom\nBedroom,',{kind:'room'},[]);
  expect(plan.errors).toEqual([]);const child=plan.records.find(r=>r.name==='Guest bedroom')!,parent=plan.records.find(r=>r.name==='Bedroom')!;
  expect(child.links).toContainEqual({relation:'parent',targetId:parent.id});
 });
 it('creates a separately linked price only with explicit inclusions and units',()=>{
  const text='Name,Unit,Price\nPlywood,sq.ft,150';
  expect(prepare(text).errors.join(' ')).toContain('price defaults');
  const plan=prepare(text,{priceDefaults:{priceType:'cost',currency:'INR',effectiveFrom:'2026-09-07',costIncludes:'supply_only',taxIncluded:'no'}});
  expect(plan.errors).toEqual([]);const material=plan.records.find(r=>r.kind==='material')!,price=plan.records.find(r=>r.kind==='rate_card')!;
  expect(price.configuration).toMatchObject({amount:150,currency:'INR'});expect(price.links).toContainEqual({relation:'material',targetId:material.id});
 });
 it('does not silently drop cells outside the headings',()=>{
  expect(prepare('Name,Unit\nPlywood,sq.ft,Important specification').errors.join(' ')).toContain('column headings');
 });
});
