import {render,screen,fireEvent} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {ProcurementTotals,SupplierInvoices,ProcurementDeliveries} from './project-procurement-ledger';
import type {ProjectState} from '@/lib/projects/execution';
const state={canBuy:true,canReview:true,data:{budget:10000,scope:{currency:'AED'},orders:[{id:'po',number:'PO-1',title:'Handles',vendor:'Supplier',status:'acknowledged',quantity:100,unit:'nos',unitCost:10,currency:'AED',promisedDate:'2026-10-01',receipts:[{accepted:30,rejected:2}]}],supplierInvoices:[{id:'i',orderId:'po',number:'INV-1',quantity:20,unitCost:10,tax:10,status:'approved',dueDate:'2026-10-10',payments:[{amount:50}]}]}} as unknown as ProjectState;
describe('procurement ledger',()=>{
 it('routes a subcontract to measured acceptance without presenting stock or material actions',()=>{const onReceive=vi.fn();const service={...state.data.orders[0],kind:'subcontract' as const};render(<ProcurementDeliveries state={{...state,data:{...state.data,orders:[service]}}} search="" onReceive={onReceive} onOpen={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Accept measured service'}));expect(onReceive).toHaveBeenCalledWith(service);expect(screen.getByRole('button',{name:'Acceptance history'})).toBeTruthy();expect(screen.queryByRole('button',{name:'Receive materials'})).toBeNull();expect(screen.queryByText('Accepted into stock')).toBeNull();});
 it('does not mark an unreceived order received for a read-only viewer',()=>{render(<ProcurementDeliveries state={{...state,canBuy:false}} search="" onReceive={vi.fn()} onOpen={vi.fn()}/>);expect(screen.getByText('Acknowledged')).toBeTruthy();expect(screen.queryByText('Received',{exact:true})).toBeNull();});
 it('does not add invoices or payments to committed budget',()=>{render(<ProcurementTotals state={state}/>);expect(screen.getByText('AED 9,000.00')).toBeTruthy();expect(screen.getByText('AED 1,000.00')).toBeTruthy();expect(screen.getByText('AED 50.00')).toBeTruthy();});
 it('opens payment action for a partial invoice',()=>{const pay=vi.fn();render(<SupplierInvoices state={state} search="" busy={false} onEdit={vi.fn()} onApprove={vi.fn()} onPay={pay}/>);fireEvent.click(screen.getByRole('button',{name:'Record payment'}));expect(pay).toHaveBeenCalledWith(state.data.supplierInvoices![0]);expect(screen.getByText('AED 160.00')).toBeTruthy();});
 it('keeps partial delivery quantities visible',()=>{render(<ProcurementDeliveries state={state} search="" onReceive={vi.fn()} onOpen={vi.fn()}/>);expect(screen.getByText('70')).toBeTruthy();expect(screen.getByRole('button',{name:'Receive materials'})).toBeTruthy();});
 it('routes a fully arrived receipt to inspection instead of receiving it again',()=>{
  const onReceive=vi.fn(),onOpen=vi.fn();
  const current={...state,data:{...state.data,orders:[{...state.data.orders[0],receipts:[{id:'qc',accepted:30,rejected:0,pending:70,receivedBy:'receiver'}]}]}} as ProjectState;
  render(<ProcurementDeliveries state={current} search="" onReceive={onReceive} onOpen={onOpen}/>);
  expect(screen.getByRole('button',{name:'Inspect delivery'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'Receive materials'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Inspect delivery'}));
  expect(onOpen).toHaveBeenCalledWith(current.data.orders[0]);
  expect(onReceive).not.toHaveBeenCalled();
 });
});
