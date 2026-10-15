import { describe, expect, it, vi } from "vitest";
import { CrmReportingService, walkInChannelsOf } from "./crm-reporting.service";

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
      if (sql.includes("FROM crm_taxonomies") || sql.includes("FROM workspaces workspace JOIN tenant_setup_profiles")) return { rows: [], rowCount: 0 };
      if (sql.includes("intake.source || '/' || intake.channel")) return { rows: [], rowCount: 0 };
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
    // The default taxonomy's walk-in channel, read rather than assumed.
    expect(query.mock.calls.find(([sql]) => sql.includes("intake.source || '/' || intake.channel"))?.[1]).toEqual(expect.arrayContaining([["company/walk_in"]]));
    const groupedSql = query.mock.calls.find(([sql]) => sql.includes("averageDaysSinceUpdate"))![0];
    expect(groupedSql).toContain("THEN 'stale'");
    expect(groupedSql).toContain("THEN 'closed'");
    expect(access.withPermissions).toHaveBeenCalledWith({}, "workspace", ["crm.reports.view"], expect.any(Function));
  });

  it("groups enquiry performance by the stored emirate", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("averageDaysSinceUpdate")) return { rows: [{ id: "outside_uae", label: "outside_uae", leads: 1 }], rowCount: 1 };
      if (sql.includes("FROM crm_intake_events") && sql.includes("GROUP BY status")) return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT count(*)::int AS leads")) return { rows: [{ leads: 1 }], rowCount: 1 };
      if (sql.includes("FROM crm_taxonomies") || sql.includes("FROM workspaces workspace JOIN tenant_setup_profiles")) return { rows: [], rowCount: 0 };
      if (sql.includes("intake.source || '/' || intake.channel")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const access = { withPermissions: vi.fn(async (_actor, _workspaceId, _permissions, work) => work({ query })) };
    const service = new CrmReportingService(access as never);
    const result = await service.report({} as never, "workspace", "lead-flow", { groupBy: "emirate" });
    expect(result).toMatchObject({ groupBy: "emirate", reconciliation: { totalLeads: 1, groupedLeads: 1, matches: true } });
    expect(query.mock.calls.find(([sql]) => sql.includes("averageDaysSinceUpdate"))![0]).toContain("enquiry.details->>'emirate'");
  });
});

describe("walk-ins in the lead-flow report (S-14)", () => {
  it("reads the walk-in channels from the workspace's own taxonomy, under any source", () => {
    expect(walkInChannelsOf({ channels: {
      palm_living_enquiry: [{ id: "showroom_walk_in", label: "Showroom Walk-in" }, { id: "office_walk_in", label: "Office Walk-in" }, { id: "call", label: "Call" }],
      company: [{ id: "walk_in", label: "Walk-in" }, { id: "website", label: "Website" }],
      events: [{ id: "stand", label: "Walk in at our stand" }],
    } })).toEqual(["palm_living_enquiry/showroom_walk_in", "palm_living_enquiry/office_walk_in", "company/walk_in", "events/stand"]);
    expect(walkInChannelsOf({ channels: { referral: [{ id: "internal", label: "Internal" }] } })).toEqual([]);
  });
});

describe("won deals that were cancelled", () => {
  it("are left out of Won in the won and sources reports, on the order's or the job's cancellation", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const access = { withPermissions: vi.fn(async (_actor, _workspaceId, _permissions, work) => work({ query })) };
    const service = new CrmReportingService(access as never);
    for (const report of ["won", "sources"]) await service.report({} as never, "workspace", report, {});
    const [won, sources] = query.mock.calls.map((call) => String((call as unknown as [string])[0]));
    for (const sql of [won, sources]) {
      expect(sql).toContain("FROM crm_deal_fulfilment f");
      expect(sql).toContain("deal_case.status = 'cancelled'");
    }
    // Both halves of Won: the proposals won and the deals won before proposals existed.
    expect(won.match(/deal_case\.cancelled_at END\)\s+IS NULL/g)?.length).toBe(2);
  });
});
