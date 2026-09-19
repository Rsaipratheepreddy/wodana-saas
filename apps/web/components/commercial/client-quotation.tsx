"use client";
import type { ClientQuote, PortalBrand } from "@/lib/commercial/types";
import { money, statusLabel } from "@/lib/commercial/client";
import { QuotationDocument } from "./quotation-document";
import p from "./client-portal.module.css";
export function ClientQuotation({ quote, brand }: { quote: ClientQuote; brand?: PortalBrand }) {
  const evidence = quote.clientDecision;
  const clientBrand: PortalBrand = {
    name: brand?.name ?? quote.brand?.name ?? "Wodana",
    logo: brand?.logo ?? quote.brand?.logo ?? "",
    welcomeTitle: brand?.welcomeTitle ?? quote.brand?.welcomeTitle ?? "Your project",
    welcomeText: brand?.welcomeText ?? quote.brand?.welcomeText ?? "Review the latest project information.",
    supportPhone: brand?.supportPhone ?? quote.brand?.supportPhone ?? "",
    layout: brand?.layout ?? quote.brand?.layout ?? "minimal",
    primaryColor: "#E4E3DE",
    accentColor: "#000000",
  };
  return <><div className={p.title}><span className={p.muted}>{quote.kind === "variation" ? "Variation" : "Quotation"} · V{quote.number}</span><span className={p.status} data-status={quote.expired && quote.status === "issued" ? "expired" : quote.status}>{quote.expired && quote.status === "issued" ? "Expired" : statusLabel[quote.status]}</span></div><QuotationDocument quote={quote} brand={clientBrand}/>{evidence?.decision === "accept" && evidence.acceptedTotal !== undefined ? <p className={p.test}>Accepted amount: {money(evidence.acceptedTotal, quote.currency)}{evidence.selectedOptionLineIds.length ? ` · ${evidence.selectedOptionLineIds.length} selected option${evidence.selectedOptionLineIds.length === 1 ? "" : "s"}` : " · No optional items selected"} · Snapshot {evidence.quoteHash.slice(0, 12)}</p> : null}{quote.decidedBy && <p className={p.muted}>{statusLabel[quote.status]} by {quote.decidedBy} · {quote.decidedAt?.slice(0,10)}</p>}</>;
}
