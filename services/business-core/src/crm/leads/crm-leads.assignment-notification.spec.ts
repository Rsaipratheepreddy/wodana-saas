import { describe, expect, it, vi } from "vitest";
import { CrmLeadsService } from "./crm-leads.service";

function setup(ownerMembershipId: string | null, queueId: string | null, optedOut = false) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes('SELECT DISTINCT membership.user_id AS "userId"')) {
      const rows = ownerMembershipId ? [{ userId: "user-one" }] : [{ userId: "user-one" }, { userId: "user-two" }];
      return { rows, rowCount: rows.length };
    }
    // The member switched sales notices off in the app and by email.
    if (sql.includes("FROM notification_channel_choices")) return { rows: optedOut ? [{ userId: "user-one", groupSwitches: { in_app: false, email: false } }] : [], rowCount: optedOut ? 1 : 0 };
    if (sql.includes("FROM notification_preferences")) {
      return { rows: optedOut ? [{ enabled: false }] : [], rowCount: optedOut ? 1 : 0 };
    }
    if (sql.includes("FROM crm_leads lead JOIN crm_enquiries")) return { rows: [{ reference: "E-0042", clientName: "Dr Maya Nair", source: "referral", sourceLabel: "Referral" }], rowCount: 1 };
    if (sql.includes("FROM notification_templates")) {
      return sql.includes("channel='email'")
        ? { rows: [{ id: "tpl-email", subject: "New enquiry {{reference}}: {{clientName}}", body: "Source: {{source}}" }], rowCount: 1 }
        : { rows: [{ id: "tpl-app", subject: "{{reference}} · {{clientName}} is yours", body: "New enquiry from {{source}}." }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO notifications") && sql.includes("RETURNING")) return { rows: [{ id: "n-email", correlationId: "c1" }], rowCount: 1 };
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
    // PLM-032: an in-app notice and an email, each with the reference, client and source.
    expect(inserts).toHaveLength(2);
    expect(inserts[0][1]).toEqual(expect.arrayContaining([
      "crm.lead.assigned", "E-0042 · Dr Maya Nair is yours", "New enquiry from Referral.", "/workspace/crm/leads?lead=lead",
      "crm:assignment:lead:4:user-one",
    ]));
    expect(inserts[1][0]).toContain("'email'");
    expect(inserts[1][1]).toEqual(expect.arrayContaining(["New enquiry E-0042: Dr Maya Nair", "crm:assignment:lead:4:user-one:email"]));
    expect(inserts[0][0]).toContain("ON CONFLICT (workspace_id, idempotency_key) DO NOTHING");
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO outbox_events"))).toBe(true);
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
