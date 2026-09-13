"use client";
import { useState } from "react";
import { DataGrid, ControlledModalDialog } from "@/design-system";
import type { CommercialState } from "@/lib/commercial/types";
import { money } from "@/lib/commercial/client";
import s from "./commercial.module.css";
export function ClientCredits({
  state,
  run,
  busy,
}: {
  state: CommercialState;
  run: (action: string, body?: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
}) {
  const [id, setId] = useState(""),
    [reference, setReference] = useState(""),
    [evidence, setEvidence] = useState("");
  if (!state.data.credits?.length) return null;
  return (
    <section className={s.form}>
      <h3>Approved client credits</h3>
      <p className={s.muted}>
        Accepted deductions reduce the contract value. Apply or refund the
        credit in the accounting company, then record its reconciliation.
      </p>
      <DataGrid ariaLabel="Client credits" data={state.data.credits} getRowId={row=>row.id} searchLabel="Search client credits" exportFileName="client-credits.csv"  columns={[{id:"variation",header:"Variation",size:150,accessorFn:(c)=>`V${state.data.quotes.find(q=>q.id===c.quoteId)?.number??"—"}`,cell:({row:{original:c}})=>{return <>
                  V{state.data.quotes.find((q) => q.id === c.quoteId)?.number}
                </>;}},
{id:"amount",header:"Client credit",size:170,accessorFn:(c)=>c.amount,cell:({row:{original:c}})=>{return <>{money(c.amount, c.currency)}</>;}},
{id:"status",header:"Accounting status",size:250,accessorFn:(c)=>c.status === "verified" ? "Reconciled" : "Accounting confirmation pending",cell:({row:{original:c}})=>{return <>
                  {c.status === "verified"
                    ? "Reconciled"
                    : "Accounting confirmation pending"}
                  <small className={s.detail}>{c.reference}</small>
                </>;}},
{id:"action",header:"Action",size:200,enableSorting:false,enableColumnFilter:false,cell:({row:{original:c}})=>{return <>
                  {c.status === "pending" && state.canApprove && (
                    <button
                      className={s.button}
                      disabled={busy}
                      onClick={() => {
                        setId(c.id);
                        setReference("");
                        setEvidence("");
                      }}
                    >
                      Verify credit / refund
                    </button>
                  )}
                </>;}}]}/>
      <ControlledModalDialog
        isOpen={Boolean(id)}
        onOpenChange={(v) => !v && setId("")}
        title="Verify client credit"
      >
        <form
          className={s.form}
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await run("verify_credit", { creditId: id, reference, evidence })
            )
              setId("");
          }}
        >
          <label>
            Accounting credit note / refund reference
            <input
              required
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
          <label>
            Verified application or refund evidence
            <textarea
              required
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
          </label>
          <p className={s.muted}>
            This records an accounting reconciliation. It does not issue a
            credit note or send a refund.
          </p>
          <button className={s.primary} disabled={busy}>
            Record verified credit
          </button>
        </form>
      </ControlledModalDialog>
    </section>
  );
}
