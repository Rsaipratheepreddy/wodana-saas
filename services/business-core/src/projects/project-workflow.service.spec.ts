import { describe, expect, it, vi } from "vitest";
import type { RequestActor } from "../auth/actor";
import type { CrmEventsService } from "../crm/shared/crm-events.service";
import type { HrmsAccessService } from "../hrms/hrms-access.service";
import { builtInProjectWorkflow } from "./project-workflow";
import { ProjectWorkflowService } from "./project-workflow.service";

const actor = { sub: "user" } as RequestActor;
const workspaceId = "10000000-0000-4000-8000-000000000001";
const templateId = "20000000-0000-4000-8000-000000000001";

function templateInput(version = 0) {
  const fallback = builtInProjectWorkflow();
  return {
    version,
    code: "standard_delivery",
    name: "Standard project delivery",
    description: fallback.description,
    isDefault: true,
    stages: fallback.stages,
  };
}

function harness(query: ReturnType<typeof vi.fn>) {
  const requirePermission = vi.fn();
  const run = vi.fn(async (_actor, requestedWorkspaceId, work) =>
    work({
      client: { query },
      workspaceId: requestedWorkspaceId,
      userId: "user-1",
      membershipId: "member-1",
      permissions: new Set(["projects.manage"]),
    }),
  );
  const record = vi.fn().mockResolvedValue("event-1");
  return {
    service: new ProjectWorkflowService(
      { run, require: requirePermission } as unknown as HrmsAccessService,
      { record } as unknown as CrmEventsService,
    ),
    run,
    requirePermission,
    record,
  };
}

describe("ProjectWorkflowService", () => {
  it("resolves the built-in workflow without writing tenant data", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
    const { service, requirePermission } = harness(query);
    const result = await service.list(actor, workspaceId);
    expect(result.defaultTemplate.source).toBe("built_in");
    expect(result.templates).toEqual([]);
    expect(requirePermission).toHaveBeenCalledWith(
      expect.anything(),
      "projects.view",
      "projects.manage",
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("creates an audited workspace default with optimistic version zero", async () => {
    const saved = {
      id: templateId,
      ...templateInput(1),
      status: "active",
      updatedAt: "2026-09-15T00:00:00.000Z",
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [saved] });
    const { service, record } = harness(query);
    const result = await service.save(
      actor,
      workspaceId,
      templateId,
      templateInput(),
    );
    expect(result).toMatchObject({
      id: templateId,
      version: 1,
      source: "workspace",
      isDefault: true,
    });
    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "project.workflow_template_saved.v1",
        entityId: templateId,
      }),
    );
  });

  it("rejects a stale update before changing a default or template", async () => {
    const current = {
      id: templateId,
      ...templateInput(2),
      status: "active",
      updatedAt: "2026-09-15T00:00:00.000Z",
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [current] });
    const { service, record } = harness(query);
    await expect(
      service.save(actor, workspaceId, templateId, templateInput(1)),
    ).rejects.toThrow("changed");
    expect(query).toHaveBeenCalledTimes(2);
    expect(record).not.toHaveBeenCalled();
  });

  it("archives by version and keeps the record as audit evidence", async () => {
    const current = {
      id: templateId,
      ...templateInput(3),
      status: "active",
      updatedAt: "2026-09-15T00:00:00.000Z",
    };
    const archived = {
      ...current,
      status: "archived",
      isDefault: false,
      version: 4,
      updatedAt: "2026-09-15T00:01:00.000Z",
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [current] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [archived] });
    const { service, record } = harness(query);
    const result = await service.archive(actor, workspaceId, templateId, {
      version: 3,
    });
    expect(result).toMatchObject({ status: "archived", version: 4 });
    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "project.workflow_template_archived.v1",
        before: expect.objectContaining({ status: "active", version: 3 }),
      }),
    );
  });
});
