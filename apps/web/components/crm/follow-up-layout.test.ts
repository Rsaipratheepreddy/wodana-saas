import { describe, expect, it } from "vitest";
import { GRID_ORIGIN, HOUR_WIDTH, layoutFollowUps } from "./follow-up-layout";
const day = "2026-09-22";
const event = (id: string, start: string, end?: string) => ({ id, type: "call", status: "pending", dueAt: `${day}T${start}`, ...(end ? { appointment: { startsAt: `${day}T${start}`, endsAt: `${day}T${end}` } } : {}) });
describe("shared follow-up schedule", () => {
  it("reuses lanes for adjacent events and separates overlaps", () => {
    const entries = layoutFollowUps([event("a", "09:00", "10:00"), event("b", "09:30", "10:30"), event("c", "10:00", "11:00")], day);
    expect(entries.map(entry => entry.lane)).toEqual([0, 1, 0]);
    expect(entries[1].offset).toBe(GRID_ORIGIN + 9.5 * HOUR_WIDTH);
    expect(entries[1].width).toBe(HOUR_WIDTH);
  });
  it("clips overnight events to the visible day", () => {
    const [entry] = layoutFollowUps([{ ...event("a", "23:30"), dueAt: "2026-09-21T23:30", appointment: { startsAt: "2026-09-21T23:30", endsAt: `${day}T00:30` } }], day);
    expect(entry.offset).toBe(GRID_ORIGIN);
    expect(entry.width).toBe(HOUR_WIDTH / 2);
  });
  it("keeps point reminders distinct without inventing an end time", () => {
    const [entry] = layoutFollowUps([event("a", "09:00")], day);
    expect(entry.to).toBeNull();
    expect(entry.duration).toBe(false);
  });
});
