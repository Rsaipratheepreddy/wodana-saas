"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge, Button, Checkbox, DataGrid, EditableFieldList, ErrorState, FactRow, InlineNotice, InspectorSheet, NumericInput, ReasonDialog, Skeleton, VisuallyHidden, type DataGridColumn,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { addExact, subtractExact } from "@/lib/purchasing/amounts";
import type { PurchasingApi } from "@/lib/purchasing/client";
import type { ReceiptLine, ReceiptState, RejectKind, SupplierReturnState } from "@/lib/purchasing/types";
import { useProjectFormat } from "../project-core/format";
import { PhotoPicker, SavedPhotos } from "./delivery-photos";
import { fieldNumber, fieldText, quantityText, useOrderLabels } from "./order-labels";
import { RejectFields, usePlaceLabel } from "./receive-dialog";
import { ReturnDialog } from "./return-dialog";
import styles from "./purchasing.module.css";

type Check = { include: boolean; rejected: string; kind: RejectKind | null; reason: string };
const amount = (value: string, unit: string) => `${quantityText(value)} ${unit}`.trim();

/** Whether a receipt still waits for inspection, and what came of it. */
export function ReceiptResult({ receipt }: { receipt: ReceiptState["receipt"] }) {
  const t = useT();
  const tone = receipt.reversedAt ? "neutral" : Number(receipt.pending) > 0 ? "warning" : Number(receipt.rejected) > 0 || Number(receipt.missing) > 0 ? "danger" : "success";
  const label = receipt.reversedAt ? t("Reversed") : Number(receipt.pending) > 0 ? t("To inspect") : Number(receipt.rejected) > 0 ? t("Some rejected")
    : Number(receipt.missing) > 0 ? t("Some missing") : t("Accepted");
  return <Badge tone={tone}>{label}</Badge>;
}

/**
 * One delivery: where and when it arrived, who received it, and each line's received, accepted and
 * rejected quantities, with anything missing against the supplier's note. Someone other than the
 * receiver inspects what's waiting, line by line; rejected goods say what was wrong. Goods can go back
 * to the supplier from here, and a delivery entered by mistake is reversed.
 */
export function ReceiptSheet({ api, receiptId, onChanged, onClose, onOpenOrder, onReturn }: {
  api: PurchasingApi; receiptId: string; onChanged: () => void; onClose: () => void; onOpenOrder: (orderId: string) => void; onReturn?: (next: SupplierReturnState) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const placeLabel = usePlaceLabel();
  const labels = useOrderLabels();
  const [state, setState] = useState<ReceiptState | null>(null);
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"reverse" | "return" | null>(null);
  const [adding, setAdding] = useState<File[]>([]);
  const addPhotos = async (files: File[]) => {
    setAdding(files);
    if (!files.length) return;
    setNotice("");
    try {
      let next: ReceiptState | null = null;
      for (const file of files) next = await api.uploadPhoto({ kind: "receipt", id: receiptId }, crypto.randomUUID(), file);
      if (next) setState(next);
      onChanged();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : t("The photo could not be uploaded.")); }
    setAdding([]);
  };
  const accept = useCallback((next: ReceiptState) => {
    setState(next);
    setChecks(Object.fromEntries(next.lines.filter((line) => Number(line.pending) > 0).map((line) => [line.id, { include: true, rejected: "", kind: null, reason: "" }])));
  }, []);
  const load = useCallback(async () => {
    try { accept(await api.receipt(receiptId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The delivery didn't load.")); }
  }, [api, receiptId, accept, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const receipt = state?.receipt;
  const inspecting = Boolean(state?.canInspectThis);
  const setCheck = (id: string, patch: Partial<Check>) => setChecks((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  /** A line still waiting that this inspector is checking now. */
  const checking = (line: ReceiptLine) => Boolean(inspecting && checks[line.id] && Number(line.pending) > 0 && !receipt?.reversedAt);
  const lineColumns: DataGridColumn<ReceiptLine>[] = [
    { id: "item", header: t("Item"), size: 260, accessorFn: (line) => line.description, meta: { renderCell: (line) => {
      const check = checks[line.id];
      const open = checking(line);
      const missing = line.noted !== null && Number(line.noted) > Number(line.received) ? subtractExact(line.noted, line.received) : null;
      const back = addExact(line.returnedRejected, line.returnedAccepted);
      const facts = [line.projectReference, line.specification].filter(Boolean).join(" · ");
      return <span className={styles.nameCell}><span>{line.description}</span>{facts ? <small>{facts}</small> : null}
        {open ? <Checkbox isSelected={check.include} onChange={(include) => setCheck(line.id, { include })}>{t("Inspect now")}</Checkbox> : null}
        {!open && Number(line.rejected) > 0 ? <small>{[line.rejectKind ? labels.rejectKind[line.rejectKind] : "", line.rejectReason].filter(Boolean).join(": ")}</small> : null}
        {missing ? <small className={styles.lateText}>{t("{quantity} missing against the note", { quantity: amount(missing, line.unit) })}</small> : null}
        {back !== "0" ? <small>{t("{quantity} going back to the supplier", { quantity: amount(back, line.unit) })}</small> : null}</span>;
    } } },
    { id: "received", header: t("Received"), size: 120, accessorFn: (line) => Number(line.received), meta: { align: "end", renderCell: (line) => <span className={styles.money}>{amount(line.received, line.unit)}</span> } },
    { id: "accepted", header: t("Accepted"), size: 130, accessorFn: (line) => Number(line.accepted), meta: { align: "end", renderCell: (line) => checking(line) && checks[line.id].include
      ? <span className={styles.money}>{amount(addExact(line.accepted, subtractExact(line.pending, checks[line.id].rejected || "0")), line.unit)}</span>
      : <span className={styles.money}>{Number(line.pending) > 0 && !receipt?.reversedAt ? <span className={styles.muted}>{t("To inspect")}</span> : amount(line.accepted, line.unit)}</span> } },
    { id: "rejected", header: t("Rejected"), size: 130, accessorFn: (line) => Number(line.rejected), meta: { align: "end", renderCell: (line) => checking(line) && checks[line.id].include
      ? <NumericInput label={<VisuallyHidden>{t("Rejected of {item}", { item: line.description })}</VisuallyHidden>} minValue={0} formatOptions={{ maximumFractionDigits: 4 }}
        value={fieldNumber(checks[line.id].rejected)} onChange={(value) => setCheck(line.id, { rejected: fieldText(value) })} />
      : <span className={styles.money}>{Number(line.rejected) > 0 ? amount(line.rejected, line.unit) : "—"}</span> } },
  ];
  const chosen = (state?.lines ?? []).filter((line) => Number(line.pending) > 0 && checks[line.id]?.include);
  const invalid = chosen.find((line) => {
    const check = checks[line.id];
    return Number(check.rejected || 0) > Number(line.pending) || (Number(check.rejected) > 0 && (!check.reason.trim() || !check.kind));
  });
  const inspect = async () => {
    setBusy(true); setNotice("");
    try {
      accept(await api.inspect(receiptId, { lines: chosen.map((line) => {
        const check = checks[line.id];
        const rejected = check.rejected || "0";
        return { id: line.id, accepted: subtractExact(line.pending, rejected), rejected, rejectKind: check.kind, rejectReason: check.reason.trim() };
      }) }));
      onChanged();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); }
    setBusy(false);
  };

  const footer = !state ? null : inspecting || state.canReturnThis || state.canReverseThis ? <div className="wd-dialog-actions">
    {state.canReverseThis ? <Button variant="quiet" onPress={() => setDialog("reverse")}>{t("Reverse")}</Button> : null}
    {state.canReturnThis ? <Button variant="quiet" onPress={() => setDialog("return")}>{t("Return to supplier")}</Button> : null}
    <span className={styles.spacer} />
    {inspecting ? <Button variant="primary" isLoading={busy} isDisabled={!chosen.length || Boolean(invalid)} onPress={() => void inspect()}>{t("Save inspection")}</Button> : null}
  </div> : null;

  return <InspectorSheet isOpen size="lg" title={receipt ? t("Delivery {number}", { number: receipt.number }) : t("Delivery")} onOpenChange={(open) => { if (!open) onClose(); }} footer={footer}>
    {error && !state ? <ErrorState description={error} onRetry={() => void load()} /> : !state || !receipt ? <Skeleton lines={6} shape="facts" /> : <div className={styles.sheet}>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      {receipt.reversedAt ? <InlineNotice tone="info" message={t("Reversed by {name}: {reason}", { name: receipt.reversedByName ?? "", reason: receipt.reverseReason ?? "" })} />
        : Number(receipt.pending) > 0 && !inspecting ? <InlineNotice tone="info" message={state.canInspect ? t("Someone else inspects goods you received.") : t("Waiting for someone who inspects deliveries.")} /> : null}
      {state.needsPhoto ? <InlineNotice tone="error" message={t("No photo of this site delivery yet.")} /> : null}
      <EditableFieldList>
        <FactRow label={t("Status")}><ReceiptResult receipt={receipt} /></FactRow>
        <FactRow label={t("Supplier")}>{receipt.supplierName}</FactRow>
        <FactRow label={t("Order")}><Button size="compact" variant="quiet" onPress={() => onOpenOrder(receipt.orderId)}>{receipt.orderNumber}</Button></FactRow>
        <FactRow label={t("Arrived at")}>{placeLabel({ kind: receipt.locationKind, name: receipt.locationName, projectReference: null })}</FactRow>
        <FactRow label={t("Received")}>{[format.day(receipt.receivedOn), receipt.receivedByName].join(" · ")}</FactRow>
        {receipt.deliveryNote ? <FactRow label={t("Delivery note")}>{receipt.deliveryNote}</FactRow> : null}
        {receipt.handedOverBy ? <FactRow label={t("Handed over by")}>{receipt.handedOverBy}</FactRow> : null}
        {receipt.inspectedByName ? <FactRow label={t("Inspected")}>{[format.when(receipt.inspectedAt), receipt.inspectedByName].join(" · ")}</FactRow> : null}
        {receipt.notes ? <FactRow label={t("Notes")}>{receipt.notes}</FactRow> : null}
      </EditableFieldList>
      <section className={styles.part} aria-label={t("Lines")}>
        <DataGrid ariaLabel={t("Lines")} data={state.lines} getRowId={(line) => line.id} columns={lineColumns}
          showToolbar={false} showFooter={false} selectable={false} rowNumbers={false} pinFirstColumn={false} wrapText />
        {/* What was wrong with each line rejected now, under the table, named by its item. */}
        {state.lines.filter((line) => checking(line) && checks[line.id].include && Number(checks[line.id].rejected) > 0).map((line) => <RejectFields key={line.id}
          description={line.description} kind={checks[line.id].kind} reason={checks[line.id].reason} labels={labels.rejectKind} onChange={(patch) => setCheck(line.id, patch)} />)}
      </section>
      {state.photos.length || (state.canReceive && !receipt.reversedAt) ? <section className={styles.part} aria-label={t("Photos")}>
        <h3 className={styles.subhead}>{t("Photos")}</h3>
        <SavedPhotos photos={state.photos} url={api.photoUrl} />
        {state.canReceive && !receipt.reversedAt ? <PhotoPicker files={adding} onChange={(files) => void addPhotos(files)} label={t("Add photos")} /> : null}
      </section> : null}
    </div>}
    {dialog === "reverse" ? <ReverseDialog onClose={() => setDialog(null)} onSave={async (reason) => {
      accept(await api.reverse(receiptId, reason)); setDialog(null); onChanged();
    }} /> : null}
    {dialog === "return" && state ? <ReturnDialog api={api} receipt={state} onClose={() => setDialog(null)}
      onCreated={(next) => { setDialog(null); void load(); onChanged(); onReturn?.(next); }} /> : null}
  </InspectorSheet>;
}

function ReverseDialog({ onClose, onSave }: { onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const t = useT();
  return <ReasonDialog title={t("Reverse this delivery")} description={t("Its goods come out of stock.")} label={t("What was wrong with it")} confirmLabel={t("Reverse")} confirmVariant="danger"
    onConfirm={onSave} onClose={onClose} />;
}
