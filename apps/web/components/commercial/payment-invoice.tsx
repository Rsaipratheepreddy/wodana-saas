"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { Search, RefreshCw, ExternalLink, Check, FileText } from "lucide-react";
import { ControlledModalDialog } from "@/design-system";
import { jsonRequest, money } from "@/lib/commercial/client";
import type { Payment } from "@/lib/commercial/types";
import s from "./commercial.module.css";
type Connection = {
  id: string;
  displayName: string;
  provider: string;
  status: string;
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
  currency = "AED",
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
            c.status === "connected",
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
      Math.round(i.total * 100) === Math.round(payment.amount * 100) &&
      i.currency === currency,
    visible = invoices
      .filter((i) =>
        `${i.number} ${i.customer} ${i.id}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      )
      .sort((a, b) => Number(matching(b)) - Number(matching(a)));
  return (
    <>
      {payment.invoice?.lastError && (
        <p className={s.error} role="status">
          Refresh needs attention: {payment.invoice.lastError}
        </p>
      )}
      <div className={s.actions}>
        {payment.invoice && (
          <span className={s.detail}>
            <strong>
              {payment.invoice.provider === "zoho_books"
                ? "Zoho Books"
                : "QuickBooks"}{" "}
              · {payment.invoice.number || payment.invoice.id}
            </strong>
            <small className={s.detail}>
              Balance {money(payment.invoice.balance, payment.invoice.currency)}{" "}
              · Checked {new Date(payment.invoice.refreshedAt).toLocaleString()}
            </small>
          </span>
        )}
        {canVerifyFinance && (
          <button
            className={s.button}
            disabled={busy}
            onClick={() =>
              payment.invoice?.accountId
                ? void run("invoice", {
                    paymentId: payment.id,
                    connectionId: payment.invoice.connectionId,
                    invoiceId: payment.invoice.id,
                  })
                : void show()
            }
          >
            {payment.invoice ? <RefreshCw size={13} /> : <FileText size={14} />}{" "}
            {payment.invoice ? "Refresh invoice" : "Connect invoice"}
          </button>
        )}
        {payment.invoice?.paymentUrl && (
          <a
            href={payment.invoice.paymentUrl}
            target="_blank"
            rel="noreferrer"
            className={s.button}
          >
            Open payment link <ExternalLink size={13} />
          </a>
        )}
      </div>
      <ControlledModalDialog
        size="lg"
        isOpen={open}
        onOpenChange={(value) => {
          if (!value) requestSequence.current++;
          setOpen(value);
        }}
        title="Connect accounting invoice"
      >
        <form
          className={s.form}
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await run("invoice", {
                paymentId: payment.id,
                connectionId,
                invoiceId,
                clientConfirmed: checked,
              })
            )
              setOpen(false);
            else
              setError(
                "The invoice could not be connected. Confirm the amount, currency and accounting company, then retry.",
              );
          }}
        >
          <div className={s.invoiceTarget}>
            <div>
              <small>{customerName || "Client milestone"}</small>
              <strong>{payment.title}</strong>
            </div>
            <strong>{money(payment.amount, currency)}</strong>
          </div>
          {error && (
            <p role="alert" className={s.error}>
              {error}
            </p>
          )}
          <label>
            Accounting company
            <select
              required
              value={connectionId}
              onChange={(e) => {
                requestSequence.current++;
                setConnectionId(e.target.value);
                setInvoiceId("");
                setChecked(false);
                setInvoices([]);
                const c = connections.find((c) => c.id === e.target.value);
                if (c) void loadInvoices(c);
              }}
            >
              <option value="">Choose QuickBooks or Zoho Books…</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName} ·{" "}
                  {c.provider === "zoho_books" ? "Zoho Books" : "QuickBooks"}
                </option>
              ))}
            </select>
          </label>
          {!loading && !connections.length && (
            <p className={s.notice}>
              Connect an accounting company in{" "}
              <Link href="/workspace/integrations">Workspace integrations</Link>{" "}
              to load its invoices.
            </p>
          )}
          {connectionId && (
            <>
              <label className={s.invoiceSearch}>
                <Search size={15} />
                <input
                  aria-label="Search accounting invoices"
                  placeholder="Search invoice number or customer…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <div
                className={s.invoiceChoices}
                role="radiogroup"
                aria-label="Accounting invoices"
              >
                {visible.map((i) => (
                  <label
                    key={i.id}
                    className={s.invoiceChoice}
                    data-match={matching(i)}
                  >
                    <input
                      type="radio"
                      name="invoice"
                      value={i.id}
                      checked={invoiceId === i.id}
                      disabled={!matching(i) && !payment.invoice}
                      onChange={() => {
                        setInvoiceId(i.id);
                        setChecked(false);
                      }}
                    />
                    <span>
                      <strong>
                        {i.number || i.id} · {i.customer}
                      </strong>
                      <small>
                        {i.date}
                        {matching(i)
                          ? " · Matches milestone"
                          : " · Amount or currency differs"}
                      </small>
                    </span>
                    <span>
                      <strong>
                        {displayAmount(
                          i.total,
                          /^[A-Z]{3}$/.test(i.currency) ? i.currency : currency,
                        )}
                      </strong>
                      <small>
                        Open{" "}
                        {displayAmount(
                          i.balance,
                          /^[A-Z]{3}$/.test(i.currency) ? i.currency : currency,
                        )}
                      </small>
                    </span>
                    {matching(i) && <Check size={14} />}
                  </label>
                ))}
                {!loading && !visible.length && (
                  <p className={s.muted}>
                    No matching invoices in the loaded pages.
                  </p>
                )}
              </div>
              {loading && (
                <p role="status" className={s.muted}>
                  Loading invoices from your accounting company…
                </p>
              )}
              {hasMore && (
                <button
                  type="button"
                  className={s.button}
                  disabled={loading}
                  onClick={() => {
                    const c = connections.find((c) => c.id === connectionId);
                    if (c) void loadInvoices(c, page + 1);
                  }}
                >
                  Load more invoices
                </button>
              )}
              <button
                type="button"
                className={s.linkButton}
                onClick={() => setManual(!manual)}
              >
                {manual ? "Hide invoice ID entry" : "Find by invoice ID"}
              </button>
              {manual && (
                <label>
                  Invoice ID
                  <input
                    required
                    value={invoiceId}
                    onChange={(e) => {
                      setInvoiceId(e.target.value);
                      setChecked(false);
                    }}
                    placeholder="Invoice identifier from the accounting company"
                  />
                </label>
              )}
              <p className={s.muted}>
                The invoice total must equal this milestone in {currency}. The
                provider supplies its outstanding balance and payment link.
              </p>
            </>
          )}
          {invoiceId && (
            <label className={s.check}>
              <input
                type="checkbox"
                required
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              I checked that {selected?.number || "this invoice"} belongs to{" "}
              {customerName || "this client"} and this milestone.
            </label>
          )}
          <div className={s.actions}>
            <button
              className={s.primary}
              disabled={
                busy || loading || !checked || !invoiceId || !connectionId
              }
            >
              Verify & connect invoice
            </button>
            <Link href="/workspace/integrations" className={s.button}>
              Accounting connections <ExternalLink size={13} />
            </Link>
          </div>
        </form>
      </ControlledModalDialog>
    </>
  );
}
