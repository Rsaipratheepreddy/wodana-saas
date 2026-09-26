"use client";

import { useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Button, ControlledModalDialog, DateField, InlineNotice, SelectField, Skeleton, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PurchasingApi } from "@/lib/purchasing/client";
import type { Place, ReceiptState, ReceivingForm, RejectKind } from "@/lib/purchasing/types";
import { useProjectFormat } from "../project-core/format";
import { quantityText, useOrderLabels } from "./order-labels";
import styles from "./purchasing.module.css";

type LineInput = { received: string; noted: string; rejected: string; kind: RejectKind | null; reason: string };
const numeric = (value: string) => value.replace(/[^\d.]/g, "");

/** A place as people name it: its own name, or the kind for one made on first use. */
export function usePlaceLabel() {
  const t = useT();
  return (place: Pick<Place, "kind" | "name" | "projectReference">) => place.name
    ?? (place.kind === "site" ? t("{reference} site", { reference: place.projectReference ?? "" }) : place.kind === "warehouse" ? t("Warehouse") : place.kind === "factory" ? t("Factory") : t("Other"));
}

/**
 * Receives a delivery against one order: where it arrived, when, the delivery note, and how much of each
 * line came. When the firm inspects deliveries everything waits for someone else to check it; otherwise
 * anything rejected is entered here with its reason.
 */
export function ReceiveDialog({ api, orderId, onClose, onReceived }: { api: PurchasingApi; orderId: string; onClose: () => void; onReceived: (state: ReceiptState) => void }) {
  const t = useT();
  const format = useProjectFormat();
  const placeLabel = usePlaceLabel();
  const labels = useOrderLabels();
  const [id] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState<ReceivingForm | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [receivedOn, setReceivedOn] = useState(format.today());
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Record<string, LineInput>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.receiving(orderId).then((next) => { setForm(next); setPlace(next.defaultPlace); }).catch((cause: Error) => setError(cause.message));
  }, [api, orderId]);
  const open = useMemo(() => (form?.lines ?? []).filter((line) => Number(line.receivable) > 0), [form]);
  const line = (lineId: string) => lines[lineId] ?? { received: "", noted: "", rejected: "", kind: null, reason: "" };
  const setLine = (lineId: string, patch: Partial<LineInput>) => setLines({ ...lines, [lineId]: { ...line(lineId), ...patch } });
  const entered = open.filter((item) => Number(line(item.id).received) > 0);
  const tooMuch = open.find((item) => Number(line(item.id).received) > Number(item.receivable));
  const unexplained = form && !form.requireInspection ? open.find((item) => Number(line(item.id).rejected) > 0 && (!line(item.id).reason.trim() || !line(item.id).kind)) : undefined;
  const overRejected = form && !form.requireInspection ? open.find((item) => Number(line(item.id).rejected) > Number(line(item.id).received || 0)) : undefined;
  const save = async () => {
    if (!form || !place) return;
    setBusy(true); setError("");
    try {
      onReceived(await api.receive({ id, orderId, place, receivedOn, deliveryNote: note.trim(), lines: entered.map((item) => ({ orderLineId: item.id, received: line(item.id).received,
        noted: line(item.id).noted || null,
        ...(form.requireInspection ? {} : { rejected: line(item.id).rejected || "0", rejectKind: line(item.id).kind, rejectReason: line(item.id).reason.trim() }) })) }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(false); }
  };
  return <ControlledModalDialog isOpen size="lg" title={form ? t("Receive {order}", { order: form.order.number }) : t("Receive")} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={<div className="wd-dialog-actions">
      {form && open.length ? <Button variant="quiet" onPress={() => setLines(Object.fromEntries(open.map((item) => [item.id, { ...line(item.id), received: quantityText(item.outstanding) }])))}>{t("Everything left")}</Button> : null}
      <span className={styles.spacer} />
      <Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!place || !entered.length || Boolean(tooMuch || unexplained || overRejected)} onPress={() => void save()}>{t("Receive")}</Button></div>}>
    {!form && !error ? <Skeleton lines={5} /> : <div className={styles.dialogBody}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {form ? <>
        <div className={styles.pair}>
          <SelectField label={t("Arrived at")} isRequired selectedKey={place} onSelectionChange={(key) => setPlace(key === null ? null : String(key))}
            items={form.places.map((item) => ({ id: item.key, label: placeLabel(item) }))} />
          <DateField label={t("Received on")} isRequired value={parseDate(receivedOn)} onChange={(value) => value && setReceivedOn(value.toString())} />
        </div>
        <TextInput label={t("Delivery note")} value={note} onChange={setNote} />
        {!open.length ? <InlineNotice tone="info" message={t("Everything on this order has arrived.")} /> : <div className={styles.receiveLines} role="table" aria-label={t("What arrived")}
          data-columns={form.requireInspection ? "4" : "5"}>
          <div role="row" className={styles.receiveHead}><span role="columnheader">{t("Item")}</span><span role="columnheader">{t("Left")}</span>
            <span role="columnheader">{t("On the note")}</span><span role="columnheader">{t("Received")}</span>{form.requireInspection ? null : <span role="columnheader">{t("Rejected")}</span>}</div>
          {open.map((item) => {
            const value = line(item.id);
            return <div role="row" key={item.id} className={styles.receiveLine}>
              <span role="cell" className={styles.nameCell}><span>{item.description}</span><small>{[item.projectReference, item.specification].filter(Boolean).join(" · ")}</small>
                {Number(value.noted) > Number(value.received || 0) && value.received !== "" ? <small className={styles.lateText}>
                  {t("{quantity} missing against the note", { quantity: `${quantityText(String(Number(value.noted) - Number(value.received)))} ${item.unit}`.trim() })}</small> : null}</span>
              <span role="cell" className={styles.money}>{`${quantityText(item.outstanding)} ${item.unit}`.trim()}</span>
              <span role="cell"><TextInput aria-label={t("On the note of {item}", { item: item.description })} label={null} inputMode="decimal" value={value.noted}
                onChange={(noted) => setLine(item.id, { noted: numeric(noted) })} /></span>
              <span role="cell"><TextInput aria-label={t("Received of {item}", { item: item.description })} label={null} inputMode="decimal" suffix={item.unit || undefined} value={value.received}
                onChange={(received) => setLine(item.id, { received: numeric(received) })} /></span>
              {form.requireInspection ? null : <span role="cell"><TextInput aria-label={t("Rejected of {item}", { item: item.description })} label={null} inputMode="decimal" value={value.rejected}
                onChange={(rejected) => setLine(item.id, { rejected: numeric(rejected) })} /></span>}
              {!form.requireInspection && Number(value.rejected) > 0 ? <RejectFields description={item.description} kind={value.kind} reason={value.reason}
                onChange={(patch) => setLine(item.id, patch)} labels={labels.rejectKind} /> : null}
            </div>;
          })}
        </div>}
        {tooMuch ? <InlineNotice tone="error" message={t("At most {quantity} of {item} can arrive.", { quantity: `${quantityText(tooMuch.receivable)} ${tooMuch.unit}`.trim(), item: tooMuch.description })} /> : null}
        {overRejected ? <InlineNotice tone="error" message={t("More of {item} is rejected than arrived.", { item: overRejected.description })} /> : null}
      </> : null}
    </div>}
  </ControlledModalDialog>;
}

/** What was wrong with rejected goods (damaged, defective, the wrong item, not to spec) and a note. */
export function RejectFields({ description, kind, reason, labels, onChange }: {
  description: string; kind: RejectKind | null; reason: string; labels: Record<RejectKind, string>; onChange: (patch: { kind?: RejectKind | null; reason?: string }) => void;
}) {
  const t = useT();
  return <span className={styles.receiveReason}><span className={styles.pair}>
    <SelectField label={t("What was wrong with {item}", { item: description })} isRequired selectedKey={kind} placeholder={t("Choose")}
      onSelectionChange={(key) => onChange({ kind: key === null ? null : key as RejectKind })} items={(Object.keys(labels) as RejectKind[]).map((id) => ({ id, label: labels[id] }))} />
    <TextInput label={t("Why it was rejected")} isRequired value={reason} onChange={(value) => onChange({ reason: value })} />
  </span></span>;
}
