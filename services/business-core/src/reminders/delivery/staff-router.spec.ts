import { describe, expect, it } from "vitest";
import { nextDigestAt } from "./staff-router";

const calendar = { workingDays: [1, 2, 3, 4, 5], holidays: ["2030-01-14"] };
const person = { timeZone: "Asia/Kolkata", digestTime: "08:00", digestEnabled: true };

describe("when a person's digest goes next (quiet-hour notices wait in it when it goes first)", () => {
  it("is today's digest time while it is still ahead, else the next working day's, in their zone", () => {
    // 01:00 UTC is 06:30 in Kolkata on Wednesday 9 Jan 2030: today at 08:00 (02:30 UTC).
    expect(nextDigestAt(person, new Date("2030-01-09T01:00:00Z"), calendar)?.toISOString()).toBe("2030-01-09T02:30:00.000Z");
    // 17:00 UTC is 22:30: tomorrow at 08:00.
    expect(nextDigestAt(person, new Date("2030-01-09T17:00:00Z"), calendar)?.toISOString()).toBe("2030-01-10T02:30:00.000Z");
    // Friday evening: Monday is a holiday, so Tuesday.
    expect(nextDigestAt(person, new Date("2030-01-11T17:00:00Z"), calendar)?.toISOString()).toBe("2030-01-15T02:30:00.000Z");
  });

  it("is never when the person switched the digest off", () => {
    expect(nextDigestAt({ ...person, digestEnabled: false }, new Date("2030-01-09T01:00:00Z"), calendar)).toBeNull();
  });
});
