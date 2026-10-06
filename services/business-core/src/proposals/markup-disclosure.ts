import { Dec } from "../catalog-core/decimal";
import type { QuotePricing } from "../quotation/quote-pricing";

/**
 * R3: how a firm shows its markup to the client. A firm setting, applied the same way to the quote, the
 * proposal PDF and the client portal:
 * - all_inclusive: one selling price per line, no cost or markup shown (the common default);
 * - disclosed_markup: each line shows its cost, the markup and the selling price;
 * - fee_based: lines are shown at cost and the firm's margin appears once, as its fee.
 * The total the client pays never changes with the mode; only how it is explained.
 */
export const MARKUP_DISCLOSURES = ["all_inclusive", "disclosed_markup", "fee_based"] as const;
export type MarkupDisclosure = (typeof MARKUP_DISCLOSURES)[number];

export type DisclosureLine = {
  id: string; title: string; quantity: string; unit: string; rate: string; unitCost: string | null; optional?: boolean | null; credit?: boolean;
};

export type ClientLine = {
  id: string;
  title: string;
  quantity: string;
  unit: string;
  /** The rate the client reads on this line (the selling rate, or the cost under a fee). */
  rate: string;
  /** What the line comes to at that rate (before discounts and tax). */
  amount: string;
  optional: boolean;
  /** Only with a disclosed markup. */
  cost: string | null;
  markupPercent: string | null;
  markupAmount: string | null;
};

/** One row of the summary, as an English key the web and the PDF translate, and an amount. */
export type ClientSummaryRow = { key: "Cost of items" | "Markup" | "Items at cost" | "Our fee" | "Subtotal" | "Discount" | "Tax" | "Total"; amount: string; rate?: string };

export type ClientPresentation = { mode: MarkupDisclosure; lines: ClientLine[]; summary: ClientSummaryRow[] };

export function markupDisclosure(value: unknown): MarkupDisclosure {
  return (MARKUP_DISCLOSURES as readonly string[]).includes(String(value)) ? (value as MarkupDisclosure) : "all_inclusive";
}

/**
 * The quote as the client reads it in one disclosure mode. Amounts are exact decimals at the currency's
 * precision; the fee is what is left of the subtotal after the items at cost, so the rows always add up.
 * A line without a cost is shown with no markup (its cost is its price).
 */
export function presentForClient(lines: DisclosureLine[], pricing: Pick<QuotePricing, "subtotal" | "discounts" | "tax" | "total" | "taxes">, mode: MarkupDisclosure, decimals: number): ClientPresentation {
  const fixed = (value: Dec) => value.toFixed(decimals);
  const presented = lines.map((line) => {
    const quantity = Dec.of(line.quantity), rate = Dec.of(line.rate);
    const cost = line.unitCost === null || line.unitCost === undefined || line.unitCost === "" ? rate : Dec.of(line.unitCost);
    const sign = line.credit ? -1 : 1;
    const gross = quantity.mul(rate).round(decimals);
    const costAmount = quantity.mul(cost).round(decimals);
    const signed = (value: Dec) => (sign < 0 ? value.neg() : value);
    const markupPercent = cost.isZero() ? null : rate.sub(cost).mul(100).div(cost).round(2);
    const base = { id: line.id, title: line.title, quantity: quantity.toString(), unit: line.unit, optional: Boolean(line.optional) };
    if (mode === "fee_based")
      return { line: { ...base, rate: fixed(cost), amount: fixed(signed(costAmount)), cost: null, markupPercent: null, markupAmount: null }, gross: signed(gross), cost: signed(costAmount) };
    if (mode === "disclosed_markup")
      return { line: { ...base, rate: fixed(rate), amount: fixed(signed(gross)), cost: fixed(cost), markupPercent: markupPercent === null ? null : markupPercent.toFixed(2), markupAmount: fixed(signed(gross.sub(costAmount))) }, gross: signed(gross), cost: signed(costAmount) };
    return { line: { ...base, rate: fixed(rate), amount: fixed(signed(gross)), cost: null, markupPercent: null, markupAmount: null }, gross: signed(gross), cost: signed(costAmount) };
  });
  const counted = presented.filter((entry) => !entry.line.optional);
  const subtotal = Dec.of(pricing.subtotal);
  const atCost = counted.reduce((sum, entry) => sum.add(entry.cost), Dec.ZERO).round(decimals);
  const summary: ClientSummaryRow[] = [];
  if (mode === "fee_based") summary.push({ key: "Items at cost", amount: fixed(atCost) }, { key: "Our fee", amount: fixed(subtotal.sub(atCost)) });
  if (mode === "disclosed_markup") summary.push({ key: "Cost of items", amount: fixed(atCost) }, { key: "Markup", amount: fixed(subtotal.sub(atCost)) });
  summary.push({ key: "Subtotal", amount: fixed(subtotal) });
  if (!Dec.of(pricing.discounts.total).isZero()) summary.push({ key: "Discount", amount: fixed(Dec.of(pricing.discounts.total).neg()) });
  for (const tax of pricing.taxes) summary.push({ key: "Tax", amount: fixed(Dec.of(tax.tax)), rate: tax.rate });
  summary.push({ key: "Total", amount: fixed(Dec.of(pricing.total)) });
  return { mode, lines: presented.map((entry) => entry.line), summary };
}
