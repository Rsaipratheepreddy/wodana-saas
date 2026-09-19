import { describe, expect, it, vi } from "vitest";
import type { RequestActor } from "../auth/actor";
import type { CrmEventsService } from "../crm/shared/crm-events.service";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import type { RecipePreviewDto } from "./catalog.dto";
import { CATALOG_STARTER } from "./catalog-starter";
import { CatalogService } from "./catalog.service";

const workspaceId = "10000000-0000-4000-a000-000000000001";
const catalogId = "10000000-0000-4000-a000-000000000002";
const caseId = "10000000-0000-4000-a000-000000000003";
const entryId = "10000000-0000-4000-a000-000000000004";
const measurementId = "10000000-0000-4000-a000-000000000005";
const widthId = "10000000-0000-4000-a000-000000000006";
const heightId = "10000000-0000-4000-a000-000000000007";
const actor = { userId: "user" } as RequestActor;

const byCode = (code: string) => CATALOG_STARTER.find((row) => row.code === code)!;

const input = (): RecipePreviewDto => ({
  templateId: byCode("ICT-WARD").id,
  executionId: byCode("EXEC-FACTORY").id,
  variantId: byCode("VR-WARD-SLD").id,
  grade: "Premium",
  dimensionUnit: "ft",
  quantity: 1,
  currency: "AED",
  values: [
    { key: "opening_sets", value: 1 },
    { key: "jobs", value: 1 },
    { key: "deliveries", value: 1 },
  ],
  commercialRuleIds: [byCode("COM-MAR-TGT").id],
  survey: {
    caseId,
    entryId,
    measurementId,
    measurementVersion: 2,
    bindings: [
      { axis: "width", dimensionId: widthId },
      { axis: "height", dimensionId: heightId },
    ],
  },
});

function setup(canViewSurvey: boolean) {
  const records = CATALOG_STARTER.map((record) => {
    const { id, kind, code, name, version, ...content } = record;
    return {
      id,
      catalogId,
      kind,
      code,
      name,
      content,
      version: version || 1,
      archived: false,
      starterVersion: null,
      updatedAt: "2026-09-18T00:00:00Z",
    };
  });
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM pre_project_site_records"))
      return {
        rows: [{
          id: measurementId,
          version: 2,
          status: "verified",
          entryId,
          dimensions: [
            { id: widthId, name: "Opening width", unit: "ft", measured: 8, measuredMetres: 2.4384 },
            { id: heightId, name: "Opening height", unit: "ft", measured: 9, measuredMetres: 2.7432 },
          ],
        }],
        rowCount: 1,
      };
    if (sql.includes("kind='catalog_group'"))
      return { rows: [{ id: catalogId, kind: "catalog_group", archived: false }], rowCount: 1 };
    return { rows: records, rowCount: records.length };
  });
  const hasPermission = vi.fn(async (_client, _workspace, _user, permission) =>
    permission === "pre_projects.view" ? canViewSurvey : true,
  );
  const withPermission = vi.fn(async (_actor, _workspace, _permission, work) =>
    work({ query }, { userId: "user" }),
  );
  const service = new CatalogService(
    { withPermission, hasPermission } as unknown as WorkspaceAccessService,
    { record: vi.fn() } as unknown as CrmEventsService,
  );
  return { service, query, hasPermission };
}

describe("catalogue assembly preview service", () => {
  it("calculates the assembly from a permitted, version-pinned survey", async () => {
    const { service } = setup(true);
    const result = await service.preview(actor, workspaceId, input());
    expect(result.measurement).toEqual({ quantity: 72, unit: "Square foot" });
    expect(result.measurementSource).toMatchObject({
      caseId,
      entryId,
      measurementId,
      measurementVersion: 2,
      status: "verified",
    });
    expect(result.lines.some((line) => line.norm.kind === "labour_or_process")).toBe(true);
  });

  it("does not disclose survey measurements to a catalogue-only user", async () => {
    const { service, query } = setup(false);
    await expect(service.preview(actor, workspaceId, input())).rejects.toThrow("Pre-execution access");
    expect(query).not.toHaveBeenCalled();
  });
});
