export const CONTACT_OUTCOMES = ["no_answer", "message_sent_no_reply", "willing_to_talk", "come_back_later", "not_interested"] as const;
export const CONTACT_CHANNELS = ["call", "whatsapp", "email", "meeting", "sms"] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export type LoggedContact = { id?: string; status: string; version: number; nextActionAt: string | null; updatedAt?: string };

export async function logLeadContact(workspaceId: string, leadId: string, input: { version: number; channel: ContactChannel; outcome: ContactOutcome; note: string; reason?: string; nextActionAt?: string }) {
  const response = await fetch(`/api/workspace/crm/leads/${leadId}/contacts`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, ...input }),
  });
  const payload = await response.json().catch(() => null) as (LoggedContact & { message?: string; lead?: LoggedContact }) | null;
  if (!response.ok || !payload) throw new Error(payload?.message ?? "The contact could not be logged.");
  return payload.lead ?? payload;
}
