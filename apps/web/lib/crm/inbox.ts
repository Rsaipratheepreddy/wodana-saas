import { tKey, type MessageKey } from "@/lib/i18n/keys";
import { zonedToUtc, zonedToday } from "./zoned-time";

/** The team inbox's vocabulary, shared with business-core (crm/conversations/inbox/inbox-rules.ts). */
export type InboxView = "mine" | "unassigned" | "team" | "all";
export type ChatState = "open" | "snoozed" | "closed";
export type LabelColor = "viz-1" | "viz-2" | "viz-3" | "viz-4" | "viz-5" | "viz-6";
export const LABEL_COLORS: LabelColor[] = ["viz-1", "viz-2", "viz-3", "viz-4", "viz-5", "viz-6"];

export type InboxLabel = { id: string; name: string; color: LabelColor; status?: "active" | "archived"; version?: number; openChats?: number };
export type InboxOwner = { id: string; displayName: string; openChats: number; away: boolean; isMe: boolean };
export type InboxSummary = { mine: number; unassigned: number; team: number | null; all: number; snoozed: number; unreadForMe: number; membershipId: string | null };
export type QuickReply = { id: string; shortcut: string; body: string; status: "active" | "archived"; version: number; scope: "workspace" | "personal"; canEdit: boolean };
export type InboxTemplate = {
  id: string; code: string; locale: string; body: string; positions: number[]; usable: boolean;
  variables: Array<{ position: number; source: TemplateSource }>; mappingVersion: number;
  /** Sendable: approved here and at Meta. */
  approved?: boolean; providerStatus?: "submitting" | "pending" | "approved" | "rejected" | "paused" | "disabled"; providerReason?: string | null;
  category?: string | null; quality?: string | null; starterKey?: string | null;
};
export type InboxSettings = {
  autoAssign: boolean; queueId: string | null; signatureEnabled: boolean; version: number; canManage: boolean;
  queues: Array<{ id: string; name: string; isFallback: boolean }>;
  whatsapp: { connected: boolean; number: string | null; accountName: string | null };
  seats: number; businessName: string | null;
  workday: { start: string | null; days: number[] | null };
};
export type ChatEvent = {
  id: string; kind: "resolved" | "reopened" | "snoozed" | "woke" | "assigned" | "unassigned" | "labelled" | "unlabelled" | "linked";
  method: string | null; reason: string | null; snoozedUntil: string | null; createdAt: string;
  actorName: string | null; ownerName: string | null; labelName: string | null; labelColor: LabelColor | null;
};
export type ChatContext = {
  conversationId: string; leadId: string | null;
  party: { id: string; name: string; type: string; contacts: Array<{ type: string; value: string }> } | null;
  enquiries: Array<{ id: string; reference: string; status: string; createdAt: string; ownerName: string | null }> | null;
  opportunities: Array<{ id: string; reference: string; title: string; status: string; stageName: string | null; ownerName: string | null }> | null;
  projects: Array<{ id: string; reference: string | null; name: string; status: string; promiseDate: string | null; managerName: string | null }> | null;
  variables: Partial<Record<TemplateSource, string | null>>;
};

export const TEMPLATE_SOURCES = [
  "contact.first_name", "contact.name", "enquiry.reference", "opportunity.reference", "project.name", "project.stage",
  "quote.number", "invoice.number", "invoice.total", "invoice.due_date", "payment.amount", "portal.link", "staff.first_name", "business.name", "today.date",
] as const;
export type TemplateSource = (typeof TEMPLATE_SOURCES)[number];
/** What each source is called in the mapping and in a blocked send (i18n keys). */
export const TEMPLATE_SOURCE_LABELS: Record<TemplateSource, MessageKey> = {
  "contact.first_name": tKey("Client first name"), "contact.name": tKey("Client name"), "enquiry.reference": tKey("Enquiry reference"),
  "opportunity.reference": tKey("Opportunity reference"), "project.name": tKey("Project name"), "quote.number": tKey("Quote number"),
  "invoice.number": tKey("Invoice number"), "invoice.total": tKey("Invoice amount"), "portal.link": tKey("Client portal link"),
  "project.stage": tKey("Project stage"), "invoice.due_date": tKey("Invoice due date"), "payment.amount": tKey("Payment amount"),
  "staff.first_name": tKey("Your first name"), "business.name": tKey("Business name"), "today.date": tKey("Today's date"),
};

const PLACEHOLDER = /\{\{\s*(\d{1,2})\s*\}\}/g;

/** The body as the client will read it: each {{n}} replaced by its value, or left visible when it has none. */
export function renderTemplate(body: string, parameters: ReadonlyArray<string | null | undefined>) {
  return body.replace(PLACEHOLDER, (all, position: string) => parameters[Number(position) - 1] || all);
}

/** A template's values from its mapping and the chat's records; `missing` names each position without one. */
export function fillTemplate(template: Pick<InboxTemplate, "positions" | "variables">, values: ChatContext["variables"]) {
  const parameters: string[] = [];
  const missing: Array<{ position: number; source: TemplateSource | null }> = [];
  for (const position of template.positions) {
    const source = template.variables.find((variable) => variable.position === position)?.source ?? null;
    const value = source ? values[source]?.trim() : "";
    if (!value) missing.push({ position, source });
    parameters.push(value ?? "");
  }
  return { parameters, missing };
}

/** Quick replies use named fields ({{contact.first_name}}); a field without a value stays visible to fill by hand. */
export function fillQuickReply(body: string, values: ChatContext["variables"]) {
  return body.replace(/\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/g, (all, key: string) => (TEMPLATE_SOURCES as readonly string[]).includes(key) ? values[key as TemplateSource] || all : all);
}

/** The quick replies matching what follows "/" at the start of the draft; null when the draft isn't a "/" search. */
export function quickReplyQuery(draft: string) {
  const match = /^\/(\S*)$/.exec(draft);
  return match ? match[1].toLowerCase() : null;
}

/** Minutes since the oldest unanswered client message. */
export function waitingMinutes(since: unknown, now: number) {
  const at = typeof since === "string" ? Date.parse(since) : NaN;
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 60_000)) : null;
}

/** "42 m", "3 h", "2 d": the unit is part of the translated label. */
export function waitingParts(minutes: number) {
  if (minutes < 60) return { key: tKey("Waiting {count} m"), count: minutes };
  if (minutes < 48 * 60) return { key: tKey("Waiting {count} h"), count: Math.floor(minutes / 60) };
  return { key: tKey("Waiting {count} d"), count: Math.floor(minutes / 1440) };
}

/** Milliseconds left in WhatsApp's 24-hour window, or 0 once it has closed. */
export function windowLeft(closesAt: unknown, now: number) {
  const at = typeof closesAt === "string" ? Date.parse(closesAt) : NaN;
  return Number.isFinite(at) ? Math.max(0, at - now) : 0;
}

const DAY = 86_400_000;
function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
function weekday(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Snooze choices in the workspace's own calendar: in an hour, the next working morning, and the first
 * working morning of next week. Working days use 0 = Sunday; the start of day comes from the work calendar.
 */
export function snoozePresets(options: { now: Date; timeZone: string; dayStart?: string | null; workingDays?: number[] | null; weekStartsOn?: number }) {
  const { now, timeZone } = options;
  const start = /^\d{2}:\d{2}$/.test(options.dayStart ?? "") ? options.dayStart! : "09:00";
  const days = options.workingDays?.length ? options.workingDays : [1, 2, 3, 4, 5];
  const today = zonedToday(timeZone, now);
  const nextWorking = (from: string) => { let date = from; for (let step = 0; step < 14 && !days.includes(weekday(date)); step++) date = addDays(date, 1); return date; };
  const tomorrow = nextWorking(addDays(today, 1));
  const weekStart = options.weekStartsOn ?? days.slice().sort((a, b) => a - b)[0];
  let nextWeek = addDays(today, 1);
  while (weekday(nextWeek) !== weekStart) nextWeek = addDays(nextWeek, 1);
  nextWeek = nextWorking(nextWeek);
  return [
    { id: "hour", label: tKey("In 1 hour"), until: new Date(now.getTime() + 3_600_000).toISOString() },
    { id: "tomorrow", label: tKey("Next working morning"), until: zonedToUtc(tomorrow, start, timeZone) ?? new Date(now.getTime() + DAY).toISOString() },
    { id: "next-week", label: tKey("Next week"), until: zonedToUtc(nextWeek, start, timeZone) ?? new Date(now.getTime() + 7 * DAY).toISOString() },
  ];
}

/** After a chat is resolved or snoozed, the next one in the list opens (the one below, else the one above). */
export function nextChatId(ids: readonly string[], current: string) {
  const index = ids.indexOf(current);
  if (index < 0) return ids[0] ?? null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

/** The label of a chat's history line (an i18n key and its values). */
export function eventLine(event: ChatEvent): { key: MessageKey; values: Record<string, string> } {
  const actor = event.actorName ?? "";
  const byWho = !event.actorName;
  switch (event.kind) {
    case "resolved": return { key: tKey("{actor} resolved this chat"), values: { actor } };
    case "reopened": return event.method === "client_replied" ? { key: tKey("The client wrote again, so this chat is open"), values: {} } : { key: tKey("{actor} reopened this chat"), values: { actor } };
    case "snoozed": return { key: tKey("{actor} snoozed this chat"), values: { actor } };
    case "woke": return { key: tKey("This chat is back from snooze"), values: {} };
    case "assigned": return byWho ? { key: tKey("Assigned to {owner} automatically"), values: { owner: event.ownerName ?? "" } } : { key: tKey("{actor} assigned this chat to {owner}"), values: { actor, owner: event.ownerName ?? "" } };
    case "unassigned": return { key: tKey("{actor} unassigned this chat"), values: { actor } };
    case "labelled": return { key: tKey("{actor} added the label {label}"), values: { actor, label: event.labelName ?? "" } };
    case "unlabelled": return { key: tKey("{actor} removed the label {label}"), values: { actor, label: event.labelName ?? "" } };
    case "linked": return { key: tKey("{actor} linked this chat to an enquiry"), values: { actor } };
  }
}
