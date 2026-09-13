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

describe("WorkspacesService invitation email", () => {
  it("commits the invitation before asking Mailgun to deliver it", async () => {
    let transactionFinished = false;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id FROM workspaces") && sql.includes("FOR UPDATE")) {
        return { rowCount: 1, rows: [{ id: workspaceId }] };
      }
      if (sql.includes("SELECT * FROM workspaces")) {
        return {
          rowCount: 1,
          rows: [{
            id: workspaceId,
            name: "Iglo Architects",
            slug: "iglo-architects",
            status: "active",
            default_currency: "AED",
            default_locale: "en-AE",
            default_timezone: "Asia/Dubai",
            unit_system: "metric",
            week_starts_on: 1,
            version: 1,
            created_at: new Date(),
            updated_at: new Date(),
          }],
        };
      }
      if (sql.includes("FROM workspace_subscriptions subscription")) {
        return {
          rowCount: 1,
          rows: [{ seatLimit: 5, activeMembers: 1, pendingInvitations: 0 }],
        };
      }
      if (sql.includes("FROM workspace_memberships membership")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("SELECT 1 FROM workspace_invitations")) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("SELECT id, code FROM roles")) {
        return { rowCount: 1, rows: [{ id: "role-id", code: "member" }] };
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
        _id: string,
        _permissions: string[],
        work: (databaseClient: typeof client, resolvedActor: typeof actor & { userId: string }) => Promise<unknown>,
      ) => {
        const result = await work(client, { ...actor, userId: "owner-id" });
        transactionFinished = true;
        return result;
      }),
    };
    const sendWorkspaceInvitation = vi.fn(async () => {
      expect(transactionFinished).toBe(true);
      return { status: "sent" as const, provider: "mailgun" as const, messageId: "message-id" };
    });
    const service = new WorkspacesService(
      {} as never,
      {} as never,
      access as never,
      {} as never,
      { sendWorkspaceInvitation } as never,
    );

    const result = await service.inviteMember(actor, workspaceId, {
      displayName: "Maya Thomas",
      email: "maya@example.com",
      roleCodes: ["member"],
    });

    expect(result).toMatchObject({
      id: "invitation-id",
      email: "maya@example.com",
      emailDelivery: { status: "sent", provider: "mailgun", messageId: "message-id" },
    });
    expect(sendWorkspaceInvitation).toHaveBeenCalledWith(expect.objectContaining({
      email: "maya@example.com",
      inviterName: "Workspace Owner",
      recipientName: "Maya Thomas",
      roleCodes: ["member"],
      workspaceName: "Iglo Architects",
      invitationToken: result.invitationToken,
    }));
  });
});
