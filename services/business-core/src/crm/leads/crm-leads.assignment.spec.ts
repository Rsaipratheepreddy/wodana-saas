import { describe, expect, it, vi } from "vitest";
import { CrmLeadsService } from "./crm-leads.service";

function setup(candidates: Record<string, unknown>[], configured = true) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("FROM crm_assignment_policies")) return { rows: [], rowCount: 0 };
    if (sql.includes("is_fallback")) return { rows: configured ? [{ id: "queue" }] : [], rowCount: configured ? 1 : 0 };
    if (sql.includes("FROM crm_queue_members")) return { rows: candidates, rowCount: candidates.length };
    if (sql.includes("SELECT round_robin_cursor")) return { rows: [{ round_robin_cursor: 1 }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const service = new CrmLeadsService({} as never, {} as never, {} as never);
  return { query, select: () => service["selectAssignment"]({ query } as never, "workspace", { source: "website", service_type: "architecture" } as never, true) };
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
