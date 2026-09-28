import { describe, expect, it, vi } from "vitest";
import { notifyUserInApp, PUSH_NOTICES, quietUntil } from "./default-templates";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

function db(options: { pushPreference?: boolean | null; device?: boolean; moduleOff?: boolean }) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.includes("FROM notification_preferences") && sql.includes("channel='push'")) return { rows: [...(options.pushPreference == null ? [] : [{ eventType: "*", enabled: options.pushPreference, quietHours: {} }]), ...(options.moduleOff ? [{ eventType: "site.*", enabled: false, quietHours: {} }] : [])], rowCount: 1 };
    if (sql.includes("FROM notification_preferences")) return { rows: [], rowCount: 0 };
    if (sql.includes("FROM notification_templates")) return { rows: [{ id: "template", subject: "Report missing for {{project}}", body: "Add today's report." }], rowCount: 1 };
    if (sql.includes("FROM device_endpoints")) return { rows: [], rowCount: options.device ? 1 : 0 };
    if (sql.includes("INSERT INTO notifications") && sql.includes("'push'")) return { rows: [{ id: "push-1", correlationId: "c" }], rowCount: 1 };
    if (sql.includes("INSERT INTO notifications")) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return { db: { query }, calls };
}

const notice = (code: string) => ({ workspaceId, recipientUserId: userId, code, eventType: code, variables: { project: "Villa 4" }, deepLink: "/workspace/projects/p/site", idempotencyKey: `${code}:1` });

describe("pushes for work people act on away from a desk (FD-3)", () => {
  it("queue a push beside the in-app notice when the person turned push on and has a phone", async () => {
    const { db: client, calls } = db({ pushPreference: true, device: true });
    await notifyUserInApp(client, notice("site.report_missing"));
    const push = calls.find((call) => call.sql.includes("INSERT INTO notifications") && call.sql.includes("'push'"));
    expect(push?.values).toEqual([workspaceId, "template", userId, "site.report_missing", "Report missing for Villa 4", "Add today's report.", "/workspace/projects/p/site", "site.report_missing:1:push", expect.any(Date)]);
    expect(calls.some((call) => call.sql.includes("notification.delivery_requested.v1"))).toBe(true);
  });

  it("stay in the inbox when push is off, there's no phone, or the notice isn't one of them", async () => {
    for (const [options, code] of [[{ pushPreference: null, device: true }, "site.report_missing"], [{ pushPreference: true, device: false }, "site.report_missing"], [{ pushPreference: true, device: true }, "project.started"], [{ pushPreference: true, device: true, moduleOff: true }, "site.report_missing"]] as const) {
      const { db: client, calls } = db(options);
      await notifyUserInApp(client, notice(code));
      expect(calls.some((call) => call.sql.includes("'push'") && call.sql.includes("INSERT INTO notifications"))).toBe(false);
    }
  });

  it("wait out the person's quiet hours (FD-7)", () => {
    const at = (iso: string) => new Date(iso);
    const night = { start: "22:00", end: "07:00", timezone: "Asia/Kolkata" };
    // 23:30 in Kolkata (18:00 UTC): held until 07:00 there (01:30 UTC next day).
    expect(quietUntil(night, at("2026-09-28T18:00:00Z"))?.toISOString()).toBe("2026-09-29T01:30:00.000Z");
    // 12:00 in Kolkata: not quiet.
    expect(quietUntil(night, at("2026-09-28T06:30:00Z"))).toBeNull();
    expect(quietUntil({ start: "13:00", end: "14:00" }, at("2026-09-28T13:15:00Z"))?.toISOString()).toBe("2026-09-28T14:00:00.000Z");
    expect(quietUntil({}, at("2026-09-28T13:15:00Z"))).toBeNull();
    expect(quietUntil({ start: "22:00", end: "07:00", timezone: "Not/AZone" }, at("2026-09-28T23:00:00Z"))).toBeNull();
  });

  it("cover the site, work, factory, purchasing, stock, approvals and assignment notices", () => {
    for (const code of ["site.report_missing", "work.assigned", "work.overdue", "factory.released", "purchasing.late", "stock.transfer_sent", "purchasing.approval_needed", "crm.conversation_assigned"]) {
      expect(PUSH_NOTICES.has(code)).toBe(true);
    }
  });
});
