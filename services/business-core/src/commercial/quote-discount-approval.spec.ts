import { describe, expect, it, vi } from "vitest";
import { CommercialService } from "./commercial.service";
import type { CommercialData, Quote } from "./commercial.types";

// A 1,000 line with a 200 discount: 20% off.
const quote = { id: "q", number: 1, kind: "quotation", round: "main", status: "internal_review", title: "Fit-out", currency: "AED",
  validUntil: "2999-12-31", discount: 200, taxRate: 0, terms: "", exclusions: "", requestIds: [], paymentTerms: [], createdAt: "2026-09-27T00:00:00Z", total: 800,
  lines: [{ id: "l", room: "Kitchen", title: "Cabinets", specification: "", material: "", finish: "", quantity: 1, unit: "set", unitCost: 500, rate: 1000 }] } as Quote;

function setup(threshold: string | null, granted: string[]) {
  const query = vi.fn(async (sql: string) => sql.includes("FROM workspace_quotation_settings")
    ? { rows: [{ percent: threshold }], rowCount: 1 } : { rows: [], rowCount: 0 });
  const access = {
    withPermissions: vi.fn(async (_actor, _workspace, _permissions, work) => work({ query }, { userId: "qs", displayName: "QS" })),
    hasPermission: vi.fn(async (_client, _workspace, _user, permission: string) => granted.includes(permission)),
  };
  const service = new CommercialService(access as never, {} as never, {} as never, {} as never);
  const data = { revision: 2, quotes: [structuredClone(quote)], requests: [], agreement: null, payments: [], audit: [], release: null,
    palmFlow: { scope: { design: true, mainQuotation: true } } } as unknown as CommercialData;
  vi.spyOn(service, "caseRecord").mockResolvedValue({ status: "active" } as never);
  vi.spyOn(service, "load").mockResolvedValue(data);
  const persist = vi.spyOn(service, "persist").mockResolvedValue(undefined);
  return { service, data, persist };
}
const approve = (service: CommercialService) => service.command({} as never, "workspace", "case", { action: "qs_approve", revision: 2, quoteId: "q" });

describe("a discount above the firm's approval threshold", () => {
  it("can't be approved by a QS alone", async () => {
    const { service, data, persist } = setup("10", ["commercial.estimate"]);
    await expect(approve(service)).rejects.toThrow("above the 10% your firm allows without approval");
    expect(data.quotes[0].status).toBe("internal_review");
    expect(persist).not.toHaveBeenCalled();
  });

  it("is approved by someone who approves quotes", async () => {
    const { service, data } = setup("10", ["commercial.estimate", "commercial.approve"]);
    await approve(service);
    expect(data.quotes[0].status).toBe("internal_approved");
  });

  it("doesn't hold back a discount within the threshold, or a firm without one", async () => {
    const within = setup("25", ["commercial.estimate"]);
    await approve(within.service);
    expect(within.data.quotes[0].status).toBe("internal_approved");
    const none = setup(null, ["commercial.estimate"]);
    await approve(none.service);
    expect(none.data.quotes[0].status).toBe("internal_approved");
  });
});
