"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataGrid, EmptyState, ErrorState, MenuButton, NoResultsState, SegmentedControl, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PurchasingApi } from "@/lib/purchasing/client";
import type { OrderRow, OrdersState, OrderStatus } from "@/lib/purchasing/types";
import { useProjectFormat } from "../project-core/format";
import { OPEN_ORDERS, OrderStatusLabel, useOrderLabels } from "./order-labels";
import { OrderSheet } from "./order-sheet";
import styles from "./purchasing.module.css";

type Show = "open" | "all";

/** Purchase orders: the open ones first, each with its supplier, projects, status, total and dates. A row opens the order. */
export function Orders({ api, openId, onOpen, refreshKey }: { api: PurchasingApi; openId: string | null; onOpen: (id: string | null) => void; refreshKey: number }) {
  const t = useT();
  const labels = useOrderLabels();
  const format = useProjectFormat();
  const [state, setState] = useState<OrdersState | null>(null);
  const [error, setError] = useState("");
  const [show, setShow] = useState<Show>("open");
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [search, setSearch] = useState("");
  const load = useCallback(async () => {
    try { setState(await api.orders()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The orders didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, refreshKey]);

  const rows = useMemo(() => (state?.orders ?? []).filter((order) => (show === "all" || OPEN_ORDERS.includes(order.status)) && (!status || order.status === status)
    && (!search.trim() || `${order.number} ${order.supplierName} ${order.projects.map((project) => project.reference).join(" ")}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))),
  [state, show, status, search]);
  const columns = useMemo<DataGridColumn<OrderRow>[]>(() => [
    { id: "number", header: t("Order"), accessorFn: (row) => `${row.number} ${row.supplierName}`, size: 230, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.number}{row.revision ? ` · ${t("change {number}", { number: row.revision })}` : ""}</span><small>{row.supplierName}</small></span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => labels.status[row.status], size: 170, meta: { renderCell: (row) => <OrderStatusLabel status={row.status} /> } },
    { id: "projects", header: t("For"), accessorFn: (row) => row.projects.map((project) => project.reference).join(", "), size: 160, meta: { mobileHidden: true } },
    { id: "total", header: t("Total"), accessorFn: (row) => row.total, size: 140, meta: { align: "end", renderCell: (row) => <span className={styles.money}>{format.money(row.total, row.currency)}</span> } },
    { id: "dates", header: t("Due"), accessorFn: (row) => row.promisedDate ?? row.expectedDate ?? "", size: 150, meta: { mobileHidden: true, renderCell: (row) => row.promisedDate
      ? <span className={styles.nameCell}><span>{format.day(row.promisedDate)}</span><small>{t("Promised")}</small></span>
      : row.expectedDate ? <span className={styles.nameCell}><span>{format.day(row.expectedDate)}</span><small>{t("Needed by")}</small></span> : null } },
    { id: "by", header: t("Raised by"), accessorFn: (row) => row.createdByName, size: 140, meta: { mobileHidden: true } },
  ], [t, labels, format]);

  if (error && !state) return <ErrorState description={error} onRetry={() => void load()} />;
  return <>
    <DataGrid<OrderRow>
      appearance="flush"
      ariaLabel={t("Orders")}
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      isLoading={!state}
      onRowAction={(row) => onOpen(row.id)}
      onSearchChange={setSearch}
      searchValue={search}
      searchLabel={t("Search orders")}
      toolbarLeading={<div className={styles.filters}>
        <SegmentedControl label={t("Show")} value={show} onChange={(value) => setShow(value as Show)} options={[{ id: "open", label: t("Open") }, { id: "all", label: t("All") }]} />
        <MenuButton size="compact" label={status ? labels.status[status] : t("Any status")} onAction={(id) => setStatus(id === "any" ? null : id as OrderStatus)}
          items={[{ id: "any", label: t("Any status") }, ...(Object.keys(labels.status) as OrderStatus[]).map((id) => ({ id, label: labels.status[id] }))]} />
      </div>}
      emptyContent={search.trim() || status ? <NoResultsState onClear={() => { setSearch(""); setStatus(null); }} />
        : <EmptyState title={t("No orders yet")} description={t("Orders start from what projects need to order.")} />}
      rowNumbers={false}
      selectable={false}
      wrapText
    />
    {openId ? <OrderSheet api={api} orderId={openId} settings={state?.settings ?? null} onChanged={() => void load()} onClose={() => onOpen(null)} /> : null}
  </>;
}
