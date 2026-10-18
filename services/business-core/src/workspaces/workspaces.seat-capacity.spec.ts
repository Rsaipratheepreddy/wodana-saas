import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { RequestActor } from "../auth/actor";
import { WorkspacesService } from "./workspaces.service";

const workspaceId = "f81e8362-8d08-440a-89dd-06ec7a8b46e7";
const actor: RequestActor = {
  subject: "local:owner",
  provider: "local",
  email: "owner@example.com",
  displayName: "Workspace Owner",
};

function serviceWithCapacity(activeMembers: number, pendingInvitations: number, seatLimit = 5) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT id FROM workspaces") && sql.includes("FOR UPDATE")) {
      return { rowCount: 1, rows: [{ id: workspaceId }] };
    }
    if (sql.includes("SELECT * FROM workspaces")) {
      return { rowCount: 1, rows: [{ id: workspaceId, name: "Test Workspace" }] };
    }
    if (sql.includes("FROM workspace_seat_capacity")) {
      return {
        rowCount: 1,
        rows: [{
          seatLimit, activeMembers, invitedMembers: 0, pendingInvitations,
          reservedSeats: activeMembers + pendingInvitations,
        }],
      };
    }
    if (sql.includes('SELECT DISTINCT role.code AS "roleCode"')) {
      return { rowCount: 1, rows: [{ roleCode: "owner", permissionCode: null }] };
    }
    if (sql.includes("FROM workspace_memberships membership")) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes("SELECT 1 FROM workspace_invitations")) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes("SELECT id, code FROM roles")) {
      return { rowCount: 1, rows: [{ id: "member-role-id", code: "member" }] };
    }
    if (sql.includes("INSERT INTO workspace_invitations")) {
      return { rowCount: 1, rows: [{ id: "invitation-id" }] };
    }
    return { rowCount: 1, rows: [] };
  });
  const client = { query };
  const access = {
    withAnyPermission: vi.fn(async (
      _actor: RequestActor,
      _workspaceId: string,
      _permissions: string[],
      work: (databaseClient: typeof client, resolvedActor: typeof actor & { userId: string }) => Promise<unknown>,
    ) => work(client, { ...actor, userId: "owner-id" })),
  };
  return new WorkspacesService(
    {} as never,
    {} as never,
    access as never,
    {} as never,
    { sendWorkspaceInvitation: vi.fn() } as never,
  );
}

describe("workspace seat capacity", () => {
  it("rejects an invitation when active and pending seats reach the limit", async () => {
    const service = serviceWithCapacity(3, 2);

    await expect(service.inviteMember(actor, workspaceId, {
      email: "new.member@example.com",
      roleCodes: ["member"],
    })).rejects.toMatchObject<ConflictException>({
      response: expect.objectContaining({
        message: "Workspace seat limit reached",
        seatLimit: 5,
        usedSeats: 5,
      }),
    });
  });

  it("allows capacity when the workspace still has a free reserved seat", async () => {
    const service = serviceWithCapacity(3, 1);

    await expect(service.inviteMember(actor, workspaceId, {
      email: "new.member@example.com",
      roleCodes: ["member"],
    })).resolves.toMatchObject({
      id: "invitation-id",
      email: "new.member@example.com",
    });
  });
});
