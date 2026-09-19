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

  it("reconciles every enquiry-health grouping to the underlying lead total", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("averageDaysSinceUpdate")) return { rows: [
        { id: "current", label: "current", leads: 2, unassigned: 0, qualified: 0, stale: 0 },
        { id: "closed", label: "closed", leads: 1, unassigned: 0, qualified: 1, stale: 0 },
      ], rowCount: 2 };
      if (sql.includes("FROM crm_intake_events") && sql.includes("GROUP BY status")) return { rows: [{ status: "ready", count: 3 }], rowCount: 1 };
      if (sql.includes("SELECT count(*)::int AS leads")) return { rows: [{ leads: 3, unassigned: 0, qualified: 1, disqualified: 0, stale: 0 }], rowCount: 1 };
      if (sql.includes("intake.channel='walk_in'")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const access = { withPermissions: vi.fn(async (_actor, _workspaceId, _permissions, work) => work({ query })) };
    const service = new CrmReportingService(access as never);
    const result = await service.report({} as never, "workspace", "lead-flow", {
      groupBy: "freshness", from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z",
    });

    expect(result).toMatchObject({
      report: "lead-flow",
      groupBy: "freshness",
      summary: { leads: 3, qualified: 1 },
      reconciliation: { totalLeads: 3, groupedLeads: 3, matches: true },
    });
    const groupedSql = query.mock.calls[0][0];
    expect(groupedSql).toContain("THEN 'stale'");
    expect(groupedSql).toContain("THEN 'closed'");
    expect(access.withPermissions).toHaveBeenCalledWith({}, "workspace", ["crm.reports.view"], expect.any(Function));
  });
});
