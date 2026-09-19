import { describe, expect, it, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import type { RequestActor } from "../auth/actor";
import { WorkspaceAccessService } from "./workspace-access.service";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const actor: RequestActor = { provider: "local", subject: "local:user", email: "user@example.test", displayName: "User" };

function harness(entitlement: { status: string; modules: string[] } | null) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("JOIN workspaces workspace")) return { rowCount: 1, rows: [{ allowed: 1 }] };
    if (sql.includes("FROM effective_workspace_entitlements")) {
      return entitlement ? { rowCount: 1, rows: [entitlement] } : { rowCount: 0, rows: [] };
    }
    if (sql.includes("count(DISTINCT permission.code)")) return { rowCount: 1, rows: [{ granted: 1 }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const database = {
    tenantTransaction: vi.fn(async (_workspaceId: string, _actorId: string, work: (client: { query: typeof query }) => Promise<unknown>) => work({ query })),
  };
  const identities = { resolveActor: vi.fn(async () => ({ ...actor, userId })) };
  return { service: new WorkspaceAccessService(database as never, identities as never), query };
}

describe("WorkspaceAccessService module entitlements", () => {
  it("denies a permission when its commercial module is not included", async () => {
    const { service, query } = harness({ status: "active", modules: ["workspace", "crm"] });
    const work = vi.fn();

    await expect(service.withPermission(actor, workspaceId, "projects.manage", work)).rejects.toBeInstanceOf(ForbiddenException);
    expect(work).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => String(sql).includes("count(DISTINCT permission.code)"))).toBe(false);
  });

  it("preserves legacy role behavior until an entitlement set is configured", async () => {
    const { service } = harness(null);
    const work = vi.fn(async () => "allowed");

    await expect(service.withPermission(actor, workspaceId, "projects.manage", work)).resolves.toBe("allowed");
    expect(work).toHaveBeenCalledOnce();
  });

  it("keeps workspace administration available while a tenant allocation is suspended", async () => {
    const { service } = harness({ status: "suspended", modules: ["workspace", "crm", "projects"] });
    await expect(service.withPermission(actor, workspaceId, "workspace.settings.manage", async () => "allowed")).resolves.toBe("allowed");
  });
});
