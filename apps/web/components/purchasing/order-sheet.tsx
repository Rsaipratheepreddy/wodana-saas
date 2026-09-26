"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Plus, X } from "lucide-react";
import {
  ActivityFeed, Button, ControlledModalDialog, DateField, ErrorState, IconButton, InlineNotice, InspectorSheet, SelectField, Skeleton, TextAreaField, TextInput, type ActivityItem,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { currencyDecimals, orderTotals, priceLine } from "@/lib/purchasing/amounts";
import type { PurchasingApi } from "@/lib/purchasing/client";
import type { DeliverTo, OrderLine, OrderState, PaymentTerms, PurchasingSettings } from "@/lib/purchasing/types";
import { useProjectFormat } from "../project-core/format";
import { OrderStatusLabel, quantityText, useOrderLabels } from "./order-labels";
import { ReceiptResult } from "./receipt-sheet";
import { ReceiveDialog } from "./receive-dialog";
import { percentText, useSupplierLabels } from "./supplier-labels";
import styles from "./purchasing.module.css";

type LineDraft = Pick<OrderLine, "id" | "source" | "materialItemId" | "boqLineId" | "projectId" | "projectReference" | "description" | "specification" | "unit"> & {
  quantity: string; unitPrice: string; discountPercent: string; taxRate: string;
};
type Form = { expectedDate: string | null; deliverTo: DeliverTo; deliveryAddress: string; paymentTerms: PaymentTerms; advancePercent: string; creditDays: string; termsNote: string; notes: string; lines: LineDraft[] };
type Dialog = "cancel" | "change" | "return" | "send" | "confirm" | "close" | "receive" | null;
const numeric = (value: string) => value.replace(/[^\d.]/g, "");
const TERMS: PaymentTerms[] = ["upfront", "split", "on_delivery", "credit", "statement"];
const DELIVERY: DeliverTo[] = ["site", "factory", "warehouse", "pickup", "other"];

const formOf = (state: OrderState): Form => ({
  expectedDate: state.order.expectedDate, deliverTo: state.order.deliverTo, deliveryAddress: state.order.deliveryAddress, paymentTerms: state.order.paymentTerms,
  advancePercent: percentText(state.order.advancePercent), creditDays: state.order.creditDays ? String(state.order.creditDays) : "", termsNote: state.order.termsNote, notes: state.order.notes,
  lines: state.lines.map((line) => ({ id: line.id, source: line.source, materialItemId: line.materialItemId, boqLineId: line.boqLineId, projectId: line.projectId, projectReference: line.projectReference,
    description: line.description, specification: line.specification, unit: line.unit, quantity: quantityText(line.quantity), unitPrice: quantityText(line.unitPrice),
    discountPercent: quantityText(line.discountPercent), taxRate: quantityText(line.taxRate) })),
});

/**
 * One purchase order: its lines and terms (editable while it's a draft), and the step it's at — approval
 * by someone other than the buyer, sending to the supplier, the supplier's confirmation, deliveries
 * against it and closing it — with its history.
 */
export function OrderSheet({ api, orderId, settings, onChanged, onClose, onReceipt }: {
  api: PurchasingApi; orderId: string; settings: PurchasingSettings | null; onChanged: () => void; onClose: () => void; onReceipt: (receiptId: string) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const labels = useOrderLabels();
  const supplierLabels = useSupplierLabels();
  const [state, setState] = useState<OrderState | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ tone: "error" | "info" | "success"; text: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [overReason, setOverReason] = useState("");
  const [busy, setBusy] = useState(false);
  const accept = useCallback((next: OrderState) => { setState(next); setForm(formOf(next)); }, []);
  const load = useCallback(async () => {
    try { accept(await api.order(orderId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The order didn't load.")); }
  }, [api, orderId, accept, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const run = async (action: string, input: Record<string, unknown> = {}, version = state?.order.version) => {
    if (!state || version === undefined) return null;
    setNotice(null); setBusy(true);
    try {
      const next = await api.orderCommand(orderId, version, action, input);
      accept(next); onChanged();
      if (action === "send") setNotice(next.delivery === "sent" ? { tone: "success", text: t("Emailed to {email}.", { email: next.order.sentTo ?? "" }) }
        : next.order.sentTo ? { tone: "info", text: next.delivery === "failed" ? t("The email didn't go. Send the order to the supplier yourself.") : t("Email isn't set up here. Send the order to the supplier yourself.") } : null);
      return next;
    } catch (cause) {
      setNotice({ tone: "error", text: cause instanceof Error ? cause.message : t("Could not save.") });
      if (cause instanceof Error && "status" in cause && cause.status === 409) await load();
      return null;
    } finally { setBusy(false); }
  };

  const order = state?.order;
  const decimals = order ? currencyDecimals(order.currency) : 2;
  const draft = order?.status === "draft" && Boolean(state?.canBuy);
  const priced = useMemo(() => (form?.lines ?? []).map((line) => priceLine(line, decimals)), [form, decimals]);
  const totals = orderTotals(priced, decimals);
  const dirty = Boolean(state && form && JSON.stringify(form) !== JSON.stringify(formOf(state)));
  const saveInput = () => form ? { expectedDate: form.expectedDate, deliverTo: form.deliverTo, deliveryAddress: form.deliveryAddress, paymentTerms: form.paymentTerms,
    advancePercent: form.advancePercent || null, creditDays: form.creditDays ? Number(form.creditDays) : null, termsNote: form.termsNote, notes: form.notes,
    lines: form.lines.map((line) => ({ id: line.id, source: line.source, materialItemId: line.materialItemId, boqLineId: line.boqLineId, projectId: line.projectId, description: line.description,
      specification: line.specification, quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice, discountPercent: line.discountPercent, taxRate: line.taxRate })) } : {};
  const submit = async () => {
    const saved = dirty ? await run("save", saveInput()) : state;
    if (saved) await run("submit", overReason.trim() ? { overReason: overReason.trim() } : {}, saved.order.version);
  };
  const setLine = (id: string, patch: Partial<LineDraft>) => form && setForm({ ...form, lines: form.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)) });
  const money = (value: string) => (order ? format.money(value, order.currency) : value);
  // Short when what was accepted and what the supplier credited don't make up the line (as the server counts it).
  const short = (state?.lines ?? []).some((line) => Number(line.accepted) + Number(line.credited) < Number(line.quantity));
  const over = order && ["draft", "pending_approval"].includes(order.status) ? state?.overOrdered ?? [] : [];
  /** What has arrived on a line so far, once anything has. */
  const arrived = (line: OrderLine | undefined) => {
    if (!line || !(Number(line.accepted) || Number(line.rejected) || Number(line.pending) || Number(line.credited))) return "";
    return [Number(line.accepted) ? t("{quantity} accepted", { quantity: quantityText(line.accepted) }) : "", Number(line.pending) ? t("{quantity} to inspect", { quantity: quantityText(line.pending) }) : "",
      Number(line.rejected) ? t("{quantity} rejected", { quantity: quantityText(line.rejected) }) : "", Number(line.returned) ? t("{quantity} returned", { quantity: quantityText(line.returned) }) : "",
      Number(line.credited) ? t("{quantity} credited", { quantity: quantityText(line.credited) }) : ""].filter(Boolean).join(" · ");
  };

  const footer = !order || !state ? null
    : order.status === "draft" && state.canBuy ? <div className="wd-dialog-actions">
      <Button variant="quiet" onPress={() => setDialog("cancel")}>{t("Cancel order")}</Button><span className={styles.spacer} />
      <Button isDisabled={!dirty} isLoading={busy} onPress={() => void run("save", saveInput())}>{t("Save")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={over.length > 0 && !overReason.trim() && !order.overReason} onPress={() => void submit()}>
        {settings?.approvalThreshold === null ? t("Place order") : t("Send for approval")}</Button></div>
    : order.status === "pending_approval" && state.canApproveThis ? <div className="wd-dialog-actions"><span className={styles.spacer} />
      <Button onPress={() => setDialog("return")}>{t("Send back")}</Button>
      <Button variant="primary" isLoading={busy} onPress={() => void run("approve")}>{t("Approve")}</Button></div>
    : ["approved", "sent", "confirmed"].includes(order.status) && (state.canBuy || state.canReceive) ? <div className="wd-dialog-actions">
      {state.canBuy ? <><Button variant="quiet" onPress={() => setDialog("cancel")}>{t("Cancel order")}</Button>
        <Button variant="quiet" onPress={() => setDialog("change")}>{t("Change")}</Button></> : null}<span className={styles.spacer} />
      {!state.canBuy ? null : order.status === "approved" ? <><Button isLoading={busy} onPress={() => void run("send", { to: null })}>{t("Mark as sent")}</Button>
        <Button variant="primary" onPress={() => setDialog("send")}>{t("Send to supplier")}</Button></>
        : <Button onPress={() => setDialog("confirm")}>{order.status === "sent" ? t("Record confirmation") : t("Update confirmation")}</Button>}
      {order.status !== "approved" && state.canReceive ? <Button variant="primary" onPress={() => setDialog("receive")}>{t("Receive")}</Button> : null}
    </div>
    : ["partly_received", "received"].includes(order.status) && (state.canBuy || state.canReceive) ? <div className="wd-dialog-actions">
      {state.canBuy ? <Button variant="quiet" onPress={() => setDialog("close")}>{t("Close order")}</Button> : null}<span className={styles.spacer} />
      {order.status === "partly_received" && state.canReceive ? <Button variant="primary" onPress={() => setDialog("receive")}>{t("Receive")}</Button> : null}
    </div> : null;

  return <InspectorSheet isOpen size="lg" title={order ? order.number : t("Order")} onOpenChange={(open) => { if (!open) onClose(); }} footer={footer}>
    {error && !state ? <ErrorState description={error} onRetry={() => void load()} /> : !state || !order || !form ? <Skeleton lines={8} /> : <div className={styles.sheet}>
      <div className={styles.approvalRow}>
        <OrderStatusLabel status={order.status} />
        <span className={styles.muted}>{[order.supplierName, order.companyName, order.revision ? t("Change {number}", { number: order.revision }) : ""].filter(Boolean).join(" · ")}</span>
      </div>
      {notice ? <InlineNotice tone={notice.tone} message={notice.text} /> : null}
      {order.status === "cancelled" ? <InlineNotice tone="info" message={t("Cancelled: {reason}", { reason: order.cancelReason ?? "" })} /> : null}
      {order.status === "closed" && order.closeReason ? <InlineNotice tone="info" message={t("Closed: {reason}", { reason: order.closeReason })} /> : null}
      {order.status === "pending_approval" && !state.canApproveThis ? <InlineNotice tone="info" message={t("Waiting for someone who approves orders.")} /> : null}
      {over.length ? <InlineNotice tone="info" message={t("More than the project needs: {lines}", { lines: over.map((line) => `${line.description} +${quantityText(line.over)} ${line.unit}`.trim()).join(", ") })} /> : null}
      {over.length && draft ? <TextInput label={t("Why order more than needed")} isRequired value={overReason || order.overReason || ""} onChange={setOverReason} /> : null}
      {order.overReason && !draft ? <InlineNotice tone="info" message={t("Ordered more than needed: {reason}", { reason: order.overReason })} /> : null}

      {draft ? <section className={styles.part} aria-label={t("Delivery and terms")}>
        <div className={styles.pair}>
          <DateField label={t("Needed by")} value={form.expectedDate ? parseDate(form.expectedDate) : null} onChange={(value) => setForm({ ...form, expectedDate: value ? value.toString() : null })} />
          <SelectField label={t("Deliver to")} selectedKey={form.deliverTo} onSelectionChange={(key) => setForm({ ...form, deliverTo: key as DeliverTo })} items={DELIVERY.map((id) => ({ id, label: labels.deliverTo[id] }))} />
        </div>
        <TextInput label={t("Delivery address")} value={form.deliveryAddress} onChange={(deliveryAddress) => setForm({ ...form, deliveryAddress })} />
        <div className={styles.pair}>
          <SelectField label={t("Payment terms")} selectedKey={form.paymentTerms} onSelectionChange={(key) => setForm({ ...form, paymentTerms: key as PaymentTerms })}
            items={TERMS.map((id) => ({ id, label: supplierLabels.terms[id] }))} />
          {form.paymentTerms === "split" ? <TextInput label={t("Advance")} inputMode="decimal" suffix="%" value={form.advancePercent} onChange={(value) => setForm({ ...form, advancePercent: numeric(value) })} />
            : form.paymentTerms === "credit" ? <TextInput label={t("Days")} inputMode="numeric" value={form.creditDays} onChange={(value) => setForm({ ...form, creditDays: value.replace(/\D/g, "").slice(0, 3) })} /> : <span />}
        </div>
      </section> : <dl className={styles.facts}>
        <div><dt>{t("Supplier")}</dt><dd>{[order.supplierName, state.supplier?.contactName, state.supplier?.phone].filter(Boolean).join(" · ")}</dd></div>
        <div><dt>{t("Needed by")}</dt><dd>{format.day(order.expectedDate) || "—"}</dd></div>
        <div><dt>{t("Deliver to")}</dt><dd>{[labels.deliverTo[order.deliverTo], order.deliveryAddress].filter(Boolean).join(" · ")}</dd></div>
        <div><dt>{t("Payment")}</dt><dd>{supplierLabels.termsText(order)}</dd></div>
        {order.promisedDate || order.supplierReference ? <div><dt>{t("Promised")}</dt><dd>{[format.day(order.promisedDate), order.supplierReference].filter(Boolean).join(" · ")}</dd></div> : null}
      </dl>}

      <section className={styles.part} aria-label={t("Lines")}>
        <div className={styles.orderLines} role="table" aria-label={t("Lines")}>
          <div role="row" className={styles.orderLineHead}><span role="columnheader">{t("Item")}</span><span role="columnheader">{t("Quantity")}</span><span role="columnheader">{t("Price")}</span>
            <span role="columnheader">{t("Discount %")}</span><span role="columnheader">{t("Tax %")}</span><span role="columnheader">{t("Total")}</span><span /></div>
          {form.lines.map((line, index) => <div role="row" key={line.id} className={styles.orderLine}>
            <span role="cell" className={styles.nameCell}>
              {draft && line.source === "free" ? <TextInput aria-label={t("What")} label={null} value={line.description} onChange={(description) => setLine(line.id, { description })} /> : <span>{line.description}</span>}
              <small>{[line.projectReference, line.specification].filter(Boolean).join(" · ")}</small>
              {!draft && arrived(state.lines[index]) ? <small className={styles.arrived}>{arrived(state.lines[index])}</small> : null}
            </span>
            {draft ? <>
              <span role="cell"><TextInput aria-label={t("Quantity for {item}", { item: line.description })} label={null} inputMode="decimal" value={line.quantity} suffix={line.unit || undefined} onChange={(value) => setLine(line.id, { quantity: numeric(value) })} /></span>
              <span role="cell"><TextInput aria-label={t("Price for {item}", { item: line.description })} label={null} inputMode="decimal" value={line.unitPrice} onChange={(value) => setLine(line.id, { unitPrice: numeric(value) })} /></span>
              <span role="cell"><TextInput aria-label={t("Discount for {item}", { item: line.description })} label={null} inputMode="decimal" value={line.discountPercent} onChange={(value) => setLine(line.id, { discountPercent: numeric(value) })} /></span>
              <span role="cell"><TextInput aria-label={t("Tax for {item}", { item: line.description })} label={null} inputMode="decimal" value={line.taxRate} onChange={(value) => setLine(line.id, { taxRate: numeric(value) })} /></span>
            </> : <>
              <span role="cell" className={styles.money}>{`${quantityText(line.quantity)} ${line.unit}`.trim()}</span>
              <span role="cell" className={styles.money}>{money(line.unitPrice)}</span>
              <span role="cell" className={styles.money}>{Number(line.discountPercent) ? `${line.discountPercent}%` : "—"}</span>
              <span role="cell" className={styles.money}>{Number(line.taxRate) ? `${line.taxRate}%` : "—"}</span>
            </>}
            <span role="cell" className={styles.money}>{priced[index] ? money(priced[index]!.total) : "—"}</span>
            <span role="cell">{draft && form.lines.length > 1 ? <IconButton aria-label={t("Remove {item}", { item: line.description })} size="compact" variant="quiet"
              onPress={() => setForm({ ...form, lines: form.lines.filter((item) => item.id !== line.id) })}><X aria-hidden="true" size={14} /></IconButton> : null}</span>
          </div>)}
        </div>
        {draft ? <Button size="compact" variant="quiet" onPress={() => setForm({ ...form, lines: [...form.lines, { id: crypto.randomUUID(), source: "free", materialItemId: null, boqLineId: null, projectId: null,
          projectReference: null, description: "", specification: "", unit: "", quantity: "1", unitPrice: "", discountPercent: form.lines[0]?.discountPercent ?? "0", taxRate: form.lines[0]?.taxRate ?? "0" }] })}>
          <Plus aria-hidden="true" size={14} />{t("Add line")}</Button> : null}
        <dl className={styles.totals}>
          <div><dt>{t("Net")}</dt><dd>{money(totals.net)}</dd></div>
          <div><dt>{t("Tax")}</dt><dd>{money(totals.tax)}</dd></div>
          <div><dt>{t("Total")}</dt><dd><strong>{money(totals.total)}</strong></dd></div>
        </dl>
      </section>
      {draft ? <TextAreaField label={t("Notes for the supplier")} value={form.notes} onChange={(notes) => setForm({ ...form, notes })} /> : order.notes ? <p className={styles.dialogText}>{order.notes}</p> : null}
      {state.receipts.length ? <section className={styles.part} aria-label={t("Deliveries")}>
        <h3 className={styles.subhead}>{t("Deliveries")}</h3>
        <ul className={styles.receipts}>{state.receipts.map((receipt) => <li key={receipt.id}>
          <Button size="compact" variant="quiet" onPress={() => onReceipt(receipt.id)}>{t("Delivery {number}", { number: receipt.number })}</Button>
          <span className={styles.muted}>{[format.day(receipt.receivedOn), receipt.locationName].join(" · ")}</span>
          <ReceiptResult receipt={receipt} />
        </li>)}</ul>
      </section> : null}
      <History state={state} />
    </div>}
    {dialog === "cancel" || dialog === "change" || dialog === "return" || dialog === "close" ? <ReasonDialog kind={dialog} optional={dialog === "close" && !short} onClose={() => setDialog(null)}
      onSave={async (reason) => { if (await run(dialog === "return" ? "return" : dialog, dialog === "return" ? { note: reason } : { reason })) setDialog(null); }} /> : null}
    {dialog === "receive" ? <ReceiveDialog api={api} orderId={orderId} onClose={() => setDialog(null)} onReceived={(receipt) => { setDialog(null); onChanged(); onReceipt(receipt.receipt.id); }} /> : null}
    {dialog === "send" && state ? <SendDialog email={state.supplier?.email ?? ""} onClose={() => setDialog(null)}
      onSave={async (to, message) => { if (await run("send", { to, message })) setDialog(null); }} /> : null}
    {dialog === "confirm" && order ? <ConfirmDialog promised={order.promisedDate} reference={order.supplierReference} onClose={() => setDialog(null)}
      onSave={async (promisedDate, supplierReference) => { if (await run("confirm", { promisedDate, supplierReference })) setDialog(null); }} /> : null}
  </InspectorSheet>;
}

function History({ state }: { state: OrderState }) {
  const t = useT();
  const format = useProjectFormat();
  const text = (kind: string, detail: Record<string, unknown>) => {
    const value = (key: string) => (typeof detail[key] === "string" ? detail[key] as string : "");
    switch (kind) {
      case "created": return t("raised it");
      case "submitted": return t("sent it for approval");
      case "approved": return detail.policy === "under_threshold" ? t("placed it (no approval needed at this amount)") : t("approved it");
      case "returned": return t("sent it back: {note}", { note: value("note") });
      case "sent": return value("to") ? t("sent it to {email}", { email: value("to") }) : t("marked it as sent");
      case "emailed": return t("emailed it to {email}", { email: value("to") });
      case "email_not_sent": return t("couldn't email it to {email}", { email: value("to") });
      case "confirmed": return value("promisedDate") ? t("recorded the supplier's confirmation, promised for {date}", { date: format.day(value("promisedDate")) }) : t("recorded the supplier's confirmation");
      case "changing": return t("reopened it to change: {reason}", { reason: value("reason") });
      case "cancelled": return t("cancelled it: {reason}", { reason: value("reason") });
      case "received": return t("received delivery {number} at {place}", { number: String(detail.receipt ?? ""), place: value("location") });
      case "inspected": return t("inspected delivery {number}", { number: String(detail.receipt ?? "") });
      case "closed": return value("reason") ? t("closed it: {reason}", { reason: value("reason") }) : t("closed it");
      case "receipt_reversed": return t("reversed delivery {number}: {reason}", { number: String(detail.receipt ?? ""), reason: value("reason") });
      case "return_raised": return detail.outcome === "credit" ? t("raised return {number} for a credit", { number: String(detail.return ?? "") })
        : t("raised return {number} to be replaced", { number: String(detail.return ?? "") });
      case "return_emailed": return t("emailed the return note to {email}", { email: value("to") });
      case "return_email_not_sent": return t("couldn't email the return note to {email}", { email: value("to") });
      case "return_sent": return t("recorded the supplier collecting return {number}", { number: String(detail.return ?? "") });
      case "return_cancelled": return t("cancelled return {number}: {reason}", { number: String(detail.return ?? ""), reason: value("reason") });
      default: return t("changed it");
    }
  };
  const items: ActivityItem[] = [...state.events].reverse().map((entry) => ({ id: entry.id, actor: entry.byName ?? t("Someone"), action: text(entry.kind, entry.detail), occurredAt: format.when(entry.at), kind: "change" }));
  return <section className={styles.part} aria-label={t("History")}><h3 className={styles.subhead}>{t("History")}</h3><ActivityFeed items={items} /></section>;
}

function ReasonDialog({ kind, optional = false, onClose, onSave }: { kind: "cancel" | "change" | "return" | "close"; optional?: boolean; onClose: () => void; onSave: (reason: string) => Promise<void> }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const title = kind === "cancel" ? t("Cancel order") : kind === "change" ? t("Change the order") : kind === "close" ? t("Close order") : t("Send back");
  const label = kind === "cancel" ? t("Why it's cancelled") : kind === "change" ? t("What's changing") : kind === "close" ? t("Why the rest won't come") : t("What needs to change");
  return <ControlledModalDialog isOpen size="md" title={title} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Back")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!optional && !reason.trim()} onPress={async () => { setBusy(true); await onSave(reason.trim()); setBusy(false); }}>{title}</Button></div>}>
    <div className={styles.dialogBody}>
      {kind === "change" ? <p className={styles.dialogText}>{t("The order goes back to draft and through approval again. What was approved is kept.")}</p> : null}
      <TextAreaField label={optional ? t("Note") : label} isRequired={!optional} value={reason} onChange={setReason} />
    </div>
  </ControlledModalDialog>;
}

function SendDialog({ email, onClose, onSave }: { email: string; onClose: () => void; onSave: (to: string, message: string) => Promise<void> }) {
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

function ConfirmDialog({ promised, reference, onClose, onSave }: { promised: string | null; reference: string; onClose: () => void; onSave: (promised: string | null, reference: string) => Promise<void> }) {
  const t = useT();
  const [date, setDate] = useState(promised);
  const [ref, setRef] = useState(reference);
  const [busy, setBusy] = useState(false);
  return <ControlledModalDialog isOpen size="md" title={t("Supplier's confirmation")} onOpenChange={(open) => { if (!open) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} onPress={async () => { setBusy(true); await onSave(date, ref.trim()); setBusy(false); }}>{t("Save")}</Button></div>}>
    <div className={styles.pair}>
      <DateField label={t("Promised delivery")} value={date ? parseDate(date) : null} onChange={(value) => setDate(value ? value.toString() : null)} />
      <TextInput label={t("Their reference")} value={ref} onChange={setRef} />
    </div>
  </ControlledModalDialog>;
}
