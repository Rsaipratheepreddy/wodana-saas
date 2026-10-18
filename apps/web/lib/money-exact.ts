/**
 * Exact money in a currency's minor units (2 for most, 0 for JPY, 3 for KWD), in whole numbers, so shares
 * and totals match the server's decimal arithmetic (half away from zero). Amounts stay well inside the
 * range where whole numbers are exact.
 */
export function minorUnits(currency?: string | null) {
  if (!currency) return 2;
  try { return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; } catch { return 2; }
}

/** The smallest positive amount in the currency as decimal text: "0.01", "1" (JPY), "0.001" (KWD). */
export function smallestAmount(currency?: string | null) {
  const places = minorUnits(currency);
  return places ? `0.${"0".repeat(places - 1)}1` : "1";
}

/** Half away from zero, on whole numbers (no float rounding surprises). */
function divRound(numerator: number, denominator: number) {
  const sign = Math.sign(numerator) * Math.sign(denominator) || 1;
  const n = Math.abs(numerator), d = Math.abs(denominator);
  const remainder = n % d;
  return sign * ((n - remainder) / d + (remainder * 2 >= d ? 1 : 0));
}

/** An amount in minor units: 12.345 AED → 1235, 1500.4 JPY → 1500. Parsed from its decimal text, not float math. */
export function toMinor(value: number | string, currency?: string | null) {
  const places = minorUnits(currency);
  const text = typeof value === "number" ? value.toFixed(Math.min(places + 6, 20)) : value.trim();
  const match = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return 0;
  const [, sign, whole, fraction = ""] = match;
  const kept = Number(whole + (fraction + "0".repeat(places)).slice(0, places));
  const next = fraction.length > places ? Number(fraction[places]) : 0;
  const magnitude = kept + (next >= 5 ? 1 : 0);
  return sign === "-" ? -magnitude : magnitude;
}

export function fromMinor(minor: number, currency?: string | null) {
  return minor / 10 ** minorUnits(currency);
}

/** A share of a total by percent (up to two decimals), exact in minor units. */
export function percentOf(total: number | string, percent: number, currency?: string | null) {
  const basisPoints = Math.round(percent * 100);
  return fromMinor(divRound(toMinor(total, currency) * basisPoints, 10_000), currency);
}

/** Totals of amounts, exact in minor units. */
export function sumExact(values: Array<number | string>, currency?: string | null) {
  return fromMinor(values.reduce<number>((sum, value) => sum + toMinor(value, currency), 0), currency);
}
