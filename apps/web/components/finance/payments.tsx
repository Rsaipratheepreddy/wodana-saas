"use client";

import { useMemo, useState } from "react";
import { Badge, Button, DataGrid, EditableFieldList, EmptyState, ErrorState, FactRow, FormDialog, InlineNotice, InspectorSheet, MoneyField, NoResultsState, ReasonDialog, VisuallyHidden, RecordName, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PayablesApi } from "@/lib/payables/client";
import type { PayablesState, SupplierPayment } from "@/lib/payables/types";
import { addExact, subtractExact } from "@/lib/purchasing/amounts";
import { useProjectFormat } from "../project-core/format";
import { useMethodLabels } from "./finance-labels";
import styles from "./finance.module.css";


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
    { id: "supplier", header: t("Supplier"), accessorFn: (row) => row.supplierName, size: 300, meta: { primary: true, renderCell: (row) => <RecordName title={row.supplierName}
      detail={[methods[row.method], row.reference, ...(row.orderNumber ? [t("Advance on {order}", { order: row.orderNumber })] : []),
        ...(row.runNumber ? [t("Run {number}", { number: row.runNumber })] : []), ...row.allocations.map((item) => item.number)]
        .filter(Boolean).join(" · ")} /> } },
    { id: "paid", header: t("Paid on"), accessorFn: (row) => row.paidOn, size: 140, meta: { mobileHidden: true, renderCell: (row) => <span>{format.day(row.paidOn)}</span> } },
    { id: "amount", header: t("Amount"), accessorFn: (row) => Number(row.amount), size: 190, meta: { align: "end", renderCell: (row) => <span className={styles.nameCell}>
      <span className={styles.money}>{format.money(row.amount, row.currency)}</span>
      {row.status === "recorded" && Number(row.unallocated) > 0 ? <small>{t("{amount} to allocate", { amount: format.money(row.unallocated, row.currency) })}</small> : null}</span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => row.status, size: 150, meta: { renderCell: (row) => <Badge tone={row.status === "reversed" ? "danger" : "success"}>{row.status === "reversed" ? t("Reversed") : t("Paid")}</Badge> } },
  ], [t, format, methods]);
  if (error && !state) return <ErrorState description={error} onRetry={onReload} />;
  const payment = state?.payments.find((row) => row.id === openId) ?? null;
  return <>
    <DataGrid<SupplierPayment> ariaLabel={t("Payments")} columns={columns} data={rows} getRowId={(row) => row.id} isLoading={!state} onRowAction={(row) => onOpen(row.id)}
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search payments")} rowNumbers={false}
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
  const [parts, setParts] = useState<Record<string, string>>({});
  const money = (value: string) => format.money(value, payment.currency);
  const recorded = payment.status === "recorded";
  const open = bills.filter((bill) => bill.status === "approved" && Number(bill.payable) > 0 && bill.vendorId === payment.vendorId && bill.legalEntityId === payment.legalEntityId
    && bill.currency === payment.currency && (!payment.orderNumber || bill.orders.includes(payment.orderNumber)));
  const allocating = addExact(...Object.values(parts));
  const over = subtractExact(allocating, payment.unallocated) !== "0";
  /** Runs one change; a refusal keeps the dialog open with why. */
  const run = async (action: "allocate" | "reverse", input: Record<string, unknown>) => {
    await api.paymentCommand(action, { paymentId: payment.id, ...input }); onChanged(); setDialog(null);
  };
  return <InspectorSheet isOpen size="md" title={`${payment.supplierName} · ${money(payment.amount)}`} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={canManage && recorded ? <div className="wd-dialog-actions">
      <Button variant="quiet" onPress={() => setDialog("reverse")}>{t("Reverse")}</Button><span className={styles.spacer} />
      {Number(payment.unallocated) > 0 && open.length ? <Button variant="primary" onPress={() => { setParts({}); setDialog("allocate"); }}>{t("Allocate")}</Button> : null}
    </div> : null}>
    <div className={styles.sheet}>
      {payment.status === "reversed" ? <InlineNotice tone="info" message={t("Reversed: {reason}", { reason: payment.reverseReason ?? "" })} /> : null}
      <EditableFieldList>
        <FactRow label={t("Paid on")}>{format.day(payment.paidOn)}</FactRow>
        <FactRow label={t("How")}>{[methods[payment.method], payment.reference].filter(Boolean).join(" · ")}</FactRow>
        <FactRow label={t("Paid by")}>{payment.companyName}</FactRow>
        {payment.orderNumber ? <FactRow label={t("Advance on")}>{payment.orderNumber}</FactRow> : null}
        {payment.runNumber ? <FactRow label={t("Paid in")}>{t("Run {number}", { number: payment.runNumber })}</FactRow> : null}
        <FactRow label={t("To allocate")}><span className={styles.money}>{money(payment.unallocated)}</span></FactRow>
        <FactRow label={t("Recorded by")}>{payment.createdByName}</FactRow>
      </EditableFieldList>
      {payment.allocations.length ? <section className={styles.part} aria-label={t("Invoices it pays")}>
        <h3 className={styles.subhead}>{t("Invoices it pays")}</h3>
        <ul className={styles.list}>{payment.allocations.map((item, index) => <li key={`${item.invoiceId}-${index}`}>
          <Button variant="quiet" size="compact" onPress={() => onOpenBill(item.invoiceId)}>{item.number}</Button>
          <span className={styles.money}>{money(item.amount)}</span></li>)}</ul>
      </section> : null}
    </div>
    {dialog === "allocate" ? <FormDialog size="md" title={t("Allocate payment")} description={t("{amount} to allocate", { amount: money(payment.unallocated) })}
      onClose={() => setDialog(null)} cancelLabel={t("Back")} isDirty={allocating !== "0"} isSubmitDisabled={allocating === "0" || Boolean(over)} submitLabel={t("Allocate")}
      onSubmit={() => run("allocate", { allocations: Object.entries(parts).filter(([, value]) => Number(value) > 0).map(([invoiceId, amount]) => ({ invoiceId, amount })) })}>
          <div className={styles.allocations}>{open.map((bill) => <div key={bill.id} className={styles.allocation}>
            <span className={styles.nameCell}><span>{bill.number}</span><small>{t("{amount} to pay", { amount: money(bill.payable) })}</small></span>
            <MoneyField label={<VisuallyHidden>{t("Amount for {invoice}", { invoice: bill.number })}</VisuallyHidden>} currency={payment.currency} value={parts[bill.id] ?? ""}
              onChange={(value) => setParts({ ...parts, [bill.id]: value })} />
          </div>)}</div>
          {over ? <InlineNotice tone="error" message={t("That's more than is left of the payment.")} /> : null}
    </FormDialog> : null}
    {dialog === "reverse" ? <ReasonDialog title={t("Reverse payment")} label={t("Why it's reversed")} confirmLabel={t("Reverse payment")} confirmVariant="danger"
      onClose={() => setDialog(null)} onConfirm={(reason) => run("reverse", { reason })} /> : null}
  </InspectorSheet>;
}
