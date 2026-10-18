"use client";

import { useState } from "react";
import { parseDate } from "@internationalized/date";
import { DateField, FormDialog, FormRow, MoneyField, NumericInput, QuantityInput, ReasonDialog, ReviewFiles, SelectField, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { WorkOrderState } from "@/lib/factory/types";
import { PhotoPicker } from "../purchasing/delivery-photos";
import { EvidenceField } from "@/components/evidence/evidence-field";
import type { EvidenceFile } from "@/lib/evidence/evidence";
import { quantityText } from "../purchasing/order-labels";

const TYPED = "typed";
/** Quantities and hours stay exact decimal text for the payload; the number field shows and commits them. */
const asNumber = (value: string) => (value === "" ? Number.NaN : Number(value));
const asText = (next: number) => (Number.isFinite(next) ? String(next) : "");
const QUANTITY = { maximumFractionDigits: 4 };
const HOURS = { maximumFractionDigits: 2 };

/** One reason (why it's held, cancelled or closed short): the shared reason dialog. A save that fails throws, so it stays open. */
export function TextDialog({ title, label, action, initial = "", onClose, onSave }: { title: string; label: string; action: string; initial?: string; onClose: () => void; onSave: (value: string) => Promise<void> }) {
  return <ReasonDialog title={title} label={label} confirmLabel={action} defaultValue={initial} onClose={onClose} onConfirm={onSave} />;
}

/**
 * The drawing the work is made to: an approved revision of one of the project's designs (so a newer
 * revision is noticed), or — without one in the system — its number or revision typed in.
 */
export function DrawingDialog({ workspaceId, state, revise = false, onClose, onSave }: {
  workspaceId: string; state: WorkOrderState; revise?: boolean; onClose: () => void; onSave: (input: { versionId?: string; reference?: string; note?: string }) => Promise<void>;
}) {
  const t = useT();
  const designs = state.designs ?? [];
  const [choice, setChoice] = useState<string>(designs[0]?.versionId ?? TYPED);
  const [reference, setReference] = useState(revise ? "" : state.order.drawingRef);
  const [note, setNote] = useState("");
  const typed = choice === TYPED;
  const chosen = designs.find((design) => design.versionId === choice);
  const drawingUrl = (versionId: string, preview = false) => `/api/factory/orders/${state.order.id}/drawings/${versionId}?${new URLSearchParams({ workspaceId, ...(preview ? { preview: "1" } : {}) })}`;
  const valid = (typed ? Boolean(reference.trim()) : true) && (!revise || Boolean(note.trim()));
  return <FormDialog size="md" title={revise ? t("Drawing changed") : t("Drawing approval")} onClose={onClose} isSubmitDisabled={!valid} submitLabel={revise ? t("Put on hold") : t("Save")} onSubmit={async () => { await onSave({ ...(typed ? { reference: reference.trim() } : { versionId: choice }), ...(revise ? { note: note.trim() } : {}) });
      }}>
      {designs.length ? <SelectField label={t("Approved drawing")} selectedKey={choice} onSelectionChange={(key) => setChoice(String(key ?? TYPED))}
        items={[...designs.map((design) => ({ id: design.versionId, label: `${design.title} R${design.number}` })), { id: TYPED, label: t("Another drawing (type it)") }]} /> : null}
      {/* §0.3 P0: the chosen drawing itself, checked before it is recorded as the one the work is made to. */}
      {!typed && chosen ? <ReviewFiles label={t("Drawing")} files={[{ id: chosen.versionId, name: chosen.fileName ?? `${chosen.title} R${chosen.number}`,
        href: drawingUrl(chosen.versionId), previewHref: chosen.hasPreview ? drawingUrl(chosen.versionId, true) : null }]} /> : null}
      {typed ? <TextInput label={revise ? t("New drawing (number or revision)") : t("Approved drawing (number or revision)")} isRequired value={reference} onChange={setReference} /> : null}
      {revise ? <TextAreaField label={t("What changed")} isRequired value={note} onChange={setNote} /> : null}
  </FormDialog>;
}

export function ScheduleDialog({ state, onClose, onSave }: { state: WorkOrderState; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const [workcenterId, setWorkcenterId] = useState(state.order.workcenterId ?? "");
  const [start, setStart] = useState(state.order.plannedStart);
  const [end, setEnd] = useState(state.order.plannedEnd);
  const [notes, setNotes] = useState(state.order.notes);
  const [hours, setHours] = useState(state.order.plannedHours ? quantityText(state.order.plannedHours) : "");
  const valid = !start || !end || end >= start;
  return <FormDialog size="md" title={t("Where and when")} onClose={onClose} isSubmitDisabled={!valid} submitLabel={t("Save")} onSubmit={async () => { await onSave({ workcenterId: workcenterId || null, plannedStart: start, plannedEnd: end, plannedHours: hours || null, notes: notes.trim() });
      }}>
      <SelectField label={t("Workcenter")} placeholder={t("Choose")} selectedKey={workcenterId} onSelectionChange={(key) => setWorkcenterId(key ? String(key) : "")}
        items={state.workcenters.map((center) => ({ id: center.id, label: center.name }))} />
      <FormRow>
        <DateField label={t("Start")} value={start ? parseDate(start) : null} onChange={(value) => setStart(value ? value.toString() : null)} />
        <DateField label={t("Finish")} value={end ? parseDate(end) : null} onChange={(value) => setEnd(value ? value.toString() : null)}
          isInvalid={!valid} errorMessage={valid ? undefined : t("The finish can't be before the start.")} />
      </FormRow>
      <NumericInput label={t("Hours it takes")} suffix={t("h")} minValue={0} formatOptions={HOURS} value={asNumber(hours)} onChange={(next) => setHours(asText(next))} />
      <TextAreaField label={t("Notes")} value={notes} onChange={setNotes} />
  </FormDialog>;
}

/** What was made and scrapped since the last report, and the hours it took; never more good than is still to make. */
export function ReportDialog({ workspaceId, unit, left, onClose, onSave }: { workspaceId: string; unit: string; left: string; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  // §0.3 P0: a photo of what was made goes with the report, so the approver sees it.
  const [files, setFiles] = useState<EvidenceFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [good, setGood] = useState("");
  const [scrap, setScrap] = useState("");
  const [hours, setHours] = useState("");
  const [scrapReason, setScrapReason] = useState("");
  const [note, setNote] = useState("");
  const over = Number(good) > Number(left);
  // Hours are optional: more than none, at most 1,000 on one report, to the hundredth.
  const badHours = Boolean(hours) && (!/^\d{1,4}(\.\d{1,2})?$/.test(hours) || Number(hours) <= 0 || Number(hours) > 1000);
  const valid = Number(good || 0) + Number(scrap || 0) > 0 && !over && !badHours && (!Number(scrap) || scrapReason.trim()) && !uploading && (!Number(good) || files.length > 0);
  return <FormDialog size="md" title={t("Report output")} onClose={onClose} isSubmitDisabled={!valid} submitLabel={t("Report output")} onSubmit={async () => { await onSave({ good: good || "0", scrap: scrap || "0", scrapReason: scrapReason.trim(), note: note.trim(), evidenceFileIds: files.map((file) => file.id), ...(hours ? { hours } : {}) });
      }}>
      <QuantityInput label={t("Made")} unit={unit} minValue={0} formatOptions={QUANTITY} value={asNumber(good)} onChange={(next) => setGood(asText(next))}
        isInvalid={over} errorMessage={over ? t("Only {quantity} is still to make.", { quantity: `${quantityText(left)} ${unit}`.trim() }) : undefined} />
      <QuantityInput label={t("Scrapped")} unit={unit} minValue={0} formatOptions={QUANTITY} value={asNumber(scrap)} onChange={(next) => setScrap(asText(next))} />
      {Number(scrap) ? <TextInput label={t("Why it was scrapped")} isRequired value={scrapReason} onChange={setScrapReason} /> : null}
      <NumericInput label={t("Hours worked")} suffix={t("h")} minValue={0} formatOptions={HOURS} value={asNumber(hours)} onChange={(next) => setHours(asText(next))}
        isInvalid={badHours} errorMessage={badHours ? t("More than 0 and at most 1000, with up to 2 decimals.") : undefined} />
      <EvidenceField workspaceId={workspaceId} kind="factory_output" isRequired={Boolean(Number(good))} label={t("Photo of what was made")} value={files} onChange={setFiles} onBusy={setUploading} />
      <TextAreaField label={t("Note")} value={note} onChange={setNote} />
  </FormDialog>;
}

/**
 * A quality check of approved output: what passed goes into stock; what failed says why and is made again.
 * A note and one photo go with it.
 */
export function CheckDialog({ unit, waiting, onClose, onSave }: { unit: string; waiting: string; onClose: () => void; onSave: (input: Record<string, unknown>, photo: File | null) => Promise<void> }) {
  const t = useT();
  const [passed, setPassed] = useState(quantityText(waiting));
  const [failed, setFailed] = useState("");
  const [failReason, setFailReason] = useState("");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const over = Number(passed || 0) + Number(failed || 0) > Number(waiting);
  const valid = Number(passed || 0) + Number(failed || 0) > 0 && !over && (!Number(failed) || failReason.trim());
  return <FormDialog size="md" title={t("Check quality")} description={t("{quantity} waiting to be checked.", { quantity: `${quantityText(waiting)} ${unit}`.trim() })} onClose={onClose} isSubmitDisabled={!valid} submitLabel={t("Save")} onSubmit={async () => { await onSave({ passed: passed || "0", failed: failed || "0", failReason: failReason.trim(), note: note.trim() }, photos[0] ?? null);
      }}>
      <QuantityInput label={t("Passed")} unit={unit} minValue={0} formatOptions={QUANTITY} value={asNumber(passed)} onChange={(next) => setPassed(asText(next))} isInvalid={over}
        errorMessage={over ? t("Only {quantity} is waiting.", { quantity: `${quantityText(waiting)} ${unit}`.trim() }) : undefined} />
      <QuantityInput label={t("Failed")} unit={unit} minValue={0} formatOptions={QUANTITY} value={asNumber(failed)} onChange={(next) => setFailed(asText(next))} />
      {Number(failed) ? <TextInput label={t("Why it failed")} isRequired value={failReason} onChange={setFailReason} /> : null}
      <TextAreaField label={t("Note")} value={note} onChange={setNote} />
      <PhotoPicker files={photos} label={photos.length ? t("Change photo") : t("Add a photo")} onChange={(files) => setPhotos(files.slice(-1))} />
  </FormDialog>;
}

/** How many the work order makes: never below what's made or waiting, never past its line. */
export function QuantityDialog({ unit, current, floor, onClose, onSave }: { unit: string; current: string; floor: string; onClose: () => void; onSave: (quantity: string) => Promise<void> }) {
  const t = useT();
  const [quantity, setQuantity] = useState(quantityText(current));
  const under = Number(quantity) < Number(floor);
  return <FormDialog size="md" title={t("Change quantity")} onClose={onClose} isSubmitDisabled={!(Number(quantity) > 0) || under} submitLabel={t("Save")} onSubmit={async () => { await onSave(quantity); }}>
    <QuantityInput label={t("Quantity")} isRequired unit={unit} minValue={0} formatOptions={QUANTITY} value={asNumber(quantity)} onChange={(next) => setQuantity(asText(next))}
      isInvalid={under} errorMessage={under ? t("{quantity} is already made or waiting.", { quantity: `${quantityText(floor)} ${unit}`.trim() }) : undefined} />
  </FormDialog>;
}

/** A step a supplier does on the work order's goods: a draft service order the buyer places; checks wait until the goods are back. */
export function SendOutDialog({ state, onClose, onSave }: { state: WorkOrderState; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const [name, setName] = useState("");
  const [vendorId, setVendorId] = useState(state.suppliers.find((supplier) => supplier.approved)?.id ?? "");
  const [quantity, setQuantity] = useState(quantityText(state.order.quantity));
  const [price, setPrice] = useState("");
  const [back, setBack] = useState<string | null>(null);
  const over = Number(quantity) > Number(state.order.quantity);
  return <FormDialog size="md" title={t("Send a step out")} onClose={onClose} isSubmitDisabled={!name.trim() || !vendorId || !(Number(quantity) > 0) || over} submitLabel={t("Create service order")} onSubmit={async () => { await onSave({ name: name.trim(), vendorId, quantity, unitPrice: price || "0", expectedDate: back });
      }}>
      <TextInput label={t("What the supplier does")} isRequired value={name} onChange={setName} />
      <SelectField label={t("Supplier")} placeholder={t("Choose")} selectedKey={vendorId} onSelectionChange={(key) => setVendorId(key ? String(key) : "")}
        items={state.suppliers.map((supplier) => ({ id: supplier.id, label: supplier.approved ? supplier.name : t("{name} (not approved)", { name: supplier.name }) }))} />
      <QuantityInput label={t("Quantity")} isRequired unit={state.order.unit} minValue={0} formatOptions={QUANTITY} value={asNumber(quantity)} onChange={(next) => setQuantity(asText(next))}
        isInvalid={over} errorMessage={over ? t("Up to {quantity}.", { quantity: `${quantityText(state.order.quantity)} ${state.order.unit}`.trim() }) : undefined} />
      <MoneyField label={t("Price each")} value={price} onChange={setPrice} />
      <DateField label={t("Back by")} value={back ? parseDate(back) : null} onChange={(value) => setBack(value ? value.toString() : null)} />
  </FormDialog>;
}

/** Made goods from the factory to the project's site: a move the site receives (and can refuse, sending them back to be made again). */
export function DispatchDialog({ unit, available, onClose, onSave }: { unit: string; available: string; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const [quantity, setQuantity] = useState(quantityText(available));
  const [note, setNote] = useState("");
  const over = Number(quantity) > Number(available);
  return <FormDialog size="md" title={t("Send to site")} onClose={onClose} isSubmitDisabled={!(Number(quantity) > 0) || over} submitLabel={t("Send to site")} onSubmit={async () => { await onSave({ quantity, note: note.trim() }); }}>
      <QuantityInput label={t("Quantity")} isRequired unit={unit} minValue={0} formatOptions={QUANTITY} value={asNumber(quantity)} onChange={(next) => setQuantity(asText(next))}
        isInvalid={over} errorMessage={over ? t("Only {quantity} at the factory.", { quantity: `${quantityText(available)} ${unit}`.trim() }) : undefined} />
      <TextInput label={t("Note")} value={note} onChange={setNote} />
  </FormDialog>;
}
