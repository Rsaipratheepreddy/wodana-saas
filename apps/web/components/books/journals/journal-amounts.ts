/**
 * Exact amounts for the journal editor: decimal text carried as units of 10^-4 (BigInt), never floats, and shown
 * with the locale's grouping at the currency's precision.
 */

const SCALE = 4n;
const ONE = 10n ** SCALE;

/** Units of 10^-4 from decimal text ("1500.5"), or null when it isn't one (blank is zero). */
export function toUnits(text: string | null | undefined): bigint | null {
  const value = (text ?? "").trim();
  if (!value) return 0n;
  const match = /^(\d+)(?:\.(\d{0,4}))?$/.exec(value);
  if (!match) return null;
  return BigInt(match[1]) * ONE + BigInt((match[2] ?? "").padEnd(4, "0") || "0");
}

/** Decimal text ("1500.5000") from units of 10^-4. */
export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  return `${negative ? "-" : ""}${abs / ONE}.${(abs % ONE).toString().padStart(4, "0")}`;
}

/** "AED 1,500.50" in the person's locale, from exact decimal text. */
export function moneyText(text: string, currency: string, locale: string, decimals = 2) {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      // Intl formats decimal strings exactly (no float on the way).
      .format(text as unknown as number);
  } catch {
    return `${currency} ${text}`;
  }
}

/** "50,000.00" in the person's locale, from exact decimal text (at least two decimals, up to four). */
export function amountText(text: string, locale: string) {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(text as unknown as number);
}

export function lineTotals(lines: Array<{ debit: string; credit: string }>) {
  let debit = 0n, credit = 0n;
  for (const line of lines) {
    debit += toUnits(line.debit) ?? 0n;
    credit += toUnits(line.credit) ?? 0n;
  }
  return { debit, credit, difference: debit - credit, balanced: debit === credit && debit > 0n };
}
