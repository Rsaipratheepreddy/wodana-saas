"use client";

import { useEffect, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Button, ControlledModalDialog, DateField, InlineNotice, SelectField, TextAreaField, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { subtractExact } from "@/lib/purchasing/amounts";
import type { PurchasingApi } from "@/lib/purchasing/client";
import type { OrderLine, Shipment, ShipmentStatus } from "@/lib/purchasing/types";
import { quantityText, useOrderLabels } from "./order-labels";
import styles from "./purchasing.module.css";

const numeric = (value: string) => value.replace(/[^\d.]/g, "");
export type ReasonKind = "cancel" | "change" | "return" | "close" | "continue" | "funds";

/** One reason, and the action it's for (cancel, change, send back, close, continue on hold, go ahead beyond the money). */
export function ReasonDialog({ kind, optional = false, onClose, onSave }: { kind: ReasonKind; optional?: boolean; onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const title = kind === "cancel" ? t("Cancel order") : kind === "change" ? t("Change the order") : kind === "close" ? t("Close order") : kind === "continue" ? t("Continue this order") : kind === "funds" ? t("Let it go ahead") : t("Send back");
  const label = kind === "cancel" ? t("Why it's cancelled") : kind === "change" ? t("What's changing") : kind === "close" ? t("Why the rest won't come")
    : kind === "continue" ? t("Why it continues while the supplier is on hold") : kind === "funds" ? t("Why it goes ahead beyond the money in hand") : t("What needs to change");
  return <ControlledModalDialog isOpen size="md" title={title} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Back")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!optional && !reason.trim()} onPress={async () => { setBusy(true); await onSave(reason.trim()); setBusy(false); }}>{title}</Button></div>}>
    <div className={styles.dialogBody}>
      {kind === "change" ? <p className={styles.dialogText}>{t("The order goes back to draft and through approval again. What was approved is kept.")}</p> : null}
      <TextAreaField label={optional ? t("Note") : label} isRequired={!optional} value={reason} onChange={setReason} />
    </div>
  </ControlledModalDialog>;
}

export function SendDialog({ email, onClose, onSave }: { email: string; onClose: () => void; onSave: (to: string, message: string) => Promise<void> }) {
  const t = useT();
  const [to, setTo] = useState(email);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("Send to supplier")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())} onPress={async () => { setBusy(true); await onSave(to.trim(), message.trim()); setBusy(false); }}>{t("Send")}</Button></div>}>
    <div className={styles.dialogBody}>
      <TextInput label={t("Email")} inputType="email" isRequired value={to} onChange={setTo} />
      <TextAreaField label={t("Message")} value={message} onChange={setMessage} />
    </div>
  </ControlledModalDialog>;
}

/** The supplier's confirmation: their reference, and for each line by when and how much (when it differs from what was ordered). */
export function ConfirmDialog({ promised, reference, lines, onClose, onSave }: {
  promised: string | null; reference: string; lines: OrderLine[]; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void>;
}) {
  const t = useT();
  const open = lines.filter((line) => Number(line.cancelled) < Number(line.quantity));
  const [ref, setRef] = useState(reference);
  const [rows, setRows] = useState(() => Object.fromEntries(open.map((line) => [line.id, { date: line.promisedDate ?? promised, quantity: line.confirmedQuantity ? quantityText(line.confirmedQuantity) : "" }])));
  const [busy, setBusy] = useState(false);
  const tooMuch = open.find((line) => rows[line.id].quantity !== "" && Number(rows[line.id].quantity) > Number(subtractExact(line.quantity, line.cancelled)));
  return <ControlledModalDialog isOpen size="lg" title={t("Supplier's confirmation")} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={Boolean(tooMuch)} onPress={async () => { setBusy(true); await onSave({ supplierReference: ref.trim(),
        lines: open.map((line) => ({ lineId: line.id, promisedDate: rows[line.id].date, confirmedQuantity: rows[line.id].quantity || null })) }); setBusy(false); }}>{t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      <TextInput label={t("Their reference")} value={ref} onChange={setRef} />
      <div className={styles.receiveLines} role="table" aria-label={t("Lines")} data-columns="3">
        <div role="row" className={styles.receiveHead}><span role="columnheader">{t("Item")}</span><span role="columnheader">{t("They confirm")}</span><span role="columnheader">{t("Promised")}</span></div>
        {open.map((line) => <div role="row" key={line.id} className={styles.receiveLine}>
          <span role="cell" className={styles.nameCell}><span>{line.description}</span><small>{t("Ordered {quantity}", { quantity: `${quantityText(subtractExact(line.quantity, line.cancelled))} ${line.unit}`.trim() })}</small></span>
          <span role="cell"><TextInput aria-label={t("Confirmed of {item}", { item: line.description })} label={null} inputMode="decimal" placeholder={t("All")} suffix={line.unit || undefined}
            value={rows[line.id].quantity} onChange={(value) => setRows({ ...rows, [line.id]: { ...rows[line.id], quantity: numeric(value) } })} /></span>
          <span role="cell"><DateField aria-label={t("Promised date for {item}", { item: line.description })} label={null} value={rows[line.id].date ? parseDate(rows[line.id].date!) : null}
            onChange={(value) => setRows({ ...rows, [line.id]: { ...rows[line.id], date: value ? value.toString() : null } })} /></span>
        </div>)}
      </div>
      {tooMuch ? <InlineNotice tone="error" message={t("The supplier can't confirm more of {item} than was ordered.", { item: tooMuch.description })} /> : null}
    </div>
  </ControlledModalDialog>;
}

/** A late order chased: what the supplier said and, if they gave one, their new date. */
export function ChaseDialog({ onClose, onSave }: { onClose: () => void; onSave: (note: string, promisedDate: string | null) => Promise<void> }) {
  const t = useT();
  const [note, setNote] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("Chase")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!note.trim()} onPress={async () => { setBusy(true); await onSave(note.trim(), date); setBusy(false); }}>{t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      <TextAreaField label={t("What the supplier said")} isRequired value={note} onChange={setNote} />
      <DateField label={t("New date")} value={date ? parseDate(date) : null} onChange={(value) => setDate(value ? value.toString() : null)} />
    </div>
  </ControlledModalDialog>;
}

/** What the supplier offers instead of a line: what, which finish or size, at what price, and why. */
export function OfferAlternateDialog({ line, onClose, onSave }: { line: OrderLine; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const [description, setDescription] = useState(line.description);
  const [specification, setSpecification] = useState(line.specification);
  const [price, setPrice] = useState(quantityText(line.unitPrice));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("The supplier offers an alternative")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!description.trim() || !note.trim()} onPress={async () => { setBusy(true);
        await onSave({ description: description.trim(), specification: specification.trim(), unitPrice: price || null, note: note.trim() }); setBusy(false); }}>{t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      <p className={styles.dialogText}>{t("Instead of {item}", { item: [line.description, line.specification].filter(Boolean).join(", ") })}</p>
      <TextInput label={t("What they offer")} isRequired value={description} onChange={setDescription} />
      <div className={styles.pair}>
        <TextInput label={t("Finish or size")} value={specification} onChange={setSpecification} />
        <TextInput label={t("Price each")} inputMode="decimal" value={price} onChange={(value) => setPrice(numeric(value))} />
      </div>
      <TextAreaField label={t("Why they offer it")} isRequired value={note} onChange={setNote} />
    </div>
  </ControlledModalDialog>;
}

export function RefuseAlternateDialog({ onClose, onSave }: { onClose: () => void; onSave: (note: string) => Promise<void> }) {
  const t = useT();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("Refuse the alternative")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Back")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!note.trim()} onPress={async () => { setBusy(true); await onSave(note.trim()); setBusy(false); }}>{t("Refuse")}</Button></div>}>
    <TextAreaField label={t("Why it's refused")} isRequired value={note} onChange={setNote} />
  </ControlledModalDialog>;
}

/** The rest of a line won't come: how much, why, and optionally which other supplier gets it (as a new draft order). */
export function CancelLineDialog({ api, line, left, vendorId, onClose, onSave }: {
  api: PurchasingApi; line: OrderLine; left: string; vendorId: string; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void>;
}) {
  const t = useT();
  const [quantity, setQuantity] = useState(quantityText(left));
  const [reason, setReason] = useState("");
  const [reorder, setReorder] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; label: string }>>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.suppliers().then((state) => setSuppliers(state.suppliers.filter((item) => item.status !== "archived" && item.id !== vendorId)
      .sort((a, b) => a.name.localeCompare(b.name)).map((item) => ({ id: item.id, label: item.name })))).catch(() => undefined);
  }, [api, vendorId]);
  const tooMuch = Number(quantity) > Number(left);
  return <ControlledModalDialog isOpen size="md" title={t("Cancel the rest of {item}", { item: line.description })} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Back")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!reason.trim() || !(Number(quantity) > 0) || tooMuch}
        onPress={async () => { setBusy(true); await onSave({ quantity, reason: reason.trim(), reorderVendorId: reorder }); setBusy(false); }}>{t("Cancel the rest")}</Button></div>}>
    <div className={styles.dialogBody}>
      <TextInput label={t("Quantity")} isRequired inputMode="decimal" suffix={line.unit || undefined} value={quantity} onChange={(value) => setQuantity(numeric(value))} />
      {tooMuch ? <InlineNotice tone="error" message={t("At most {quantity} is still to come.", { quantity: `${quantityText(left)} ${line.unit}`.trim() })} /> : null}
      <TextAreaField label={t("Why it won't come")} isRequired value={reason} onChange={setReason} />
      <SelectField label={t("Order it from")} selectedKey={reorder ?? "none"} onSelectionChange={(key) => setReorder(key === null || key === "none" ? null : String(key))}
        items={[{ id: "none", label: t("Don't reorder") }, ...suppliers]} />
    </div>
  </ControlledModalDialog>;
}

const SHIPMENT: ShipmentStatus[] = ["booked", "in_transit", "delayed", "arrived", "cancelled"];

/** A shipment the buyer follows: who carries it, its tracking, when it ships and arrives, and why it's late when it is. */
export function ShipmentDialog({ shipment, onClose, onSave }: { shipment: Shipment | null; onClose: () => void; onSave: (input: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const labels = useOrderLabels();
  const [id] = useState(() => shipment?.id ?? crypto.randomUUID());
  const [carrier, setCarrier] = useState(shipment?.carrier ?? "");
  const [trackingRef, setTrackingRef] = useState(shipment?.trackingRef ?? "");
  const [trackingUrl, setTrackingUrl] = useState(shipment?.trackingUrl ?? "");
  const [status, setStatus] = useState<ShipmentStatus>(shipment?.status ?? "booked");
  const [shippedOn, setShippedOn] = useState<string | null>(shipment?.shippedOn ?? null);
  const [eta, setEta] = useState<string | null>(shipment?.eta ?? null);
  const [note, setNote] = useState(shipment?.note ?? "");
  const [busy, setBusy] = useState(false);
  const badLink = Boolean(trackingUrl.trim() && !/^https?:\/\/\S+$/i.test(trackingUrl.trim()));
  const badDates = Boolean(eta && shippedOn && eta < shippedOn);
  const valid = Boolean(carrier.trim() || trackingRef.trim() || eta) && !badLink && !badDates && (status !== "delayed" || Boolean(note.trim() || eta));
  return <ControlledModalDialog isOpen size="md" title={shipment ? t("Update shipment") : t("Add shipment")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!valid} onPress={async () => { setBusy(true);
        await onSave({ shipmentId: id, shipmentVersion: shipment?.version, carrier: carrier.trim(), trackingRef: trackingRef.trim(), trackingUrl: trackingUrl.trim(), status, shippedOn, eta, note: note.trim() });
        setBusy(false); }}>{t("Save")}</Button></div>}>
    <div className={styles.dialogBody}>
      <div className={styles.pair}>
        <TextInput label={t("Carrier")} value={carrier} onChange={setCarrier} />
        <SelectField label={t("Status")} selectedKey={status} onSelectionChange={(key) => setStatus((key ?? "booked") as ShipmentStatus)} items={SHIPMENT.map((value) => ({ id: value, label: labels.shipment[value] }))} />
      </div>
      <div className={styles.pair}>
        <TextInput label={t("Tracking reference")} value={trackingRef} onChange={setTrackingRef} />
        <TextInput label={t("Tracking link")} inputType="url" value={trackingUrl} onChange={setTrackingUrl} isInvalid={badLink} errorMessage={badLink ? t("The tracking link starts with https://.") : undefined} />
      </div>
      <div className={styles.pair}>
        <DateField label={t("Shipped on")} value={shippedOn ? parseDate(shippedOn) : null} onChange={(value) => setShippedOn(value ? value.toString() : null)} />
        <DateField label={t("Expected on")} value={eta ? parseDate(eta) : null} onChange={(value) => setEta(value ? value.toString() : null)}
          isInvalid={badDates} errorMessage={badDates ? t("It can't arrive before it ships.") : undefined} />
      </div>
      <TextAreaField label={status === "delayed" ? t("Why it's delayed") : t("Note")} isRequired={status === "delayed" && !eta} value={note} onChange={setNote} />
    </div>
  </ControlledModalDialog>;
}
