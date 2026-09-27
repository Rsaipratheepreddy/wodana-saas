/**
 * Exact order amounts in the browser, the same way the server prices them: fixed-point on BigInt
 * (6 places), half away from zero, rounded to the currency's minor units. Shown while editing; the
 * server's saved amounts are the record.
 */
const SCALE = 6n;
const FACTOR = 10n ** SCALE;

const parse = (value: string) => {
  const match = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  const units = BigInt(whole) * FACTOR + BigInt((fraction + "000000").slice(0, 6));
  return sign === "-" ? -units : units;
};
const divRound = (value: bigint, divisor: bigint) => {
  const quotient = value / divisor;
  const remainder = value % divisor;
  if (remainder * 2n >= divisor) return quotient + 1n;
  if (remainder * 2n <= -divisor) return quotient - 1n;
  return quotient;
};
const mul = (a: bigint, b: bigint) => divRound(a * b, FACTOR);
const round = (value: bigint, places: number) => { const step = 10n ** (SCALE - BigInt(places)); return divRound(value, step) * step; };
const fixed = (value: bigint, places: number) => {
  const rounded = round(value, places);
  const negative = rounded < 0n;
  const abs = negative ? -rounded : rounded;
  const fraction = (abs % FACTOR).toString().padStart(6, "0").slice(0, places);
  return `${negative ? "-" : ""}${abs / FACTOR}${places ? `.${fraction}` : ""}`;
};

/** Minor units of a currency (AED 2, JPY 0, KWD 3). */
export function currencyDecimals(currency: string) {
  try { return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; }
}

/** A line's net, tax and total, or null while a number is incomplete. */
export function priceLine(input: { quantity: string; unitPrice: string; discountPercent: string; taxRate: string }, decimals: number) {
  const [quantity, price, discount, tax] = [input.quantity, input.unitPrice, input.discountPercent || "0", input.taxRate || "0"].map(parse);
  if (quantity === null || price === null || discount === null || tax === null) return null;
  const hundred = 100n * FACTOR;
  const gross = mul(quantity, price);
  const net = round(divRound(mul(gross, hundred - discount) * FACTOR, hundred), decimals);
  const taxAmount = round(divRound(mul(net, tax) * FACTOR, hundred), decimals);
  return { net: fixed(net, decimals), tax: fixed(taxAmount, decimals), total: fixed(net + taxAmount, decimals), units: { net, tax: taxAmount } };
}

/** Totals from the lines' own rounded amounts, so the order always equals the sum of its lines. */
export function orderTotals(lines: Array<ReturnType<typeof priceLine>>, decimals: number) {
  const net = lines.reduce((sum, line) => sum + (line?.units.net ?? 0n), 0n);
  const tax = lines.reduce((sum, line) => sum + (line?.units.tax ?? 0n), 0n);
  return { net: fixed(net, decimals), tax: fixed(tax, decimals), total: fixed(net + tax, decimals) };
}

/** Exact sum of decimal strings ("5.0000" + "1.25" = "6.25"), to four places, trailing zeros dropped. */
export function addExact(...values: Array<string | null | undefined>) {
  const total = values.reduce((sum, value) => sum + (parse(value || "0") ?? 0n), 0n);
  return fixed(total, 4).replace(/\.?0+$/, "") || "0";
}

/** Exact a − b, never below zero: what's left ("6" − "1.5" = "4.5"). */
export function subtractExact(a: string, b: string) {
  const left = (parse(a || "0") ?? 0n) - (parse(b || "0") ?? 0n);
  return left <= 0n ? "0" : fixed(left, 4).replace(/\.?0+$/, "");
}

/** Exact a × b of decimal strings, to four places ("2" × "115.5" = "231"). */
export function multiplyExact(a: string, b: string) {
  return fixed(mul(parse(a || "0") ?? 0n, parse(b || "0") ?? 0n), 4).replace(/\.?0+$/, "") || "0";
}
