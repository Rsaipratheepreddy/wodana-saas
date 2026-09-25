import { Dec } from "./decimal";

/** Waste and buying rules per material: +8% tiles, whole sheets, boxes of 12. */
export type WasteRule = { percent?: string; roundUpTo?: string };

/**
 * The quote uses measured + waste; purchasing buys that rounded up to whole packs or sheets.
 * Both are returned so the difference is visible.
 */
export function applyWaste(measured: Dec | string, rule: WasteRule = {}) {
  const base = Dec.of(measured);
  const withWaste = rule.percent ? base.mul(Dec.ONE.add(Dec.of(rule.percent).div(100))) : base;
  let purchase = withWaste;
  if (rule.roundUpTo && Dec.of(rule.roundUpTo).cmp(0) > 0) {
    const step = Dec.of(rule.roundUpTo);
    purchase = withWaste.div(step).ceil().mul(step);
  }
  return { measured: base, quote: withWaste, purchase, extra: purchase.sub(base) };
}
