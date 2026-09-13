"use client";
import { useState, type ReactNode } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { DataGrid, Button } from '@/design-system';
import { catalogStructure, statusLabels, type CatalogRecord } from '@/lib/workspace/catalog';
import { attributeKey, attributeLabel, attributeValue, displayAttributes, sizeDetails } from '@/lib/workspace/catalog-display';
import { importedPrices, priceableKinds, priceLabel, recordPrices, sourcePriceBasis } from '@/lib/workspace/catalog-prices';
import { unitMeaning } from '@/lib/workspace/catalog-units';
import {catalogDescription, catalogHierarchy, catalogRecordName, isMaterialRequirement, materialKinds} from '@/lib/workspace/catalog-hierarchy';
import { CatalogIcon } from './catalog-icons';
import styles from './catalog-record-details.module.css';

function Properties({rows}:{rows:Array<{label:string;value:ReactNode}>}) {
 return <dl className={styles.properties}>{rows.map((row,i)=><div key={`${row.label}:${i}`}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>;
}
function LinkedRecords({records,onOpen,title}:{records:CatalogRecord[];onOpen:(r:CatalogRecord)=>void;title:string}) {
 const [expanded,setExpanded]=useState(false);
 return <div className={styles.linkedList} aria-label={title}>{records.slice(0,expanded?records.length:10).map(r=><button key={r.id} onClick={()=>onOpen(r)}>
  <CatalogIcon record={r}/><span><strong>{catalogRecordName(r)}</strong><small>{materialKinds.includes(r.kind) ? r.code : catalogStructure[r.kind].label}</small></span><ChevronRight size={14}/>
 </button>)}{records.length>10&&<Button variant="quiet" size="compact" onPress={()=>setExpanded(v=>!v)}>{expanded?'Show fewer':`Show all ${records.length}`}</Button>}</div>;
}
export function CatalogRecordDetails({record,items,canManage,busy,onOpen,onEdit,onPrice,onAddComponent}:{record:CatalogRecord;items:CatalogRecord[];canManage:boolean;busy:boolean;onOpen:(record:CatalogRecord)=>void;onEdit:(record:CatalogRecord)=>void;onPrice:(sourceKey?:string)=>void;onAddComponent:(parent:CatalogRecord)=>void}) {
 const byId=new Map(items.map(r=>[r.id,r]));
 const graph=catalogHierarchy(items);
 const definition=catalogStructure[record.kind];
 const {specifications,importDetails}=displayAttributes(record,items);
 const prices=recordPrices(record,items),sourcePrices=importedPrices(record);
 const linked=(relation:string)=>record.links.filter(l=>l.relation===relation).map(l=>byId.get(l.targetId)).filter((r):r is CatalogRecord=>Boolean(r));
 const attr=(r:CatalogRecord,key:string)=>r.attributes.find(a=>attributeKey(a.name)===key)?.value;
 const incoming=items.filter(r=>!r.archived&&r.links.some(l=>l.targetId===record.id));
 const templates=record.kind==='work'?items.filter(r=>r.kind==='construction'&&!r.archived&&r.configuration?.recordRole==='template'&&r.links.some(l=>l.relation==='work'&&l.targetId===record.id)):record.kind==='construction'&&record.configuration?.recordRole==='template'?[record]:[];
 const templateIds=new Set(templates.map(r=>r.id));
 const owner=record.kind==='work'?record:graph.targets(record,['work'])[0];
 const components=record.kind==='work'||record.kind==='variant'?owner?graph.components(owner.id,record.kind==='variant'?record.id:undefined):[]:items.filter(r=>!r.archived&&r.links.some(l=>l.relation==='parent'&&templateIds.has(l.targetId)));
 const componentIds=new Set(components.map(r=>r.id));
 const usedBy=incoming.filter(r=>!componentIds.has(r.id)&&!templateIds.has(r.id)&&!['rate_card','record_group','variant'].includes(r.kind));
 const linkedButton=(r:CatalogRecord)=><button key={r.id} className={styles.reference} onClick={()=>onOpen(r)}><CatalogIcon record={r}/>{catalogRecordName(r)}<ChevronRight size={12}/></button>;
 const propertyRows=definition.links.filter(l=>!['construction','record_group','parent'].includes(l.relation)).flatMap(l=>{
  const matches=linked(l.relation);
  if(matches.length)return [{label:l.label,value:<div className={styles.references}>{matches.map(linkedButton)}</div>}];
  return l.required?[{label:l.label,value:<span className={styles.missing}>Not selected</span>}]:[];
 });
 if(record.aliases.length)propertyRows.push({label:'Also called',value:<span>{record.aliases.join(', ')}</span>});
 if(record.kind==='unit')propertyRows.push({label:'Measurement',value:<span>{unitMeaning(record)}</span>});
 const configRows=definition.fields.filter(f=>record.configuration?.[f.key]!=null).map(f=>({label:f.label,value:attributeValue(f.key,String(record.configuration![f.key]).replaceAll('_',' '))}));
 const material=['material','sku','hardware','consumable'].includes(record.kind);
 const usage=material?graph.usage(record.id):[];
 const variants=record.kind==='work'?graph.related('variant','work',record.id):[];
 return <div className={styles.details}>
  <section className={styles.summary}>
   <div className={styles.identity}><span>{material ? isMaterialRequirement(record) ? 'Material requirement' : 'Material' : record.kind==='construction'&&record.configuration?.recordRole==='component'?'Item component':catalogStructure[record.kind].singular}</span><span className={styles.status}>{record.archived?'Archived':statusLabels[record.specificationStatus]}</span></div>
   {catalogDescription(record)&&<p>{catalogDescription(record)}</p>}
  </section>
  {propertyRows.length>0&&<section><div className={styles.sectionHeading}><h3>{material?'Material specification':'Details'}</h3>{canManage&&<Button size="compact" variant="quiet" onPress={()=>onEdit(record)}>Edit details</Button>}</div><Properties rows={propertyRows}/></section>}
  {variants.length>0&&<section><div className={styles.sectionHeading}><h3>Variants</h3><span className={styles.count}>{variants.length}</span></div><LinkedRecords records={variants} onOpen={onOpen} title="Item variants"/></section>}
  {material&&<section aria-label="Material usage"><div className={styles.sectionHeading}><h3>Used in items</h3><span className={styles.count}>{new Set(usage.map(u=>u.item.id)).size}</span></div>{usage.length?<div className={styles.linkedList}>{usage.map(u=><button key={`${u.item.id}:${u.record.id}`} onClick={()=>onOpen(u.variant||u.item)}><span><strong>{catalogRecordName(u.item)}</strong><small>{u.rooms.map(r=>r.name).join(', ')} · {u.variant?catalogRecordName(u.variant):'All variants'}{u.record.kind==='construction'?` · ${catalogRecordName(u.record)}`:''}</small></span><ChevronRight size={14}/></button>)}</div>:<p className={styles.muted}>Not linked to an item yet. Select this material from an item’s Materials section.</p>}</section>}
  {priceableKinds.includes(record.kind)&&<section aria-label="Costing and prices">
   <div className={styles.sectionHeading}><h3>Costing &amp; prices</h3><Button size="compact" onPress={()=>onPrice()}>{canManage?'Configure prices':'View prices'}</Button></div>
   {(prices.length>0||sourcePrices.length>0)?<DataGrid ariaLabel="Costs and prices" data={[
 ...prices.map(rate=>({id:rate.id,type:String(rate.configuration?.priceType??'Price').replaceAll('_',' '),amount:priceLabel(rate,items),basis:rate.configuration?.supplier??'Internal price',detail:`From ${String(rate.configuration?.effectiveFrom??'—')} · Tax ${rate.configuration?.taxIncluded==='yes'?'included':'extra'}`,status:'Saved',sourceKey:undefined as string|undefined})),
 ...sourcePrices.map(price=>({id:price.key,type:price.label,amount:price.formatted,basis:sourcePriceBasis(price,record),detail:'',status:'Imported · review',sourceKey:price.key})),
 ]} getRowId={r=>r.id} selectable={false} searchLabel="Search costs and prices" exportFileName="costs-and-prices.csv" columns={[
 {accessorKey:'type',header:'Price type',size:190},{accessorKey:'amount',header:'Amount',size:160},{accessorKey:'basis',header:'Basis / details',size:280,cell:({row:{original:r}})=><>{r.basis}<small>{r.detail}</small></>},{accessorKey:'status',header:'Status',size:160},
 {id:'action',header:'Action',size:130,enableSorting:false,enableColumnFilter:false,cell:({row:{original:r}})=>canManage?<Button size="compact" variant="quiet" onPress={()=>onPrice(r.sourceKey)}>{r.sourceKey?'Use amount':'Manage'}</Button>:null}
 ]}/>:<p className={styles.muted}>Add a purchase, internal-cost or selling price with its unit.</p>}
   {sourcePrices.length>0&&<p className={styles.help}>Imported amounts are retained from the workbook. Confirm the price unit, tax, inclusions and date when saving a price.</p>}
  </section>}
  {['material','sku'].includes(record.kind)&&<section><div className={styles.sectionHeading}><h3>Sizes &amp; pack contents</h3>{canManage&&<Button size="compact" variant="quiet" onPress={()=>onEdit(record)}>Edit sizes</Button>}</div>
   {record.sizes.length?record.sizes.map((size,i)=><div className={styles.size} key={i}><h4>{size.label}</h4><Properties rows={sizeDetails(size)}/>{size.note&&<p className={styles.help}>{size.note}</p>}</div>):<p className={styles.muted}>No fixed size or pack contents recorded.</p>}
  </section>}
  {(record.kind==='work'||record.kind==='variant'||templates.length>0)&&<section aria-label="Components and materials">
   <div className={styles.sectionHeading}><h3>Components &amp; materials</h3>{canManage&&templates.length<2&&<Button size="compact" isDisabled={busy} onPress={()=>onAddComponent(templates[0]??record)}><Plus size={13}/>Add component</Button>}</div>
   {components.length?<DataGrid ariaLabel="Item components" data={components} getRowId={r=>r.id} searchLabel="Search item components" exportFileName="item-components.csv" selectable={false} columns={[{id:"name",header:"Component",size:220,accessorFn:component=>String(component.configuration?.componentType??attr(component,"role")??component.name),meta:{renderCell:component=>{
    const selections=component.links.filter(l=>['material','sku','hardware','consumable'].includes(l.relation)).map(l=>byId.get(l.targetId)).filter((r):r is CatalogRecord=>Boolean(r));
    const unit=byId.get(component.links.find(l=>l.relation==='unit')?.targetId??'');
    return <><button className={styles.cellButton} onClick={()=>onOpen(component)}>{String(component.configuration?.componentType??attr(component,'role')??component.name)}</button><small>{component.configuration?.required==='optional'?'Optional':'Component'}</small></>;}}},
{id:"material",header:"Material / specification",size:280,accessorFn:component=>component.links.map(l=>byId.get(l.targetId)?.name??"").join(" "),meta:{renderCell:component=>{
    const selections=component.links.filter(l=>['material','sku','hardware','consumable'].includes(l.relation)).map(l=>byId.get(l.targetId)).filter((r):r is CatalogRecord=>Boolean(r));
    const unit=byId.get(component.links.find(l=>l.relation==='unit')?.targetId??'');
    return <>{selections.length?<div className={styles.references}>{selections.map(linkedButton)}</div>:<><span>{String(component.configuration?.selectionSource??attr(component,'material_sub_type')??'No material selected')}</span><small className={styles.missing}>Select a material or product</small></>}</>;}}},
{id:"quantity",header:"Quantity",size:160,accessorFn:component=>attr(component,"quantity")??String(component.configuration?.factor??""),meta:{renderCell:component=>{
    const selections=component.links.filter(l=>['material','sku','hardware','consumable'].includes(l.relation)).map(l=>byId.get(l.targetId)).filter((r):r is CatalogRecord=>Boolean(r));
    const unit=byId.get(component.links.find(l=>l.relation==='unit')?.targetId??'');
    return <>{attr(component,'quantity')??(component.configuration?.factor!=null?String(component.configuration.factor):'Not set')}<small>{attr(component,'quantity')?'Source quantity':component.configuration?.factor!=null?'Multiplier':'Choose a quantity basis'}</small></>;}}},
{id:"unit",header:"Unit",size:140,accessorFn:component=>byId.get(component.links.find(l=>l.relation==="unit")?.targetId??"")?.name??"Not selected",meta:{renderCell:component=>{
    const selections=component.links.filter(l=>['material','sku','hardware','consumable'].includes(l.relation)).map(l=>byId.get(l.targetId)).filter((r):r is CatalogRecord=>Boolean(r));
    const unit=byId.get(component.links.find(l=>l.relation==='unit')?.targetId??'');
    return <>{unit?.name??'Not selected'}</>;}}},
{id:"action",header:"Action",size:130,enableSorting:false,enableColumnFilter:false,meta:{renderCell:component=>{
    const selections=component.links.filter(l=>['material','sku','hardware','consumable'].includes(l.relation)).map(l=>byId.get(l.targetId)).filter((r):r is CatalogRecord=>Boolean(r));
    const unit=byId.get(component.links.find(l=>l.relation==='unit')?.targetId??'');
    return <>{canManage&&<Button size="compact" variant="quiet" onPress={()=>onEdit(component)}>Configure</Button>}</>;}}}]}/>:<p className={styles.muted}>Add the materials, hardware and consumables used to build this item.</p>}
  </section>}
  {(configRows.length>0||specifications.length>0)&&<details className={styles.importDetails}><summary>Specifications</summary>{configRows.length>0&&<Properties rows={configRows.filter(r=>r.label!=='Row type')}/>}<Properties rows={specifications.filter(a=>!['import_role','catalog_role'].includes(attributeKey(a.name))).map(a=>({label:attributeLabel(a.name),value:attributeValue(a.name,a.value)}))}/></details>}
  {!material&&usedBy.length>0&&<section><div className={styles.sectionHeading}><h3>{record.kind==='room'?'Items in this room':'Used by'}</h3><span className={styles.count}>{usedBy.length}</span></div><LinkedRecords key={record.id} records={usedBy} onOpen={onOpen} title="Connected records"/></section>}
  {record.sources.length>0&&<section><div className={styles.sectionHeading}><h3>Reference sources</h3></div><Properties rows={record.sources.map(s=>({label:s.title,value:`Checked ${s.checkedOn}`}))}/></section>}
  {importDetails.length>0&&<details className={styles.importDetails}><summary>Original import details</summary><Properties rows={importDetails.map(a=>({label:attributeLabel(a.name),value:a.value}))}/></details>}
 </div>;
}
