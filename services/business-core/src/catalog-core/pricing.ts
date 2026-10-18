import { Dec } from "./decimal";

export type PriceMethod =
  | { method: "fixed"; price: string }
  | { method: "cost_plus"; cost: string; markupPercent: string }
  | { method: "per_measure"; rate: string; minimumCharge?: string }
  | { method: "tiered"; tiers: Array<{ fromQuantity: string; price: string }> }
  | { method: "attribute_surcharge"; base: string; surcharges: Array<{ attribute: string; value: string; percent?: string; amount?: string; label?: string }> }
  | { method: "assembly_rollup"; components: Array<{ label: string; quantity: string; unitPrice: string | null }>; labour?: string; marginPercent?: string };

export type BreakdownLine = { label: string; amount: string };
export type PriceResult =
  | { available: true; unitPrice: string; total: string; breakdown: BreakdownLine[] }
  | { available: false; reason: string };

/**
 * Explainable pricing: every result carries its breakdown and the lines add up to the total at the
 * currency's precision (a rounding line appears when needed). Nothing is guessed: a missing input
 * makes the price unavailable, never zero.
 */
export function price(method: PriceMethod | null | undefined, input: { quantity: string | Dec; currencyDecimals: number; attributes?: Record<string, string> }): PriceResult {
  if (!method) return { available: false, reason: "No price set" };
  const qty = Dec.of(input.quantity);
  if (qty.isNegative()) return { available: false, reason: "Quantity cannot be negative" };
  const dp = input.currencyDecimals;
  const lines: Array<{ label: string; amount: Dec }> = [];
  let total: Dec;

  switch (method.method) {
    case "fixed":
      total = Dec.of(method.price).mul(qty);
      lines.push({ label: `${qty} × ${Dec.of(method.price).toFixed(dp)}`, amount: total });
      break;
    case "cost_plus": {
      const cost = Dec.of(method.cost).mul(qty);
      const markup = cost.mul(Dec.of(method.markupPercent).div(100));
      lines.push({ label: `Cost ${qty} × ${Dec.of(method.cost).toFixed(dp)}`, amount: cost }, { label: `Markup ${Dec.of(method.markupPercent)}%`, amount: markup });
      total = cost.add(markup);
      break;
    }
    case "per_measure": {
      const charge = Dec.of(method.rate).mul(qty);
      lines.push({ label: `${qty} × ${Dec.of(method.rate).toFixed(dp)}`, amount: charge });
      total = charge;
      if (method.minimumCharge && charge.cmp(method.minimumCharge) < 0) {
        const topUp = Dec.of(method.minimumCharge).sub(charge);
        lines.push({ label: "Minimum charge", amount: topUp });
        total = Dec.of(method.minimumCharge);
      }
      break;
    }
    case "tiered": {
      const tiers = [...method.tiers].sort((a, b) => Dec.of(a.fromQuantity).cmp(b.fromQuantity));
      const tier = tiers.filter((t) => qty.cmp(t.fromQuantity) >= 0).pop();
      if (!tier) return { available: false, reason: `No price for fewer than ${tiers[0]?.fromQuantity ?? "any"}` };
      total = Dec.of(tier.price).mul(qty);
      lines.push({ label: `${qty} × ${Dec.of(tier.price).toFixed(dp)} (from ${tier.fromQuantity})`, amount: total });
      break;
    }
    case "attribute_surcharge": {
      const base = Dec.of(method.base).mul(qty);
      lines.push({ label: `Base ${qty} × ${Dec.of(method.base).toFixed(dp)}`, amount: base });
      total = base;
      for (const s of method.surcharges) {
        if (input.attributes?.[s.attribute] !== s.value) continue;
        const amount = s.percent ? base.mul(Dec.of(s.percent).div(100)) : Dec.of(s.amount ?? "0").mul(qty);
        lines.push({ label: s.label ?? `${s.value}${s.percent ? ` +${Dec.of(s.percent)}%` : ""}`, amount });
        total = total.add(amount);
      }
      break;
    }
    case "assembly_rollup": {
      total = Dec.ZERO;
      for (const c of method.components) {
        if (c.unitPrice === null) return { available: false, reason: `${c.label} has no price` };
        const amount = Dec.of(c.unitPrice).mul(c.quantity).mul(qty);
        lines.push({ label: `${c.label} ${c.quantity} × ${Dec.of(c.unitPrice).toFixed(dp)}`, amount });
        total = total.add(amount);
      }
      if (method.labour) { const labour = Dec.of(method.labour).mul(qty); lines.push({ label: "Labour", amount: labour }); total = total.add(labour); }
      if (method.marginPercent) { const margin = total.mul(Dec.of(method.marginPercent).div(100)); lines.push({ label: `Margin ${Dec.of(method.marginPercent)}%`, amount: margin }); total = total.add(margin); }
      break;
    }
  }

  const rounded = total.round(dp);
  const shown = lines.map((line) => ({ label: line.label, amount: line.amount.round(dp) }));
  const sum = shown.reduce((acc, line) => acc.add(line.amount), Dec.ZERO);
  if (sum.cmp(rounded) !== 0) shown.push({ label: "Rounding", amount: rounded.sub(sum) });
  return {
    available: true,
    total: rounded.toFixed(dp),
    unitPrice: qty.isZero() ? Dec.ZERO.toFixed(dp) : rounded.div(qty).toFixed(dp),
    breakdown: shown.map((line) => ({ label: line.label, amount: line.amount.toFixed(dp) })),
  };
}
