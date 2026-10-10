import { beforeEach, describe, expect, it, vi } from "vitest";

const prefill = vi.hoisted(() => vi.fn());
vi.mock("../quotation/design-fee-line", async (original) => ({ ...(await original<typeof import("../quotation/design-fee-line")>()), prefillDesignFeeQuote: prefill }));

import { CommercialService } from "./commercial.service";
import type { CommercialData } from "./commercial.types";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import type { ConfigService } from "@nestjs/config";
import type { CatalogSellingPriceService } from "./catalog-selling-price.service";
import type { PreProjectReadinessService } from "../pre-projects/pre-project-readiness.service";

const path = (design: boolean) => ({
  selectedAt: "2026-10-01T00:00:00Z", selectedBy: "sales",
  scope: { design, mainQuotation: true, materialSelection: false, procurement: true, manufacturing: false, siteWorks: true, installation: true },
});

function setup(design: boolean, quotes: CommercialData["quotes"] = []) {
  const query = vi.fn(async () => ({ rowCount: 0, rows: [] }));
  const client = { query };
  const access = {
    withPermissions: vi.fn(async (_actor, _workspace, _permissions, work) => work(client, { userId: "sales", displayName: "Sara Sales" })),
    hasPermission: vi.fn(async () => true),
  };
  const service = new CommercialService(access as unknown as WorkspaceAccessService, {} as ConfigService, {} as CatalogSellingPriceService, {} as PreProjectReadinessService);
  const data: CommercialData = { revision: 3, quotes, requests: [], agreement: null, payments: [], audit: [], release: null, servicePath: path(design) } as CommercialData;
  const reloaded = { ...data, revision: 4, quotes: [{ id: "reloaded" }] } as unknown as CommercialData;
  vi.spyOn(service, "caseRecord").mockResolvedValue({ status: "active", title: "Villa 12", customerName: "Maya", currency: "AED" } as never);
  const load = vi.spyOn(service, "load").mockResolvedValueOnce(data).mockResolvedValue(reloaded);
  const persist = vi.spyOn(service, "persist").mockResolvedValue(undefined);
  return { service, data, reloaded, client, access, load, persist };
}

describe("creating a design-fee quote", () => {
  beforeEach(() => prefill.mockReset());

  it("pre-fills the new design-fee quote with the fee priced on the opportunity, after it is saved, and answers with the filled case", async () => {
    const { service, data, reloaded, client, persist } = setup(true);
    prefill.mockResolvedValue({ lineId: "line-1", rate: "12500.5", currency: "AED", source: "discovery" });
    const result = await service.command({} as never, "workspace", "case", { action: "create", revision: 3 });
    const created = data.quotes.at(-1)!;
    expect(created).toMatchObject({ kind: "quotation", round: "design", status: "draft", lines: [] });
    expect(prefill).toHaveBeenCalledOnce();
    expect(prefill).toHaveBeenCalledWith(client, { workspaceId: "workspace", caseId: "case", quoteId: created.id, actorUserId: "sales", includeProposalValue: true });
    expect(persist.mock.invocationCallOrder[0]).toBeLessThan(prefill.mock.invocationCallOrder[0]);
    expect(result).toEqual({ data: reloaded });
  });

  it("uses the Proposal 1 value only for someone who may see the opportunity's values", async () => {
    const { service, access } = setup(true);
    access.hasPermission.mockImplementation(async (...args: unknown[]) => args[3] !== "crm.opportunities.sensitive_values");
    prefill.mockResolvedValue(null);
    await service.command({} as never, "workspace", "case", { action: "create", revision: 3 });
    expect(prefill.mock.calls[0][1]).toMatchObject({ includeProposalValue: false });
  });

  it("keeps the created quote as it is when nothing was priced on the opportunity", async () => {
    const { service, data, load } = setup(true);
    prefill.mockResolvedValue(null);
    const result = await service.command({} as never, "workspace", "case", { action: "create", revision: 3 });
    expect(result).toEqual({ data });
    expect(data.quotes.at(-1)?.lines).toEqual([]);
    expect(load).toHaveBeenCalledOnce();
  });

  it("never fills a quote that isn't the design fee: a fit-out-only path's first quote, or a revision", async () => {
    const main = setup(false);
    await main.service.command({} as never, "workspace", "case", { action: "create", revision: 3 });
    expect(main.data.quotes.at(-1)?.round).toBe("main");
    const issued = { id: "q1", number: 1, kind: "quotation", round: "design", status: "issued", title: "Design", currency: "AED", validUntil: "2026-11-01", discount: 0, taxRate: 5,
      terms: "", exclusions: "", lines: [], requestIds: [], paymentTerms: [], createdAt: "2026-10-01T00:00:00Z", total: 0 } as unknown as CommercialData["quotes"][number];
    const revision = setup(true, [issued]);
    await revision.service.command({} as never, "workspace", "case", { action: "revise", revision: 3, quoteId: "q1" });
    expect(revision.data.quotes.at(-1)?.round).toBe("design");
    expect(prefill).not.toHaveBeenCalled();
  });
});
