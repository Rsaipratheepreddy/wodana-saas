"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, DataGrid, EmptyState, ErrorState, InlineNotice, InspectorSheet, NoResultsState, Skeleton, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PayablesApi } from "@/lib/payables/client";
import type { PayablesState, SupplierBalance, SupplierState } from "@/lib/payables/types";
import { useProjectFormat } from "../project-core/format";
import { BillStatusLabel, plain } from "./finance-labels";
import { PaymentDialog } from "./payment-dialog";
import styles from "./finance.module.css";

/** What each supplier is owed, per buying company and currency: overdue first. */
export function SuppliersOwed({ api, state, error, openId, onReload, onOpen, onOpenBill, onOpenPayment }: {
  api: PayablesApi; state: PayablesState | null; error: string; openId: string | null; onReload: () => void; onOpen: (id: string | null) => void;
  onOpenBill: (id: string) => void; onOpenPayment: (id: string) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [search, setSearch] = useState("");
  const needle = search.trim().toLocaleLowerCase();
  const rows = (state?.suppliers ?? []).filter((row) => !needle || `${row.supplierName} ${row.companyName}`.toLocaleLowerCase().includes(needle))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.supplierName.localeCompare(b.supplierName));
  const columns = useMemo<DataGridColumn<SupplierBalance>[]>(() => [
    { id: "supplier", header: t("Supplier"), accessorFn: (row) => row.supplierName, size: 300, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.supplierName}</span><small>{row.companyName}</small></span> } },
    { id: "owed", header: t("Owed"), accessorFn: (row) => Number(row.owed), size: 190, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <span className={styles.money}>{Number(row.owed) < 0 ? t("{amount} paid ahead", { amount: format.money(plain(row.owed).replace("-", ""), row.currency) }) : format.money(row.owed, row.currency)}</span>
      {Number(row.held) > 0 ? <small>{t("{amount} held", { amount: format.money(row.held, row.currency) })}</small> : null}
      {Number(row.retention) > 0 ? <small>{t("{amount} retention", { amount: format.money(row.retention, row.currency) })}</small> : null}</span> } },
    { id: "overdue", header: t("Overdue"), accessorFn: (row) => Number(row.overdue), size: 170, meta: { renderCell: (row) => Number(row.overdue) > 0
      ? <span className={`${styles.money} ${styles.lateText}`}>{format.money(row.overdue, row.currency)}</span> : <span className={styles.muted}>—</span> } },
  ], [t, format]);
  if (error && !state) return <ErrorState description={error} onRetry={onReload} />;
  return <>
    <DataGrid<SupplierBalance> appearance="flush" ariaLabel={t("Owed to suppliers")} columns={columns} data={rows} getRowId={(row) => `${row.vendorId}|${row.legalEntityId}|${row.currency}`}
      isLoading={!state} onRowAction={(row) => onOpen(row.vendorId)} onSearchChange={setSearch} searchValue={search} searchLabel={t("Search suppliers")} rowNumbers={false} wrapText
      emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={t("Nothing owed to suppliers")} />} />
    {openId ? <OwedSheet api={api} vendorId={openId} onChanged={onReload} onClose={() => onOpen(null)} onOpenBill={onOpenBill} onOpenPayment={onOpenPayment} /> : null}
  </>;
}

/** One supplier's account: owed per company, open invoices, debit notes from credited returns, and payments. */
function OwedSheet({ api, vendorId, onChanged, onClose, onOpenBill, onOpenPayment }: {
  api: PayablesApi; vendorId: string; onChanged: () => void; onClose: () => void; onOpenBill: (id: string) => void; onOpenPayment: (id: string) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const today = format.today();
  const [state, setState] = useState<SupplierState | null>(null);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);
  const load = useCallback(async () => {
    try { setState(await api.supplier(vendorId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The supplier didn't load.")); }
  }, [api, vendorId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const open = (state?.bills ?? []).filter((bill) => ["draft", "held"].includes(bill.status) || (bill.status === "approved" && Number(bill.balance) > 0));
  return <InspectorSheet isOpen size="lg" title={state?.supplier.name ?? t("Supplier")} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={state?.canManage ? <div className="wd-dialog-actions"><span className={styles.spacer} />
      <Button variant="primary" onPress={() => setPaying(true)}>{t("Record payment")}</Button></div> : null}>
    {error && !state ? <ErrorState description={error} onRetry={() => void load()} /> : !state ? <Skeleton lines={8} shape="rows" /> : <div className={styles.sheet}>
      {state.supplier.bankChangePending ? <InlineNotice tone="info" message={t("New bank details are waiting for approval. Pay into the approved account.")} /> : null}
      <dl className={styles.facts}>
        {state.balances.map((row) => <div key={`${row.legalEntityId}|${row.currency}`}><dt>{row.companyName}</dt><dd>
          <span className={styles.money}>{Number(row.owed) < 0 ? t("{amount} paid ahead", { amount: format.money(plain(row.owed).replace("-", ""), row.currency) })
            : t("{amount} owed", { amount: format.money(row.owed, row.currency) })}</span>
          {Number(row.overdue) > 0 ? <span className={styles.lateText}>{t("{amount} overdue", { amount: format.money(row.overdue, row.currency) })}</span> : null}
          {Number(row.retention) > 0 ? <span className={styles.muted}>{t("{amount} retention held", { amount: format.money(row.retention, row.currency) })}</span> : null}
          {Number(row.debited) > 0 ? <span className={styles.muted}>{t("{amount} in debit notes", { amount: format.money(row.debited, row.currency) })}</span> : null}
        </dd></div>)}
        <div><dt>{t("Bank account")}</dt><dd>{state.supplier.bank ? t("{bank} ending {digits}", { bank: state.supplier.bank.bankName, digits: state.supplier.bank.last4 })
          : <span className={styles.muted}>{t("None approved")}</span>}</dd></div>
        {state.supplier.creditDays ? <div><dt>{t("Credit")}</dt><dd>{t("{count} days", { count: state.supplier.creditDays })}</dd></div> : null}
      </dl>
      {open.length ? <section className={styles.part} aria-label={t("Open invoices")}>
        <h3 className={styles.subhead}>{t("Open invoices")}</h3>
        <ul className={styles.list}>{open.map((bill) => <li key={bill.id}>
          <span className={styles.nameCell}><button type="button" className={styles.linkButton} onClick={() => onOpenBill(bill.id)}>{bill.number}</button>
            <small>{[bill.dueDate ? t("Due {date}", { date: format.day(bill.dueDate) }) : "", bill.orders.join(", ")].filter(Boolean).join(" · ")}</small></span>
          <span className={styles.nameCell}><span className={styles.money}>{format.money(bill.status === "approved" ? bill.balance : bill.total, bill.currency)}</span>
            <BillStatusLabel bill={bill} today={today} /></span>
        </li>)}</ul>
      </section> : null}
      {state.debitNotes.length ? <section className={styles.part} aria-label={t("Debit notes")}>
        <h3 className={styles.subhead}>{t("Debit notes")}</h3>
        <ul className={styles.list}>{state.debitNotes.map((note) => <li key={note.orderLineId}>
          <span className={styles.nameCell}><span>{note.description}</span><small>{`${note.orderNumber} · ${plain(note.quantity)} ${note.unit}`.trim()}</small></span>
          <span className={styles.money}>{format.money(note.amount, note.currency)}</span></li>)}</ul>
      </section> : null}
      {state.payments.length ? <section className={styles.part} aria-label={t("Payments")}>
        <h3 className={styles.subhead}>{t("Payments")}</h3>
        <ul className={styles.list}>{state.payments.slice(0, 20).map((payment) => <li key={payment.id}>
          <button type="button" className={styles.linkButton} onClick={() => onOpenPayment(payment.id)}>{[format.day(payment.paidOn), payment.reference].filter(Boolean).join(" · ")}</button>
          <span className={payment.status === "reversed" ? `${styles.money} ${styles.lateText}` : styles.money}>{format.money(payment.amount, payment.currency)}</span></li>)}</ul>
      </section> : null}
    </div>}
    {paying ? <PaymentDialog api={api} vendorId={vendorId} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); onChanged(); void load(); }} /> : null}
  </InspectorSheet>;
}
