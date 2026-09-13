import { BadRequestException, ConflictException } from "@nestjs/common";
export type WorkCalendar = {
  weekdays: number[];
  startTime: string;
  endTime: string;
  holidays: { date: string; reason: string }[];
};
export type BookingSlot = { date: string; startTime: string; endTime: string };
export const fullCalendar: WorkCalendar = {
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  startTime: "00:00",
  endTime: "24:00",
  holidays: [],
};
export function clockTime(v: unknown, end = false): string {
  if (
    typeof v !== "string" ||
    (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v) && !(end && v === "24:00"))
  )
    throw new BadRequestException("Enter a valid shift time.");
  return v;
}
export function validateCalendar(value: unknown): WorkCalendar {
  if (!value || typeof value !== "object")
    throw new BadRequestException("Choose a working calendar.");
  const v = value as Record<string, unknown>;
  if (
    !Array.isArray(v.weekdays) ||
    !v.weekdays.length ||
    v.weekdays.some((x) => !Number.isInteger(x) || x < 0 || x > 6)
  )
    throw new BadRequestException("Choose at least one working day.");
  const startTime = clockTime(v.startTime),
    endTime = clockTime(v.endTime, true);
  if (startTime >= endTime)
    throw new BadRequestException(
      "The shift must end after it starts. Split overnight work into dated shifts.",
    );
  if (!Array.isArray(v.holidays) || v.holidays.length > 366)
    throw new BadRequestException("Limit calendar exceptions to 366 dates.");
  const holidays = v.holidays.map((x) => {
    if (!x || typeof x !== "object")
      throw new BadRequestException("Add a dated calendar exception.");
    const q = x as Record<string, unknown>;
    if (
      typeof q.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(q.date) ||
      !Number.isFinite(Date.parse(q.date)) ||
      new Date(q.date).toISOString().slice(0, 10) !== q.date ||
      typeof q.reason !== "string" ||
      !q.reason.trim() ||
      q.reason.length > 200
    )
      throw new BadRequestException("Add a valid exception date and reason.");
    return { date: q.date, reason: q.reason.trim() };
  });
  return {
    weekdays: [...new Set(v.weekdays as number[])],
    startTime,
    endTime,
    holidays,
  };
}
export function bookingSlots(
  start: string,
  end: string,
  calendar = fullCalendar,
  from = calendar.startTime,
  to = calendar.endTime,
): BookingSlot[] {
  clockTime(from);
  clockTime(to, true);
  if (from >= to || from < calendar.startTime || to > calendar.endTime)
    throw new ConflictException(
      "Choose hours within the resource working shift.",
    );
  const first = Date.parse(start),
    last = Date.parse(end);
  if (
    !Number.isFinite(first) ||
    !Number.isFinite(last) ||
    last < first ||
    (last - first) / 86400000 > 730
  )
    throw new BadRequestException(
      "Choose a booking range of at most two years.",
    );
  const slots: BookingSlot[] = [];
  for (let n = first; n <= last; n += 86400000) {
    const date = new Date(n).toISOString().slice(0, 10);
    if (
      calendar.weekdays.includes(new Date(n).getUTCDay()) &&
      !calendar.holidays.some((x) => x.date === date)
    )
      slots.push({ date, startTime: from, endTime: to });
  }
  if (!slots.length)
    throw new ConflictException(
      "These dates contain no working shifts. Choose working dates or update the calendar.",
    );
  return slots;
}
export function slotsClash(a: BookingSlot[], b: BookingSlot[]): boolean {
  const byDate = new Map<string, BookingSlot[]>();
  for (const s of b) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  return a.some((x) =>
    byDate
      .get(x.date)
      ?.some((y) => x.startTime < y.endTime && y.startTime < x.endTime),
  );
}
