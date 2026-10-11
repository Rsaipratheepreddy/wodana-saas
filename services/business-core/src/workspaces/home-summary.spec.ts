import { describe, expect, it, vi } from "vitest";
import { readHomeSummary, type HomeSummaryAccess } from "./home-summary";
import { readWaitingApprovals, type HomeApprovalAccess, type HomeApprovalSource } from "./home-approvals";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const person = { workspaceId, membershipId: "00000000-0000-4000-8000-000000000002", userId: "00000000-0000-4000-8000-000000000003" };
// 21:30 on 27 September in UTC is already 28 September in Dubai.
const now = new Date("2026-09-27T21:30:00.000Z");
const noApprovals: HomeApprovalAccess = { designs: false, reviewDesigns: false, recordClientDesigns: false, reviewQuotes: false, verifyPayments: false, approveOrders: false, manageLeave: false, projects: false, manageProjects: false };
const none: HomeSummaryAccess = { followUps: false, replies: false, leads: false, assignLeads: false, planning: false, projects: false, manageProjects: false, receivables: false, purchasing: false, factory: false, approvals: noApprovals };

type Call = [string, unknown[]];
/** A client that answers the workspace row, then routes each query by the table it reads. */
function clientFor(answers: Array<[RegExp, unknown[]]> = []) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM workspaces")) return { rows: [{ timeZone: "Asia/Dubai" }] };
    const hit = answers.find(([pattern]) => pattern.test(sql));
    return { rows: hit ? hit[1] : [] };
  });
  return { query, calls: () => query.mock.calls as unknown as Call[] };
}

describe("Home summary", () => {
  it("reads only the workspace calendar and the person's recent records when nothing else is permitted", async () => {
    const client = clientFor();
    const summary = await readHomeSummary(client as never, person, none, now);
    expect(summary).toMatchObject({ timeZone: "Asia/Dubai", today: "2026-09-28", focus: { items: [], total: 0 }, upcoming: [], funnel: [], recent: [], projects: [] });
    const tables = client.calls().map(([sql]) => sql.match(/FROM (\w+)/)?.[1]);
    expect(tables).toEqual(["workspaces", "audit_events"]);
    // Every recent-record kind is switched off by permission.
    expect(client.calls()[1][1].slice(4)).toEqual([false, false, false, false, false, false]);
  });

  it("binds the workspace first in every query and reads each source only with its permission", async () => {
    const client = clientFor();
    await readHomeSummary(client as never, person, { ...none, followUps: true, purchasing: true }, now);
    for (const [, params] of client.calls()) expect(params[0]).toBe(workspaceId);
    const sql = client.calls().map(([text]) => text).filter((text) => !text.includes("WITH touched")).join("\n");
    expect(sql).toContain("FROM crm_activities");
    expect(sql).toContain("FROM crm_appointments");
    expect(sql).toContain("FROM purchase_orders");
    for (const table of ["work_items", "client_invoices", "work_orders", "crm_leads lead WHERE", "pre_project_cases pre_case\n", "commercial_quotes quote\n"]) expect(sql).not.toContain(`FROM ${table}`);
  });

  it("keeps only what waits for the person's decision in focus: what is due comes from My day (the reminder engine)", async () => {
    const client = clientFor([
      [/status = 'pending_approval'/, [{ recordId: "po-1", parentId: null, title: "PO-17", context: "Oak & Co", due: new Date("2026-09-20T08:00:00Z") }]],
    ]);
    const summary = await readHomeSummary(client as never, person, { ...none, followUps: true, projects: true, leads: true, assignLeads: true, approvals: { ...noApprovals, approveOrders: true } }, now);
    expect(summary.focus.items.map((item) => [item.id, item.urgency])).toEqual([["order_approval:po-1", "waiting"]]);
    expect(summary.focus.total).toBe(1);
    expect(summary.focus.items[0].href).toBe("/workspace/purchasing/orders?order=po-1");
    // The person never approves an order they raised or submitted.
    const approval = client.calls().find(([sql]) => sql.includes("pending_approval"))!;
    expect(approval[0]).toContain("purchase.created_by <> $2");
    expect(approval[1]).toEqual([workspaceId, person.userId]);
    // Due and overdue work, unowned enquiries and clients to confirm are no longer read here.
    const sql = client.calls().map(([text]) => text).join("\n");
    expect(sql).not.toContain("crm_identity_candidates");
    expect(sql).not.toContain("lead.owner_membership_id IS NULL AND lead.status");
    expect(sql).not.toContain("crm_sla_instances sla\n");
  });

  it("reads a quiet week further ahead, then the work due on the person's projects", async () => {
    const client = clientFor([
      [/FROM work_items item[\s\S]*item.due_date > \$3::date/, []],
    ]);
    let calls = 0;
    client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM workspaces")) return { rows: [{ timeZone: "Asia/Dubai" }] };
      if (/FROM work_items item[\s\S]*item.due_date > \$3::date/.test(sql)) {
        calls += 1;
        const [, , , days, , team] = params as [string, string, string, number, boolean, boolean];
        return { rows: team && days === 30 ? [1, 2, 3].map((index) => ({ recordId: `w-${index}`, linkId: "p-1", title: "Fit on site", context: "Villa 12 · Rami", due: `2026-10-0${index}` })) : [] };
      }
      return { rows: [] };
    });
    const summary = await readHomeSummary(client as never, person, { ...none, projects: true }, now);
    expect(calls).toBe(3);
    expect(summary.horizonDays).toBe(30);
    expect(summary.upcoming.map((item) => item.id)).toEqual(["work:w-1", "work:w-2", "work:w-3"]);
    expect(summary.upcoming[0]).toMatchObject({ allDay: true, href: "/workspace/projects/p-1/plan?item=w-1" });
  });

  it("orders upcoming items on the workspace calendar, all-day items before timed ones on the same day", async () => {
    const client = clientFor([
      [/FROM crm_appointments appointment\s+JOIN crm_activities/, [{ recordId: "m-1", linkId: "a-1", title: "Site visit", context: "Amira", due: new Date("2026-09-29T06:30:00Z") }]],
      [/FROM purchase_orders purchase[\s\S]*BETWEEN/, [{ recordId: "po-2", title: "PO-11", context: "Oak & Co", due: "2026-09-29" }, { recordId: "po-3", title: "PO-12", context: "Oak & Co", due: "2026-10-01" }]],
    ]);
    const summary = await readHomeSummary(client as never, person, { ...none, followUps: true, purchasing: true }, now);
    expect(summary.upcoming.map((item) => item.id)).toEqual(["delivery:po-2", "meeting:m-1", "delivery:po-3"]);
    expect(summary.upcoming[1]).toMatchObject({ allDay: false, href: "/workspace/crm/follow-ups?record=a-1" });
    expect(summary.horizonDays).toBe(7);
  });

  it("returns the funnel stages the person may see, each linking to its list", async () => {
    const client = clientFor([
      [/FROM crm_leads lead WHERE/, [{ count: 11, stuck: 5 }]],
      [/WITH open_cases/, [{ planning: 6, planningStuck: 1, quotes: 3, quotesStuck: 0 }]],
    ]);
    const summary = await readHomeSummary(client as never, person, { ...none, leads: true, planning: true }, now);
    expect(summary.funnel).toEqual([
      { id: "enquiries", count: 11, stuck: 5, href: "/workspace/crm/leads" },
      { id: "planning", count: 6, stuck: 1, href: "/workspace/pre-projects" },
      { id: "quotes", count: 3, stuck: 0, href: "/workspace/pre-projects?section=quotations" },
    ]);
  });

  it("links recent records to their pages", async () => {
    const client = clientFor([[/WITH touched AS/, [
      { kind: "project", id: "p-1", title: "Villa 12", context: "PRJ-1", at: new Date("2026-09-27T10:00:00Z"), mine: true },
      { kind: "enquiry", id: "l-1", title: "Amira", context: "Kitchen", at: new Date("2026-09-26T10:00:00Z"), mine: false },
    ]]]);
    const summary = await readHomeSummary(client as never, person, { ...none, projects: true, leads: true }, now);
    expect(summary.recent.map((record) => record.href)).toEqual(["/workspace/projects/p-1", "/workspace/crm/leads?lead=l-1"]);
  });
});

describe("Waiting approvals seam", () => {
  it("reads only the sources the person may decide and sorts them oldest first", async () => {
    const read = vi.fn(async () => [
      { id: "x:2", source: "leave" as const, urgency: "waiting" as const, recordId: "2", title: "Rami", context: "Annual", due: "2026-09-20T00:00:00.000Z", href: "/workspace/hrms/team" },
      { id: "x:1", source: "leave" as const, urgency: "waiting" as const, recordId: "1", title: "Sam", context: "Annual", due: "2026-09-10T00:00:00.000Z", href: "/workspace/hrms/team" },
    ]);
    const blocked = vi.fn(async () => []);
    const sources: HomeApprovalSource[] = [
      { key: "allowed", allowed: (access) => access.manageLeave, read },
      { key: "blocked", allowed: (access) => access.approveOrders, read: blocked },
    ];
    const items = await readWaitingApprovals({ query: vi.fn() } as never, person, { ...noApprovals, manageLeave: true }, sources);
    expect(items.map((item) => item.id)).toEqual(["x:1", "x:2"]);
    expect(blocked).not.toHaveBeenCalled();
  });

  it("never offers a petty cash claim to the person who made it", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await readWaitingApprovals({ query } as never, person, { ...noApprovals, projects: true });
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("claim.claimed_by <> $2");
    expect(sql).toContain("seat.is_manager");
    expect(params).toEqual([workspaceId, person.userId, person.membershipId, false]);
  });
});
