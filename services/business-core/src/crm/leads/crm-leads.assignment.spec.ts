import { describe, expect, it, vi } from "vitest";
import { CrmLeadsService } from "./crm-leads.service";

function setup(candidates: Record<string, unknown>[], configured = true, queue: Record<string, unknown> = { round_robin_cursor: 1 }) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM crm_assignment_policies")) return { rows: [], rowCount: 0 };
    if (sql.includes("is_fallback")) return { rows: configured ? [{ id: "queue" }] : [], rowCount: configured ? 1 : 0 };
    if (sql.includes("FROM crm_effective_queue_members")) return { rows: candidates, rowCount: candidates.length };
    if (sql.includes("SELECT round_robin_cursor")) return { rows: [queue], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const service = new CrmLeadsService({} as never, {} as never, {} as never);
  return { query, select: (takeover?: { queueId: string; excludedOwnerId: string }) => service["selectAssignment"]({ query } as never, "workspace", { source: "website", service_type: "architecture" } as never, true, takeover) };
}
const candidate = (membershipId: string, extra = {}) => ({ membershipId, name: membershipId, capacity: 3, weight: 1, skills: [], languages: [], activeLoad: 0, loadRatio: 0, isAvailable: true, ...extra });
describe("Default queue auto-assignment without custom policies", () => {
  it("routes to a default-queue manager and advances the round-robin cursor", async () => {
    const { select, query } = setup([candidate("one"), candidate("two")]);
    expect(await select()).toMatchObject({ ownerMembershipId: "two", queueId: "queue", explanation: { reason: "workspace_fallback", policyId: null } });
    expect(query.mock.calls.some(([sql]) => sql.includes("SET round_robin_cursor = round_robin_cursor + 1"))).toBe(true);
  });
  it("honors capacity, availability, absence and skills in the default queue", async () => {
    const { select, query } = setup([candidate("full", { activeLoad: 3 }), candidate("away", { isAvailable: false }), candidate("absent", { unavailableUntil: "2099-01-01" }), candidate("wrong-skill", { skills: ["plumbing"] })]);
    expect(await select()).toMatchObject({ ownerMembershipId: null, queueId: "queue", explanation: { reason: "no_eligible_member" } });
    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE crm_queues"))).toBe(false);
  });
  it("reports missing setup instead of assigning outside a queue", async () => {
    await expect(setup([], false).select()).rejects.toThrow("No active assignment policy or fallback queue");
  });
});

describe("round-robin queues", () => {
  // Rows come back lightest load first, as the SQL orders them; round-robin ignores that order.
  const rows = () => [candidate("carol", { activeLoad: 0, loadRatio: 0 }), candidate("bilal", { activeLoad: 1, loadRatio: 0.33 }), candidate("asha", { activeLoad: 2, loadRatio: 0.66 })];

  it("takes the person whose turn it is, not the lightest load, and moves the cursor past them", async () => {
    const { select, query } = setup(rows(), true, { round_robin_cursor: 0, assignment_mode: "round_robin" });
    expect(await select()).toMatchObject({ ownerMembershipId: "asha", explanation: { mode: "round_robin", reason: "workspace_fallback" } });
    const advance = query.mock.calls.find(([sql]) => sql.includes("SET round_robin_cursor = $3"));
    expect(advance?.[1]).toEqual(["queue", "workspace", 1]);
  });

  it("passes over someone full or away and keeps strict turns after the one who took it", async () => {
    const { select, query } = setup([candidate("carol"), candidate("bilal", { activeLoad: 3 }), candidate("asha", { isAvailable: false })], true,
      { round_robin_cursor: 0, assignment_mode: "round_robin" });
    expect(await select()).toMatchObject({ ownerMembershipId: "carol" });
    expect(query.mock.calls.find(([sql]) => sql.includes("SET round_robin_cursor = $3"))?.[1]).toEqual(["queue", "workspace", 0]);
  });

  it("never hands a takeover back to the owner it is taken from", async () => {
    const { select } = setup(rows(), true, { round_robin_cursor: 1, assignment_mode: "round_robin" });
    expect(await select({ queueId: "queue", excludedOwnerId: "bilal" })).toMatchObject({ ownerMembershipId: "carol", explanation: { reason: "unanswered_takeover" } });
  });

  it("leaves the cursor alone when nobody can take it", async () => {
    const { select, query } = setup([candidate("carol", { activeLoad: 3 })], true, { round_robin_cursor: 0, assignment_mode: "round_robin" });
    expect(await select()).toMatchObject({ ownerMembershipId: null, explanation: { reason: "no_eligible_member" } });
    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE crm_queues"))).toBe(false);
  });
});

describe("named sales-owner eligibility", () => {
  it("requires effective CRM permissions and selected-queue membership", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ present: 1 }], rowCount: 1 });
    const service = new CrmLeadsService({} as never, {} as never, {} as never);
    await expect(service["requireEligibleOwner"](
      { query } as never, "workspace", "membership", "sales-queue",
    )).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("crm_effective_queue_members"), [
      "workspace", "membership", ["crm.leads.view", "crm.leads.manage", "crm.activities.manage"], 3, "sales-queue",
    ]);
    expect(query.mock.calls[0][0]).toContain("effective_member_roles");
    expect(query.mock.calls[0][0]).toContain("queue_member.is_available");
  });

  it("rejects an active member who cannot own and follow up the selected queue", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const service = new CrmLeadsService({} as never, {} as never, {} as never);
    await expect(service["requireEligibleOwner"](
      { query } as never, "workspace", "membership", "sales-queue",
    )).rejects.toThrow("active sales owner with enquiry and follow-up access");
  });
});

describe("assignable sales owners", () => {
  function owners(rows: Record<string, unknown>[], self: string | null = "sara") {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM crm_queues")) return { rows: [{}], rowCount: 1 };
      if (sql.includes("user_id=$2 AND status='active'")) return { rows: self ? [{ id: self }] : [], rowCount: self ? 1 : 0 };
      return { rows, rowCount: rows.length };
    });
    const access = { withAnyPermission: vi.fn(async (_actor: unknown, _workspace: string, _permissions: string[], work: (client: unknown, user: { userId: string }) => unknown) => work({ query }, { userId: "user-sara" })) };
    return { query, access, service: new CrmLeadsService({} as never, access as never, {} as never) };
  }

  it("lists the members the save rule accepts, to anyone who may create or assign enquiries, with the caller's own membership", async () => {
    const { service, access, query } = owners([{ id: "sara", displayName: "Sara", email: "sara@example.com" }, { id: "zaid", displayName: "Zaid", email: "zaid@example.com" }]);
    await expect(service.salesOwners({} as never, "workspace")).resolves.toEqual({
      items: [{ id: "sara", displayName: "Sara", email: "sara@example.com", status: "active" }, { id: "zaid", displayName: "Zaid", email: "zaid@example.com", status: "active" }],
      currentMembershipId: "sara",
    });
    expect(access.withAnyPermission).toHaveBeenCalledWith({}, "workspace", ["crm.leads.manage", "crm.leads.assign"], expect.any(Function));
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("effective_member_roles");
    expect(values).toEqual(["workspace", null, ["crm.leads.view", "crm.leads.manage", "crm.activities.manage"], 3, null]);
  });

  it("narrows to the members available in a chosen queue", async () => {
    const { service, query } = owners([], null);
    const queue = "61000000-0000-4000-8000-000000000001";
    await expect(service.salesOwners({} as never, "workspace", queue)).resolves.toEqual({ items: [], currentMembershipId: null });
    const listed = query.mock.calls.find(([sql]) => sql.includes("crm_effective_queue_members")) as unknown as [string, unknown[]];
    expect(listed[1]).toEqual(["workspace", null, ["crm.leads.view", "crm.leads.manage", "crm.activities.manage"], 3, queue]);
  });

  it("refuses a malformed queue before reading anything", async () => {
    const { service, access } = owners([]);
    expect(() => service.salesOwners({} as never, "workspace", "not-a-queue")).toThrow("Queue is not valid");
    expect(access.withAnyPermission).not.toHaveBeenCalled();
  });
});
