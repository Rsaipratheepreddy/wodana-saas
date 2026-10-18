import { describe, expect, it } from "vitest";
import { checkIntroSlot, introBlockers, meetingLocation, meetingWhen } from "./intro-meeting.domain";

const now = new Date("2026-10-01T08:00:00Z");
describe("intro meeting rules (PLM-043)", () => {
  it("blocks only on the floor plan, area and client email", () => {
    expect(introBlockers([{ key: "floorPlan", label: "Floor plan" }, { key: "propertyLocation", label: "Property location" }, { key: "clientEmail", label: "Client email" }]).map((item) => item.key))
      .toEqual(["floorPlan", "clientEmail"]);
    expect(introBlockers([{ key: "question:budget", label: "Budget" }])).toEqual([]);
  });

  it("checks the slot", () => {
    const base = { startsAt: "2026-10-02T06:00:00Z", endsAt: "2026-10-02T07:00:00Z", timezone: "Asia/Kolkata", mode: "in_person" as const, now };
    expect(checkIntroSlot(base)).toBeNull();
    expect(checkIntroSlot({ ...base, endsAt: base.startsAt })).toMatch(/end after/);
    expect(checkIntroSlot({ ...base, startsAt: "2026-09-30T06:00:00Z", endsAt: "2026-09-30T07:00:00Z" })).toMatch(/future/);
    expect(checkIntroSlot({ ...base, timezone: "Mars/Base" })).toMatch(/time zone/);
    expect(checkIntroSlot({ ...base, mode: "online", place: "meet.example.com/x" })).toMatch(/https/);
    expect(checkIntroSlot({ ...base, mode: "online", place: "https://meet.example.com/x" })).toBeNull();
  });

  it("stores an address or a link and describes the time in the meeting's zone", () => {
    expect(meetingLocation("online", " https://x.test/a ")).toEqual({ mode: "online", url: "https://x.test/a" });
    expect(meetingLocation("in_person", "")).toEqual({ mode: "in_person", address: null });
    expect(meetingWhen("2026-10-02T06:00:00Z", "2026-10-02T07:00:00Z", "Europe/London", "en-GB")).toBe("Fri 2 Oct, 7:00 – 8:00 (Europe/London)");
  });
});
