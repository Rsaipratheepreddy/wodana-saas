import { describe, expect, it } from "vitest";
import { addInterval, choiceText, nextCallDay, planChange } from "./client-calls.domain";

describe("client update calls (PLM-046)", () => {
  it("move one interval: a week, two weeks, or the same day next month (its last day when shorter)", () => {
    expect(addInterval("2026-10-06", "weekly")).toBe("2026-10-13");
    expect(addInterval("2026-10-06", "fortnightly")).toBe("2026-10-20");
    expect(addInterval("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(addInterval("2026-12-15", "monthly")).toBe("2027-01-15");
  });

  it("land on the firm's working week", () => {
    // Sunday–Thursday: a week after Thursday 1 Oct is Thursday 8 Oct; a week after Monday 5 Oct, but Friday 9 Oct
    // isn't worked, so a call due then moves to Sunday 11 Oct.
    const week = { workingDays: [0, 1, 2, 3, 4], holidays: [] };
    expect(nextCallDay("2026-10-01", "2026-10-01", "weekly", week)).toBe("2026-10-08");
    expect(nextCallDay("2026-10-02", "2026-10-02", "weekly", week)).toBe("2026-10-11");
  });

  it("never book in the past: a missed call catches up to the next one ahead", () => {
    const week = { workingDays: [1, 2, 3, 4, 5], holidays: [] };
    expect(nextCallDay("2026-09-01", "2026-10-06", "weekly", week)).toBe("2026-10-13");
    expect(nextCallDay("2026-09-07", "2026-10-06", "monthly", week)).toBe("2026-10-07");
    expect(nextCallDay("2026-08-07", "2026-10-07", "monthly", week)).toBe("2026-11-09");
  });

  it("say the client's choice as the Account Manager reads it", () => {
    expect(choiceText("call", "weekly")).toBe("Weekly calls");
    expect(choiceText("call", "fortnightly")).toBe("Calls every two weeks");
    expect(choiceText("portal", "weekly")).toBe("Portal updates instead of calls, weekly");
    expect(choiceText("portal", "monthly")).toBe("Portal updates instead of calls, monthly");
    expect(choiceText("portal", "off")).toBe("No update calls");
    expect(choiceText("either", "weekly")).toBe("A call or a portal update, weekly");
  });

  it("re-plan from today when calls turn on or the mode changes; keep the planned one between rhythms", () => {
    const call = (frequency: "weekly" | "monthly" | "off") => ({ mode: "call" as const, frequency });
    const portal = (frequency: "weekly" | "monthly" | "off") => ({ mode: "portal" as const, frequency });
    expect(planChange(call("weekly"), call("weekly"))).toEqual({ changed: false, cancel: false, plan: false });
    expect(planChange(call("weekly"), call("monthly"))).toEqual({ changed: true, cancel: false, plan: false });
    expect(planChange(call("weekly"), call("off"))).toEqual({ changed: true, cancel: true, plan: false });
    expect(planChange(call("off"), call("weekly"))).toEqual({ changed: true, cancel: false, plan: true });
    expect(planChange(call("weekly"), portal("weekly"))).toEqual({ changed: true, cancel: true, plan: true });
    expect(planChange(portal("monthly"), call("weekly"))).toEqual({ changed: true, cancel: true, plan: true });
    expect(planChange(call("off"), portal("off"))).toEqual({ changed: true, cancel: false, plan: false });
  });
});
