"use client";

import { useMemo, useState } from "react";
import { DataGrid, EmptyState, ErrorState, NoResultsState, SegmentedControl, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { FactoryApi } from "@/lib/factory/client";
import type { FactoryState, WorkOrderRow } from "@/lib/factory/types";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "../purchasing/order-labels";
import { WorkOrderStatusLabel, orderNumber } from "./factory-labels";
import { WorkOrderSheet } from "./work-order-sheet";
import styles from "./factory.module.css";

type Show = "open" | "all";
const OPEN = ["planned", "released", "in_production", "on_hold"];

/** Work orders: the open ones by default, each with its project, where and when it's made, how far it is, and its state. */
export function WorkOrders({ api, state, error, openId, onReload, onOpen }: {
  api: FactoryApi; state: FactoryState | null; error: string; openId: string | null; onReload: () => void; onOpen: (id: string | null) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [show, setShow] = useState<Show>("open");
  const [search, setSearch] = useState("");
  const needle = search.trim().toLocaleLowerCase();
  const rows = (state?.orders ?? []).filter((row) => (show === "all" || OPEN.includes(row.status))
    && (!needle || `${orderNumber(row.number)} ${row.title} ${row.projectReference} ${row.projectName}`.toLocaleLowerCase().includes(needle)));
  const columns = useMemo<DataGridColumn<WorkOrderRow>[]>(() => [
    { id: "order", header: t("Work order"), accessorFn: (row) => row.number, size: 280, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.title}</span><small>{`${orderNumber(row.number)} · ${row.projectReference}`}</small></span> } },
    { id: "where", header: t("Where and when"), accessorFn: (row) => row.plannedStart ?? "", size: 220, meta: { mobileHidden: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.workcenterName ?? "—"}</span>
      {row.plannedStart || row.plannedEnd ? <small className={row.plannedEnd && row.plannedEnd < format.today() && OPEN.includes(row.status) ? styles.lateText : undefined}>
        {[format.day(row.plannedStart), format.day(row.plannedEnd)].filter(Boolean).join(" – ")}</small> : null}</span> } },
    { id: "progress", header: t("Ready"), accessorFn: (row) => Number(row.passed) / Number(row.quantity), size: 200, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <span className={styles.number}>{t("{ready} of {quantity}", { ready: quantityText(row.passed) || "0", quantity: `${quantityText(row.quantity)} ${row.unit}`.trim() })}</span>
      {Number(row.pending) || Number(row.toCheck) ? <small>{[Number(row.pending) ? t("{quantity} to approve", { quantity: quantityText(row.pending) }) : "",
        Number(row.toCheck) ? t("{quantity} to check", { quantity: quantityText(row.toCheck) }) : ""].filter(Boolean).join(" · ")}</small> : null}</span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => row.status, size: 150, meta: { renderCell: (row) => <WorkOrderStatusLabel status={row.status} /> } },
  ], [t, format]);
  if (error && !state) return <ErrorState description={error} onRetry={onReload} />;
  return <>
    <DataGrid<WorkOrderRow> appearance="flush" ariaLabel={t("Work orders")} columns={columns} data={rows} getRowId={(row) => row.id} isLoading={!state} onRowAction={(row) => onOpen(row.id)}
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search work orders")} rowNumbers={false} selectable={false} wrapText
      toolbarLeading={<SegmentedControl label={t("Show")} value={show} onChange={(value) => setShow(value as Show)} options={[{ id: "open", label: t("Open") }, { id: "all", label: t("All") }]} />}
      emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={show === "open" ? t("No open work orders") : t("No work orders yet")}
        description={t("Plan one from a line in To make.")} />} />
    {openId ? <WorkOrderSheet api={api} orderId={openId} onChanged={onReload} onClose={() => onOpen(null)} /> : null}
  </>;
}
