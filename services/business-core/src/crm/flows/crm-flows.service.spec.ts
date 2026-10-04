import { describe, expect, it } from "vitest";
import { CrmFlowsService, flowCodeFor } from "./crm-flows.service";

describe("creating a flow", () => {
  it("stores the flow under a code made from its name", () => {
    expect(flowCodeFor("Villa design")).toBe("villa_design");
    expect(flowCodeFor("  Fit-out (premium)  ")).toBe("fit_out_premium");
    expect(flowCodeFor("Café 2026")).toBe("cafe_2026");
    expect(flowCodeFor("2026 Kitchens")).toBe("kitchens");
    expect(flowCodeFor("a".repeat(80))).toHaveLength(40);
  });

  it("falls back to a stable code when the name has too few Latin letters", () => {
    expect(flowCodeFor("فيلا")).toMatch(/^flow_[0-9a-f]{8}$/);
    expect(flowCodeFor("فيلا")).toBe(flowCodeFor("فيلا"));
    expect(flowCodeFor("X")).toMatch(/^flow_/);
  });

  it("refuses a create without exactly one source before touching the database", async () => {
    const access = { withPermission: () => { throw new Error("must not run"); } } as never;
    const service = new CrmFlowsService(access);
    const actor = {} as never;
    await expect(service.create(actor, "w", { name: " ", starter: "basic" })).rejects.toThrow(/name/);
    await expect(service.create(actor, "w", { name: "New" })).rejects.toThrow(/starter flow or from one of your flows/);
    await expect(service.create(actor, "w", { name: "New", starter: "basic", sourceFlowId: "f" })).rejects.toThrow(/starter flow or from one of your flows/);
    await expect(service.create(actor, "w", { name: "New", starter: "basic", sourceVersion: 2 })).rejects.toThrow(/version/);
  });
});
