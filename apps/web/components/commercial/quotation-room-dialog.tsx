"use client";
import { useEffect, useState } from 'react';
import { Plus, Copy, Trash2, Search, X, ShoppingBag, Pencil, ArrowLeft } from 'lucide-react';
import { ControlledModalDialog } from '@/design-system';
import type { Quote, QuoteLine } from '@/lib/commercial/types';
import { money, newLine } from '@/lib/commercial/client';
import { applyRoom, catalogItem, roomNames, selectVariant } from '@/lib/commercial/room-builder';
import { quotationDescription, quotationItemName, quotationLineVariant } from '@/lib/commercial/presentation';
import { customUnit } from '@/lib/commercial/materials';
import { CommercialCatalogPicker, type CommercialCatalogChoice } from './catalog-picker';
import { QuotationNumberInput } from './quotation-number-input';
import { QuotationItemRecipe } from './quotation-item-recipe';
import { QuotationItemMaterials } from './quotation-item-materials';
import { applyCatalogMedia } from '@/lib/commercial/quotation-table';
import { QuotationProductPicker, QuotationVariantChoices } from './quotation-product-picker';
import { QuotationRoomPicker } from './quotation-room-picker';
import s from './quotation-workbench.module.css';

export function QuotationRoomDialog({quote,room,itemId,workspaceId,caseId,initialName,onClose,onApply}:{quote:Quote;room:string|null;itemId?:string;workspaceId:string;caseId:string;initialName?:string;onClose:()=>void;onApply:(next:Quote)=>void}) {
  const [master,setMaster]=useState<{catalogId?:string}|null>(null),[masterError,setMasterError]=useState('');
  useEffect(()=>{const controller=new AbortController();fetch(`/api/quotation-assist/catalog?${new URLSearchParams({workspaceId,caseId})}`,{signal:controller.signal}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.message);if(!controller.signal.aborted)setMaster(data);}).catch(e=>{if(!controller.signal.aborted)setMasterError(e.message);});return()=>controller.abort();},[workspaceId,caseId]);
  const [name,setName]=useState(room??initialName??'');
  const [catalog,setCatalog]=useState<CommercialCatalogChoice|null>(quote.rooms?.find(r=>r.name===room)?.catalog?.snapshot??null);
  const [lines,setLines]=useState<QuoteLine[]>(()=>structuredClone(quote.lines.filter(l=>l.room===room)));
  const [selected,setSelected]=useState(itemId??lines[0]?.id??'');
  const [browsing,setBrowsing]=useState(!itemId&&quote.direction!=='deduction'),[search,setSearch]=useState('');
  const [error,setError]=useState(''),[roomSettings,setRoomSettings]=useState(Boolean(initialName)),[addedMessage,setAddedMessage]=useState('');
  const [roomChosen,setRoomChosen]=useState(!!room||!!initialName);
  const item=lines.find(l=>l.id===selected),work=item?.catalogLinks?.find(l=>l.role==='work');
  const maxItems=quote.lines.filter(l=>l.room!==room).length+lines.length>=300;
  const patch=(line:QuoteLine)=>setLines(rows=>rows.map(l=>l.id===line.id?line:l));
  const choose=(id:string)=>{setSelected(id);setBrowsing(false);setAddedMessage('');};
  const addCustom=()=>{if(maxItems)return;const next={...newLine(name),manualReason:'Added manually in the quotation item composer'};setLines(rows=>[...rows,next]);setSearch('');choose(next.id);};
  const addProduct=async(product:CommercialCatalogChoice,variant:CommercialCatalogChoice|null)=>{
    const existing=lines.find(line=>line.catalogLinks?.some(link=>link.role==='work'&&link.recordId===product.id)&&line.catalogLinks?.find(link=>link.role==='variant')?.recordId===variant?.id);
    if(existing){if(existing.quantity>=1e6)return;patch({...existing,quantity:existing.quantity+1});setSelected(existing.id);}
    else{if(maxItems)return;const base=selectVariant({...catalogItem(name,product),title:quotationItemName(product.name,catalog?.name??name)},variant);const next=await applyCatalogMedia(workspaceId,base,variant,product);setLines(rows=>[...rows,next]);setSelected(next.id);}
    setAddedMessage(`${quotationItemName(product.name,catalog?.name??name)} added${existing?' · quantity '+(existing.quantity+1):''}`);
  };
  const remove=(id:string)=>{const next=lines.filter(line=>line.id!==id);setLines(next);if(selected===id){setSelected(next[0]?.id??'');if(!next.length)setBrowsing(true);}};
  const quantity=(id:string,value:number)=>{const line=lines.find(l=>l.id===id);if(!line)return;if(value<=0)remove(id);else patch({...line,quantity:value});};
  const filtered=lines.filter(line=>[line.title,...(line.catalogLinks??[]).filter(link=>link.role==='variant').map(link=>link.snapshot.name)].join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()));
  const openRoom=(next:CommercialCatalogChoice|null,title:string)=>{let unique=title,index=2;while(roomNames(quote).some(r=>r.toLowerCase()===unique.toLowerCase()))unique=`${title} ${index++}`;setCatalog(next);setName(unique);setRoomChosen(true);setRoomSettings(!next);};
  const apply=()=>{
    const title=name.trim();if(!title){setRoomSettings(true);setError('Enter a room name.');return;}
    if(roomNames(quote).some(r=>r!==room&&r.toLowerCase()===title.toLowerCase())){setRoomSettings(true);setError('A room with this name already exists.');return;}
    if(lines.some(l=>!l.title.trim()||!l.unit.trim())){setError('Give every item a name and unit.');return;}
    onApply(applyRoom(quote,room,title,catalog,lines));onClose();
  };
  return <ControlledModalDialog title={roomChosen?name||'Room items':'Add a room'} size="lg" isOpen onOpenChange={open=>{if(!open)onClose();}} footer={roomChosen?<div className={s.dialogFooter}><span>{lines.length} {lines.length===1?'item':'items'} · {money(lines.reduce((sum,l)=>sum+l.quantity*l.rate,0),quote.currency)}</span><div><button className={s.button} onClick={onClose}>Cancel</button><button className={s.primary} onClick={apply}>Done</button></div></div>:undefined}>
    <div className={s.roomDialog}>
      {!roomChosen?<QuotationRoomPicker workspaceId={workspaceId} caseId={caseId} catalogId={master?.catalogId} onChoose={choice=>openRoom(choice,choice.name)} onCustom={title=>openRoom(null,title)}/>:<>
      <div className={s.roomContext}><span>{catalog?.name??'Custom room'}</span><button className={s.textButton} aria-expanded={roomSettings} onClick={()=>setRoomSettings(!roomSettings)}><Pencil size={12}/>{roomSettings?'Hide room details':'Room details'}</button></div>
      {roomSettings&&<div className={s.roomDetails}><label>Room name<input autoFocus aria-label="Room name" value={name} maxLength={120} onChange={e=>setName(e.target.value)} placeholder="e.g. Living room"/></label>{quote.direction!=='deduction'&&<CommercialCatalogPicker workspaceId={workspaceId} caseId={caseId} kind="room" label="Room type" disabled={!master} catalogId={master?.catalogId} value={catalog} onChange={setCatalog}/>}</div>}
      {masterError&&<p className={s.error} role="alert">{masterError}</p>}{error&&<p className={s.error} role="alert">{error}</p>}
      <div className={`${s.configLayout} ${s.shopLayout}`}>
        <aside className={s.itemList} aria-label="Room items">
          <div className={s.listHeading}><strong><ShoppingBag size={14}/>In this room <span>{lines.length}</span></strong>{quote.direction!=='deduction'&&<button className={s.textButton} aria-pressed={browsing} onClick={()=>{setBrowsing(true);setAddedMessage('');}}><Plus size={14}/>Items</button>}</div>
          {!!lines.length&&<label className={s.compactSearch}><Search size={13}/><input type="search" aria-label="Search room items" placeholder="Find added items…" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button aria-label="Clear item search" onClick={()=>setSearch('')}><X size={12}/></button>}</label>}
          <div className={s.cartItems}>{!lines.length?<p className={s.hint}>Items you add appear here.</p>:!filtered.length?<p className={s.hint}>No matching items.</p>:filtered.map(line=>{const title=quotationItemName(line.title,name),variant=quotationLineVariant(line);return <div className={s.basketItem} key={line.id}><div className={s.cartRow}><button className={s.itemChoice} aria-pressed={!browsing&&selected===line.id} title={`Edit ${title}`} aria-label={`Edit ${title}${variant?` · ${variant}`:''}`} onClick={()=>choose(line.id)}><span><strong>{title}</strong>{variant&&<small>{variant}</small>}</span><Pencil size={12}/></button><button className={s.cartRemove} aria-label={`Remove ${title}`} title="Remove item" onClick={()=>remove(line.id)}><X size={12}/></button></div><div className={s.basketPrice}><label><span>Qty</span><QuotationNumberInput label={`Quantity for ${title}${variant?` · ${variant}`:''}`} value={line.quantity} min={.0001} max={1e6} onChange={value=>quantity(line.id,value)}/></label><label><span>{quote.currency} / {line.unit}</span><QuotationNumberInput money label={`Price for ${title}${variant?` · ${variant}`:''}`} value={line.rate} onChange={rate=>patch({...line,rate})}/></label></div></div>;})}</div>
        </aside>
        <div className={s.itemConfiguration}>
          {quote.direction!=='deduction'&&<div hidden={!browsing}><QuotationProductPicker workspaceId={workspaceId} caseId={caseId} catalogId={catalog?.catalogId??master?.catalogId} room={catalog} lines={lines} atLimit={maxItems} onAdd={addProduct} onCustom={addCustom} onEdit={choose} onQuantity={quantity}/><p role="status" className={s.addedFeedback}>{addedMessage}</p></div>}
          {!browsing&&item&&<div key={selected}>
            <div className={s.selectedItemHeading}>{quote.direction!=='deduction'?<button className={s.backToItem} onClick={()=>setBrowsing(true)}><ArrowLeft size={13}/>Back to items</button>:<strong>Edit item</strong>}<div className={s.actions}><button className={s.iconButton} aria-label="Duplicate item" title="Duplicate item" disabled={maxItems||quote.direction==='deduction'} onClick={()=>{const copy={...structuredClone(item),id:crypto.randomUUID()};setLines(rows=>[...rows,copy]);setSearch('');choose(copy.id);}}><Copy size={14}/></button><button className={s.iconButton} title="Remove item" aria-label="Remove item" onClick={()=>remove(item.id)}><Trash2 size={14}/></button></div></div>
            <div className={s.itemForm}>
              <label>Item name<input aria-label="Item name" value={item.title} maxLength={240} onChange={e=>patch({...item,title:e.target.value})}/></label>
              {work&&quote.direction!=='deduction'&&<QuotationVariantChoices workspaceId={workspaceId} caseId={caseId} work={work.snapshot} roomName={catalog?.name??name} value={item.catalogLinks?.find(link=>link.role==='variant')?.snapshot??null} onChange={async value=>patch(await applyCatalogMedia(workspaceId,selectVariant(item,value),value,work.snapshot))}/>} 
              <div className={s.priceFields}><label>Quantity<QuotationNumberInput label="Item quantity" value={item.quantity} min={.0001} max={1e6} onChange={quantity=>patch({...item,quantity})}/></label><label>Unit<input aria-label="Item unit" maxLength={20} value={item.unit} onChange={e=>patch(customUnit(item,e.target.value))}/></label><label>Unit price · {quote.currency}<QuotationNumberInput label="Item unit price" money value={item.rate} onChange={rate=>patch({...item,rate})}/></label></div>
              {item.rate===0&&<p className={s.hint}>Enter a unit price.</p>}
              <QuotationItemRecipe item={item} onChange={patch} workspaceId={workspaceId} caseId={caseId}/>
              <section className={s.notes}><h3>Other materials & finishes{item.customMaterials?.length?` · ${item.customMaterials.length} custom`:''}</h3><QuotationItemMaterials item={item} onChange={patch} workspaceId={workspaceId} caseId={caseId} library={quote.lines.flatMap(line=>line.customMaterials??[])}/></section>
              <section className={s.notes}><h3>Notes & item link</h3><label>Additional description<textarea aria-label="Item description" rows={2} maxLength={32000} value={item.specification} onChange={e=>patch({...item,specification:e.target.value})}/></label>{quote.direction!=='deduction'&&<CommercialCatalogPicker workspaceId={workspaceId} caseId={caseId} kind="work" label="Item from Master Data" catalogId={catalog?.catalogId??master?.catalogId} value={work?.snapshot??null} onChange={async value=>{if(value)patch(await applyCatalogMedia(workspaceId,catalogItem(name,value,item),value));else patch({...item,catalogLinks:(item.catalogLinks??[]).filter(link=>!['work','variant','material','finish'].includes(link.role)),material:'',finish:''});}}/>}</section>
              <div className={s.itemPreview}><span>Quotation description</span><p>{quotationDescription(item)||'Selected materials appear here.'}</p></div>
            </div>
          </div>}
        </div>
      </div></>}
    </div>
  </ControlledModalDialog>;
}
