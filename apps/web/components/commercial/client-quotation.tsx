"use client";
import type { ClientQuote, PortalBrand } from "@/lib/commercial/types";
import { money } from "@/lib/commercial/client";
import { useT } from "@/lib/i18n/i18n-provider";
import { QuotationDocument } from "./quotation-document";
import styles from "./quotation-print.module.css";

/** An issued quotation as the client reads it: the document, its state and, once accepted, the accepted amount. */
export function ClientQuotation({ quote, brand }: { quote: ClientQuote; brand?: PortalBrand }) {
  const t = useT();
  const evidence = quote.clientDecision;
  const expired = quote.expired && quote.status === "issued";
  const states: Record<string, string> = { issued: t("Waiting for you"), accepted: t("Accepted"), changes_requested: t("Changes asked"), declined: t("Declined"),
    superseded: t("Replaced"), withdrawn: t("Withdrawn") };
  return <>
    <div className={styles.head}>
      <span className={styles.muted}>{quote.kind === "variation" ? t("Variation") : t("Quotation")} · V{quote.number}</span>
      <span className={styles.status} data-status={expired ? "expired" : quote.status}>{expired ? t("Expired") : states[quote.status] ?? quote.status}</span>
    </div>
    <QuotationDocument quote={quote} brand={brand} />
    {evidence?.decision === "accept" && evidence.acceptedTotal !== undefined
      ? <p className={styles.muted}>{t("Accepted amount: {amount}", { amount: money(evidence.acceptedTotal, quote.currency) })}</p> : null}
  </>;
}
