"use client";
import type { ClientQuote } from "@/lib/commercial/types";
import { statusLabel } from "@/lib/commercial/client";
import { QuotationDocument } from "./quotation-document";
import p from "./client-portal.module.css";
export function ClientQuotation({ quote }: { quote: ClientQuote }) {
  return <><div className={p.title}><span className={p.muted}>{quote.kind === "variation" ? "Variation" : "Quotation"} · V{quote.number}</span><span className={p.status} data-status={quote.status}>{statusLabel[quote.status]}</span></div><QuotationDocument quote={quote}/>{quote.decidedBy && <p className={p.muted}>{statusLabel[quote.status]} by {quote.decidedBy} · {quote.decidedAt?.slice(0,10)}</p>}</>;
}
