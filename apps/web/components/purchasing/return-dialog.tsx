"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, ControlledModalDialog, InlineNotice, SegmentedControl, Switch, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PurchasingApi } from "@/lib/purchasing/client";
import type { ReceiptLine, ReceiptState, RejectKind, SupplierReturnState } from "@/lib/purchasing/types";
import { quantityText, useOrderLabels } from "./order-labels";
import { RejectFields } from "./receive-dialog";
import styles from "./purchasing.module.css";

type Row = { key: string; line: ReceiptLine; source: "rejected" | "accepted"; left: string; quantity: string; kind: RejectKind | null; reason: string };
const numeric = (value: string) => value.replace(/[^\d.]/g, "");
const left = (a: string, b: string) => Math.max(0, Number(a) - Number(b)).toFixed(4);

/**
 * Sends goods from one delivery back to the supplier: what was rejected, or accepted goods found wrong
 * later. The supplier replaces them (they're owed again) or credits them (no longer owed). The
 * supplier can be emailed the return note.
 */
export function ReturnDialog({ api, receipt, onClose, onCreated }: { api: PurchasingApi; receipt: ReceiptState; onClose: () => void; onCreated: (next: SupplierReturnState) => void }) {
  const t = useT();
  const labels = useOrderLabels();
  const [id] = useState(() => crypto.randomUUID());
  const [outcome, setOutcome] = useState<"replace" | "credit">("replace");
  const [rows, setRows] = useState<Row[]>(() => receipt.lines.flatMap((line) => [
    ...(Number(left(line.rejected, line.returnedRejected)) > 0 ? [{ key: `${line.id}:rejected`, line, source: "rejected" as const, left: left(line.rejected, line.returnedRejected),
      quantity: quantityText(left(line.rejected, line.returnedRejected)), kind: line.rejectKind, reason: line.rejectReason }] : []),
    ...(Number(left(line.accepted, line.returnedAccepted)) > 0 ? [{ key: `${line.id}:accepted`, line, source: "accepted" as const, left: left(line.accepted, line.returnedAccepted),
      quantity: "", kind: null, reason: "" }] : []),
  ]));
  const [note, setNote] = useState("");
  const [send, setSend] = useState(false);
  const [to, setTo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.order(receipt.receipt.orderId).then((order) => { if (order.supplier?.email) { setTo(order.supplier.email); setSend(true); } }).catch(() => undefined); }, [api, receipt.receipt.orderId]);
  const chosen = rows.filter((row) => Number(row.quantity) > 0);
  const invalid = useMemo(() => chosen.find((row) => Number(row.quantity) > Number(row.left) || !row.kind || !row.reason.trim()), [chosen]);
  const setRow = (key: string, patch: Partial<Row>) => setRows(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const save = async () => {
    setBusy(true); setError("");
    try {
      onCreated(await api.createReturn({ id, receiptId: receipt.receipt.id, outcome, note: note.trim(), send, to: send ? to.trim() : null,
        lines: chosen.map((row) => ({ receiptLineId: row.line.id, source: row.source, quantity: row.quantity, reasonKind: row.kind, reason: row.reason.trim() })) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(false); }
  };
  return <ControlledModalDialog isOpen size="lg" title={t("Return to supplier")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!chosen.length || Boolean(invalid) || (send && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim()))} onPress={() => void save()}>{t("Raise return")}</Button></div>}>
    <div className={styles.dialogBody}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      <SegmentedControl label={t("The supplier")} value={outcome} onChange={(value) => setOutcome(value as "replace" | "credit")}
        options={[{ id: "replace", label: t("Replaces them") }, { id: "credit", label: t("Credits them") }]} />
      <div className={styles.receiveLines} role="table" aria-label={t("What goes back")} data-columns="3">
        <div role="row" className={styles.receiveHead}><span role="columnheader">{t("Item")}</span><span role="columnheader">{t("Can go back")}</span><span role="columnheader">{t("Goes back")}</span></div>
        {rows.map((row) => <div role="row" key={row.key} className={styles.receiveLine}>
          <span role="cell" className={styles.nameCell}><span>{row.line.description}</span><small>{row.source === "rejected" ? t("Rejected at delivery") : t("Accepted, found wrong later")}</small></span>
          <span role="cell" className={styles.money}>{`${quantityText(row.left)} ${row.line.unit}`.trim()}</span>
          <span role="cell"><TextInput aria-label={t("Goes back of {item}", { item: `${row.line.description} ${row.source === "rejected" ? t("rejected") : t("accepted")}` })} label={null}
            inputMode="decimal" suffix={row.line.unit || undefined} value={row.quantity} onChange={(value) => setRow(row.key, { quantity: numeric(value) })} /></span>
          {Number(row.quantity) > 0 ? <RejectFields description={row.line.description} kind={row.kind} reason={row.reason} labels={labels.rejectKind} onChange={(patch) => setRow(row.key, patch)} /> : null}
        </div>)}
      </div>
      {invalid && Number(invalid.quantity) > Number(invalid.left) ? <InlineNotice tone="error" message={t("At most {quantity} of {item} can go back.", { quantity: `${quantityText(invalid.left)} ${invalid.line.unit}`.trim(), item: invalid.line.description })} /> : null}
      <TextAreaField label={t("Note for the supplier")} value={note} onChange={setNote} />
      <Switch isSelected={send} onChange={setSend}>{t("Email the supplier the return note")}</Switch>
      {send ? <TextInput label={t("Email")} inputType="email" isRequired value={to} onChange={setTo} /> : null}
    </div>
  </ControlledModalDialog>;
}
