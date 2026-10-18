"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { parseDate } from "@internationalized/date";
import { Ban, Plus, Replace, X } from "lucide-react";
import {
  Badge, Button, DateField, EditableField, ErrorState, FormSection, IconButton, InlineNotice, InspectorSheet, SelectField, Skeleton, StageTracker, Tabs, TextAreaField, TextInput, type WorkflowStage,
} from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { addExact, currencyDecimals, orderTotals, priceLine, subtractExact } from "@/lib/purchasing/amounts";
import type { PurchasingApi } from "@/lib/purchasing/client";
import type { DeliverTo, GateCheck, GateKey, OrderLine, OrderState, PaymentTerms, PurchasingSettings, Shipment } from "@/lib/purchasing/types";
import { Cell, NextStep, ProjectLinks, Section, operationsStyles as ops, projectHref } from "../operations/ops";
import { LinkedRecords } from "../record/linked-records";
import { useProjectFormat } from "../project-core/format";
import {
  CancelLineDialog, ChaseDialog, ConfirmDialog, OfferAlternateDialog, ReasonDialog, RefuseAlternateDialog, SendDialog, ShipmentDialog,
} from "./order-dialogs";
import { RecordHistory } from "../history/record-history";
import { OrderStatusLabel, quantityText, useOrderLabels } from "./order-labels";
import { ReceiptResult } from "./receipt-sheet";
import { ReceiveDialog } from "./receive-dialog";
import { percentText, useSupplierLabels } from "./supplier-labels";
import styles from "./purchasing.module.css";

type LineDraft = Pick<OrderLine, "id" | "source" | "materialItemId" | "boqLineId" | "projectId" | "projectReference" | "description" | "specification" | "unit"> & {
  quantity: string; unitPrice: string; discountPercent: string; taxRate: string; stockItemId?: string | null;
};
type Form = {
  expectedDate: string | null; deliverTo: DeliverTo; deliveryAddress: string; paymentTerms: PaymentTerms; advancePercent: string; creditDays: string; termsNote: string; retentionPercent: string;
  notes: string; lines: LineDraft[];
};
/** What the list asked the order to do when it opened it. */
export type OrderIntent = "send" | "confirm" | "chase" | "receive" | "close";
type Dialog = "cancel" | "change" | "return" | "send" | "confirm" | "close" | "receive" | "chase" | "continue" | "funds" | { shipment: Shipment | null } | { waive: GateKey } | null;
/** Still to come on a line: ordered less cancelled, credited, accepted and waiting for inspection. */
const stillToCome = (line: OrderLine) => subtractExact(line.quantity, addExact(line.cancelled, line.credited, line.accepted, line.pending));
const numeric = (value: string) => value.replace(/[^\d.]/g, "");
const TERMS: PaymentTerms[] = ["upfront", "split", "on_delivery", "credit", "statement"];
const DELIVERY: DeliverTo[] = ["site", "factory", "warehouse", "pickup", "other"];
const FOLLOWING = ["approved", "sent", "confirmed", "partly_received"];

const formOf = (state: OrderState): Form => ({
  expectedDate: state.order.expectedDate, deliverTo: state.order.deliverTo, deliveryAddress: state.order.deliveryAddress, paymentTerms: state.order.paymentTerms,
  advancePercent: percentText(state.order.advancePercent), creditDays: state.order.creditDays ? String(state.order.creditDays) : "", termsNote: state.order.termsNote,
  retentionPercent: Number(state.order.retentionPercent) ? percentText(state.order.retentionPercent) : "", notes: state.order.notes,
  lines: state.lines.map((line) => ({ id: line.id, source: line.source, materialItemId: line.materialItemId, boqLineId: line.boqLineId, projectId: line.projectId, projectReference: line.projectReference,
    description: line.description, specification: line.specification, unit: line.unit, quantity: quantityText(line.quantity), unitPrice: quantityText(line.unitPrice),
    discountPercent: quantityText(line.discountPercent), taxRate: quantityText(line.taxRate), stockItemId: line.stockItemId ?? null })),
});

/**
 * One purchase order as a record: where it is (raised, approved, sent, confirmed, received, closed), its one
 * next step, and its parts — the lines and terms (editable while it's a draft), deliveries and shipments, the
 * supplier's invoices and the history. The step it's at is the primary action.
 */
export function OrderSheet({ api, orderId, intent = null, settings, onChanged, onClose, onReceipt, onOpenOrder }: {
  api: PurchasingApi; orderId: string; intent?: OrderIntent | null; settings: PurchasingSettings | null; onChanged: () => void; onClose: () => void; onReceipt: (receiptId: string) => void;
  onOpenOrder?: (orderId: string) => void;
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
  const [tab, setTab] = useState("order");
  const [overReason, setOverReason] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [cancelling, setCancelling] = useState<OrderLine | null>(null);
  const [offering, setOffering] = useState<OrderLine | null>(null);
  const [refusing, setRefusing] = useState<OrderLine | null>(null);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<OrderIntent | null>(intent);
  const accept = useCallback((next: OrderState) => { setState(next); setForm(formOf(next)); }, []);
  const load = useCallback(async () => {
    try { accept(await api.order(orderId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The order didn't load.")); }
  }, [api, orderId, accept, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  // Opened from a list's next step: that step's dialog opens once the order is here, when it's still the step.
  useEffect(() => {
    if (!state || !asked) return;
    const status = state.order.status;
    const fits = asked === "send" ? status === "approved" && state.canBuy : asked === "confirm" || asked === "chase" ? ["sent", "confirmed", "partly_received"].includes(status) && state.canBuy
      : asked === "receive" ? ["sent", "confirmed", "partly_received"].includes(status) && state.canReceive : status === "received" && state.canBuy;
    if (fits) queueMicrotask(() => setDialog(asked));
    queueMicrotask(() => setAsked(null));
  }, [state, asked]);

  /** An order command; from a dialog (`inDialog`) a refusal is thrown so the dialog shows it and keeps the typing. */
  const run = async (action: string, input: Record<string, unknown> = {}, version = state?.order.version, inDialog = false) => {
    if (!state || version === undefined) return null;
    setNotice(null); setBusy(true);
    try {
      const next = await api.orderCommand(orderId, version, action, input);
      accept(next); onChanged();
      if (action === "send") setNotice(next.delivery === "sent" ? { tone: "success", text: t("Emailed to {email}.", { email: next.order.sentTo ?? "" }) }
        : next.order.sentTo ? { tone: "info", text: next.delivery === "failed" ? t("The email didn't go. Send the order to the supplier yourself.") : t("Email isn't set up here. Send the order to the supplier yourself.") } : null);
      return next;
    } catch (cause) {
      if (cause instanceof Error && "status" in cause && cause.status === 409) await load();
      if (inDialog) throw cause;
      setNotice({ tone: "error", text: cause instanceof Error ? cause.message : t("Could not save.") });
      return null;
    } finally { setBusy(false); }
  };

  const order = state?.order;
  const decimals = order ? currencyDecimals(order.currency) : 2;
  const draft = order?.status === "draft" && Boolean(state?.canBuy);
  const priced = useMemo(() => (form?.lines ?? []).map((line) => priceLine(line, decimals)), [form, decimals]);
  const totals = orderTotals(priced, decimals);
  const dirty = Boolean(state && form && JSON.stringify(form) !== JSON.stringify(formOf(state)));
  const held = state?.holdProjects ?? [];
  const holdInput = held.length ? { holdReason: holdReason.trim() } : {};
  const saveInput = () => form ? { expectedDate: form.expectedDate, deliverTo: form.deliverTo, deliveryAddress: form.deliveryAddress, paymentTerms: form.paymentTerms,
    advancePercent: form.advancePercent || null, creditDays: form.creditDays ? Number(form.creditDays) : null, termsNote: form.termsNote, retentionPercent: form.retentionPercent, notes: form.notes,
    lines: form.lines.map((line) => ({ id: line.id, source: line.source, materialItemId: line.materialItemId, boqLineId: line.boqLineId, projectId: line.projectId, description: line.description,
      specification: line.specification, quantity: line.quantity, unit: line.unit, unitPrice: line.unitPrice, discountPercent: line.discountPercent, taxRate: line.taxRate,
      ...(line.stockItemId ? { stockItemId: line.stockItemId } : {}) })) } : {};
  // Once the supplier has confirmed, their date and reference correct in place: the confirmation is recorded again.
  const confirmed = Boolean(order && ["confirmed", "partly_received"].includes(order.status) && state?.canBuy);
  const reconfirm = async (patch: { promisedDate?: string | null; supplierReference?: string }) => {
    if (!state) return;
    try {
      accept(await api.orderCommand(orderId, state.order.version, "confirm", { promisedDate: state.order.promisedDate, supplierReference: state.order.supplierReference ?? "", ...patch }));
      onChanged();
    } catch (cause) {
      if (cause instanceof Error && "status" in cause && cause.status === 409) await load();
      throw cause;
    }
  };
  const submit = async () => {
    const saved = dirty ? await run("save", saveInput()) : state;
    if (saved) await run("submit", { ...(overReason.trim() ? { overReason: overReason.trim() } : {}), ...holdInput }, saved.order.version);
  };
  const setLine = (id: string, patch: Partial<LineDraft>) => form && setForm({ ...form, lines: form.lines.map((line) => (line.id === id ? { ...line, ...patch } : line)) });
  const money = (value: string) => (order ? format.money(value, order.currency) : value);
  // Short when what was accepted and what the supplier credited don't make up the line (as the server counts it).
  const short = (state?.lines ?? []).some((line) => Number(line.accepted) + Number(line.credited) < Number(line.quantity));
  const over = order && ["draft", "pending_approval"].includes(order.status) ? state?.overOrdered ?? [] : [];
  const following = Boolean(order && ["sent", "confirmed", "partly_received"].includes(order.status) && state?.canBuy);
  const lateLines = (state?.lines ?? []).filter((line) => stillToCome(line) !== "0" && line.due && line.due < format.today());
  const late = lateLines.length > 0;
  const toCome = (state?.lines ?? []).filter((line) => stillToCome(line) !== "0");
  const holdBlocks = held.length > 0 && !holdReason.trim();
  /** What the supplier said about a line and what became of it, once it's out of draft. */
  const lineFacts = (line: OrderLine) => [
    line.promisedDate ? t("Promised {date}", { date: format.day(line.promisedDate) }) : "",
    line.confirmedQuantity !== null && Number(line.confirmedQuantity) < Number(subtractExact(line.quantity, line.cancelled)) ? t("Supplier confirmed {quantity}", { quantity: quantityText(line.confirmedQuantity) }) : "",
    Number(line.cancelled) ? t("{quantity} cancelled: {reason}", { quantity: quantityText(line.cancelled), reason: line.cancelReason ?? "" }) : "",
    line.replacesOrderNumber ? t("Replaces a line on {order}", { order: line.replacesOrderNumber }) : "",
    line.alternateStatus === "accepted" && line.originalDescription ? t("Instead of {item}", { item: [line.originalDescription, line.originalSpecification].filter(Boolean).join(", ") }) : "",
    line.alternateStatus === "rejected" ? t("Supplier's alternative refused") : "",
  ].filter(Boolean).join(" · ");
  /** Still to come after the day the project needs it. */
  const arrivesLate = (lineId: string) => {
    const line = state?.lines.find((item) => item.id === lineId);
    const due = line ? line.due : order?.promisedDate ?? order?.expectedDate ?? null;
    return Boolean(state?.neededBy[lineId] && due && due > state.neededBy[lineId] && (!line || stillToCome(line) !== "0"));
  };
  const contractOf = (lineId: string) => (state?.contracts ?? []).find((item) => item.lineId === lineId);
  // PLM-159: the ordering gate's checks, in the firm's words, with where each is put right.
  const gate = state?.gate ?? [];
  const gateLabel: Record<GateKey, string> = { drawings_verified: t("Technical drawings verified"), boq_approved: t("BOQ approved by the QS"), price_approved: t("Client approved the price"),
    qs_signoff: t("Signed off by the QS"), material_list_confirmed: t("Material list confirmed by the QS") };
  const gateFix = (check: GateCheck) => {
    const project = order?.projects[0];
    if (!project || check.key === "qs_signoff") return null;
    const view = check.key === "drawings_verified" ? "drawings" : check.key === "price_approved" ? "changes" : check.key === "material_list_confirmed" ? "materials" : null;
    return <Link className={ops.projectLink} href={`${projectHref(project.id, "scope")}${view ? `?view=${view}` : ""}`}>{t("Open the project")}</Link>;
  };
  const canDecide = (line: OrderLine) => Boolean(state?.canApprove && line.alternateStatus === "offered" && line.alternateOfferedBy !== state?.me);
  /** What has arrived on a line so far, once anything has. */
  const arrived = (line: OrderLine | undefined) => {
    if (!line || !(Number(line.accepted) || Number(line.rejected) || Number(line.pending) || Number(line.credited))) return "";
    return [Number(line.accepted) ? t("{quantity} accepted", { quantity: quantityText(line.accepted) }) : "", Number(line.pending) ? t("{quantity} to inspect", { quantity: quantityText(line.pending) }) : "",
      Number(line.rejected) ? t("{quantity} rejected", { quantity: quantityText(line.rejected) }) : "", Number(line.returned) ? t("{quantity} returned", { quantity: quantityText(line.returned) }) : "",
      Number(line.credited) ? t("{quantity} credited", { quantity: quantityText(line.credited) }) : ""].filter(Boolean).join(" · ");
  };

  // Where the order is: raised, approved, sent, confirmed, received, closed.
  const stages = (): WorkflowStage[] => {
    const steps = [t("Raised"), t("Approved"), t("Sent"), t("Confirmed"), t("Received"), t("Closed")];
    const at = !order ? 0 : { draft: 0, pending_approval: 1, approved: 2, sent: 3, confirmed: 4, partly_received: 4, received: 5, closed: 6, cancelled: 0 }[order.status];
    return steps.map((label, index) => ({ id: String(index), label, state: index < at ? "complete" : index === at ? "current" : "upcoming" }));
  };
  // The one next step, in words: what happens next and whose it is.
  const nextStep = (): { title: string; detail?: string | null; tone?: "danger" | "warning" } | null => {
    if (!order || !state) return null;
    const first = toCome.map((line) => line.due).filter((value): value is string => Boolean(value)).sort()[0] ?? null;
    const shipment = (state.shipments ?? []).find((item) => !["arrived", "cancelled"].includes(item.status));
    switch (order.status) {
      case "draft": return state.canBuy ? { title: settings?.approvalThreshold === null ? t("Place the order") : t("Send it for approval"), detail: t("Check the lines and terms first.") }
        : { title: t("A draft by {name}", { name: order.createdByName }) };
      case "pending_approval": return state.canApproveThis ? { title: t("Approve it or send it back"), detail: t("Raised by {name}", { name: order.createdByName }), tone: "warning" }
        : { title: t("Waiting for someone who approves orders."), tone: "warning" };
      case "approved": return state.canBuy ? { title: t("Send it to {supplier}", { supplier: order.supplierName }) } : { title: t("Approved; waiting to be sent") };
      case "sent": return { title: t("Waiting for {supplier} to confirm", { supplier: order.supplierName }), detail: order.sentAt ? t("Sent {date}", { date: format.when(order.sentAt) }) : null,
        tone: late ? "danger" : undefined };
      case "confirmed": case "partly_received": {
        const until = format.until(first);
        const count = toCome.length === 1 ? t("1 line to come") : t("{count} lines to come", { count: toCome.length });
        if (late) return { title: t("{count} late: chase {supplier}", { count, supplier: order.supplierName }), detail: until?.text ?? null, tone: "danger" };
        if (shipment) return { title: t("{status} with {carrier}", { status: labels.shipment[shipment.status], carrier: shipment.carrier || t("the carrier") }),
          detail: shipment.eta ? t("Expected {date}", { date: format.day(shipment.eta) }) : null, tone: shipment.status === "delayed" ? "danger" : undefined };
        return { title: count, detail: first ? t("Due {date} · {until}", { date: format.day(first), until: until?.text ?? "" }) : null };
      }
      case "received": return state.canBuy ? { title: t("Everything arrived: close it"), detail: null } : { title: t("Everything arrived") };
      default: return null;
    }
  };

  const footer = !order || !state ? null
    : order.status === "draft" && state.canBuy ? <div className="wd-dialog-actions">
      <Button variant="quiet" onPress={() => setDialog("cancel")}>{t("Cancel order")}</Button><span className={styles.spacer} />
      <Button isDisabled={!dirty} isLoading={busy} onPress={() => void run("save", saveInput())}>{t("Save")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={(over.length > 0 && !overReason.trim() && !order.overReason) || holdBlocks} onPress={() => void submit()}>
        {settings?.approvalThreshold === null ? t("Place order") : t("Send for approval")}</Button></div>
    : order.status === "pending_approval" && state.canApproveThis ? <div className="wd-dialog-actions"><span className={styles.spacer} />
      <Button onPress={() => setDialog("return")}>{t("Send back")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={holdBlocks} onPress={() => void run("approve", holdInput)}>{t("Approve")}</Button></div>
    // While it waits for someone else to approve, the buyer can still call it off (no approver has to act first).
    : order.status === "pending_approval" && state.canBuy ? <div className="wd-dialog-actions">
      <Button variant="quiet" onPress={() => setDialog("cancel")}>{t("Cancel order")}</Button><span className={styles.spacer} /></div>
    : ["approved", "sent", "confirmed"].includes(order.status) && (state.canBuy || state.canReceive) ? <div className="wd-dialog-actions">
      {state.canBuy ? <><Button variant="quiet" onPress={() => setDialog("cancel")}>{t("Cancel order")}</Button>
        <Button variant="quiet" onPress={() => setDialog("change")}>{t("Change")}</Button></> : null}<span className={styles.spacer} />
      {!state.canBuy ? null : order.status === "approved" ? <><Button isLoading={busy} isDisabled={holdBlocks} onPress={() => void run("send", { to: null, ...holdInput })}>{t("Mark as sent")}</Button>
        <Button variant="primary" isDisabled={holdBlocks} onPress={() => setDialog("send")}>{t("Send to supplier")}</Button></>
        : <>{late ? <Button onPress={() => setDialog("chase")}>{t("Chase")}</Button> : null}
          <Button onPress={() => setDialog("confirm")}>{order.status === "sent" ? t("Record confirmation") : t("Update confirmation")}</Button></>}
      {order.status !== "approved" && state.canReceive ? <Button variant="primary" onPress={() => setDialog("receive")}>{t("Receive")}</Button> : null}
    </div>
    : ["partly_received", "received"].includes(order.status) && (state.canBuy || state.canReceive) ? <div className="wd-dialog-actions">
      {state.canBuy && order.status !== "received" ? <Button variant="quiet" onPress={() => setDialog("close")}>{t("Close order")}</Button> : null}<span className={styles.spacer} />
      {following && late ? <Button onPress={() => setDialog("chase")}>{t("Chase")}</Button> : null}
      {following ? <Button onPress={() => setDialog("confirm")}>{t("Update confirmation")}</Button> : null}
      {order.status === "partly_received" && state.canReceive ? <Button variant="primary" onPress={() => setDialog("receive")}>{t("Receive")}</Button> : null}
      {state.canBuy && order.status === "received" ? <Button variant="primary" onPress={() => setDialog("close")}>{t("Close order")}</Button> : null}
    </div> : null;

  const step = nextStep();
  const shipments = state?.shipments ?? [];
  const canTrack = Boolean(order && state?.canBuy && FOLLOWING.includes(order.status));
  const deliveriesCount = (state?.receipts.length ?? 0) + (state?.returns.length ?? 0) + shipments.length;
  const linesPanel = !state || !order || !form ? null : <div className={styles.sheet}>
    {draft ? <div className={styles.stack}>
      <FormSection title={t("Delivery")}>
        <DateField label={t("Needed by")} value={form.expectedDate ? parseDate(form.expectedDate) : null} onChange={(value) => setForm({ ...form, expectedDate: value ? value.toString() : null })} />
        <SelectField label={t("Deliver to")} selectedKey={form.deliverTo} onSelectionChange={(key) => setForm({ ...form, deliverTo: key as DeliverTo })} items={DELIVERY.map((id) => ({ id, label: labels.deliverTo[id] }))} />
        <TextInput label={t("Delivery address")} value={form.deliveryAddress} onChange={(deliveryAddress) => setForm({ ...form, deliveryAddress })} />
      </FormSection>
      <FormSection title={t("Payment")}>
        <SelectField label={t("Payment terms")} selectedKey={form.paymentTerms} onSelectionChange={(key) => setForm({ ...form, paymentTerms: key as PaymentTerms })}
          items={TERMS.map((id) => ({ id, label: supplierLabels.terms[id] }))} />
        {form.paymentTerms === "split" ? <TextInput label={t("Advance")} inputMode="decimal" suffix="%" value={form.advancePercent} onChange={(value) => setForm({ ...form, advancePercent: numeric(value) })} />
          : form.paymentTerms === "credit" ? <TextInput label={t("Days")} inputMode="numeric" value={form.creditDays} onChange={(value) => setForm({ ...form, creditDays: value.replace(/\D/g, "").slice(0, 3) })} /> : null}
        <TextInput label={t("Retention")} inputMode="decimal" suffix="%" value={form.retentionPercent}
          onChange={(value) => setForm({ ...form, retentionPercent: numeric(value) })} />
      </FormSection>
    </div> : <dl className={styles.facts}>
      <div><dt>{t("Supplier")}</dt><dd>{[order.supplierName, state.supplier?.contactName, state.supplier?.phone].filter(Boolean).join(" · ")}</dd></div>
      <div><dt>{t("Needed by")}</dt><dd>{format.day(order.expectedDate) || "—"}</dd></div>
      <div><dt>{t("Deliver to")}</dt><dd>{[labels.deliverTo[order.deliverTo], order.deliveryAddress].filter(Boolean).join(" · ")}</dd></div>
      <div><dt>{t("Payment")}</dt><dd>{supplierLabels.termsText(order)}</dd></div>
      {confirmed ? <>
        <EditableField display={order.promisedDate ? format.day(order.promisedDate) : undefined} kind="date" label={t("Promised")} onReload={() => void load()}
          onSave={(promisedDate) => reconfirm({ promisedDate: promisedDate || null })} placeholder={t("Not set")} value={order.promisedDate ?? ""} />
        <EditableField label={t("Supplier reference")} maxLength={120} onReload={() => void load()} onSave={(supplierReference) => reconfirm({ supplierReference })} placeholder={t("Not set")} value={order.supplierReference ?? ""} />
      </> : order.promisedDate || order.supplierReference ? <div><dt>{t("Promised")}</dt><dd>{[format.day(order.promisedDate), order.supplierReference].filter(Boolean).join(" · ")}</dd></div> : null}
    </dl>}

    <section className={styles.part} aria-label={t("Lines")}>
      <div className={styles.orderLines} role="table" aria-label={t("Lines")}>
        <div role="row" className={styles.orderLineHead}><span role="columnheader">{t("Item")}</span><span role="columnheader">{t("Quantity")}</span><span role="columnheader">{t("Price")}</span>
          <span role="columnheader">{t("Discount %")}</span><span role="columnheader">{t("Tax %")}</span><span role="columnheader">{t("Total")}</span><span /></div>
        {form.lines.map((line, index) => <div role="row" key={line.id} className={styles.orderLine}>
          <span role="cell" className={styles.nameCell}>
            {draft && line.source === "free" && !line.stockItemId ? <TextInput aria-label={t("What")} label={null} value={line.description} onChange={(description) => setLine(line.id, { description })} /> : <span>{line.description}</span>}
            <small>{[line.projectReference, line.specification, line.stockItemId ? t("Restock") : ""].filter(Boolean).join(" · ")}</small>
            {!draft && arrived(state.lines[index]) ? <small className={styles.arrived}>{arrived(state.lines[index])}</small> : null}
            {!draft && state.lines[index] && lineFacts(state.lines[index]) ? <small>{lineFacts(state.lines[index])}</small> : null}
            {state.neededBy[line.id] ? <small className={arrivesLate(line.id) ? styles.lateText : undefined}>{arrivesLate(line.id)
              ? t("Arrives after it's needed on {date}", { date: format.day(state.neededBy[line.id]) }) : t("Needed {date}", { date: format.day(state.neededBy[line.id]) })}</small> : null}
            {contractOf(line.id) ? <small className={contractOf(line.id)!.above ? styles.lateText : undefined}>{contractOf(line.id)!.above
              ? t("Above the {reference} price of {price}", { reference: contractOf(line.id)!.reference, price: money(contractOf(line.id)!.unitPrice) })
              : t("{reference} price", { reference: contractOf(line.id)!.reference })}</small> : null}
            {!draft && state.lines[index]?.alternateStatus === "offered" ? <span className={styles.alternate} role="note">
              <small>{t("The supplier offers {item} at {price}: {note}", { item: [state.lines[index].alternateDescription, state.lines[index].alternateSpecification].filter(Boolean).join(", "),
                price: money(state.lines[index].alternateUnitPrice ?? state.lines[index].unitPrice), note: state.lines[index].alternateNote })}</small>
              {canDecide(state.lines[index]) ? <span className={styles.filters}>
                <Button size="compact" onPress={() => void run("decide_alternate", { lineId: line.id, decision: "accept" })}>{t("Take it")}</Button>
                <Button size="compact" variant="quiet" onPress={() => setRefusing(state.lines[index])}>{t("Refuse")}</Button>
              </span> : <small className={styles.muted}>{t("Waiting for someone who approves orders.")}</small>}
            </span> : null}
            {draft ? (state.packs ?? []).filter((pack) => pack.lineId === line.id).map((pack) => <small key={pack.lineId} className={styles.packHint}>
              {pack.packSize && pack.minimum ? t("Sold in packs of {pack}, at least {minimum}", { pack: pack.packSize, minimum: pack.minimum })
                : pack.packSize ? t("Sold in packs of {pack}", { pack: pack.packSize }) : t("At least {minimum}", { minimum: pack.minimum ?? "" })}
              {line.quantity !== pack.suggested ? <Button size="compact" variant="quiet" onPress={() => setLine(line.id, { quantity: pack.suggested })}>{t("Order {quantity}", { quantity: pack.suggested })}</Button> : null}
            </small>) : null}
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
            onPress={() => setForm({ ...form, lines: form.lines.filter((item) => item.id !== line.id) })}><X aria-hidden="true" size={14} /></IconButton>
            : following && state.lines[index] && stillToCome(state.lines[index]) !== "0" ? <span className={styles.lineActions}>
              {state.lines[index].alternateStatus !== "offered" ? <IconButton aria-label={t("The supplier offers an alternative for {item}", { item: line.description })} size="compact" variant="quiet"
                onPress={() => setOffering(state.lines[index])}><Replace aria-hidden="true" size={14} /></IconButton> : null}
              <IconButton aria-label={t("Cancel the rest of {item}", { item: line.description })} size="compact" variant="quiet"
                onPress={() => setCancelling(state.lines[index])}><Ban aria-hidden="true" size={14} /></IconButton></span> : null}</span>
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
  </div>;

  const deliveriesPanel = !state || !order ? null : <div className={styles.sheet}>
    <Section title={t("Shipments")} action={canTrack ? <Button size="compact" onPress={() => setDialog({ shipment: null })}><Plus aria-hidden="true" size={14} />{t("Add shipment")}</Button> : null}>
      {shipments.length ? <ul className={ops.list}>{shipments.map((shipment) => <li key={shipment.id}>
        <Cell title={[shipment.carrier, shipment.trackingRef].filter(Boolean).join(" · ") || t("Shipment")}
          meta={[shipment.shippedOn ? t("Shipped {date}", { date: format.day(shipment.shippedOn) }) : "", shipment.eta ? t("Expected {date}", { date: format.day(shipment.eta) }) : "", shipment.note]
            .filter(Boolean).join(" · ") || null} tone={shipment.status === "delayed" ? "danger" : undefined} />
        <Badge tone={shipment.status === "delayed" ? "danger" : shipment.status === "arrived" ? "success" : shipment.status === "cancelled" ? "neutral" : "info"}>{labels.shipment[shipment.status]}</Badge>
        {shipment.trackingUrl ? <a className={ops.projectLink} href={shipment.trackingUrl} target="_blank" rel="noreferrer noopener">{t("Track")}</a> : null}
        {canTrack ? <Button size="compact" variant="quiet" onPress={() => setDialog({ shipment })}>{t("Update")}</Button> : null}
      </li>)}</ul> : <p className={ops.empty}>{t("No shipment followed yet.")}</p>}
    </Section>
    <Section title={t("Deliveries")}>
      {state.receipts.length ? <ul className={ops.list}>{state.receipts.map((receipt) => <li key={receipt.id}>
        <Button size="compact" variant="quiet" onPress={() => onReceipt(receipt.id)}>{t("Delivery {number}", { number: receipt.number })}</Button>
        <span className={styles.muted}>{[format.day(receipt.receivedOn), receipt.locationName].join(" · ")}</span>
        <ReceiptResult receipt={receipt} />
      </li>)}</ul> : <p className={ops.empty}>{t("Nothing has arrived yet.")}</p>}
    </Section>
    {state.returns.length ? <Section title={t("Returns")}>
      <ul className={ops.list}>{state.returns.map((back) => <li key={back.id}>
        <Cell title={t("Return {number}", { number: back.number })} meta={[back.outcome === "credit" ? t("For a credit") : t("To be replaced"), back.note].filter(Boolean).join(" · ")} />
        <Badge tone={back.status === "open" ? "warning" : back.status === "sent" ? "success" : "neutral"}>{back.status === "open" ? t("Waiting for pickup") : back.status === "sent" ? t("Collected") : t("Cancelled")}</Badge>
      </li>)}</ul>
    </Section> : null}
  </div>;

  const billsPanel = !state?.bills || !order ? null : <div className={styles.sheet}>
    {state.bills.length ? <ul className={ops.list}>{state.bills.map((bill) => <li key={bill.id}>
      <Cell title={<Link className={ops.projectLink} href={`/workspace/finance/bills?bill=${bill.id}`}>{bill.number}</Link>}
        meta={[format.day(bill.invoiceDate), bill.status === "held" && bill.holdReasons ? bill.holdReasons : ""].filter(Boolean).join(" · ")} tone={bill.status === "held" ? "danger" : undefined} />
      <Badge tone={bill.status === "approved" ? "success" : bill.status === "held" ? "warning" : "neutral"}>{bill.status === "approved" ? t("Matched") : bill.status === "held" ? t("Held")
        : bill.status === "draft" ? t("Draft") : t("Cancelled")}</Badge>
      <span className={styles.money}>{format.money(bill.total, bill.currency)}</span>
    </li>)}</ul> : <p className={ops.empty}>{t("No invoice from the supplier yet.")}</p>}
  </div>;

  return <InspectorSheet isOpen size="lg" title={order ? order.number : t("Order")} onOpenChange={(open) => { if (!open) onClose(); }} footer={footer}>
    {error && !state ? <ErrorState description={error} onRetry={() => void load()} /> : !state || !order || !form ? <Skeleton lines={8} shape="facts" /> : <div className={styles.sheet} data-tour="order-detail">
      <div className={ops.recordHead}>
        <div className={ops.recordFacts}>
          <OrderStatusLabel status={order.status} />
          <span>{[order.supplierName, order.companyName, order.revision ? t("Change {number}", { number: order.revision }) : ""].filter(Boolean).join(" · ")}</span>
          <ProjectLinks projects={order.projects} />
          {/* The printed order carries the code that opens its receive screen on arrival (D-46). */}
          {order.status !== "draft" && order.status !== "cancelled" ? <a className={ops.projectLink} href={`/print/order/${order.id}`} target="_blank" rel="noopener">{t("Print")}</a> : null}
        </div>
        {order.status !== "cancelled" ? <StageTracker ariaLabel={t("Where the order is")} stages={stages()} /> : null}
        {step ? <NextStep title={step.title} detail={step.detail} tone={step.tone} /> : null}
      </div>
      {/* PLM-164: the records of each project this order is for, each a link; this order is named. */}
      {order.projects.map((project) => <LinkedRecords key={project.id} workspaceId={api.workspaceId} projectId={project.id} current="purchase_order" currentId={order.id} />)}
      {notice ? <InlineNotice tone={notice.tone} message={notice.text} /> : null}
      {order.status === "cancelled" ? <InlineNotice tone="info" message={t("Cancelled: {reason}", { reason: order.cancelReason ?? "" })} /> : null}
      {order.status === "closed" && order.closeReason ? <InlineNotice tone="info" message={t("Closed: {reason}", { reason: order.closeReason })} /> : null}
      {state.supplierHold && !order.continuedAt ? <div className={styles.alternate} role="note">
        <InlineNotice tone="error" message={t("{supplier} is on hold: {note}. This order waits until someone who approves orders says it continues; or cancel it, or order the rest elsewhere.",
          { supplier: order.supplierName, note: state.supplierHold.note })} />
        {state.canApprove ? <div><Button size="compact" onPress={() => setDialog("continue")}>{t("Continue this order")}</Button></div> : null}
      </div> : null}
      {order.continuedAt ? <InlineNotice tone="info" message={t("Continued while the supplier is on hold, by {name}: {note}", { name: order.continuedByName ?? "", note: order.continuedNote ?? "" })} /> : null}
      {held.length ? <div className={styles.alternate} role="note">
        <InlineNotice tone="error" message={t("{projects} is on hold. Say why this order goes ahead anyway.", { projects: held.map((project) => project.reference).join(", ") })} />
        {state.canBuy || state.canApproveThis ? <TextInput label={t("Why it goes ahead")} isRequired value={holdReason} onChange={setHoldReason} /> : null}
      </div> : null}
      {order.holdOverrideAt ? <InlineNotice tone="info" message={t("Goes ahead while its project is on hold, by {name}: {reason}", { name: order.holdOverrideByName ?? "", reason: order.holdOverrideReason ?? "" })} /> : null}
      {state.fundsShort.length ? <div className={styles.alternate} role="note">
        <InlineNotice tone={state.spendingGuard === "strict" && !order.fundsOverrideAt ? "error" : "info"} message={t("Beyond the money in hand: {projects}", { projects: state.fundsShort.map((item) => item.needed
          ? t("{project} has {available}, this order needs {needed}", { project: item.reference, available: format.money(item.available, item.currency), needed: format.money(item.needed, item.currency) })
          : t("{project}: no exchange rate to compare", { project: item.reference })).join("; ") })} />
        {state.spendingGuard === "strict" && !order.fundsOverrideAt ? <div>{state.canOverrideFunds
          ? <Button size="compact" onPress={() => setDialog("funds")}>{t("Let it go ahead")}</Button>
          : state.canBuy ? <Button size="compact" isLoading={busy} onPress={() => void run("ask_funds")}>{t("Ask to go ahead")}</Button> : null}</div> : null}
      </div> : null}
      {order.fundsOverrideAt ? <InlineNotice tone="info" message={t("Let go ahead beyond the money in hand by {name}: {reason}", { name: order.fundsOverrideByName ?? "", reason: order.fundsOverrideReason ?? "" })} /> : null}
      {over.length ? <InlineNotice tone="info" message={t("More than the project needs: {lines}", { lines: over.map((line) => `${line.description} +${quantityText(line.over)} ${line.unit}`.trim()).join(", ") })} /> : null}
      {over.length && draft ? <TextInput label={t("Why order more than needed")} isRequired value={overReason || order.overReason || ""} onChange={setOverReason} /> : null}
      {order.overReason && !draft ? <InlineNotice tone="info" message={t("Ordered more than needed: {reason}", { reason: order.overReason })} /> : null}
      {/* PLM-159: what must hold before the order is placed; someone who approves orders can mark a check not applicable here, with a reason. */}
      {gate.length ? <ul className={ops.list} aria-label={t("Before it's placed")}>{gate.map((check) => <li key={check.key}>
        <Cell title={gateLabel[check.key]} tone={check.passed ? "success" : check.waiver ? "info" : "danger"}
          meta={check.passed ? t("Done") : check.waiver ? t("Not applicable, {name}: {reason}", { name: check.waiver.byName ?? "", reason: check.waiver.reason }) : check.missing} />
        {check.passed ? null : check.waiver ? (state.canApprove ? <Button size="compact" variant="quiet" isLoading={busy} onPress={() => void run("clear_waiver", { checkKey: check.key })}>{t("Applies again")}</Button> : null)
          : <span className={styles.lineActions}>
            {check.key === "qs_signoff" && state.canQsSignOff ? <Button size="compact" variant="primary" isLoading={busy} onPress={() => void run("qs_signoff")}>{t("Sign off (QS)")}</Button> : gateFix(check)}
            {state.canApprove ? <Button size="compact" variant="quiet" onPress={() => setDialog({ waive: check.key })}>{t("Not applicable")}</Button> : null}
          </span>}
      </li>)}</ul> : null}
      {order.qsSignedOffAt && !gate.some((check) => check.key === "qs_signoff") ? <InlineNotice tone="info" message={t("Signed off by the QS ({name}, {date})", { name: order.qsSignedOffByName ?? "", date: format.when(order.qsSignedOffAt) })} /> : null}
      {(state.blockers ?? []).length ? <ul className={ops.list} aria-label={t("Work held up")}>{state.blockers!.map((blocker) => <li key={blocker.workItemId}>
        <Cell title={<Link className={ops.projectLink} href={`${projectHref(blocker.projectId, "plan")}?item=${blocker.workItemId}`}>{`${blocker.projectReference} #${blocker.number} · ${blocker.title}`}</Link>}
          meta={blocker.blocks === 1 ? t("Holding up 1 task") : t("Holding up {count} tasks", { count: blocker.blocks })} tone="danger" />
      </li>)}</ul> : null}

      <Tabs selectedKey={tab} onSelectionChange={setTab} items={[
        { id: "order", label: t("Lines"), panel: linesPanel },
        { id: "deliveries", label: t("Deliveries"), count: deliveriesCount || undefined, panel: deliveriesPanel },
        ...(billsPanel ? [{ id: "bills", label: t("Invoices"), count: state.bills?.length || undefined, panel: billsPanel }] : []),
        { id: "history", label: t("History"), panel: <RecordHistory workspaceId={api.workspaceId} recordType="purchase_order" recordId={orderId} /> },
      ]} />
    </div>}
    {dialog === "cancel" || dialog === "change" || dialog === "return" || dialog === "close" ? <ReasonDialog kind={dialog} optional={dialog === "close" && !short} onClose={() => setDialog(null)}
      onSave={async (reason) => { await run(dialog === "return" ? "return" : dialog, dialog === "return" ? { note: reason } : { reason }, undefined, true); setDialog(null); }} /> : null}
    {dialog === "receive" ? <ReceiveDialog api={api} orderId={orderId} onClose={() => setDialog(null)} onReceived={(receipt) => { setDialog(null); onChanged(); onReceipt(receipt.receipt.id); }} /> : null}
    {dialog === "send" && state ? <SendDialog email={state.supplier?.email ?? ""} onClose={() => setDialog(null)}
      onSave={async (to, message) => { await run("send", { to, message, ...holdInput }, undefined, true); setDialog(null); }} /> : null}
    {dialog === "confirm" && order && state ? <ConfirmDialog promised={order.promisedDate} reference={order.supplierReference} lines={state.lines} onClose={() => setDialog(null)}
      onSave={async (input) => { await run("confirm", input, undefined, true); setDialog(null); }} /> : null}
    {dialog === "continue" ? <ReasonDialog kind="continue" onClose={() => setDialog(null)} onSave={async (note) => { await run("continue_on_hold", { note }, undefined, true); setDialog(null); }} /> : null}
    {dialog === "funds" ? <ReasonDialog kind="funds" onClose={() => setDialog(null)} onSave={async (reason) => { await run("override_funds", { reason }, undefined, true); setDialog(null); }} /> : null}
    {dialog === "chase" ? <ChaseDialog onClose={() => setDialog(null)} onSave={async (note, promisedDate) => { await run("chase", { note, promisedDate }, undefined, true); setDialog(null); }} /> : null}
    {dialog && typeof dialog === "object" && "waive" in dialog ? <ReasonDialog kind="waive" onClose={() => setDialog(null)}
      onSave={async (reason) => { await run("waive_check", { checkKey: dialog.waive, reason }, undefined, true); setDialog(null); }} /> : null}
    {dialog && typeof dialog === "object" && "shipment" in dialog ? <ShipmentDialog shipment={dialog.shipment} onClose={() => setDialog(null)}
      onSave={async (input) => { await run("track", input, undefined, true); { setDialog(null); setTab("deliveries"); } }} /> : null}
    {offering ? <OfferAlternateDialog line={offering} currency={order?.currency} onClose={() => setOffering(null)}
      onSave={async (input) => { await run("offer_alternate", { lineId: offering.id, ...input }, undefined, true); setOffering(null); }} /> : null}
    {refusing ? <RefuseAlternateDialog onClose={() => setRefusing(null)}
      onSave={async (note) => { await run("decide_alternate", { lineId: refusing.id, decision: "reject", note }, undefined, true); setRefusing(null); }} /> : null}
    {cancelling ? <CancelLineDialog api={api} line={cancelling} left={stillToCome(cancelling)} vendorId={order?.vendorId ?? ""} onClose={() => setCancelling(null)}
      onSave={async (input) => {
        const next = await run("cancel_line", { lineId: cancelling.id, ...input }, undefined, true);
        if (next) { setCancelling(null); if (next.reordered) onOpenOrder?.(next.reordered); }
      }} /> : null}
  </InspectorSheet>;
}
