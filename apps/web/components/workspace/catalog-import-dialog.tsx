"use client";
import {useRef,useState} from 'react';
import {Upload} from 'lucide-react';
import {Button,Checkbox,ControlledModalDialog,DataGrid,SelectField,useDesignSystem,type DataGridColumn} from '@/design-system';
import {type CatalogKind,type CatalogRecord,catalogStructure} from '@/lib/workspace/catalog';
import {catalogGroups,recordSections} from '@/lib/workspace/catalog-navigation';
import {guessImportHeader,importFields,parseDelimitedCatalog,prepareCatalogImport,suggestImportMapping,type ImportPlan,type ImportReviewRow,type ImportTable} from '@/lib/workspace/catalog-import';
import {readCatalogImportFile} from '@/lib/workspace/catalog-import-file';
import tableStyles from '../crm/leads-page.module.css';
import styles from './catalog-settings-page.module.css';

type ImportResult={created:number;reused:number;items:CatalogRecord[]};
export function CatalogImportDialog({catalogId,items,initialKind,groupId,onClose,onValidate,onImport,onImported}:{catalogId:string;items:CatalogRecord[];initialKind:CatalogKind;groupId:string;onClose:()=>void;onValidate:(plan:ImportPlan)=>Promise<unknown>;onImport:(plan:ImportPlan)=>Promise<ImportResult>;onImported:(result:ImportResult)=>void}) {
 const upload=useRef<HTMLInputElement>(null);
 const [tables,setTables]=useState<ImportTable[]>([]),[sheet,setSheet]=useState(0),[header,setHeader]=useState(0),[kind,setKind]=useState(initialKind),[group,setGroup]=useState(groupId);
 const [mapping,setMapping]=useState<string[]>([]),[paste,setPaste]=useState(''),[createReferences,setCreateReferences]=useState(false);
 const [plan,setPlan]=useState<ImportPlan|null>(null),[valid,setValid]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const {currency:workspaceCurrency}=useDesignSystem();
 const [priceDefaults,setPriceDefaults]=useState<Record<string,string>>({currency:workspaceCurrency,priceType:'cost'});
 const table=tables[sheet];const headers=table?.rows[header]??[];
 const priceMapped=mapping.includes('price:amount');
 const setSource=(next:ImportTable[],index=0)=>{if(!next.length)throw new Error('No worksheets with data were found.');const h=guessImportHeader(next[index].rows,kind);setTables(next);setSheet(index);setHeader(h);setMapping(suggestImportMapping(next[index].rows[h],kind));setPlan(null);setValid(false);setError('');};
 const review=async()=>{
  if(!table)return;setBusy(true);setError('');setValid(false);
  const next=prepareCatalogImport(table,header,mapping,items,{catalogId,kind,groupId:group,createReferences,priceDefaults});setPlan(next);
  try {if(!next.errors.length&&next.records.length){if(new TextEncoder().encode(JSON.stringify(next.records)).byteLength>1_400_000)throw new Error('This batch is too large. Import a smaller worksheet.');await onValidate(next);setValid(true);}}
  catch(e){setError(e instanceof Error?e.message:'Could not validate this import.');}finally{setBusy(false);}
 };
 const commit=async()=>{if(!plan||!valid)return;setBusy(true);setError('');try{const result=await onImport(plan);onImported(result);onClose();}catch(e){setError(e instanceof Error?e.message:'Import failed. No partial batch was saved. You can retry this review.');}finally{setBusy(false);}};
 const mappingRows=headers.map((name,index)=>({id:String(index),name:name||`Column ${index+1}`,sample:table?.rows.slice(header+1).find(row=>row[index]?.trim())?.[index]??'',index}));
 const fields=importFields(kind);
 const mapColumns:DataGridColumn<typeof mappingRows[number]>[]=[{accessorKey:'name',header:'Your column',size:160},{accessorKey:'sample',header:'Example value',size:180,cell:({getValue})=><span className={styles.importSample} title={String(getValue())}>{String(getValue())}</span>},{id:'destination',header:'Use as',size:260,cell:({row:{original:r}})=><SelectField label={<span className={styles.srOnly}>Destination for {r.name}</span>} selectedKey={mapping[r.index]||'ignore'} onSelectionChange={key=>setMapping(m=>m.map((v,i)=>i===r.index?(key==='ignore'?'':String(key)):v))} items={[{id:'ignore',label:'Skip this column'},{id:`attribute:${r.index}`,label:'Keep as a specification'},...fields.map(f=>({id:f.key,label:f.label}))]}/>}];
 const reviewColumns:DataGridColumn<ImportReviewRow>[]=[{id:'row',header:'Row',size:55,accessorFn:r=>r.sourceRow||'—'},{accessorKey:'name',header:'Record',size:200},{accessorKey:'type',header:'Type',size:120},{accessorKey:'detail',header:'Result',size:290,cell:({row:{original:r}})=><span className={r.status==='error'?styles.importError:undefined}>{r.detail}</span>}];
 return <ControlledModalDialog isOpen size="lg" title={plan?'Review import':'Import records'} description={plan?'Check the new records and matches before saving. Existing records will be kept.':'Upload Excel or CSV, or paste a table. Match its columns to your catalog.'} isDismissable={!busy} onOpenChange={open=>{if(!open&&!busy)onClose();}} footer={<div className={styles.footer}><Button isDisabled={busy} onPress={plan?()=>{setPlan(null);setValid(false);setError('');}:onClose}>{plan?'Back':'Cancel'}</Button>{plan?<Button variant="primary" isLoading={busy} isDisabled={!valid||!plan.records.length||Boolean(plan.errors.length)} onPress={commit}>Import {plan.records.length} records</Button>:<Button variant="primary" isLoading={busy} isDisabled={!table||!mapping.includes('name')} onPress={review}>Review import</Button>}</div>}>
  {error&&<p role="alert" className={styles.error}>{error}</p>}
  {plan?<div className={styles.form}>
   <p className={styles.muted}>{plan.records.length} new records, including groups, references and prices · {plan.skipped} existing records kept. {valid?'Validation passed.':busy?'Checking records and connections…':''}</p>
   {plan.errors.length>0&&<div className={styles.error} role="alert"><strong>Fix these rows before importing.</strong><ul>{plan.errors.slice(0,12).map((message,i)=><li key={i}>{message}</li>)}</ul>{plan.errors.length>12&&<p>{plan.errors.length-12} more issues are marked in the table.</p>}</div>}
   {!plan.records.length&&!plan.errors.length&&<p className={styles.notice}>All rows already exist. Nothing needs to be imported.</p>}
   <div className={tableStyles.tableRegion}><DataGrid ariaLabel="Import review" appearance="flush" columns={reviewColumns} data={plan.rows} getRowId={row=>`${row.sourceRow}:${row.type}:${row.name}`} selectable={false} showToolbar={false} pageSize={25}/></div>
  </div>:<div className={styles.form}>
   <div className={styles.actions}><Button onPress={()=>upload.current?.click()} isDisabled={busy}><Upload size={14}/>Choose Excel or CSV</Button><a href="/templates/catalog-sample.xlsx" download>Sample Excel</a><span className={styles.muted}>{table?table.name:'Up to 2 MB · 500 records per batch'}</span></div>
   <input ref={upload} className={styles.srOnly} type="file" aria-label="Catalog file" accept=".xlsx,.csv,.tsv,.txt" disabled={busy} onChange={async event=>{const file=event.target.files?.[0];if(!file)return;setBusy(true);setError('');try{setSource(await readCatalogImportFile(file));}catch(e){setError(e instanceof Error?e.message:'Could not read this file.');}finally{setBusy(false);event.target.value='';}}}/>
   <details className={styles.additional}><summary>Or paste from Excel</summary><label>Paste a table with column headings<textarea value={paste} onChange={event=>setPaste(event.target.value)} placeholder={'Name\tUnit\tBrand\nPlywood\tSquare foot\tCentury'}/></label><Button size="compact" isDisabled={!paste.trim()||busy} onPress={()=>{try{setSource([{name:'Pasted table',rows:parseDelimitedCatalog(paste)}]);}catch(e){setError(e instanceof Error?e.message:'Could not read the table.');}}}>Use pasted table</Button></details>
   <div className={styles.grid}>
    <SelectField label="Record type in this worksheet" selectedKey={kind} onSelectionChange={key=>{if(key){const next=String(key) as CatalogKind;setKind(next);if(table)setMapping(suggestImportMapping(headers,next));}}} items={recordSections.map(s=>({id:s.kind,label:s.label}))}/>
    <SelectField label="Default group" selectedKey={group||'none'} onSelectionChange={key=>setGroup(key==='none'?'':String(key))} items={[{id:'none',label:'Ungrouped'},...catalogGroups(items).map(r=>({id:r.id,label:r.name}))]}/>
    {table&&<><SelectField label="Worksheet" selectedKey={String(sheet)} onSelectionChange={key=>key!==null&&setSource(tables,Number(key))} items={tables.map((t,i)=>({id:String(i),label:t.name}))}/><SelectField label="Column headings are on row" selectedKey={String(header)} onSelectionChange={key=>{const h=Number(key);setHeader(h);setMapping(suggestImportMapping(table.rows[h],kind));}} items={table.rows.slice(0,20).map((_,i)=>({id:String(i),label:String(i+1)}))}/></>}
   </div>
   {table&&<><p className={styles.muted}>Column suggestions are editable. Unmatched columns are kept as specifications. Import one record type per worksheet; multiple connections use a semicolon (;).</p><div className={`${tableStyles.tableRegion} ${styles.importMapping}`}><DataGrid ariaLabel="Match import columns" appearance="flush" columns={mapColumns} data={mappingRows} getRowId={r=>r.id} selectable={false} showToolbar={false} pageSize={25}/></div>
   <Checkbox isSelected={createReferences} onChange={setCreateReferences}>Create missing brands, finishes, rooms and categories</Checkbox><p className={styles.muted}>New reference records and groups appear in the review. Units and other dependencies must already be defined or imported first.</p>
   {priceMapped&&<fieldset><legend>Defaults for imported prices</legend><p className={styles.muted}>Mapped price columns override these defaults. Enter the date, inclusions and tax treatment explicitly.</p><div className={styles.grid}>
    {(['priceType','currency','costIncludes','taxIncluded'] as const).map(key=><SelectField key={key} label={key==='priceType'?'Price type':key==='currency'?'Currency':key==='costIncludes'?'Price includes':'Tax included'} selectedKey={priceDefaults[key]||null} onSelectionChange={value=>setPriceDefaults(d=>({...d,[key]:String(value)}))} items={(key==='currency'?Array.from(new Set([workspaceCurrency,'INR','AED','USD'])):catalogStructure.rate_card.fields.find(f=>f.key===key)?.options??[]).filter(id=>id!=='unconfirmed').map(id=>({id,label:id.replaceAll('_',' ')}))}/>)}
    <label>Effective from<input type="date" value={priceDefaults.effectiveFrom??''} onChange={e=>setPriceDefaults(d=>({...d,effectiveFrom:e.target.value}))}/></label>
   </div></fieldset>}</>}
  </div>}
 </ControlledModalDialog>;
}
