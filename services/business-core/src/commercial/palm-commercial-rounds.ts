import { ConflictException } from "@nestjs/common";
import type { CommercialData, Quote } from "./commercial.types";

export function activeAcceptedBaseQuote(data: CommercialData): Quote | undefined {
  if (!data.palmFlow)
    return data.quotes.find((quote) => quote.kind === "quotation" && quote.status === "accepted");
  return data.quotes.find((quote) => quote.kind === "quotation" && quote.round === "main" && quote.status === "accepted")
    ?? data.quotes.find((quote) => quote.kind === "quotation" && quote.round === "design" && quote.status === "accepted");
}

/** One Deal remains open; only the active agreement/review switches to the main round. */
export function beginPalmMainRound(data: CommercialData): void {
  if (!data.palmFlow?.scope.design || !data.palmFlow.scope.mainQuotation ||
      data.quotes.some((quote) => quote.kind === "quotation" && quote.round === "main"))
    throw new ConflictException("A main quotation round is not available for this service path.");
  const design = data.quotes.find((quote) => quote.kind === "quotation" && quote.round === "design" && quote.status === "accepted");
  if (!design || !data.agreement || data.agreement.quoteId !== design.id ||
      !data.ownerReview || data.ownerReview.quoteId !== design.id || data.ownerReview.status !== "approved" ||
      !data.dealFile || data.dealFile.quoteId !== design.id)
    throw new ConflictException("Complete the paid, Owner-approved design Deal File before preparing the main quotation.");
  data.designRound = {
    quoteId: design.id,
    agreement: structuredClone(data.agreement),
    ownerReview: structuredClone(data.ownerReview),
    dealFile: structuredClone(data.dealFile),
  };
  data.agreement = null;
  data.ownerReview = null;
}
