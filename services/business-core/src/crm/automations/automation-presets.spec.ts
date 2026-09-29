import { describe, expect, it } from "vitest";
import { AUTOMATION_PRESETS, automationPreset, providerCapability } from "./automation-presets";

describe("automation presets", () => {
  it("exposes only the business-language tenant rules", () => {
    expect(AUTOMATION_PRESETS.map((preset) => preset.code)).toEqual([
      "enquiry_ownership",
      "response_escalation",
      "decision_reminders",
      "approval_reminders",
      "weekly_progress",
    ]);
    expect(automationPreset("technical_graph_node")).toBeNull();
  });

  it("does not call a provider verified until a delivery receipt exists", () => {
    expect(providerCapability({ channel: "email", connected: true, delivered: 0, failed: 1, lastDeliveredAt: null }).receiptState).toBe("awaiting_test_receipt");
    expect(providerCapability({ channel: "email", connected: true, delivered: 1, failed: 0, lastDeliveredAt: "2026-09-18T10:00:00Z" }).receiptState).toBe("verified");
    expect(providerCapability({ channel: "whatsapp", connected: false, delivered: 0, failed: 0, lastDeliveredAt: null }).pricing).toContain("Meta");
  });
});
