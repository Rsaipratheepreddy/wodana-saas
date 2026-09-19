import { describe, expect, it } from "vitest";
import { previewBillingContractChange } from "./billing-preview";

const current = {
  status: "contracted" as const,
  currency: "AED",
  recurringAmount: 1200,
  seatLimit: 10,
  projectLimit: 50,
  termStartsAt: "2026-09-01T00:00:00.000Z",
  renewsAt: "2026-10-01T00:00:00.000Z",
};

describe("billing change preview", () => {
  it("previews the next bill, deterministic current-period estimate and capacity impact", () => {
    expect(previewBillingContractChange(current, { ...current, recurringAmount: 1500, seatLimit: 12 },
      new Date("2026-09-16T00:00:00.000Z"))).toMatchObject({
      direction: "upgrade", recurringDelta: 300, proratedDelta: 150, nextBillAmount: 1500,
      capacityDelta: { seats: 2, projects: 0 }, accessEffect: "none", prorationIsEstimate: true,
    });
  });

  it("does not invent proration without a usable current billing period and separates cancellation from access", () => {
    const preview = previewBillingContractChange({ ...current, renewsAt: null }, { ...current, status: "expired", recurringAmount: 0 },
      new Date("2026-09-16T00:00:00.000Z"));
    expect(preview).toMatchObject({ direction: "cancellation", proratedDelta: null, nextBillAmount: 0, accessEffect: "none" });
  });
});
