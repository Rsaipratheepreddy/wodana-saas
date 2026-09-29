"use client";

import { useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Plus, X } from "lucide-react";
import { Button, DateField, FormDialog, IconButton, MoneyField, SelectField, TextInput, VisuallyHidden } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PayablesApi } from "@/lib/payables/client";
import type { BillState, PayablesState, SupplierState } from "@/lib/payables/types";
import { addExact, currencyDecimals, orderTotals, priceLine } from "@/lib/purchasing/amounts";
import { useProjectFormat } from "../project-core/format";
import { plain } from "./finance-labels";
import styles from "./finance.module.css";

const numeric = (value: string) => value.replace(/[^\d.]/g, "");
type LineDraft = {
  key: string; orderLineId: string | null; orderNumber: string | null; projectId: string | null; projectReference: string | null;
  description: string; unit: string; quantity: string; unitPrice: string; taxRate: string;
};

/**
 * Entering a supplier's invoice as it's printed: the supplier, their number and dates, and its lines —
 * taken from an order (what's still to invoice, at the order's price) or typed for charges not on one.
 * It's saved as a draft, or submitted to be matched against the orders and deliveries.
 */
export function BillEditor({ api, vendors, companies, existing, onClose, onSaved }: {
  api: PayablesApi; vendors: PayablesState["vendors"]; companies: PayablesState["companies"]; existing?: BillState; onClose: () => void; onSaved: (id: string) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const [id] = useState(() => existing?.bill.id ?? crypto.randomUUID());
  const [vendorId, setVendorId] = useState(existing?.bill.vendorId ?? "");
  const [legalEntityId, setLegalEntityId] = useState(existing?.bill.legalEntityId ?? (companies.length === 1 ? companies[0].id : ""));
  const [currency, setCurrency] = useState(existing?.bill.currency ?? (companies.length === 1 ? companies[0].currency : ""));
  const [number, setNumber] = useState(existing?.bill.number ?? "");
  const [invoiceDate, setInvoiceDate] = useState<string | null>(existing?.bill.invoiceDate ?? format.today());
  const [dueDate, setDueDate] = useState<string | null>(existing?.bill.dueDate ?? null);
  const [statedTotal, setStatedTotal] = useState(existing?.bill.statedTotal ? plain(existing.bill.statedTotal) : "");
  const [lines, setLines] = useState<LineDraft[]>(() => (existing?.lines ?? []).map((line) => ({
    key: line.id, orderLineId: line.orderLineId, orderNumber: line.orderNumber, projectId: line.projectId, projectReference: line.projectReference,
    description: line.description, unit: line.unit ?? "", quantity: plain(line.quantity), unitPrice: plain(line.unitPrice), taxRate: plain(line.taxRate),
  })));
  const [supplier, setSupplier] = useState<SupplierState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);

  useEffect(() => {
    if (!vendorId) return;
    let live = true;
    api.supplier(vendorId).then((next) => { if (live) setSupplier(next); }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : t("Could not load.")); });
    return () => { live = false; };
  }, [api, vendorId, t]);

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
        projectReference: line.projectReference, description: line.description, unit: line.unit, quantity: line.left, unitPrice: line.netUnitPrice, taxRate: plain(line.taxRate) }))]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not load.")); }
  };
  // A charge not on an order goes to the project the invoice's order lines share, if they share one.
  const projects = [...new Set(lines.filter((line) => line.orderLineId).map((line) => line.projectId))];
  const sharedProject = projects.length === 1 ? lines.find((line) => line.orderLineId)! : null;
  const addCharge = () => setLines([...lines, { key: crypto.randomUUID(), orderLineId: null, orderNumber: null, projectId: sharedProject?.projectId ?? null,
    projectReference: sharedProject?.projectReference ?? null, description: "", unit: "", quantity: "1", unitPrice: "", taxRate: lines[0]?.taxRate ?? "0" }]);
  const setLine = (key: string, patch: Partial<LineDraft>) => setLines(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const decimals = currencyDecimals(currency || "USD");
  const priced = useMemo(() => lines.map((line) => priceLine({ ...line, discountPercent: "0" }, decimals)), [lines, decimals]);
  const totals = orderTotals(priced, decimals);
  const money = (value: string) => (currency ? format.money(value, currency) : value);
  const ready = Boolean(vendorId && legalEntityId && /^[A-Z]{3}$/.test(currency) && number.trim() && invoiceDate && lines.length && priced.every(Boolean)
    && lines.every((line) => line.orderLineId || line.description.trim()));

  const persist = async (submit: boolean) => {
    let state = await api.billCommand("save", { id, version: existing?.bill.version, vendorId, legalEntityId, currency, number: number.trim(), invoiceDate, dueDate,
      statedTotal: statedTotal || null, lines: lines.map((line) => ({ orderLineId: line.orderLineId, projectId: line.orderLineId ? null : line.projectId, description: line.description,
        quantity: line.quantity, unitPrice: line.unitPrice, taxRate: line.taxRate || "0" })) });
    if (submit) state = await api.billCommand("submit", { id, version: state.bill.version });
    onSaved(state.bill.id);
  };
  const saveDraft = async () => {
    setBusy("save"); setError("");
    try { await persist(false); } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(null); }
  };

  return <FormDialog size="lg" title={existing ? t("Edit invoice") : t("Enter invoice")} onClose={onClose} error={error || undefined} isDirty={Boolean(number.trim() || lines.length)}
    isSubmitting={busy === "save"} isSubmitDisabled={!ready} submitLabel={t("Submit")} onSubmit={() => { setError(""); return persist(true); }}
    secondaryAction={<Button isLoading={busy === "save"} isDisabled={!ready || Boolean(busy)} onPress={() => void saveDraft()}>{t("Save draft")}</Button>}>
      <div className={styles.pair}>
        <SelectField label={t("Supplier")} isRequired placeholder={t("Choose")} selectedKey={vendorId || null} isDisabled={fromOrders}
          onSelectionChange={(key) => { setVendorId(key ? String(key) : ""); setSupplier(null); }} items={vendors.map((vendor) => ({ id: vendor.id, label: vendor.name }))} />
        <TextInput label={t("Invoice number")} isRequired maxLength={80} value={number} onChange={setNumber} />
      </div>
      <div className={styles.trio}>
        <DateField label={t("Invoice date")} isRequired value={invoiceDate ? parseDate(invoiceDate) : null} onChange={(value) => setInvoiceDate(value ? value.toString() : null)} />
        <DateField label={t("Due date")} description={t("Empty: from the credit days")} value={dueDate ? parseDate(dueDate) : null} onChange={(value) => setDueDate(value ? value.toString() : null)} />
        <MoneyField label={t("Total on the invoice")} currency={currency || undefined} value={statedTotal} onChange={setStatedTotal} />
      </div>
      {!fromOrders ? <div className={styles.pair}>
        <SelectField label={t("Company")} isRequired placeholder={t("Choose")} selectedKey={legalEntityId || null}
          onSelectionChange={(key) => { const company = companies.find((item) => item.id === key); setLegalEntityId(company?.id ?? ""); if (company && !currency) setCurrency(company.currency); }}
          items={companies.map((company) => ({ id: company.id, label: company.name }))} />
        <TextInput label={t("Currency")} isRequired value={currency} maxLength={3} onChange={(value) => setCurrency(value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))} />
      </div> : null}
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
      </div> : null}
      <div><Button size="compact" variant="quiet" isDisabled={!vendorId} onPress={addCharge}><Plus aria-hidden="true" size={14} />{t("Add a charge not on an order")}</Button></div>
      {lines.length ? <dl className={styles.totals}>
        <div><dt>{t("Net")}</dt><dd>{money(totals.net)}</dd></div>
        <div><dt>{t("Tax")}</dt><dd>{money(totals.tax)}</dd></div>
        <div><dt>{t("Total")}</dt><dd><strong>{money(totals.total)}</strong></dd></div>
        {statedTotal && addExact(statedTotal) !== addExact(totals.total) ? <div><dt /><dd className={styles.lateText}>{t("The invoice says {amount}", { amount: money(statedTotal) })}</dd></div> : null}
      </dl> : null}
  </FormDialog>;
}
