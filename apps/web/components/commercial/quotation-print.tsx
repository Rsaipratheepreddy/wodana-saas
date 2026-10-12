"use client";
import type { ClientQuote } from "@/lib/commercial/types";
import { Button } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { ClientQuotation } from "./client-quotation";
import styles from "./quotation-print.module.css";
import { useDocumentTitle } from "@/lib/document-title";
import { PrintPageRules } from "../documents/print-document";

/** An issued quotation on its own page, to print or save as PDF, with the snapshot it was issued as. */
export function QuotationPrint({ quote, customer }: { quote: ClientQuote; customer: string }) {
  const t = useT();
  // The saved PDF is named after the quotation and who it's for: "Q-12 Aisha Rahman".
  useDocumentTitle([`Q-${quote.number}`, quote.cover?.preparedFor || customer || quote.title]);
  return <main className={styles.page}>
    <PrintPageRules />
    <div className={styles.actions}><Button variant="primary" onPress={() => window.print()}>{t("Print or save as PDF")}</Button></div>
    <article className={styles.document}>
      <ClientQuotation quote={{ ...quote, cover: { ...(quote.cover ?? { location: "", subtitle: "" }), preparedFor: quote.cover?.preparedFor || customer } }} />
      <p className={styles.muted}>{t("Version {number}", { number: quote.number })}{quote.hash ? ` · ${t("Issued snapshot {hash}", { hash: quote.hash.slice(0, 12) })}` : ""}</p>
    </article>
  </main>;
}
