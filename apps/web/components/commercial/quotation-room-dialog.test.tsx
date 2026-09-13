import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Quote } from '@/lib/commercial/types';
import { QuotationRoomDialog } from './quotation-room-dialog';
const catalog=vi.hoisted(()=>({variants:[] as {id:string;kind:string;name:string;code:string;catalogId:string;version:number}[],loading:false,error:''}));
const work={id:'sofa',kind:'work',name:'Sofa',code:'SF',catalogId:'catalog',version:1};
const variant={id:'standard',kind:'variant',name:'Sofa · Standard',code:'STANDARD',catalogId:'catalog',version:1};
const roomChoice={id:'living',kind:'room',name:'Living room',code:'LR',catalogId:'catalog',version:1};
vi.mock('./catalog-options-cache',()=>({useCatalogOptions:(_w:string,_c:string,kind:string,search:string)=>({items:(kind==='work'?[work]:kind==='variant'?catalog.variants:kind==='room'?[roomChoice]:[]).filter(item=>item.name.toLowerCase().includes(search.toLowerCase())),loading:kind==='variant'&&catalog.loading,error:kind==='variant'?catalog.error:'',refresh:vi.fn()})}));
vi.mock('./quotation-item-recipe',()=>({QuotationItemRecipe:()=> <p>Linked material choices</p>}));
const quote=():Quote=>({id:'q',number:1,kind:'quotation',status:'draft',title:'Proposal',currency:'AED',validUntil:'2099-01-01',discount:0,taxRate:0,terms:'Terms',exclusions:'',createdAt:'2026-09-08',requestIds:[],total:0,lines:[],paymentTerms:[]});
beforeEach(()=>{catalog.variants=[variant];catalog.loading=false;catalog.error='';vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({catalogId:'catalog'}))));});
describe('direct room shopping',()=>{
  it('picks a room and adds repeatedly with the visible variant, preserving search and linking the quote only on Done',async()=>{
    const user=userEvent.setup(),onApply=vi.fn();render(<QuotationRoomDialog quote={quote()} room={null} workspaceId="w" caseId="c" onClose={vi.fn()} onApply={onApply}/>);
    await user.click(screen.getByRole('button',{name:'Living room'}));
    await user.type(screen.getByRole('searchbox',{name:'Search products'}),'sofa');
    expect(screen.queryByText('Choose later')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Standard'})).toHaveAttribute('aria-pressed','true');
    await user.click(screen.getByRole('button',{name:'Add Sofa'}));await user.click(screen.getByRole('button',{name:'Add Sofa'}));
    expect(screen.getByRole('searchbox',{name:'Search products'})).toHaveValue('sofa');expect(screen.getByText(/2 in room/)).toBeVisible();expect(onApply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button',{name:'Edit Sofa'}));
    expect(screen.getByLabelText('Item quantity')).toHaveValue('2');expect(screen.getByText('Linked material choices')).toBeVisible();expect(screen.queryByRole('button',{name:'Details & price'})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Back to items'}));expect(screen.getByRole('searchbox',{name:'Search products'})).toHaveValue('sofa');
    await user.click(screen.getByRole('button',{name:'Done'}));const saved=onApply.mock.lastCall?.[0];expect(saved.rooms[0].catalog.recordId).toBe('living');expect(saved.lines).toHaveLength(1);expect(saved.lines[0].quantity).toBe(2);expect(saved.lines[0].catalogLinks.map((link:{recordId:string})=>link.recordId)).toEqual(['sofa','standard']);
  });
  it('keeps variants separate and permits direct quantity, removal and price changes without opening the editor',async()=>{
    catalog.variants.push({...variant,id:'premium',name:'Sofa · Premium',code:'PREM'});const user=userEvent.setup(),onApply=vi.fn();render(<QuotationRoomDialog quote={quote()} room="Living room" workspaceId="w" caseId="c" onClose={vi.fn()} onApply={onApply}/>);
    await user.click(screen.getByRole('button',{name:'Add Sofa'}));await user.click(screen.getByRole('button',{name:'Premium'}));await user.click(screen.getByRole('button',{name:'Add Sofa'}));
    await user.clear(screen.getByLabelText('Price for Sofa · Premium'));await user.type(screen.getByLabelText('Price for Sofa · Premium'),'250');
    await user.click(screen.getByRole('button',{name:'Standard'}));await user.click(screen.getByRole('button',{name:'Decrease Sofa'}));
    await user.click(screen.getByRole('button',{name:'Done'}));expect(onApply.mock.lastCall?.[0].lines).toHaveLength(1);expect(onApply.mock.lastCall?.[0].lines[0]).toMatchObject({quantity:1,rate:250});expect(onApply.mock.lastCall?.[0].lines[0].catalogLinks[1].recordId).toBe('premium');
  });
  it.each(['loading','error'])('does not create an incomplete item when variants are %s',async(state)=>{
    catalog.loading=state==='loading';catalog.error=state==='error'?'Unavailable':'';const onApply=vi.fn();render(<QuotationRoomDialog quote={quote()} room="Office" workspaceId="w" caseId="c" onClose={vi.fn()} onApply={onApply}/>);
    expect(screen.getByRole('button',{name:'Add Sofa'})).toBeDisabled();
  });
  it('adds an item that genuinely has no variants',async()=>{
    catalog.variants=[];const user=userEvent.setup(),onApply=vi.fn();render(<QuotationRoomDialog quote={quote()} room="Office" workspaceId="w" caseId="c" onClose={vi.fn()} onApply={onApply}/>);await user.click(screen.getByRole('button',{name:'Add Sofa'}));await user.click(screen.getByRole('button',{name:'Done'}));expect(onApply.mock.lastCall?.[0].lines[0].catalogLinks).toHaveLength(1);
  });
  it('searches a large room without changing or losing hidden items and cancels cleanly',async()=>{
    const source=quote();source.lines=Array.from({length:60},(_,i)=>({id:String(i),room:'Office',title:`Fixture ${i+1}`,quantity:1,rate:10,unitCost:0,unit:'nos',specification:'',material:'',finish:''}));
    const user=userEvent.setup(),onApply=vi.fn(),onClose=vi.fn();render(<QuotationRoomDialog quote={source} room="Office" workspaceId="w" caseId="c" onClose={onClose} onApply={onApply}/>);
    const list=screen.getByRole('complementary',{name:'Room items'});await user.type(within(list).getByRole('searchbox',{name:'Search room items'}),'Fixture 60');expect(within(list).getAllByRole('button',{name:/^Edit Fixture/})).toHaveLength(1);
    await user.click(within(list).getByRole('button',{name:'Edit Fixture 60'}));expect(screen.getByLabelText('Item name')).toHaveValue('Fixture 60');await user.click(within(list).getByRole('button',{name:'Clear item search'}));expect(within(list).getAllByRole('button',{name:/^Edit Fixture/})).toHaveLength(60);
    await user.click(screen.getByRole('button',{name:'Cancel'}));expect(onApply).not.toHaveBeenCalled();expect(onClose).toHaveBeenCalled();expect(source.lines).toHaveLength(60);
  });
  it('keeps custom rooms and items available with no matching master record',async()=>{
    const user=userEvent.setup();render(<QuotationRoomDialog quote={quote()} room={null} workspaceId="w" caseId="c" onClose={vi.fn()} onApply={vi.fn()}/>);await user.type(screen.getByRole('searchbox',{name:'Search rooms'}),'Roof terrace');await user.click(screen.getByRole('button',{name:'Create “Roof terrace”'}));expect(screen.getByLabelText('Room name')).toHaveValue('Roof terrace');await user.type(screen.getByRole('searchbox',{name:'Search products'}),'not in catalog');expect(screen.getByText(/No matching items/)).toBeVisible();await user.click(screen.getByRole('button',{name:'Custom item'}));await waitFor(()=>expect(screen.getByLabelText('Item name')).toHaveValue('New item'));
  });
  it('preserves an existing variant missing from refreshed choices and opens a preview item directly',async()=>{
    const source=quote(),old={...variant,id:'original',name:'Sofa · Original finish',code:'ORIG'};source.lines=[{id:'line',room:'Living room',title:'Sofa',quantity:1,rate:100,unitCost:0,unit:'nos',specification:'',material:'',finish:'',catalogLinks:[{role:'work',recordId:work.id,version:1,snapshot:work},{role:'variant',recordId:old.id,version:1,snapshot:old}]}];const user=userEvent.setup(),onApply=vi.fn();render(<QuotationRoomDialog quote={source} room="Living room" itemId="line" workspaceId="w" caseId="c" onClose={vi.fn()} onApply={onApply}/>);
    expect(screen.queryByLabelText('Room name')).not.toBeInTheDocument();expect(within(screen.getByRole('group',{name:'Variant'})).getByRole('button',{name:'Original finish'})).toHaveAttribute('aria-pressed','true');await user.click(screen.getByRole('button',{name:'Done'}));expect(onApply.mock.lastCall?.[0].lines[0].catalogLinks[1].recordId).toBe('original');
  });
});
