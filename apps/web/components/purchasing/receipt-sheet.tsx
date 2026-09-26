"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, ErrorState, InlineNotice, InspectorSheet, Skeleton, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PurchasingApi } from "@/lib/purchasing/client";
import type { ReceiptState } from "@/lib/purchasing/types";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "./order-labels";
import { usePlaceLabel } from "./receive-dialog";
import styles from "./purchasing.module.css";

type Check = { accepted: string; rejected: string; reason: string };
const numeric = (value: string) => value.replace(/[^\d.]/g, "");
const amount = (value: string, unit: string) => `${quantityText(value)} ${unit}`.trim();

/** Whether a receipt still waits for inspection, and what came of it. */
export function ReceiptResult({ receipt }: { receipt: ReceiptState["receipt"] }) {
  const t = useT();
  const status = Number(receipt.pending) > 0 ? "pending_approval" : Number(receipt.rejected) > 0 ? "cancelled" : "confirmed";
  const label = Number(receipt.pending) > 0 ? t("To inspect") : Number(receipt.rejected) > 0 ? t("Some rejected") : t("Accepted");
  return <span className={styles.orderStatus} data-status={status}>{label}</span>;
}

/**
 * One delivery: where and when it arrived, who received it, and each line's received, accepted and
 * rejected quantities. Someone other than the receiver inspects what's waiting: accepted by default,
 * with the reason for anything rejected.
 */
export function ReceiptSheet({ api, receiptId, onChanged, onClose, onOpenOrder }: { api: PurchasingApi; receiptId: string; onChanged: () => void; onClose: () => void; onOpenOrder: (orderId: string) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const placeLabel = usePlaceLabel();
  const [state, setState] = useState<ReceiptState | null>(null);
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const accept = useCallback((next: ReceiptState) => {
    setState(next);
    setChecks(Object.fromEntries(next.lines.filter((line) => Number(line.pending) > 0).map((line) => [line.id, { accepted: quantityText(line.pending), rejected: "", reason: "" }])));
  }, []);
  const load = useCallback(async () => {
    try { accept(await api.receipt(receiptId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The delivery didn't load.")); }
  }, [api, receiptId, accept, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const receipt = state?.receipt;
  const inspecting = Boolean(state?.canInspectThis);
  const setCheck = (id: string, patch: Partial<Check>) => {
    const line = state!.lines.find((item) => item.id === id)!;
    const next = { ...checks[id], ...patch };
    // Rejecting some takes it from what's accepted, so the two always add up to what's waiting.
    if (patch.rejected !== undefined) next.accepted = quantityText(Math.max(0, Number(line.pending) - Number(next.rejected || 0)).toFixed(4));
    setChecks({ ...checks, [id]: next });
  };
  const waiting = (state?.lines ?? []).filter((line) => Number(line.pending) > 0);
  const invalid = waiting.find((line) => {
    const check = checks[line.id];
    return !check || Number(check.rejected || 0) > Number(line.pending) || (Number(check.rejected) > 0 && !check.reason.trim());
  });
  const inspect = async () => {
    setBusy(true); setNotice("");
    try {
      accept(await api.inspect(receiptId, { lines: waiting.map((line) => ({ id: line.id, accepted: checks[line.id].accepted || "0", rejected: checks[line.id].rejected || "0", rejectReason: checks[line.id].reason.trim() })) }));
      onChanged();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : t("Could not save.")); }
    setBusy(false);
  };

  return <InspectorSheet isOpen size="lg" title={receipt ? t("Delivery {number}", { number: receipt.number }) : t("Delivery")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={inspecting ? <div className="wd-dialog-actions"><span className={styles.spacer} />
      <Button variant="primary" isLoading={busy} isDisabled={Boolean(invalid)} onPress={() => void inspect()}>{t("Save inspection")}</Button></div> : null}>
    {error && !state ? <ErrorState description={error} onRetry={() => void load()} /> : !state || !receipt ? <Skeleton lines={6} /> : <div className={styles.sheet}>
      <div className={styles.approvalRow}>
        <ReceiptResult receipt={receipt} />
        <span className={styles.muted}>{receipt.supplierName}</span>
        <Button size="compact" variant="quiet" onPress={() => onOpenOrder(receipt.orderId)}>{receipt.orderNumber}</Button>
      </div>
      {notice ? <InlineNotice tone="error" message={notice} /> : null}
      {Number(receipt.pending) > 0 && !inspecting ? <InlineNotice tone="info" message={state.canInspect ? t("Someone else inspects goods you received.") : t("Waiting for someone who inspects deliveries.")} /> : null}
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
            const open = inspecting && check && Number(line.pending) > 0;
            return <div role="row" key={line.id} className={styles.receiveLine}>
              <span role="cell" className={styles.nameCell}><span>{line.description}</span>
                <small>{[line.projectReference, line.specification, !open && line.rejectReason ? line.rejectReason : ""].filter(Boolean).join(" · ")}</small></span>
              <span role="cell" className={styles.money}>{amount(line.received, line.unit)}</span>
              {open ? <>
                <span role="cell" className={styles.money}>{amount((Number(line.accepted) + Number(check.accepted || 0)).toFixed(4), line.unit)}</span>
                <span role="cell"><TextInput aria-label={t("Rejected of {item}", { item: line.description })} label={null} inputMode="decimal" value={check.rejected}
                  onChange={(value) => setCheck(line.id, { rejected: numeric(value) })} /></span>
                {Number(check.rejected) > 0 ? <span className={styles.receiveReason}><TextInput label={t("Why it was rejected")} isRequired value={check.reason}
                  onChange={(reason) => setCheck(line.id, { reason })} /></span> : null}
              </> : <>
                <span role="cell" className={styles.money}>{Number(line.pending) > 0 ? <span className={styles.muted}>{t("To inspect")}</span> : amount(line.accepted, line.unit)}</span>
                <span role="cell" className={styles.money}>{Number(line.rejected) > 0 ? amount(line.rejected, line.unit) : "—"}</span>
              </>}
            </div>;
          })}
        </div>
      </section>
      {receipt.notes ? <p className={styles.dialogText}>{receipt.notes}</p> : null}
    </div>}
  </InspectorSheet>;
}
