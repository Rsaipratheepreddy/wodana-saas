import { describe, expect, it } from "vitest";
import { checkContact, statusForOutcome, unansweredNote } from "./contact-outcomes";

describe("contact outcomes (PLM-042, PLM-076, S-16)", () => {
  it("moves the enquiry by outcome", () => {
    expect(statusForOutcome("no_answer")).toBe("attempting_contact");
    expect(statusForOutcome("message_sent_no_reply")).toBe("attempting_contact");
    expect(statusForOutcome("willing_to_talk")).toBe("connected");
    expect(statusForOutcome("come_back_later")).toBe("paused");
    expect(statusForOutcome("not_interested")).toBe("disqualified");
  });
  it("needs a note for a conversation; not interested needs a reason; come back later needs a future follow-up", () => {
    const now = new Date("2026-09-26T10:00:00Z");
    expect(() => checkContact({ outcome: "willing_to_talk", note: "  " }, now)).toThrow(/Add a note/);
    expect(() => checkContact({ outcome: "not_interested", note: "Called" }, now)).toThrow(/reason/);
    expect(() => checkContact({ outcome: "come_back_later", note: "Wants to think" }, now)).toThrow(/follow-up date in the future/);
    expect(() => checkContact({ outcome: "come_back_later", note: "Wants to think", nextActionAt: "2026-09-25T10:00:00Z" }, now)).toThrow(/future/);
    expect(checkContact({ outcome: "come_back_later", note: " Wants  to think ", nextActionAt: "2026-10-01T09:00:00Z" }, now)).toEqual({ note: "Wants to think", next: new Date("2026-10-01T09:00:00Z") });
  });
  it("logs an unanswered try in one tap, without a typed note", () => {
    expect(checkContact({ outcome: "no_answer" })).toEqual({ note: "", next: null });
    expect(checkContact({ outcome: "message_sent_no_reply", note: " " })).toEqual({ note: "", next: null });
    expect(unansweredNote("no_answer", 3)).toBe("No answer · attempt 3");
    expect(unansweredNote("message_sent_no_reply", 1)).toBe("Message sent, no reply · attempt 1");
  });

  it("closes an enquiry the client never answered as unreachable, noted for the person, no reason needed (S-28)", () => {
    expect(statusForOutcome("unreachable")).toBe("disqualified");
    expect(checkContact({ outcome: "unreachable" })).toEqual({ note: "", next: null });
    expect(unansweredNote("unreachable", 4)).toBe("Unreachable · attempt 4");
  });
});
