import { describe, expect, it, vi } from "vitest";
import type { RequestActor } from "../auth/actor";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { PreProjectReadinessService } from "./pre-project-readiness.service";

const actor = {
  subject: "readiness-user",
  email: "readiness@example.com",
  displayName: "Readiness User",
  provider: "development",
} as RequestActor;

function setup(caseExists = true) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM pre_project_cases"))
      return {
        rowCount: caseExists ? 1 : 0,
        rows: caseExists
          ? [{ id: "case-1", status: "active", phase: "design", version: 5 }]
          : [],
      };
    if (sql.includes("sitePlanCount"))
      return {
        rowCount: 1,
        rows: [{ sitePlanCount: 1, openObservationCount: 0 }],
      };
    if (sql.includes("FROM pre_project_brief_entries entry"))
      return {
        rowCount: 1,
        rows: [
          {
            id: "scope-1",
            title: "Wardrobe",
            roomId: "room-1",
            roomName: "Bedroom",
            version: 3,
            scopeStatus: "included",
            reviewStatus: "reviewed",
            archivedAt: null,
            specificationVersion: 4,
            specification: { materials: [{ status: "selected" }] },
          },
        ],
      };
    if (sql.includes("FROM pre_project_site_records record") && sql.includes("record.kind='measurement'"))
      return {
        rowCount: 1,
        rows: [
          {
            entryId: "scope-1",
            id: "measurement-1",
            version: 2,
            status: "verified",
            hasEvidence: true,
          },
        ],
      };
    if (sql.includes("FROM pre_project_item_design_refs reference"))
      return {
        rowCount: 2,
        rows: [
          {
            entryId: "scope-1",
            specificationVersion: 4,
            versionId: "design-version-2",
            designId: "design-1",
            number: 2,
            latestNumber: 2,
            status: "approved",
            usage: "2d",
            blockingOpen: false,
          },
          {
            entryId: "scope-1",
            specificationVersion: 3,
            versionId: "old-design-version",
            designId: "design-1",
            number: 1,
            latestNumber: 2,
            status: "approved",
            usage: "2d",
            blockingOpen: false,
          },
        ],
      };
    throw new Error(`Unexpected readiness query: ${sql}`);
  });
  const withPermission = vi.fn(
    async (_actor, _workspaceId, _permission, callback) => callback({ query }),
  );
  return {
    service: new PreProjectReadinessService({
      withPermission,
    } as unknown as WorkspaceAccessService),
    query,
    withPermission,
  };
}

describe("PreProjectReadinessService", () => {
  it("uses the tenant boundary and only the current specification lineage", async () => {
    const { service, query, withPermission } = setup();
    const result = await service.get(actor, "workspace-1", "case-1", {
      target: "pricing",
    });

    expect(withPermission).toHaveBeenCalledWith(
      actor,
      "workspace-1",
      "pre_projects.view",
      expect.any(Function),
    );
    expect(result.ready).toBe(true);
    expect(result.items[0].checks.find((value) => value.code === "newer_design_revision")).toBeUndefined();
    expect(query.mock.calls.every(([, values]) => values[0] === "workspace-1" && values[1] === "case-1")).toBe(true);
  });

  it("does not disclose a missing or other-workspace preparation", async () => {
    const { service } = setup(false);
    await expect(
      service.get(actor, "workspace-1", "case-outside-workspace"),
    ).rejects.toThrow("Pre-execution not found");
  });
});
