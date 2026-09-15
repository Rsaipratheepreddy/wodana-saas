import { describe, expect, it, vi } from "vitest";
import type { RequestActor } from "../auth/actor";
import { WorkspacesService } from "./workspaces.service";

const workspaceId = "f81e8362-8d08-440a-89dd-06ec7a8b46e7";
const actor: RequestActor = { subject: "local:owner", provider: "local", email: "owner@example.com", displayName: "Owner" };
const workspace = {
  id: workspaceId, name: "Palm Living", slug: "palm-living", status: "active",
  default_currency: "AED", default_locale: "en-AE", default_timezone: "Asia/Dubai",
  unit_system: "metric", week_starts_on: 1, version: 1,
  created_at: new Date("2026-09-16T00:00:00Z"), updated_at: new Date("2026-09-16T00:00:00Z"),
};

describe("WorkspacesService workspace appearance", () => {
  it("updates the tenant colour with workspace-version protection and an audit event", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT id FROM workspaces") && sql.includes("FOR UPDATE")) return { rowCount: 1, rows: [{ id: workspaceId }] };
      if (sql.includes("SELECT * FROM workspaces")) return { rowCount: 1, rows: [workspace] };
      if (sql.includes("SELECT primary_color")) return { rowCount: 1, rows: [{ primaryColor: null }] };
      if (sql.includes("UPDATE workspaces")) return { rowCount: 1, rows: [{ ...workspace, version: 2 }] };
      return { rowCount: 1, rows: [] };
    });
    const client = { query };
    const access = { withAnyPermission: vi.fn(async (_actor, _id, _permissions, work) => work(client, { ...actor, userId: "00000000-0000-4000-8000-000000000010" })) };
    const service = new WorkspacesService({} as never, {} as never, access as never, {} as never, {} as never);

    const result = await service.updateAppearance(actor, workspaceId, { workspaceVersion: 1, primaryColor: "#6F4DA0" });
    expect(result).toMatchObject({ primaryColor: "#6F4DA0", workspace: { version: 2 } });
    expect(access.withAnyPermission).toHaveBeenCalledWith(actor, workspaceId, ["module.organization.edit", "workspace.settings.manage"], expect.any(Function));
    expect(query.mock.calls.find(([sql]) => sql.includes("INSERT INTO tenant_login_branding"))?.[1]).toEqual([workspaceId, "palm-living", "Palm Living", "#6F4DA0"]);
    expect(query.mock.calls.find(([sql]) => sql.includes("INSERT INTO audit_events"))?.[1]?.[4]).toBe("workspace.appearance_updated");
  });
});
