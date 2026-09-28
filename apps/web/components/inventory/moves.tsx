"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, ControlledModalDialog, DataGrid, EmptyState, ErrorState, InlineNotice, InspectorSheet, NoResultsState, Skeleton, TextAreaField, TextInput, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { InventoryApi } from "@/lib/inventory/client";
import type { TransferRow, TransferState, TransfersState, TransferStatus } from "@/lib/inventory/types";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "../purchasing/order-labels";
import styles from "./inventory.module.css";

const numeric = (value: string) => value.replace(/[^\d.]/g, "");

/** A move's state as a dot and a word: in transit, arrived (or arrived short), cancelled. */
export function MoveStatus({ status, short }: { status: TransferStatus; short: boolean }) {
  const t = useT();
  const tone = status === "in_transit" ? "info" : status === "cancelled" ? "danger" : short ? "warning" : "success";
  const label = status === "in_transit" ? t("In transit") : status === "cancelled" ? t("Cancelled") : short ? t("Arrived short") : t("Arrived");
  return <span className={styles.status} data-tone={tone}>{label}</span>;
}

/** Moves between places: the ones in transit first. A move opens to receive it where it arrived, or to read it. */
export function Moves({ api, openId, onOpen, refreshKey, onChanged }: { api: InventoryApi; openId: string | null; onOpen: (id: string | null) => void; refreshKey: number; onChanged: () => void }) {
  const t = useT();
  const format = useProjectFormat();
  const [state, setState] = useState<TransfersState | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const load = useCallback(async () => {
    try { setState(await api.transfers()); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Moves didn't load.")); }
  }, [api, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, refreshKey]);
  const rows = (state?.transfers ?? []).filter((row) => !search.trim() || `${row.number} ${row.fromName} ${row.toName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const columns = useMemo<DataGridColumn<TransferRow>[]>(() => [
    { id: "number", header: t("Move"), accessorFn: (row) => row.number, size: 150, meta: { primary: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{t("Move {number}", { number: row.number })}</span><small>{row.lines === 1 ? t("1 line") : t("{count} lines", { count: row.lines })}</small></span> } },
    { id: "route", header: t("From and to"), accessorFn: (row) => `${row.fromName} ${row.toName}`, size: 260, meta: { renderCell: (row) => <span className={styles.nameCell}>
      <span>{row.fromName}</span><small>{t("to {place}", { place: row.toName })}</small></span> } },
    { id: "status", header: t("Status"), accessorFn: (row) => row.status, size: 150, meta: { renderCell: (row) => <MoveStatus status={row.status} short={row.short} /> } },
    { id: "sent", header: t("Sent"), accessorFn: (row) => row.sentOn, size: 170, meta: { mobileHidden: true, renderCell: (row) => <span className={styles.nameCell}>
      <span>{format.day(row.sentOn)}</span><small>{row.sentByName}</small></span> } },
  ], [t, format]);
  if (error && !state) return <ErrorState description={error} onRetry={() => void load()} />;
  return <>
    <DataGrid<TransferRow> ariaLabel={t("Moves")} columns={columns} data={rows} getRowId={(row) => row.id} isLoading={!state} onRowAction={(row) => onOpen(row.id)}
      onSearchChange={setSearch} searchValue={search} searchLabel={t("Search moves")} rowNumbers={false} selectable={false} wrapText
      emptyContent={search.trim() ? <NoResultsState onClear={() => setSearch("")} /> : <EmptyState title={t("No moves yet")} description={t("Move stock from a row in Stock.")} />} />
    {openId ? <MoveSheet api={api} transferId={openId} onChanged={() => { void load(); onChanged(); }} onClose={() => onOpen(null)} /> : null}
  </>;
}

type Arrival = { received: string; reason: string };

/** One move: what was sent, and — while it's in transit — what arrived, with the reason for anything missing. */
function MoveSheet({ api, transferId, onChanged, onClose }: { api: InventoryApi; transferId: string; onChanged: () => void; onClose: () => void }) {
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
    setArrivals(Object.fromEntries(next.lines.map((line) => [line.id, { received: quantityText(line.received ?? line.quantity), reason: line.lossReason }])));
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
    return !arrival || arrival.received === "" || Number(arrival.received) > Number(line.quantity) || (Number(arrival.received) < Number(line.quantity) && !arrival.reason.trim());
  });
  const transfer = state?.transfer;
  return <InspectorSheet isOpen size="lg" title={transfer ? t("Move {number}", { number: transfer.number }) : t("Move")} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={open ? <div className="wd-dialog-actions">
      {state?.canCancelThis ? <Button variant="quiet" onPress={() => setCancelling(true)}>{t("Cancel move")}</Button> : null}<span className={styles.spacer} />
      <Button variant="primary" isLoading={busy} isDisabled={Boolean(invalid)} onPress={() => void run("receive", {
        lines: state!.lines.map((line) => ({ id: line.id, received: arrivals[line.id].received, lossReason: arrivals[line.id].reason.trim() })) })}>{t("Receive")}</Button></div> : null}>
    {error && !state ? <ErrorState description={error} onRetry={() => void load()} /> : !state || !transfer ? <Skeleton lines={6} shape="facts" /> : <div className={styles.sheet}>
      <div className={styles.headRow}><MoveStatus status={transfer.status} short={transfer.short} /><span className={styles.muted}>{`${transfer.fromName} → ${transfer.toName}`}</span></div>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      {transfer.status === "cancelled" ? <InlineNotice tone="info" message={t("Cancelled: {reason}", { reason: transfer.cancelReason ?? "" })} /> : null}
      <dl className={styles.facts}>
        <div><dt>{t("Sent")}</dt><dd>{[format.day(transfer.sentOn), transfer.sentByName].join(" · ")}</dd></div>
        {transfer.receivedOn ? <div><dt>{t("Arrived")}</dt><dd>{[format.day(transfer.receivedOn), transfer.receivedByName].join(" · ")}</dd></div> : null}
        {transfer.note ? <div><dt>{t("Note")}</dt><dd>{transfer.note}</dd></div> : null}
      </dl>
      <div className={styles.lines} role="table" aria-label={t("Lines")}>
        <div role="row" className={styles.lineHead}><span role="columnheader">{t("Item")}</span><span role="columnheader">{t("Sent")}</span><span role="columnheader">{t("Arrived")}</span></div>
        {state.lines.map((line) => {
          const arrival = arrivals[line.id];
          return <div role="row" key={line.id} className={styles.line}>
            <span role="cell" className={styles.nameCell}><span>{line.itemName}</span><small>{[line.projectReference ?? t("Free stock"), !open ? line.lossReason : ""].filter(Boolean).join(" · ")}</small></span>
            <span role="cell" className={styles.number}>{`${quantityText(line.quantity)} ${line.unit}`.trim()}</span>
            <span role="cell" className={styles.number}>{open && arrival ? <TextInput aria-label={t("Arrived of {item}", { item: line.itemName })} label={null} inputMode="decimal" suffix={line.unit || undefined}
              value={arrival.received} onChange={(value) => setArrivals({ ...arrivals, [line.id]: { ...arrival, received: numeric(value) } })} />
              : line.received === null ? "—" : `${quantityText(line.received)} ${line.unit}`.trim()}</span>
            {open && arrival && Number(arrival.received) < Number(line.quantity) ? <span className={styles.lineNote}><TextInput label={t("What happened to the rest")} isRequired value={arrival.reason}
              onChange={(reason) => setArrivals({ ...arrivals, [line.id]: { ...arrival, reason } })} /></span> : null}
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
  return <ControlledModalDialog isOpen size="md" title={t("Cancel move")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Back")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!reason.trim()} onPress={async () => { setBusy(true); await onSave(reason.trim()); setBusy(false); }}>{t("Cancel move")}</Button></div>}>
    <TextAreaField label={t("Why it's cancelled")} isRequired value={reason} onChange={setReason} />
  </ControlledModalDialog>;
}
