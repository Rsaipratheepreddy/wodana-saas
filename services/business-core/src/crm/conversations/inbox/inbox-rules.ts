/**
 * Team inbox rules that need no database: chat states, label colours, template placeholders and their
 * values, the optional signature, and the text of a staff notice. The service and the web share the
 * same vocabulary (see apps/web/lib/crm/inbox.ts).
 */
export const CONVERSATION_STATES = ["open", "snoozed", "closed"] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];

export const INBOX_VIEWS = ["mine", "unassigned", "team", "all"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

/** Semantic chart colours from the design tokens (--wd-color-viz-1..6); never raw values. */
export const LABEL_COLORS = ["viz-1", "viz-2", "viz-3", "viz-4", "viz-5", "viz-6"] as const;

/** What can fill a WhatsApp template's {{n}}, always read from the chat's own records. */
export const TEMPLATE_VARIABLE_SOURCES = [
  "contact.first_name", "contact.name", "enquiry.reference", "opportunity.reference", "project.name", "project.stage",
  "quote.number", "invoice.number", "invoice.total", "invoice.due_date", "payment.amount", "portal.link", "staff.first_name", "business.name", "today.date",
] as const;
export type TemplateVariableSource = (typeof TEMPLATE_VARIABLE_SOURCES)[number];

export const MAX_SNOOZE_DAYS = 90;
export const MAX_TEMPLATE_PARAMETER_LENGTH = 1024;

const PLACEHOLDER = /\{\{\s*(\d{1,2})\s*\}\}/g;

/** The distinct {{n}} positions of a provider template body, ascending. */
export function templatePlaceholders(body: string): number[] {
  const positions = new Set<number>();
  for (const match of body.matchAll(PLACEHOLDER)) positions.add(Number(match[1]));
  return [...positions].sort((a, b) => a - b);
}

/** A template's placeholders are usable when they are exactly {{1}}…{{n}} (Meta's own rule). */
export function placeholdersAreContiguous(positions: number[]) {
  return positions.every((position, index) => position === index + 1);
}

/** Meta refuses new lines, tabs and more than four spaces in a row inside a parameter. */
export function normalizeTemplateParameter(value: string) {
  return value.replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim();
}

/** The body as the client receives it: every {{n}} replaced by its value. */
export function renderTemplate(body: string, parameters: readonly string[]) {
  return body.replace(PLACEHOLDER, (all, position: string) => parameters[Number(position) - 1] ?? all);
}

/** Null when the values fit the template; otherwise the reason, naming the first position at fault. */
export function templateParametersProblem(positions: number[], parameters: readonly string[]): string | null {
  if (!placeholdersAreContiguous(positions)) return "This template's variables are not numbered 1, 2, 3…";
  if (parameters.length !== positions.length) return `This template needs ${positions.length} value${positions.length === 1 ? "" : "s"}`;
  const empty = parameters.findIndex((value) => !value.trim());
  if (empty >= 0) return `Fill in {{${empty + 1}}}`;
  const long = parameters.findIndex((value) => value.length > MAX_TEMPLATE_PARAMETER_LENGTH);
  if (long >= 0) return `{{${long + 1}}} is longer than ${MAX_TEMPLATE_PARAMETER_LENGTH} characters`;
  return null;
}

/** The first name of a person, or null for the placeholder name an unknown WhatsApp number gets. */
export function firstName(displayName: string | null | undefined): string | null {
  const name = (displayName ?? "").trim();
  if (!name || /^whatsapp\s*\+?\d/i.test(name) || /^\+?\d[\d\s-]+$/.test(name)) return null;
  return name.split(/\s+/)[0] || null;
}

/** "— Sara" under a free-text reply when the firm turned the signature on; the client sees one business number. */
export function withSignature(body: string, senderName: string | null | undefined, enabled: boolean) {
  const name = firstName(senderName);
  if (!enabled || !name) return body;
  const signature = `— ${name}`;
  return body.trimEnd().endsWith(signature) ? body : `${body.trimEnd()}\n${signature}`;
}

/** A snooze must end in the future and within the limit. */
export function snoozeProblem(until: Date, now = new Date()): string | null {
  if (Number.isNaN(until.getTime())) return "Choose when this chat comes back";
  if (until.getTime() <= now.getTime() + 60_000) return "Choose a time in the future";
  if (until.getTime() > now.getTime() + MAX_SNOOZE_DAYS * 86_400_000) return `Snooze for at most ${MAX_SNOOZE_DAYS} days`;
  return null;
}

const MEDIA_WORDS: Record<string, [string, string]> = {
  image: ["a photo", "photos"], video: ["a video", "videos"], audio: ["a voice note", "voice notes"],
  document: ["a document", "documents"], sticker: ["a sticker", "stickers"], location: ["a location", "locations"],
};

/** The body of the one notice a chat raises: the message itself, or a count while more arrive. */
export function inboundSummary(unread: number, lastText: string | null | undefined, kinds: readonly string[] = []) {
  const count = Math.max(1, unread);
  const onlyKind = kinds.length && kinds.every((kind) => kind === kinds[0]) ? kinds[0] : null;
  const words = onlyKind ? MEDIA_WORDS[onlyKind] : undefined;
  if (count === 1) {
    const text = (lastText ?? "").replace(/\s+/g, " ").trim();
    if (words && (!text || / received$/i.test(text))) return `Sent ${words[0]}`;
    return text ? (text.length > 140 ? `${text.slice(0, 139)}…` : text) : "New message";
  }
  return words ? `Sent ${count} ${words[1]}` : `${count} new messages`;
}
