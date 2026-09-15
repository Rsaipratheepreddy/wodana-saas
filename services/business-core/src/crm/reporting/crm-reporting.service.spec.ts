import { describe, expect, it, vi } from "vitest";
import { CrmReportingService } from "./crm-reporting.service";

describe("CRM SLA reporting", () => {
  it("reports measured response evidence and frozen owner accountability", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("GROUP BY instance.status")) return { rows: [{ status: "stopped", count: 3, responded: 3 }], rowCount: 1 };
      if (sql.includes("percentile_cont")) return { rows: [{ total: 3, responded: 3, withinTarget: 2, breached: 1 }], rowCount: 1 };
      if (sql.includes("GROUP BY instance.owner_membership_id")) return { rows: [{ owner: "Asha", total: 3 }], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const access = {
      withPermissions: vi.fn(async (_actor, _workspaceId, _permissions, work) => work({ query })),
    };
    const service = new CrmReportingService(access as never);
    const result = await service.report({} as never, "workspace", "sla", {
      from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z",
    });

    expect(result).toMatchObject({
      report: "sla",
      rows: [{ status: "stopped", count: 3 }],
      summary: { total: 3, withinTarget: 2, breached: 1 },
      owners: [{ owner: "Asha", total: 3 }],
    });
    expect(access.withPermissions).toHaveBeenCalledWith({}, "workspace", ["crm.reports.view"], expect.any(Function));
    const sql = query.mock.calls.map(([statement]) => statement).join("\n");
    expect(sql).toContain("instance.response_elapsed_minutes");
    expect(sql).toContain("instance.policy_snapshot->>'breachAfterMinutes'");
    expect(sql).toContain("membership.id=instance.owner_membership_id");
    expect(sql).not.toContain("lead.owner_membership_id");
    expect(query.mock.calls.every(([, values]) => values?.[0] === "workspace")).toBe(true);
  });
});
