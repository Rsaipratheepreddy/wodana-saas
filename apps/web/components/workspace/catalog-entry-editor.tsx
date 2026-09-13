"use client";
import {useMemo, useState, type FormEvent} from 'react';
import {ArrowUpRight, Boxes, Layers} from 'lucide-react';
import {Button, SelectField} from '@/design-system';
import type {CatalogRecord} from '@/lib/workspace/catalog';
import {attributeKey, attributeLabel, displayAttributes} from '@/lib/workspace/catalog-display';
import {catalogAttribute, catalogDescription, catalogHierarchy, catalogRecordName, isMaterialEntry, isMaterialRequirement, materialKinds, withCatalogAttribute} from '@/lib/workspace/catalog-hierarchy';
import {importedPrices, priceLabel, recordPrices, sourcePriceBasis} from '@/lib/workspace/catalog-prices';
import {CatalogRecordPicker, CatalogMultiplePicker} from './catalog-picker';
import styles from './catalog-entry.module.css';
import formStyles from './catalog-settings-page.module.css';

export type CatalogRelatedAction = (record: CatalogRecord, section?: 'variant' | 'components') => void;

export function CatalogEntryEditor({draft, setDraft, items, onSubmit, saving, onRelated, onPrice}: {
  draft: CatalogRecord; setDraft: (r: CatalogRecord) => void; items: CatalogRecord[];
  onSubmit: (e: FormEvent) => void; saving: boolean; onRelated: CatalogRelatedAction; onPrice: () => void;
}) {
  const [tab, setTab] = useState('details');
  const [newSpecIndex, setNewSpecIndex] = useState<number | null>(null);
  const newSpec = newSpecIndex === null ? null : draft.attributes[newSpecIndex];
  const setNewSpec = (value: {name:string;value:string}) => change('attributes', draft.attributes.map((a,i) => i === newSpecIndex ? value : a));
  const graph = useMemo(() => catalogHierarchy(items), [items]);
  const item = draft.kind === 'work', variant = draft.kind === 'variant', component = draft.kind === 'construction';
  const material = materialKinds.includes(draft.kind);
  const owner = graph.targets(draft, ['work'])[0];
  const change = (key: keyof CatalogRecord, value: unknown) => setDraft({...draft, [key]: value});
  const attr = (key: string, value: string) => setDraft(withCatalogAttribute(draft, key, value));
  const configure = (key: string, value: string) => {const configuration={...draft.configuration};if(value.trim())configuration[key]=value;else delete configuration[key];change('configuration',configuration);};
  const setLink = (relation: string, targetId: string) => change('links', [...draft.links.filter(l => l.relation !== relation), ...(targetId ? [{relation, targetId}] : [])]);
  const options = (kind: string) => items.filter(r => r.kind === kind && r.id !== draft.id && (!r.archived || draft.links.some(l => l.targetId === r.id))).map(r => ({id:r.id, label:catalogRecordName(r)})).sort((a,b) => a.label.localeCompare(b.label));
  const picker = (relation: string, label: string, required = false) => <CatalogRecordPicker label={label} isRequired={required} isDisabled={saving} items={options(relation)} selectedKey={draft.links.find(l => l.relation === relation)?.targetId ?? null} onChange={id => setLink(relation, id)}/>;
  const textAttr = (key: string, label: string, type = 'text') => <label>{label}<input type={type} min={type === 'number' ? 0 : undefined} step="any" value={catalogAttribute(draft, key) ?? ''} onChange={e => attr(key, e.target.value)}/></label>;
  const variants = item ? graph.related('variant', 'work', draft.id) : [];
  const materials = item ? graph.materials(draft.id) : variant && owner ? graph.materials(owner.id, draft.id) : [];
  const usage = material ? graph.usage(draft.id) : [];
  const usageItems = [...new Map(usage.map(u => [u.item.id, u.item])).values()];
  const selections = graph.targets(draft, materialKinds).filter(r => !isMaterialRequirement(r));
  const selectedProduct = selections[0];
  const selectProduct = (id: string) => {
    const product = graph.byId.get(id);
    // Keep specification requirements and unrelated links; replace only the selected product.
    const links = draft.links.filter(l => l.targetId !== selectedProduct?.id || !materialKinds.includes(l.relation));
    if (product) links.push({relation:product.kind, targetId:product.id});
    setDraft({...draft, links});
  };
  const rates = recordPrices(draft, items), imported = importedPrices(draft);
  const mainAttributes = new Set((item ? ['typical_qty','is_modular','category'] : variant ? ['tier','estimated_timeline_days','board_choice','laminate_choice','hardware_choice','accessory_choice'] : component ? ['quantity','role','material_sub_type','is_optional','notes'] : ['tier']).map(attributeKey));
  const {specifications, importDetails} = displayAttributes(draft, items);
  const additionalSpecs = specifications.filter(a => a !== newSpec && !mainAttributes.has(attributeKey(a.name)) && !['import_role','catalog_role'].includes(attributeKey(a.name)));
  const contextLink = (record: CatalogRecord) => <button type="button" className={styles.link} disabled={saving} onClick={() => onRelated(record)}>{catalogRecordName(record)}<ArrowUpRight size={13}/></button>;
  const relatedRows = (records: CatalogRecord[], label: string) => <div className={styles.linkedRows} aria-label={label}>{records.map(record => <button key={record.id} type="button" disabled={saving} onClick={() => onRelated(record)}><span>{catalogRecordName(record)}</span><ArrowUpRight size={14}/></button>)}</div>;
  const materialSection = () => <>
    <div className={styles.sectionTitle}><h3>{item ? 'Shared materials' : 'Materials for this variant'}</h3>{draft.version > 0 && <Button size="compact" isDisabled={saving} onPress={() => onRelated(draft, 'components')}>Manage materials<ArrowUpRight size={13}/></Button>}</div>
    {materials.length ? <div className={styles.linkedRows}>{materials.map(record => {
      const targets = graph.targets(record, materialKinds);
      return <button key={record.id} type="button" disabled={saving} onClick={() => onRelated(record)}><span>{catalogRecordName(record)}{record.kind === 'construction' && <small>{targets.map(catalogRecordName).join(', ') || String(record.configuration?.selectionSource || 'Choose a material')}</small>}</span><ArrowUpRight size={14}/></button>;
    })}</div> : <p className={styles.muted}>{draft.version ? 'No materials linked yet.' : 'Save the item first, then add its variants and materials.'}</p>}
  </>;

  return <form id="catalog-editor" className={`${formStyles.form} ${styles.editor}`} onSubmit={onSubmit} onInvalidCapture={e => {const input=e.target as HTMLInputElement;const panel=input.closest('[role="tabpanel"]');if(panel){setTab(panel.id.replace('entry-panel-',''));requestAnimationFrame(()=>input.focus());}}}>
    <div className={styles.tabs} role="tablist" aria-label="Edit sections">
      {['details','specifications','links'].map((key,index) => <button type="button" role="tab" key={key} id={`entry-tab-${key}`} tabIndex={tab === key ? 0 : -1} aria-controls={`entry-panel-${key}`} aria-selected={tab === key} onClick={() => setTab(key)} onKeyDown={e => {const keys=['details','specifications','links'];const next=e.key==='ArrowRight'?(index+1)%3:e.key==='ArrowLeft'?(index+2)%3:e.key==='Home'?0:e.key==='End'?2:null;if(next!==null){e.preventDefault();setTab(keys[next]);e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#entry-tab-${keys[next]}`)?.focus();}}}>{key === 'details' ? 'Details' : key === 'specifications' ? 'Specifications' : material ? 'Used in' : 'Linked records'}</button>)}
    </div>
    <div id="entry-panel-details" role="tabpanel" aria-labelledby="entry-tab-details" hidden={tab !== 'details'}>
      <fieldset disabled={saving} className={styles.fields}>
        {owner && <div className={styles.context}><span>Item</span>{contextLink(owner)}</div>}
        <label>{component ? 'Component / role' : variant ? 'Variant name' : material ? 'Material name' : 'Item name'}<input required maxLength={180} value={catalogRecordName(draft)} onChange={e => {
          if (variant) setDraft({...draft, name:e.target.value, configuration:{...draft.configuration,specificationTier:e.target.value}});
          else if (component) setDraft({...draft,name:e.target.value,configuration:{...draft.configuration,componentType:e.target.value}});
          else if (isMaterialRequirement(draft)) setDraft(withCatalogAttribute({...draft,name:e.target.value},'Required specification',e.target.value));
          else change('name', e.target.value);
        }}/></label>
        {item && <>
          <CatalogMultiplePicker label="Rooms" disabled={saving} items={options('room')} selected={draft.links.filter(l => l.relation === 'room').map(l => l.targetId)} onChange={ids => change('links', [...draft.links.filter(l => l.relation !== 'room'), ...ids.map(targetId => ({relation:'room',targetId}))])}/>
          <div className={formStyles.grid}>{picker('category','Category')}{picker('unit','Unit')}{textAttr('typical_qty','Typical quantity','number')}<SelectField label="Modular item" isDisabled={saving} selectedKey={catalogAttribute(draft,'is_modular') || 'false'} onSelectionChange={key => attr('is_modular', String(key))} items={[{id:'false',label:'No'},{id:'true',label:'Yes'}]}/></div>
        </>}
        {variant && <>
          {!owner && picker('work','Item',true)}
          <div className={formStyles.grid}>{picker('unit','Unit')}{textAttr('estimated_timeline_days','Estimated duration (days)','number')}{textAttr('board_choice','Board requirement')}{textAttr('laminate_choice','Finish requirement')}{textAttr('hardware_choice','Hardware requirement')}{textAttr('accessory_choice','Accessories')}</div>
          <p className={styles.muted}>Choose exact products in this variant’s Materials section.</p>
        </>}
        {component && <>
          <label>Required specification<input maxLength={1000} value={graph.specification(draft)} onChange={e => {const configuration={...draft.configuration};if(e.target.value.trim())configuration.selectionSource=e.target.value;else delete configuration.selectionSource;setDraft({...withCatalogAttribute(draft,'material_sub_type',e.target.value),configuration,links:draft.links.filter(l=>{const target=graph.byId.get(l.targetId);return !target || !isMaterialRequirement(target) || catalogRecordName(target)===e.target.value;})});}}/></label>
          <CatalogRecordPicker label="Selected material / product" isDisabled={saving} selectedKey={selectedProduct?.id ?? null} onChange={selectProduct} items={items.filter(r => isMaterialEntry(r) && (!r.archived || r.id === selectedProduct?.id)).map(r => ({id:r.id,label:`${catalogRecordName(r)} · ${r.code}`}))}/>
          {!selectedProduct && <p className={styles.muted}>Specification only. Select a material to link its product details and prices.</p>}
          {selectedProduct && <div className={styles.context}><span>Linked material</span>{contextLink(selectedProduct)}</div>}
          {selections.length > 1 && <div className={styles.context}><span>Also linked</span>{selections.slice(1).map(record => <span key={record.id}>{contextLink(record)}</span>)}</div>}
          <div className={formStyles.grid}>{textAttr('quantity','Quantity','number')}{picker('unit','Quantity unit')}<SelectField label="Applies to" isDisabled={saving} selectedKey={draft.links.find(l => l.relation === 'variant')?.targetId ?? 'base'} onSelectionChange={key => setLink('variant', key === 'base' ? '' : String(key))} items={[{id:'base',label:'All variants · shared material'},...(owner ? graph.related('variant','work',owner.id).map(r => ({id:r.id,label:catalogRecordName(r)})) : [])]}/><SelectField label="Requirement" isDisabled={saving} selectedKey={String(draft.configuration?.required || 'required')} onSelectionChange={key => configure('required',String(key))} items={[{id:'required',label:'Required'},{id:'optional',label:'Optional'},{id:'conditional',label:'Conditional'}]}/></div>
        </>}
        {material && <>
          <div className={formStyles.grid}>{draft.kind === 'sku' ? picker('material','Material family') : draft.kind === 'material' ? picker('category','Category') : textAttr('category','Category')}{picker('brand','Brand')}{picker('unit','Unit')}{textAttr('tier','Quality tier')}</div>
          {draft.kind === 'sku' && <div className={formStyles.grid}><label>Manufacturer code<input value={String(draft.configuration?.manufacturerCode || '')} onChange={e => configure('manufacturerCode',e.target.value)}/></label><label>Finish / shade code<input value={String(draft.configuration?.finishCode || '')} onChange={e => configure('finishCode',e.target.value)}/></label></div>}
        </>}
        <label>{component ? 'Notes' : 'Description'}<textarea rows={2} maxLength={4000} value={catalogDescription(draft)} onChange={e => change('description', e.target.value)}/></label>
      </fieldset>
      {!component && <div className={styles.priceSummary}><span><strong>{rates.length ? priceLabel(rates[0],items) : imported.length ? imported[0].formatted : 'No price set'}</strong>{imported.length > 0 && !rates.length && <small>{sourcePriceBasis(imported[0], draft)} · Imported estimate</small>}</span><Button size="compact" isDisabled={saving || !draft.version} onPress={onPrice}>Manage prices</Button></div>}
      {(item || variant) && <div className={styles.shortcuts}>{item && <Button size="compact" isDisabled={saving || !draft.version} onPress={() => onRelated(draft,'variant')}><Boxes size={14}/>{variants.length} {variants.length === 1 ? 'variant' : 'variants'}<ArrowUpRight size={13}/></Button>}<Button size="compact" isDisabled={saving || !draft.version} onPress={() => onRelated(draft,'components')}><Layers size={14}/>{materials.length} {item ? 'shared ' : ''}{materials.length === 1 ? 'material' : 'materials'}<ArrowUpRight size={13}/></Button></div>}
      {material && <button type="button" className={styles.link} onClick={() => setTab('links')}>Used in {usageItems.length} {usageItems.length === 1 ? 'item' : 'items'}<ArrowUpRight size={13}/></button>}
    </div>
    <div id="entry-panel-specifications" role="tabpanel" aria-labelledby="entry-tab-specifications" hidden={tab !== 'specifications'}>
      <fieldset disabled={saving} className={styles.fields}>
        <div className={formStyles.grid}>{additionalSpecs.map(a => <label key={a.name}>{attributeLabel(a.name)}<input value={a.value} maxLength={1000} onChange={e => attr(a.name,e.target.value)}/></label>)}</div>
        {!additionalSpecs.length && <p className={styles.muted}>No additional specifications.</p>}
        {newSpec ? <div className={styles.size}><div className={formStyles.grid}><label>Specification name<input required maxLength={80} value={newSpec.name} onChange={e=>setNewSpec({...newSpec,name:e.target.value})}/></label><label>Value<input required maxLength={1000} value={newSpec.value} onChange={e=>setNewSpec({...newSpec,value:e.target.value})}/></label></div><Button size="compact" variant="quiet" onPress={()=>{change('attributes',draft.attributes.filter((_,i)=>i!==newSpecIndex));setNewSpecIndex(null);}}>Remove field</Button></div> : null}
        <Button size="compact" isDisabled={draft.attributes.length >= 30 || draft.attributes.some(a=>!a.name.trim()||!a.value.trim())} onPress={() => {setNewSpecIndex(draft.attributes.length);change('attributes',[...draft.attributes,{name:'',value:''}]);}}>Add specification</Button>
        {material && ['material','sku'].includes(draft.kind) && <>
          <h3>Sizes &amp; packs</h3>
          {draft.sizes.map((size,index) => <div className={styles.size} key={index}><label>Size label<input value={size.label} required onChange={e => change('sizes',draft.sizes.map((s,i) => i === index ? {...s,label:e.target.value} : s))}/></label><div className={formStyles.grid}>{(['lengthMm','widthMm','thicknessMm','diameterMm','packQuantity'] as const).map(key => <label key={key}>{key === 'packQuantity' ? 'Pack quantity' : `${key.replace('Mm','')} (mm)`}<input type="number" min="0.001" step="any" value={size[key] ?? ''} onChange={e => change('sizes',draft.sizes.map((s,i) => i === index ? {...s,[key]:e.target.value ? Number(e.target.value) : undefined} : s))}/></label>)}<SelectField label="Pack unit" selectedKey={size.packUnit || 'none'} onSelectionChange={key => change('sizes',draft.sizes.map((s,i) => i === index ? {...s,packUnit:key === 'none' ? undefined : String(key)} : s))} items={[{id:'none',label:'No pack'},...['L','ml','kg','g','m','each'].map(id=>({id,label:id}))]}/></div><Button size="compact" variant="quiet" onPress={() => change('sizes',draft.sizes.filter((_,i) => i !== index))}>Remove size</Button></div>)}
          <Button size="compact" onPress={() => change('sizes',[...draft.sizes,{label:''}])}>Add size or pack</Button>
        </>}
        <details className={styles.source}><summary>Reference information</summary><dl><div><dt>Code</dt><dd>{draft.code || 'Assigned when saved'}</dd></div>{importDetails.map(a => <div key={a.name}><dt>{attributeLabel(a.name)}</dt><dd>{a.value}</dd></div>)}</dl></details>
      </fieldset>
    </div>
    <div id="entry-panel-links" role="tabpanel" aria-labelledby="entry-tab-links" hidden={tab !== 'links'}>
      {item && <><div className={styles.sectionTitle}><h3>Variants</h3><Button size="compact" isDisabled={saving || !draft.version} onPress={() => onRelated(draft,'variant')}>Manage variants<ArrowUpRight size={13}/></Button></div>{relatedRows(variants,'Linked variants')}</>}
      {(item || variant) && materialSection()}
      {material && <><h3>Items using this material</h3>{usage.length ? <div className={styles.linkedRows}>{usage.map(u => <button key={`${u.item.id}:${u.record.id}`} type="button" disabled={saving} onClick={() => onRelated(u.variant || u.item,'components')}><span>{catalogRecordName(u.item)}<small>{u.rooms.map(r=>r.name).join(', ')} · {u.variant ? catalogRecordName(u.variant) : 'Shared across variants'}{u.record.kind === 'construction' ? ` · ${catalogRecordName(u.record)}` : ''}</small></span><ArrowUpRight size={14}/></button>)}</div> : <p className={styles.muted}>Not linked to an item yet. Select this material from an item’s Materials section.</p>}</>}
      {component && <><h3>Linked material requirements</h3>{relatedRows(graph.targets(draft,materialKinds),'Linked materials')}{owner && <div className={styles.context}><span>Item</span>{contextLink(owner)}</div>}</>}
    </div>
  </form>;
}
