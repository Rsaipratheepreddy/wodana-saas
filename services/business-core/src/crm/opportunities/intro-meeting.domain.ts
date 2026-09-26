import type { MissingItem } from "./discovery.domain";

export type MeetingMode = "in_person" | "online";

/** PLM-043: the intro meeting can be booked only once the floor plan, the area and the client email are in. */
export const INTRO_BOOKING_KEYS = ["floorPlan", "area", "clientEmail"] as const;

export function introBlockers(missing: MissingItem[]) {
  return missing.filter((item) => (INTRO_BOOKING_KEYS as readonly string[]).includes(item.key));
}

export function checkIntroSlot(input: { startsAt: string; endsAt: string; timezone: string; mode: MeetingMode; place?: string | null; now?: Date }) {
  const start = Date.parse(input.startsAt);
  const end = Date.parse(input.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "The meeting must end after it starts";
  if (end - start > 8 * 60 * 60 * 1000) return "A meeting can be at most 8 hours";
  if (start < (input.now ?? new Date()).getTime() - 5 * 60 * 1000) return "Choose a time in the future";
  try { new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format(); } catch { return "Choose a valid time zone"; }
  if (input.mode === "online" && input.place && !/^https:\/\/\S+$/i.test(input.place.trim())) return "The meeting link must start with https://";
  return null;
}

/** Location stored on the appointment: an address for in-person meetings, a link for online ones. */
export function meetingLocation(mode: MeetingMode, place?: string | null) {
  const value = place?.trim() || null;
  return mode === "online" ? { mode, url: value } : { mode, address: value };
}

export function meetingWhen(startsAt: string, endsAt: string, timezone: string, locale: string) {
  const format = (value: string, options: Intl.DateTimeFormatOptions) => {
    try { return new Intl.DateTimeFormat(locale, { timeZone: timezone, ...options }).format(new Date(value)); }
    catch { return new Intl.DateTimeFormat("en", { timeZone: timezone, ...options }).format(new Date(value)); }
  };
  return `${format(startsAt, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} – ${format(endsAt, { hour: "numeric", minute: "2-digit" })} (${timezone})`;
}
