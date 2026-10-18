import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DesignSystemProvider } from '@/design-system';
import { PaymentScheduleEditor } from './payment-schedule-editor';
import { QuotationEditor } from './quotation-editor';
import { QuotationList } from './quotation-list';
import type { CommercialState, Quote } from '@/lib/commercial/types';

beforeEach(()=>vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({items:[]})))));
afterEach(()=>vi.unstubAllGlobals());
const initial: Quote = { id:'q',number:1,kind:'quotation',status:'draft',title:'Villa proposal',currency:'AED',validUntil:'2099-01-01',discount:0,taxRate:0,terms:'',exclusions:'',createdAt:'2026-09-08',requestIds:[],total:100,rooms:[{id:'room',name:'Living room'}],lines:[{id:'line',room:'Living room',title:'Wardrobe',quantity:1,unit:'nos',rate:100,unitCost:60,material:'Oak',finish:'Matte',specification:'Soft close'}],paymentTerms:[{id:'advance',title:'Advance',trigger:'On acceptance',percent:40,requiredForRelease:true},{id:'completion',title:'Completion',trigger:'On completion',percent:60,requiredForRelease:false}] };
function Harness({payment=false}:{payment?:boolean}) { const [quote,setQuote]=useState(initial);return <DesignSystemProvider>{payment?<PaymentScheduleEditor quote={quote} onChange={setQuote} workspaceId="w" readOnly={false}/>:<QuotationEditor quote={quote} onChange={setQuote} workspaceId="w" caseId="c" costing readOnly={false} requests={[]} itemsOnly/>}</DesignSystemProvider>; }
describe('Planning shared tables',()=>{
 it('keeps controlled payment fields focused and reorders the correct milestone after sorting',async()=>{
  const user=userEvent.setup();render(<Harness payment/>);
  const table=screen.getByRole('table',{name:'Payment schedule'});
  const title=within(table).getByRole('textbox',{name:'Milestone 1 title'});
  await user.clear(title);await user.type(title,'Booking payment');
  expect(title).toHaveFocus();expect(title).toHaveValue('Booking payment');
  await user.click(within(table).getByRole('button',{name:'Percentage'}));
  await user.click(within(table).getByRole('button',{name:'Percentage'}));
  await user.click(within(table).getByRole('button',{name:'Move Completion up'}));
  expect(within(table).getByRole('textbox',{name:'Milestone 1 title'})).toHaveValue('Completion');
 expect(within(table).getByRole('textbox',{name:'Milestone 2 title'})).toHaveValue('Booking payment');
  const productionGate=within(table).getByRole('checkbox',{name:'Milestone 1 required before production'});
  expect(productionGate).not.toBeChecked();
  await user.click(productionGate);
  expect(productionGate).toBeChecked();
 expect(screen.getByText(/Total: 100.00%/)).toBeVisible();
 });
 it('loads payment template history and exposes safe restore controls',async()=>{
  const template={id:'00000000-0000-4000-8000-000000000010',name:'Residential 40 / 60',version:2,milestones:initial.paymentTerms};
  const revisions=[
   {id:'00000000-0000-4000-8000-000000000012',resourceType:'payment_template',resourceId:template.id,revisionNumber:2,sourceVersion:2,action:'saved',snapshot:{},sourceRevisionId:null,createdBy:null,createdAt:'2026-09-18T08:00:00.000Z',changes:[{path:'milestones.0.percent',before:50,after:40}]},
   {id:'00000000-0000-4000-8000-000000000011',resourceType:'payment_template',resourceId:template.id,revisionNumber:1,sourceVersion:1,action:'created',snapshot:{},sourceRevisionId:null,createdBy:null,createdAt:'2026-09-17T08:00:00.000Z',changes:[]},
  ];
  const fetcher=vi.fn().mockImplementation((url:string)=>Promise.resolve(new Response(JSON.stringify(url.includes('/history')?revisions:{items:[template]}),{status:200,headers:{'content-type':'application/json'}})));
  vi.stubGlobal('fetch',fetcher);
  const user=userEvent.setup();render(<Harness payment/>);
  await user.click(screen.getByRole('button',{name:'Choose schedule'}));
  const library=await screen.findByRole('dialog',{name:'Payment schedules'});
  await user.click(within(library).getByRole('button',{name:'History'}));
  const history=await screen.findByRole('dialog',{name:'Residential 40 / 60 history'});
  expect(await within(history).findByText('Revision 2')).toBeVisible();
  expect(within(history).getByRole('button',{name:'Restore'})).toBeVisible();
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(`/payment-templates/${template.id}/history`),expect.anything());
 });
 it('keeps line quantity editing and actions working in the shared quotation grid',async()=>{
  const user=userEvent.setup();render(<Harness/>);
  const table=screen.getByRole('table',{name:'Quotation items · Living room'});
  const quantity=within(table).getByRole('textbox',{name:'Quantity for Wardrobe'});
  await user.clear(quantity);await user.type(quantity,'12');await user.tab();
  expect(within(table).getByRole('textbox',{name:'Quantity for Wardrobe'})).toHaveValue('12');
  expect(within(table).getByText('AED 1,200.00')).toBeVisible();
  await user.click(within(table).getByRole('button',{name:'Duplicate Wardrobe'}));
  expect(within(table).getAllByRole('button',{name:'Remove Wardrobe'})).toHaveLength(2);
 });
 it('searches quotations with the shared toolbar and opens the matching record',async()=>{
  const user=userEvent.setup(),open=vi.fn();const other={...initial,id:'other',title:'Office proposal'};
  render(<DesignSystemProvider><QuotationList state={{data:{quotes:[initial,other]},canEdit:false} as CommercialState} busy={false} create={()=>{}} href={id=>`/quote/${id}`} open={open}/></DesignSystemProvider>);
  await user.type(screen.getByRole('searchbox',{name:'Search quotations'}),'Office');
  const table=screen.getByRole('table',{name:'Quotations'});
  expect(within(table).queryByText('Villa proposal')).not.toBeInTheDocument();
  await user.click(within(table).getByRole('cell',{name:'V1'}));
  expect(open).toHaveBeenCalledExactlyOnceWith('other');
  expect(screen.getAllByRole('button',{name:'Table options'})[0]).toBeVisible();
 });
});
