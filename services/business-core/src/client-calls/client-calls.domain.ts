import { workdays, type WorkCalendar } from "../project-core/work-calendar";

/**
 * PLM-046: the Account Manager's recurring client update call. Weekly by default, changed per job (fortnightly,
 * monthly) or turned off when the client declines. No recurrence rule is stored: one call is booked at a time, and
 * the next is booked when it is done or its day has passed.
 */
export const FREQUENCIES = ["weekly", "fortnightly", "monthly", "off"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const isFrequency = (value: unknown): value is Frequency => typeof value === "string" && (FREQUENCIES as readonly string[]).includes(value);
export const FREQUENCY_LABEL: Record<Frequency, string> = { weekly: "Weekly", fortnightly: "Every two weeks", monthly: "Monthly", off: "Off" };

const at = (day: string) => Date.parse(`${day}T00:00:00Z`);
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

/** The same day one interval later (a month keeps the day of the month, or the month's last day). */
export function addInterval(day: string, frequency: Exclude<Frequency, "off">) {
  if (frequency === "weekly") return iso(at(day) + 7 * 86_400_000);
  if (frequency === "fortnightly") return iso(at(day) + 14 * 86_400_000);
  const date = new Date(at(day));
  const year = date.getUTCFullYear(), month = date.getUTCMonth() + 1, dayOfMonth = date.getUTCDate();
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return iso(Date.UTC(year, month, Math.min(dayOfMonth, last)));
}

/**
 * The day of the next call after `from` (the last call's planned day, or the day the calls start): one interval on,
 * moved to the next working day of the firm's week, and never on or before `today`.
 */
export function nextCallDay(from: string, today: string, frequency: Exclude<Frequency, "off">, calendar: WorkCalendar) {
  const math = workdays(calendar);
  let day = addInterval(from, frequency);
  for (let guard = 0; day <= today && guard < 400; guard++) day = addInterval(day, frequency);
  return math.onOrAfter(day);
}
