"use client";
import { useT } from "@/lib/i18n/i18n-provider";
import { useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, ExternalLink, FileText } from "lucide-react";
import { Button, Checkbox, FormDialog, InlineNotice, MoreDetails, RadioSet, SearchInput, SelectField, Skeleton, TextInput, useDesignSystem } from "@/design-system";
import { toMinor } from "@/lib/money-exact";
import { jsonRequest, money } from "@/lib/commercial/client";
import type { Payment } from "@/lib/commercial/types";
import s from "./commercial.module.css";
type Connection = {
  id: string;
  displayName: string;
  provider: string;
  status: string;
  legalEntityId?: string | null;
};
type InvoiceChoice = {
  id: string;
  number: string;
  customer: string;
  total: number;
  balance: number;
  currency: string;
  date: string;
};
const displayAmount=(value:number,currency:string)=>Number.isFinite(value)?money(value,currency):"Unavailable";
export function normalizeInvoice(
  record: Record<string, unknown>,
  provider: string,
): InvoiceChoice {
  const qb = provider === "quickbooks",
    customer = record.CustomerRef as { name?: string } | undefined,
    currency = record.CurrencyRef as { value?: string } | undefined;
  return {
    id: String(qb ? record.Id : record.invoice_id),
    number: String((qb ? record.DocNumber : record.invoice_number) ?? ""),
    customer: String((qb ? customer?.name : record.customer_name) ?? ""),
    total:
      (qb ? record.TotalAmt : record.total) == null
        ? NaN
        : Number(qb ? record.TotalAmt : record.total),
    balance:
      (qb ? record.Balance : record.balance) == null
        ? NaN
        : Number(qb ? record.Balance : record.balance),
    currency: String((qb ? currency?.value : record.currency_code) ?? ""),
    date: String((qb ? record.TxnDate : record.date) ?? ""),
  };
}
export function PaymentInvoice({
  workspaceId,
  payment,
  busy,
  canVerifyFinance,
  run,
  currency: currencyProp,
  customerName = "",
}: {
  workspaceId: string;
  payment: Payment;
  busy: boolean;
  canVerifyFinance: boolean;
  run: (action: string, body: Record<string, unknown>) => Promise<boolean>;
  currency?: string;
  customerName?: string;
}) {
  const t = useT();
  const { currency: workspaceCurrency } = useDesignSystem();
  const currency = currencyProp ?? workspaceCurrency;
  const [open, setOpen] = useState(false),
    [connectionId, setConnectionId] = useState(
      payment.invoice?.connectionId ?? "",
    ),
    [invoiceId, setInvoiceId] = useState(payment.invoice?.id ?? ""),
    [checked, setChecked] = useState(false),
    [error, setError] = useState(""),
    [connections, setConnections] = useState<Connection[]>([]),
    [invoices, setInvoices] = useState<InvoiceChoice[]>([]),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(false),
    [hasMore, setHasMore] = useState(false),
    [page, setPage] = useState(1),
    [manual, setManual] = useState(false);
  const requestSequence = useRef(0);
  async function loadInvoices(c: Connection, pageNumber = 1) {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const result = await jsonRequest<{
        items: Record<string, unknown>[];
        hasMore: boolean;
      }>(
        `/api/workspace/integration-connections/${c.id}/tools?workspaceId=${workspaceId}&kind=invoices&page=${pageNumber}`,
      );
      if (sequence !== requestSequence.current) return;
      const rows = result.items
        .map((r) => normalizeInvoice(r, c.provider))
        .filter(
          (r) =>
            /^[a-zA-Z0-9]{1,100}$/.test(r.id) &&
            !["undefined", "null"].includes(r.id),
        );
      setInvoices((prev) =>
        pageNumber === 1
          ? rows
          : [...prev, ...rows.filter((r) => !prev.some((p) => p.id === r.id))],
      );
      setHasMore(result.hasMore);
      setPage(pageNumber);
    } catch (e) {
      if (sequence === requestSequence.current) setError((e as Error).message);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }
  async function show() {
    const sequence = ++requestSequence.current;
    setOpen(true);
    setError("");
    setChecked(false);
    setLoading(true);
    try {
      const rows = await jsonRequest<Connection[]>(
          `/api/workspace/integration-connections?workspaceId=${workspaceId}`,
        ),
        list = rows.filter(
          (c) =>
            ["zoho_books", "quickbooks"].includes(c.provider) &&
            c.status === "connected" &&
            (!payment.legalEntityId || c.legalEntityId === payment.legalEntityId),
        );
      if (sequence !== requestSequence.current) return;
      setConnections(list);
      const selected =
        list.find((c) => c.id === connectionId) ??
        (list.length === 1 ? list[0] : undefined);
      if (selected) {
        setConnectionId(selected.id);
        await loadInvoices(selected);
      } else {
        setInvoices([]);
        setLoading(false);
      }
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }
  const selected = invoices.find((i) => i.id === invoiceId),
    matching = (i: InvoiceChoice) =>
      Number.isFinite(i.total) &&
      Number.isFinite(i.balance) &&
      i.balance >= 0 &&
      i.balance <= i.total &&
      toMinor(i.total, currency) === toMinor(payment.amount, currency) &&
      i.currency === currency,
    visible = invoices
      .filter((i) =>
        `${i.number} ${i.customer} ${i.id}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      )
      .sort((a, b) => Number(matching(b)) - Number(matching(a)));
  const shown = (value: number, code: string) => displayAmount(value, /^[A-Z]{3}$/.test(code) ? code : currency);
  const chooseConnection = (id: string) => {
    requestSequence.current++;
    setConnectionId(id);
    setInvoiceId("");
    setChecked(false);
    setInvoices([]);
    const c = connections.find((c) => c.id === id);
    if (c) void loadInvoices(c);
  };
  const provider = (name: string) => name === "zoho_books" ? "Zoho Books" : "QuickBooks";
  return (
    <>
      {payment.invoice?.lastError && (
        <p className={s.error} role="status">
          {t("Refresh needs attention:")}{" "}{payment.invoice.lastError}
        </p>
      )}
      <div className={s.actions}>
        {payment.invoice && (
          <span className={s.detail}>
            <strong>{provider(payment.invoice.provider)} · {payment.invoice.number || payment.invoice.id}</strong>
            <small className={s.detail}>
              {t("Balance")}{" "}{money(payment.invoice.balance, payment.invoice.currency)}{" "}
              {t("· Checked")}{" "}{new Date(payment.invoice.refreshedAt).toLocaleString()}
            </small>
          </span>
        )}
        {canVerifyFinance && (
          <Button size="compact" isDisabled={busy}
            onPress={() =>
              payment.invoice?.accountId
                ? void run("invoice", { paymentId: payment.id, connectionId: payment.invoice.connectionId, invoiceId: payment.invoice.id })
                : void show()
            }>
            {payment.invoice ? <RefreshCw size={13} /> : <FileText size={14} />}
            {payment.invoice ? t("Refresh invoice") : t("Connect invoice")}
          </Button>
        )}
        {payment.invoice?.paymentUrl && (
          <a className="wd-button" data-size="compact" href={payment.invoice.paymentUrl} rel="noreferrer" target="_blank">
            {t("Open payment link")}<ExternalLink size={13} />
          </a>
        )}
      </div>
      <FormDialog
        size="lg"
        isOpen={open}
        onClose={() => { requestSequence.current++; setOpen(false); }}
        title={t("Connect accounting invoice")}
        submitLabel={t("Verify & connect invoice")}
        isSubmitDisabled={busy || loading || !checked || !invoiceId || !connectionId}
        isSubmitting={busy}
        error={error || undefined}
        closeOnSuccess
        secondaryAction={<Link className="wd-button" data-size="compact" data-variant="quiet" href="/workspace/integrations">{t("Accounting connections")}<ExternalLink size={13} /></Link>}
        lead={<div className={s.invoiceTarget}>
          <div>
            <small>{customerName || t("Client milestone")}</small>
            <strong>{payment.title}</strong>
          </div>
          <strong>{money(payment.amount, currency)}</strong>
        </div>}
        onSubmit={async () => {
          if (!(await run("invoice", { paymentId: payment.id, connectionId, invoiceId, clientConfirmed: checked })))
            throw new Error(t("The invoice could not be connected. Confirm the amount, currency and accounting company, then retry."));
        }}
      >
        <SelectField isRequired label={t("Accounting company")} placeholder={t("Choose QuickBooks or Zoho Books…")}
          items={connections.map((c) => ({ id: c.id, label: `${c.displayName} · ${provider(c.provider)}` }))}
          selectedKey={connectionId || null} onSelectionChange={(key) => chooseConnection(String(key ?? ""))} />
        {!loading && !connections.length && (
          <InlineNotice message={<>{t("Connect an accounting company in")}{" "}<Link href="/workspace/integrations">{t("Workspace integrations")}</Link>{" "}{t("to load its invoices.")}</>} />
        )}
        {connectionId && (
          <>
            <SearchInput label={t("Search accounting invoices")} placeholder={t("Search invoice number or customer…")} value={search} onChange={setSearch} />
            <RadioSet isRequired={!manual} label={t("Accounting invoices")} value={invoiceId || null}
              onChange={(id) => { setInvoiceId(id); setChecked(false); }}
              description={t("The invoice total must equal this milestone in {currency}.", { currency })}
              items={visible.map((i) => ({
                id: i.id,
                isDisabled: !matching(i) && !payment.invoice,
                label: `${i.number || i.id} · ${i.customer}`,
                description: `${i.date} · ${shown(i.total, i.currency)} · ${t("Open")} ${shown(i.balance, i.currency)} · ${matching(i) ? t("Matches milestone") : t("Amount or currency differs")}`,
              }))} />
            {!loading && !visible.length && <p className={s.muted}>{t("No matching invoices in the loaded pages.")}</p>}
            {loading && <Skeleton lines={3} />}
            {hasMore && (
              <Button isDisabled={loading} size="compact" variant="quiet"
                onPress={() => { const c = connections.find((c) => c.id === connectionId); if (c) void loadInvoices(c, page + 1); }}>
                {t("Load more invoices")}
              </Button>
            )}
            <MoreDetails label={t("Find by invoice ID")} isOpen={manual} onOpenChange={setManual}>
              <TextInput isRequired={manual} label={t("Invoice ID")} placeholder={t("Invoice identifier from the accounting company")}
                value={invoiceId} onChange={(value) => { setInvoiceId(value); setChecked(false); }} />
            </MoreDetails>
          </>
        )}
        {invoiceId && (
          <Checkbox isRequired isSelected={checked} onChange={setChecked}>
            {t("I checked that {invoice} belongs to {client} and this milestone.", { invoice: selected?.number || t("this invoice"), client: customerName || t("this client") })}
          </Checkbox>
        )}
      </FormDialog>
    </>
  );
}
