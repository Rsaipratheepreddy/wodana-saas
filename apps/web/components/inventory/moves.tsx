"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, DataGrid, EmptyState, ErrorState, InlineNotice, InspectorSheet, ListTabs, NoResultsState, Skeleton, TextAreaField, TextInput, type DataGridColumn, FormDialog } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { InventoryApi } from "@/lib/inventory/client";
import type { TransferRow, TransferState, TransfersState, TransferStatus } from "@/lib/inventory/types";
import { Cell, NextStep, ProjectFilterChip, ProjectLinks, operationsStyles as ops } from "../operations/ops";
import { orderNumber } from "../factory/factory-labels";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "../purchasing/order-labels";
import styles from "./inventory.module.css";

const numeric = (value: string) => value.replace(/[^\d.]/g, "");
type View = "transit" | "arrived" | "all";

/** A move's state as a word in its tone: in transit, arrived (short, or with goods refused), cancelled. */
export function MoveStatus({ status, short, rejected = false }: { status: TransferStatus; short: boolean; rejected?: boolean }) {
  const t = useT();
  const tone = status === "in_transit" ? "info" : status === "cancelled" ? "neutral" : short || rejected ? "warning" : "success";
  const label = status === "in_transit" ? t("In transit") : status === "cancelled" ? t("Cancelled") : rejected ? t("Arrived, some refused") : short ? t("Arrived short") : t("Arrived");
  return <Badge tone={tone}>{label}</Badge>;
}

/**
 * Moves between places as queues: what's in transit (to receive where it arrives), what arrived, everything.
 * Each row names what's on it, its projects, where from and to, and a factory dispatch its work order.
 */
export function Moves({ api, openId, onOpen, refreshKey, onChanged, projectId = null, onProject = () => undefined }: {
  api: InventoryApi; openId: string | null; onOpen: (id: string | null) => void; refreshKey: number; onChanged: () => void; projectId?: string | null; onProject?: (projectId: string | null) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [state, setState] = useState<TransfersState | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View | null>(null);
  const load = useCallback(async () => {
    try { setState(await api.transfers()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Moves didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, refreshKey]);
  const needle = search.trim().toLocaleLowerCase();
  const scoped = (state?.transfers ?? []).filter((row) => (!projectId || row.toProjectId === projectId || (row.projects ?? []).some((project) => project.id === projectId))
    && (!needle || `${row.number} ${row.fromName} ${row.toName} ${row.items ?? ""}`.toLocaleLowerCase().includes(needle)));
  const transit = scoped.filter((row) => row.status === "in_transit");
  const current: View = view ?? (transit.length ? "transit" : "all");
  const rows = current === "transit" ? transit : current === "arrived" ? scoped.filter((row) => row.status === "received") : scoped;
  const columns = useMemo<DataGridColumn<TransferRow>[]>(() => [
    { id: "number", header: t("Move"), accessorFn: (row) => row.number, size: 240, meta: { primary: true, renderCell: (row) => <Cell title={t("Move {number}", { number: row.number })}
      meta={[row.items || (row.lines === 1 ? t("1 line") : t("{count} lines", { count: row.lines })), row.workOrderNumber ? orderNumber(row.workOrderNumber) : "",
        row.returnedFromNumber ? t("Back from move {number}", { number: row.returnedFromNumber }) : ""].filter(Boolean).join(" · ")} /> } },
    { id: "route", header: t("From and to"), accessorFn: (row) => `${row.fromName} ${row.toName}`, size: 240, meta: { renderCell: (row) => <Cell title={row.fromName} meta={t("to {place}", { place: row.toName })} /> } },
    { id: "for", header: t("For"), accessorFn: (row) => (row.projects ?? []).map((project) => project.reference).join(", "), size: 120, meta: { mobileHidden: true,
      renderCell: (row) => <ProjectLinks projects={row.projects ?? []} /> } },
    { id: "status", header: t("Status"), accessorFn: (row) => row.status, size: 170, meta: { renderCell: (row) => <Cell title={<MoveStatus status={row.status} short={row.short} rejected={row.rejected} />}
      meta={row.returnNumber ? t("Refused goods on move {number}", { number: row.returnNumber }) : null} /> } },
    { id: "sent", header: t("Sent"), accessorFn: (row) => row.sentOn, size: 150, meta: { mobileHidden: true, renderCell: (row) => <Cell title={format.day(row.sentOn)} meta={row.sentByName} /> } },
    { id: "next", header: t("Next"), accessorFn: () => "", size: 110, meta: { align: "end", renderCell: (row) => row.status === "in_transit" && state?.canReceive
      ? <Button size="compact" aria-label={t("Receive move {number}", { number: row.number })} onPress={() => onOpen(row.id)}>{t("Receive")}</Button> : null } },
  ], [t, format, state?.canReceive, onOpen]);
  if (error && !state) return <ErrorState description={error} onRetry={() => void load()} />;
  const project = projectId ? (state?.transfers ?? []).flatMap((row) => row.projects ?? []).find((item) => item.id === projectId) : undefined;
  return <>
    <DataGrid<TransferRow> ariaLabel={t("Moves")} columns={columns} data={rows} getRowId={(row) => row.id} isLoading={!state} onRowAction={(row) => onOpen(row.id)}
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search moves")} rowNumbers={false} selectable={false} wrapText
      toolbarLeading={<div className={styles.filters}>
        <ListTabs label={t("Moves")} value={current} onChange={setView} items={[
          { id: "transit", label: t("In transit"), count: transit.length }, { id: "arrived", label: t("Arrived") }, { id: "all", label: t("All") }]} />
        <ProjectFilterChip project={projectId ? project ?? { id: projectId, reference: t("This project") } : null} onClear={() => onProject(null)} />
      </div>}
      emptyContent={needle ? <NoResultsState onClear={() => setSearch("")} /> : current === "transit" ? <EmptyState title={t("Nothing on its way")} />
        : <EmptyState title={t("No moves yet")} description={t("Move stock from a row in Stock.")} />} />
    {openId ? <MoveSheet api={api} transferId={openId} onChanged={() => { void load(); onChanged(); }} onClose={() => onOpen(null)} onOpenMove={onOpen} /> : null}
  </>;
}

type Arrival = { received: string; reason: string; refused: string; refuseReason: string };

/**
 * One move: what was sent, and — while it's in transit — what arrived where it went: anything missing says
 * why, and anything refused there (damaged, wrong, not to spec) goes straight back on a return trip. Made
 * goods refused at a site are made again on their work order.
 */
export function MoveSheet({ api, transferId, onChanged, onClose, onOpenMove }: { api: InventoryApi; transferId: string; onChanged: () => void; onClose: () => void; onOpenMove?: (id: string) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const [state, setState] = useState<TransferState | null>(null);
  const [arrivals, setArrivals] = useState<Record<string, Arrival>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const accept = useCallback((next: TransferState) => {
    setState(next);
    setArrivals(Object.fromEntries(next.lines.map((line) => [line.id, { received: quantityText(line.received ?? line.quantity), reason: line.lossReason, refused: "", refuseReason: "" }])));
  }, []);
  const load = useCallback(async () => {
    try { accept(await api.transfer(transferId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The move didn't load.")); }
  }, [api, transferId, accept, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  const run = async (action: string, input: Record<string, unknown>) => {
    setBusy(true); setNotice("");
    try { accept(await api.transferCommand(transferId, action, input)); onChanged(); return true; }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); return false; }
    finally { setBusy(false); }
  };
  const open = Boolean(state?.canReceiveThis);
  const invalid = state?.lines.find((line) => {
    const arrival = arrivals[line.id];
    return !arrival || arrival.received === "" || Number(arrival.received) > Number(line.quantity) || (Number(arrival.received) < Number(line.quantity) && !arrival.reason.trim())
      || Number(arrival.refused || 0) > Number(arrival.received || 0) || (Number(arrival.refused || 0) > 0 && !arrival.refuseReason.trim());
  });
  const transfer = state?.transfer;
  const made = Boolean(transfer?.workOrderId && !transfer.returnedFromId);
  return <InspectorSheet isOpen size="lg" title={transfer ? t("Move {number}", { number: transfer.number }) : t("Move")} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={open ? <div className="wd-dialog-actions">
      {state?.canCancelThis && !(transfer?.returnedFromId && transfer.workOrderId) ? <Button variant="quiet" onPress={() => setCancelling(true)}>{t("Cancel move")}</Button> : null}<span className={styles.spacer} />
      <Button variant="primary" isLoading={busy} isDisabled={Boolean(invalid)} onPress={() => void run("receive", {
        lines: state!.lines.map((line) => ({ id: line.id, received: arrivals[line.id].received, lossReason: arrivals[line.id].reason.trim(),
          ...(Number(arrivals[line.id].refused || 0) > 0 ? { rejected: arrivals[line.id].refused, rejectReason: arrivals[line.id].refuseReason.trim() } : {}) })) })}>{t("Receive")}</Button></div> : null}>
    {error && !state ? <ErrorState description={error} onRetry={() => void load()} /> : !state || !transfer ? <Skeleton lines={6} shape="facts" /> : <div className={styles.sheet}>
      <div className={ops.recordHead}>
        <div className={ops.recordFacts}>
          <MoveStatus status={transfer.status} short={transfer.short} rejected={transfer.rejected} />
          <span>{`${transfer.fromName} → ${transfer.toName}`}</span>
          <ProjectLinks projects={transfer.projects ?? []} />
          {transfer.workOrderId && transfer.workOrderNumber ? <Link className={ops.projectLink} href={`/workspace/factory/orders?order=${transfer.workOrderId}`}>{orderNumber(transfer.workOrderNumber)}</Link> : null}
        </div>
        {open ? <NextStep title={t("Receive it where it arrived")} detail={made ? t("Refuse anything damaged or not to spec: it goes back to the factory to be made again.") : null} /> : null}
      </div>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      {transfer.status === "cancelled" ? <InlineNotice tone="info" message={t("Cancelled: {reason}", { reason: transfer.cancelReason ?? "" })} /> : null}
      {transfer.returnedFromId && transfer.returnedFromNumber ? <InlineNotice tone="info" message={t("Brings back what was refused on move {number}.", { number: transfer.returnedFromNumber })} /> : null}
      {transfer.returnId && transfer.returnNumber ? <div><Button size="compact" variant="quiet" onPress={() => onOpenMove?.(transfer.returnId!)}>
        {t("Refused goods go back on move {number}", { number: transfer.returnNumber })}</Button></div> : null}
      <dl className={styles.facts}>
        <div><dt>{t("Sent")}</dt><dd>{[format.day(transfer.sentOn), transfer.sentByName].join(" · ")}</dd></div>
        {transfer.receivedOn ? <div><dt>{t("Arrived")}</dt><dd>{[format.day(transfer.receivedOn), transfer.receivedByName].join(" · ")}</dd></div> : null}
        {transfer.note ? <div><dt>{t("Note")}</dt><dd>{transfer.note}</dd></div> : null}
      </dl>
      <div className={styles.lines} role="table" aria-label={t("Lines")} data-columns={open ? "4" : "3"}>
        <div role="row" className={styles.lineHead}><span role="columnheader">{t("Item")}</span><span role="columnheader">{t("Sent")}</span><span role="columnheader">{t("Arrived")}</span>
          {open ? <span role="columnheader">{t("Refused")}</span> : null}</div>
        {state.lines.map((line) => {
          const arrival = arrivals[line.id];
          return <div role="row" key={line.id} className={styles.line}>
            <span role="cell" className={styles.nameCell}><span>{line.itemName}</span><small>{[line.projectReference ?? t("Free stock"), !open ? line.lossReason : "",
              !open && Number(line.rejected ?? 0) > 0 ? t("{quantity} refused: {reason}", { quantity: `${quantityText(line.rejected!)} ${line.unit}`.trim(), reason: line.rejectReason ?? "" }) : ""]
              .filter(Boolean).join(" · ")}</small></span>
            <span role="cell" className={styles.number}>{`${quantityText(line.quantity)} ${line.unit}`.trim()}</span>
            <span role="cell" className={styles.number}>{open && arrival ? <TextInput aria-label={t("Arrived of {item}", { item: line.itemName })} label={null} inputMode="decimal" suffix={line.unit || undefined}
              value={arrival.received} onChange={(value) => setArrivals({ ...arrivals, [line.id]: { ...arrival, received: numeric(value) } })} />
              : line.received === null ? "—" : `${quantityText(line.received)} ${line.unit}`.trim()}</span>
            {open && arrival ? <span role="cell"><TextInput aria-label={t("Refused of {item}", { item: line.itemName })} label={null} inputMode="decimal" placeholder="0"
              value={arrival.refused} onChange={(value) => setArrivals({ ...arrivals, [line.id]: { ...arrival, refused: numeric(value) } })} /></span> : null}
            {open && arrival && Number(arrival.received) < Number(line.quantity) ? <span className={styles.lineNote}><TextInput label={t("What happened to the rest")} isRequired value={arrival.reason}
              onChange={(reason) => setArrivals({ ...arrivals, [line.id]: { ...arrival, reason } })} /></span> : null}
            {open && arrival && Number(arrival.refused || 0) > 0 ? <span className={styles.lineNote}><TextInput label={t("Why {item} is refused", { item: line.itemName })} isRequired value={arrival.refuseReason}
              onChange={(refuseReason) => setArrivals({ ...arrivals, [line.id]: { ...arrival, refuseReason } })} /></span> : null}
            {open && arrival && Number(arrival.refused || 0) > Number(arrival.received || 0) ? <span className={styles.lineNote}>
              <InlineNotice tone="error" message={t("More of {item} is refused than arrived.", { item: line.itemName })} /></span> : null}
          </div>;
        })}
      </div>
    </div>}
    {cancelling ? <CancelMove onClose={() => setCancelling(false)} onSave={async (reason) => { if (await run("cancel", { reason })) setCancelling(false); }} /> : null}
  </InspectorSheet>;
}

function CancelMove({ onClose, onSave }: { onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return <FormDialog size="md" title={t("Cancel move")} onClose={onClose} cancelLabel={t("Back")} isSubmitDisabled={!reason.trim()} submitLabel={t("Cancel move")} onSubmit={async () => { await onSave(reason.trim()); }}>
    <TextAreaField label={t("Why it's cancelled")} isRequired value={reason} onChange={setReason} />
  </FormDialog>;
}
