"use client";

import { useMemo, useState } from "react";
import { Badge, Button, DataGrid, EmptyState, ErrorState, InlineNotice, InspectorSheet, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { FactoryApi } from "@/lib/factory/client";
import type { Batch, FactoryState } from "@/lib/factory/types";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "../purchasing/order-labels";
import { WorkOrderStatusLabel, orderNumber } from "./factory-labels";
import styles from "./factory.module.css";

/** Batches: work orders from any projects run together. Open to see what's in one, take work orders out, start or close it. */
export function Batches({ api, state, error, openId, onReload, onOpen, onOpenOrder }: {
  api: FactoryApi; state: FactoryState | null; error: string; openId: string | null; onReload: () => void; onOpen: (id: string | null) => void; onOpenOrder: (id: string) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const statusLabel = useMemo(() => ({ open: t("Open"), started: t("Started"), closed: t("Closed") }), [t]);
  const columns = useMemo<DataGridColumn<Batch>[]>(() => [
    { id: "batch", header: t("Batch"), accessorFn: (row) => row.number, size: 260, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.name}</span><small>{t("Batch {number}", { number: row.number })}</small></span> } },
    { id: "where", header: t("Where and when"), accessorFn: (row) => row.plannedOn ?? "", size: 200, meta: { mobileHidden: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.workcenterName ?? "—"}</span>{row.plannedOn ? <small>{format.day(row.plannedOn)}</small> : null}</span> } },
    { id: "orders", header: t("Work orders"), accessorFn: (row) => row.orders, size: 200, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.orders === 1 ? t("1 work order") : t("{count} work orders", { count: row.orders })}</span><small>{row.projects.join(", ")}</small></span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => row.status, size: 120, meta: { renderCell: (row) => <Badge tone={row.status === "started" ? "info" : row.status === "closed" ? "success" : "neutral"}>
      {statusLabel[row.status]}</Badge> } },
  ], [t, format, statusLabel]);
  if (error && !state) return <ErrorState description={error} onRetry={onReload} />;
  const batch = state?.batches.find((row) => row.id === openId) ?? null;
  return <>
    <DataGrid<Batch> ariaLabel={t("Batches")} columns={columns} data={state?.batches ?? []} getRowId={(row) => row.id} isLoading={!state} onRowAction={(row) => onOpen(row.id)}
      rowNumbers={false} selectable={false} wrapText
      emptyContent={<EmptyState title={t("No batches yet")} description={t("Select work orders in Work orders to run them together.")} />} />
    {batch && state ? <BatchSheet api={api} batch={batch} state={state} onChanged={onReload} onClose={() => onOpen(null)} onOpenOrder={onOpenOrder} /> : null}
  </>;
}

function BatchSheet({ api, batch, state, onChanged, onClose, onOpenOrder }: {
  api: FactoryApi; batch: Batch; state: FactoryState; onChanged: () => void; onClose: () => void; onOpenOrder: (id: string) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const orders = state.orders.filter((order) => order.batchId === batch.id);
  const run = async (action: string, input: Record<string, unknown> = {}) => {
    setBusy(true); setNotice("");
    try { await api.saveBatch({ id: batch.id, action, version: batch.version, ...input }); onChanged(); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); onChanged(); }
    finally { setBusy(false); }
  };
  return <InspectorSheet isOpen size="md" title={batch.name} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={state.canManage && batch.status !== "closed" ? <div className="wd-dialog-actions">
      <Button variant="quiet" isLoading={busy} onPress={() => void run("close")}>{t("Close batch")}</Button><span className={styles.spacer} />
      {batch.status === "open" ? <Button variant="primary" isLoading={busy} onPress={() => void run("start")}>{t("Start batch")}</Button> : null}
    </div> : null}>
    <div className={styles.sheet}>
      <div className={styles.headRow}><span className={styles.muted}>{[t("Batch {number}", { number: batch.number }), batch.workcenterName, format.day(batch.plannedOn)].filter(Boolean).join(" · ")}</span></div>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      <ul className={styles.list}>{orders.map((order) => <li key={order.id}>
        <span className={styles.nameCell}><span><Button size="compact" variant="quiet" onPress={() => onOpenOrder(order.id)}>{`${orderNumber(order.number)} · ${order.title}`}</Button></span>
          <small>{`${order.projectReference} · ${quantityText(order.quantity)} ${order.unit}`.trim()}</small></span>
        <span className={styles.filters}><WorkOrderStatusLabel status={order.status} />
          {state.canManage && batch.status === "open" && ["planned", "released"].includes(order.status) ? <Button size="compact" variant="quiet" isLoading={busy}
            onPress={() => void run("remove", { orderIds: [order.id] })}>{t("Take out")}</Button> : null}</span>
      </li>)}</ul>
    </div>
  </InspectorSheet>;
}
