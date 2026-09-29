import { describe, expect, it, vi } from "vitest";
import type { RequestActor } from "../auth/actor";
import { WorkspacesService } from "./workspaces.service";

const actor: RequestActor = {
  subject: "local:role-editor",
  provider: "local",
  email: "editor@example.com",
  displayName: "Role editor",
};

describe("workspace role catalogue access", () => {
  it("lets a scoped role mutator read roles without granting other mutations", async () => {
    const workspaceId = "f81e8362-8d08-440a-89dd-06ec7a8b46e7";
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: "role-1", code: "studio_lead" }] }) };
    const access = { withAnyPermission: vi.fn(async (_actor, _workspaceId, _permissions, work) => work(client)) };
    const service = new WorkspacesService({} as never, {} as never, access as never, {} as never, {} as never);

    await expect(service.listRoles(actor, workspaceId)).resolves.toEqual([{ id: "role-1", code: "studio_lead" }]);
    expect(access.withAnyPermission).toHaveBeenCalledWith(actor, workspaceId, [
      "module.roles.read", "module.roles.write", "module.roles.edit", "module.roles.delete", "workspace.roles.manage",
      "module.members.read", "module.members.write", "module.members.edit", "module.members.delete", "workspace.members.manage",
    ], expect.any(Function));
    expect(client.query.mock.calls[0][0]).toContain('AS "teamCount"');
    expect(client.query.mock.calls[0][0]).toContain('AS "pendingInvitationCount"');
  });

  it("rejects permission escalation by a scoped role creator", async () => {
    const workspaceId = "f81e8362-8d08-440a-89dd-06ec7a8b46e7";
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM workspaces WHERE")) return { rowCount: 1, rows: [{ id: workspaceId }] };
      if (sql.includes("FROM permissions WHERE code = ANY")) return {
        rowCount: 1, rows: [{ id: "permission-1", code: "commercial.deal.approve" }],
      };
      if (sql.includes("FROM workspace_memberships membership")) return {
        rowCount: 1, rows: [{ roleCode: "role_editor", permissionCode: "module.roles.write" }],
      };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const client = { query };
    const access = {
      withAnyPermission: vi.fn(async (_actor, _workspaceId, _permissions, work) => work(client, { userId: "user-1" })),
      effectivePermissions: vi.fn(async (_client, _workspaceId, permissions: string[]) => permissions),
    };
    const service = new WorkspacesService({} as never, {} as never, access as never, {} as never, {} as never);

    await expect(service.createRole(actor, workspaceId, {
      code: "fake_owner", name: "Fake owner", description: "", permissionCodes: ["commercial.deal.approve"],
    })).rejects.toThrow("You cannot manage a role containing permissions outside your own access");
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO roles"))).toBe(false);
  });

  it("refuses a second role with a name that's taken, whatever its case or spaces (m23)", async () => {
    const workspaceId = "f81e8362-8d08-440a-89dd-06ec7a8b46e7";
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM workspaces WHERE")) return { rowCount: 1, rows: [{ id: workspaceId }] };
      if (sql.includes("FROM permissions WHERE code = ANY")) return { rowCount: 1, rows: [{ id: "permission-1", code: "payables.view" }] };
      if (sql.includes("FROM workspace_memberships membership")) return { rowCount: 1, rows: [{ roleCode: "owner", permissionCode: "payables.view" }] };
      if (sql.includes("lower(btrim(name))")) return { rowCount: String(params[1]).trim().toLowerCase() === "finance" ? 1 : 0, rows: [] };
      if (sql.includes("INSERT INTO roles")) return { rowCount: 1, rows: [{ id: "role-2", code: "team_finance", name: params[2] }] };
      return { rowCount: 0, rows: [] };
    });
    const access = {
      withAnyPermission: vi.fn(async (_actor, _workspaceId, _permissions, work) => work({ query }, { userId: "user-1" })),
      effectivePermissions: vi.fn(async (_client, _workspaceId, permissions: string[]) => permissions),
    };
    const service = new WorkspacesService({} as never, {} as never, access as never, {} as never, {} as never);
    await expect(service.createRole(actor, workspaceId, { code: "team_finance", name: " FINANCE ", description: "", permissionCodes: ["payables.view"] }))
      .rejects.toThrow("A role named FINANCE already exists");
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO roles"))).toBe(false);
  });

  it("refuses to delete a role still used by a team or a pending invite", async () => {
    const workspaceId = "f81e8362-8d08-440a-89dd-06ec7a8b46e7";
    const roleId = "c09bdbfd-f755-4389-8ea6-71ac39a04245";
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM workspaces WHERE")) return { rowCount: 1, rows: [{ id: workspaceId }] };
      if (sql.includes("SELECT id FROM roles")) return { rowCount: 1, rows: [{ id: roleId }] };
      if (sql.includes("FROM roles role") && sql.includes("GROUP BY role.id")) return {
        rowCount: 1, rows: [{ id: roleId, code: "studio_lead", isSystem: false, version: 1, permissions: [] }],
      };
      if (sql.includes("FROM workspace_memberships membership")) return {
        rowCount: 1, rows: [{ roleCode: "owner", permissionCode: null }],
      };
      if (sql.includes("AS members") && sql.includes("AS teams")) return {
        rowCount: 1, rows: [{ members: 0, teams: 1, invitations: 1 }],
      };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const access = { withAnyPermission: vi.fn(async (_actor, _workspaceId, _permissions, work) => work({ query }, { userId: "owner" })) };
    const service = new WorkspacesService({} as never, {} as never, access as never, {} as never, {} as never);

    await expect(service.deleteRole(actor, workspaceId, roleId, 1)).rejects.toThrow("Reassign members, teams, and pending invitations");
    expect(query.mock.calls.some(([sql]) => sql.includes("DELETE FROM roles"))).toBe(false);
  });
});

describe("member access delegation", () => {
  const workspaceId = "f81e8362-8d08-440a-89dd-06ec7a8b46e7";
  const roleId = "c09bdbfd-f755-4389-8ea6-71ac39a04245";

  function delegation(actorRole: string, targetRole: string, targetPermission: string | null) {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM workspace_memberships membership")) return {
        rows: [{ roleCode: actorRole, permissionCode: "module.members.write" }],
      };
      if (sql.includes("FROM roles role")) return {
        rows: [{ roleCode: targetRole, permissionCode: targetPermission }],
      };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const access = { effectivePermissions: vi.fn(async (_client, _workspaceId, codes: string[]) => codes) };
    const service = new WorkspacesService({} as never, {} as never, access as never, {} as never, {} as never);
    const check = () => (service as unknown as { assertMemberRoleDelegation: (
      client: unknown, workspaceId: string, actorId: string, roleIds: string[], teamIds: string[],
    ) => Promise<void> }).assertMemberRoleDelegation({ query }, workspaceId, "actor-1", [roleId], []);
    return { check, query };
  }

  it("blocks a scoped inviter from assigning the named Owner role", async () => {
    const { check } = delegation("sales_admin", "owner", null);
    await expect(check()).rejects.toThrow("Only an Owner or Administrator can assign privileged workspace roles");
  });

  it("blocks an outside permission even when the target role is otherwise ordinary", async () => {
    const { check } = delegation("sales_admin", "finance_reviewer", "commercial.finance.verify");
    await expect(check()).rejects.toThrow("You cannot grant access beyond your own permissions");
  });

  it("allows a scoped inviter to delegate only access they already hold", async () => {
    const { check } = delegation("sales_admin", "people_inviter", "module.members.write");
    await expect(check()).resolves.toBeUndefined();
  });
});
