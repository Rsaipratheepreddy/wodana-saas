import { UnprocessableEntityException } from "@nestjs/common";

/** PLM-042: every contact attempt is logged with one of these outcomes. */
export const CONTACT_OUTCOMES = ["no_answer", "message_sent_no_reply", "willing_to_talk", "come_back_later", "not_interested"] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];
export const CONTACT_CHANNELS = ["call", "whatsapp", "email", "meeting", "sms"] as const;

/** The enquiry status each outcome leads to. */
export function statusForOutcome(outcome: ContactOutcome) {
  if (outcome === "willing_to_talk") return "connected";
  if (outcome === "come_back_later") return "paused";
  if (outcome === "not_interested") return "disqualified";
  return "attempting_contact";
}

/** A note is always required; Not interested needs a reason; Come back later needs a future follow-up (PLM-076). */
export function checkContact(input: { outcome: ContactOutcome; note?: string; reason?: string; nextActionAt?: string }, now = new Date()) {
  const note = input.note?.replace(/\s+/g, " ").trim();
  if (!note) throw new UnprocessableEntityException("Add a note about this contact");
  if (input.outcome === "not_interested" && !input.reason?.trim()) throw new UnprocessableEntityException("Add the reason the client is not interested");
  let next: Date | null = null;
  if (input.nextActionAt) {
    next = new Date(input.nextActionAt);
    if (Number.isNaN(next.getTime())) throw new UnprocessableEntityException("The follow-up date is not valid");
  }
  if (input.outcome === "come_back_later" && (!next || next.getTime() <= now.getTime())) throw new UnprocessableEntityException("Book a follow-up date in the future for a client who needs time");
  return { note, next };
}
