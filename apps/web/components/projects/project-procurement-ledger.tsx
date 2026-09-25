"use client";
import { acceptedOrderQuantity, orderReceivingPosition, procurementContext, procurementLocationLabel } from "@/lib/projects/procurement-context";
import type {ReactNode} from "react";
import { Button, DataGrid, type DataGridColumn } from "@/design-system";
import { money } from "@/lib/commercial/client";
import type { Order, ProjectState, SupplierInvoice } from "@/lib/projects/execution";
import { StateBadge } from "./project-stage";
import styles from "./project-procurement-ledger.module.css";

export const invoiceTotal = (invoice: SupplierInvoice) => invoice.quantity * invoice.unitCost + invoice.tax;
export const invoicePaid = (invoice: SupplierInvoice) => invoice.payments.reduce((n, p) => n + p.amount, 0);
export function ProcurementTotals({ state }: { state: ProjectState }) {
  const d = state.data, currency = d.scope?.currency;
  const committed = d.orders.filter(o => ["approved", "acknowledged", "closed"].includes(o.status)).reduce((n,o) => n + o.quantity*o.unitCost,0);
  const approved = (d.supplierInvoices ?? []).filter(i => i.status === "approved");
  const billed = approved.reduce((n,i)=>n+i.quantity*i.unitCost,0);
  const paid = approved.reduce((n,i)=>n+invoicePaid(i),0);
  return <dl className={styles.totals} aria-label="Procurement budget"><div><dt>Approved budget</dt><dd>{d.budget ? money(d.budget,currency) : "Not set"}</dd></div><div><dt>Ordered · before tax</dt><dd>{money(committed,currency)}</dd></div><div><dt>Invoiced · before tax</dt><dd>{money(billed,currency)}</dd></div><div><dt>Paid · including tax</dt><dd>{money(paid,currency)}</dd></div><div><dt>Uncommitted budget</dt><dd>{d.budget ? money(d.budget-committed,currency) : "—"}</dd></div></dl>;
}
export function SupplierInvoices({state,search,busy,onEdit,onApprove,onPay,toolbarActions}:{state:ProjectState;search:string;busy:boolean;toolbarActions?:ReactNode;onEdit:(i:SupplierInvoice)=>void;onApprove:(i:SupplierInvoice)=>void;onPay:(i:SupplierInvoice)=>void}) {
  const order = (i:SupplierInvoice) => state.data.orders.find(o=>o.id===i.orderId);
  const columns:DataGridColumn<SupplierInvoice>[] = [
    {id:"number",header:"Invoice",accessorFn:i=>i.number,meta:{primary:true,renderCell:i=><strong>{i.number}</strong>}},
    {id:"supplier",header:"Supplier / order",accessorFn:i=>order(i)?.vendor ?? "",meta:{renderCell:i=><span>{order(i)?.vendor}<small className={styles.secondary}>{order(i)?.number}</small></span>}},
    {id:"due",header:"Due",accessorFn:i=>i.dueDate},
    {id:"total",header:"Total incl. tax",accessorFn:invoiceTotal,meta:{renderCell:i=>money(invoiceTotal(i),order(i)?.currency)}},
    {id:"balance",header:"Balance",accessorFn:i=>invoiceTotal(i)-invoicePaid(i),meta:{renderCell:i=>money(invoiceTotal(i)-invoicePaid(i),order(i)?.currency)}},
    {id:"status",header:"Status",accessorFn:i=>i.status,meta:{renderCell:i=><StateBadge state={i.status==="draft"?"review":invoiceTotal(i)-invoicePaid(i)<0.005?"paid":invoicePaid(i)>0?"part_paid":"approved"}/>}},
    {id:"action",header:"",enableSorting:false,meta:{renderCell:i=><div className={styles.actions}><Button size="compact" onPress={()=>onEdit(i)}>{i.status==="draft"?"Review":"Details"}</Button>{state.canReview && <Button size="compact" isDisabled={busy || (i.status==="approved" && invoiceTotal(i)-invoicePaid(i)<0.005)} onPress={()=>i.status==="draft"?onApprove(i):onPay(i)}>{i.status==="draft"?"Approve":"Record payment"}</Button>}</div>}},
  ];
  return <DataGrid gridLines rowNumbers={false} toolbarActions={toolbarActions} persistKey="project-supplier-invoices" savedViews={[{id:"all",label:"All invoices"}]} searchLabel="Search invoices" exportFileName="supplier-invoices.csv" ariaLabel="Supplier invoices" columns={columns} data={(state.data.supplierInvoices??[]).filter(i=>`${i.number} ${order(i)?.vendor} ${order(i)?.number}`.toLowerCase().includes(search.toLowerCase()))} getRowId={i=>i.id} onRowAction={onEdit} emptyTitle="No supplier invoices" emptyDescription="Record a supplier invoice against an approved order. Accepted goods or certified service quantities are checked before approval."/>;
}
export function ProcurementDeliveries({state,search,onReceive,onOpen,toolbarActions}:{state:ProjectState;search:string;toolbarActions?:ReactNode;onReceive:(o:Order)=>void;onOpen:(o:Order)=>void}) {
  const received=(o:Order)=>acceptedOrderQuantity(state.data,o);
  const columns:DataGridColumn<Order>[]=[
    {id:"number",header:"Order",accessorFn:o=>o.number,meta:{primary:true,renderCell:o=><span><strong>{o.number}</strong><small className={styles.secondary}>{o.title}</small></span>}},
    {id:"location",header:"For",accessorFn:o=>procurementLocationLabel(procurementContext(state.data,o).location)},
    {id:"shipment",header:"Shipment",accessorFn:o=>{if(o.kind==="subcontract")return "Service acceptance";const latest=o.shipments?.at(-1);return latest?`${latest.status} · ${latest.reference}`:"No update";}},
    {id:"vendor",header:"Supplier",accessorFn:o=>o.vendor},
    {id:"date",header:"Expected",accessorFn:o=>o.promisedDate},
    {id:"ordered",header:"Ordered",accessorFn:o=>o.quantity,meta:{renderCell:o=>`${o.quantity} ${o.unit}`}},
    {id:"arrived",header:"Delivered / measured",accessorFn:o=>o.receipts.reduce((n,r)=>n+r.accepted+r.rejected+(r.pending??0),0)},
    {id:"pending_qc",header:"Pending review",accessorFn:o=>o.receipts.reduce((n,r)=>n+(r.pending??0),0)},
    {id:"accepted",header:"Accepted / certified",accessorFn:received},
    {id:"rejected",header:"Rejected",accessorFn:o=>o.receipts.reduce((n,r)=>n+r.rejected,0)},
    {id:"remaining",header:"To arrive",accessorFn:o=>orderReceivingPosition(state.data,o).remainingToArrive},
    {id:"action",header:"",meta:{renderCell:o=>{const position=orderReceivingPosition(state.data,o);const inspect=o.status==="acknowledged"&&position.remainingToArrive===0&&position.pendingInspection>0;return <div className={styles.actions}><Button size="compact" onPress={()=>onOpen(o)}>{o.kind==="subcontract"?"Acceptance history":"Receipt history"}</Button>{inspect?state.canReview?<Button size="compact" variant="primary" onPress={()=>onOpen(o)}>{o.kind==="subcontract"?"Certify work":"Inspect delivery"}</Button>:<span>Awaiting inspection</span>:state.canBuy&&o.status!=="closed"?<Button size="compact" variant="primary" onPress={()=>onReceive(o)}>{o.status==="approved"?"Confirm dates":position.remainingToArrive===0?"Close order":o.kind==="subcontract"?"Accept measured service":"Receive materials"}</Button>:<StateBadge state={o.status}/>}</div>}}},
  ];
  return <DataGrid gridLines wrapText rowNumbers={false} toolbarActions={toolbarActions} persistKey="project-supplier-deliveries" savedViews={[{id:"all",label:"All deliveries"}]} searchLabel="Search deliveries" exportFileName="supplier-deliveries.csv" ariaLabel="Supplier deliveries" columns={columns} data={state.data.orders.filter(o=>["approved","acknowledged","closed"].includes(o.status)&&`${o.number} ${o.title} ${o.vendor}`.toLowerCase().includes(search.toLowerCase()))} getRowId={o=>o.id} onRowAction={onOpen} emptyTitle="No deliveries expected" emptyDescription="Approved orders appear here for delivery tracking and acceptance."/>;
}
