import { tKey, type MessageKey, type Translate } from "@/lib/i18n/keys";

export const CONTACT_OUTCOMES = ["no_answer", "message_sent_no_reply", "willing_to_talk", "come_back_later", "not_interested", "unreachable"] as const;
export const CONTACT_CHANNELS = ["call", "whatsapp", "email", "meeting", "sms"] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];
/** Tries that reached nobody: the note is optional and each one is counted (S-16). */
export const UNANSWERED_OUTCOMES: readonly ContactOutcome[] = ["no_answer", "message_sent_no_reply", "unreachable"];
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

const CHANNEL_LABELS: Record<ContactChannel, MessageKey> = { call: tKey("Call"), whatsapp: tKey("WhatsApp"), email: tKey("Email"), meeting: tKey("Meeting"), sms: tKey("SMS") };
const OUTCOME_LABELS: Record<ContactOutcome, MessageKey> = {
  no_answer: tKey("No answer"), message_sent_no_reply: tKey("Message sent, no reply"), willing_to_talk: tKey("Willing to talk"),
  come_back_later: tKey("Come back later"), not_interested: tKey("Not interested"), unreachable: tKey("Unreachable"),
};

/** A logged contact reads "Call · Willing to talk" in the reader's language; any other activity keeps its own title. */
export function activityTitle(item: { type?: unknown; title?: unknown; completionOutcome?: unknown } | Record<string, unknown>, t: Translate): string {
  const channel = CONTACT_CHANNELS.find((value) => value === item.type);
  const outcome = CONTACT_OUTCOMES.find((value) => value === item.completionOutcome);
  return channel && outcome ? `${t(CHANNEL_LABELS[channel])} · ${t(OUTCOME_LABELS[outcome])}` : String(item.title ?? "");
}

export type LoggedContact = { id?: string; status: string; version: number; nextActionAt: string | null; updatedAt?: string; contactAttempts?: number };

export async function logLeadContact(workspaceId: string, leadId: string, input: { version: number; channel: ContactChannel; outcome: ContactOutcome; note?: string; reason?: string; nextActionAt?: string }) {
  const response = await fetch(`/api/workspace/crm/leads/${leadId}/contacts`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, ...input }),
  });
  const payload = await response.json().catch(() => null) as (LoggedContact & { message?: string; lead?: LoggedContact }) | null;
  if (!response.ok || !payload) throw new Error(payload?.message ?? tKey("The contact could not be logged."));
  return { ...(payload.lead ?? payload), contactAttempts: payload.contactAttempts ?? payload.lead?.contactAttempts };
}
