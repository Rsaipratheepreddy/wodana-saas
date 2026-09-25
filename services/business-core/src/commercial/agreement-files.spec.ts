import { describe, expect, it, vi } from "vitest";
import { CommercialService } from "./commercial.service";
import type { CommercialData } from "./commercial.types";
import type { RequestActor } from "../auth/actor";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import type { ConfigService } from "@nestjs/config";
import type { CatalogSellingPriceService } from "./catalog-selling-price.service";
import type { PreProjectReadinessService } from "../pre-projects/pre-project-readiness.service";

const assetId = "45a9bf00-5510-4d9a-b67e-21820539d40c";
function setup(found = true) {
  const data = { revision: 1, quotes: [], agreement: { quoteId: "quote", reference: "AGR-1", terms: "Frozen terms", evidence: "Signed", status: "executed" }, audit: [] } as unknown as CommercialData;
  const query = vi.fn().mockResolvedValue({ rowCount: found ? 1 : 0, rows: found ? [{ id: assetId, name: "signed.pdf", mimeType: "application/pdf", byteSize: 42, hasPreview: false }] : [] });
  const access = { withPermissions: vi.fn(async (_actor, _workspace, _permissions, work) => work({ query }, { userId: "owner", displayName: "Owner" })) };
  const service = new CommercialService(access as unknown as WorkspaceAccessService, {} as ConfigService, {} as CatalogSellingPriceService, {} as PreProjectReadinessService);
  vi.spyOn(service, "caseRecord").mockResolvedValue({ status: "released" } as Awaited<ReturnType<typeof service.caseRecord>>);
  vi.spyOn(service, "load").mockResolvedValue(data);
  const persist = vi.spyOn(service, "persist").mockResolvedValue(undefined);
  const command = () => service.command({} as RequestActor, "workspace", "case", { action: "attach_agreement_file", revision: 1, quoteId: "quote", assetId });
  return { data, query, persist, command, access };
}
describe("agreement attachments", () => {
  it("adds supporting evidence without changing executed agreement terms and deduplicates replay", async () => {
    const { command, data, query, access } = setup();
    await command(); await command();
    expect(data.agreement).toMatchObject({ status: "executed", terms: "Frozen terms", evidence: "Signed" });
    expect(data.agreement?.files).toHaveLength(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("workspace_id=$1 AND case_id=$2"), ["workspace", "case", assetId]);
    expect(access.withPermissions).toHaveBeenCalledWith(expect.anything(), "workspace", ["pre_projects.view", "pre_projects.edit"], expect.any(Function));
  });
  it("rejects a file from another project without persisting", async () => {
    const { command, persist } = setup(false);
    await expect(command()).rejects.toThrow("does not belong");
    expect(persist).not.toHaveBeenCalled();
  });
});
