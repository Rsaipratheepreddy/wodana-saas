import type { CrewDay, CrewPresence } from "@wodana/contracts";

/**
 * A crew day's pay, exactly: each worker's frozen day rate times the share of the day they worked (a whole
 * day, half or none), added per currency. Decimal strings in, decimal strings out — never floats.
 */
const FACTOR = 1_000_000n;
const HALVES: Record<CrewPresence, bigint> = { present: 2n, half_day: 1n, absent: 0n };

const units = (value: string) => {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  return match ? BigInt(match[1]) * FACTOR + BigInt((match[2] ?? "").padEnd(6, "0")) : null;
};
const text = (value: bigint) => {
  const fraction = (value % FACTOR).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${value / FACTOR}.${fraction}` : String(value / FACTOR);
};

/** Days of work a presence counts for: 1, 0.5 or 0. */
export const presenceDays = (presence: CrewPresence) => Number(HALVES[presence]) / 2;

/** What one worker's day costs at their rate, or null without a rate. */
export function lineCost(rate: string | null, presence: CrewPresence): string | null {
  const value = rate ? units(rate) : null;
  // Rates carry at most four places, so half of one is still exact at six.
  return value === null ? null : text((value * HALVES[presence]) / 2n);
}

/** The day's total in each currency its rates are in, largest first. */
export function dayCost(workers: CrewDay["workers"]): Array<{ currency: string; amount: string }> {
  const totals = new Map<string, bigint>();
  for (const line of workers) {
    const value = line.dayRate && line.currency ? units(line.dayRate) : null;
    if (value === null || !line.currency) continue;
    totals.set(line.currency, (totals.get(line.currency) ?? 0n) + (value * HALVES[line.presence]) / 2n);
  }
  return [...totals].sort((a, b) => (a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1)).map(([currency, amount]) => ({ currency, amount: text(amount) }));
}
