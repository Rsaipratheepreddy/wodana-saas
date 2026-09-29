/**
 * Auto replies without a database: when a client's WhatsApp message gets the greeting or the away message,
 * business hours in the workspace's own time zone and working week, and how the message's fields are filled.
 * The service (auto-replies.ts) reads the facts; the web shares the same vocabulary (apps/web/lib/crm/inbox.ts).
 */
export const AUTO_REPLY_KINDS = ["greeting", "away"] as const;
export type AutoReplyKind = (typeof AUTO_REPLY_KINDS)[number];

/** Fields an auto reply can use, written like quick replies: {{contact.first_name}}. */
export const AUTO_REPLY_FIELDS = ["contact.first_name", "contact.name", "business.name"] as const;
export type AutoReplyField = (typeof AUTO_REPLY_FIELDS)[number];

export const DEFAULT_GREETING_TEXT = "Hi {{contact.first_name}}, thanks for contacting {{business.name}}. We have received your message and will reply shortly.";
export const DEFAULT_AWAY_TEXT = "Hi {{contact.first_name}}, thanks for your message. We are away right now and will reply as soon as we are back.";
export const DEFAULT_SILENCE_DAYS = 14;
export const DEFAULT_AWAY_WINDOW_HOURS = 12;
/** A teammate who replied this recently is talking to the client; no automatic message cuts in. */
export const HUMAN_QUIET_MINUTES = 5;
/** Used only when neither the settings nor the work calendar say when the day starts and ends. */
export const FALLBACK_DAY = { start: "09:00", end: "18:00" } as const;
export const MAX_AUTO_REPLY_LENGTH = 1024;

/** Message kinds that are not something to answer (a reaction to our message, a system notice). */
const NOT_A_MESSAGE = new Set(["reaction", "system", "unsupported", "ephemeral"]);

export type BusinessHours = {
  timeZone: string;
  /** 0 = Sunday … 6 = Saturday. */
  workingDays: number[];
  /** "HH:MM", wall clock in the time zone; an end at or before the start runs past midnight. */
  start: string;
  end: string;
  /** Whole days off (YYYY-MM-DD in the time zone). */
  holidays?: string[];
};

export type AutoReplyRule = {
  greeting: { enabled: boolean; text: string; silenceDays: number };
  away: { enabled: boolean; text: string; windowHours: number };
  hours: BusinessHours;
};

export type AutoReplyFacts = {
  now: Date;
  channel: string;
  direction: string;
  messageType?: string | null;
  blocked: boolean;
  spam: boolean;
  /** An auto reply already answered this very message. */
  alreadyAnswered: boolean;
  /** The last message in the chat before this one (either way, notes aside); null when this is the first. */
  previousActivityAt: Date | null;
  /** When a person last replied (from Wodana or the phone app). */
  lastHumanReplyAt: Date | null;
  /** When this chat last got the away message. */
  lastAwayAt: Date | null;
};

export type AutoReplySkip = "not_inbound" | "channel" | "blocked" | "duplicate" | "not_a_message" | "human_active" | "nothing_due";
export type AutoReplyDecision = { send: true; kind: AutoReplyKind } | { send: false; reason: AutoReplySkip };

/** A valid IANA time zone, else null. */
export function validTimeZone(zone: string | null | undefined) {
  if (!zone) return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(0); return zone; } catch { return null; }
}

const minutesOf = (clock: string) => { const [hour, minute] = clock.split(":").map(Number); return hour * 60 + minute; };

/** The wall-clock date, weekday (0 = Sunday) and minutes past midnight of a moment in a time zone. */
export function zonedParts(at: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(at).map((part) => [part.type, part.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}

const previousDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * Whether the business is open at a moment: a working day that is not a holiday, between the start and the end
 * of the day in the workspace's time zone. A day that ends after midnight (22:00–06:00) belongs to the day it
 * started on.
 */
export function withinBusinessHours(at: Date, hours: BusinessHours) {
  const timeZone = validTimeZone(hours.timeZone) ?? "UTC";
  const { date, weekday, minutes } = zonedParts(at, timeZone);
  const start = minutesOf(hours.start), end = minutesOf(hours.end);
  const days = new Set(hours.workingDays);
  const off = new Set(hours.holidays ?? []);
  const open = (day: number, onDate: string) => days.has(day) && !off.has(onDate);
  if (start < end) return open(weekday, date) && minutes >= start && minutes < end;
  // Past midnight: open from the start on a working day, or before the end on the morning after one.
  return (open(weekday, date) && minutes >= start) || (open((weekday + 6) % 7, previousDate(date)) && minutes < end);
}

/** The greeting goes to a client's first message, or the first after `silenceDays` without a message either way. */
export function greetingDue(previousActivityAt: Date | null, now: Date, silenceDays: number) {
  return !previousActivityAt || now.getTime() - previousActivityAt.getTime() >= silenceDays * 86_400_000;
}

/** The away message goes outside business hours, at most once per chat in each window. */
export function awayDue(at: Date, hours: BusinessHours, lastAwayAt: Date | null, windowHours: number) {
  if (withinBusinessHours(at, hours)) return false;
  return !lastAwayAt || at.getTime() - lastAwayAt.getTime() >= windowHours * 3_600_000;
}

/**
 * Which auto reply (if any) a client's message gets. Never to a note, another channel, a blocked or spam number, a
 * reaction, a message already answered, or while a teammate is talking to the client. Outside hours the away
 * message wins (it says when we answer); otherwise the greeting, when due. One reply per message at most.
 */
export function decideAutoReply(rule: AutoReplyRule, facts: AutoReplyFacts): AutoReplyDecision {
  if (facts.direction !== "inbound") return { send: false, reason: "not_inbound" };
  if (facts.channel !== "whatsapp") return { send: false, reason: "channel" };
  if (facts.blocked || facts.spam) return { send: false, reason: "blocked" };
  if (facts.alreadyAnswered) return { send: false, reason: "duplicate" };
  if (facts.messageType && NOT_A_MESSAGE.has(facts.messageType)) return { send: false, reason: "not_a_message" };
  if (facts.lastHumanReplyAt && facts.now.getTime() - facts.lastHumanReplyAt.getTime() < HUMAN_QUIET_MINUTES * 60_000) return { send: false, reason: "human_active" };
  const away = rule.away.enabled && rule.away.text.trim().length > 0;
  const greeting = rule.greeting.enabled && rule.greeting.text.trim().length > 0;
  if (away && awayDue(facts.now, rule.hours, facts.lastAwayAt, rule.away.windowHours)) return { send: true, kind: "away" };
  if (greeting && greetingDue(facts.previousActivityAt, facts.now, rule.greeting.silenceDays)) return { send: true, kind: "greeting" };
  return { send: false, reason: "nothing_due" };
}

const FIELD = /\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/g;

/** Field names written in a message that auto replies can't fill. */
export function unknownAutoReplyFields(text: string) {
  return [...new Set([...text.matchAll(FIELD)].map((match) => match[1]).filter((name) => !(AUTO_REPLY_FIELDS as readonly string[]).includes(name)))];
}

/**
 * The message as the client reads it. A field without a value is left out and the sentence closed up
 * ("Hi {{contact.first_name}}, thanks" becomes "Hi, thanks"), so nobody receives a raw placeholder.
 */
export function renderAutoReply(text: string, values: Partial<Record<AutoReplyField, string | null>>) {
  return text
    .replace(FIELD, (_all, name: string) => ((AUTO_REPLY_FIELDS as readonly string[]).includes(name) ? values[name as AutoReplyField]?.trim() ?? "" : ""))
    .replace(/[ \t]+([,.!?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .trim();
}
