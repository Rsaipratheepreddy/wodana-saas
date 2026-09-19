import { describe, expect, it, vi } from "vitest";
import { CrmLeadsService } from "./crm-leads.service";

function setup(ownerMembershipId: string | null, queueId: string | null, optedOut = false) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('SELECT DISTINCT membership.user_id AS "userId"')) {
      const rows = ownerMembershipId ? [{ userId: "user-one" }] : [{ userId: "user-one" }, { userId: "user-two" }];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("FROM notification_preferences")) {
      return { rows: optedOut ? [{ enabled: false }] : [], rowCount: optedOut ? 1 : 0 };
    }
    return { rows: [], rowCount: 1 };
  });
  const service = new CrmLeadsService({} as never, {} as never, {} as never);
  const notify = () => service["notifyLeadAssignment"]({ query } as never, "workspace", "lead", 4, {
    ownerMembershipId, queueId,
  });
  return { query, notify };
}

describe("lead assignment in-app alerts", () => {
  it("alerts only the selected owner with a direct enquiry link and retry-safe key", async () => {
    const { query, notify } = setup("owner", "sales-queue");
    await notify();
    const recipients = query.mock.calls.find(([sql]) => sql.includes('SELECT DISTINCT membership.user_id AS "userId"'));
    expect(recipients?.[1]).toEqual(["workspace", "owner", "sales-queue"]);
    expect(recipients?.[0]).toContain("membership.id=$2::uuid OR ($2::uuid IS NULL");
    const inserts = query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO notifications"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]).toEqual(expect.arrayContaining([
      "crm.lead.assigned", "New enquiry assigned", "/workspace/crm/leads?lead=lead",
      "crm:assignment:lead:4:user-one",
    ]));
    expect(inserts[0][0]).toContain("ON CONFLICT (workspace_id,idempotency_key) DO NOTHING");
  });

  it("alerts available queue members if no owner can be selected", async () => {
    const { query, notify } = setup(null, "sales-queue");
    await notify();
    expect(query.mock.calls.find(([sql]) => sql.includes('SELECT DISTINCT membership.user_id AS "userId"'))?.[0])
      .toContain("member.is_available");
    expect(query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO notifications"))[0][1])
      .toContain("crm.lead.queue_waiting");
  });

  it("respects a member's in-app opt-out", async () => {
    const { query, notify } = setup("owner", "sales-queue", true);
    await notify();
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO notifications"))).toBe(false);
  });

  it("delivers the in-app assignment immediately on weekends", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T08:00:00.000Z"));
    try {
      const { query, notify } = setup("owner", "sales-queue");
      await notify();
      const insert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO notifications"));
      expect(insert).toBeDefined();
      expect(insert?.[0]).toContain("'delivered'");
      expect(insert?.[0]).not.toContain("quiet_hours");
      expect(insert?.[1]).toContain("crm.lead.assigned");
    } finally {
      vi.useRealTimers();
    }
  });
});
