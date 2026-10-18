"use client";

import { useEffect, useMemo, useState } from "react";
import { DataGrid, EmailInput, FormDialog, InlineNotice, QuantityInput, SegmentedControl, Switch, TextAreaField, VisuallyHidden, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { subtractExact } from "@/lib/purchasing/amounts";
import type { PurchasingApi } from "@/lib/purchasing/client";
import type { ReceiptLine, ReceiptState, RejectKind, SupplierReturnState } from "@/lib/purchasing/types";
import { fieldNumber, fieldText, quantityText, useOrderLabels } from "./order-labels";
import { RejectFields } from "./receive-dialog";
import styles from "./purchasing.module.css";

type Row = { key: string; line: ReceiptLine; source: "rejected" | "accepted"; left: string; quantity: string; kind: RejectKind | null; reason: string };
const left = (a: string, b: string) => subtractExact(a, b);

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
  useEffect(() => { api.order(receipt.receipt.orderId).then((order) => { if (order.supplier?.email) { setTo(order.supplier.email); setSend(true); } }).catch(() => undefined); }, [api, receipt.receipt.orderId]);
  const chosen = rows.filter((row) => Number(row.quantity) > 0);
  const invalid = useMemo(() => chosen.find((row) => Number(row.quantity) > Number(row.left) || !row.kind || !row.reason.trim()), [chosen]);
  const setRow = (key: string, patch: Partial<Row>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const columns: DataGridColumn<Row>[] = [
    { id: "item", header: t("Item"), size: 240, accessorFn: (row) => row.line.description, meta: { renderCell: (row) => <span className={styles.nameCell}><span>{row.line.description}</span>
      <small>{row.source === "rejected" ? t("Rejected at delivery") : t("Accepted, found wrong later")}</small></span> } },
    { id: "left", header: t("Can go back"), size: 130, accessorFn: (row) => Number(row.left), meta: { align: "end", renderCell: (row) => <span className={styles.money}>{`${quantityText(row.left)} ${row.line.unit}`.trim()}</span> } },
    { id: "quantity", header: t("Goes back"), size: 150, accessorFn: (row) => row.quantity, meta: { align: "end", renderCell: (row) =>
      <QuantityInput label={<VisuallyHidden>{t("Goes back of {item}", { item: `${row.line.description} ${row.source === "rejected" ? t("rejected") : t("accepted")}` })}</VisuallyHidden>}
        unit={row.line.unit} minValue={0} formatOptions={{ maximumFractionDigits: 4 }} value={fieldNumber(row.quantity)} onChange={(value) => setRow(row.key, { quantity: fieldText(value) })} /> } },
  ];
  const save = async () => {
    onCreated(await api.createReturn({ id, receiptId: receipt.receipt.id, outcome, note: note.trim(), send, to: send ? to.trim() : null,
      lines: chosen.map((row) => ({ receiptLineId: row.line.id, source: row.source, quantity: row.quantity, reasonKind: row.kind, reason: row.reason.trim() })) }));
  };
  return <FormDialog size="lg" title={t("Return to supplier")} onClose={onClose} isDirty={Boolean(chosen.length || note.trim())} submitLabel={t("Raise return")}
    isSubmitDisabled={!chosen.length || Boolean(invalid) || (send && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim()))} onSubmit={save}>
      <SegmentedControl label={t("The supplier")} value={outcome} onChange={(value) => setOutcome(value as "replace" | "credit")}
        options={[{ id: "replace", label: t("Replaces them") }, { id: "credit", label: t("Credits them") }]} />
      <DataGrid ariaLabel={t("What goes back")} data={rows} getRowId={(row) => row.key} columns={columns}
        showToolbar={false} showFooter={false} selectable={false} rowNumbers={false} pinFirstColumn={false} wrapText />
      {/* Why each line goes back, under the table, named by its item. */}
      {chosen.map((row) => <RejectFields key={row.key} description={row.line.description} kind={row.kind} reason={row.reason} labels={labels.rejectKind} onChange={(patch) => setRow(row.key, patch)} />)}
      {invalid && Number(invalid.quantity) > Number(invalid.left) ? <InlineNotice tone="error" message={t("At most {quantity} of {item} can go back.", { quantity: `${quantityText(invalid.left)} ${invalid.line.unit}`.trim(), item: invalid.line.description })} /> : null}
      <TextAreaField label={t("Note for the supplier")} value={note} onChange={setNote} />
      <Switch isSelected={send} onChange={setSend}>{t("Email the supplier the return note")}</Switch>
      {send ? <EmailInput label={t("Email")} isRequired maxLength={254} value={to} onChange={setTo} /> : null}
  </FormDialog>;
}
