import { describe, expect, it } from "vitest";
import { deliveryHealth } from "./project-health";

const base = { stated: "on_track" as const, status: "active", today: "2026-10-06", promise: "2026-10-19", planEnd: "2026-10-10", lateWork: 0, lateOrders: 0, criticalSnags: 0 };

describe("deliveryHealth", () => {
  it("stays on track when nothing is late", () => {
    expect(deliveryHealth(base)).toEqual({ health: "on_track", stated: "on_track", reasons: [] });
  });

  it("is at risk with late work or late orders, whatever was said", () => {
    const result = deliveryHealth({ ...base, lateWork: 3, lateOrders: 1 });
    expect(result.health).toBe("at_risk");
    expect(result.reasons).toEqual([{ key: "late_work", count: 3 }, { key: "late_orders", count: 1 }]);
  });

  it("is off track once the handover date has passed", () => {
    expect(deliveryHealth({ ...base, promise: "2026-10-02" })).toMatchObject({ health: "off_track", reasons: [{ key: "past_handover", days: 4 }] });
  });

  it("is off track when the plan ends after the handover date", () => {
    expect(deliveryHealth({ ...base, planEnd: "2026-10-23" })).toMatchObject({ health: "off_track", reasons: [{ key: "plan_after_handover", days: 4 }] });
  });

  it("keeps a worse health the manager stated", () => {
    expect(deliveryHealth({ ...base, stated: "off_track", lateWork: 1 })).toMatchObject({ health: "off_track", reasons: [{ key: "stated" }, { key: "late_work", count: 1 }] });
  });

  it("leaves a project that isn't running as stated", () => {
    expect(deliveryHealth({ ...base, status: "completed", promise: "2026-09-01", lateWork: 2 })).toEqual({ health: "on_track", stated: "on_track", reasons: [] });
  });
});
