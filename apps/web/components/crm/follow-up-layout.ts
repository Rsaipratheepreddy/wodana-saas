import type { RecordData } from "@/lib/crm/client";

export const HOUR_WIDTH = 240;
export const GRID_ORIGIN = 24;
export const LANE_HEIGHT = 88;

/** Pack intervals into shared lanes; point reminders reserve label space only. */
export function layoutFollowUps(records: RecordData[], day: string) {
  const start = new Date(`${day}T00:00:00`);
  const stop = new Date(start); stop.setDate(stop.getDate() + 1);
  const minute = (date: Date) => date.getHours() * 60 + date.getMinutes();
  const entries = records.flatMap(item => {
    if (item.type === "note" || item.status === "cancelled") return [];
    const appointment = item.appointment as Record<string, unknown> | undefined;
    const from = new Date(String(appointment?.startsAt ?? item.dueAt));
    const to = appointment?.endsAt ? new Date(String(appointment.endsAt)) : null;
    const duration = to !== null && Number.isFinite(to.getTime()) && to > from;
    if (!Number.isFinite(from.getTime()) || from >= stop || (duration ? to! <= start : from < start)) return [];
    const begin = from < start ? 0 : minute(from);
    const end = duration ? (to! >= stop ? 1440 : minute(to!)) : begin;
    return [{ item, from, to: duration ? to : null, begin, end, duration }];
  }).sort((a, b) => a.begin - b.begin || b.end - a.end);
  const occupied: number[] = [];
  return entries.map(entry => {
    const width = entry.duration ? Math.max(2, (entry.end - entry.begin) * HOUR_WIDTH / 60) : 180;
    let lane = occupied.findIndex(end => end <= entry.begin);
    if (lane < 0) lane = occupied.length;
    occupied[lane] = entry.duration ? entry.end : entry.begin + width * 60 / HOUR_WIDTH;
    return { ...entry, lane, width, offset: GRID_ORIGIN + entry.begin * HOUR_WIDTH / 60 };
  });
}
