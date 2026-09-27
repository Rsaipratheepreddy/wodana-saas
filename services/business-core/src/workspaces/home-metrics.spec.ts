import { describe, expect, it, vi } from "vitest";
import { activityArea, readHomeMetrics, type HomeMetricsAccess } from "./home-metrics";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const membershipId = "00000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-15T05:30:00.000Z");
const none: HomeMetricsAccess = { enquiries: false, quotes: false, payments: false, projects: false, manageProjects: false, activity: false, storage: false };
const all: HomeMetricsAccess = { enquiries: true, quotes: true, payments: true, projects: true, manageProjects: false, activity: true, storage: true };
const workspaceRow = { timeZone: "America/Los_Angeles", weekStartsOn: 6, currency: "USD" };
const eight = (value: string) => Array.from({ length: 8 }, (_, index) => ({ start: `2026-0${7 + Math.floor(index / 4)}-0${index % 4 + 1}`, value, count: 0 }));

function clientFor(rows: Record<string, unknown>[]) {
  const query = vi.fn().mockResolvedValueOnce({ rows: [workspaceRow] });
  for (const row of rows) query.mockResolvedValueOnce({ rows: [row] });
  return { query };
}

describe("Home metrics queries", () => {
  it("reads only the workspace region when no section is permitted, and omits every section", async () => {
    const client = clientFor([]);
    const result = await readHomeMetrics(client as never, workspaceId, membershipId, none, now);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls[0][1]).toEqual([workspaceId]);
    expect(result).toEqual({ generatedAt: now.toISOString(), timeZone: "America/Los_Angeles", weekStartsOn: 6, currency: "USD" });
    for (const key of ["enquiries", "quotes", "payments", "projects", "activity", "storage"]) expect(key in result).toBe(false);
  });

  it("queries only the permitted sections", async () => {
    const client = clientFor([{ current: 2, previous: 1, weekly: eight("0") }]);
    const result = await readHomeMetrics(client as never, workspaceId, membershipId, { ...none, enquiries: true }, now);
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls[1][0]).toContain("FROM crm_leads");
    expect(Object.keys(result).sort()).toEqual(["currency", "enquiries", "generatedAt", "timeZone", "weekStartsOn"]);
  });

  it("binds the workspace in every query and buckets weeks in the workspace's time zone and week start", async () => {
    const client = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [workspaceRow] })
      .mockResolvedValueOnce({ rows: [{ current: 3, previous: 1, weekly: eight("1") }] })
      .mockResolvedValueOnce({ rows: [{ issuedValue: "3000.75", previousIssuedValue: "300.00", issuedCount: 3, accepted: 1, previousAccepted: 1, weekly: eight("12.50") }] })
      .mockResolvedValueOnce({ rows: [{ received: "500.00", previousReceived: "250.00", due: "899.90", weekly: eight("0.00") }] })
      .mockResolvedValueOnce({ rows: [{ active: 5, overdueTasks: 2, late: 2, atRisk: 2, onTrack: 1, weekly: eight("1") }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ used: "5120", projects: "3700", planning: "900", catalog: "400", other: "120", quota: null }] }) };
    const result = await readHomeMetrics(client as never, workspaceId, membershipId, all, now);
    const calls = client.query.mock.calls as Array<[string, unknown[]]>;
    expect(calls).toHaveLength(7);
    for (const [, params] of calls) expect(params[0]).toBe(workspaceId);
    // The region comes from the workspace row and is passed to every bucketed query.
    expect(calls[0][0]).toContain("default_timezone");
    expect(calls[0][0]).toContain("week_starts_on");
    const bucketed = calls.filter(([sql]) => sql.includes("generate_series"));
    expect(bucketed).toHaveLength(4);
    for (const [sql, params] of bucketed) {
      expect(params.slice(1, 4)).toEqual([now.toISOString(), "America/Los_Angeles", 6]);
      expect(sql).toContain("AT TIME ZONE $3::text");
      expect(sql).toContain("$4::int");
    }
    // Money sections compare the workspace currency and round to its minor units.
    const quotes = calls.find(([sql]) => sql.includes("FROM commercial_quotes quote"))!;
    const payments = calls.find(([sql]) => sql.includes("FROM commercial_receipts receipt"))!;
    expect(quotes[1].slice(4)).toEqual(["USD", 2]);
    expect(payments[1].slice(4)).toEqual(["USD", 2]);
    const projects = calls.find(([sql]) => sql.includes("visible AS"))!;
    expect(projects[1].slice(4)).toEqual([membershipId, false]);
    expect(result.activity).toEqual([]);
    expect(result.storage).toEqual({ usedBytes: "5120", quotaBytes: null, areas: { projects: "3700", planning: "900", catalog: "400", other: "120" } });
  });

  it("maps rows to the contract with money kept as strings and all eight weeks", async () => {
    const weekly = eight("1234567890123.45");
    const client = clientFor([
      { current: 3, previous: 1, weekly: eight("1") },
      { issuedValue: "9007199254740993.10", previousIssuedValue: "0.00", issuedCount: 3, accepted: 1, previousAccepted: 0, weekly },
      { received: "0.10", previousReceived: "0.20", due: "0.30", weekly },
      { active: 5, overdueTasks: 2, late: 2, atRisk: 2, onTrack: 1, weekly: eight("0") },
      { id: "event", action: "crm.lead.created.v1", entityType: "crm_lead", entityId: "lead-1", at: new Date("2026-09-14T01:00:00Z"), actorName: "Sara", subject: "Amira" },
      { used: "9007199254740993", projects: "1", planning: "2", catalog: "3", other: "9007199254740987", quota: "10737418240" },
    ]);
    const result = await readHomeMetrics(client as never, workspaceId, membershipId, all, now);
    expect(result.quotes).toEqual({ issuedValue: "9007199254740993.10", previousIssuedValue: "0.00", issuedCount: 3, accepted: 1, previousAccepted: 0, weekly });
    expect(result.quotes!.weekly).toHaveLength(8);
    expect(result.payments).toEqual({ received: "0.10", previousReceived: "0.20", due: "0.30", weekly });
    expect(result.enquiries).toEqual({ current: 3, previous: 1, weekly: eight("1") });
    expect(result.projects).toEqual({ active: 5, overdueTasks: 2, onTrack: 1, atRisk: 2, late: 2, weekly: eight("0") });
    expect(result.activity).toEqual([{ id: "event", area: "sales", action: "crm.lead.created.v1", subject: "Amira", actorName: "Sara",
      at: "2026-09-14T01:00:00.000Z", href: "/workspace/crm/leads?record=lead-1" }]);
    expect(result.storage).toEqual({ usedBytes: "9007199254740993", quotaBytes: "10737418240",
      areas: { projects: "1", planning: "2", catalog: "3", other: "9007199254740987" } });
  });

  it("falls back to UTC for an unknown time zone", async () => {
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [{ timeZone: "Mars/Olympus", weekStartsOn: 0, currency: "EUR " }] }) };
    const result = await readHomeMetrics(client as never, workspaceId, membershipId, none, now);
    expect(result).toMatchObject({ timeZone: "UTC", weekStartsOn: 0, currency: "EUR" });
  });

  it("maps audit actions to coarse areas", () => {
    expect(activityArea("crm.lead.created.v1")).toBe("sales");
    expect(activityArea("pre_project.asset_uploaded.v1")).toBe("planning");
    expect(activityArea("quotation.lines_changed.v1")).toBe("planning");
    expect(activityArea("project.started")).toBe("projects");
    expect(activityArea("client_invoice.issued")).toBe("finance");
    expect(activityArea("receivables.overdue")).toBe("finance");
    expect(activityArea("hrms.employee_enrolled.v1")).toBe("people");
    expect(activityArea("workspace.member_invited")).toBe("people");
    expect(activityArea("workspace.appearance_updated")).toBe("settings");
    expect(activityArea("supplier.created")).toBe("other");
    expect(activityArea("client_portal.handover_decision", "project")).toBe("projects");
    expect(activityArea("client_portal.quote_decision", "pre_project_case")).toBe("planning");
  });
});
