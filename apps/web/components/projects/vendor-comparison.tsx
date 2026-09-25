"use client";
import { procurementContext, procurementLocationLabel } from "@/lib/projects/procurement-context";
import type {ReactNode} from "react";
import {Button, DataGrid, type DataGridColumn} from "@/design-system";
import type { Order, ProjectState } from "@/lib/projects/execution";
import { money } from "@/lib/commercial/client";
import {StateBadge} from "./project-stage";
export function VendorComparison({state,onChoose,onForm,onEdit,toolbarActions}:{state:ProjectState;onChoose:(o:Order)=>void;onForm:(id:string)=>void;onEdit:(o:Order)=>void;toolbarActions?:ReactNode}) {
 const quotes=(o:Order)=>o.vendorUpdates?.filter(u=>u.kind==="quotation") ?? [];
 const amount=(o:Order,first=false)=>{const quote=first?quotes(o)[0]:quotes(o).at(-1);return quote?.unitCost === undefined ? "Awaiting quote" : money(quote.unitCost*quote.quantity,o.currency)};
 const columns:DataGridColumn<Order>[]=[
  {id:"reference",header:"Reference",accessorFn:o=>o.number},
  {id:"requirement",header:"Requirement",accessorFn:o=>o.title,meta:{primary:true}},
  {id:"location",header:"For",accessorFn:o=>procurementLocationLabel(procurementContext(state.data,o).location)},
  {id:"supplier",header:"Supplier",accessorFn:o=>o.vendor},
  {id:"quantity",header:"Requested",accessorFn:o=>o.rfqSnapshot?.quantity??o.quantity,meta:{renderCell:o=>`${o.rfqSnapshot?.quantity??o.quantity} ${o.unit}`}},
  {id:"selectedQuantity",header:"Selected quantity",accessorFn:o=>o.sourceEnquiry&&o.status!=="cancelled"?o.quantity:0,meta:{renderCell:o=>o.sourceEnquiry&&o.status!=="cancelled"?<strong>{o.quantity} {o.unit}</strong>:"—"}},
  {id:"estimate",header:"Estimated cost",accessorFn:o=>state.data.materials.find(m=>m.id===o.materialId)?.estimatedUnitCost,meta:{renderCell:o=>{const cost=state.data.materials.find(m=>m.id===o.materialId)?.estimatedUnitCost;return cost===undefined?"Not estimated":money(cost*o.quantity,o.currency)}}},
  {id:"original",header:"Original quote",accessorFn:o=>amount(o,true)},
  {id:"latest",header:"Latest quote",accessorFn:o=>amount(o)},
  {id:"delivery",header:"Delivery",accessorFn:o=>quotes(o).at(-1)?.date || o.promisedDate},
  {id:"response",header:"Response",accessorFn:o=>quotes(o).length?"Quote received":"Awaiting response"},
  {id:"due",header:"Quotes due",accessorFn:o=>o.quoteDueDate??"—"},
  {id:"decision",header:"Decision",accessorFn:o=>o.status,meta:{renderCell:o=>o.status!=="enquiry"?<StateBadge state={o.replacedByRequestId?"replaced":o.status==="cancelled"?"cancelled":"selected"}/>:state.canBuy?<span data-grid-interactive><Button size="compact" onPress={()=>onForm(o.id)}>Share request</Button> <Button size="compact" isDisabled={!quotes(o).length} onPress={()=>onChoose(o)}>Select quote</Button></span>:<StateBadge state="enquiry"/>}},
 ];
 return <DataGrid gridLines ariaLabel="Supplier quotes" persistKey="project-supplier-quotes" savedViews={[{id:"all",label:"All supplier quotes"}]} rowNumbers={false} columns={columns} data={state.data.orders.filter(o=>o.status==="enquiry" || o.sourceEnquiry || o.rfqSnapshot || o.replacedByRequestId)} getRowId={o=>o.id} onRowAction={onEdit} pageSize={50} searchLabel="Search supplier quotes" exportFileName="supplier-quotes.csv" toolbarActions={toolbarActions} emptyTitle="No supplier quotes" emptyDescription="Request supplier quotes for a requirement to compare suppliers here."/>;
}
