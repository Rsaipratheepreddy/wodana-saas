"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, DataGrid, EmptyState, ErrorState, ListTabs, NoAccessState, NoResultsState, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { isDenied, type PurchasingApi } from "@/lib/purchasing/client";
import type { DeliveriesState, ExpectedOrder, Receipt, SupplierReturnRow } from "@/lib/purchasing/types";
import { Cell, DueText, ProjectFilterChip, ProjectLinks } from "../operations/ops";
import { useProjectFormat } from "../project-core/format";
import { OrderStatusLabel, useOrderLabels } from "./order-labels";
import { ReceiptResult, ReceiptSheet } from "./receipt-sheet";
import { ReceiveDialog, usePlaceLabel } from "./receive-dialog";
import { ReturnSheet, SupplierReturns } from "./supplier-returns";
import { RecordUnmatchedDialog, UnmatchedList, UnmatchedSheet } from "./unmatched-deliveries";
import styles from "./purchasing.module.css";

type Show = "expected" | "late" | "inspection" | "received" | "returns" | "unmatched";

/**
 * Deliveries as queues: orders expected from suppliers (the late ones first, with the shipment when one is
 * followed), deliveries waiting for someone to inspect them, what arrived lately, goods going back to
 * suppliers and goods that came without an order. Each row has its one next step: receive, or inspect.
 */
export function Deliveries({ api, openId, returnId, unmatchedId, onOpen, onOpenReturn, onOpenUnmatched, onOpenOrder, refreshKey, projectId = null, onProject = () => undefined }: {
  api: PurchasingApi; openId: string | null; returnId: string | null; unmatchedId: string | null; onOpen: (receiptId: string | null) => void; onOpenReturn: (returnId: string | null) => void;
  onOpenUnmatched: (id: string | null) => void; onOpenOrder: (orderId: string) => void; refreshKey: number; projectId?: string | null; onProject?: (projectId: string | null) => void;
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

  const today = format.today();
  const match = useCallback((text: string) => !search.trim() || text.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()), [search]);
  const forProject = useCallback((row: ExpectedOrder) => !projectId || row.projects.some((project) => project.id === projectId), [projectId]);
  const expectedAll = useMemo(() => (state?.expected ?? []).filter((row) => forProject(row) && match(`${row.number} ${row.supplierName} ${row.projects.map((project) => project.reference).join(" ")}`)),
    [state, match, forProject]);
  const late = (row: ExpectedOrder) => Boolean(row.due && row.due < today);
  const expected = show === "late" ? expectedAll.filter(late) : expectedAll;
  const receipts = useMemo(() => (show === "inspection" ? state?.inspection : state?.received ?? [])?.filter((row) => match(`${row.number} ${row.orderNumber} ${row.supplierName} ${row.locationName}`)) ?? [], [state, show, match]);

  const expectedColumns = useMemo<DataGridColumn<ExpectedOrder>[]>(() => [
    { id: "order", header: t("Order"), accessorFn: (row) => `${row.number} ${row.supplierName}`, size: 230, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.number}</span><small>{row.supplierName}</small></span> } },
    { id: "for", header: t("For"), accessorFn: (row) => row.projects.map((project) => project.reference).join(", "), size: 130, meta: { mobileHidden: true, renderCell: (row) => <ProjectLinks projects={row.projects} /> } },
    { id: "due", header: t("Due"), accessorFn: (row) => row.due ?? "", size: 140, meta: { renderCell: (row) => <DueText date={row.due} /> } },
    { id: "shipping", header: t("Shipping"), accessorFn: (row) => row.shipment?.status ?? "", size: 170, meta: { mobileHidden: true, renderCell: (row) => row.shipment
      ? <Cell title={labels.shipment[row.shipment.status]} meta={[row.shipment.carrier, row.shipment.eta ? t("expected {date}", { date: format.short(row.shipment.eta) }) : ""].filter(Boolean).join(" · ") || null}
        tone={row.shipment.status === "delayed" ? "danger" : undefined} />
      : <Cell title={labels.deliverTo[row.deliverTo]} /> } },
    { id: "status", header: t("Status"), accessorFn: (row) => labels.status[row.status], size: 170, meta: { renderCell: (row) => <Cell title={<OrderStatusLabel status={row.status} />}
      meta={row.linesLeft === 1 ? t("1 line to come") : t("{count} lines to come", { count: row.linesLeft })} /> } },
    { id: "action", header: t("Next"), accessorFn: () => "", size: 110, meta: { align: "end", renderCell: (row) => state?.canReceive
      ? <Button size="compact" aria-label={t("Receive {order}", { order: row.number })} onPress={() => setReceiving(row.id)}>{t("Receive")}</Button> : null } },
  ], [t, format, labels, state?.canReceive]);

  const receiptColumns = useMemo<DataGridColumn<Receipt>[]>(() => [
    { id: "number", header: t("Delivery"), accessorFn: (row) => `${row.number} ${row.orderNumber}`, size: 220, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{t("Delivery {number}", { number: row.number })}</span><small>{`${row.orderNumber} · ${row.supplierName}`}</small></span> } },
    { id: "where", header: t("Arrived at"), accessorFn: (row) => row.locationName, size: 190, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <span>{placeLabel({ kind: row.locationKind, name: row.locationName, projectReference: null })}</span>
      {state?.requireSitePhoto && row.locationKind === "site" && !row.photos && !row.reversedAt ? <small className={styles.lateText}>{t("No photo yet")}</small> : null}</span> } },
    { id: "when", header: t("Received"), accessorFn: (row) => row.receivedOn, size: 170, meta: { mobileHidden: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{format.day(row.receivedOn)}</span><small>{row.receivedByName}</small></span> } },
    { id: "result", header: t("Status"), accessorFn: (row) => row.pending, size: 150, meta: { renderCell: (row) => <ReceiptResult receipt={row} /> } },
    ...(show === "inspection" ? [{ id: "next", header: t("Next"), accessorFn: () => "", size: 110, meta: { align: "end" as const, renderCell: (row: Receipt) =>
      state?.canInspect && row.receivedBy !== state.userId ? <Button size="compact" aria-label={t("Inspect delivery {number}", { number: row.number })} onPress={() => onOpen(row.id)}>{t("Inspect")}</Button>
        : <small className={styles.muted}>{t("Someone else inspects it")}</small> } } as DataGridColumn<Receipt>] : []),
  ], [t, format, placeLabel, state, show, onOpen]);

  if (error && !state) return denied ? <NoAccessState /> : <ErrorState description={error} onRetry={() => void load()} />;
  const openReturns = returns?.filter((row) => row.status === "open").length ?? 0;
  const toggle = <div className={styles.filters}>
    <ListTabs label={t("Deliveries")} value={show} onChange={setShow} items={[
      { id: "expected", label: t("Expected"), count: expectedAll.length },
      { id: "late", label: t("Late"), count: expectedAll.filter(late).length },
      { id: "inspection", label: t("To inspect"), count: state?.inspection.length ?? 0 },
      { id: "received", label: t("Received") },
      { id: "returns", label: t("Returns"), count: openReturns },
      { id: "unmatched", label: t("Without an order"), count: state?.unmatched.length ?? 0 },
    ]} />
    <ProjectFilterChip project={projectId ? (state?.expected.flatMap((row) => row.projects).find((project) => project.id === projectId) ?? { id: projectId, reference: t("This project") }) : null}
      onClear={() => onProject(null)} />
  </div>;
  const cleared = search.trim() ? <NoResultsState onClear={() => setSearch("")} /> : null;
  return <>
    {show === "expected" || show === "late" ? <DataGrid<ExpectedOrder> ariaLabel={t("Expected deliveries")} columns={expectedColumns} data={expected} getRowId={(row) => row.id} isLoading={!state}
      onRowAction={(row) => onOpenOrder(row.id)} onSearchChange={setSearch} searchValue={search} searchLabel={t("Search deliveries")} toolbarLeading={toggle}
      emptyContent={cleared ?? (show === "late" ? <EmptyState title={t("Nothing is late")} /> : <EmptyState title={t("No deliveries expected")} description={t("Orders appear here once they're sent to the supplier.")} />)}
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
