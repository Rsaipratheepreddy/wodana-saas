import { describe, expect, it, vi } from "vitest";
import { CommercialService, commercialCommandPermission } from "./commercial.service";
import type { CommercialData, Quote } from "./commercial.types";

const quote = { id: "q", number: 1, kind: "quotation", round: "design", status: "internal_review", title: "Design fee", currency: "AED",
  validUntil: "2026-12-31", discount: 0, taxRate: 0, terms: "", exclusions: "", requestIds: [], paymentTerms: [], createdAt: "2026-09-27T00:00:00Z", total: 25000,
  lines: [{ id: "l", room: "General", title: "Design fee", specification: "", material: "", finish: "", quantity: 1, unit: "package", unitCost: 0, rate: 25000 }] } as Quote;

function setup(granted: string[]) {
  const access = {
    withPermissions: vi.fn(async (_actor, _workspace, _permissions, work) => work({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }, { userId: "qs", displayName: "Omar (QS)" })),
    hasPermission: vi.fn(async (_client, _workspace, _user, permission: string) => granted.includes(permission)),
  };
  const service = new CommercialService(access as never, {} as never, {} as never, {} as never);
  const data = { revision: 3, quotes: [structuredClone(quote)], requests: [], agreement: null, payments: [], audit: [], release: null,
    palmFlow: { scope: { design: true, mainQuotation: true } } } as unknown as CommercialData;
  vi.spyOn(service, "caseRecord").mockResolvedValue({ status: "active" } as never);
  vi.spyOn(service, "load").mockResolvedValue(data);
  const persist = vi.spyOn(service, "persist").mockResolvedValue(undefined);
  return { service, data, access, persist };
}

describe("returning a quote in review", () => {
  it("only needs view access up front; the command checks who may send it back", () => {
    expect(commercialCommandPermission("return")).toBe("pre_projects.view");
  });

  it("lets the QS who reviews it send it back without edit access to the case", async () => {
    const { service, data, persist } = setup(["commercial.estimate"]);
    await service.command({} as never, "workspace", "case", { action: "return", revision: 3, quoteId: "q" });
    expect(data.quotes[0].status).toBe("draft");
    expect(persist).toHaveBeenCalled();
  });

  it("refuses someone who neither reviews nor edits", async () => {
    const { service, data, persist } = setup([]);
    await expect(service.command({} as never, "workspace", "case", { action: "return", revision: 3, quoteId: "q" })).rejects.toThrow("send it back");
    expect(data.quotes[0].status).toBe("internal_review");
    expect(persist).not.toHaveBeenCalled();
  });
});
