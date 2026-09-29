import { describe, expect, it, vi } from "vitest";
import { CrmSalesAttentionService } from "./crm-sales-attention.service";
import { formatDeadline, isWorkingDay, localDay, refreshUnownedEscalation, tell } from "./sales-attention";

const dubai = { timeZone: "Asia/Dubai", locale: "en" };
const business = {
  version: 1 as const, mode: "business" as const, timezone: "Asia/Dubai",
  weeklyHours: { monday: [{ start: "09:00", end: "18:00" }], saturday: [{ start: "09:00", end: "18:00" }] },
  holidays: ["2026-10-05"], dateOverrides: {},
};

describe("sales attention helpers", () => {
  it("says the deadline in the workspace's own time: the time today, the weekday otherwise (S-26)", () => {
    const friday = new Date("2026-10-02T15:00:00.000Z"); // Fri 19:00 in Dubai
    expect(formatDeadline(new Date("2026-10-03T06:00:00.000Z"), dubai, friday)).toBe("Sat 10:00");
    expect(formatDeadline(new Date("2026-10-02T16:30:00.000Z"), dubai, friday)).toBe("20:30");
  });

  it("knows the local day, time and weekday, and whether Sales works that day", () => {
    expect(localDay(new Date("2026-10-02T20:30:00.000Z"), "Asia/Dubai")).toEqual({ date: "2026-10-03", minutes: 30, weekday: "sat" });
    expect(isWorkingDay(business, "sat", "2026-10-03")).toBe(true);
    expect(isWorkingDay(business, "sun", "2026-10-04")).toBe(false);
    expect(isWorkingDay(business, "mon", "2026-10-05")).toBe(false);
    expect(isWorkingDay({ version: 1, mode: "elapsed" }, "sun", "2026-10-04")).toBe(true);
  });

  it("tells each person once per event on each channel it uses", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM notification_templates")) return { rows: [{ id: "template", subject: "{{reference}}", body: "Hi" }], rowCount: 1 };
      if (sql.includes("FROM notification_preferences")) return { rows: [{ enabled: true }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await tell({ query } as never, "workspace", [{ userId: "a" }, { userId: "a" }, { userId: "b" }], {
      code: "crm.lead_unowned", channels: ["in_app", "push"], deepLink: "/x", key: "k", variables: { reference: "E-1" },
    });
    const keys = query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO notifications")).map(([, params]) => (params as unknown[]).find((value) => String(value).startsWith("k:")));
    expect(keys.sort()).toEqual(["k:a", "k:a:push", "k:b", "k:b:push"]);
  });

  it("starts the unowned countdown only for a working enquiry without an owner, and stops it once owned (S-2)", async () => {
    const lead = { owner: null as string | null, status: "new", due: null as Date | null };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("AS due FROM crm_leads")) return { rows: [lead], rowCount: 1 };
      if (sql.includes("FROM workspace_sales_settings")) return { rows: [], rowCount: 0 };
      if (sql.includes("FROM crm_sla_policies")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    });
    const now = new Date("2026-10-03T06:00:00.000Z");
    expect(await refreshUnownedEscalation({ query } as never, "workspace", "lead", now)).toEqual(new Date("2026-10-03T06:15:00.000Z"));
    lead.owner = "owner"; lead.due = new Date("2026-10-03T06:15:00.000Z");
    expect(await refreshUnownedEscalation({ query } as never, "workspace", "lead", now)).toBeNull();
    expect(query.mock.calls.at(-1)?.[0]).toContain("SET escalation_due_at = NULL");
  });
});

function attention(rows: Record<string, unknown[]>) {
  const query = vi.fn(async (sql: string) => {
    for (const [needle, result] of Object.entries(rows)) if (sql.includes(needle)) return { rows: result, rowCount: result.length };
    if (sql.includes("FROM notification_templates")) return { rows: [{ id: "template", subject: "s", body: "b" }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const events = { record: vi.fn().mockResolvedValue("event") };
  const slas = { resumeFirstResponse: vi.fn().mockResolvedValue({ id: "sla", warning_at: new Date("2026-10-03T06:30:00.000Z") }) };
  const service = new CrmSalesAttentionService({} as never, events as never, slas as never);
  return { service, query, events, slas };
}

const admin = { userId: "admin-user", membershipId: "admin", name: "Olivia" };

describe("sales attention timers", () => {
  it("escalates an enquiry still without an owner to the Sales admin, urgently (S-2)", async () => {
    const { service, query, events } = attention({
      "escalation_due_at AS \"dueAt\"": [{ id: "lead", ownerMembershipId: null, status: "new", dueAt: new Date("2026-10-03T06:15:00.000Z") }],
      "DISTINCT ON (membership.id)": [admin],
      "enquiry.reference, party.display_name": [{ reference: "E-7", clientName: "Asha" }],
    });
    expect(await service.escalateUnowned({ query } as never, "workspace", 10)).toEqual(["lead"]);
    expect(query.mock.calls.some(([sql]) => sql.includes("escalated_at = now(), priority = 'urgent'"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE crm_activities SET priority = 'urgent'"))).toBe(true);
    const notice = query.mock.calls.find(([sql, params]) => sql.includes("INSERT INTO notifications") && (params as unknown[]).includes("admin-user"));
    expect(notice).toBeTruthy();
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "crm.lead.unowned_escalated.v1" }));
  });

  it("stops the countdown instead of escalating when the enquiry was picked up meanwhile", async () => {
    const { service, query, events } = attention({
      "escalation_due_at AS \"dueAt\"": [{ id: "lead", ownerMembershipId: "owner", status: "new", dueAt: new Date() }],
      "AS due FROM crm_leads": [{ owner: "owner", status: "new", due: new Date() }],
      "DISTINCT ON (membership.id)": [admin],
    });
    expect(await service.escalateUnowned({ query } as never, "workspace", 10)).toEqual([]);
    expect(events.record).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.includes("SET escalation_due_at = NULL"))).toBe(true);
  });

  it("wakes a 'come back later' enquiry on its date, resumes its timer and tells the owner (S-27)", async () => {
    const { service, query, events, slas } = attention({
      "status = 'paused' AND next_action_at <= now()": [{ id: "lead", ownerMembershipId: "owner", nextActionAt: new Date("2026-10-03T05:00:00.000Z"), version: 4 }],
      "SELECT default_timezone": [{ timeZone: "Asia/Dubai", locale: "en" }],
      "membership.user_id AS \"userId\", membership.id AS \"membershipId\"": [{ userId: "owner-user", membershipId: "owner", name: "Sara" }],
      "enquiry.reference, party.display_name": [{ reference: "E-7", clientName: "Asha" }],
      "AS due FROM crm_leads": [{ owner: "owner", status: "attempting_contact", due: null }],
    });
    const now = new Date("2026-10-03T06:00:00.000Z");
    expect(await service.wakePaused({ query } as never, "workspace", 10, now)).toEqual(["lead"]);
    const woke = query.mock.calls.find(([sql]) => sql.includes("SET status = 'attempting_contact'"));
    expect(woke?.[1]).toEqual(["workspace", "lead", 4]);
    expect(slas.resumeFirstResponse).toHaveBeenCalledWith(expect.anything(), "workspace", "lead", null, expect.any(String), now);
    expect(query.mock.calls.some(([sql, params]) => sql.includes("INSERT INTO notifications") && (params as unknown[]).includes("owner-user"))).toBe(true);
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "crm.lead.woken.v1" }));
  });

  it("sends the morning digest once per working day, after 09:00 local time (S-7, S-26)", async () => {
    const setup = {
      "SELECT default_timezone": [{ timeZone: "Asia/Dubai", locale: "en" }],
      "FROM crm_sales_digests WHERE": [],
      "FROM crm_sla_policies": [],
      "AS breached": [{ breached: 1, unowned: 2, waiting: 3 }],
      "DISTINCT ON (membership.id)": [admin],
      "GROUP BY lead.owner_membership_id": [{ membershipId: "owner", count: 2, firstDue: new Date("2026-10-03T06:00:00.000Z") }],
      "membership.user_id AS \"userId\", membership.id AS \"membershipId\"": [{ userId: "owner-user", membershipId: "owner", name: "Sara" }],
    };
    const early = attention(setup);
    expect(await early.service.sendDigest({ query: early.query } as never, "workspace", new Date("2026-10-03T04:30:00.000Z"))).toBeNull();
    const { service, query, events } = attention(setup);
    expect(await service.sendDigest({ query } as never, "workspace", new Date("2026-10-03T05:30:00.000Z"))).toMatchObject({ date: "2026-10-03", outcome: "sent", breached: 1, unowned: 2 });
    expect(query.mock.calls.find(([sql]) => sql.includes("INSERT INTO crm_sales_digests"))?.[1]?.slice(0, 3)).toEqual(["workspace", "2026-10-03", "sent"]);
    expect(query.mock.calls.some(([sql, params]) => sql.includes("INSERT INTO notifications") && (params as unknown[]).includes("admin-user"))).toBe(true);
    expect(query.mock.calls.some(([sql, params]) => sql.includes("INSERT INTO notifications") && (params as unknown[]).includes("owner-user"))).toBe(true);
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "crm.sales.digest_sent.v1" }));
    const done = attention({ ...setup, "FROM crm_sales_digests WHERE": [{ present: 1 }] });
    expect(await done.service.sendDigest({ query: done.query } as never, "workspace", new Date("2026-10-03T07:00:00.000Z"))).toBeNull();
  });
});
