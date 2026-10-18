import { addDays, daysBetween, fiscalYearStart } from "../reports/report-math";
import type { StatementComparison } from "./statement-contract";

/** Periods for statements: comparisons, months, financial years. Days are YYYY-MM-DD, periods inclusive. */

export type Period = { from: string; to: string };

const parts = (day: string) => ({ year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)), date: Number(day.slice(8, 10)) });
const iso = (year: number, month: number, date: number) => new Date(Date.UTC(year, month - 1, date)).toISOString().slice(0, 10);
const lastOfMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const isMonthStart = (day: string) => parts(day).date === 1;
const isMonthEnd = (day: string) => { const p = parts(day); return p.date === lastOfMonth(p.year, p.month); };

/** The same calendar day `months` months away, kept inside its month (31 Mar − 1 month = 28/29 Feb). */
export function shiftMonths(day: string, months: number, keepMonthEnd = false) {
  const p = parts(day);
  const index = p.year * 12 + (p.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = lastOfMonth(year, month);
  return iso(year, month, keepMonthEnd ? last : Math.min(p.date, last));
}

/** Whole calendar months a period spans exactly (1 Jan – 31 Mar is 3), else null. */
export function wholeMonths(period: Period): number | null {
  if (!isMonthStart(period.from) || !isMonthEnd(period.to)) return null;
  const from = parts(period.from), to = parts(period.to);
  return (to.year - from.year) * 12 + (to.month - from.month) + 1;
}

/**
 * The comparison column's period: the period just before of the same length (whole months stay whole months, so
 * February compares with January), or the same days a year earlier (29 Feb becomes 28 Feb; a month end stays one).
 */
export function comparisonPeriod(period: Period, compare: StatementComparison): Period | null {
  if (compare === "none") return null;
  if (compare === "previous_year") {
    return { from: shiftMonths(period.from, -12), to: shiftMonths(period.to, -12, isMonthEnd(period.to)) };
  }
  const months = wholeMonths(period);
  if (months) return { from: shiftMonths(period.from, -months), to: addDays(period.from, -1) };
  const length = daysBetween(period.from, period.to) + 1;
  return { from: addDays(period.from, -length), to: addDays(period.from, -1) };
}

/** Each calendar month the period touches, cut to the period. */
export function monthsOf(period: Period): Period[] {
  const out: Period[] = [];
  let start = period.from;
  while (start <= period.to && out.length < 240) {
    const p = parts(start);
    const end = iso(p.year, p.month, lastOfMonth(p.year, p.month));
    out.push({ from: start, to: end < period.to ? end : period.to });
    start = addDays(end, 1);
  }
  return out;
}

/** The financial year a day falls in, for a year starting in `startMonth` (1–12). */
export function fiscalYearOf(day: string, startMonth: number): Period {
  const from = fiscalYearStart(day, startMonth);
  return { from, to: addDays(shiftMonths(from, 12), -1) };
}

/** Three 30-day buckets after `today` (the 90-day forecast); what is overdue counts in the first. */
export function forecastBuckets(today: string): Period[] {
  return [0, 1, 2].map((index) => ({ from: addDays(today, 1 + index * 30), to: addDays(today, 30 + index * 30) }));
}
