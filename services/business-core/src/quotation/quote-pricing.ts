import { Dec } from "../catalog-core/decimal";

/** How a workspace prices: from Settings → Quotations and the currency of the quote. */
export type PricingPolicy = { currencyDecimals: number; pricesIncludeTax: boolean; rounding: "line" | "document" };

export type PricedLineInput = {
  id: string;
  quantity: string | number;
  rate: string | number;
  unitCost?: string | number | null;
  optional?: boolean;
  /** Area id, or "general" for lines without one. */
  areaKey: string;
  /** Work package id, or "none". */
  tradeKey: string;
  discountKind?: "percent" | "amount" | null;
  discountValue?: string | number | null;
  /** Tax percent for this line; null or undefined when tax isn't set up. */
  taxRate?: string | number | null;
  /** A credit: scope a variation removes. Priced negative; takes no discount of its own or of its section. */
  credit?: boolean;
};
export type QuoteDiscountInput = { scope: "quote" | "area" | "trade"; target: string; kind: "percent" | "amount"; value: string | number };

export type PricedLine = {
  id: string; included: boolean; gross: string; lineDiscount: string; sectionDiscount: string; quoteDiscount: string;
  net: string; tax: string; total: string; cost: string | null;
};
export type SectionTotal = { key: string; gross: string; discount: string; net: string };
export type QuotePricing = {
  lines: PricedLine[];
  areas: SectionTotal[];
  trades: SectionTotal[];
  subtotal: string;
  discounts: { line: string; section: string; quote: string; total: string };
  /** Net of all discounts, excluding tax. */
  net: string;
  tax: string;
  taxes: Array<{ rate: string; base: string; tax: string }>;
  total: string;
  cost: string | null;
  /** Percent of net; null when a cost is missing or net is zero. */
  margin: string | null;
  optionalTotal: string;
};

export class PricingError extends Error {}

/**
 * Prices a quote: gross → line discount → area and trade discounts → quote discount → tax.
 * Section and quote discounts given as an amount are shared across their lines by value, so tax is
 * always charged on what the client actually pays. Optional lines are priced but not included.
 * Rounding per line (each amount at the currency's precision) or per document (only the totals).
 * Exact decimals throughout; never floats.
 */
export function priceQuote(inputs: PricedLineInput[], discounts: QuoteDiscountInput[], policy: PricingPolicy): QuotePricing {
  const dp = policy.currencyDecimals;
  const r = (value: Dec) => (policy.rounding === "line" ? value.round(dp) : value);
  const state = inputs.map((line) => {
    const quantity = Dec.of(line.quantity), rate = Dec.of(line.rate);
    if (quantity.isNegative() || rate.isNegative()) throw new PricingError("Quantity and rate can't be negative.");
    const gross = line.credit ? r(quantity.mul(rate)).neg() : r(quantity.mul(rate));
    let lineDiscount = Dec.ZERO;
    if (line.credit && line.discountKind && line.discountValue !== null && line.discountValue !== undefined && !Dec.of(line.discountValue).isZero())
      throw new PricingError("A removed item can't have a discount.");
    if (!line.credit && line.discountKind && line.discountValue !== null && line.discountValue !== undefined) {
      const value = Dec.of(line.discountValue);
      lineDiscount = line.discountKind === "percent" ? r(gross.mul(value).div(100)) : value;
      if (lineDiscount.cmp(gross) > 0) throw new PricingError("A line discount can't be more than the line.");
    }
    return {
      input: line, included: !line.optional, gross, lineDiscount, sectionDiscount: Dec.ZERO, quoteDiscount: Dec.ZERO,
      running: gross.sub(lineDiscount),
      cost: line.unitCost === null || line.unitCost === undefined ? null : line.credit ? r(quantity.mul(Dec.of(line.unitCost))).neg() : r(quantity.mul(Dec.of(line.unitCost))),
    };
  });
  const included = state.filter((line) => line.included);
  // Discounts are shared over what's charged; a credit returns exactly what was removed.
  const discountable = included.filter((line) => !line.input.credit);

  // Apply one discount to a set of lines, sharing an amount by each line's current value.
  const apply = (lines: typeof state, discount: QuoteDiscountInput, field: "sectionDiscount" | "quoteDiscount") => {
    const base = lines.reduce((sum, line) => sum.add(line.running), Dec.ZERO);
    if (base.isZero()) return;
    const value = Dec.of(discount.value);
    const amount = discount.kind === "percent" ? base.mul(value).div(100) : value;
    if (amount.cmp(base) > 0) throw new PricingError("A discount can't be more than what it applies to.");
    const target = policy.rounding === "line" ? amount.round(dp) : amount;
    let given = Dec.ZERO;
    lines.forEach((line, index) => {
      const share = index === lines.length - 1 ? target.sub(given) : r(target.mul(line.running).div(base));
      line[field] = line[field].add(share);
      line.running = line.running.sub(share);
      given = given.add(share);
    });
  };
  for (const scope of ["area", "trade"] as const)
    for (const discount of discounts.filter((item) => item.scope === scope))
      apply(discountable.filter((line) => (scope === "area" ? line.input.areaKey : line.input.tradeKey) === discount.target), discount, "sectionDiscount");
  for (const discount of discounts.filter((item) => item.scope === "quote")) apply(discountable, discount, "quoteDiscount");

  // Tax per line on what remains; inclusive prices carry their tax inside.
  const taxOf = (amount: Dec, rate: Dec) => (policy.pricesIncludeTax ? amount.mul(rate).div(rate.add(100)) : amount.mul(rate).div(100));
  const priced = state.map((line) => {
    const rate = line.input.taxRate === null || line.input.taxRate === undefined ? Dec.ZERO : Dec.of(line.input.taxRate);
    const tax = r(taxOf(line.running, rate));
    const net = policy.pricesIncludeTax ? line.running.sub(tax) : line.running;
    return { ...line, rate, tax, net, total: net.add(tax) };
  });

  const sum = (lines: typeof priced, pick: (line: (typeof priced)[number]) => Dec) => lines.reduce((acc, line) => acc.add(pick(line)), Dec.ZERO);
  const counted = priced.filter((line) => line.included);
  // Per-document rounding computes tax per rate on the sums, then rounds once.
  const groups = new Map<string, { rate: Dec; base: Dec; tax: Dec }>();
  for (const line of counted) {
    const key = line.rate.toString();
    const group = groups.get(key) ?? { rate: line.rate, base: Dec.ZERO, tax: Dec.ZERO };
    group.base = group.base.add(line.net); group.tax = group.tax.add(line.tax);
    groups.set(key, group);
  }
  const taxes = [...groups.values()].filter((group) => !group.rate.isZero()).map((group) => {
    const tax = policy.rounding === "document"
      ? (policy.pricesIncludeTax ? taxOf(group.base.add(group.tax), group.rate) : taxOf(group.base, group.rate)).round(dp)
      : group.tax.round(dp);
    return { rate: group.rate, base: group.base.round(dp), tax };
  });
  const tax = taxes.reduce((acc, group) => acc.add(group.tax), Dec.ZERO);
  // Inclusive prices: what the client pays is fixed and tax is carved out of it; exclusive: tax is added.
  const net = policy.pricesIncludeTax ? sum(counted, (line) => line.net.add(line.tax)).round(dp).sub(tax) : sum(counted, (line) => line.net).round(dp);
  const lineDiscounts = sum(counted, (line) => line.lineDiscount).round(dp);
  const sectionDiscounts = sum(counted, (line) => line.sectionDiscount).round(dp);
  const quoteDiscounts = sum(counted, (line) => line.quoteDiscount).round(dp);
  const costs = counted.map((line) => line.cost);
  const cost = costs.some((value) => value === null) ? null : costs.reduce<Dec>((acc, value) => acc.add(value!), Dec.ZERO).round(dp);
  const section = (key: (line: (typeof priced)[number]) => string) => {
    const map = new Map<string, { gross: Dec; discount: Dec; net: Dec }>();
    for (const line of counted) {
      const entry = map.get(key(line)) ?? { gross: Dec.ZERO, discount: Dec.ZERO, net: Dec.ZERO };
      entry.gross = entry.gross.add(line.gross);
      entry.discount = entry.discount.add(line.lineDiscount).add(line.sectionDiscount);
      entry.net = entry.net.add(line.gross).sub(line.lineDiscount).sub(line.sectionDiscount);
      map.set(key(line), entry);
    }
    return [...map.entries()].map(([k, v]) => ({ key: k, gross: v.gross.toFixed(dp), discount: v.discount.toFixed(dp), net: v.net.toFixed(dp) }));
  };
  const fixed = (value: Dec) => value.toFixed(dp);
  return {
    lines: priced.map((line) => ({
      id: line.input.id, included: line.included, gross: fixed(line.gross), lineDiscount: fixed(line.lineDiscount),
      sectionDiscount: fixed(line.sectionDiscount), quoteDiscount: fixed(line.quoteDiscount), net: fixed(line.net),
      tax: fixed(line.tax), total: fixed(line.total), cost: line.cost === null ? null : fixed(line.cost),
    })),
    areas: section((line) => line.input.areaKey),
    trades: section((line) => line.input.tradeKey),
    subtotal: fixed(sum(counted, (line) => line.gross).round(dp)),
    discounts: { line: fixed(lineDiscounts), section: fixed(sectionDiscounts), quote: fixed(quoteDiscounts), total: fixed(lineDiscounts.add(sectionDiscounts).add(quoteDiscounts)) },
    net: fixed(net),
    tax: fixed(tax),
    taxes: taxes.map((group) => ({ rate: group.rate.toString(), base: fixed(group.base), tax: fixed(group.tax) })),
    total: fixed(net.add(tax)),
    cost: cost === null ? null : fixed(cost),
    margin: cost === null || net.isZero() ? null : net.sub(cost).mul(100).div(net).round(2).toFixed(2),
    optionalTotal: fixed(sum(priced.filter((line) => !line.included), (line) => line.total).round(dp)),
  };
}
