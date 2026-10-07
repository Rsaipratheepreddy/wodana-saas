"use client";

import { useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Plus, X } from "lucide-react";
import { Button, DateField, FormDialog, FormRow, FormSection, IconButton, InlineNotice, MoneyField, SelectField, TextInput, VisuallyHidden } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { captureApi, defaultTaxCode, usableCoding, type BillCoding, type CaptureState } from "@/lib/books/capture-client";
import type { PayablesApi } from "@/lib/payables/client";
import type { BillState, PayablesState, SupplierState } from "@/lib/payables/types";
import { addExact, currencyDecimals, orderTotals, priceLine } from "@/lib/purchasing/amounts";
import { BillLineCoding } from "../books/capture/bill-line-coding";
import { CaptureReview, captureHint } from "../books/capture/capture-review";
import { FromPhotoButton } from "../books/capture/from-photo";
import { useProjectFormat } from "../project-core/format";
import { plain } from "./finance-labels";
import styles from "./finance.module.css";

const numeric = (value: string) => value.replace(/[^\d.]/g, "");
type LineDraft = {
  key: string; orderLineId: string | null; orderNumber: string | null; projectId: string | null; projectReference: string | null;
  description: string; unit: string; quantity: string; unitPrice: string; taxRate: string;
  /** The Ledger's tax code and account; `taxAuto` while the code still follows the rate. */
  taxCode: string | null; taxAuto: boolean; booksAccountId: string | null;
};
type Seed = { vendorId: string; number: string; invoiceDate: string | null; dueDate: string | null; currency: string; statedTotal: string };

const fromBill = (state: BillState): LineDraft[] => state.lines.map((line) => ({
  key: line.id, orderLineId: line.orderLineId, orderNumber: line.orderNumber, projectId: line.projectId, projectReference: line.projectReference,
  description: line.description, unit: line.unit ?? "", quantity: plain(line.quantity), unitPrice: plain(line.unitPrice), taxRate: plain(line.taxRate),
  taxCode: line.taxCode ?? null, taxAuto: !line.taxCode, booksAccountId: line.booksAccountId ?? null,
}));
const fromCapture = (state: CaptureState): LineDraft[] => (state.proposal?.lines ?? []).map((line) => ({
  key: crypto.randomUUID(), orderLineId: line.orderLineId, orderNumber: line.orderNumber, projectId: line.projectId, projectReference: line.projectReference,
  description: line.description, unit: line.unit, quantity: plain(line.quantity), unitPrice: line.unitPrice === null ? "" : plain(line.unitPrice), taxRate: plain(line.taxRate),
  taxCode: line.taxCode, taxAuto: true, booksAccountId: null,
}));

/**
 * Entering a supplier's invoice as it's printed: the supplier, their number and dates, and its lines —
 * taken from an order (what's still to invoice, at the order's price) or typed for charges not on one, each
 * with its tax treatment and account when the company keeps its books in Wodana. It can start from a photo of
 * the bill: Woddy reads it into the fields, the original stays beside them, and the person checks and saves.
 * It's saved as a draft, or submitted to be matched against the orders and deliveries.
 */
export function BillEditor({ api, vendors, companies, existing, capture, onClose, onSaved }: {
  api: PayablesApi; vendors: PayablesState["vendors"]; companies: PayablesState["companies"]; existing?: BillState;
  /** A bill read from a photo: its draft (as `existing`, when Woddy entered one) or what it proposes. */
  capture?: CaptureState | null;
  onClose: () => void; onSaved: (id: string) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const captures = useMemo(() => (api.workspaceId ? captureApi(api.workspaceId) : null), [api.workspaceId]);
  const proposal = existing ? null : capture?.proposal ?? null;
  const [current, setCurrent] = useState<BillState | undefined>(existing);
  const [captured, setCaptured] = useState<CaptureState | null>(capture ?? null);
  const [id, setId] = useState(() => existing?.bill.id ?? crypto.randomUUID());
  const [vendorId, setVendorId] = useState(existing?.bill.vendorId ?? proposal?.vendorId ?? "");
  const initialCompany = existing?.bill.legalEntityId ?? proposal?.legalEntityId ?? (companies.length === 1 ? companies[0].id : "");
  const [legalEntityId, setLegalEntityId] = useState(initialCompany);
  const [currency, setCurrency] = useState(existing?.bill.currency ?? proposal?.currency ?? companies.find((company) => company.id === initialCompany)?.currency ?? "");
  const [number, setNumber] = useState(existing?.bill.number ?? proposal?.number ?? "");
  const [invoiceDate, setInvoiceDate] = useState<string | null>(existing?.bill.invoiceDate ?? (proposal ? proposal.invoiceDate : format.today()));
  const [dueDate, setDueDate] = useState<string | null>(existing?.bill.dueDate ?? proposal?.dueDate ?? null);
  const [statedTotal, setStatedTotal] = useState(existing?.bill.statedTotal ? plain(existing.bill.statedTotal) : proposal?.statedTotal ? plain(proposal.statedTotal) : "");
  const [lines, setLines] = useState<LineDraft[]>(() => (existing ? fromBill(existing) : capture ? fromCapture(capture) : []));
  // What Woddy put in each field: its hint shows while the field still holds it.
  const [seed, setSeed] = useState<Seed | null>(() => (capture ? { vendorId, number, invoiceDate, dueDate, currency, statedTotal } : null));
  const [supplier, setSupplier] = useState<SupplierState | null>(null);
  const [coding, setCoding] = useState<BillCoding | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);

  useEffect(() => {
    if (!vendorId) return;
    let live = true;
    api.supplier(vendorId).then((next) => { if (live) setSupplier(next); }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : t("Could not load.")); });
    return () => { live = false; };
  }, [api, vendorId, t]);

  // The company's tax codes and accounts, when it keeps its books in Wodana.
  useEffect(() => {
    if (!captures || !legalEntityId) { setCoding(null); return; }
    let live = true;
    captures.coding(legalEntityId, invoiceDate).then((next) => { if (live) setCoding(usableCoding(next)); }).catch(() => { if (live) setCoding(null); });
    return () => { live = false; };
  }, [captures, legalEntityId, invoiceDate]);

  // A line without a chosen code takes the standard code at its rate.
  useEffect(() => {
    if (!coding?.taxCodes.length) return;
    setLines((all) => {
      const next = all.map((line) => (line.taxAuto ? { ...line, taxCode: defaultTaxCode(line.taxRate, coding.taxCodes) } : line));
      return next.some((line, index) => line.taxCode !== all[index].taxCode) ? next : all;
    });
  }, [coding]);

  /** A photo read while entering: Woddy's draft (when it entered one) or what it read, into the fields. */
  const applyCapture = async (state: CaptureState) => {
    setCaptured(state); setError("");
    if (state.capture.billId) {
      try {
        const draft = await api.bill(state.capture.billId);
        setCurrent(draft); setId(draft.bill.id); setVendorId(draft.bill.vendorId); setLegalEntityId(draft.bill.legalEntityId); setCurrency(draft.bill.currency);
        setNumber(draft.bill.number); setInvoiceDate(draft.bill.invoiceDate); setDueDate(draft.bill.dueDate); setStatedTotal(draft.bill.statedTotal ? plain(draft.bill.statedTotal) : "");
        setLines(fromBill(draft));
        setSeed({ vendorId: draft.bill.vendorId, number: draft.bill.number, invoiceDate: draft.bill.invoiceDate, dueDate: draft.bill.dueDate, currency: draft.bill.currency,
          statedTotal: draft.bill.statedTotal ? plain(draft.bill.statedTotal) : "" });
      } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load.")); }
      return;
    }
    const found = state.proposal;
    if (!found) return;
    const next: Seed = { vendorId: found.vendorId ?? vendorId, number: found.number ?? number, invoiceDate: found.invoiceDate ?? invoiceDate, dueDate: found.dueDate ?? dueDate,
      currency: found.currency ?? currency, statedTotal: found.statedTotal ? plain(found.statedTotal) : statedTotal };
    if (found.vendorId && found.vendorId !== vendorId) { setVendorId(found.vendorId); setSupplier(null); }
    if (found.legalEntityId) setLegalEntityId(found.legalEntityId);
    setCurrency(next.currency); setNumber(next.number); setInvoiceDate(next.invoiceDate); setDueDate(next.dueDate); setStatedTotal(next.statedTotal);
    if (found.lines.length) setLines(fromCapture(state));
    setSeed(next);
  };
  const hint = (field: Parameters<typeof captureHint>[2], untouched: boolean) => captureHint(t, captured, field, Boolean(seed) && untouched);

  const fromOrders = lines.some((line) => line.orderLineId);
  // Orders of this supplier that fit the invoice: the same company and currency once a line is on it.
  const orders = (supplier?.orders ?? []).filter((order) => !fromOrders || (order.legalEntityId === legalEntityId && order.currency === currency));
  const addOrder = async (orderId: string) => {
    setError("");
    try {
      const { order, lines: open } = await api.invoiceable(orderId);
      const taken = new Set(lines.map((line) => line.orderLineId));
      const fresh = open.filter((line) => Number(line.left) > 0 && !taken.has(line.orderLineId));
      // Only accepted goods are invoiced: goods still waiting for inspection say so, rather than "nothing left".
      const awaitingInspection = open.some((line) => !taken.has(line.orderLineId) && Number(line.accepted) < Number(line.ordered));
      if (!fresh.length) { setError(awaitingInspection ? t("Nothing on {order} can be invoiced until its delivery is inspected and accepted.", { order: order.number }) : t("Nothing on {order} is left to invoice.", { order: order.number })); return; }
      if (!lines.length) { setLegalEntityId(order.legalEntityId); setCurrency(order.currency); }
      setLines([...lines, ...fresh.map((line) => ({ key: crypto.randomUUID(), orderLineId: line.orderLineId, orderNumber: line.orderNumber, projectId: line.projectId,
        projectReference: line.projectReference, description: line.description, unit: line.unit, quantity: line.left, unitPrice: line.netUnitPrice, taxRate: plain(line.taxRate),
        taxCode: coding ? defaultTaxCode(plain(line.taxRate), coding.taxCodes) : null, taxAuto: true, booksAccountId: null }))]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load.")); }
  };
  // A charge not on an order goes to the project the invoice's order lines share, if they share one.
  const projects = [...new Set(lines.filter((line) => line.orderLineId).map((line) => line.projectId))];
  const sharedProject = projects.length === 1 ? lines.find((line) => line.orderLineId)! : null;
  const addCharge = () => {
    const taxRate = lines[0]?.taxRate ?? "0";
    setLines([...lines, { key: crypto.randomUUID(), orderLineId: null, orderNumber: null, projectId: sharedProject?.projectId ?? null, projectReference: sharedProject?.projectReference ?? null,
      description: "", unit: "", quantity: "1", unitPrice: "", taxRate, taxCode: coding ? defaultTaxCode(taxRate, coding.taxCodes) : null, taxAuto: true, booksAccountId: null }]);
  };
  const setLine = (key: string, patch: Partial<LineDraft>) => setLines(lines.map((line) => {
    if (line.key !== key) return line;
    const next = { ...line, ...patch };
    // The rate changed and the code still follows it: the code follows again.
    if (patch.taxRate !== undefined && next.taxAuto && coding) next.taxCode = defaultTaxCode(next.taxRate, coding.taxCodes);
    return next;
  }));
  const decimals = currencyDecimals(currency || "USD");
  const priced = useMemo(() => lines.map((line) => priceLine({ ...line, discountPercent: "0" }, decimals)), [lines, decimals]);
  const totals = orderTotals(priced, decimals);
  const money = (value: string) => (currency ? format.money(value, currency) : value);
  const ready = Boolean(vendorId && legalEntityId && /^[A-Z]{3}$/.test(currency) && number.trim() && invoiceDate && lines.length && priced.every(Boolean)
    && lines.every((line) => line.orderLineId || line.description.trim()));

  const persist = async (submit: boolean) => {
    let state = await api.billCommand("save", { id, version: current?.bill.version, vendorId, legalEntityId, currency, number: number.trim(), invoiceDate, dueDate,
      statedTotal: statedTotal || null, lines: lines.map((line) => ({ orderLineId: line.orderLineId, projectId: line.orderLineId ? null : line.projectId, description: line.description,
        quantity: line.quantity, unitPrice: line.unitPrice, taxRate: line.taxRate || "0", taxCode: line.taxCode, booksAccountId: line.booksAccountId })) });
    // The photo it was read from becomes the invoice's document.
    // The invoice is saved either way; without the link it simply has no document yet.
    if (captures && captured && !captured.capture.confirmedAt && ["read", "drafted", "failed"].includes(captured.capture.status)) {
      const confirmed = await captures.confirm(captured.capture.id, captured.capture.version, state.bill.id).catch(() => null);
      if (confirmed) { setCaptured(confirmed); state = await api.bill(state.bill.id); }
    }
    if (submit) state = await api.billCommand("submit", { id, version: state.bill.version });
    onSaved(state.bill.id);
  };
  const saveDraft = async () => {
    setBusy("save"); setError("");
    try { await persist(false); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(null); }
  };

  const vendorHint = captured?.proposal && !captured.proposal.vendorId && !vendorId ? t("Woddy read {name}. Choose the supplier.", { name: captured.reading?.supplierName ?? "—" })
    : hint("supplierName", vendorId === seed?.vendorId);
  return <FormDialog size={captured ? "xl" : "lg"} title={current ? t("Edit invoice") : t("Enter invoice")} onClose={onClose} error={error || undefined}
    isDirty={Boolean(number.trim() || lines.length)} isSubmitting={busy === "save"} isSubmitDisabled={!ready} submitLabel={t("Submit")} onSubmit={() => { setError(""); return persist(true); }}
    secondaryAction={<Button isLoading={busy === "save"} isDisabled={!ready || Boolean(busy)} onPress={() => void saveDraft()}>{t("Save draft")}</Button>}
    lead={captured && captures ? <CaptureReview fileUrl={captures.fileUrl(captured.capture.id)} state={captured} /> : null}>
      <FormSection title={t("Invoice")}>
        {captures && !current && !captured ? <div><FromPhotoButton api={captures} onCaptured={(state) => void applyCapture(state)} onError={setError} variant="quiet" /></div> : null}
        <SelectField label={t("Supplier")} isRequired placeholder={t("Choose")} selectedKey={vendorId || null} isDisabled={fromOrders} description={vendorHint}
          onSelectionChange={(key) => { setVendorId(key ? String(key) : ""); setSupplier(null); }} items={vendors.map((vendor) => ({ id: vendor.id, label: vendor.name }))} />
        {!fromOrders ? <>
          <SelectField label={t("Company")} isRequired placeholder={t("Choose")} selectedKey={legalEntityId || null}
            onSelectionChange={(key) => { const company = companies.find((item) => item.id === key); setLegalEntityId(company?.id ?? ""); if (company && !currency) setCurrency(company.currency); }}
            items={companies.map((company) => ({ id: company.id, label: company.name }))} />
          <TextInput label={t("Currency")} isRequired value={currency} maxLength={3} description={hint("currency", currency === seed?.currency)}
            onChange={(value) => setCurrency(value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))} />
        </> : null}
        <TextInput label={t("Invoice number")} isRequired maxLength={80} value={number} onChange={setNumber} description={hint("invoiceNumber", number === seed?.number)} />
        <FormRow>
          <DateField label={t("Invoice date")} isRequired value={invoiceDate ? parseDate(invoiceDate) : null} onChange={(value) => setInvoiceDate(value ? value.toString() : null)}
            description={hint("invoiceDate", invoiceDate === seed?.invoiceDate)} />
          <DateField label={t("Due date")} value={dueDate ? parseDate(dueDate) : null} onChange={(value) => setDueDate(value ? value.toString() : null)}
            description={hint("dueDate", dueDate === seed?.dueDate)} />
        </FormRow>
      </FormSection>
      <FormSection title={t("Lines")}>
      {vendorId && orders.length ? <SelectField label={t("Add lines from an order")} placeholder={t("Choose an order")} selectedKey={null}
        onSelectionChange={(key) => { if (key) void addOrder(String(key)); }} items={orders.map((order) => ({ id: order.id, label: `${order.number} · ${format.money(order.total, order.currency)}` }))} /> : null}
      {lines.length ? <div className={styles.lines} role="table" aria-label={t("Lines")}>
        <div role="row" className={styles.lineHead}><span role="columnheader">{t("Item")}</span><span role="columnheader">{t("Quantity")}</span>
          <span role="columnheader">{t("Price")}</span><span role="columnheader">{t("Tax %")}</span><span role="columnheader">{t("Total")}</span><span /></div>
        {lines.map((line, index) => <div role="row" key={line.key} className={styles.line}>
          <span role="cell" className={styles.nameCell}>
            {line.orderLineId ? <span>{line.description}</span>
              : <TextInput aria-label={t("What")} label={null} placeholder={t("Delivery, installation…")} value={line.description} onChange={(description) => setLine(line.key, { description })} />}
            <small>{[line.orderNumber, line.projectReference].filter(Boolean).join(" · ")}</small>
            {coding ? <BillLineCoding booksAccountId={line.booksAccountId} coding={coding} item={line.description || t("line")} taxCode={line.taxCode}
              onChange={(patch) => setLine(line.key, { ...patch, ...(patch.taxCode !== undefined ? { taxAuto: false } : {}) })} /> : null}
          </span>
          <span role="cell"><TextInput aria-label={t("Quantity for {item}", { item: line.description })} label={null} inputMode="decimal" suffix={line.unit || undefined}
            value={line.quantity} onChange={(value) => setLine(line.key, { quantity: numeric(value) })} /></span>
          <span role="cell"><MoneyField label={<VisuallyHidden>{t("Price for {item}", { item: line.description })}</VisuallyHidden>} currency={currency || undefined} value={line.unitPrice}
            onChange={(unitPrice) => setLine(line.key, { unitPrice })} /></span>
          <span role="cell"><TextInput aria-label={t("Tax for {item}", { item: line.description })} label={null} inputMode="decimal" value={line.taxRate}
            onChange={(value) => setLine(line.key, { taxRate: numeric(value) })} /></span>
          <span role="cell" className={styles.money}>{priced[index] ? money(priced[index]!.total) : "—"}</span>
          <span role="cell"><IconButton aria-label={t("Remove {item}", { item: line.description || t("line") })} size="compact" variant="quiet"
            onPress={() => setLines(lines.filter((item) => item.key !== line.key))}><X aria-hidden="true" size={14} /></IconButton></span>
        </div>)}
      </div> : captured?.proposal && !captured.proposal.lines.length ? <InlineNotice message={t("Woddy couldn't read the lines. Add them from the photo.")} /> : null}
      <div><Button size="compact" variant="quiet" isDisabled={!vendorId} onPress={addCharge}><Plus aria-hidden="true" size={14} />{t("Add a charge not on an order")}</Button></div>
      <MoneyField label={t("Total on the invoice")} currency={currency || undefined} value={statedTotal} onChange={setStatedTotal} description={hint("total", statedTotal === seed?.statedTotal)} />
      {lines.length ? <dl className={styles.totals}>
        <div><dt>{t("Net")}</dt><dd>{money(totals.net)}</dd></div>
        <div><dt>{t("Tax")}</dt><dd>{money(totals.tax)}</dd></div>
        <div><dt>{t("Total")}</dt><dd><strong>{money(totals.total)}</strong></dd></div>
        {statedTotal && addExact(statedTotal) !== addExact(totals.total) ? <div><dt /><dd className={styles.lateText}>{t("The invoice says {amount}", { amount: money(statedTotal) })}</dd></div> : null}
      </dl> : null}
      </FormSection>
  </FormDialog>;
}
