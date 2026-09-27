"use client";

import { useMemo, useState } from "react";
import { Button, ControlledModalDialog, DataGrid, EmptyState, ErrorState, InlineNotice, InspectorSheet, NoResultsState, TextAreaField, TextInput, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PayablesApi } from "@/lib/payables/client";
import type { PayablesState, SupplierPayment } from "@/lib/payables/types";
import { addExact, subtractExact } from "@/lib/purchasing/amounts";
import { useProjectFormat } from "../project-core/format";
import { plain, useMethodLabels } from "./finance-labels";
import styles from "./finance.module.css";

const numeric = (value: string) => value.replace(/[^\d.]/g, "");

/** Payments made to suppliers, newest first, each with what it paid and what's still to allocate. */
export function Payments({ api, state, error, openId, onReload, onOpen, onOpenBill }: {
  api: PayablesApi; state: PayablesState | null; error: string; openId: string | null; onReload: () => void; onOpen: (id: string | null) => void; onOpenBill: (id: string) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const methods = useMethodLabels();
  const [search, setSearch] = useState("");
  const needle = search.trim().toLocaleLowerCase();
  const rows = (state?.payments ?? []).filter((row) => !needle || `${row.supplierName} ${row.reference} ${row.orderNumber ?? ""} ${row.allocations.map((item) => item.number).join(" ")}`
    .toLocaleLowerCase().includes(needle));
  const columns = useMemo<DataGridColumn<SupplierPayment>[]>(() => [
    { id: "supplier", header: t("Supplier"), accessorFn: (row) => row.supplierName, size: 300, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.supplierName}</span>
      <small>{[methods[row.method], row.reference, ...(row.orderNumber ? [t("Advance on {order}", { order: row.orderNumber })] : []), ...row.allocations.map((item) => item.number)]
        .filter(Boolean).join(" · ")}</small></span> } },
    { id: "paid", header: t("Paid on"), accessorFn: (row) => row.paidOn, size: 140, meta: { mobileHidden: true, renderCell: (row) => <span>{format.day(row.paidOn)}</span> } },
    { id: "amount", header: t("Amount"), accessorFn: (row) => Number(row.amount), size: 190, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <span className={styles.money}>{format.money(row.amount, row.currency)}</span>
      {row.status === "recorded" && Number(row.unallocated) > 0 ? <small>{t("{amount} to allocate", { amount: format.money(row.unallocated, row.currency) })}</small> : null}</span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => row.status, size: 150, meta: { renderCell: (row) => <span className={styles.status}
      data-tone={row.status === "reversed" ? "danger" : "success"}>{row.status === "reversed" ? t("Reversed") : t("Paid")}</span> } },
  ], [t, format, methods]);
  if (error && !state) return <ErrorState description={error} onRetry={onReload} />;
  const payment = state?.payments.find((row) => row.id === openId) ?? null;
  return <>
    <DataGrid<SupplierPayment> appearance="flush" ariaLabel={t("Payments")} columns={columns} data={rows} getRowId={(row) => row.id} isLoading={!state} onRowAction={(row) => onOpen(row.id)}
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search payments")} rowNumbers={false} wrapText
      emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={t("No payments yet")} description={t("Record one from an approved invoice or a supplier.")} />} />
    {payment && state ? <PaymentSheet api={api} payment={payment} canManage={state.canManage} bills={state.bills} onChanged={onReload} onClose={() => onOpen(null)} onOpenBill={onOpenBill} /> : null}
  </>;
}

/** One payment: what it paid, what's left to put against invoices, and reversing it if it didn't go through. */
function PaymentSheet({ api, payment, canManage, bills, onChanged, onClose, onOpenBill }: {
  api: PayablesApi; payment: SupplierPayment; canManage: boolean; bills: PayablesState["bills"]; onChanged: () => void; onClose: () => void; onOpenBill: (id: string) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const methods = useMethodLabels();
  const [dialog, setDialog] = useState<"allocate" | "reverse" | null>(null);
  const [reason, setReason] = useState("");
  const [parts, setParts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const money = (value: string) => format.money(value, payment.currency);
  const recorded = payment.status === "recorded";
  const open = bills.filter((bill) => bill.status === "approved" && Number(bill.balance) > 0 && bill.vendorId === payment.vendorId && bill.legalEntityId === payment.legalEntityId
    && bill.currency === payment.currency && (!payment.orderNumber || bill.orders.includes(payment.orderNumber)));
  const allocating = addExact(...Object.values(parts));
  const over = subtractExact(allocating, payment.unallocated) !== "0";
  const run = async (action: "allocate" | "reverse", input: Record<string, unknown>) => {
    setBusy(true); setNotice("");
    try { await api.paymentCommand(action, { paymentId: payment.id, ...input }); onChanged(); setDialog(null); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); } finally { setBusy(false); }
  };
  return <InspectorSheet isOpen size="md" title={`${payment.supplierName} · ${money(payment.amount)}`} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={canManage && recorded ? <div className="wd-dialog-actions">
      <Button variant="quiet" onPress={() => { setReason(""); setNotice(""); setDialog("reverse"); }}>{t("Reverse")}</Button><span className={styles.spacer} />
      {Number(payment.unallocated) > 0 && open.length ? <Button variant="primary" onPress={() => { setParts({}); setNotice(""); setDialog("allocate"); }}>{t("Allocate")}</Button> : null}
    </div> : null}>
    <div className={styles.sheet}>
      {payment.status === "reversed" ? <InlineNotice tone="info" message={t("Reversed: {reason}", { reason: payment.reverseReason ?? "" })} /> : null}
      <dl className={styles.facts}>
        <div><dt>{t("Paid on")}</dt><dd>{format.day(payment.paidOn)}</dd></div>
        <div><dt>{t("How")}</dt><dd>{[methods[payment.method], payment.reference].filter(Boolean).join(" · ")}</dd></div>
        <div><dt>{t("Paid by")}</dt><dd>{payment.companyName}</dd></div>
        {payment.orderNumber ? <div><dt>{t("Advance on")}</dt><dd>{payment.orderNumber}</dd></div> : null}
        <div><dt>{t("To allocate")}</dt><dd className={styles.money}>{money(payment.unallocated)}</dd></div>
        <div><dt>{t("Recorded by")}</dt><dd>{payment.createdByName}</dd></div>
      </dl>
      {payment.allocations.length ? <section className={styles.part} aria-label={t("Invoices it pays")}>
        <h3 className={styles.subhead}>{t("Invoices it pays")}</h3>
        <ul className={styles.list}>{payment.allocations.map((item, index) => <li key={`${item.invoiceId}-${index}`}>
          <button type="button" className={styles.linkButton} onClick={() => onOpenBill(item.invoiceId)}>{item.number}</button>
          <span className={styles.money}>{money(item.amount)}</span></li>)}</ul>
      </section> : null}
    </div>
    {dialog ? <ControlledModalDialog isOpen size="md" title={dialog === "allocate" ? t("Allocate payment") : t("Reverse payment")} onOpenChange={(value) => { if (!value) setDialog(null); }}
      footer={<div className="wd-dialog-actions"><Button onPress={() => setDialog(null)}>{t("Back")}</Button>
        {dialog === "allocate" ? <Button variant="primary" isLoading={busy} isDisabled={allocating === "0" || over}
          onPress={() => void run("allocate", { allocations: Object.entries(parts).filter(([, value]) => Number(value) > 0).map(([invoiceId, amount]) => ({ invoiceId, amount })) })}>{t("Allocate")}</Button>
          : <Button variant="danger" isLoading={busy} isDisabled={!reason.trim()} onPress={() => void run("reverse", { reason: reason.trim() })}>{t("Reverse payment")}</Button>}</div>}>
      <div className={styles.dialogBody}>
        {notice ? <InlineNotice tone="error" message={notice} /> : null}
        {dialog === "allocate" ? <>
          <p className={styles.muted}>{t("{amount} to allocate", { amount: money(payment.unallocated) })}</p>
          <div className={styles.allocations}>{open.map((bill) => <div key={bill.id} className={styles.allocation}>
            <span className={styles.nameCell}><span>{bill.number}</span><small>{t("{amount} left", { amount: money(bill.balance) })}</small></span>
            <TextInput aria-label={t("Amount for {invoice}", { invoice: bill.number })} label={null} inputMode="decimal" value={parts[bill.id] ?? ""} placeholder={plain(bill.balance)}
              onChange={(value) => setParts({ ...parts, [bill.id]: numeric(value) })} />
          </div>)}</div>
          {over ? <InlineNotice tone="error" message={t("That's more than is left of the payment.")} /> : null}
        </> : <TextAreaField label={t("Why it's reversed")} description={t("A bounced cheque or a returned transfer. Its invoices are owed again.")} isRequired value={reason} onChange={setReason} />}
      </div>
    </ControlledModalDialog> : null}
  </InspectorSheet>;
}
