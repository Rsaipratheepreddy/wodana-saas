"use client";
import { useState } from 'react';
import { Badge, Button, ControlledModalDialog, DataGrid, NumericInput, TextInput, TextAreaField, useConfirmationDialog, type DataGridColumn } from '@/design-system';
import type { DeliveryQuantityRow, ProjectState, ProjectWorkPackage } from '@/lib/projects/execution';
import { activeReleasedScopeLines } from '../../../../services/business-core/src/projects/project-scope-lines';
import { deliveryQuantityIssues, itemHasCommitments, sourceBalances } from '../../../../services/business-core/src/projects/project-delivery-quantities';
import s from './project-work-plan-editor.module.css';

type Props = {state:ProjectState;work:ProjectWorkPackage;busy:boolean;error:string;run:(action:string,input:Record<string,unknown>)=>Promise<boolean>;onClose:()=>void};
export function ProjectDeliveryQuantities({state,work,busy,error,run,onClose}:Props) {
  // Preserve the version that this draft was based on, even if another command refreshes props.
  const [original] = useState(work.deliveryQuantities);
  const [rows,setRows] = useState<DeliveryQuantityRow[]>(original?.rows ?? []);
  const [editing,setEditing] = useState<DeliveryQuantityRow|null>(null);
  const [reason,setReason] = useState('');
  const [validation,setValidation] = useState('');
  const {confirmationDialog,requestConfirmation} = useConfirmationDialog();
  const sources = activeReleasedScopeLines(state.data).filter(line=>work.scopeLineIds.includes(line.id));
  const balances = sourceBalances(sources,rows);
  const locked = busy || !state.canManage || ['completed','cancelled','in_progress'].includes(work.status) || itemHasCommitments(state.data,work);
  const confirmed = original?.status === 'confirmed';
  const dirty = JSON.stringify(rows)!==JSON.stringify(original?.rows??[]) || !!editing || !!reason;
  const close = () => {if(busy)return; if(dirty) requestConfirmation({title:'Discard unsaved quantities?',body:'Your saved delivery plan will remain unchanged.',onConfirm:onClose});else onClose();};
  const columns:DataGridColumn<DeliveryQuantityRow>[] = [
    {accessorKey:'title',header:'Delivery',size:200,meta:{primary:true}},
    {id:'quantity',header:'Delivery quantity',size:140,accessorFn:row=>`${row.quantity} ${row.unit}`,cell:({getValue})=><strong>{String(getValue())}</strong>},
    {id:'sources',header:'BOQ allocation',size:260,accessorFn:row=>row.sources.map(source=>{const line=sources.find(line=>line.id===source.scopeLineId);return `${line?.title??'Source unavailable'}: ${source.quantity} ${line?.unit??''}`;}).join('; ')},
    {accessorKey:'basis',header:'Measurement basis',size:240},
  ];
  async function save(status:'draft'|'confirmed') {
    const issues=deliveryQuantityIssues(sources,rows,status==='confirmed');
    if(issues.length){setValidation(issues[0]);return;}
    setValidation('');
    if(await run('delivery_quantities',{id:work.id,version:original?.version??0,status,rows}))onClose();
  }
  function acceptRow() {
    if(!editing)return;
    const candidate=rows.some(row=>row.id===editing.id)?rows.map(row=>row.id===editing.id?editing:row):[...rows,editing];
    const issues=deliveryQuantityIssues(sources,candidate,false);
    if(issues.length){setValidation(issues[0]);return;}
    setRows(candidate);setEditing(null);setValidation('');
  }
  return <><ControlledModalDialog isOpen title={`Delivery quantities · ${work.title}`} size="lg" isDismissable={!busy} onOpenChange={open=>{if(!open)close();}} footer={<div className={s.footer}>
    <Button size="compact" isDisabled={busy} onPress={close}>Back to item</Button>
    {!confirmed && !editing && <><Button size="compact" isDisabled={locked} onPress={()=>save('draft')}>Save quantities draft</Button><Button size="compact" variant="primary" isDisabled={locked} onPress={()=>save('confirmed')}>Confirm quantities</Button></>}
  </div>}><div className={s.editor}>
    <div><Badge tone={confirmed?'success':'neutral'}>{confirmed?'Confirmed quantities':'Draft quantities'}</Badge>{original && <span> · Version {original.version}</span>}</div>
    {locked && !busy && <p className={s.hint}>{!state.canManage?'View only. A project planner manages quantities.':'This item has work or supply commitments, or is closed. An impact review is required before quantities can change.'}</p>}
    {(validation||error)&&<p role="alert" className={s.error}>{validation||error}</p>}
    <ul className={s.steps} aria-label="BOQ allocation balances">{balances.map(line=><li key={line.id}><span>{line.title}: {line.allocated} / {line.quantity} {line.unit} allocated · {line.remaining} remaining</span></li>)}</ul>
    {!sources.length&&<p role="status">No active BOQ source. Review the item scope before planning deliveries.</p>}
    <DataGrid gridLines appearance="flush" compactToolbar selectable={false} rowNumbers={false} ariaLabel="Delivery quantity plan" columns={columns} data={rows} getRowId={row=>row.id} onRowAction={!locked&&!confirmed?row=>{setEditing(structuredClone(row));setValidation('');}:undefined} emptyTitle="No delivery quantities planned" emptyDescription="" pageSize={20}/>
    {!confirmed&&!editing&&<Button size="compact" isDisabled={locked||!sources.length} onPress={()=>{setValidation('');const only=balances.length===1?balances[0]:undefined;setEditing({id:crypto.randomUUID(),title:work.title,quantity:only&&only.remaining>0?only.remaining:NaN,unit:only?.unit??'',basis:'',sources:only&&only.remaining>0?[{scopeLineId:only.id,quantity:only.remaining}]:[]});}}>Add delivery</Button>}
    {editing&&<section className={s.stepForm} aria-label="Edit delivery quantities">
      <TextInput label="Delivery name" value={editing.title} maxLength={240} isDisabled={locked} onChange={title=>setEditing({...editing,title})}/>
      <div className={s.pair}><NumericInput label="Delivery quantity" value={editing.quantity} formatOptions={{maximumFractionDigits:6}} isDisabled={locked} onChange={quantity=>setEditing({...editing,quantity})}/><TextInput label="Delivery unit" value={editing.unit} maxLength={40} isDisabled={locked} onChange={unit=>setEditing({...editing,unit})}/></div>
      {sources.map(source=><NumericInput key={source.id} label={`Allocate ${source.title} (${source.unit})`} value={editing.sources.find(entry=>entry.scopeLineId===source.id)?.quantity??NaN} formatOptions={{maximumFractionDigits:6}} isDisabled={locked} onChange={quantity=>setEditing({...editing,sources:[...editing.sources.filter(entry=>entry.scopeLineId!==source.id),...(Number.isNaN(quantity)?[]:[{scopeLineId:source.id,quantity}])]})}/>)}
      <TextAreaField label="Measurement basis" value={editing.basis} maxLength={3000} isDisabled={locked} onChange={basis=>setEditing({...editing,basis})} placeholder="Example: one BOQ lot contains six wardrobes"/>
      <div className={s.taskToolbar}><Button size="compact" isDisabled={locked} onPress={()=>{setEditing(null);setValidation('');}}>Cancel edit</Button>{rows.some(row=>row.id===editing.id)&&<Button size="compact" isDisabled={locked} onPress={()=>{setRows(rows.filter(row=>row.id!==editing.id));setEditing(null);setValidation('');}}>Remove delivery</Button>}<Button size="compact" variant="primary" isDisabled={locked} onPress={acceptRow}>Apply delivery</Button></div>
    </section>}
    {confirmed&&<><p className={s.hint}>Confirmed by {state.members.find(member=>member.id===original.confirmedBy)?.name??original.confirmedBy} · {original.confirmedAt}</p>{!locked&&<><TextAreaField label="Reason for revision" value={reason} maxLength={3000} onChange={setReason}/><Button size="compact" onPress={async()=>{if(!reason.trim()){setValidation('Record why the confirmed quantities need revision.');return;}if(await run('revise_delivery_quantities',{id:work.id,version:original.version,reason}))onClose();}}>Revise quantities</Button></>}</>}
    {!!work.deliveryQuantityHistory?.length&&<details><summary>Previous confirmations ({work.deliveryQuantityHistory.length})</summary>{work.deliveryQuantityHistory.map(plan=><section key={plan.version}><p>Version {plan.version} · {plan.confirmedAt}</p><ul>{plan.rows.map(row=><li key={row.id}>{row.title}: {row.quantity} {row.unit} · {row.basis || 'Same measurement as BOQ'}</li>)}</ul></section>)}</details>}
  </div></ControlledModalDialog>{confirmationDialog}</>;
}
