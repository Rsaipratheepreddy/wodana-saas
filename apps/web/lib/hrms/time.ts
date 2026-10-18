/** Hours as people type them into a timesheet, and calendar-day arithmetic for weeks. */

/**
 * Minutes from what someone typed: "7:30", "7.5", "7,5", "7h 30m", "45m" or "8"; empty is none.
 * Anything else (or more than a day) is null.
 */
export function parseMinutes(text: string): number | null {
  const value = text.trim().toLowerCase();
  if (!value) return 0;
  let match = /^(\d{1,2}):([0-5]\d)$/.exec(value);
  let minutes: number | null = null;
  if (match) minutes = Number(match[1]) * 60 + Number(match[2]);
  else if ((match = /^(\d{1,2})(?:[.,](\d{1,2}))?$/.exec(value))) minutes = Math.round(Number(`${match[1]}.${match[2] ?? "0"}`) * 60);
  else if ((match = /^(?:(\d{1,2})\s*h)?\s*(?:(\d{1,3})\s*m(?:in)?)?$/.exec(value)) && (match[1] || match[2])) minutes = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
  return minutes !== null && minutes <= 1440 ? minutes : null;
}

/** Minutes as a timesheet cell shows them: "7:30"; nothing for none. */
export function clock(minutes: number) {
  return minutes > 0 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}` : "";
}

/** A calendar date (YYYY-MM-DD) some days on. */
export function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** YYYY-MM of a date, and the month next to it. */
export function monthOf(date: string) {
  return date.slice(0, 7);
}
export function addMonths(month: string, months: number) {
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year, value - 1 + months, 1)).toISOString().slice(0, 7);
}
