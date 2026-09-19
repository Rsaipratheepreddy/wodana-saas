import { describe, expect, it } from "vitest";
import { applyExecution, emptyProject, type ExecutionActor } from "./execution.domain";
import {
  designReadinessForTask,
  mergeDesignBaseline,
  sameDesignEvidence,
  synchroniseApprovedDesignDocuments,
} from "./project-design-control";
import type { Task } from "./execution.types";

const task = (): Task => ({
  id: "task-1",
  parentId: "",
  packageId: "package-1",
  package: "Wardrobe",
  title: "Install wardrobe",
  description: "",
  area: "Bedroom",
  location: "site",
  ownerId: "owner",
  assigneeIds: [],
  resourceId: "",
  start: "2026-09-20",
  end: "2026-09-21",
  baselineStart: "2026-09-20",
  baselineEnd: "2026-09-21",
  predecessors: [],
  quantity: 1,
  unit: "nos",
  weight: 1,
  approved: 0,
  status: "planned",
  priority: "normal",
  inspectionRequired: true,
  scopeIds: ["scope-line-1"],
  drawingId: "",
  readiness: { scope: true, access: true, materials: true },
  blocker: "",
});

const baseline = {
  capturedAt: "2026-09-16T10:00:00.000Z",
  links: [
    {
      scopeLineId: "scope-line-1",
      sourceScopeId: "pre-scope-1",
      sourceScopeVersion: 3,
      sourceSpecificationVersion: 2,
      designVersionId: "design-version-1",
      designId: "design-1",
      assetId: "asset-1",
      fileName: "wardrobe-elevation.pdf",
      mimeType: "application/pdf",
      byteSize: 1024,
      hasPreview: false,
      title: "Wardrobe elevation",
      documentType: "drawing",
      revision: 4,
      approvedAt: "2026-09-16T09:00:00.000Z",
    },
  ],
};

describe("project design control", () => {
  it("materialises an approved design revision as project-controlled evidence", () => {
    const data = emptyProject();
    synchroniseApprovedDesignDocuments(data, baseline, baseline.capturedAt, () => "document-1");

    expect(data.documents).toEqual([
      expect.objectContaining({
        id: "document-1",
        status: "approved",
        sourceDesignVersionId: "design-version-1",
        sourceDesignAssetId: "asset-1",
        scopeLineIds: ["scope-line-1"],
      }),
    ]);
  });

  it("compares exact contractual evidence while ignoring only capture time", () => {
    expect(sameDesignEvidence(baseline, { ...baseline, capturedAt: "later" })).toBe(true);
    expect(
      sameDesignEvidence(baseline, {
        ...baseline,
        links: [{ ...baseline.links[0], assetId: "new-asset" }],
      }),
    ).toBe(false);
    expect(sameDesignEvidence(undefined, baseline)).toBe(false);
  });

  it("requires delivery work to point to the approved design captured for its scope", () => {
    const data = emptyProject();
    data.designBaseline = baseline;
    synchroniseApprovedDesignDocuments(data, baseline, baseline.capturedAt, () => "document-1");
    const scopedTask = task();

    expect(designReadinessForTask(data, scopedTask)).toMatchObject({ ready: false });
    scopedTask.drawingId = "document-1";
    expect(designReadinessForTask(data, scopedTask)).toMatchObject({
      ready: true,
      documentIds: ["document-1"],
    });
    data.documents[0].status = "superseded";
    expect(designReadinessForTask(data, scopedTask)).toMatchObject({ ready: false });
  });

  it("enforces the captured design gate when site or factory work starts", () => {
    const data = emptyProject();
    data.phase = "active";
    data.designBaseline = baseline;
    data.workPackages = [{
      id: "package-1",
      scopeLineIds: ["scope-line-1"],
      title: "Wardrobe",
      area: "Bedroom",
      deliveryRoute: "site",
      status: "ready",
      ownerId: "owner",
      plannedStart: "",
      plannedEnd: "",
      blocker: "",
      createdAt: baseline.capturedAt,
      updatedAt: baseline.capturedAt,
    }];
    synchroniseApprovedDesignDocuments(data, baseline, baseline.capturedAt, () => "document-1");
    data.documents.push({
      id: "manual-document",
      title: "Generic drawing",
      kind: "drawing",
      revision: "R1",
      url: "",
      note: "Approved but not part of the released design baseline.",
      status: "approved",
      replaces: "",
      published: false,
    });
    data.tasks = [{ ...task(), drawingId: "manual-document" }];
    const actor: ExecutionActor = {
      id: "owner",
      name: "Owner",
      manage: true,
      review: true,
      report: true,
      buy: true,
      memberIds: ["owner"],
      resourceIds: [],
      now: baseline.capturedAt,
      released: true,
    };

    expect(() => applyExecution(data, "task_status", { id: "task-1", status: "in_progress" }, actor))
      .toThrow(/approved design revision/);
    data.tasks[0].drawingId = "document-1";
    applyExecution(data, "task_status", { id: "task-1", status: "in_progress" }, actor);
    expect(data.tasks[0].status).toBe("in_progress");
  });

  it("keeps older design evidence while adding new variation scope", () => {
    const later = {
      capturedAt: "2026-09-17T10:00:00.000Z",
      links: [
        {
          ...baseline.links[0],
          scopeLineId: "variation-line-1",
          designVersionId: "design-version-2",
          revision: 5,
        },
      ],
    };
    const merged = mergeDesignBaseline(baseline, later);

    expect(merged.links).toHaveLength(2);
    expect(merged.links.map((link) => link.scopeLineId)).toEqual([
      "scope-line-1",
      "variation-line-1",
    ]);
    expect(merged.capturedAt).toBe(baseline.capturedAt);
  });
});
