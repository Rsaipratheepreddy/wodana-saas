import {beforeEach,describe,it,expect,vi} from 'vitest';
import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {PaymentInvoice,normalizeInvoice} from './payment-invoice';
import {DesignSystemProvider} from '@/design-system';
import {money} from '@/lib/commercial/client';
import type {Payment} from '@/lib/commercial/types';
const payment:Payment={id:'payment',title:'Advance',amount:100.01,dueDate:'2026-09-07',requiredForRelease:true,status:'pending',reference:'',proof:''};
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(async(input)=>new Response(JSON.stringify(String(input).includes('/tools?')?{items:[{Id:'123',DocNumber:'INV-123',TotalAmt:100.01,Balance:100.01,CurrencyRef:{value:'AED'},CustomerRef:{name:'Client'}},{Id:'124',DocNumber:'INV-124',TotalAmt:100,Balance:100,CurrencyRef:{value:'AED'}},{Id:'125',DocNumber:'INV-125',TotalAmt:100.01,Balance:0,CurrencyRef:{value:'USD'}}],hasMore:false}:[{id:'company',displayName:'Test company',provider:'quickbooks',status:'connected'}]),{status:200}))));
describe('invoice milestone connection',()=>{
 it('does not load invoices from another organization',async()=>{
  render(<PaymentInvoice workspaceId="w" payment={{...payment,legalEntityId:'correct-organization'}} canVerifyFinance busy={false} run={vi.fn()}/>);
  await userEvent.click(screen.getByRole('button',{name:'Connect invoice'}));
  expect(await screen.findByText(/Connect an accounting company in/)).toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls.every(([url])=>!String(url).includes('/tools?'))).toBe(true);
 });
 it('requires exact cents, currency and explicit client confirmation before connecting',async()=>{const user=userEvent.setup(),run=vi.fn().mockResolvedValue(true);render(<PaymentInvoice workspaceId="w" payment={payment} canVerifyFinance busy={false} run={run} currency="AED" customerName="Client"/>);await user.click(screen.getByRole('button',{name:'Connect invoice'}));const matching=await screen.findByRole('radio',{name:/INV-123/});expect(screen.getByRole('radio',{name:/INV-124/})).toBeDisabled();expect(screen.getByRole('radio',{name:/INV-125/})).toBeDisabled();expect(screen.getByRole('button',{name:'Verify & connect invoice'})).toBeDisabled();await user.click(matching);await user.click(screen.getByRole('checkbox'));await user.click(screen.getByRole('button',{name:'Verify & connect invoice'}));await waitFor(()=>expect(run).toHaveBeenCalledWith('invoice',{paymentId:'payment',connectionId:'company',invoiceId:'123',clientConfirmed:true}));});
 it('does not present an absent provider balance as zero',()=>{expect(Number.isNaN(normalizeInvoice({Id:'1',TotalAmt:100,Balance:null},'quickbooks').balance)).toBe(true);});
 it('shows the milestone in the workspace currency when the case has none',async()=>{render(<DesignSystemProvider currency="SAR" locale="en-SA" timeZone="Asia/Riyadh"><PaymentInvoice workspaceId="w" payment={payment} canVerifyFinance busy={false} run={vi.fn()}/></DesignSystemProvider>);await userEvent.click(screen.getByRole('button',{name:'Connect invoice'}));expect(await screen.findByText(money(100.01,'SAR').replace(/\s/g,' '))).toBeInTheDocument();});
});
