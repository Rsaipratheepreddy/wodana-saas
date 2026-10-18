import { describe, expect, it, vi } from "vitest";
import { HrmsAccessService } from "./hrms-access.service";

function harness(roleCodes: string[], sold: (code: string) => boolean) {
  const statements: string[] = [];
  const query = vi.fn(async (sql: string) => {
    statements.push(sql);
    if (sql.includes("FROM workspace_memberships WHERE")) return { rowCount: 1, rows: [{ id: "member-1" }] };
    if (sql.includes("FROM effective_member_roles")) return { rowCount: roleCodes.length, rows: roleCodes.map((code) => ({ code })) };
    if (sql.includes("manager_id=$2")) return { rowCount: 0, rows: [] };
    if (sql.includes("FROM hrms_settings WHERE")) return { rowCount: 1, rows: [{}] };
    if (sql.includes("INSERT INTO hrms_employees")) return { rowCount: 0, rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const access = {
    asMember: vi.fn(async (_actor, _workspaceId, work) => work({ query }, { userId: "user-1" })),
    effectivePermissions: vi.fn(async (_client, _workspaceId, permissions: string[]) => [...new Set(permissions.filter(sold))]),
  };
  return { service: new HrmsAccessService(access as never, {} as never), access, statements };
}

describe("HrmsAccessService commercial entitlement boundary", () => {
  it("removes unsold role permissions before project and HRMS record scope is evaluated", async () => {
    const { service, access } = harness(["projects.view", "hrms.self"], (code) => code === "hrms.self");
    const context = await service.run({} as never, "workspace-1", async (value) => value);
    expect([...context.permissions]).toEqual(["hrms.self"]);
    expect(access.effectivePermissions).toHaveBeenCalledWith(expect.anything(), "workspace-1", ["projects.view", "hrms.self", "hrms.self"]);
  });

  it("gives every member their own attendance and leave, and enrols the workspace on first use", async () => {
    const { service, statements } = harness(["crm.leads.view"], (code) => code.startsWith("hrms.") || code.startsWith("crm."));
    const context = await service.run({} as never, "workspace-1", async (value) => value);
    expect(context.permissions.has("hrms.self")).toBe(true);
    expect(statements.some((sql) => sql.includes("INSERT INTO hrms_employees"))).toBe(true);
  });

  it("leaves a workspace without HRMS untouched", async () => {
    const { service, statements } = harness(["projects.view"], (code) => code === "projects.view");
    const context = await service.run({} as never, "workspace-1", async (value) => value);
    expect([...context.permissions]).toEqual(["projects.view"]);
    expect(statements.some((sql) => sql.includes("hrms_"))).toBe(false);
  });
});
