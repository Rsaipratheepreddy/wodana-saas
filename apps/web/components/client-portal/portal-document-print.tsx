"use client";

import type { ReactNode } from "react";
import { Button, DocumentTable } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PortalInvoiceDocument, PortalReceiptDocument, PortalSite } from "@/lib/client-portal/types";
import styles from "../commercial/quotation-print.module.css";
import { isolate, usePortalFormat } from "./portal-format";
import { StateLabel } from "./portal-labels";
import own from "./portal-document-print.module.css";

type Document = { kind: "invoice"; invoice: PortalInvoiceDocument } | { kind: "receipt"; receipt: PortalReceiptDocument };

/** A trailing country code in a stored address ("…, AE") reads as the country's name. */
function place(address: string | null | undefined, locale: string) {
  if (!address) return "";
  return address.replace(/(^|,\s*)([A-Z]{2})$/, (match, lead: string, code: string) => {
    try { return `${lead}${new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code}`; } catch { return match; }
  });
}

/** A labelled cell in a document's boxed row: a party, a date, a reference. */
function Cell({ label, children }: { label: string; children: ReactNode }) {
  return <div className={own.cell}><dt>{label}</dt><dd>{children}</dd></div>;
}

/** A tax invoice or a receipt of the client's, on its own page to print or save as PDF, in the tenant's name. */
export function PortalDocumentPrint({ site, document }: { site: PortalSite; document: Document }) {
  const t = useT();
  const format = usePortalFormat(site.region);
  const brand = <div className={own.brand}>
    {site.brand.logoUrl
      // eslint-disable-next-line @next/next/no-img-element -- the tenant's own logo
      ? <img alt={site.brand.name} className={own.logo} src={site.brand.logoUrl} /> : <strong>{site.brand.name}</strong>}
  </div>;
  const toolbar = <div className={own.toolbar}><Button variant="primary" onPress={() => window.print()}>{t("Print or save as PDF")}</Button></div>;
  if (document.kind === "receipt") {
    const receipt = document.receipt;
    return <main className={styles.page}>
      {toolbar}
      <article className={own.sheet}>
        <header className={own.header}>{brand}<div className={own.heading}><h1 className={own.title}>{t("Payment receipt")}</h1></div></header>
        <dl className={own.cells} data-columns="2">
          <Cell label={t("From")}><span dir="auto">{receipt.company}</span></Cell>
          <Cell label={t("Received from")}><span dir="auto">{receipt.customer || "—"}</span></Cell>
        </dl>
        <dl className={own.cells} data-columns="3">
          <Cell label={t("Received on")}>{format.date(receipt.receivedOn)}</Cell>
          <Cell label={t("For")}><span dir="auto">{receipt.milestone}</span></Cell>
          <Cell label={t("Invoice")}>{receipt.invoiceNumber ? isolate(receipt.invoiceNumber) : "—"}</Cell>
        </dl>
        <dl className={own.totals}>
          <div data-emphasis="due"><dt>{t("Amount received")}</dt><dd>{format.money(receipt.amount, receipt.currency)}</dd></div>
        </dl>
      </article>
    </main>;
  }
  const invoice = document.invoice;
  const money = (value: string) => format.money(value, invoice.currency);
  const party = (name: string, address: string | null | undefined, taxNumber: string | null | undefined) => <>
    <strong className={own.name} dir="auto">{name}</strong>
    {address ? <span className={own.address} dir="auto">{place(address, format.locale)}</span> : null}
    {taxNumber ? <span className={own.address}>{t("Tax number")} {isolate(taxNumber)}</span> : null}
  </>;
  return <main className={styles.page}>
    {toolbar}
    <article className={own.sheet}>
      <header className={own.header}>
        {brand}
        <div className={own.heading}>
          <h1 className={own.title}>{t("Tax invoice")}</h1>
          <span className={own.number}>{isolate(invoice.number)}</span>
          <StateLabel state={invoice.status} />
        </div>
      </header>
      <dl className={own.cells} data-columns="2">
        <Cell label={t("From")}>{party(invoice.company.name, invoice.company.address, invoice.company.taxNumber)}</Cell>
        <Cell label={t("To")}>{party(invoice.customer.name, invoice.customer.address, invoice.customer.taxNumber)}</Cell>
      </dl>
      <dl className={own.cells} data-columns="3">
        <Cell label={t("Invoice date")}>{format.date(invoice.issueDate)}</Cell>
        <Cell label={t("Due")}>{format.date(invoice.dueDate)}</Cell>
        <Cell label={t("For")}><span dir="auto">{[invoice.milestone, invoice.reference ? isolate(invoice.reference) : ""].filter(Boolean).join(" · ")}</span></Cell>
      </dl>
      <div className={own.lines}>
        <DocumentTable label={t("Lines")} rows={invoice.lines} getRowKey={(_line, index) => String(index)}
          columns={[
            { id: "description", header: t("Description"), cell: (line) => <><span dir="auto">{line.description}</span><small>{t("Tax {rate}%", { rate: format.number(line.taxRate) })}</small></> },
            { id: "net", header: t("Net"), align: "end", cell: (line) => money(line.net) },
            { id: "tax", header: t("Tax"), align: "end", cell: (line) => money(line.tax) },
            { id: "total", header: t("Total"), align: "end", cell: (line) => money(line.total) },
          ]} />
      </div>
      <dl className={own.totals}>
        <div><dt>{t("Net")}</dt><dd>{money(invoice.net)}</dd></div>
        <div><dt>{t("Tax")}</dt><dd>{money(invoice.tax)}</dd></div>
        <div data-emphasis="total"><dt>{t("Total")}</dt><dd>{money(invoice.total)}</dd></div>
        {invoice.status !== "credited" ? <>
          <div><dt>{t("Paid")}</dt><dd>{money(invoice.paid)}</dd></div>
          <div data-emphasis="due"><dt>{t("Left to pay")}</dt><dd>{money(invoice.balance)}</dd></div>
        </> : null}
      </dl>
      {invoice.credit || invoice.note ? <footer className={own.notes}>
        {invoice.credit ? <p>{t("Credited by {note} on {date}", { note: isolate(invoice.credit.number), date: format.date(invoice.credit.on) })}</p> : null}
        {invoice.note ? <p dir="auto">{invoice.note}</p> : null}
      </footer> : null}
    </article>
  </main>;
}
