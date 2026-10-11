import { localDate } from "./engine";

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Whole calendar days from one local date to another (YYYY-MM-DD). */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

/**
 * The short "due" phrase a reminder carries, in the recipient's zone: "due today", "due tomorrow", "due in 3 days",
 * "1 day overdue", "4 days overdue"; for something waiting on someone, "waiting 26 hours" or "waiting 3 days".
 */
export function dueText(dueAt: Date | null, now: Date, timeZone: string, waiting: boolean): string {
  if (!dueAt) return waiting ? "waiting" : "due";
  if (waiting) {
    const hours = Math.max(0, Math.floor((now.getTime() - dueAt.getTime()) / HOUR));
    if (hours < 48) return hours === 1 ? "waiting 1 hour" : `waiting ${hours} hours`;
    const days = Math.floor(hours / 24);
    return `waiting ${days} days`;
  }
  const days = daysBetween(localDate(now, timeZone), localDate(dueAt, timeZone));
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days > 1) return `due in ${days} days`;
  return days === -1 ? "1 day overdue" : `${-days} days overdue`;
}
