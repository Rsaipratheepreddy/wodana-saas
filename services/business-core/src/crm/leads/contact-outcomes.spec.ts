import { describe, expect, it } from "vitest";
import { checkContact, statusForOutcome } from "./contact-outcomes";

describe("contact outcomes (PLM-042, PLM-076)", () => {
  it("moves the enquiry by outcome", () => {
    expect(statusForOutcome("no_answer")).toBe("attempting_contact");
    expect(statusForOutcome("message_sent_no_reply")).toBe("attempting_contact");
    expect(statusForOutcome("willing_to_talk")).toBe("connected");
    expect(statusForOutcome("come_back_later")).toBe("paused");
    expect(statusForOutcome("not_interested")).toBe("disqualified");
  });
  it("always needs a note; not interested needs a reason; come back later needs a future follow-up", () => {
    const now = new Date("2026-09-26T10:00:00Z");
    expect(() => checkContact({ outcome: "no_answer", note: "  " }, now)).toThrow(/Add a note/);
    expect(() => checkContact({ outcome: "not_interested", note: "Called" }, now)).toThrow(/reason/);
    expect(() => checkContact({ outcome: "come_back_later", note: "Wants to think" }, now)).toThrow(/follow-up date in the future/);
    expect(() => checkContact({ outcome: "come_back_later", note: "Wants to think", nextActionAt: "2026-09-25T10:00:00Z" }, now)).toThrow(/future/);
    expect(checkContact({ outcome: "come_back_later", note: " Wants  to think ", nextActionAt: "2026-10-01T09:00:00Z" }, now)).toEqual({ note: "Wants to think", next: new Date("2026-10-01T09:00:00Z") });
  });
});
