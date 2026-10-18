"use client";

import { useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Button, DataGrid, DateField, FormDialog, FormSection, InlineNotice, NumericInput, QuantityInput, SelectField, Skeleton, TextInput, VisuallyHidden, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { subtractExact } from "@/lib/purchasing/amounts";
import type { PurchasingApi } from "@/lib/purchasing/client";
import type { Place, ReceiptState, ReceivingForm, RejectKind } from "@/lib/purchasing/types";
import { useProjectFormat } from "../project-core/format";
import { PhotoPicker } from "./delivery-photos";
import { fieldNumber, fieldText, quantityText, useOrderLabels } from "./order-labels";
import styles from "./purchasing.module.css";

type LineInput = { received: string; noted: string; rejected: string; kind: RejectKind | null; reason: string };
type OpenLine = ReceivingForm["lines"][number];

/** A place as people name it: its own name, or the kind for one made on first use. */
export function usePlaceLabel() {
  const t = useT();
  // A site not made yet reads like the phone's: "Site · <project name>", or by its reference when the name is missing.
  return (place: Pick<Place, "kind" | "name" | "projectReference" | "projectName">) => place.name
    ?? (place.kind === "site" ? (place.projectName ? t("Site · {name}", { name: place.projectName }) : t("{reference} site", { reference: place.projectReference ?? "" }))
      : place.kind === "warehouse" ? t("Warehouse") : place.kind === "factory" ? t("Factory") : t("Other"));
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
  const [handedOverBy, setHandedOverBy] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const photoIds = useMemo(() => photos.map(() => crypto.randomUUID()), [photos]);
  const [lines, setLines] = useState<Record<string, LineInput>>({});
  const [error, setError] = useState("");
  useEffect(() => {
    api.receiving(orderId).then((next) => {
      setForm(next); setPlace(next.defaultPlace);
      // Most deliveries bring everything that's left: it's filled in, and whoever receives only changes what didn't come.
      setLines(Object.fromEntries(next.lines.filter((item) => Number(item.receivable) > 0)
        .map((item) => [item.id, { received: quantityText(item.outstanding), noted: "", rejected: "", kind: null, reason: "" }])));
    }).catch((cause: Error) => setError(cause.message));
  }, [api, orderId]);
  const open = useMemo(() => (form?.lines ?? []).filter((line) => Number(line.receivable) > 0), [form]);
  const line = (lineId: string) => lines[lineId] ?? { received: "", noted: "", rejected: "", kind: null, reason: "" };
  const setLine = (lineId: string, patch: Partial<LineInput>) => setLines((current) => ({ ...current, [lineId]: { ...(current[lineId] ?? { received: "", noted: "", rejected: "", kind: null, reason: "" }), ...patch } }));
  const entered = open.filter((item) => Number(line(item.id).received) > 0);
  const tooMuch = open.find((item) => Number(line(item.id).received) > Number(item.receivable));
  const unexplained = form && !form.requireInspection ? open.find((item) => Number(line(item.id).rejected) > 0 && (!line(item.id).reason.trim() || !line(item.id).kind)) : undefined;
  const overRejected = form && !form.requireInspection ? open.find((item) => Number(line(item.id).rejected) > Number(line(item.id).received || 0)) : undefined;
  const atSite = form?.places.find((item) => item.key === place)?.kind === "site";
  const photoNeeded = Boolean(form?.requireSitePhoto && atSite && !photos.length);
  const hidden = (text: string) => <VisuallyHidden>{text}</VisuallyHidden>;
  const amountField = (label: string, value: string, onChange: (value: string) => void) => <NumericInput label={hidden(label)} minValue={0} formatOptions={{ maximumFractionDigits: 4 }}
    value={fieldNumber(value)} onChange={(next) => onChange(fieldText(next))} />;
  const columns: DataGridColumn<OpenLine>[] = [
    { id: "item", header: t("Item"), size: 220, accessorFn: (item) => item.description, meta: { renderCell: (item) => {
      const value = line(item.id);
      return <span className={styles.nameCell}><span>{item.description}</span><small>{[item.projectReference, item.specification].filter(Boolean).join(" · ")}</small>
        {Number(value.noted) > Number(value.received || 0) && value.received !== "" ? <small className={styles.lateText}>
          {t("{quantity} missing against the note", { quantity: `${subtractExact(value.noted, value.received)} ${item.unit}`.trim() })}</small> : null}</span>;
    } } },
    { id: "left", header: t("Left"), size: 110, accessorFn: (item) => Number(item.outstanding), meta: { align: "end", renderCell: (item) => <span className={styles.money}>{`${quantityText(item.outstanding)} ${item.unit}`.trim()}</span> } },
    { id: "noted", header: t("On the note"), size: 130, accessorFn: (item) => line(item.id).noted, meta: { align: "end", renderCell: (item) =>
      amountField(t("On the note of {item}", { item: item.description }), line(item.id).noted, (noted) => setLine(item.id, { noted })) } },
    { id: "received", header: t("Received"), size: 150, accessorFn: (item) => line(item.id).received, meta: { align: "end", renderCell: (item) =>
      <QuantityInput label={hidden(t("Received of {item}", { item: item.description }))} unit={item.unit} minValue={0} formatOptions={{ maximumFractionDigits: 4 }}
        value={fieldNumber(line(item.id).received)} onChange={(next) => setLine(item.id, { received: fieldText(next) })} /> } },
    ...(form?.requireInspection ? [] : [{ id: "rejected", header: t("Rejected"), size: 130, accessorFn: (item: OpenLine) => line(item.id).rejected, meta: { align: "end" as const, renderCell: (item: OpenLine) =>
      amountField(t("Rejected of {item}", { item: item.description }), line(item.id).rejected, (rejected) => setLine(item.id, { rejected })) } }]),
  ];
  const save = async () => {
    if (!form || !place) return;
    setError("");
    {
      let saved = await api.receive({ id, orderId, place, receivedOn, deliveryNote: note.trim(), handedOverBy: handedOverBy.trim(), lines: entered.map((item) => ({ orderLineId: item.id, received: line(item.id).received,
        noted: line(item.id).noted || null,
        ...(form.requireInspection ? {} : { rejected: line(item.id).rejected || "0", rejectKind: line(item.id).kind, rejectReason: line(item.id).reason.trim() }) })) });
      // The delivery is saved; its photos follow (each once, by its own id).
      for (const [index, file] of photos.entries()) saved = await api.uploadPhoto({ kind: "receipt", id: saved.receipt.id }, photoIds[index], file);
      onReceived(saved);
    }
  };
  return <FormDialog size="lg" title={form ? t("Receive {order}", { order: form.order.number }) : t("Receive")} onClose={onClose} error={error || undefined}
    isDirty={Boolean(entered.length || note.trim() || photos.length)} submitLabel={t("Receive")}
    isSubmitDisabled={!place || !entered.length || Boolean(tooMuch || unexplained || overRejected) || photoNeeded} onSubmit={save}
    secondaryAction={form && open.length ? <>
      <Button variant="quiet" onPress={() => setLines(Object.fromEntries(open.map((item) => [item.id, { ...line(item.id), received: quantityText(item.outstanding) }])))}>{t("Everything left")}</Button>
      <Button variant="quiet" onPress={() => setLines(Object.fromEntries(open.map((item) => [item.id, { ...line(item.id), received: "" }])))}>{t("Clear")}</Button>
    </> : undefined}>
    {!form && !error ? <Skeleton lines={5} /> : <>
      {form ? <>
        <FormSection title={t("Delivery")}>
          <SelectField label={t("Arrived at")} isRequired selectedKey={place} onSelectionChange={(key) => setPlace(key === null ? null : String(key))}
            items={form.places.map((item) => ({ id: item.key, label: placeLabel(item) }))} />
          <DateField label={t("Received on")} isRequired value={parseDate(receivedOn)} onChange={(value) => value && setReceivedOn(value.toString())} />
          <TextInput label={t("Delivery note")} maxLength={120} value={note} onChange={setNote} />
          <TextInput label={t("Handed over by")} maxLength={160} value={handedOverBy} onChange={setHandedOverBy} />
        </FormSection>
        <FormSection title={t("What arrived")}>
          {!open.length ? <InlineNotice tone="info" message={t("Everything on this order has arrived.")} /> : <DataGrid ariaLabel={t("What arrived")} data={open} getRowId={(item) => item.id}
            columns={columns} showToolbar={false} showFooter={false} selectable={false} rowNumbers={false} pinFirstColumn={false} wrapText />}
          {/* What was wrong with each rejected line, under the table, named by its item. */}
          {!form.requireInspection ? open.filter((item) => Number(line(item.id).rejected) > 0).map((item) => <RejectFields key={item.id} description={item.description}
            kind={line(item.id).kind} reason={line(item.id).reason} onChange={(patch) => setLine(item.id, patch)} labels={labels.rejectKind} />) : null}
          {tooMuch ? <InlineNotice tone="error" message={t("At most {quantity} of {item} can arrive.", { quantity: `${quantityText(tooMuch.receivable)} ${tooMuch.unit}`.trim(), item: tooMuch.description })} /> : null}
          {overRejected ? <InlineNotice tone="error" message={t("More of {item} is rejected than arrived.", { item: overRejected.description })} /> : null}
          {/* Receive stays off until the site photo is added: say so, or the button looks broken. */}
          {photoNeeded ? <InlineNotice tone="info" message={t("A photo is needed for deliveries to site.")} /> : null}
        </FormSection>
        <FormSection title={t("Photos")}>
          <PhotoPicker files={photos} onChange={setPhotos} label={atSite && form.requireSitePhoto ? t("Add a photo of the delivery") : undefined} />
        </FormSection>
      </> : null}
    </>}
  </FormDialog>;
}

/** What was wrong with rejected goods (damaged, defective, the wrong item, not to spec) and a note. */
export function RejectFields({ description, kind, reason, labels, onChange }: {
  description: string; kind: RejectKind | null; reason: string; labels: Record<RejectKind, string>; onChange: (patch: { kind?: RejectKind | null; reason?: string }) => void;
}) {
  const t = useT();
  return <div className={styles.stack}>
    <SelectField label={t("What was wrong with {item}", { item: description })} isRequired selectedKey={kind} placeholder={t("Choose")}
      onSelectionChange={(key) => onChange({ kind: key === null ? null : key as RejectKind })} items={(Object.keys(labels) as RejectKind[]).map((id) => ({ id, label: labels[id] }))} />
    <TextInput label={t("Why it was rejected")} isRequired value={reason} onChange={(value) => onChange({ reason: value })} />
  </div>;
}
