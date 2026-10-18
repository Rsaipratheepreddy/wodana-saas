"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { parseDate } from "@internationalized/date";
import { Check, Circle } from "lucide-react";
import { Badge, Button, DateField, EditableFieldList, FactRow, FormDialog, MoneyField, SelectField, TextAreaField, TextInput, VisuallyHidden, useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey } from "@/lib/i18n/keys";
import { fulfilmentApi } from "@/lib/fulfilment/client";
import type { DealFulfilment, FulfilmentStep } from "@/lib/fulfilment/types";
import { purchasingApi } from "@/lib/purchasing/client";
import type { SupplierState } from "@/lib/purchasing/types";
import { FactCard } from "./opportunity-sections";
import { LogisticsBookingDialog } from "../logistics/booking-dialog";
import { RecordPermitDialog } from "../logistics/permit-dialog";
import styles from "./deal-fulfilment.module.css";

const STEP: Record<FulfilmentStep, MessageKey> = {
  paid: tKey("Paid"), transfer: tKey("Sent from the factory"), ordered: tKey("Ordered from the supplier"), received: tKey("Received from the supplier"),
  drawing_approved: tKey("Drawing approved"), slot_booked: tKey("Factory slot booked"), in_production: tKey("In production"), ready: tKey("Ready"),
  delivery_booked: tKey("Delivery booked"), collected: tKey("Collected"), delivered: tKey("Delivered"), handed_over: tKey("Collected or delivered"),
};
const HELD: Record<DealFulfilment["reservations"][number]["status"], MessageKey> = { reserved: tKey("Held"), deducted: tKey("Taken from stock"), released: tKey("Released") };
const quantity = (value: string) => value.replace(/\.?0+$/, "");

type Dialog = "transfer" | "delivery" | "cancel" | "order" | "crew" | "permit" | null;

/**
 * PLM-083 / PLM-125 / PLM-126 on the deal: whether the order needs a BOQ, how it reaches the client on its path (each
 * step read from its records), when it's expected and whether it's late, the supplier orders raised for it and the
 * stock it holds; who delivers it with which vehicle (PLM-135) and its building permit (PLM-136). One next action at a
 * time; the deal stays the record.
 */
export function DealFulfilmentCard({ workspaceId, opportunityId, won, open, onToggle }: { workspaceId: string; opportunityId: string; won: boolean; open: boolean; onToggle: () => void }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const api = useMemo(() => fulfilmentApi(workspaceId), [workspaceId]);
  const [view, setView] = useState<DealFulfilment | null>(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const load = useCallback(async () => {
    try { setView(await api.deal(opportunityId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The order didn't load.")); }
  }, [api, opportunityId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, won]);
  if (!view) return error ? <p className={styles.error} role="alert">{error}</p> : null;
  const day = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
  const run = async (action: string, input: Record<string, unknown> = {}) => {
    setError("");
    try { setView(await api.command(opportunityId, view.version, action, input)); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); throw cause; }
  };
  const plan = view.plan;
  const path = view.furniturePath;
  const current = plan?.steps.find((step) => step.state === "current")?.key ?? null;
  const live = won && view.can.fulfil && !view.cancelled && !plan?.handedOver;
  // The one next action for the path, where the records don't move it by themselves.
  const next = !live ? null
    : path === "in_stock_delivery" && !view.transfer && !view.delivery ? "transfer_or_delivery"
    : path === "in_stock_delivery" && view.transfer && !view.transfer.arrivedAt ? "transfer_arrived"
    : path === "supplier_order" && current === "ordered" && view.can.order ? "order"
    : current === "delivery_booked" ? "delivery" : null;
  const status = view.cancelled ? t("Cancelled") : plan?.handedOver ? t("Done") : plan?.expected ? t("By {date}", { date: day(plan.expected.by) }) : null;
  const action = next === "transfer_or_delivery" ? <Button size="compact" variant="quiet" onPress={() => setDialog("delivery")}>{t("Book delivery")}</Button>
    : next === "transfer_arrived" ? <Button size="compact" variant="quiet" onPress={() => void run("transfer_arrived").catch(() => undefined)}>{t("Arrived from the factory")}</Button>
    : next === "order" ? <Button size="compact" variant="quiet" onPress={() => setDialog("order")}>{t("Order from the supplier")}</Button>
    : next === "delivery" ? <Button size="compact" variant="quiet" onPress={() => setDialog("delivery")}>{t("Book delivery")}</Button> : null;
  const boqChoice = view.boq.chosen === null ? "default" : view.boq.chosen ? "yes" : "no";

  return <FactCard id="fulfilment" title={t("Fulfilment")} open={open} onToggle={onToggle} status={status} tone={plan?.handedOver ? "success" : "neutral"} action={action}>
    <div className={styles.body}>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <EditableFieldList layout="stacked">
        <FactRow label={t("BOQ required")}>
          {view.can.boq ? <SelectField aria-label={t("BOQ required")} label={null} selectedKey={boqChoice} onSelectionChange={(key) => void run("set_boq",
            { value: key === "yes" ? true : key === "no" ? false : null }).catch(() => undefined)}
          items={[{ id: "default", label: view.boq.byDefault ? t("Yes, as for this path") : t("No, as for this path") }, { id: "yes", label: t("Yes") }, { id: "no", label: t("No") }]} />
            : view.boq.required ? t("Yes") : t("No")}
        </FactRow>
        {plan?.expected ? <FactRow label={t("Expected")}>
          <span className={styles.expected}>{plan.expected.from === plan.expected.by ? day(plan.expected.by) : `${day(plan.expected.from)} – ${day(plan.expected.by)}`}
            {plan.late ? <Badge tone="danger">{t("Late")}</Badge> : null}</span>
        </FactRow> : null}
        {view.delivery ? <FactRow label={t("Delivery")}>{[day(view.delivery.on), view.delivery.note].filter(Boolean).join(" · ")}</FactRow> : null}
        {/* PLM-135: who goes on the delivery, the vehicle and the driver. */}
        {view.delivery?.people?.length ? <FactRow label={t("Delivery crew")}>{view.delivery.people.map((person) => person.name).join(", ")}</FactRow> : null}
        {view.delivery?.vehicle || view.delivery?.driver ? <FactRow label={t("Vehicle")}>{[view.delivery.vehicle?.name,
          view.delivery.driver ? t("Driver: {name}", { name: view.delivery.driver.name }) : ""].filter(Boolean).join(" · ")}</FactRow> : null}
        {/* PLM-136: the building permit the delivery needs, where the firm asks for one. */}
        {view.permit && (view.permit.required || view.permit.collected) ? <FactRow label={t("Building permit")}>
          <span className={styles.expected}>{view.permit.valid ? (view.permit.validTo ? t("Valid until {date}", { date: day(view.permit.validTo) }) : t("Collected"))
            : view.permit.collected ? t("Doesn't cover the delivery day") : t("Missing")}{!view.permit.valid && view.permit.required ? <Badge tone="danger">{t("Needed to deliver")}</Badge> : null}</span>
        </FactRow> : null}
        {view.cancelled ? <FactRow label={t("Cancelled")}>{view.cancelled.reason}</FactRow> : null}
      </EditableFieldList>
      {plan && !view.cancelled ? <ol className={styles.steps} aria-label={t("Steps")}>{plan.steps.map((step) => <li key={step.key} data-state={step.state}>
        {step.state === "done" ? <Check aria-hidden="true" size={13} /> : <Circle aria-hidden="true" size={13} />}
        <span>{t(STEP[step.key])}</span>{step.at ? <small>{day(step.at)}</small> : null}
      </li>)}</ol> : null}
      {view.orders.length ? <ul className={styles.list} aria-label={t("Supplier orders")}>{view.orders.map((order) => <li key={order.id}>
        <Link href={`/workspace/purchasing/orders?order=${order.id}`}>{order.number}</Link>
        <span>{[order.supplierName, order.trackingRef, order.eta ? t("Due {date}", { date: day(order.eta) }) : ""].filter(Boolean).join(" · ")}</span>
      </li>)}</ul> : null}
      {view.reservations.length ? <ul className={styles.list} aria-label={t("Stock")}>{view.reservations.map((item) => <li key={item.id}>
        <span>{`${item.itemName} · ${quantity(item.quantity)} ${item.unit}`.trim()}</span>
        <span>{[t(HELD[item.status]), item.locationName, Number(item.short) ? t("{quantity} short", { quantity: `${quantity(item.short)} ${item.unit}`.trim() }) : ""].filter(Boolean).join(" · ")}</span>
      </li>)}</ul> : null}
      {live ? <div className={styles.actions}>
        {path === "in_stock_delivery" && !view.transfer && !view.delivery ? <Button size="compact" variant="quiet" onPress={() => setDialog("transfer")}>{t("Ask the factory to send it")}</Button> : null}
        {view.delivery ? <Button size="compact" variant="quiet" onPress={() => setDialog("crew")}>{t("Delivery crew and vehicle")}</Button> : null}
        {view.permit && (view.permit.required || view.permit.collected) ? <Button size="compact" variant="quiet" onPress={() => setDialog("permit")}>{t("Record the building permit")}</Button> : null}
        {view.can.cancel ? <Button size="compact" variant="quiet" onPress={() => setDialog("cancel")}>{t("Cancel the order")}</Button> : null}
      </div> : null}
    </div>
    {dialog === "transfer" ? <NoteDialog title={t("Ask the factory to send it")} label={t("Note")} required={false} submit={t("Send request")} onClose={() => setDialog(null)}
      onSave={async (note) => { await run("request_transfer", { note }); setDialog(null); }} /> : null}
    {dialog === "cancel" ? <NoteDialog title={t("Cancel the order")} label={t("Why")} required submit={t("Cancel the order")} onClose={() => setDialog(null)}
      onSave={async (reason) => { await run("cancel", { reason }); setDialog(null); }} /> : null}
    {dialog === "delivery" ? <DeliveryDialog initial={view.delivery?.on ?? plan?.expected?.by ?? null} onClose={() => setDialog(null)}
      onSave={async (date, note) => { await run("book_delivery", { date, note }); setDialog(null); }} /> : null}
    {dialog === "crew" ? <LogisticsBookingDialog workspaceId={workspaceId} fixedProject initial={{ kind: "delivery", opportunityId }} onClose={() => setDialog(null)}
      onSaved={() => { setDialog(null); void load(); }} /> : null}
    {dialog === "permit" ? <RecordPermitDialog workspaceId={workspaceId} owner={{ opportunityId }} permitId={view.permit?.plannedId} onClose={() => setDialog(null)}
      onSaved={() => { setDialog(null); void load(); }} /> : null}
    {dialog === "order" ? <DealOrderDialog workspaceId={workspaceId} opportunityId={opportunityId} items={view.items} onClose={() => setDialog(null)}
      onCreated={() => { setDialog(null); void load(); }} /> : null}
  </FactCard>;
}

function NoteDialog({ title, label, required, submit, onClose, onSave }: { title: string; label: string; required: boolean; submit: string; onClose: () => void; onSave: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  return <FormDialog size="md" title={title} submitLabel={submit} isDirty={Boolean(note.trim())} isSubmitDisabled={required && !note.trim()} onClose={onClose} onSubmit={() => onSave(note.trim())}>
    <TextAreaField autoFocus isRequired={required} label={label} value={note} onChange={setNote} maxLength={1000} />
  </FormDialog>;
}

function DeliveryDialog({ initial, onClose, onSave }: { initial: string | null; onClose: () => void; onSave: (date: string, note: string) => Promise<void> }) {
  const t = useT();
  const [date, setDate] = useState<string | null>(initial ? initial.slice(0, 10) : null);
  const [note, setNote] = useState("");
  return <FormDialog size="md" title={t("Book delivery")} submitLabel={t("Save")} isDirty={Boolean(date)} isSubmitDisabled={!date} onClose={onClose} onSubmit={() => onSave(date!, note.trim())}>
    <DateField isRequired label={t("Delivery day")} value={date ? parseDate(date) : null} onChange={(value) => setDate(value ? value.toString() : null)} />
    <TextAreaField label={t("Note")} value={note} onChange={setNote} maxLength={500} />
  </FormDialog>;
}

/** Path C: a supplier order for the deal's items; they're held for the deal when they arrive. */
function DealOrderDialog({ workspaceId, opportunityId, items, onClose, onCreated }: {
  workspaceId: string; opportunityId: string; items: DealFulfilment["items"]; onClose: () => void; onCreated: () => void;
}) {
  const t = useT();
  const api = useMemo(() => purchasingApi(workspaceId), [workspaceId]);
  const [id] = useState(() => crypto.randomUUID());
  const [suppliers, setSuppliers] = useState<SupplierState | null>(null);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [lines, setLines] = useState(() => items.map((item) => ({ ...item, quantity: quantity(item.quantity), unitPrice: "" })));
  useEffect(() => { void api.suppliers().then(setSuppliers).catch(() => setSuppliers({ suppliers: [], entities: [] } as unknown as SupplierState)); }, [api]);
  const active = (suppliers?.suppliers ?? []).filter((item) => item.status !== "archived");
  const supplier = active.find((item) => item.id === vendorId) ?? null;
  const valid = Boolean(supplier) && lines.length > 0 && lines.every((line) => Number(line.quantity) > 0);
  const update = (lineId: string, patch: Partial<(typeof lines)[number]>) => setLines(lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line)));
  return <FormDialog size="lg" title={t("Order from the supplier")} submitLabel={t("Create order")} isDirty={Boolean(vendorId)} isSubmitDisabled={!valid} onClose={onClose}
    onSubmit={async () => {
      await api.createOrder({ id, vendorId, deliverTo: "warehouse", lines: lines.map((line) => ({ source: "free", opportunityId, description: line.title, quantity: line.quantity,
        unit: line.stockItemId ? undefined : line.unit, ...(line.stockItemId ? { stockItemId: line.stockItemId } : {}), unitPrice: line.unitPrice || undefined })) });
      onCreated();
    }}>
    <SelectField label={t("Supplier")} isRequired placeholder={t("Choose a supplier")} selectedKey={vendorId} onSelectionChange={(key) => setVendorId(key === null ? null : String(key))}
      items={active.map((item) => ({ id: item.id, label: item.name }))} />
    <ul className={styles.lines} aria-label={t("Lines")}>{lines.map((line) => <li key={line.id}>
      <span>{line.title}</span>
      <TextInput aria-label={t("Quantity for {item}", { item: line.title })} label={null} inputMode="decimal" value={line.quantity} suffix={line.unit || undefined}
        onChange={(value) => update(line.id, { quantity: value.replace(/[^\d.]/g, "") })} />
      <MoneyField label={<VisuallyHidden>{t("Price for {item}", { item: line.title })}</VisuallyHidden>} placeholder={t("Price")} currency={supplier?.currency ?? undefined}
        value={line.unitPrice} onChange={(unitPrice) => update(line.id, { unitPrice })} />
    </li>)}</ul>
  </FormDialog>;
}
