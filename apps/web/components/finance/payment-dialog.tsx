"use client";

import { useEffect, useMemo, useState } from "react";
import { parseDate } from "@internationalized/date";
import { Button, ControlledModalDialog, DateField, InlineNotice, SelectField, Skeleton, TextInput } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PayablesApi } from "@/lib/payables/client";
import type { Bill, PaymentMethod, SupplierState } from "@/lib/payables/types";
import { addExact, subtractExact } from "@/lib/purchasing/amounts";
import { useProjectFormat } from "../project-core/format";
import { plain, useMethodLabels } from "./finance-labels";
import styles from "./finance.module.css";

const numeric = (value: string) => value.replace(/[^\d.]/g, "");
const METHODS: PaymentMethod[] = ["bank", "cheque", "cash", "card", "other"];

/**
 * A payment made to a supplier: when, how much and how, and which approved invoices it pays. Opened from
 * an invoice it pays that invoice; opened from the supplier it can be an advance on an order instead.
 * Whatever isn't put against an invoice stays with the supplier to allocate later.
 */
export function PaymentDialog({ api, vendorId, legalEntityId: fixedCompany, currency: fixedCurrency, forBill, onClose, onSaved }: {
  api: PayablesApi; vendorId: string; legalEntityId?: string; currency?: string; forBill?: Bill; onClose: () => void; onSaved: (paymentId: string) => void;
}) {
  const t = useT();
  const format = useProjectFormat();
  const methods = useMethodLabels();
  const [id] = useState(() => crypto.randomUUID());
  const [supplier, setSupplier] = useState<SupplierState | null>(null);
  const [pair, setPair] = useState(fixedCompany && fixedCurrency ? `${fixedCompany}|${fixedCurrency}` : "");
  const [paidOn, setPaidOn] = useState<string | null>(format.today());
  const [amount, setAmount] = useState(forBill ? plain(forBill.balance) : "");
  const [method, setMethod] = useState<PaymentMethod>("bank");
  const [reference, setReference] = useState("");
  const [orderId, setOrderId] = useState("");
  const [parts, setParts] = useState<Record<string, string>>(forBill ? { [forBill.id]: plain(forBill.balance) } : {});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api.supplier(vendorId).then((next) => { if (live) setSupplier(next); }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : t("Could not load.")); });
    return () => { live = false; };
  }, [api, vendorId, t]);

  // Which company pays and in what currency: from its invoices and orders with this supplier.
  const pairs = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of [...(supplier?.balances ?? []).map((row) => ({ legalEntityId: row.legalEntityId, currency: row.currency, name: row.companyName })),
      ...(supplier?.orders ?? []).map((order) => ({ legalEntityId: order.legalEntityId, currency: order.currency, name: supplier?.balances.find((row) => row.legalEntityId === order.legalEntityId)?.companyName ?? "" }))])
      if (!seen.has(`${item.legalEntityId}|${item.currency}`)) seen.set(`${item.legalEntityId}|${item.currency}`, [item.name, item.currency].filter(Boolean).join(" · "));
    return [...seen].map(([key, label]) => ({ id: key, label }));
  }, [supplier]);
  useEffect(() => { if (!pair && pairs.length === 1) queueMicrotask(() => setPair(pairs[0].id)); }, [pair, pairs]);
  const [legalEntityId, currency] = pair ? pair.split("|") : ["", ""];
  const orders = (supplier?.orders ?? []).filter((order) => order.legalEntityId === legalEntityId && order.currency === currency);
  const orderNumber = orders.find((order) => order.id === orderId)?.number ?? null;
  const open = (supplier?.bills ?? []).filter((bill) => bill.status === "approved" && Number(bill.balance) > 0 && bill.legalEntityId === legalEntityId && bill.currency === currency
    && (!orderNumber || bill.orders.includes(orderNumber)))
    .sort((a, b) => (a.dueDate ?? a.invoiceDate).localeCompare(b.dueDate ?? b.invoiceDate));
  const allocated = addExact(...open.map((bill) => parts[bill.id] || "0"));
  const over = amount && subtractExact(allocated, amount) !== "0";
  const onAccount = amount ? subtractExact(amount, allocated) : "0";
  const money = (value: string) => (currency ? format.money(value, currency) : value);
  /** Puts the amount against the invoices due first, as far as it goes. */
  const spread = () => {
    let left = amount || "0";
    const next: Record<string, string> = {};
    for (const bill of open) {
      if (left === "0") break;
      const part = subtractExact(left, bill.balance) === "0" ? left : plain(bill.balance);
      next[bill.id] = part;
      left = subtractExact(left, part);
    }
    setParts(next);
  };
  const bankMissing = method === "bank" && supplier && !supplier.supplier.bank;
  const ready = Boolean(pair && paidOn && amount && Number(amount) > 0 && !over && !bankMissing);

  return <ControlledModalDialog isOpen size="lg" title={t("Record payment")} description={supplier?.supplier.name} onOpenChange={(value) => { if (!value) onClose(); }}
    footer={<div className="wd-dialog-actions"><Button onPress={onClose}>{t("Cancel")}</Button>
      <Button variant="primary" isLoading={busy} isDisabled={!ready} onPress={async () => {
        setBusy(true); setError("");
        try {
          const saved = await api.paymentCommand("pay", { id, vendorId, legalEntityId, currency, paidOn, amount, method, reference: reference.trim(), orderId: orderId || null,
            allocations: open.filter((bill) => parts[bill.id] && Number(parts[bill.id]) > 0).map((bill) => ({ invoiceId: bill.id, amount: parts[bill.id] })) });
          onSaved(saved.payment.id);
        } catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save.")); setBusy(false); }
      }}>{t("Record payment")}</Button></div>}>
    {!supplier && !error ? <Skeleton lines={6} /> : <div className={styles.dialogBody}>
      {error ? <InlineNotice tone="error" message={error} /> : null}
      {!fixedCompany && pairs.length > 1 ? <SelectField label={t("Paid by")} isRequired placeholder={t("Choose")} selectedKey={pair || null}
        onSelectionChange={(key) => { setPair(key ? String(key) : ""); setOrderId(""); setParts({}); }} items={pairs} /> : null}
      <div className={styles.trio}>
        <DateField label={t("Paid on")} isRequired value={paidOn ? parseDate(paidOn) : null} onChange={(value) => setPaidOn(value ? value.toString() : null)} />
        <TextInput label={t("Amount")} isRequired inputMode="decimal" prefix={currency || undefined} value={amount} onChange={(value) => setAmount(numeric(value))} />
        <SelectField label={t("How")} selectedKey={method} onSelectionChange={(key) => setMethod((key ?? "bank") as PaymentMethod)}
          items={METHODS.map((item) => ({ id: item, label: methods[item] }))} />
      </div>
      {method === "bank" && supplier ? supplier.supplier.bank
        ? <p className={styles.muted}>{t("Into {bank} ending {digits}", { bank: supplier.supplier.bank.bankName, digits: supplier.supplier.bank.last4 })}</p>
        : <InlineNotice tone="error" message={t("This supplier has no approved bank account. Approve their bank details before paying by bank.")} /> : null}
      {method === "bank" && supplier?.supplier.bankChangePending ? <InlineNotice tone="info" message={t("New bank details are waiting for approval. Pay into the approved account.")} /> : null}
      <div className={styles.pair}>
        <TextInput label={t("Reference")} value={reference} onChange={setReference} />
        {!forBill && orders.length ? <SelectField label={t("Advance on an order")} selectedKey={orderId || "none"}
          onSelectionChange={(key) => { setOrderId(key && key !== "none" ? String(key) : ""); setParts({}); }}
          items={[{ id: "none", label: t("None") }, ...orders.map((order) => ({ id: order.id, label: order.number }))]} /> : <span />}
      </div>
      {open.length ? <section className={styles.part} aria-label={t("Invoices it pays")}>
        <div className={styles.headRow}><h3 className={styles.subhead}>{t("Invoices it pays")}</h3><span className={styles.spacer} />
          {amount ? <Button size="compact" variant="quiet" onPress={spread}>{t("Oldest first")}</Button> : null}</div>
        <div className={styles.allocations}>{open.map((bill) => <div key={bill.id} className={styles.allocation}>
          <span className={styles.nameCell}><span>{bill.number}</span>
            <small>{[bill.dueDate ? t("Due {date}", { date: format.day(bill.dueDate) }) : "", t("{amount} left", { amount: money(bill.balance) })].filter(Boolean).join(" · ")}</small></span>
          <TextInput aria-label={t("Amount for {invoice}", { invoice: bill.number })} label={null} inputMode="decimal" value={parts[bill.id] ?? ""}
            onChange={(value) => setParts({ ...parts, [bill.id]: numeric(value) })} />
        </div>)}</div>
        {over ? <InlineNotice tone="error" message={t("That's more than the payment.")} />
          : onAccount !== "0" ? <p className={styles.muted}>{t("{amount} stays with the supplier to allocate later.", { amount: money(onAccount) })}</p> : null}
      </section> : orderId ? <p className={styles.muted}>{t("It goes against the order's invoices when they're approved.")}</p> : null}
    </div>}
  </ControlledModalDialog>;
}
