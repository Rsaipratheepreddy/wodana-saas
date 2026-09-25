import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {parseDate} from '@internationalized/date';
import {describe,it,expect,vi,beforeEach} from 'vitest';
import {SupplierWhatsAppLink,loadSuppliers,SupplierQuoteRequest} from './project-suppliers';
import {jsonRequest} from '@/lib/commercial/client';
import type {Order,ProjectState,Material} from '@/lib/projects/execution';
vi.mock('@/lib/commercial/client',()=>({jsonRequest:vi.fn()}));
vi.mock('@/design-system',()=>({
 Button:({children,onPress,isDisabled,isLoading,...props}:any)=><button {...props} disabled={isDisabled||isLoading} onClick={onPress}>{children}</button>,
 ControlledModalDialog:({children,footer,title}:any)=><div role="dialog" aria-label={title}>{children}{footer}</div>,
 SelectField:({label,items,selectedKey,onSelectionChange}:any)=><label>{label}<select value={selectedKey??''} onChange={e=>onSelectionChange(e.target.value)}><option value=""/>{items.map((i:any)=><option key={i.id} value={i.id}>{i.label}</option>)}</select></label>,
 MultiSelectField:({label,items,selectedKeys,onSelectionChange}:any)=><fieldset><legend>{label}</legend>{items.map((i:any)=><label key={i.id}><input type="checkbox" checked={selectedKeys.has(i.id)} onChange={e=>{const next=new Set(selectedKeys);if(e.target.checked)next.add(i.id);else next.delete(i.id);onSelectionChange(next);}}/>{i.label}</label>)}</fieldset>,
 NumericInput:({label,value,onChange}:any)=><label>{label}<input type="number" value={value} onChange={e=>onChange(Number(e.target.value))}/></label>,
 DateField:({label,value,onChange}:any)=><label>{label}<input value={value?.toString()??''} onChange={e=>onChange(e.target.value?parseDate(e.target.value):null)}/></label>,
 Checkbox:({children,isSelected,onChange}:any)=><label><input type="checkbox" checked={isSelected} onChange={e=>onChange(e.target.checked)}/>{children}</label>,
 TextInput:({label,value,onChange}:any)=><label>{label}<input value={value} onChange={e=>onChange(e.target.value)}/></label>,
}));
const order={vendor:'Boards LLC',vendorPhone:'+971501234567',title:'Boards',quantity:5,unit:'sheet',promisedDate:'2026-09-25'} as Order;
beforeEach(()=>vi.clearAllMocks());
describe('supplier sharing',()=>{
 it('prepares a private supplier message, without claiming delivery',()=>{render(<SupplierWhatsAppLink order={order} url="https://app.example.com/vendor/order#token=private"/>);const href=screen.getByRole('link',{name:/Open WhatsApp/}).getAttribute('href')!;expect(href).toContain('https://wa.me/971501234567');expect(decodeURIComponent(href)).toContain('#token=private');expect(screen.queryByText(/sent/i)).not.toBeInTheDocument();});
 it('does not offer external sharing for localhost',()=>{render(<SupplierWhatsAppLink order={order} url="http://127.0.0.1:3000/vendor/order#token=private"/>);expect(screen.queryByRole('link')).not.toBeInTheDocument();expect(screen.getByText(/public app address/)).toBeVisible();});
 it('requires an international supplier phone',()=>{render(<SupplierWhatsAppLink order={{...order,vendorPhone:'0501234567'}} url="https://app.example.com/vendor/order#token=private"/>);expect(screen.queryByRole('link')).not.toBeInTheDocument();expect(screen.getByText(/country code/)).toBeVisible();});
 it('loads every supplier directory page',async()=>{vi.mocked(jsonRequest).mockResolvedValueOnce({data:[{id:'a'}],nextCursor:'next'}).mockResolvedValueOnce({data:[{id:'b'}],nextCursor:null});expect(await loadSuppliers('workspace')).toEqual([{id:'a'},{id:'b'}]);expect(jsonRequest).toHaveBeenLastCalledWith(expect.stringContaining('cursor=next'));});
 it('submits multiple supplier identities as one request without sending messages',async()=>{vi.mocked(jsonRequest).mockResolvedValue({data:[{id:'s1',displayName:'First',code:'S1',status:'active'},{id:'s2',displayName:'Second',code:'S2',status:'active'},{id:'s3',displayName:'Draft',code:'S3',status:'draft'}],nextCursor:null});const m={id:'m',title:'Boards',specification:'Oak',catalogId:'',catalogVersion:0,taskId:'',unit:'sheet',required:5,supply:'company',needBy:'2026-09-25',movements:[]} as Material;const state={workspaceId:'w',today:'2026-09-20',data:{materials:[m],orders:[]}} as unknown as ProjectState;const run=vi.fn().mockResolvedValue(true);render(<SupplierQuoteRequest state={state} source={m} run={run} onClose={vi.fn()} onCreated={vi.fn()} onSuppliers={vi.fn()}/>);await screen.findByLabelText('First · S1');fireEvent.click(screen.getByLabelText('First · S1'));fireEvent.click(screen.getByLabelText('Second · S2'));expect(screen.queryByLabelText('Draft · S3')).not.toBeInTheDocument();fireEvent.change(screen.getByLabelText('Quotes due'),{target:{value:'2026-09-20'}});fireEvent.click(screen.getByRole('button',{name:'Create 2 requests'}));await waitFor(()=>expect(run).toHaveBeenCalledWith('request_supplier_quotes',{materialId:'m',vendorIds:['s1','s2'],quantity:5,quoteDueDate:'2026-09-20',promisedDate:'2026-09-25'}));});
});
