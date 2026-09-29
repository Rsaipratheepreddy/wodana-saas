import { UnprocessableEntityException } from "@nestjs/common";

/** PLM-042: every contact attempt is logged with one of these outcomes. */
/** S-28: `unreachable` closes an enquiry the client never answered (reported in its own bucket, not as not interested). */
export const CONTACT_OUTCOMES = ["no_answer", "message_sent_no_reply", "willing_to_talk", "come_back_later", "not_interested", "unreachable"] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];
export const CONTACT_CHANNELS = ["call", "whatsapp", "email", "meeting", "sms"] as const;
/** The outcomes that are one more try without reaching the client; they count as attempts (S-16). */
export const UNANSWERED_OUTCOMES: readonly ContactOutcome[] = ["no_answer", "message_sent_no_reply", "unreachable"];
/** The reason an enquiry closed as unreachable carries, unless the person wrote their own. */
export const UNREACHABLE_REASON = "Unreachable";

/** The enquiry status each outcome leads to. */
export function statusForOutcome(outcome: ContactOutcome) {
  if (outcome === "willing_to_talk") return "connected";
  if (outcome === "come_back_later") return "paused";
  if (outcome === "not_interested" || outcome === "unreachable") return "disqualified";
  return "attempting_contact";
}

/**
 * A conversation needs a note; a try that reached nobody does not (S-16: one tap, noted for you).
 * Not interested needs a reason; Come back later needs a future follow-up (PLM-076).
 */
export function checkContact(input: { outcome: ContactOutcome; note?: string; reason?: string; nextActionAt?: string }, now = new Date()) {
  const note = input.note?.replace(/\s+/g, " ").trim() ?? "";
  if (!note && !UNANSWERED_OUTCOMES.includes(input.outcome)) throw new UnprocessableEntityException("Add a note about this contact");
  if (input.outcome === "not_interested" && !input.reason?.trim()) throw new UnprocessableEntityException("Add the reason the client is not interested");
  let next: Date | null = null;
  if (input.nextActionAt) {
    next = new Date(input.nextActionAt);
    if (Number.isNaN(next.getTime())) throw new UnprocessableEntityException("The follow-up date is not valid");
  }
  if (input.outcome === "come_back_later" && (!next || next.getTime() <= now.getTime())) throw new UnprocessableEntityException("Book a follow-up date in the future for a client who needs time");
  return { note, next };
}

/** "No answer · attempt 3": the note written for an unanswered try the person did not describe. */
export function unansweredNote(outcome: ContactOutcome, attempt: number) {
  return `${outcome === "no_answer" ? "No answer" : outcome === "unreachable" ? "Unreachable" : "Message sent, no reply"} · attempt ${attempt}`;
}
