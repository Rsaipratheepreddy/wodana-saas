import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LEAD_OPTIONS, loadLeadOptions } from "./lead-options";

describe("workspace lead options", () => {
  it("uses a neutral enquiry-type fallback when a workspace has no taxonomy", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    const result = await loadLeadOptions(client as never, "workspace-1");

    expect(result.enquiryTypes).toEqual([{ id: "not_sure", label: "Not Sure Yet" }]);
    expect(result.enquiryTypes).toEqual(DEFAULT_LEAD_OPTIONS.enquiryTypes);
    expect(result.budgetRanges).toEqual([{ id: "not_sure", label: "Not sure yet" }]);
    expect(JSON.stringify(result.budgetRanges)).not.toContain("AED");
    expect(JSON.stringify(result.channels)).not.toMatch(/palm living|plyleads/i);
    expect(result.channels.third_party).toContainEqual({ id: "partner_referral", label: "Partner referral" });
    expect(result.channels.digital_marketing).toContainEqual({ id: "social_ads", label: "Social ads" });
  });

  it("replaces the fallback with the workspace's configured enquiry types", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ code: "enquiry_type", options: [
      { id: "design_consultation", label: "Design consultation" },
      { id: "not_sure", label: "Not Sure Yet" },
    ] }] }) };

    const result = await loadLeadOptions(client as never, "workspace-2");

    expect(result.enquiryTypes).toEqual([
      { id: "design_consultation", label: "Design consultation" },
      { id: "not_sure", label: "Not Sure Yet" },
    ]);
  });
});
