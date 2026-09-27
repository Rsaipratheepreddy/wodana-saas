"use client";

import { useMemo, useState } from "react";
import { DataGrid, EmptyState, ErrorState, NoResultsState, SegmentedControl, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PayablesApi } from "@/lib/payables/client";
import type { Bill, PayablesState } from "@/lib/payables/types";
import { useProjectFormat } from "../project-core/format";
import { BillSheet } from "./bill-sheet";
import { BillStatusLabel, billState } from "./finance-labels";
import styles from "./finance.module.css";

type Show = "open" | "all";

/** Suppliers' invoices: by default the ones still to act on (drafts, held, and approved ones not fully paid). */
export function Bills({ api, state, error, openId, onReload, onOpen }: {
  api: PayablesApi; state: PayablesState | null; error: string; openId: string | null; onReload: () => void; onOpen: (id: string | null) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const today = format.today();
  const [show, setShow] = useState<Show>("open");
  const [search, setSearch] = useState("");
  const needle = search.trim().toLocaleLowerCase();
  const open = (bill: Bill) => ["draft", "held"].includes(bill.status) || (bill.status === "approved" && Number(bill.balance) > 0);
  const rows = (state?.bills ?? []).filter((bill) => (show === "all" || open(bill))
    && (!needle || `${bill.supplierName} ${bill.number} ${bill.orders.join(" ")}`.toLocaleLowerCase().includes(needle)));
  const columns = useMemo<DataGridColumn<Bill>[]>(() => [
    { id: "invoice", header: t("Invoice"), accessorFn: (row) => row.supplierName, size: 300, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.supplierName}</span><small>{[row.number, ...row.orders].join(" · ")}</small></span> } },
    { id: "due", header: t("Due"), accessorFn: (row) => row.dueDate ?? row.invoiceDate, size: 160, meta: { mobileHidden: true, renderCell: (row) => <span className={styles.nameCell}>
      <span className={billState(row, today).key === "overdue" ? styles.lateText : undefined}>{row.dueDate ? format.day(row.dueDate) : "—"}</span>
      <small>{t("Invoiced {date}", { date: format.day(row.invoiceDate) })}</small></span> } },
    { id: "amount", header: t("Amount"), accessorFn: (row) => Number(row.total), size: 170, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <span className={styles.money}>{format.money(row.total, row.currency)}</span>
      {row.status === "approved" && Number(row.paid) > 0 && Number(row.balance) > 0 ? <small>{t("{amount} left", { amount: format.money(row.balance, row.currency) })}</small> : null}</span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => billState(row, today).key, size: 220, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <BillStatusLabel bill={row} today={today} />
      {row.status === "held" ? <small>{row.holdReasons.split("\n")[0]}</small> : null}</span> } },
  ], [t, format, today]);
  if (error && !state) return <ErrorState description={error} onRetry={onReload} />;
  return <>
    <DataGrid<Bill> appearance="flush" ariaLabel={t("Supplier invoices")} columns={columns} data={rows} getRowId={(row) => row.id} isLoading={!state} onRowAction={(row) => onOpen(row.id)}
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search invoices")} rowNumbers={false} wrapText
      toolbarLeading={<SegmentedControl label={t("Show")} value={show} onChange={(value) => setShow(value as Show)} options={[{ id: "open", label: t("To act on") }, { id: "all", label: t("All") }]} />}
      emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={show === "open" ? t("Nothing to act on") : t("No supplier invoices yet")} />} />
    {openId ? <BillSheet api={api} billId={openId} vendors={state?.vendors ?? []} companies={state?.companies ?? []} onChanged={onReload} onClose={() => onOpen(null)} /> : null}
  </>;
}
