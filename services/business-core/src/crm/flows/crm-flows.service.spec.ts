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
    await expect(service.create(actor, "w", { name: "New" })).rejects.toThrow(/starter flow, a template or one of your flows/);
    await expect(service.create(actor, "w", { name: "New", starter: "basic", sourceFlowId: "f" })).rejects.toThrow(/starter flow, a template or one of your flows/);
    await expect(service.create(actor, "w", { name: "New", templateKey: "basic", starter: "basic" })).rejects.toThrow(/starter flow, a template or one of your flows/);
    await expect(service.create(actor, "w", { name: "New", templateKey: "basic", sourceFlowId: "f" })).rejects.toThrow(/starter flow, a template or one of your flows/);
    await expect(service.create(actor, "w", { name: "New", starter: "basic", sourceVersion: 2 })).rejects.toThrow(/version/);
  });

  it("lists the template library with its step counts", async () => {
    const access = { withPermission: (_actor: unknown, _workspace: string, permission: string, work: () => unknown) => { expect(permission).toBe("crm.settings.manage"); return work(); } } as never;
    const { data } = await new CrmFlowsService(access).templates({} as never, "w");
    expect(data.length).toBeGreaterThan(10);
    expect(data.find((template) => template.key === "fit_out_joinery")).toMatchObject({ group: "Fit-out", stepCount: 13, suggestedEnquiryTypes: ["Joinery only", "Renovation / fit-out"] });
    expect(Object.keys(data[0]).sort()).toEqual(["definition", "description", "group", "key", "name", "stepCount", "suggestedEnquiryTypes"]);
  });
});

describe("listing flows", () => {
  it("lists flows without the Not sure yet placeholder", async () => {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    // Every starter is already present and every enquiry type has its own flow, so only the list query runs after the checks.
    const client = { query: async (sql: string, values: unknown[] = []) => {
      queries.push({ sql, values });
      if (sql.includes("IS DISTINCT FROM owned.code")) return { rows: [], rowCount: 0 };
      return { rows: sql.includes(`AS "usedBy"`) ? [] : ["basic", "design", "fit_out", "furniture"].map((code) => ({ code })) };
    } };
    const access = { withPermission: (_a: unknown, _w: string, _p: string, work: (c: unknown, u: unknown) => unknown) => work(client, { userId: "u" }) } as never;
    await new CrmFlowsService(access).list({} as never, "w");
    const listed = queries.find((query) => query.sql.includes(`AS "usedBy"`))!;
    expect(listed.sql).toContain("choice.code <> $2");
    expect(listed.values).toEqual(["w", "not_sure"]);
  });
});
