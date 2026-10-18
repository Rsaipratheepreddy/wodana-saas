"use client";
import { useEffect, useState, type ReactNode } from 'react';
import { Download, FileText, Trash2, Pencil } from 'lucide-react';
import { Button, ComboboxField, ControlledModalDialog, FileUploader, InlineNotice, InspectorSheet, submitOnModEnter, useDialogClose } from '@/design-system';
import { caseApi, caseRequest, type CaseAsset, type CatalogChoice } from '@/lib/pre-project/content';
import {AssetMarkup} from './asset-markup';
import styles from './case-content.module.css';
import { useT } from '@/lib/i18n/i18n-provider';

/** The dialog footer's Cancel (or Close on a read-only view): it asks before unsaved changes go. */
function CaseModalClose({ busy, label }: { busy: boolean; label: string }) {
 const close = useDialogClose();
 return <Button isDisabled={busy} onPress={close}>{label}</Button>;
}
/**
 * The planning dialogs' frame: Cancel then the primary action at the end, Cmd/Ctrl+Enter submits the form inside,
 * and closing with unsaved changes asks first.
 */
export function CaseModal({title,description,children,footer,onClose,dirty=false,busy=false,size='lg',layout='modal'}:{title:string;description?:string;children:ReactNode;footer?:ReactNode;onClose:()=>void;dirty?:boolean;busy?:boolean;size?:'md'|'lg'|'xl';layout?:'modal'|'sheet'}) {
 const t=useT();
 useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 const close=(open:boolean)=>{if(!open&&!busy)onClose();};
 const actions=<div className="wd-dialog-actions"><CaseModalClose busy={busy} label={footer?t('Cancel'):t('Close')}/>{footer}</div>;
 const body=<div className={styles.form}>{children}</div>;
 if(layout==='sheet')return <InspectorSheet size="lg" isOpen isDirty={dirty&&!busy} title={title} description={description} onOpenChange={close} footer={actions}>{body}</InspectorSheet>;
 return <ControlledModalDialog size={size} title={title} description={description} isOpen isDirty={dirty&&!busy} isDismissable={!busy} onOpenChange={close} footer={actions}
  onKeyDown={(event)=>submitOnModEnter(event,(event.currentTarget as HTMLElement|null)?.querySelector('form')??null)}>{body}</ControlledModalDialog>;
}
export function CatalogChoiceField({workspaceId,caseId,kind,label,value,onChange,disabled=false,relatedTo}:{relatedTo?:{role:string;recordId:string};workspaceId:string;caseId:string;kind:string;label:string;value:CatalogChoice|null;onChange:(value:CatalogChoice|null)=>void;disabled?:boolean}) {
 const t=useT();
 const relatedRole=relatedTo?.role,relatedId=relatedTo?.recordId;
 const [search,setSearch]=useState('');const [items,setItems]=useState<CatalogChoice[]>([]);const [error,setError]=useState('');const [loading,setLoading]=useState(true);
 useEffect(()=>{const controller=new AbortController();setLoading(true);const timer=setTimeout(()=>{fetch(caseApi(workspaceId,caseId,`catalog-options?kind=${kind}&search=${encodeURIComponent((search===value?.name||search===`${value?.name} · ${value?.catalogName??value?.code}`)?'':search)}${relatedRole?`&relation=${relatedRole}&relatedId=${relatedId}`:''}`),{signal:controller.signal}).then(async response=>{if(!response.ok)throw new Error(t('Catalog choices could not be loaded. Search again to retry.'));return response.json();}).then(data=>{setItems(data.items);setError('');}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});},180);return()=>{clearTimeout(timer);controller.abort();};},[workspaceId,caseId,kind,search,value?.name,value?.catalogName,value?.code,relatedRole,relatedId,t]);
 const options=value?[value,...items.filter(i=>i.id!==value.id)]:items;
 return <div className={styles.choice}><ComboboxField label={label} placeholder={t('Search catalog…')} selectedKey={value?.id??null} onSelectionChange={key=>{if(key)onChange(options.find(i=>i.id===key)??null);}} onInputChange={setSearch} isDisabled={disabled} items={options.map(item=>({id:item.id,label:`${item.name} · ${item.catalogName??item.code}`}))}/>{value&&<Button size="compact" variant="quiet" isDisabled={disabled} onPress={()=>{onChange(null);setSearch('');}}>{t('Clear')}</Button>}{error&&<InlineNotice tone="error" message={error}/>}{!loading&&!error&&!value&&!items.length&&<small role="status">{t(search.trim()?'No matching catalog items.':'No catalog items available.')}</small>}</div>;
}
export function AssetFiles({workspaceId,caseId,assets,onRemove,onMarked,onDraw,assetUrl}:{workspaceId:string;caseId:string;assets:CaseAsset[];assetUrl?:(asset:CaseAsset,preview?:boolean)=>string;onRemove?:(id:string)=>void;onMarked?:(asset:CaseAsset)=>void;onDraw?:(asset:CaseAsset)=>void}) {
 const t=useT();
 const [marking,setMarking]=useState<CaseAsset|null>(null);
 return <><div className={styles.files}>{assets.map(asset=><div className={styles.file} key={asset.id}>{asset.hasPreview?
 // Private, authenticated previews must stay on the same-origin file endpoint.
 // eslint-disable-next-line @next/next/no-img-element
 <img alt="" src={assetUrl?assetUrl(asset,true):caseApi(workspaceId,caseId,`assets/${asset.id}?preview=1`)}/>:<FileText size={22}/>}<span><strong>{asset.name}</strong><small>{(asset.byteSize/1024).toFixed(0)} KB</small></span><a className={styles.fileAction} aria-label={t('Download {name}',{name:asset.name})} href={assetUrl?assetUrl(asset):caseApi(workspaceId,caseId,`assets/${asset.id}`)} download><Download size={16}/></a>{(onDraw||onMarked)&&asset.hasPreview&&assets.length<20&&<Button size="compact" variant="quiet" aria-label={t('Draw on {name}',{name:asset.name})} onPress={()=>onDraw?onDraw(asset):setMarking(asset)}><Pencil size={15}/> {t('Draw')}</Button>}{onRemove&&<Button size="compact" variant="quiet" aria-label={t('Remove {name}',{name:asset.name})} onPress={()=>onRemove(asset.id)}><Trash2 size={15}/></Button>}</div>)}</div>{marking&&onMarked&&<AssetMarkup workspaceId={workspaceId} caseId={caseId} asset={marking} onClose={()=>setMarking(null)} onSaved={asset=>{onMarked(asset);setMarking(null);}}/>}</>;
}
export function AssetUpload({workspaceId,caseId,onUploaded,onError,onBusy,multiple=true,disabled=false,currentCount=0,uploadFile,label}:{workspaceId:string;caseId:string;label?:string;uploadFile?:(file:File,id:string)=>Promise<CaseAsset>;onUploaded:(asset:CaseAsset)=>void;onError:(message:string)=>void;onBusy?:(busy:boolean)=>void;multiple?:boolean;disabled?:boolean;currentCount?:number}) {
 const t=useT();
 const [busy,setBusy]=useState(false);
 const add=async(files:File[])=>{if(busy||!files.length)return;if(files.length>20-currentCount){onError(t('You can add {count} more files to this record.',{count:Math.max(0,20-currentCount)}));return;}const oversized=files.find(file=>file.size>20*1024*1024);if(oversized){onError(t('{name} is larger than 20 MB.',{name:oversized.name}));return;}setBusy(true);onBusy?.(true);onError('');try{for(const file of files){const body=new FormData();body.set('file',file);const id=crypto.randomUUID();onUploaded(uploadFile?await uploadFile(file,id):await caseRequest<CaseAsset>(workspaceId,caseId,`assets/${id}`,'POST',body));}}catch(error){onError(error instanceof Error?error.message:t('Upload failed.'));}finally{setBusy(false);onBusy?.(false);}};
 // The shared picker; it's left out while the record can't take more files.
 if(disabled||currentCount>=20)return null;
 return <FileUploader appearance="button" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,application/pdf" multiple={multiple}
  label={busy?t('Uploading…'):label??t(multiple?'Attach reference files':'Upload design file')} onFiles={files=>void add(files)}/>;
}
