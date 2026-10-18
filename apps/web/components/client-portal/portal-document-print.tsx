"use client";

import { DocumentTable } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PortalInvoiceDocument, PortalReceiptDocument, PortalSite } from "@/lib/client-portal/types";
import { DEFAULT_INVOICE_LAYOUT } from "@/lib/setup/documents";
import { isolate, usePortalFormat } from "./portal-format";
import { StateLabel } from "./portal-labels";
import own from "./portal-document-print.module.css";
import { DocumentTotals, PrintDocument } from "../documents/print-document";

type Document = { kind: "invoice"; invoice: PortalInvoiceDocument } | { kind: "receipt"; receipt: PortalReceiptDocument };

/** A trailing country code in a stored address ("…, AE") reads as the country's name. */
function place(address: string | null | undefined, locale: string) {
  if (!address) return "";
  return address.replace(/(^|,\s*)([A-Z]{2})$/, (match, lead: string, code: string) => {
    try { return `${lead}${new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code}`; } catch { return match; }
  });
}

/** A tax invoice or a receipt of the client's, on its own page to print or save as PDF, in the tenant's name. */
export function PortalDocumentPrint({ site, document }: { site: PortalSite; document: Document }) {
  const t = useT();
  const format = usePortalFormat(site.region);
  const brand = { name: site.brand.name, logoUrl: site.brand.logoUrl };
  if (document.kind === "receipt") {
    const receipt = document.receipt;
    return <PrintDocument kind={t("Payment receipt")} label={t("Payment receipt")} letterhead={receipt.letterhead} brand={brand}
      fileName={[t("Receipt"), receipt.invoiceNumber, receipt.customer]}
      facts={[{ label: t("Received on"), value: format.date(receipt.receivedOn) }, { label: t("Invoice"), value: receipt.invoiceNumber ? isolate(receipt.invoiceNumber) : "" }]}
      parties={[{ label: t("From"), name: receipt.company }, { label: t("Received from"), name: receipt.customer || "—" }]}>
      <dl className={own.facts}><div><dt>{t("For")}</dt><dd dir="auto">{receipt.milestone}</dd></div></dl>
      <DocumentTotals label={t("Totals")} rows={[{ key: "received", label: t("Amount received"), value: format.money(receipt.amount, receipt.currency), emphasis: true }]} />
    </PrintDocument>;
  }
  return <InvoicePrint invoice={document.invoice} brand={brand} format={format} />;
}

/**
 * A tax invoice on its page, laid out as the firm set it in Setup (title, which blocks show, its own wording for how
 * to pay, terms and the footer). The amounts are always as issued. Setup's preview shows exactly this.
 */
export function InvoicePrint({ invoice, brand, format, preview = false }: { invoice: PortalInvoiceDocument; brand: { name: string; logoUrl?: string | null }; format: ReturnType<typeof usePortalFormat>;
  preview?: boolean }) {
  const t = useT();
  const layout = invoice.layout ?? DEFAULT_INVOICE_LAYOUT;
  const title = layout.title === DEFAULT_INVOICE_LAYOUT.title ? t("Tax invoice") : layout.title;
  const money = (value: string) => format.money(value, invoice.currency);
  const taxName = invoice.letterhead?.taxName ?? t("Tax");
  const taxNumber = (value: string | null | undefined) => (value ? `${invoice.letterhead?.taxLabel ?? t("Tax number")} ${isolate(value)}` : null);
  return <PrintDocument kind={title} number={invoice.number} state={<StateLabel state={invoice.status} />} letterhead={invoice.letterhead} brand={brand} preview={preview}
    label={`${title} ${invoice.number}`} fileName={[invoice.number, invoice.customer.name]}
    facts={[{ label: t("Invoice date"), value: format.date(invoice.issueDate) }, { label: t("Due"), value: format.date(invoice.dueDate) },
      { label: t("For"), value: [invoice.milestone, layout.reference && invoice.reference ? isolate(invoice.reference) : ""].filter(Boolean).join(" · ") }]}
    parties={[
      { label: t("From"), name: invoice.company.name, lines: [place(invoice.company.address, format.locale), taxNumber(invoice.company.taxNumber)] },
      { label: t("Bill to"), name: invoice.customer.name, lines: [place(invoice.customer.address, format.locale), taxNumber(invoice.customer.taxNumber)] },
    ]}>
    <DocumentTable label={t("Lines")} rows={invoice.lines} getRowKey={(_line, index) => String(index)}
      columns={[
        { id: "description", header: t("Description"), cell: (line) => <span dir="auto">{line.description}</span> },
        ...(layout.lineTax ? [{ id: "rate", header: t("{tax} rate", { tax: taxName }), align: "end" as const, cell: (line: PortalInvoiceDocument["lines"][number]) => `${format.number(line.taxRate)}%` }] : []),
        { id: "net", header: t("Net"), align: "end", cell: (line) => money(line.net) },
        ...(layout.lineTax ? [{ id: "tax", header: taxName, align: "end" as const, cell: (line: PortalInvoiceDocument["lines"][number]) => money(line.tax) }] : []),
        { id: "total", header: t("Total"), align: "end", cell: (line) => money(line.total) },
      ]} />
    <DocumentTotals label={t("Totals")} rows={[
      { key: "net", label: t("Net"), value: money(invoice.net) },
      { key: "tax", label: taxName, value: money(invoice.tax) },
      { key: "total", label: t("Total"), value: money(invoice.total), emphasis: invoice.status === "credited" || !layout.balance },
      ...(invoice.status !== "credited" && layout.balance ? [{ key: "paid", label: t("Paid"), value: money(invoice.paid) }, { key: "due", label: t("Left to pay"), value: money(invoice.balance), emphasis: true }] : []),
    ]} />
    {invoice.credit || invoice.note || layout.payment || layout.terms || layout.footer ? <footer className={own.notes}>
      {invoice.credit ? <p>{t("Credited by {note} on {date}", { note: isolate(invoice.credit.number), date: format.date(invoice.credit.on) })}</p> : null}
      {invoice.note ? <p dir="auto">{invoice.note}</p> : null}
      {layout.payment ? <section><h3 className={own.noteTitle}>{t("How to pay")}</h3><p dir="auto">{layout.payment}</p></section> : null}
      {layout.terms ? <section><h3 className={own.noteTitle}>{t("Terms")}</h3><p dir="auto">{layout.terms}</p></section> : null}
      {layout.footer ? <p className={own.footerLine} dir="auto">{layout.footer}</p> : null}
    </footer> : null}
  </PrintDocument>;
}
