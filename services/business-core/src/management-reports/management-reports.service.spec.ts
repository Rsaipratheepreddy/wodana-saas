import { describe, expect, it, vi } from "vitest";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { ManagementReportsService, VIEW } from "./management-reports.service";

const WS = "11111111-1111-4111-8111-111111111111";

/** The access service as the reports use it: the dashboards' own permission, then what the member holds. */
function service(held: string[]) {
  const access = {
    withPermission: vi.fn(async (_actor: unknown, _workspace: string, permission: string, work: (client: unknown, user: { userId: string }) => unknown) => {
      if (permission !== VIEW && !held.includes(permission)) throw new Error("Forbidden");
      return work({ query: vi.fn(async () => { throw new Error("no database in this test"); }) }, { userId: "u1" });
    }),
    grantedPermissions: vi.fn(async (_client: unknown, _workspace: string, _user: string, asked: string[]) => new Set(asked.filter((code) => held.includes(code)))),
  };
  return new ManagementReportsService(access as unknown as WorkspaceAccessService);
}

describe("management dashboards' permissions", () => {
  it("opens a dashboard only with one of its area's read permissions", async () => {
    const actor = { kind: "user" } as never;
    await expect(service([]).dashboard(actor, WS, "finance", {})).rejects.toThrow("You don't have access to this dashboard.");
    await expect(service(["stock.view"]).records(actor, WS, "finance", { kpi: "cash_in" })).rejects.toThrow("You don't have access to this dashboard.");
    // With the area's permission the read goes ahead (and reaches the database).
    await expect(service(["receivables.view"]).dashboard(actor, WS, "finance", {})).rejects.toThrow("no database in this test");
    // An old address is checked as the dashboard it moved into.
    await expect(service([]).dashboard(actor, WS, "stock-marketing", {})).rejects.toThrow("You don't have access to this dashboard.");
    // The go-live dashboards need nothing beyond opening the dashboards.
    await expect(service([]).dashboard(actor, WS, "owner-overview", {})).rejects.toThrow("no database in this test");
  });
});
