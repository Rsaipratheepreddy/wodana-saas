import { createHash } from "node:crypto";
import { freezeHash, totals } from "./commercial.domain";
import type { Quote } from "./commercial.types";

/** Client-facing snapshots intentionally omit cost; QS evidence must not. */
export function qsEstimateHash(quote: Quote): string {
  return createHash("sha256")
    .update(JSON.stringify({
      publicHash: freezeHash(quote),
      costs: quote.lines.map((line) => ({ id: line.id, quantity: line.quantity, unitCost: line.unitCost })),
      cost: totals(quote).cost,
    }))
    .digest("hex");
}

export function qsEstimateCurrent(quote: Quote): boolean {
  return Boolean(quote.qsEstimate &&
    quote.qsEstimate.quoteHash === qsEstimateHash(quote) &&
    quote.qsEstimate.cost === totals(quote).cost &&
    quote.qsEstimate.sellingTotal === totals(quote).total);
}
