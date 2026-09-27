import type { CommercialData, ControlledChangeKind } from "./types";
import { tKey } from "@/lib/i18n/keys";

export const changeKinds: { value: ControlledChangeKind; label: string }[] = [
  { value: "addition", label: tKey("Add work") },
  { value: "removal", label: tKey("Remove work") },
  { value: "replacement", label: tKey("Replace work") },
  { value: "clarification", label: tKey("Clarify scope") },
  { value: "date_change", label: tKey("Change dates") },
  { value: "price_correction", label: tKey("Correct price") },
];

export function availableContractLines(data: CommercialData) {
  const deducted = new Map<string, number>();
  for (const quote of data.quotes) {
    if (quote.status !== "accepted" || quote.direction !== "deduction") continue;
    const selected = new Set(quote.clientDecision?.selectedOptionLineIds ?? []);
    for (const line of quote.lines.filter((line) => !line.optional || selected.has(line.id))) if (line.deductsLineId)
      deducted.set(line.deductsLineId, (deducted.get(line.deductsLineId) ?? 0) + line.quantity);
  }
  return data.quotes
    .filter((quote) => quote.status === "accepted" && quote.direction !== "deduction")
    .flatMap((quote) => {
      const selected = new Set(quote.clientDecision?.selectedOptionLineIds ?? []);
      return quote.lines.filter((line) => !line.optional || selected.has(line.id)).map((line) => ({
      id: line.id,
      quoteNumber: quote.number,
      title: line.title,
      room: line.room,
      remainingQuantity: Math.max(0, Math.round((line.quantity - (deducted.get(line.id) ?? 0)) * 10000) / 10000),
      unit: line.unit,
      }));
    })
    .filter((line) => line.remainingQuantity > 0);
}
