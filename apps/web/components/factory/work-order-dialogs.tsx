"use client";

import { useState } from "react";
import { parseDate } from "@internationalized/date";
import { Button, ControlledModalDialog, DateField, SelectField, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { WorkOrderState } from "@/lib/factory/types";
import { quantityText } from "../purchasing/order-labels";
import styles from "./factory.module.css";

const numeric = (value: string) => value.replace(/[^\d.]/g, "");
const TYPED = "typed";

export function TextDialog({ title, label, action, initial = "", onClose, onSave }: { title: string; label: string; action: string; initial?: string; onClose: () => void; onSave: (value: string) => Promise<void> }) {
  const t = useT();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={title} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Back")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!value.trim()} onPress={async () => { setBusy(true); await onSave(value.trim()); setBusy(false); }}>{action}</Button></div>}>
    <TextAreaField label={label} isRequired value={value} onChange={setValue} />
  </ControlledModalDialog>;
}

/**
 * The drawing the work is made to: an approved revision of one of the project's designs (so a newer
 * revision is noticed), or — without one in the system — its number or revision typed in.
 */
export function DrawingDialog({ state, revise = false, onClose, onSave }: {
  state: WorkOrderState; revise?: boolean; onClose: () => void; onSave: (input: { versionId?: string; reference?: string; note?: string }) => Promise<void>;
}) {
  const t = useT();
  const designs = state.designs ?? [];
  const [choice, setChoice] = useState<string>(designs[0]?.versionId ?? TYPED);
  const [reference, setReference] = useState(revise ? "" : state.order.drawingRef);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const typed = choice === TYPED;
  const valid = (typed ? Boolean(reference.trim()) : true) && (!revise || Boolean(note.trim()));
  return <ControlledModalDialog isOpen size="md" title={revise ? t("Drawing changed") : t("Drawing approval")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={async () => {
        setBusy(true); await onSave({ ...(typed ? { reference: reference.trim() } : { versionId: choice }), ...(revise ? { note: note.trim() } : {}) }); setBusy(false);
      }}>{revise ? t("Put on hold") : t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      {designs.length ? <SelectField label={t("Approved drawing")} selectedKey={choice} onSelectionChange={(key) => setChoice(String(key ?? TYPED))}
        items={[...designs.map((design) => ({ id: design.versionId, label: `${design.title} R${design.number}` })), { id: TYPED, label: t("Another drawing (type it)") }]} /> : null}
      {typed ? <TextInput label={revise ? t("New drawing (number or revision)") : t("Approved drawing (number or revision)")} isRequired value={reference} onChange={setReference} /> : null}
      {revise ? <TextAreaField label={t("What changed")} isRequired value={note} onChange={setNote} /> : null}
    </div>
  </ControlledModalDialog>;
}

export function ScheduleDialog({ state, onClose, onSave }: { state: WorkOrderState; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const [workcenterId, setWorkcenterId] = useState(state.order.workcenterId ?? "");
  const [start, setStart] = useState(state.order.plannedStart);
  const [end, setEnd] = useState(state.order.plannedEnd);
  const [notes, setNotes] = useState(state.order.notes);
  const [hours, setHours] = useState(state.order.plannedHours ? quantityText(state.order.plannedHours) : "");
  const [busy, setBusy] = useState(false);
  const valid = !start || !end || end >= start;
  return <ControlledModalDialog isOpen size="md" title={t("Where and when")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={async () => {
        setBusy(true); await onSave({ workcenterId: workcenterId || null, plannedStart: start, plannedEnd: end, plannedHours: hours || null, notes: notes.trim() }); setBusy(false);
      }}>{t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      <SelectField label={t("Workcenter")} placeholder={t("Choose")} selectedKey={workcenterId} onSelectionChange={(key) => setWorkcenterId(key ? String(key) : "")}
        items={state.workcenters.map((center) => ({ id: center.id, label: center.name }))} />
      <div className={styles.pair}>
        <DateField label={t("Start")} value={start ? parseDate(start) : null} onChange={(value) => setStart(value ? value.toString() : null)} />
        <DateField label={t("Finish")} value={end ? parseDate(end) : null} onChange={(value) => setEnd(value ? value.toString() : null)}
          isInvalid={!valid} errorMessage={valid ? undefined : t("The finish can't be before the start.")} />
      </div>
      <TextInput label={t("Hours it takes")} inputMode="decimal" suffix={t("h")} value={hours} onChange={(value) => setHours(numeric(value))} />
      <TextAreaField label={t("Notes")} value={notes} onChange={setNotes} />
    </div>
  </ControlledModalDialog>;
}

/** What was made and scrapped since the last report, and the hours it took; never more good than is still to make. */
export function ReportDialog({ unit, left, onClose, onSave }: { unit: string; left: string; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const [good, setGood] = useState("");
  const [scrap, setScrap] = useState("");
  const [hours, setHours] = useState("");
  const [scrapReason, setScrapReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const over = Number(good) > Number(left);
  // Hours are optional: more than none, at most 1,000 on one report, to the hundredth.
  const badHours = Boolean(hours) && (!/^\d{1,4}(\.\d{1,2})?$/.test(hours) || Number(hours) <= 0 || Number(hours) > 1000);
  const valid = Number(good || 0) + Number(scrap || 0) > 0 && !over && !badHours && (!Number(scrap) || scrapReason.trim());
  return <ControlledModalDialog isOpen size="md" title={t("Report output")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={async () => {
        setBusy(true); await onSave({ good: good || "0", scrap: scrap || "0", scrapReason: scrapReason.trim(), note: note.trim(), ...(hours ? { hours } : {}) }); setBusy(false);
      }}>{t("Report output")}</Button></div>}>
    <div className={styles.dialogBody}>
      <div className={styles.pair}>
        <TextInput label={t("Made")} inputMode="decimal" suffix={unit || undefined} value={good} onChange={(value) => setGood(numeric(value))}
          isInvalid={over} errorMessage={over ? t("Only {quantity} is still to make.", { quantity: `${quantityText(left)} ${unit}`.trim() }) : undefined} />
        <TextInput label={t("Scrapped")} inputMode="decimal" suffix={unit || undefined} value={scrap} onChange={(value) => setScrap(numeric(value))} />
      </div>
      {Number(scrap) ? <TextInput label={t("Why it was scrapped")} isRequired value={scrapReason} onChange={setScrapReason} /> : null}
      <TextInput label={t("Hours worked")} inputMode="decimal" value={hours} onChange={(value) => setHours(numeric(value))}
        isInvalid={badHours} errorMessage={badHours ? t("More than 0 and at most 1000, with up to 2 decimals.") : undefined} />
      <TextAreaField label={t("Note")} value={note} onChange={setNote} />
    </div>
  </ControlledModalDialog>;
}

/** A quality check of approved output: what passed goes into stock; what failed says why and is made again. */
export function CheckDialog({ unit, waiting, onClose, onSave }: { unit: string; waiting: string; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const [passed, setPassed] = useState(quantityText(waiting));
  const [failed, setFailed] = useState("");
  const [failReason, setFailReason] = useState("");
  const [busy, setBusy] = useState(false);
  const over = Number(passed || 0) + Number(failed || 0) > Number(waiting);
  const valid = Number(passed || 0) + Number(failed || 0) > 0 && !over && (!Number(failed) || failReason.trim());
  return <ControlledModalDialog isOpen size="md" title={t("Check quality")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={async () => {
        setBusy(true); await onSave({ passed: passed || "0", failed: failed || "0", failReason: failReason.trim() }); setBusy(false);
      }}>{t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      <p className={styles.muted}>{t("{quantity} waiting to be checked.", { quantity: `${quantityText(waiting)} ${unit}`.trim() })}</p>
      <div className={styles.pair}>
        <TextInput label={t("Passed")} inputMode="decimal" suffix={unit || undefined} value={passed} onChange={(value) => setPassed(numeric(value))} isInvalid={over}
          errorMessage={over ? t("Only {quantity} is waiting.", { quantity: `${quantityText(waiting)} ${unit}`.trim() }) : undefined} />
        <TextInput label={t("Failed")} inputMode="decimal" suffix={unit || undefined} value={failed} onChange={(value) => setFailed(numeric(value))} />
      </div>
      {Number(failed) ? <TextInput label={t("Why it failed")} isRequired value={failReason} onChange={setFailReason} /> : null}
    </div>
  </ControlledModalDialog>;
}

/** How many the work order makes: never below what's made or waiting, never past its line. */
export function QuantityDialog({ unit, current, floor, onClose, onSave }: { unit: string; current: string; floor: string; onClose: () => void; onSave: (quantity: string) => Promise<void> }) {
  const t = useT();
  const [quantity, setQuantity] = useState(quantityText(current));
  const [busy, setBusy] = useState(false);
  const under = Number(quantity) < Number(floor);
  return <ControlledModalDialog isOpen size="md" title={t("Change quantity")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!(Number(quantity) > 0) || under} onPress={async () => { setBusy(true); await onSave(quantity); setBusy(false); }}>{t("Save")}</Button></div>}>
    <TextInput label={t("Quantity")} isRequired inputMode="decimal" suffix={unit || undefined} value={quantity} onChange={(value) => setQuantity(numeric(value))}
      isInvalid={under} errorMessage={under ? t("{quantity} is already made or waiting.", { quantity: `${quantityText(floor)} ${unit}`.trim() }) : undefined} />
  </ControlledModalDialog>;
}

/** A step a supplier does on the work order's goods: a draft service order the buyer places; checks wait until the goods are back. */
export function SendOutDialog({ state, onClose, onSave }: { state: WorkOrderState; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const [name, setName] = useState("");
  const [vendorId, setVendorId] = useState(state.suppliers.find((supplier) => supplier.approved)?.id ?? "");
  const [quantity, setQuantity] = useState(quantityText(state.order.quantity));
  const [price, setPrice] = useState("");
  const [back, setBack] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const over = Number(quantity) > Number(state.order.quantity);
  return <ControlledModalDialog isOpen size="md" title={t("Send a step out")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!name.trim() || !vendorId || !(Number(quantity) > 0) || over} onPress={async () => {
        setBusy(true); await onSave({ name: name.trim(), vendorId, quantity, unitPrice: price || "0", expectedDate: back }); setBusy(false);
      }}>{t("Create service order")}</Button></div>}>
    <div className={styles.dialogBody}>
      <TextInput label={t("What the supplier does")} isRequired value={name} onChange={setName} />
      <SelectField label={t("Supplier")} placeholder={t("Choose")} selectedKey={vendorId} onSelectionChange={(key) => setVendorId(key ? String(key) : "")}
        items={state.suppliers.map((supplier) => ({ id: supplier.id, label: supplier.approved ? supplier.name : t("{name} (not approved)", { name: supplier.name }) }))} />
      <div className={styles.pair}>
        <TextInput label={t("Quantity")} isRequired inputMode="decimal" suffix={state.order.unit || undefined} value={quantity} onChange={(value) => setQuantity(numeric(value))}
          isInvalid={over} errorMessage={over ? t("Up to {quantity}.", { quantity: `${quantityText(state.order.quantity)} ${state.order.unit}`.trim() }) : undefined} />
        <TextInput label={t("Price each")} inputMode="decimal" value={price} onChange={(value) => setPrice(numeric(value))} />
      </div>
      <DateField label={t("Back by")} value={back ? parseDate(back) : null} onChange={(value) => setBack(value ? value.toString() : null)} />
    </div>
  </ControlledModalDialog>;
}

/** Made goods from the factory to the project's site: a move the site receives (and can refuse, sending them back to be made again). */
export function DispatchDialog({ unit, available, onClose, onSave }: { unit: string; available: string; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const [quantity, setQuantity] = useState(quantityText(available));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const over = Number(quantity) > Number(available);
  return <ControlledModalDialog isOpen size="md" title={t("Send to site")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!(Number(quantity) > 0) || over} onPress={async () => { setBusy(true); await onSave({ quantity, note: note.trim() }); setBusy(false); }}>
        {t("Send to site")}</Button></div>}>
    <div className={styles.dialogBody}>
      <TextInput label={t("Quantity")} isRequired inputMode="decimal" suffix={unit || undefined} value={quantity} onChange={(value) => setQuantity(numeric(value))}
        isInvalid={over} errorMessage={over ? t("Only {quantity} at the factory.", { quantity: `${quantityText(available)} ${unit}`.trim() }) : undefined} />
      <TextInput label={t("Note")} value={note} onChange={setNote} />
    </div>
  </ControlledModalDialog>;
}
