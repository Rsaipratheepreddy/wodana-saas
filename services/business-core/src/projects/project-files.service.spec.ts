import { describe, expect, it, vi } from "vitest";
import type { HrmsAccessService } from "../hrms/hrms-access.service";
import type { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import type { ExecutionService } from "./execution.service";
import { ProjectFilesService } from "./project-files.service";

const actor = { subject: "user" } as never;

function setup() {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM workspace_memberships")) return { rows: [{ id: "member-1", name: "Asha" }] };
    if (sql.includes("FROM pre_project_brief_assets")) return { rows: [{
      id: "pre-file", key: "pre-projects/workspace/case-1/pre-file/original", name: "plan.pdf", mimeType: "application/pdf", bytes: 20,
      uploadedBy: "Noor", uploadedAt: "2026-09-12T10:00:00.000Z", folder: "designs",
      folderLabel: "Living room", recordType: "design", recordId: "design-1", recordTitle: "Floor plan",
    }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const context = { workspaceId: "workspace", membershipId: "member-1", permissions: new Set(["projects.view"]), client: { query } };
  const access = {
    require: vi.fn(),
    run: vi.fn(async (_actor, _workspaceId, work) => work(context)),
  };
  const execution = {
    row: vi.fn().mockResolvedValue({ caseId: "case-1" }),
    load: vi.fn().mockResolvedValue({
      tasks: [{ id: "task-1", title: "Install wardrobes" }], reports: [], orders: [], documents: [], snags: [], handovers: [],
      files: [{ id: "project-file", recordId: "task-1", name: "site.jpg", mimeType: "image/jpeg", bytes: 10, sha256: "hash", by: "member-1", at: "2026-09-13T10:00:00.000Z" }],
    }),
  };
  const storage = { read: vi.fn().mockResolvedValue({ body: Buffer.from("file") }) };
  return { service: new ProjectFilesService(access as never as HrmsAccessService, execution as never as ExecutionService, storage as never as BrandAssetStorageService), query, storage };
}

describe("project lifecycle file index", () => {
  it("combines delivery attachments and pre-execution files with folder context", async () => {
    const { service } = setup();
    const result = await service.list(actor, "workspace", "project");
    expect(result.items).toMatchObject([
      { id: "project-file", source: "delivery", folder: "tasks", recordTitle: "Install wardrobes", uploadedBy: "Asha" },
      { id: "pre-file", source: "pre_execution", folder: "designs", folderLabel: "Living room", recordTitle: "Floor plan" },
    ]);
    expect(result.folders).toEqual([
      { id: "tasks", label: "Tasks", count: 1 },
      { id: "designs", label: "Living room", count: 1 },
    ]);
    expect(result.truncated).toBe(false);
  });

  it("uses the same protected download path for a pre-execution asset", async () => {
    const { service, storage } = setup();
    const file = await service.read(actor, "workspace", "project", "pre-file");
    expect(storage.read).toHaveBeenCalledWith("pre-projects/workspace/case-1/pre-file/original");
    expect(file.mimeType).toBe("application/pdf");
  });
});
