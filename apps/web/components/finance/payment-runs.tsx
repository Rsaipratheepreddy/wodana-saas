"use client";

import { useMemo, useState } from "react";
import { DataGrid, EmptyState, ErrorState, ListTabs, NoResultsState, RecordName, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PayablesApi } from "@/lib/payables/client";
import type { PayablesState, PaymentRun } from "@/lib/payables/types";
import { useProjectFormat } from "../project-core/format";
import { RunStatusLabel } from "./finance-labels";
import { RunSheet } from "./run-sheet";
import styles from "./finance.module.css";

type Show = "open" | "all";
const OPEN = ["draft", "submitted", "approved"];

/** Payment runs: by default the ones still to finish (drafts, waiting for approval, approved and not paid yet). */
export function PaymentRuns({ api, state, error, openId, creating, onReload, onOpen, onCreated }: {
  api: PayablesApi; state: PayablesState | null; error: string; openId: string | null; creating: boolean; onReload: () => void; onOpen: (id: string | null) => void; onCreated: (id: string | null) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [show, setShow] = useState<Show>("open");
  const [search, setSearch] = useState("");
  const needle = search.trim().toLocaleLowerCase();
  const rows = (state?.runs ?? []).filter((run) => (show === "all" || OPEN.includes(run.status))
    && (!needle || `${run.number} ${run.note} ${run.preparedByName}`.toLocaleLowerCase().includes(needle)));
  const columns = useMemo<DataGridColumn<PaymentRun>[]>(() => [
    { id: "run", header: t("Run"), accessorFn: (row) => row.number, size: 260, meta: { primary: true, renderCell: (row) => <RecordName title={t("Run {number}", { number: row.number })} detail={[row.preparedByName, row.note].filter(Boolean).join(" · ")} /> } },
    { id: "due", header: t("Due"), accessorFn: (row) => row.dueFrom ?? "", size: 150, meta: { mobileHidden: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.dueFrom ? format.day(row.dueFrom) : "—"}</span><small>{row.invoices === 1 ? t("1 invoice") : t("{count} invoices", { count: row.invoices })}</small></span> } },
    { id: "total", header: t("Total"), accessorFn: (row) => row.totals.map((total) => `${total.currency} ${total.amount}`).join(" "), size: 200, meta: { align: "end", renderCell: (row) =>
      <span className={styles.nameCell}>{row.totals.map((total) => <span key={total.currency} className={styles.money}>{format.money(total.amount, total.currency)}</span>)}</span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => row.status, size: 170, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <RunStatusLabel status={row.status} />{row.status === "draft" && row.returnNote ? <small>{t("Sent back: {note}", { note: row.returnNote })}</small> : null}</span> } },
  ], [t, format]);
  if (error && !state) return <ErrorState description={error} onRetry={onReload} />;
  return <>
    <DataGrid<PaymentRun> ariaLabel={t("Payment runs")} columns={columns} data={rows} getRowId={(row) => row.id} isLoading={!state} onRowAction={(row) => onOpen(row.id)}
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search runs")} rowNumbers={false}
      toolbarLeading={<ListTabs label={t("Show")} value={show} onChange={setShow} items={[{ id: "open", label: t("To finish") }, { id: "all", label: t("All") }]} />}
      emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={show === "open" ? t("No runs to finish") : t("No payment runs yet")} />} />
    {state && (openId || creating) ? <RunSheet api={api} runId={creating ? null : openId} bills={state.bills} canManage={state.canManage} onChanged={onReload}
      onCreated={(id) => onCreated(id)} onClose={() => (creating ? onCreated(null) : onOpen(null))} /> : null}
  </>;
}
