import { describe, expect, it, vi } from "vitest";
import { readHomeOverview } from "./home-overview";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const membershipId = "00000000-0000-4000-8000-000000000002";

describe("Home overview queries", () => {
  it("does not query inaccessible modules", async () => {
    const client = { query: vi.fn() };
    const result = await readHomeOverview(client as never, workspaceId, membershipId, { sales: false, planning: false, projects: false, manageProjects: false });
    expect(client.query).not.toHaveBeenCalled();
    expect(result.metrics).toEqual({ myFollowUps: null, planningCases: null, activeProjects: null, myProjectTasks: null });
  });

  it("binds workspace and membership, and returns actionable links", async () => {
    const client = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: "follow-up", title: "Call", detail: "Follow-up", date: null, total: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: "case", title: "Villa", detail: "Client", date: null, total: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: "project", title: "Build", detail: "active", date: null, total: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: "task", title: "Install", detail: "Build", date: "2026-09-25", total: 1, projectId: "project", location: "site" }] }) };
    const result = await readHomeOverview(client as never, workspaceId, membershipId, { sales: true, planning: true, projects: true, manageProjects: false });
    expect(client.query).toHaveBeenCalledTimes(4);
    for (const call of client.query.mock.calls) expect(call[1].slice(0, 2)).toEqual([workspaceId, membershipId]);
    expect(result.metrics).toEqual({ myFollowUps: 1, planningCases: 1, activeProjects: 1, myProjectTasks: 1 });
    expect(result.sales[0].href).toBe("/workspace/crm/follow-ups?record=follow-up");
    expect(result.tasks[0].href).toBe("/workspace/tasks?projectId=project&taskId=task");
  });
});
