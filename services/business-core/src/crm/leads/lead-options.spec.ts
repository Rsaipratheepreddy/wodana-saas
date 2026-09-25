import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LEAD_OPTIONS, loadLeadOptions, validateLeadOptions } from "./lead-options";

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

  it("includes Outside UAE for default and older configured emirate taxonomies", async () => {
    const fallback = await loadLeadOptions({ query: vi.fn().mockResolvedValue({ rows: [] }) } as never, "workspace-1");
    expect(fallback.emirates).toContainEqual({ id: "outside_uae", label: "Outside UAE" });
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ code: "emirate", options: [{ id: "dubai", label: "Dubai" }] }] }) };
    const configured = await loadLeadOptions(client as never, "workspace-2");
    expect(configured.emirates).toEqual([{ id: "dubai", label: "Dubai" }, { id: "outside_uae", label: "Outside UAE" }]);
    await expect(validateLeadOptions(client as never, "workspace-2", { serviceType: "not_sure", details: { emirate: "outside_uae" } })).resolves.toBeUndefined();
  });
});

describe("lead option validation", () => {
  const client = () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) });
  it("requires emirate for enquiries but not when validating a form's source before publication", async () => {
    const source = { source: "company", channel: "website", serviceType: "not_sure" };
    await expect(validateLeadOptions(client() as never, "workspace", source)).rejects.toThrow("emirate");
    await expect(validateLeadOptions(client() as never, "workspace", source, undefined, { requireEmirate: false })).resolves.toBeUndefined();
  });
  it("rejects a channel from another source", async () => {
    await expect(validateLeadOptions(client() as never, "workspace", { source: "referral", channel: "call", serviceType: "not_sure" })).rejects.toThrow("channel for this source");
  });
  it("rejects unconfigured types and budgets", async () => {
    await expect(validateLeadOptions(client() as never, "workspace", { serviceType: "invented" })).rejects.toThrow("enquiry type");
    await expect(validateLeadOptions(client() as never, "workspace", { serviceType: "not_sure", details: { budgetRange: "invented" } })).rejects.toThrow("budget range");
  });
  it("preserves retired existing values and permits clearing optional values", async () => {
    const previous = { serviceType: "retired", details: { budgetRange: "old_budget", customerType: "old_customer", emirate: "dubai" } };
    await expect(validateLeadOptions(client() as never, "workspace", previous, previous)).resolves.toBeUndefined();
    await expect(validateLeadOptions(client() as never, "workspace", { serviceType: "retired", details: { budgetRange: "", customerType: "", emirate: "dubai" } }, previous)).resolves.toBeUndefined();
  });
});
