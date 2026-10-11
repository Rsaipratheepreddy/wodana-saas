import { describe, expect, it } from "vitest";
import { reminderDays, reminderRound } from "./client-decision-reminders";

// Sending the reminders moved to the reminder engine (reminders/sources/quotes.ts and designs.ts, tested in
// reminders-engine.integration.spec.ts and reminder-sources.integration.spec.ts). The firm's old decision days are
// still read for the quotation settings screen.
describe("client decision days (Q-8)", () => {
  it("reads the firm's days, sorted and bounded, with 2 and 5 by default", () => {
    expect(reminderDays(undefined)).toEqual([2, 5]);
    expect(reminderDays([7, 3, 3, 0, 90])).toEqual([3, 7]);
    expect(reminderDays([])).toEqual([]);
  });

  it("knows which round is due", () => {
    expect(reminderRound(1, [2, 5])).toBe(0);
    expect(reminderRound(2, [2, 5])).toBe(1);
    expect(reminderRound(4, [2, 5])).toBe(1);
    expect(reminderRound(9, [2, 5])).toBe(2);
  });
});
