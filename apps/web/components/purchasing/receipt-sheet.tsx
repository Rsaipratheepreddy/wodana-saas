"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Checkbox, ControlledModalDialog, ErrorState, InlineNotice, InspectorSheet, Skeleton, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { addExact, subtractExact } from "@/lib/purchasing/amounts";
import type { PurchasingApi } from "@/lib/purchasing/client";
import type { ReceiptState, RejectKind, SupplierReturnState } from "@/lib/purchasing/types";
import { useProjectFormat } from "../project-core/format";
import { quantityText, useOrderLabels } from "./order-labels";
import { RejectFields, usePlaceLabel } from "./receive-dialog";
import { ReturnDialog } from "./return-dialog";
import styles from "./purchasing.module.css";

type Check = { include: boolean; rejected: string; kind: RejectKind | null; reason: string };
const numeric = (value: string) => value.replace(/[^\d.]/g, "");
const amount = (value: string, unit: string) => `${quantityText(value)} ${unit}`.trim();

/** Whether a receipt still waits for inspection, and what came of it. */
export function ReceiptResult({ receipt }: { receipt: ReceiptState["receipt"] }) {
  const t = useT();
  const status = receipt.reversedAt ? "cancelled" : Number(receipt.pending) > 0 ? "pending_approval" : Number(receipt.rejected) > 0 || Number(receipt.missing) > 0 ? "cancelled" : "confirmed";
  const label = receipt.reversedAt ? t("Reversed") : Number(receipt.pending) > 0 ? t("To inspect") : Number(receipt.rejected) > 0 ? t("Some rejected")
    : Number(receipt.missing) > 0 ? t("Some missing") : t("Accepted");
  return <span className={styles.orderStatus} data-status={status}>{label}</span>;
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
  const setCheck = (id: string, patch: Partial<Check>) => setChecks({ ...checks, [id]: { ...checks[id], ...patch } });
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
    {error && !state ? <ErrorState description={error} onRetry={() => void load()} /> : !state || !receipt ? <Skeleton lines={6} /> : <div className={styles.sheet}>
      <div className={styles.approvalRow}>
        <ReceiptResult receipt={receipt} />
        <span className={styles.muted}>{receipt.supplierName}</span>
        <Button size="compact" variant="quiet" onPress={() => onOpenOrder(receipt.orderId)}>{receipt.orderNumber}</Button>
      </div>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      {receipt.reversedAt ? <InlineNotice tone="info" message={t("Reversed by {name}: {reason}", { name: receipt.reversedByName ?? "", reason: receipt.reverseReason ?? "" })} />
        : Number(receipt.pending) > 0 && !inspecting ? <InlineNotice tone="info" message={state.canInspect ? t("Someone else inspects goods you received.") : t("Waiting for someone who inspects deliveries.")} /> : null}
      <dl className={styles.facts}>
        <div><dt>{t("Arrived at")}</dt><dd>{placeLabel({ kind: receipt.locationKind, name: receipt.locationName, projectReference: null })}</dd></div>
        <div><dt>{t("Received")}</dt><dd>{[format.day(receipt.receivedOn), receipt.receivedByName].join(" · ")}</dd></div>
        {receipt.deliveryNote ? <div><dt>{t("Delivery note")}</dt><dd>{receipt.deliveryNote}</dd></div> : null}
        {receipt.inspectedByName ? <div><dt>{t("Inspected")}</dt><dd>{[format.when(receipt.inspectedAt), receipt.inspectedByName].join(" · ")}</dd></div> : null}
      </dl>
      <section className={styles.part} aria-label={t("Lines")}>
        <div className={styles.receiveLines} role="table" aria-label={t("Lines")}>
          <div role="row" className={styles.receiveHead}><span role="columnheader">{t("Item")}</span><span role="columnheader">{t("Received")}</span>
            <span role="columnheader">{t("Accepted")}</span><span role="columnheader">{t("Rejected")}</span></div>
          {state.lines.map((line) => {
            const check = checks[line.id];
            const open = inspecting && check && Number(line.pending) > 0 && !receipt.reversedAt;
            const missing = line.noted !== null && Number(line.noted) > Number(line.received) ? subtractExact(line.noted, line.received) : null;
            const back = addExact(line.returnedRejected, line.returnedAccepted);
            const facts = [line.projectReference, line.specification].filter(Boolean).join(" · ");
            return <div role="row" key={line.id} className={styles.receiveLine}>
              <span role="cell" className={styles.nameCell}><span>{line.description}</span>{facts ? <small>{facts}</small> : null}
                {open ? <Checkbox isSelected={check.include} onChange={(include) => setCheck(line.id, { include })}>{t("Inspect now")}</Checkbox> : null}
                {!open && Number(line.rejected) > 0 ? <small>{[line.rejectKind ? labels.rejectKind[line.rejectKind] : "", line.rejectReason].filter(Boolean).join(": ")}</small> : null}
                {missing ? <small className={styles.lateText}>{t("{quantity} missing against the note", { quantity: amount(missing, line.unit) })}</small> : null}
                {back !== "0" ? <small>{t("{quantity} going back to the supplier", { quantity: amount(back, line.unit) })}</small> : null}</span>
              <span role="cell" className={styles.money}>{amount(line.received, line.unit)}</span>
              {open && check.include ? <>
                <span role="cell" className={styles.money}>{amount(addExact(line.accepted, subtractExact(line.pending, check.rejected || "0")), line.unit)}</span>
                <span role="cell"><TextInput aria-label={t("Rejected of {item}", { item: line.description })} label={null} inputMode="decimal" value={check.rejected}
                  onChange={(value) => setCheck(line.id, { rejected: numeric(value) })} /></span>
                {Number(check.rejected) > 0 ? <RejectFields description={line.description} kind={check.kind} reason={check.reason} labels={labels.rejectKind} onChange={(patch) => setCheck(line.id, patch)} /> : null}
              </> : <>
                <span role="cell" className={styles.money}>{Number(line.pending) > 0 && !receipt.reversedAt ? <span className={styles.muted}>{t("To inspect")}</span> : amount(line.accepted, line.unit)}</span>
                <span role="cell" className={styles.money}>{Number(line.rejected) > 0 ? amount(line.rejected, line.unit) : "—"}</span>
              </>}
            </div>;
          })}
        </div>
      </section>
      {receipt.notes ? <p className={styles.dialogText}>{receipt.notes}</p> : null}
    </div>}
    {dialog === "reverse" ? <ReverseDialog onClose={() => setDialog(null)} onSave={async (reason) => {
      try { accept(await api.reverse(receiptId, reason)); setDialog(null); onChanged(); } catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); setDialog(null); }
    }} /> : null}
    {dialog === "return" && state ? <ReturnDialog api={api} receipt={state} onClose={() => setDialog(null)}
      onCreated={(next) => { setDialog(null); void load(); onChanged(); onReturn?.(next); }} /> : null}
  </InspectorSheet>;
}

function ReverseDialog({ onClose, onSave }: { onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("Reverse this delivery")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Back")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!reason.trim()} onPress={async () => { setBusy(true); await onSave(reason.trim()); setBusy(false); }}>{t("Reverse")}</Button></div>}>
    <div className={styles.dialogBody}>
      <p className={styles.dialogText}>{t("It stops counting and its goods come out of stock. Receive the right delivery again.")}</p>
      <TextAreaField label={t("What was wrong with it")} isRequired value={reason} onChange={setReason} />
    </div>
  </ControlledModalDialog>;
}
