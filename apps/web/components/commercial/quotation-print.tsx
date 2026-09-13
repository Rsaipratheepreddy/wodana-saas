"use client";
import type { ClientQuote } from "@/lib/commercial/types";
import { ClientQuotation } from "./client-quotation";
import p from "./client-portal.module.css";
export function QuotationPrint({
  quote,
  customer,
}: {
  quote: ClientQuote;
  customer: string;
}) {
  return (
    <main className={p.portal}>
      <header className={p.actions}>
        <div className={p.actions}>
          <button className={p.button} onClick={() => window.print()}>
            Print / save PDF
          </button>
        </div>
      </header>
      <article className={p.main}>
        <ClientQuotation quote={{...quote,cover:quote.cover??{preparedFor:customer,location:"",subtitle:"Interior design & fit-out proposal"}}} />
        <p className={p.muted}>
          Document reference: {quote.id} · V{quote.number}
        </p>
      </article>
    </main>
  );
}
