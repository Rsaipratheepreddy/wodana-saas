"use client";
import { useT } from "@/lib/i18n/i18n-provider";
import { useState } from "react";
import { DataGrid, ControlledModalDialog, useDesignSystem } from "@/design-system";
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
  const t = useT();
  const { locale } = useDesignSystem();
  const [id, setId] = useState(""),
    [reference, setReference] = useState(""),
    [evidence, setEvidence] = useState("");
  if (!state.data.credits?.length) return null;
  return (
    <section className={s.form}>
      <h3>{t("Approved client credits")}</h3>
      <p className={s.muted}>
        {t("Accepted deductions reduce the contract value. Apply or refund the credit in the accounting company, then record its reconciliation.")}</p>
      <DataGrid ariaLabel={t("Client credits")} data={state.data.credits} getRowId={row=>row.id} searchLabel={t("Search client credits")} exportFileName="client-credits.csv"  columns={[{id:"variation",header:t("Variation"),size:150,accessorFn:(c)=>`V${state.data.quotes.find(q=>q.id===c.quoteId)?.number??"—"}`,cell:({row:{original:c}})=>{return <>
                  V{state.data.quotes.find((q) => q.id === c.quoteId)?.number}
                </>;}},
{id:"amount",header:t("Client credit"),size:170,accessorFn:(c)=>c.amount,cell:({row:{original:c}})=>{return <>{money(c.amount, c.currency, locale)}</>;}},
{id:"status",header:t("Accounting status"),size:250,accessorFn:(c)=>c.status === "verified" ? t("Reconciled") : t("Accounting confirmation pending"),cell:({row:{original:c}})=>{return <>
                  {c.status === "verified"
                    ? t("Reconciled")
                    : t("Accounting confirmation pending")}
                  <small className={s.detail}>{c.reference}</small>
                </>;}},
{id:"action",header:t("Action"),size:200,enableSorting:false,enableColumnFilter:false,cell:({row:{original:c}})=>{return <>
                  {c.status === "pending" && state.canVerifyFinance && (
                    <button
                      className={s.button}
                      disabled={busy}
                      onClick={() => {
                        setId(c.id);
                        setReference("");
                        setEvidence("");
                      }}
                    >
                      {t("Verify credit / refund")}</button>
                  )}
                </>;}}]}/>
      <ControlledModalDialog
        isOpen={Boolean(id)}
        onOpenChange={(v) => !v && setId("")}
        title={t("Verify client credit")}
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
            {t("Accounting credit note / refund reference")}<input
              required
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
          <label>
            {t("Verified application or refund evidence")}<textarea
              required
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
          </label>
          <p className={s.muted}>
            {t("This records an accounting reconciliation. It does not issue a credit note or send a refund.")}</p>
          <button className={s.primary} disabled={busy}>
            {t("Record verified credit")}</button>
        </form>
      </ControlledModalDialog>
    </section>
  );
}
