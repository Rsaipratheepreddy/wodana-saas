import type { HomeMetricWeek } from "@wodana/contracts";

/**
 * Formatting for Home. Money arrives as numeric strings and is handed to Intl as a string, so the
 * printed amount is exact; numbers are only used for bar heights and change ratios.
 */
export function formatMoneyText(value: string, currency: string, locale: string, compact = false) {
  const format = new Intl.NumberFormat(locale, { style: "currency", currency, notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 2 });
  return format.format(value as unknown as number);
}

export function formatCount(value: number, locale: string) {
  return new Intl.NumberFormat(locale).format(value);
}

const byteUnits = ["kilobyte", "megabyte", "gigabyte", "terabyte"] as const;
/** Decimal units (1 GB = 1000³ bytes), as allowances are sold; small files still read in kB. */
export function formatBytes(value: string | number, locale: string) {
  let amount = Number(value) / 1000;
  if (!Number.isFinite(amount) || amount < 0) amount = 0;
  let unit = 0;
  while (amount >= 1000 && unit < byteUnits.length - 1) { amount /= 1000; unit += 1; }
  return new Intl.NumberFormat(locale, { style: "unit", unit: byteUnits[unit], unitDisplay: "short", maximumFractionDigits: amount > 0 && amount < 10 ? 1 : 0 }).format(amount);
}

/** Week start dates are local calendar days; format them without shifting through a time zone. */
export function weekLabel(start: string, locale: string) {
  const date = new Date(`${start}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? start : new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}

export type Change = { direction: "up" | "down" | "flat" | "new"; percent: number };
/** Change of the month so far against the same span of last month. */
export function changeBetween(current: string | number, previous: string | number): Change {
  const now = Number(current); const before = Number(previous);
  if (!Number.isFinite(now) || !Number.isFinite(before)) return { direction: "flat", percent: 0 };
  if (before === 0) return now > 0 ? { direction: "new", percent: 0 } : { direction: "flat", percent: 0 };
  const percent = Math.round(((now - before) / Math.abs(before)) * 100);
  return { direction: percent > 0 ? "up" : percent < 0 ? "down" : "flat", percent: Math.abs(percent) };
}

export const weekValue = (week: HomeMetricWeek) => Number(week.value) || 0;

export function greetingPart(timeZone: string | undefined, now = new Date()): "morning" | "afternoon" | "evening" {
  const hour = Number(new Intl.DateTimeFormat("en", { hour: "numeric", hourCycle: "h23", timeZone }).format(now));
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

export function relativeTime(value: string, locale: string, now = new Date()) {
  const delta = new Date(value).getTime() - now.getTime();
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [["day", 86_400_000], ["hour", 3_600_000], ["minute", 60_000]];
  const [unit, size] = units.find(([, span]) => Math.abs(delta) >= span) ?? ["minute", 60_000];
  if (unit === "day" && Math.abs(delta) >= 7 * 86_400_000) return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(value));
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" }).format(Math.round(delta / size), unit);
}
