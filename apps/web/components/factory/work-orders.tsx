"use client";

import { useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Button, ControlledModalDialog, DataGrid, DateField, EmptyState, ErrorState, InlineNotice, NoResultsState, SegmentedControl, SelectField, TextInput, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { FactoryApi } from "@/lib/factory/client";
import type { FactoryState, WorkOrderRow, Workcenter } from "@/lib/factory/types";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "../purchasing/order-labels";
import { WorkOrderStatusLabel, orderNumber } from "./factory-labels";
import { WorkOrderSheet } from "./work-order-sheet";
import styles from "./factory.module.css";

type Show = "open" | "all";
const OPEN = ["planned", "released", "in_production", "on_hold"];

/** Work orders: the open ones by default, each with its project, where and when it's made, how far it is, and its state. */
export function WorkOrders({ api, state, error, openId, onReload, onOpen, onBatched }: {
  api: FactoryApi; state: FactoryState | null; error: string; openId: string | null; onReload: () => void; onOpen: (id: string | null) => void; onBatched: (batchId: string) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [show, setShow] = useState<Show>("open");
  const [search, setSearch] = useState("");
  const [grouping, setGrouping] = useState<WorkOrderRow[] | null>(null);
  const needle = search.trim().toLocaleLowerCase();
  const rows = (state?.orders ?? []).filter((row) => (show === "all" || OPEN.includes(row.status))
    && (!needle || `${orderNumber(row.number)} ${row.title} ${row.projectReference} ${row.projectName}`.toLocaleLowerCase().includes(needle)));
  const columns = useMemo<DataGridColumn<WorkOrderRow>[]>(() => [
    { id: "order", header: t("Work order"), accessorFn: (row) => row.number, size: 280, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.title}</span><small>{`${orderNumber(row.number)} · ${row.projectReference}`}</small></span> } },
    { id: "where", header: t("Where and when"), accessorFn: (row) => row.plannedStart ?? "", size: 220, meta: { mobileHidden: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.workcenterName ?? "—"}</span>
      {row.plannedStart || row.plannedEnd ? <small className={row.plannedEnd && row.plannedEnd < format.today() && OPEN.includes(row.status) ? styles.lateText : undefined}>
        {[format.day(row.plannedStart), format.day(row.plannedEnd), row.plannedHours ? t("{hours} h", { hours: Number(row.plannedHours) }) : ""].filter(Boolean).join(" – ")}</small> : null}
      {row.batchName ? <small>{t("Batch {number}: {name}", { number: row.batchNumber ?? 0, name: row.batchName })}</small> : null}</span> } },
    { id: "progress", header: t("Ready"), accessorFn: (row) => Number(row.passed) / Number(row.quantity), size: 200, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <span className={styles.number}>{t("{ready} of {quantity}", { ready: quantityText(row.passed) || "0", quantity: `${quantityText(row.quantity)} ${row.unit}`.trim() })}</span>
      {Number(row.pending) || Number(row.toCheck) ? <small>{[Number(row.pending) ? t("{quantity} to approve", { quantity: quantityText(row.pending) }) : "",
        Number(row.toCheck) ? t("{quantity} to check", { quantity: quantityText(row.toCheck) }) : ""].filter(Boolean).join(" · ")}</small> : null}</span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => row.status, size: 170, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <WorkOrderStatusLabel status={row.status} />
      {OPEN.includes(row.status) && (row.lineStatus === "omitted" || Number(row.scopeOver) > 0) ? <small className={styles.lateText}>{t("Scope changed")}</small>
        : row.holdKind === "drawing" && row.status === "on_hold" ? <small>{t("Drawing changed")}</small> : null}</span> } },
  ], [t, format]);
  if (error && !state) return <ErrorState description={error} onRetry={onReload} />;
  return <>
    <DataGrid<WorkOrderRow> appearance="flush" ariaLabel={t("Work orders")} columns={columns} data={rows} getRowId={(row) => row.id} isLoading={!state} onRowAction={(row) => onOpen(row.id)}
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search work orders")} rowNumbers={false} selectable={Boolean(state?.canManage)} wrapText
      bulkActions={(chosen) => {
        const ready = chosen.filter((row) => ["planned", "released"].includes(row.status) && !row.batchId);
        return ready.length ? <Button size="compact" onPress={() => setGrouping(ready)}>{t("Run together ({count})", { count: ready.length })}</Button> : null;
      }}
      toolbarLeading={<SegmentedControl label={t("Show")} value={show} onChange={(value) => setShow(value as Show)} options={[{ id: "open", label: t("Open") }, { id: "all", label: t("All") }]} />}
      emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={show === "open" ? t("No open work orders") : t("No work orders yet")}
        description={t("Plan one from a line in To make.")} />} />
    {openId ? <WorkOrderSheet api={api} orderId={openId} onChanged={onReload} onClose={() => onOpen(null)} /> : null}
    {grouping && state ? <BatchDialog api={api} orders={grouping} workcenters={state.workcenters} onClose={() => setGrouping(null)} onSaved={(id) => { setGrouping(null); onBatched(id); }} /> : null}
  </>;
}

/** Work orders from any projects run together: a name, where and when. */
function BatchDialog({ api, orders, workcenters, onClose, onSaved }: { api: FactoryApi; orders: WorkOrderRow[]; workcenters: Workcenter[]; onClose: () => void; onSaved: (id: string) => void }) {
  const t = useT();
  const [id] = useState(() => crypto.randomUUID());
  const shared = orders.every((order) => order.workcenterId === orders[0].workcenterId) ? orders[0].workcenterId : null;
  const [name, setName] = useState("");
  const [workcenterId, setWorkcenterId] = useState(shared ?? "");
  const [plannedOn, setPlannedOn] = useState<string | null>(orders.map((order) => order.plannedStart).filter((value): value is string => Boolean(value)).sort()[0] ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("Run together")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!name.trim()} onPress={async () => {
        setBusy(true); setError("");
        try { await api.saveBatch({ id, name: name.trim(), workcenterId: workcenterId || null, plannedOn, orderIds: orders.map((order) => order.id) }); onSaved(id); }
        catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(false); }
      }}>{t("Create batch")}</Button></div>}>
    <div className={styles.dialogBody}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <p className={styles.muted}>{orders.map((order) => `${orderNumber(order.number)} · ${order.projectReference}`).join(", ")}</p>
      <TextInput label={t("Name")} isRequired value={name} onChange={setName} />
      <div className={styles.pair}>
        <SelectField label={t("Workcenter")} placeholder={t("Choose")} selectedKey={workcenterId} onSelectionChange={(key) => setWorkcenterId(key ? String(key) : "")}
          items={workcenters.map((center) => ({ id: center.id, label: center.name }))} />
        <DateField label={t("Day")} value={plannedOn ? parseDate(plannedOn) : null} onChange={(value) => setPlannedOn(value ? value.toString() : null)} />
      </div>
    </div>
  </ControlledModalDialog>;
}
