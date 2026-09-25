import { ConflictException } from "@nestjs/common";
import type { CommercialData, Quote } from "./commercial.types";
import { acceptedQuoteLines, acceptedQuoteValue } from "./commercial.domain";
export function sameOffer(a: Quote, b: Quote) {
  return (
    a.kind === b.kind &&
    (a.kind !== "quotation" || a.round === b.round) &&
    (a.kind === "quotation" || (a.familyId ?? a.id) === (b.familyId ?? b.id))
  );
}
export function validateDeduction(data: CommercialData, q: Quote) {
  if (q.direction !== "deduction") return;
  if (q.kind !== "variation")
    throw new ConflictException(
      "Deductions require an accepted-contract variation.",
    );
  const source = data.quotes
    .filter((v) => v.status === "accepted" && v.direction !== "deduction")
    .flatMap((v) => acceptedQuoteLines(v).map((l) => ({ ...l, currency: v.currency })));
  const prior = data.quotes
    .filter(
      (v) =>
        v.id !== q.id && v.status === "accepted" && v.direction === "deduction",
    )
    .flatMap((v) => acceptedQuoteLines(v));
  const allocated = new Map<string, number>();
  for (const line of [...prior, ...acceptedQuoteLines(q)]) {
    if (!line.deductsLineId)
      throw new ConflictException(
        "Link each deduction to an accepted contract item.",
      );
    const original = source.find((l) => l.id === line.deductsLineId);
    if (
      !original ||
      original.currency !== q.currency ||
      original.unit !== line.unit
    )
      throw new ConflictException("Use the accepted item currency and unit.");
    const used = (allocated.get(original.id) ?? 0) + line.quantity;
    allocated.set(original.id, used);
    if (used > original.quantity + 0.0001)
      throw new ConflictException(
        "The deduction exceeds the remaining accepted quantity.",
      );
    if (line.rate > original.rate)
      throw new ConflictException(
        "The deduction rate cannot exceed the accepted item rate.",
      );
  }
  const contract = data.quotes
    .filter(
      (v) =>
        v.status === "accepted" &&
        v.direction !== "deduction" &&
        v.currency === q.currency,
    )
    .reduce((sum, v) => sum + acceptedQuoteValue(v), 0);
  const credited = data.quotes
    .filter(
      (v) =>
        v.id !== q.id &&
        v.status === "accepted" &&
        v.direction === "deduction" &&
        v.currency === q.currency,
    )
    .reduce((sum, v) => sum + acceptedQuoteValue(v), 0);
  if (acceptedQuoteValue(q) + credited > contract + 0.01)
    throw new ConflictException(
      "Credits cannot exceed the accepted contract value.",
    );
  if (q.paymentTerms.length)
    throw new ConflictException(
      "A deduction creates a client credit, not a payment request.",
    );
}
