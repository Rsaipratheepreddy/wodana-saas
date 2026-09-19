import { describe, expect, it } from "vitest";
import {
  planTenantLifecycleTransition,
  tenantLifecycleBaseline,
  tenantLifecycleOptions,
} from "./tenant-lifecycle.domain";

describe("tenant organization lifecycle", () => {
  it("keeps billing collection separate from the baseline operational state", () => {
    expect(tenantLifecycleBaseline({ workspaceStatus: "active", subscriptionStatus: "trial" })).toBe("trial");
    expect(tenantLifecycleBaseline({ workspaceStatus: "active", onboardingStatus: "in_progress" })).toBe("draft");
    expect(tenantLifecycleBaseline({ workspaceStatus: "suspended", subscriptionStatus: "trial" })).toBe("suspended");
  });

  it("permits reversible suspension but no unreviewed archive reversal", () => {
    expect(tenantLifecycleOptions("suspended")).toContain("active");
    expect(tenantLifecycleOptions("archived")).toEqual([]);
    expect(() => planTenantLifecycleTransition({ from: "archived", to: "active", now: new Date() }))
      .toThrow("Cannot move organization");
  });

  it("requires an explicit dated grace policy and never calls a notice delivered", () => {
    const now = new Date("2026-09-18T00:00:00Z");
    expect(() => planTenantLifecycleTransition({ from: "active", to: "grace", now })).toThrow("future end date");
    expect(planTenantLifecycleTransition({ from: "active", to: "grace", now,
      graceEndsAt: new Date("2026-09-20T00:00:00Z") })).toEqual({
      workspaceStatus: "active", noticeRequired: true, noticeDeliveryState: "not_configured",
    });
    expect(planTenantLifecycleTransition({ from: "active", to: "suspended", now }).workspaceStatus).toBe("suspended");
  });
});
