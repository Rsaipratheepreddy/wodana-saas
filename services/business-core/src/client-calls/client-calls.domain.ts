import { workdays, type WorkCalendar } from "../project-core/work-calendar";

/**
 * PLM-046: the Account Manager's recurring client update. Weekly by default, by call; changed per job (fortnightly,
 * monthly), turned off when the client declines, or made a progress update in the client portal instead of a call.
 * No recurrence rule is stored: one call (or reminder to post an update) is planned at a time, and the next when it is
 * done or its day has passed.
 */
export const FREQUENCIES = ["weekly", "fortnightly", "monthly", "off"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const isFrequency = (value: unknown): value is Frequency => typeof value === "string" && (FREQUENCIES as readonly string[]).includes(value);
export const FREQUENCY_LABEL: Record<Frequency, string> = { weekly: "Weekly", fortnightly: "Every two weeks", monthly: "Monthly", off: "Off" };

/** How the client hears how the work goes: a call with the Account Manager, or a progress update posted to the client portal. */
export const MODES = ["call", "portal"] as const;
export type Mode = (typeof MODES)[number];
export const isMode = (value: unknown): value is Mode => typeof value === "string" && (MODES as readonly string[]).includes(value);

/** The client's choice as the Account Manager reads it ("Weekly calls", "Portal updates instead of calls, monthly", "No update calls"). */
export function choiceText(mode: Mode, frequency: Frequency) {
  if (frequency === "off") return "No update calls";
  if (mode === "portal") return `Portal updates instead of calls, ${FREQUENCY_LABEL[frequency].toLowerCase()}`;
  return { weekly: "Weekly calls", fortnightly: "Calls every two weeks", monthly: "Monthly calls" }[frequency];
}

/** What changes when a job's updates go from one setting to another: cancel what is planned ahead, and plan afresh from today. */
export function planChange(before: { mode: Mode; frequency: Frequency }, after: { mode: Mode; frequency: Frequency }) {
  if (before.mode === after.mode && before.frequency === after.frequency) return { changed: false, cancel: false, plan: false };
  if (after.frequency === "off") return { changed: true, cancel: before.frequency !== "off", plan: false };
  // Turned on, or from calls to portal updates (or back): the next one starts from today. Between weekly, fortnightly
  // and monthly in the same mode the planned one stays and the one after follows the new rhythm.
  const restart = before.frequency === "off" || before.mode !== after.mode;
  return { changed: true, cancel: restart && before.frequency !== "off", plan: restart };
}

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
