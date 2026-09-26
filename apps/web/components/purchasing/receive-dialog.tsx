"use client";

import { useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Button, ControlledModalDialog, DateField, InlineNotice, SelectField, Skeleton, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PurchasingApi } from "@/lib/purchasing/client";
import type { Place, ReceiptState, ReceivingForm } from "@/lib/purchasing/types";
import { useProjectFormat } from "../project-core/format";
import { quantityText } from "./order-labels";
import styles from "./purchasing.module.css";

type LineInput = { received: string; rejected: string; reason: string };
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
  const line = (lineId: string) => lines[lineId] ?? { received: "", rejected: "", reason: "" };
  const setLine = (lineId: string, patch: Partial<LineInput>) => setLines({ ...lines, [lineId]: { ...line(lineId), ...patch } });
  const entered = open.filter((item) => Number(line(item.id).received) > 0);
  const tooMuch = open.find((item) => Number(line(item.id).received) > Number(item.receivable));
  const unexplained = form && !form.requireInspection ? open.find((item) => Number(line(item.id).rejected) > 0 && !line(item.id).reason.trim()) : undefined;
  const overRejected = form && !form.requireInspection ? open.find((item) => Number(line(item.id).rejected) > Number(line(item.id).received || 0)) : undefined;
  const save = async () => {
    if (!form || !place) return;
    setBusy(true); setError("");
    try {
      onReceived(await api.receive({ id, orderId, place, receivedOn, deliveryNote: note.trim(), lines: entered.map((item) => ({ orderLineId: item.id, received: line(item.id).received,
        ...(form.requireInspection ? {} : { rejected: line(item.id).rejected || "0", rejectReason: line(item.id).reason.trim() }) })) }));
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
          data-inspection={form.requireInspection ? "true" : undefined}>
          <div role="row" className={styles.receiveHead}><span role="columnheader">{t("Item")}</span><span role="columnheader">{t("Left")}</span>
            <span role="columnheader">{t("Received")}</span>{form.requireInspection ? null : <span role="columnheader">{t("Rejected")}</span>}</div>
          {open.map((item) => {
            const value = line(item.id);
            return <div role="row" key={item.id} className={styles.receiveLine}>
              <span role="cell" className={styles.nameCell}><span>{item.description}</span><small>{[item.projectReference, item.specification].filter(Boolean).join(" · ")}</small></span>
              <span role="cell" className={styles.money}>{`${quantityText(item.outstanding)} ${item.unit}`.trim()}</span>
              <span role="cell"><TextInput aria-label={t("Received of {item}", { item: item.description })} label={null} inputMode="decimal" suffix={item.unit || undefined} value={value.received}
                onChange={(received) => setLine(item.id, { received: numeric(received) })} /></span>
              {form.requireInspection ? null : <span role="cell"><TextInput aria-label={t("Rejected of {item}", { item: item.description })} label={null} inputMode="decimal" value={value.rejected}
                onChange={(rejected) => setLine(item.id, { rejected: numeric(rejected) })} /></span>}
              {!form.requireInspection && Number(value.rejected) > 0 ? <span className={styles.receiveReason}><TextInput label={t("Why it was rejected")} isRequired value={value.reason}
                onChange={(reason) => setLine(item.id, { reason })} /></span> : null}
            </div>;
          })}
        </div>}
        {tooMuch ? <InlineNotice tone="error" message={t("At most {quantity} of {item} can arrive.", { quantity: `${quantityText(tooMuch.receivable)} ${tooMuch.unit}`.trim(), item: tooMuch.description })} /> : null}
        {overRejected ? <InlineNotice tone="error" message={t("More of {item} is rejected than arrived.", { item: overRejected.description })} /> : null}
      </> : null}
    </div>}
  </ControlledModalDialog>;
}
