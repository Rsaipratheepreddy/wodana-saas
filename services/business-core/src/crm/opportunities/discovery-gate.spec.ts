import { describe, expect, it, vi } from "vitest";
import { CrmOpportunitiesService } from "./crm-opportunities.service";

describe("stage gate: discovery required (PLM-040)", () => {
  const client = { query: vi.fn() };
  const stage = { entry_requirements: { discovery: true } };
  const opportunity = { id: "opp-1", amount: null };

  it("refuses the stage and names what is missing", async () => {
    const discovery = { missing: vi.fn().mockResolvedValue([{ key: "floorPlan", label: "Floor plan" }, { key: "area", label: "Area" }]) };
    const service = new CrmOpportunitiesService({} as never, {} as never, undefined, discovery as never);
    await expect(service["assertEntryRequirements"](client as never, "ws", opportunity, stage)).rejects.toMatchObject({ response: { missing: ["Floor plan", "Area"] } });
    expect(discovery.missing).toHaveBeenCalledWith(client, "ws", "opp-1");
  });

  it("lets the opportunity in once discovery is complete, and accepts discovery as a stage requirement", async () => {
    const discovery = { missing: vi.fn().mockResolvedValue([]) };
    const service = new CrmOpportunitiesService({} as never, {} as never, undefined, discovery as never);
    await expect(service["assertEntryRequirements"](client as never, "ws", opportunity, stage)).resolves.toBeUndefined();
    expect(() => service["validateRequirements"]({ discovery: true })).not.toThrow();
  });
});
