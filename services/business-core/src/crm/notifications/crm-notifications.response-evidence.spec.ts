import { describe, expect, it, vi } from "vitest";
import { CrmNotificationsService } from "./crm-notifications.service";

const messageId = "11111111-1111-4111-8111-111111111111";

const setup = (priorAttempt = false) => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT * FROM notifications")) {
      return { rows: [{ id: "notification", status: "processing", idempotency_key: `message:${messageId}` }], rowCount: 1 };
    }
    if (sql.includes("SELECT status FROM notification_delivery_attempts")) {
      return { rows: priorAttempt ? [{ status: "delivered" }] : [], rowCount: priorAttempt ? 1 : 0 };
    }
    if (sql.includes("UPDATE notifications SET status")) {
      return { rows: [{ id: "notification", status: "delivered", version: 2 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const client = { query };
  const database = { tenantTransaction: vi.fn(async (_workspace, _actor, work) => work(client)) };
  const events = { record: vi.fn().mockResolvedValue(undefined) };
  const receipts = { record: vi.fn().mockResolvedValue({ status: "sent" }) };
  const service = new CrmNotificationsService(database as never, {} as never, events as never, receipts as never);
  return { service, client, query, receipts };
};

describe("notification delivery to CRM response evidence", () => {
  it("routes provider acceptance through the centralized message receipt contract", async () => {
    const { service, client, receipts } = setup();
    await service.resultInternal("notification", {
      workspaceId: "workspace",
      attempt: 1,
      provider: "mailgun",
      result: "delivered",
      providerMessageId: "provider-message",
    });
    expect(receipts.record).toHaveBeenCalledWith(client, messageId, {
      workspaceId: "workspace",
      status: "sent",
      providerMessageId: "provider-message",
      failureCode: undefined,
    }, { ignoreMissing: true, ignoreNonOutbound: true });
  });

  it("routes terminal delivery failure without creating successful evidence", async () => {
    const { service, receipts } = setup();
    await service.resultInternal("notification", {
      workspaceId: "workspace",
      attempt: 8,
      provider: "mailgun",
      result: "permanent_failure",
      errorCode: "rejected",
    });
    expect(receipts.record).toHaveBeenCalledWith(expect.anything(), messageId, expect.objectContaining({
      status: "failed",
      failureCode: "rejected",
    }), expect.anything());
  });

  it("does not touch the message while a notification retry is pending", async () => {
    const { service, receipts } = setup();
    await service.resultInternal("notification", {
      workspaceId: "workspace",
      attempt: 1,
      provider: "mailgun",
      result: "retry",
      errorCode: "temporary",
    });
    expect(receipts.record).not.toHaveBeenCalled();
  });

  it("keeps repeated notification callbacks idempotent", async () => {
    const { service, receipts } = setup(true);
    expect(await service.resultInternal("notification", {
      workspaceId: "workspace", attempt: 1, provider: "mailgun", result: "delivered",
    })).toMatchObject({ idempotentReplay: true });
    expect(receipts.record).not.toHaveBeenCalled();
  });
});
