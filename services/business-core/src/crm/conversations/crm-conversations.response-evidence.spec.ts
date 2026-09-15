import { describe, expect, it, vi } from "vitest";
import { CrmConversationsService } from "./crm-conversations.service";
import { CrmMessageReceiptService } from "./crm-message-receipt.service";

type MessageOverrides = Record<string, unknown>;

const setup = (overrides: MessageOverrides = {}) => {
  const message = {
    id: "message",
    direction: "outbound",
    status: "queued",
    authorship: "human",
    sender_id: "user",
    leadId: "lead",
    channel: "email",
    provider_message_id: null,
    sent_at: null,
    ...overrides,
  };
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM crm_messages message")) return { rows: [message], rowCount: 1 };
    if (sql.includes("UPDATE crm_messages SET status")) {
      const receiptAt = params[5] as Date;
      const status = String(params[0]);
      return {
        rows: [{
          id: "message",
          status,
          providerMessageId: params[1] ?? message.provider_message_id,
          sentAt: message.sent_at ?? (["sent", "delivered", "read"].includes(status) ? receiptAt : null),
          deliveredAt: ["delivered", "read"].includes(status) ? receiptAt : null,
          readAt: status === "read" ? receiptAt : null,
          failureCode: status === "failed" ? params[2] : null,
          version: 2,
        }],
        rowCount: 1,
      };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  const database = { tenantTransaction: vi.fn(async (_workspace, _actor, work) => work({ query })) };
  const slas = { recordFirstResponse: vi.fn().mockResolvedValue(null) };
  const receipts = new CrmMessageReceiptService(slas as never);
  const service = new CrmConversationsService(
    database as never,
    {} as never,
    {} as never,
    {} as never,
    receipts,
  );
  return { service, query, slas };
};

describe("CRM message response evidence", () => {
  it("records a human outbound message only after the provider accepts it", async () => {
    const { service, slas } = setup();
    const result = await service.recordReceipt("message", {
      workspaceId: "workspace", status: "sent", providerMessageId: "provider-1",
    });
    expect(result).toMatchObject({ status: "sent", providerMessageId: "provider-1" });
    expect(slas.recordFirstResponse).toHaveBeenCalledWith(expect.anything(), "workspace", "lead", expect.objectContaining({
      sourceType: "message",
      sourceId: "message",
      actorUserId: "user",
      respondedAt: expect.any(Date),
      details: { channel: "email", providerMessageId: "provider-1", providerStatus: "sent" },
    }));
  });

  it("uses the original send timestamp when a later delivery receipt supplies the evidence", async () => {
    const sentAt = new Date("2026-09-15T07:30:00.000Z");
    const { service, slas } = setup({ status: "sent", sent_at: sentAt });
    await service.recordReceipt("message", { workspaceId: "workspace", status: "delivered" });
    expect(slas.recordFirstResponse).toHaveBeenCalledWith(expect.anything(), "workspace", "lead", expect.objectContaining({ respondedAt: sentAt }));
  });

  it.each([
    [{ status: "queued", authorship: "automation" }, "sent"],
    [{ status: "queued", authorship: "provider", sender_id: null }, "sent"],
    [{ status: "queued", leadId: null }, "sent"],
    [{ status: "queued" }, "failed"],
  ] as const)("does not create evidence for ineligible message state %#", async (overrides, status) => {
    const { service, slas } = setup(overrides);
    await service.recordReceipt("message", { workspaceId: "workspace", status, failureCode: status === "failed" ? "rejected" : undefined });
    expect(slas.recordFirstResponse).not.toHaveBeenCalled();
  });

  it.each([
    ["delivered", "delivered", "duplicate_receipt"],
    ["delivered", "sent", "stale_receipt"],
    ["read", "failed", "stale_failure"],
    ["failed", "delivered", "terminal_failure"],
  ])("ignores %s → %s receipt replay as %s", async (current, next, reason) => {
    const { service, query, slas } = setup({ status: current });
    expect(await service.recordReceipt("message", { workspaceId: "workspace", status: next })).toEqual({ ignored: true, reason });
    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE crm_messages SET status"))).toBe(false);
    expect(slas.recordFirstResponse).not.toHaveBeenCalled();
  });

  it("rejects provider receipts for inbound customer messages without touching SLA state", async () => {
    const { service, slas } = setup({ direction: "inbound", authorship: "provider", sender_id: null });
    await expect(service.recordReceipt("message", { workspaceId: "workspace", status: "delivered" }))
      .rejects.toThrow("Only outbound messages have provider receipts");
    expect(slas.recordFirstResponse).not.toHaveBeenCalled();
  });
});
