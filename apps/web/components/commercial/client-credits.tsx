"use client";
import { useT } from "@/lib/i18n/i18n-provider";
import { useState } from "react";
import { Button, DataGrid, FormDialog, FormNotSaved, TextAreaField, TextInput, useDesignSystem } from "@/design-system";
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
                    <Button size="compact" isDisabled={busy} onPress={() => { setId(c.id); setReference(""); setEvidence(""); }}>
                      {t("Verify credit / refund")}</Button>
                  )}
                </>;}}]}/>
      <FormDialog
        isOpen={Boolean(id)}
        onClose={() => setId("")}
        title={t("Verify client credit")}
        isSubmitting={busy}
        isDirty={Boolean(reference.trim() || evidence.trim())}
        submitLabel={t("Record verified credit")}
        onSubmit={async () => { if (!(await run("verify_credit", { creditId: id, reference, evidence }))) throw new FormNotSaved(); setId(""); }}
      >
        <TextInput isRequired maxLength={240} label={t("Accounting credit note / refund reference")} value={reference} onChange={setReference} />
        <TextAreaField isRequired label={t("Verified application or refund evidence")} value={evidence} onChange={setEvidence} />
      </FormDialog>
    </section>
  );
}
