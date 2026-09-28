"use client";

import { Button } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PortalInvoiceDocument, PortalReceiptDocument, PortalSite } from "@/lib/client-portal/types";
import styles from "../commercial/quotation-print.module.css";
import { isolate, usePortalFormat } from "./portal-format";
import { StateLabel } from "./portal-labels";
import own from "./portal-document-print.module.css";

type Document = { kind: "invoice"; invoice: PortalInvoiceDocument } | { kind: "receipt"; receipt: PortalReceiptDocument };

/** A tax invoice or a receipt of the client's, on its own page to print or save as PDF, in the tenant's name. */
export function PortalDocumentPrint({ site, document }: { site: PortalSite; document: Document }) {
  const t = useT();
  const format = usePortalFormat(site.region);
  const brand = <div className={own.brand}>
    {site.brand.logoUrl
      // eslint-disable-next-line @next/next/no-img-element -- the tenant's own logo
      ? <img alt={site.brand.name} className={own.logo} src={site.brand.logoUrl} /> : <strong>{site.brand.name}</strong>}
  </div>;
  if (document.kind === "receipt") {
    const receipt = document.receipt;
    return <main className={styles.page}>
      <div className={styles.actions}><Button variant="primary" onPress={() => window.print()}>{t("Print or save as PDF")}</Button></div>
      <article className={`${styles.document} ${own.sheet}`}>
        {brand}
        <h1 className={own.title}>{t("Payment receipt")}</h1>
        <dl className={own.facts}>
          <dt>{t("From")}</dt><dd dir="auto">{receipt.company}</dd>
          {receipt.customer ? <><dt>{t("Received from")}</dt><dd dir="auto">{receipt.customer}</dd></> : null}
          <dt>{t("For")}</dt><dd dir="auto">{receipt.milestone}</dd>
          {receipt.invoiceNumber ? <><dt>{t("Invoice")}</dt><dd>{isolate(receipt.invoiceNumber)}</dd></> : null}
          <dt>{t("Received on")}</dt><dd>{format.date(receipt.receivedOn)}</dd>
        </dl>
        <p className={own.total}><span>{t("Amount received")}</span><span>{format.money(receipt.amount, receipt.currency)}</span></p>
      </article>
    </main>;
  }
  const invoice = document.invoice;
  const money = (value: string) => format.money(value, invoice.currency);
  return <main className={styles.page}>
    <div className={styles.actions}><Button variant="primary" onPress={() => window.print()}>{t("Print or save as PDF")}</Button></div>
    <article className={`${styles.document} ${own.sheet}`}>
      {brand}
      <div className={styles.head}><h1 className={own.title}>{t("Tax invoice {number}", { number: isolate(invoice.number) })}</h1><StateLabel state={invoice.status} /></div>
      <div className={own.parties}>
        <dl className={own.facts}><dt>{t("From")}</dt><dd dir="auto">{[invoice.company.name, invoice.company.address].filter(Boolean).join("\n")}</dd>
          {invoice.company.taxNumber ? <><dt>{t("Tax number")}</dt><dd>{isolate(invoice.company.taxNumber)}</dd></> : null}</dl>
        <dl className={own.facts}><dt>{t("To")}</dt><dd dir="auto">{[invoice.customer.name, invoice.customer.address].filter(Boolean).join("\n")}</dd>
          {invoice.customer.taxNumber ? <><dt>{t("Tax number")}</dt><dd>{isolate(invoice.customer.taxNumber)}</dd></> : null}</dl>
      </div>
      <dl className={own.facts}>
        <dt>{t("Invoice date")}</dt><dd>{format.date(invoice.issueDate)}</dd>
        <dt>{t("Due")}</dt><dd>{format.date(invoice.dueDate)}</dd>
        <dt>{t("For")}</dt><dd dir="auto">{[invoice.milestone, invoice.reference ? isolate(invoice.reference) : ""].filter(Boolean).join(" · ")}</dd>
      </dl>
      <table className={own.lines}>
        <thead><tr><th scope="col">{t("Description")}</th><th scope="col">{t("Net")}</th><th scope="col">{t("Tax")}</th><th scope="col">{t("Total")}</th></tr></thead>
        <tbody>{invoice.lines.map((line, index) => <tr key={index}>
          <td dir="auto">{line.description}<small>{t("Tax {rate}%", { rate: format.number(line.taxRate) })}</small></td>
          <td>{money(line.net)}</td><td>{money(line.tax)}</td><td>{money(line.total)}</td></tr>)}</tbody>
      </table>
      <dl className={own.totals}>
        <dt>{t("Net")}</dt><dd>{money(invoice.net)}</dd>
        <dt>{t("Tax")}</dt><dd>{money(invoice.tax)}</dd>
        <dt>{t("Total")}</dt><dd><strong>{money(invoice.total)}</strong></dd>
        {invoice.status !== "credited" ? <><dt>{t("Paid")}</dt><dd>{money(invoice.paid)}</dd><dt>{t("Left to pay")}</dt><dd><strong>{money(invoice.balance)}</strong></dd></> : null}
      </dl>
      {invoice.credit ? <p className={styles.muted}>{t("Credited by {note} on {date}", { note: isolate(invoice.credit.number), date: format.date(invoice.credit.on) })}</p> : null}
      {invoice.note ? <p className={styles.muted} dir="auto">{invoice.note}</p> : null}
    </article>
  </main>;
}
