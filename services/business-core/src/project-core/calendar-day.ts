import { BadRequestException } from "@nestjs/common";

/** The years a plan can sensibly carry; a year outside them is a date still being typed ("0202") or a slip. */
export const EARLIEST_YEAR = 1900;
export const LATEST_YEAR = 2199;
const DAY = /^(\d{4})-\d{2}-\d{2}$/;

/**
 * A calendar day from a request, as YYYY-MM-DD; nothing given reads as null. It is never read through a time
 * zone, and its year must be a real one: a segmented date field sends "0202-11-10" while 2026 is being typed,
 * and a plan scheduled from such a day is "late" everywhere.
 */
export function calendarDay(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const match = typeof value === "string" ? DAY.exec(value) : null;
  if (!match || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new BadRequestException(`${label} must be a date.`);
  const year = Number(match[1]);
  if (year < EARLIEST_YEAR || year > LATEST_YEAR) throw new BadRequestException(`${label} needs a full year (${EARLIEST_YEAR} to ${LATEST_YEAR}).`);
  return value as string;
}
