/** Booking pages (plan §6.5b): the shapes the public page, the manage page and Sales settings share. */

export type BookingQuestionField = "emirate" | "area" | "serviceType" | "budgetRange" | "summary";
export type BookingQuestion = { field: BookingQuestionField; required: boolean };
export type LocationKind = "our_location" | "client_address" | "video" | "phone";
export type Option = { id: string; label: string };

export type PublicBookingType = {
  type: {
    name: string; slug: string; durationMinutes: number; color: string; locationKind: LocationKind; locationDetail: string | null;
    questions: BookingQuestion[]; asksEnquiryType: boolean; confirmation: "automatic" | "approval"; windowDays: number; cancelNoticeMinutes: number;
  };
  timeZone: string; locale: string; defaultCountryCode: string | null;
  branding: { displayName: string; primaryColor: string | null; secondaryColor?: string | null; logoUrl: string | null };
  options: { enquiryTypes: Option[]; regions: Option[]; areas: Record<string, Option[]>; budgetRanges: Option[] };
  consentLabel: string;
};
export type PublicSlot = { start: string; end: string };
export type BookingLink = { source?: string; channel?: string; placement?: string; utm?: Record<string, string> };
export type BookingResult = { received: true; status: "confirmed" | "pending" | "received"; bookingId?: string; start?: string; end?: string; manageToken?: string; managePath?: string };

export type ManageView = {
  booking: { status: BookingStatus; version: number; start: string; end: string; visitorTimeZone: string; visitorName: string; canChange: boolean; reason: string | null };
  type: { name: string; slug: string; durationMinutes: number; locationKind: LocationKind; locationDetail: string | null; windowDays: number };
  timeZone: string; locale: string;
  branding: { displayName: string; primaryColor: string | null; logoUrl: string | null };
};

export type BookingStatus = "pending" | "confirmed" | "cancelled" | "completed" | "no_show";

export type BookingTypeRecord = {
  id: string; name: string; slug: string; durationMinutes: number; color: string; locationKind: LocationKind; locationDetail: string | null;
  bufferBeforeMinutes: number; bufferAfterMinutes: number; minimumNoticeMinutes: number; windowDays: number; maxPerDay: number | null;
  slotStepMinutes: number; cancelNoticeMinutes: number; questions: BookingQuestion[]; enquiryType: string | null; source: string; channel: string;
  hostsMode: "one" | "round_robin" | "enquiry_type"; confirmation: "automatic" | "approval"; active: boolean; version: number;
  hosts: Array<{ membershipId: string; enquiryType: string | null; position: number; name?: string }>; upcoming?: number;
};
export type BookingTypesData = {
  data: BookingTypeRecord[]; members: Array<{ membershipId: string; name: string }>; timeZone: string; publicSlug: string | null;
  options: { enquiryTypes: Option[]; sources: Option[]; channels: Record<string, Option[]>; hasRegions: boolean };
};
export type StaffBooking = {
  id: string; status: BookingStatus; version: number; startsAt: string; endsAt: string; visitorTimeZone: string; visitorName: string;
  typeId: string; typeName: string; color: string; hostMembershipId: string; hostName: string; enquiryReference: string | null; leadId: string | null;
  source: string; channel: string; placement: string | null;
};

/** A date on a given clock, as YYYY-MM-DD. */
export function dateIn(instant: string | Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA-u-nu-latn", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Calendar arithmetic on YYYY-MM-DD. */
export function shiftDate(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Free slots grouped by the visitor's own date (a firm's evening can be the visitor's next morning). */
export function slotsByDay(slots: PublicSlot[], timeZone: string) {
  const days = new Map<string, PublicSlot[]>();
  for (const slot of [...slots].sort((a, b) => a.start.localeCompare(b.start))) {
    const day = dateIn(slot.start, timeZone);
    days.set(day, [...(days.get(day) ?? []), slot]);
  }
  return [...days.entries()].map(([date, items]) => ({ date, slots: items }));
}

/** The firm-local date range the page asks for: today through the booking window (at most two months a request). */
export function slotRange(today: string, windowDays: number) {
  return { from: today, to: shiftDate(today, Math.min(Math.max(windowDays, 1), 60)) };
}

export function formatTime(instant: string, timeZone: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(instant));
}

export function formatDay(date: string, locale: string, style: "short" | "long" = "short") {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, style === "long" ? { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" } : { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

/** A day button's two lines: the weekday, then the day and month. */
export function dayParts(date: string, locale: string) {
  const [year, month, day] = date.split("-").map(Number);
  const at = new Date(Date.UTC(year, month - 1, day));
  return {
    weekday: new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(at),
    date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(at),
  };
}

/** "Asia/Dubai" → "Dubai", with current names for renamed zones (the design system's one rule). */
export { timeZoneCity as zoneCity } from "@/design-system/foundations/time-zone-name";

export function sameZone(a: string, b: string) {
  const canonical = (zone: string) => { try { return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone; } catch { return zone; } };
  return a === b || canonical(a) === canonical(b);
}

/** The visitor's zone from the browser, else the firm's. */
export function browserZone(fallback: string) {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || fallback; } catch { return fallback; }
}

/** Source, channel, placement and UTM from a shared link; the server checks them again. */
export function linkFromQuery(query: Record<string, string | string[] | undefined>): BookingLink | undefined {
  const pick = (key: string, pattern = /^[a-z0-9][a-z0-9_-]{0,59}$/) => typeof query[key] === "string" && pattern.test(query[key] as string) ? query[key] as string : undefined;
  const utm = Object.fromEntries(["source", "medium", "campaign", "content", "term"]
    .map((key) => [key, pick(`utm_${key}`, /^[\w .:/-]{1,160}$/)]).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const link: BookingLink = { source: pick("source"), channel: pick("channel"), placement: pick("placement"), ...(Object.keys(utm).length ? { utm } : {}) };
  return link.source || link.channel || link.placement || link.utm ? link : undefined;
}

/** The share link for a booking type, with its placement and preset source and channel. */
export function shareUrl(origin: string, slug: string, typeSlug: string, preset: { source?: string; channel?: string; placement?: string } = {}) {
  const params = new URLSearchParams(Object.entries(preset).filter((entry): entry is [string, string] => Boolean(entry[1])));
  return `${origin}/book/${slug}/${typeSlug}${params.size ? `?${params}` : ""}`;
}

export function iframeSnippet(url: string, title: string) {
  return `<iframe src="${url}${url.includes("?") ? "&" : "?"}embed=1" title="${title.replace(/"/g, "&quot;")}" width="100%" height="760" loading="lazy" style="border:0"></iframe>`;
}

export function popupSnippet(origin: string, url: string, label: string) {
  return `<script src="${origin}/book/embed.js" data-url="${url}" data-label="${label.replace(/"/g, "&quot;")}" async></script>`;
}
