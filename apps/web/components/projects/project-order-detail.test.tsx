import {render,screen,fireEvent} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {ProjectOrderDetail} from './project-order-detail';
import {procurementContext} from '@/lib/projects/procurement-context';
import type {ProjectState,Order} from '@/lib/projects/execution';
const order={id:'po',number:'PO-1',title:'Boards',vendor:'Supplier',status:'acknowledged',materialId:'m',taskId:'',quantity:10,unit:'sheet',unitCost:20,currency:'AED',promisedDate:'2026-09-25',receipts:[],notes:'Use loading gate'} as unknown as Order;
const state={canBuy:true,canReview:true,data:{orders:[order],materials:[{id:'m',taskId:'t',title:'Oak boards',specification:'18 mm'}],tasks:[{id:'t',title:'Fabrication',location:'factory',area:'Kitchen'}],supplierInvoices:[]}} as unknown as ProjectState;
const handlers=()=>({onEdit:vi.fn(),onVendor:vi.fn(),onStep:vi.fn(),onInvoice:vi.fn(),onShipment:vi.fn(),onNotes:vi.fn(),onOffer:vi.fn(),onApproveInvoice:vi.fn(),onPayInvoice:vi.fn()});
describe('order details',()=>{
 it('uses service certification and preserves independent review for subcontract work',()=>{
  const receipt={id:'service-measurement',accepted:2,rejected:0,pending:3,receivedBy:'measurer',at:'2026-09-22',evidence:'Measured area and signed checklist'};
  const onInspectReceipt=vi.fn(),current={...state,memberId:'reviewer',members:[]};
  const service={...order,kind:'subcontract' as const,receipts:[receipt]};
  const {rerender}=render(<ProjectOrderDetail state={current} order={service} busy={false} {...handlers()} initialSection="deliveries" onInspectReceipt={onInspectReceipt}/>);
  expect(screen.getByText('Awaiting certification 3 sheet')).toBeTruthy();
  expect(screen.queryByText('Shipment tracking')).toBeNull();expect(screen.queryByText(/usable stock/)).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Certify work'}));expect(onInspectReceipt).toHaveBeenCalledWith(receipt);
  rerender(<ProjectOrderDetail state={{...current,memberId:'measurer'}} order={service} busy={false} {...handlers()} initialSection="deliveries" onInspectReceipt={onInspectReceipt}/>);
  expect(screen.queryByRole('button',{name:'Certify work'})).toBeNull();expect(screen.getByText('Awaiting independent review')).toBeTruthy();
 });
 it('shows pending QC and permits only another reviewer to inspect',()=>{
  const receipt={id:'r',accepted:2,rejected:1,pending:7,receivedBy:'receiver',at:'2026-09-22',evidence:'DN1'};
  const onInspectReceipt=vi.fn();
  const current={...state,memberId:'reviewer',members:[]};
  const {rerender}=render(<ProjectOrderDetail state={current} order={{...order,receipts:[receipt]}} busy={false} {...handlers()} initialSection="deliveries" onInspectReceipt={onInspectReceipt}/>);
  expect(screen.getByText('Accepted 2 sheet')).toBeTruthy();
  expect(screen.getByText('Pending QC 7 sheet')).toBeTruthy();
  expect(screen.getByText('Rejected 1 sheet')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Inspect'}));expect(onInspectReceipt).toHaveBeenCalledWith(receipt);
  rerender(<ProjectOrderDetail state={{...current,memberId:'receiver'}} order={{...order,receipts:[receipt]}} busy={false} {...handlers()} initialSection="deliveries" onInspectReceipt={onInspectReceipt}/>);
  expect(screen.queryByRole('button',{name:'Inspect'})).toBeNull();
 });
 it('offers inspection, not a second receipt or shipment, when all units have arrived',()=>{
  const receipt={id:'r',accepted:4,rejected:0,pending:6,receivedBy:'receiver',at:'2026-09-22',evidence:'DN1'};
  const current={...state,memberId:'reviewer',members:[]};
  render(<ProjectOrderDetail state={current} order={{...order,receipts:[receipt]}} busy={false} {...handlers()} initialSection="deliveries" onInspectReceipt={vi.fn()}/>);
  expect(screen.getByText(/6 awaiting inspection/)).toBeVisible();
  expect(screen.getByRole('button',{name:'Inspect'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'Receive materials'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Update shipment'})).not.toBeInTheDocument();
 });
 it('keeps closure available but removes shipment updates after full acceptance',()=>{
  const receipt={id:'r',accepted:10,rejected:0,pending:0,receivedBy:'receiver',at:'2026-09-22',evidence:'DN1'};
  render(<ProjectOrderDetail state={state} order={{...order,receipts:[receipt]}} busy={false} {...handlers()} initialSection="deliveries"/>);
  expect(screen.getByRole('button',{name:'Close order'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'Update shipment'})).not.toBeInTheDocument();
 });
 it('keeps items and shipping primary while preserving invoice and note actions',()=>{const h=handlers();render(<ProjectOrderDetail state={state} order={order} busy={false} {...h}/>);expect(screen.getByText('Oak boards')).toBeTruthy();expect(screen.getByText('Factory · Kitchen')).toBeTruthy();expect(screen.queryByText('Use loading gate')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'More'}));fireEvent.click(screen.getByRole('menuitem',{name:'Notes'}));expect(screen.getByText('Use loading gate')).toBeTruthy();expect(screen.queryByText('Oak boards')).toBeNull();expect(screen.queryAllByRole('link')).toHaveLength(0);fireEvent.click(screen.getByRole('button',{name:'Notes'}));fireEvent.click(screen.getByRole('menuitem',{name:'Invoices'}));fireEvent.click(screen.getByRole('button',{name:'Record invoice'}));expect(h.onInvoice).toHaveBeenCalled();fireEvent.click(screen.getByRole('radio',{name:'Shipping'}));fireEvent.click(screen.getByRole('button',{name:'Update shipment'}));expect(h.onShipment).toHaveBeenCalled();});
 it('shows offers instead of deliveries on a quote request',()=>{render(<ProjectOrderDetail state={state} order={{...order,status:'enquiry',vendorUpdates:[]}} busy={false} {...handlers()}/>);fireEvent.click(screen.getByRole('radio',{name:'Offers'}));expect(screen.getByRole('button',{name:'Record offer'})).toBeTruthy();expect(screen.getByText('Awaiting supplier offer.')).toBeTruthy();expect(screen.queryByRole('button',{name:'Receive materials'})).toBeNull();});
 it('derives location from consuming task, never supplier type',()=>{expect(procurementContext(state.data,order).location).toBe('factory');expect(procurementContext(state.data,{...order,kind:'factory',materialId:''}).location).toBe('unassigned');});
});

it('shows frozen RFQ scope and original quantity after partial selection',()=>{
 const snapshot={title:'Original boards',specification:'Original oak',workTitle:'Original fabrication',quantity:20,unit:'sheet'} as NonNullable<Order['rfqSnapshot']>;
 const {rerender}=render(<ProjectOrderDetail state={state} order={{...order,status:'enquiry',rfqSnapshot:snapshot}} busy={false} {...handlers()}/>);
 expect(screen.getByText('Original oak')).toBeTruthy();expect(screen.queryByText('18 mm')).toBeNull();
 expect(screen.queryByRole('button',{name:'Edit request'})).toBeNull();
 rerender(<ProjectOrderDetail state={state} order={{...order,status:'draft',sourceEnquiry:'RFQ-1',rfqSnapshot:snapshot}} busy={false} {...handlers()}/>);
 expect(screen.getByText('20 sheet · RFQ-1')).toBeTruthy();expect(screen.getByRole('button',{name:'Submit for approval'})).toBeTruthy();
});

it('retains selected and superseded offers on the draft order without offering another selection',()=>{
 const vendorUpdates=[{id:'q1',at:'2026-09-20',kind:'quotation' as const,quantity:10,unitCost:20,date:'2026-09-25',note:'First quote',evidence:'Q1'},{id:'q2',at:'2026-09-21',kind:'quotation' as const,quantity:8,unitCost:19,date:'2026-09-26',note:'Revised quote',evidence:'Q2'}];
 render(<ProjectOrderDetail state={state} order={{...order,status:'draft',vendorUpdates,selectedOffer:{offerId:'q2',selectedBy:'buyer',selectedAt:'2026-09-22',quantity:4,quotedQuantity:8,unitCost:19,promisedDate:'2026-09-26',evidence:'Q2',reason:'Partial supply'}}} busy={false} {...handlers()}/>);
 fireEvent.click(screen.getByRole('button',{name:'More'}));fireEvent.click(screen.getByRole('menuitem',{name:'Offers'}));
 expect(screen.getByText('Selected',{exact:true})).toBeTruthy();expect(screen.getByText('Superseded',{exact:true})).toBeTruthy();expect(screen.getByText(/Selected 4 sheet/)).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Select quote'})).toBeNull();expect(screen.queryByRole('button',{name:'Record offer'})).toBeNull();
});

it('links retired requests to replacements and exposes replacement only on eligible requests',()=>{
 const previous={...order,id:'old',number:'RFQ-1',status:'cancelled' as const,replacedByRequestId:'new',vendorId:'supplier',rfqSnapshot:{quantity:5} as NonNullable<Order['rfqSnapshot']>};
 const next={...previous,id:'new',number:'RFQ-2',status:'enquiry' as const,replacedByRequestId:undefined,replacesRequestId:'old',replacementReason:'Drawing changed'};
 const onOpenRelated=vi.fn(),onReplaceRequest=vi.fn();
 const currentState={...state,data:{...state.data,orders:[previous,next]}};
 const {rerender}=render(<ProjectOrderDetail state={currentState} order={previous} busy={false} {...handlers()} onOpenRelated={onOpenRelated} onReplaceRequest={onReplaceRequest}/>);
 fireEvent.click(screen.getByRole('button',{name:'RFQ-2'}));expect(onOpenRelated).toHaveBeenCalledWith('new');expect(screen.queryByRole('button',{name:'Replace request'})).toBeNull();
 rerender(<ProjectOrderDetail state={currentState} order={next} busy={false} {...handlers()} onOpenRelated={onOpenRelated} onReplaceRequest={onReplaceRequest}/>);
 expect(screen.getByText('Drawing changed')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'RFQ-1'}));expect(onOpenRelated).toHaveBeenCalledWith('old');fireEvent.click(screen.getByRole('button',{name:'Replace request'}));expect(onReplaceRequest).toHaveBeenCalled();
});
