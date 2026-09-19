import { describe, expect, it, vi } from "vitest";
import { HrmsAccessService } from "./hrms-access.service";

describe("HrmsAccessService commercial entitlement boundary", () => {
  it("removes unsold role permissions before project and HRMS record scope is evaluated", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM workspace_memberships")) return { rowCount: 1, rows: [{ id: "member-1" }] };
      if (sql.includes("FROM effective_member_roles")) return {
        rowCount: 2,
        rows: [{ code: "projects.view" }, { code: "hrms.self" }],
      };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const access = {
      asMember: vi.fn(async (_actor, _workspaceId, work) => work({ query }, { userId: "user-1" })),
      effectivePermissions: vi.fn(async (_client, _workspaceId, permissions: string[]) =>
        permissions.filter((permission) => permission === "hrms.self")),
    };
    const service = new HrmsAccessService(access as never, {} as never);

    const context = await service.run({} as never, "workspace-1", async (value) => value);

    expect([...context.permissions]).toEqual(["hrms.self"]);
    expect(access.effectivePermissions).toHaveBeenCalledWith(expect.anything(), "workspace-1", ["projects.view", "hrms.self"]);
  });
});
