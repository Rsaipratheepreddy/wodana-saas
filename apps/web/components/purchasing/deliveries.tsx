"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, DataGrid, EmptyState, ErrorState, NoAccessState, NoResultsState, SegmentedControl, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { isDenied, type PurchasingApi } from "@/lib/purchasing/client";
import type { DeliveriesState, ExpectedOrder, Receipt, SupplierReturnRow } from "@/lib/purchasing/types";
import { useProjectFormat } from "../project-core/format";
import { OrderStatusLabel, useOrderLabels } from "./order-labels";
import { ReceiptResult, ReceiptSheet } from "./receipt-sheet";
import { ReceiveDialog, usePlaceLabel } from "./receive-dialog";
import { ReturnSheet, SupplierReturns } from "./supplier-returns";
import { RecordUnmatchedDialog, UnmatchedList, UnmatchedSheet } from "./unmatched-deliveries";
import styles from "./purchasing.module.css";

type Show = "expected" | "inspection" | "received" | "returns" | "unmatched";

/**
 * Deliveries: orders expected from suppliers (the late ones first), deliveries waiting for inspection,
 * what arrived lately, and goods going back to suppliers. An expected order is received in place; a
 * delivery opens to inspect, return or reverse it; a return opens to record the pickup.
 */
export function Deliveries({ api, openId, returnId, unmatchedId, onOpen, onOpenReturn, onOpenUnmatched, onOpenOrder, refreshKey }: {
  api: PurchasingApi; openId: string | null; returnId: string | null; unmatchedId: string | null; onOpen: (receiptId: string | null) => void; onOpenReturn: (returnId: string | null) => void;
  onOpenUnmatched: (id: string | null) => void; onOpenOrder: (orderId: string) => void; refreshKey: number;
}) {
  const t = useT();
  const format = useProjectFormat();
  const labels = useOrderLabels();
  const placeLabel = usePlaceLabel();
  const [state, setState] = useState<DeliveriesState | null>(null);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [show, setShow] = useState<Show>(returnId ? "returns" : unmatchedId ? "unmatched" : "expected");
  const [recording, setRecording] = useState(false);
  const [returns, setReturns] = useState<SupplierReturnRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [receiving, setReceiving] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [deliveries, back] = await Promise.all([api.deliveries(), api.returns()]);
      setState(deliveries); setReturns(back.returns ?? []); setError("");
    } catch (cause) { setDenied(isDenied(cause)); setError(cause instanceof Error ? cause.message : t("Deliveries didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, refreshKey]);

  const match = useCallback((text: string) => !search.trim() || text.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()), [search]);
  const expected = useMemo(() => (state?.expected ?? []).filter((row) => match(`${row.number} ${row.supplierName} ${row.projects.map((project) => project.reference).join(" ")}`)), [state, match]);
  const receipts = useMemo(() => (show === "inspection" ? state?.inspection : state?.received ?? [])?.filter((row) => match(`${row.number} ${row.orderNumber} ${row.supplierName} ${row.locationName}`)) ?? [], [state, show, match]);

  const expectedColumns = useMemo<DataGridColumn<ExpectedOrder>[]>(() => [
    { id: "order", header: t("Order"), accessorFn: (row) => `${row.number} ${row.supplierName}`, size: 230, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.number}</span><small>{row.supplierName}</small></span> } },
    { id: "for", header: t("For"), accessorFn: (row) => row.projects.map((project) => project.reference).join(", "), size: 150, meta: { mobileHidden: true } },
    { id: "due", header: t("Due"), accessorFn: (row) => row.due ?? "", size: 160, meta: { renderCell: (row) => {
      const date = row.due;
      const until = format.until(date);
      return date ? <span className={styles.nameCell}><span>{format.day(date)}</span><small className={until?.late ? styles.late : undefined}>{until?.text}</small></span> : "—";
    } } },
    { id: "to", header: t("Deliver to"), accessorFn: (row) => labels.deliverTo[row.deliverTo], size: 150, meta: { mobileHidden: true } },
    { id: "status", header: t("Status"), accessorFn: (row) => labels.status[row.status], size: 190, meta: { renderCell: (row) => <span className={styles.nameCell}><OrderStatusLabel status={row.status} />
      <small>{row.linesLeft === 1 ? t("1 line to come") : t("{count} lines to come", { count: row.linesLeft })}</small></span> } },
    { id: "action", header: "", accessorFn: () => "", size: 120, meta: { align: "end", renderCell: (row) => state?.canReceive
      ? <Button size="compact" onPress={() => setReceiving(row.id)}>{t("Receive")}</Button> : null } },
  ], [t, format, labels, state?.canReceive]);

  const receiptColumns = useMemo<DataGridColumn<Receipt>[]>(() => [
    { id: "number", header: t("Delivery"), accessorFn: (row) => `${row.number} ${row.orderNumber}`, size: 200, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{t("Delivery {number}", { number: row.number })}</span><small>{`${row.orderNumber} · ${row.supplierName}`}</small></span> } },
    { id: "where", header: t("Arrived at"), accessorFn: (row) => row.locationName, size: 190, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <span>{placeLabel({ kind: row.locationKind, name: row.locationName, projectReference: null })}</span>
      {state?.requireSitePhoto && row.locationKind === "site" && !row.photos && !row.reversedAt ? <small className={styles.lateText}>{t("No photo yet")}</small> : null}</span> } },
    { id: "when", header: t("Received"), accessorFn: (row) => row.receivedOn, size: 170, meta: { mobileHidden: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{format.day(row.receivedOn)}</span><small>{row.receivedByName}</small></span> } },
    { id: "result", header: t("Status"), accessorFn: (row) => row.pending, size: 150, meta: { renderCell: (row) => <ReceiptResult receipt={row} /> } },
  ], [t, format, placeLabel, state?.requireSitePhoto]);

  if (error && !state) return denied ? <NoAccessState /> : <ErrorState description={error} onRetry={() => void load()} />;
  const toggle = <SegmentedControl label={t("Show")} value={show} onChange={(value) => setShow(value as Show)} options={[
    { id: "expected", label: t("Expected") },
    { id: "inspection", label: state?.inspection.length ? t("To inspect ({count})", { count: state.inspection.length }) : t("To inspect") },
    { id: "received", label: t("Received") },
    { id: "returns", label: returns?.some((row) => row.status === "open") ? t("Returns ({count})", { count: returns.filter((row) => row.status === "open").length }) : t("Returns") },
    { id: "unmatched", label: state?.unmatched.length ? t("Without an order ({count})", { count: state.unmatched.length }) : t("Without an order") },
  ]} />;
  const cleared = search.trim() ? <NoResultsState onClear={() => setSearch("")} /> : null;
  return <>
    {show === "expected" ? <DataGrid<ExpectedOrder> ariaLabel={t("Expected deliveries")} columns={expectedColumns} data={expected} getRowId={(row) => row.id} isLoading={!state}
      onRowAction={(row) => onOpenOrder(row.id)} onSearchChange={setSearch} searchValue={search} searchLabel={t("Search deliveries")} toolbarLeading={toggle}
      emptyContent={cleared ?? <EmptyState title={t("No deliveries expected")} description={t("Orders appear here once they're sent to the supplier.")} />}
      rowNumbers={false} selectable={false} wrapText />
      : show === "unmatched" ? <UnmatchedList rows={state?.unmatched ?? []} search={search} onSearch={setSearch} onOpen={(id) => onOpenUnmatched(id)}
        toolbar={<div className={styles.filters}>{toggle}{state?.canReceive ? <Button size="compact" onPress={() => setRecording(true)}>{t("Goods without an order")}</Button> : null}</div>} />
      : show === "returns" ? <SupplierReturns api={api} rows={returns} search={search} onSearch={setSearch} toolbar={toggle} onOpen={(id) => onOpenReturn(id)} />
      : <DataGrid<Receipt> ariaLabel={show === "inspection" ? t("To inspect") : t("Received")} columns={receiptColumns} data={receipts} getRowId={(row) => row.id} isLoading={!state}
        onRowAction={(row) => onOpen(row.id)} onSearchChange={setSearch} searchValue={search} searchLabel={t("Search deliveries")} toolbarLeading={toggle}
        emptyContent={cleared ?? (show === "inspection" ? <EmptyState title={t("Nothing to inspect")} /> : <EmptyState title={t("Nothing received yet")} />)}
        rowNumbers={false} selectable={false} wrapText />}
    {receiving ? <ReceiveDialog api={api} orderId={receiving} onClose={() => setReceiving(null)} onReceived={(next) => { setReceiving(null); void load(); onOpen(next.receipt.id); }} /> : null}
    {openId ? <ReceiptSheet api={api} receiptId={openId} onChanged={() => void load()} onClose={() => onOpen(null)} onOpenOrder={onOpenOrder}
      onReturn={(next) => { setShow("returns"); onOpenReturn(next.return.id); }} /> : null}
    {returnId ? <ReturnSheet api={api} returnId={returnId} onChanged={() => void load()} onClose={() => onOpenReturn(null)} onOpenOrder={onOpenOrder} /> : null}
    {unmatchedId ? <UnmatchedSheet api={api} deliveryId={unmatchedId} onChanged={() => void load()} onClose={() => onOpenUnmatched(null)} onOpenReceipt={(id) => onOpen(id)} /> : null}
    {recording && state ? <RecordUnmatchedDialog api={api} locations={state.locations} onClose={() => setRecording(false)}
      onRecorded={(next) => { setRecording(false); setShow("unmatched"); void load(); onOpenUnmatched(next.delivery.id); }} /> : null}
  </>;
}
