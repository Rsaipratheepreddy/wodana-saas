import { describe, expect, it, vi } from "vitest";
import { CommercialService } from "./commercial.service";
import type { CommercialData } from "./commercial.types";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import type { ConfigService } from "@nestjs/config";
import type { CatalogSellingPriceService } from "./catalog-selling-price.service";
import type { PreProjectReadinessService } from "../pre-projects/pre-project-readiness.service";

const scope = {
  design: true, mainQuotation: true, materialSelection: true, procurement: true,
  manufacturing: true, siteWorks: true, installation: true,
};

function setup(code = "design_build_deal_first", quoteCount = 0) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM project_workflow_templates"))
      return { rowCount: 1, rows: [{
        id: "template", code, name: "Palm flow", description: "Palm flow", isDefault: true,
        version: 1, stages: [
          { key: "design", visibleName: "Design", description: "Design", phase: "planning", ownerRole: null, exitGates: [] },
          { key: "done", visibleName: "Done", description: "Done", phase: "completed", ownerRole: null, exitGates: [] },
        ], updatedAt: "2026-09-24T00:00:00Z",
      }] };
    return { rowCount: 0, rows: [] };
  });
  const access = {
    withPermissions: vi.fn(async (_actor, _workspace, _permissions, work) => work({ query }, { userId: "sales", displayName: "Sales Admin" })),
  };
  const service = new CommercialService(
    access as unknown as WorkspaceAccessService,
    {} as ConfigService,
    {} as CatalogSellingPriceService,
    {} as PreProjectReadinessService,
  );
  const data: CommercialData = {
    revision: 0, quotes: Array.from({ length: quoteCount }, () => ({ id: "existing" })) as CommercialData["quotes"],
    requests: [], agreement: null, payments: [], audit: [], release: null,
  };
  vi.spyOn(service, "caseRecord").mockResolvedValue({ status: "active" } as never);
  vi.spyOn(service, "load").mockResolvedValue(data);
  const persist = vi.spyOn(service, "persist").mockResolvedValue(undefined);
  return { service, data, access, persist };
}

describe("Palm service-path selection", () => {
  it("records the selected path before quotation work starts", async () => {
    const { service, data, access, persist } = setup();
    await service.command({} as never, "workspace", "case", { action: "set_service_path", revision: 0, scope });
    expect(data.servicePath).toMatchObject({ scope, selectedBy: "sales" });
    expect(access.withPermissions).toHaveBeenCalledWith(expect.anything(), "workspace", ["pre_projects.view", "pre_projects.edit"], expect.any(Function));
    expect(persist).toHaveBeenCalledOnce();
  });

  it("does not alter other tenants or a Palm case with an existing quote", async () => {
    const other = setup("standard_delivery");
    await expect(other.service.command({} as never, "workspace", "case", { action: "set_service_path", revision: 0, scope })).rejects.toThrow("not configured");
    expect(other.persist).not.toHaveBeenCalled();
    const quoted = setup("design_build_deal_first", 1);
    await expect(quoted.service.command({} as never, "workspace", "case", { action: "set_service_path", revision: 0, scope })).rejects.toThrow("before preparing");
    expect(quoted.persist).not.toHaveBeenCalled();
  });
});
