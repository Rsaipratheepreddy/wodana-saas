"use client";
import { useEffect, useState } from "react";
import {Button, ControlledModalDialog, DataGrid, type DataGridColumn} from "@/design-system";

import {
  commercialPath,
  jsonRequest,
  money,
  paymentIsVerified,
  statusLabel,
} from "@/lib/commercial/client";
import type { CommercialState, Payment } from "@/lib/commercial/types";
import {ProjectAccountingConnections} from "./project-accounting-connections";
import { PaymentInvoice } from "../commercial/payment-invoice";
import s from "./project-workspace.module.css";

export function ProjectAccounting({
  workspaceId,
  caseId,
}: {
  workspaceId: string;
  caseId: string;
}) {
  const [state, setState] = useState<CommercialState | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selected,setSelected]=useState<string|null>(null);
  const [agreementOpen,setAgreementOpen]=useState(false);
  const path = commercialPath(workspaceId, `cases/${caseId}`);
  useEffect(() => {
    let active = true;
    jsonRequest<CommercialState>(path)
      .then((s) => {
        if (active) setState(s);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [path]);
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      setState(await jsonRequest<CommercialState>(path));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function run(action: string, body: Record<string, unknown>) {
    if (action !== "invoice") return false;
    setBusy(true);
    setError("");
    try {
      await jsonRequest(
        commercialPath(workspaceId, `cases/${caseId}/invoice`),
        "POST",
        body,
      );
      setState(await jsonRequest<CommercialState>(path));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const payment=state?.data.payments.find(item=>item.id===selected);
  const columns:DataGridColumn<Payment>[]=[
    {id:'title',header:'Payment milestone',accessorFn:p=>p.title,meta:{primary:true,renderCell:p=><strong>{p.title}</strong>}},
    {id:'amount',header:'Amount',accessorFn:p=>p.amount,meta:{align:'end',renderCell:p=>money(p.amount,state?.currency)}},
    {id:'due',header:'Due',accessorFn:p=>p.dueDate||p.trigger||'Not scheduled'},
    {id:'invoice',header:'Invoice',accessorFn:p=>p.invoice?.number||'Not linked'},
    {id:'status',header:'Status',accessorFn:p=>paymentIsVerified(p)?'Verified paid':statusLabel[p.status]??p.status},
    {id:'actions',header:'',enableSorting:false,meta:{renderCell:p=><Button size="compact" onPress={()=>setSelected(p.id)}>View payment</Button>}},
  ];
  return <div>
    <ProjectAccountingConnections workspaceId={workspaceId}/>
    {error&&<p role="alert" className={s.error}>{error}</p>}
    {!state&&!error&&<p role="status">Loading payments…</p>}
    {state&&<DataGrid gridLines ariaLabel="Client payments" rowNumbers={false} columns={columns} data={state.data.payments} getRowId={p=>p.id} onRowAction={p=>setSelected(p.id)} searchLabel="Search client payments" toolbarActions={<><Button size="compact" onPress={()=>setAgreementOpen(true)}>View agreement</Button><Button size="compact" isDisabled={busy} onPress={()=>void refresh()}>Refresh</Button></>} emptyTitle="No client payment schedule" emptyDescription="Payment milestones appear here when the client agreement is recorded."/>}
    <ControlledModalDialog isOpen={!!payment} onOpenChange={open=>!open&&setSelected(null)} title={payment?.title??'Payment details'} size="md">
      {state&&payment&&<div className={s.form}>
        <dl><dt>Amount</dt><dd>{money(payment.amount,state.currency)}</dd><dt>Due</dt><dd>{payment.dueDate||payment.trigger||'Not scheduled'}</dd><dt>Status</dt><dd>{paymentIsVerified(payment)?'Verified paid':statusLabel[payment.status]??payment.status}</dd></dl>
        {payment.reference&&<p>Reference: {payment.reference}</p>}
        {payment.proof&&<p style={{whiteSpace:'pre-wrap'}}>Payment evidence: {payment.proof}</p>}
        <PaymentInvoice workspaceId={workspaceId} payment={payment} busy={busy} canVerifyFinance={state.canVerifyFinance} run={run} currency={state.currency} customerName={state.customerName}/>
      </div>}
    </ControlledModalDialog>
    <ControlledModalDialog isOpen={agreementOpen} onOpenChange={setAgreementOpen} title="Client agreement" size="md">
      {state?.data.agreement?<div className={s.form}><strong>{state.data.agreement.reference}</strong><p>{statusLabel[state.data.agreement.status]??state.data.agreement.status}</p><p style={{whiteSpace:'pre-wrap'}}>{state.data.agreement.terms||'No additional terms recorded.'}</p></div>:<p>No client agreement recorded yet.</p>}
    </ControlledModalDialog>
  </div>;
}
