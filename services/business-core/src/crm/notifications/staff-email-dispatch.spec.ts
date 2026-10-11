import { describe, expect, it, vi } from "vitest";
import { CrmNotificationsService } from "./crm-notifications.service";

const workspaceId = "6d0f2b67-6f6a-4a22-8cb0-3f2d5d77a33a";

type Row = { id: string; email: string | null; attempt?: number; createdAt?: Date };

function service(rows: Row[], mailer?: { sendStaffNotice: ReturnType<typeof vi.fn>; provider?: () => string }) {
  const updates: unknown[][] = [];
  const attempts: unknown[][] = [];
  const released: unknown[][] = [];
  let first = true;
  const database = {
    tenantTransaction: vi.fn(async (_ws: string, _actor: string, work: (client: { query: typeof query }) => unknown) => work({ query })),
  };
  const query = vi.fn(async (sql: string, values: unknown[]) => {
    // The email-conversation replies' own claim (PLM-025): none due here.
    if (sql.includes("crm_inbound_email_addresses")) return { rows: [] };
    if (first && sql.includes("WITH due")) {
      first = false;
      return { rows: rows.map((row) => ({ attempt: 1, createdAt: new Date(), ...row, subject: "New enquiry E-1: Maya", body: "Reference: E-1", deepLink: "/workspace/crm/leads?lead=1", eventType: "crm.lead.assigned" })) };
    }
    if (sql.includes("GREATEST(scheduled_for")) released.push(values);
    else (sql.includes("notification_delivery_attempts") ? attempts : updates).push(values);
    return { rows: [] };
  });
  const instance = new CrmNotificationsService(database as never, {} as never, {} as never, undefined, undefined, mailer as never);
  return { instance, updates, attempts, released };
}

describe("staff email dispatch (PLM-032)", () => {
  it("sends each claimed email in the tenant brand and records the outcome", async () => {
    const sendStaffNotice = vi.fn().mockResolvedValueOnce({ status: "sent", provider: "mailgun", messageId: "m1" }).mockResolvedValueOnce({ status: "failed", provider: "mailgun", messageId: null, errorCode: "MAILGUN_HTTP_401" });
    const { instance, updates, attempts } = service([{ id: "n1", email: "sara@example.com" }, { id: "n2", email: "omar@example.com" }], { sendStaffNotice });
    expect(await instance.dispatchStaffEmailsInternal({ workspaceId, limit: 10 })).toEqual({ claimed: 2, delivered: 1 });
    expect(sendStaffNotice).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, to: "sara@example.com", actionLabel: "Open enquiry", deepLink: "/workspace/crm/leads?lead=1" }), { notAfter: expect.any(Number) });
    expect(updates.map((values) => values[0])).toEqual(["delivered", "failed"]);
    // Each real send is an attempt, so delivery health knows when email last worked and why it failed.
    expect(attempts.map((values) => values.slice(1, 6))).toEqual([["n1", "mailgun", "delivered", "m1", null], ["n2", "mailgun", "permanent_failure", null, "MAILGUN_HTTP_401"]]);
  });

  it("suppresses instead of failing when email is not set up, and flags a missing address", async () => {
    const sendStaffNotice = vi.fn().mockResolvedValue({ status: "not_configured", provider: null, messageId: null });
    const { instance, updates, attempts } = service([{ id: "n1", email: "sara@example.com" }, { id: "n2", email: null }], { sendStaffNotice });
    await instance.dispatchStaffEmailsInternal({ workspaceId });
    expect(updates.map((values) => [values[0], values[1]])).toEqual([["suppressed", false], ["failed", true]]);
    expect(sendStaffNotice).toHaveBeenCalledTimes(1);
    expect(attempts).toEqual([]);
  });

  it("keeps a throttled email scheduled for its retry (attempt 'retry', never 'failed'), after the provider's Retry-After", async () => {
    const sendStaffNotice = vi.fn().mockResolvedValue({ status: "failed", provider: "mailgun", messageId: null, errorCode: "MAILGUN_HTTP_429", retryable: true, retryAfterMs: 120_000 });
    const { instance, updates, attempts } = service([{ id: "n1", email: "sara@example.com" }], { sendStaffNotice });
    const before = Date.now();
    expect(await instance.dispatchStaffEmailsInternal({ workspaceId })).toEqual({ claimed: 1, delivered: 0 });
    expect(updates[0][0]).toBe("scheduled");
    const retryAt = updates[0][5] as Date;
    expect(retryAt.getTime()).toBeGreaterThanOrEqual(before + 120_000);
    expect(attempts[0].slice(1, 6)).toEqual(["n1", "mailgun", "retry", null, "MAILGUN_HTTP_429"]);
    expect(attempts[0][7]).toEqual(retryAt);
  });

  it("fails a retryable email for good on its last attempt, and a retry found more than a day late without sending it", async () => {
    const sendStaffNotice = vi.fn().mockResolvedValue({ status: "failed", provider: "mailgun", messageId: null, errorCode: "MAILGUN_HTTP_503", retryable: true });
    const { instance, updates, attempts } = service([
      { id: "n1", email: "sara@example.com", attempt: 5 },
      { id: "n2", email: "omar@example.com", attempt: 2, createdAt: new Date(Date.now() - 25 * 3_600_000) },
    ], { sendStaffNotice, provider: () => "mailgun" });
    await instance.dispatchStaffEmailsInternal({ workspaceId });
    expect(sendStaffNotice).toHaveBeenCalledTimes(1);
    expect(updates.map((values) => values[0])).toEqual(["failed", "failed"]);
    expect(attempts.map((values) => values.slice(1, 6))).toEqual([["n1", "mailgun", "permanent_failure", null, "MAILGUN_HTTP_503"], ["n2", "mailgun", "permanent_failure", null, "EMAIL_RETRY_EXPIRED"]]);
  });

  it("puts the rest of the batch back, untried and without an attempt, once the send limit has no slot in time", async () => {
    const sendStaffNotice = vi.fn()
      .mockResolvedValueOnce({ status: "sent", provider: "mailgun", messageId: "m1" })
      .mockResolvedValueOnce({ status: "failed", provider: "mailgun", messageId: null, errorCode: "EMAIL_RATE_LIMITED", retryable: true, retryAfterMs: 4_000, deferred: true });
    const { instance, updates, attempts, released } = service([{ id: "n1", email: "a@example.com" }, { id: "n2", email: "b@example.com" }, { id: "n3", email: "c@example.com" }], { sendStaffNotice });
    expect(await instance.dispatchStaffEmailsInternal({ workspaceId })).toEqual({ claimed: 3, delivered: 1 });
    expect(sendStaffNotice).toHaveBeenCalledTimes(2);
    expect(updates.map((values) => values[0])).toEqual(["delivered"]);
    expect(attempts).toHaveLength(1);
    expect(released).toHaveLength(1);
    expect(released[0][1]).toEqual(["n2", "n3"]);
  });
});
