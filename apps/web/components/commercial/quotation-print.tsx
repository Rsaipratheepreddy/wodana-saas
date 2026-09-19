"use client";
import type { ClientQuote } from "@/lib/commercial/types";
import { Button } from "@/design-system";
import { money } from "@/lib/commercial/client";
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
          <Button onPress={() => window.print()}>
            Print / save PDF
          </Button>
        </div>
      </header>
      <article className={p.main}>
        <ClientQuotation quote={{...quote,cover:quote.cover??{preparedFor:customer,location:"",subtitle:"Interior design & fit-out proposal"}}} />
        <p className={p.muted}>
          Document reference: {quote.id} · V{quote.number}
          {quote.hash ? ` · Issued snapshot ${quote.hash.slice(0, 12)}` : ""}
        </p>
        {quote.clientDecision?.decision === "accept" && quote.clientDecision.acceptedTotal !== undefined ? <p className={p.muted}>Accepted amount: {money(quote.clientDecision.acceptedTotal, quote.currency)} · {quote.clientDecision.selectedOptionLineIds.length} selected option{quote.clientDecision.selectedOptionLineIds.length === 1 ? "" : "s"}</p> : null}
      </article>
    </main>
  );
}
