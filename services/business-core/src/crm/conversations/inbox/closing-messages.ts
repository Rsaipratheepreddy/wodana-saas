import type { PoolClient } from "pg";
import { addSlaMinutes, SLA_DAY_KEYS, type SlaSchedule } from "../../leads/sla-schedule";
import { salesSchedule } from "../../leads/sales-attention";
import { workspaceHours } from "./auto-replies";
import type { TemplateVariableSource } from "./inbox-rules";

type Db = Pick<PoolClient, "query">;

/**
 * The inbox's three closing messages (PLM-137), one workspace text each, with {{name}} and {{form_link}} filled in:
 *   received  "We have everything": also what goes automatically when an enquiry is created (the client message
 *             "Welcome on a new enquiry"); sending it resolves the chat.
 *   form      "Please complete the form": {{form_link}} is the firm's enquiry form; the chat waits (Unresolved).
 *   closing   "Closing the chat": offered only after the firm's quiet working hours with no reply from the client
 *             to our last message, sent only by someone allowed (crm.inbox.close_chats) after a confirmation, never
 *             automatically; sending it resolves the chat.
 * Inside WhatsApp's 24-hour window the text goes as it is; outside it, its approved WhatsApp template (the firm
 * submits it with the starter templates), else the send is refused with the reason.
 */
export const CLOSING_KINDS = ["received", "form", "closing"] as const;
export type ClosingKind = (typeof CLOSING_KINDS)[number];

/** The fields a closing text may use, and the record field each fills. */
export const CLOSING_FIELDS: Record<string, TemplateVariableSource> = { name: "contact.first_name", form_link: "form.link" };

/** The product's wording until the firm writes its own (Settings › Inbox › Closing messages). */
export const DEFAULT_CLOSING_TEXTS: Record<ClosingKind, string> = {
  received: "Thank you, {{name}}! Your enquiry is now with our team, and we will contact you shortly.",
  form: "Hi {{name}}, to take your enquiry forward, please complete this short form: {{form_link}} Once we receive it, our team will be in touch.",
  closing: "Hi {{name}}, we haven't heard back from you, so we will close this chat for now. If you would like to continue, simply message us here anytime and we will be happy to help.",
};
export const DEFAULT_CLOSING_AFTER_HOURS = 3;

/** The WhatsApp template (Meta name) each closing message goes as outside the 24-hour window. */
export const CLOSING_TEMPLATE_CODES: Record<ClosingKind, string> = { received: "wd_chat_received", form: "wd_chat_form", closing: "wd_chat_closing" };
export const closingKindOfTemplate = (code: string) => CLOSING_KINDS.find((kind) => CLOSING_TEMPLATE_CODES[kind] === code) ?? null;

/** The state a chat takes once the message went: handled, or waiting for the client's form. */
export const CLOSING_STATE: Record<ClosingKind, "closed" | "unresolved"> = { received: "closed", form: "unresolved", closing: "closed" };

const FIELD = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Fields a closing text uses that it can't fill. */
export function unknownClosingFields(text: string) {
  return [...new Set([...text.matchAll(FIELD)].map((match) => match[1]).filter((name) => !(name in CLOSING_FIELDS)))];
}

/** The fields a text uses, in the order they first appear. */
export function closingFieldsOf(text: string) {
  return [...new Set([...text.matchAll(FIELD)].map((match) => match[1]).filter((name) => name in CLOSING_FIELDS))];
}

/**
 * The text as the client reads it. A name the chat doesn't have is left out and the sentence closed up
 * ("Thank you, !" reads "Thank you!", "Hi , to" reads "Hi, to").
 */
export function renderClosing(text: string, values: Partial<Record<string, string | null>>) {
  return text
    .replace(FIELD, (_all, name: string) => values[name]?.trim() ?? "")
    .replace(/[ \t]+([,.!?;:])/g, "$1")
    .replace(/,([!.?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .trim();
}

/** The WhatsApp template a closing text becomes: its fields as {{1}}, {{2}}… in order, with the source each maps to. */
export function closingTemplate(text: string) {
  const fields = closingFieldsOf(text);
  const body = text.replace(FIELD, (all, name: string) => fields.includes(name) ? `{{${fields.indexOf(name) + 1}}}` : all).trim();
  return { body, sources: fields.map((name) => CLOSING_FIELDS[name]) };
}

export type ClosingSettings = { texts: Record<ClosingKind, string>; custom: Record<ClosingKind, boolean>; formUrl: string | null; afterHours: number; version: number };

/** The workspace's closing texts (its own, else the product's wording), the form link, the quiet hours and their version (0 before the first save). */
export async function readClosingSettings(db: Db, workspaceId: string): Promise<ClosingSettings> {
  const row = (await db.query<{ received: string | null; form: string | null; closing: string | null; formUrl: string | null; afterHours: number; version: number }>(
    `SELECT closing_received_text AS received, closing_form_text AS form, closing_close_text AS closing, closing_form_url AS "formUrl",
            closing_after_hours AS "afterHours", closing_version AS version
       FROM crm_inbox_settings WHERE workspace_id = $1`, [workspaceId])).rows[0];
  const own = { received: row?.received ?? null, form: row?.form ?? null, closing: row?.closing ?? null };
  return {
    texts: { received: own.received ?? DEFAULT_CLOSING_TEXTS.received, form: own.form ?? DEFAULT_CLOSING_TEXTS.form, closing: own.closing ?? DEFAULT_CLOSING_TEXTS.closing },
    custom: { received: own.received !== null, form: own.form !== null, closing: own.closing !== null },
    formUrl: row?.formUrl ?? null,
    afterHours: Number(row?.afterHours ?? DEFAULT_CLOSING_AFTER_HOURS),
    version: row ? Number(row.version) : 0,
  };
}

/**
 * The working time "Closing the chat" counts: the Sales working hours (the first-response policy's calendar) when the
 * firm set them, else the workspace's working week and hours (its work calendar, else its region pack) and holidays.
 */
export async function closingSchedule(db: Db, workspaceId: string): Promise<SlaSchedule> {
  const sales = await salesSchedule(db, workspaceId);
  if (sales.mode === "business") return sales;
  const hours = await workspaceHours(db, workspaceId);
  const days = hours.workingDays.filter((day) => day >= 0 && day <= 6);
  if (!days.length || hours.start >= hours.end) return { version: 1, mode: "elapsed" };
  return {
    version: 1, mode: "business", timezone: hours.timeZone,
    weeklyHours: Object.fromEntries(days.map((day) => [SLA_DAY_KEYS[day], [{ start: hours.start, end: hours.end }]])),
    holidays: hours.holidays, dateOverrides: {},
  };
}

/** From when "Closing the chat" may be offered: `hours` working hours after our last reply. */
export function closingDueAt(lastReplyAt: Date, hours: number, schedule: SlaSchedule) {
  return addSlaMinutes(lastReplyAt, Math.max(1, Math.round(hours)) * 60, schedule);
}

/** When we last wrote to the client ourselves in this chat (a reply, a template, a closing message, or from the phone); failed sends don't count. */
export async function lastReplyAt(db: Db, workspaceId: string, conversationId: string): Promise<Date | null> {
  const row = (await db.query<{ at: Date | null }>(
    `SELECT max(created_at) AS at FROM crm_messages
      WHERE workspace_id = $1 AND conversation_id = $2 AND direction = 'outbound' AND authorship IN ('human', 'provider') AND status <> 'failed'`,
    [workspaceId, conversationId])).rows[0];
  return row?.at ? new Date(row.at) : null;
}

/**
 * The chat's "Closing the chat" facts now: when it becomes due (our last reply plus the firm's quiet working hours)
 * and why it can't be sent yet, if it can't. Computed from the messages each time, so an old chat (from before
 * the status existed) reads the same as a new one.
 */
export async function closingFacts(db: Db, workspaceId: string, conversation: Record<string, unknown>, now = new Date()) {
  const settings = await readClosingSettings(db, workspaceId);
  const replied = await lastReplyAt(db, workspaceId, String(conversation.id));
  const dueAt = replied ? closingDueAt(replied, settings.afterHours, await closingSchedule(db, workspaceId)) : null;
  const problem = closingProblem({
    status: String(conversation.status), channel: String(conversation.channel),
    waitingSince: conversation.waiting_since ? new Date(conversation.waiting_since as string | Date) : null, lastReplyAt: replied, dueAt,
  }, now);
  return { settings, lastReplyAt: replied, dueAt, problem };
}

/**
 * Why "Closing the chat" can't be sent to this chat now, or null when it can. The chat must still be work (Open or
 * Unresolved), on a client channel, with no client message waiting for us (we replied after the client's last
 * message), and quiet for the firm's working hours since our last reply. Checked again at the moment it is sent,
 * so a client who replies at the last second is never told the chat is closed.
 */
export function closingProblem(chat: { status: string; channel: string; waitingSince: Date | null; lastReplyAt: Date | null; dueAt: Date | null }, now: Date): string | null {
  if (chat.status === "closed") return "This chat is already resolved.";
  if (chat.status === "spam") return "This chat is marked as spam.";
  if (chat.status === "snoozed") return "Wake this chat before closing it.";
  if (chat.channel === "internal") return "This is a team chat.";
  if (chat.waitingSince) return "The client is waiting for our reply.";
  if (!chat.lastReplyAt || !chat.dueAt) return "We haven't written to the client yet.";
  if (chat.dueAt.getTime() > now.getTime()) return "The client still has time to reply.";
  return null;
}
