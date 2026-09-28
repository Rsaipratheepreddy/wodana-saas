import { describe, expect, it, vi } from "vitest";
import { CrmNotificationsService } from "./crm-notifications.service";

const workspaceId = "6d0f2b67-6f6a-4a22-8cb0-3f2d5d77a33a";

function service(rows: Array<{ id: string; email: string | null }>, mailer?: { sendStaffNotice: ReturnType<typeof vi.fn> }) {
  const updates: unknown[][] = [];
  const attempts: unknown[][] = [];
  let first = true;
  const database = {
    tenantTransaction: vi.fn(async (_ws: string, _actor: string, work: (client: { query: typeof query }) => unknown) => work({ query })),
  };
  const query = vi.fn(async (sql: string, values: unknown[]) => {
    if (first && sql.includes("WITH due")) { first = false; return { rows: rows.map((row) => ({ ...row, subject: "New enquiry E-1: Maya", body: "Reference: E-1", deepLink: "/workspace/crm/leads?lead=1", eventType: "crm.lead.assigned" })) }; }
    (sql.includes("notification_delivery_attempts") ? attempts : updates).push(values); return { rows: [] };
  });
  const instance = new CrmNotificationsService(database as never, {} as never, {} as never, undefined, undefined, mailer as never);
  return { instance, updates, attempts };
}

describe("staff email dispatch (PLM-032)", () => {
  it("sends each claimed email in the tenant brand and records the outcome", async () => {
    const sendStaffNotice = vi.fn().mockResolvedValueOnce({ status: "sent", provider: "mailgun", messageId: "m1" }).mockResolvedValueOnce({ status: "failed", provider: "mailgun", messageId: null, errorCode: "MAILGUN_HTTP_401" });
    const { instance, updates, attempts } = service([{ id: "n1", email: "sara@example.com" }, { id: "n2", email: "omar@example.com" }], { sendStaffNotice });
    expect(await instance.dispatchStaffEmailsInternal({ workspaceId, limit: 10 })).toEqual({ claimed: 2, delivered: 1 });
    expect(sendStaffNotice).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, to: "sara@example.com", actionLabel: "Open enquiry", deepLink: "/workspace/crm/leads?lead=1" }));
    expect(updates.map((values) => values[0])).toEqual(["delivered", "failed"]);
    // Each real send is an attempt, so delivery health knows when email last worked and why it failed.
    expect(attempts.map((values) => values.slice(1))).toEqual([["n1", "mailgun", "delivered", "m1", null], ["n2", "mailgun", "permanent_failure", null, "MAILGUN_HTTP_401"]]);
  });

  it("suppresses instead of failing when email is not set up, and flags a missing address", async () => {
    const sendStaffNotice = vi.fn().mockResolvedValue({ status: "not_configured", provider: null, messageId: null });
    const { instance, updates, attempts } = service([{ id: "n1", email: "sara@example.com" }, { id: "n2", email: null }], { sendStaffNotice });
    await instance.dispatchStaffEmailsInternal({ workspaceId });
    expect(updates.map((values) => [values[0], values[1]])).toEqual([["suppressed", false], ["failed", true]]);
    expect(sendStaffNotice).toHaveBeenCalledTimes(1);
    expect(attempts).toEqual([]);
  });
});
