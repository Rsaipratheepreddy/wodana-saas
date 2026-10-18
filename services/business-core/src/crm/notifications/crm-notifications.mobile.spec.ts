import { describe, expect, it, vi } from "vitest";
import { CrmNotificationsService } from "./crm-notifications.service";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const notificationId = "33333333-3333-4333-8333-333333333333";
const projectId = "44444444-4444-4444-8444-444444444444";
const installationId = "55555555-5555-4555-8555-555555555555";
const endpointId = "66666666-6666-4666-8666-666666666666";

function access(client: { query: ReturnType<typeof vi.fn> }, permissions: Record<string, boolean> = {}) {
  return {
    withPermission: vi.fn(async (_actor, _workspace, _permission, work) => work(client, { userId })),
    asMember: vi.fn(async (_actor, _workspace, work) => work(client, { userId })),
    hasPermission: vi.fn(async (_client, _workspace, _user, permission: string) => permissions[permission] === true),
  };
}

function service(options: {
  query: ReturnType<typeof vi.fn>;
  permissions?: Record<string, boolean>;
  database?: { tenantTransaction: ReturnType<typeof vi.fn> };
  tokens?: { put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
}) {
  const client = { query: options.query };
  const events = { record: vi.fn().mockResolvedValue(undefined) };
  const tokens = options.tokens ?? { put: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) };
  const instance = new CrmNotificationsService(
    (options.database ?? { tenantTransaction: vi.fn() }) as never,
    access(client, options.permissions) as never,
    events as never,
    { record: vi.fn() } as never,
    tokens as never,
  );
  return { instance, client, events, tokens };
}

describe("native notification lifecycle", () => {
  it("resolves an assigned project without querying a non-existent permission view", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("UPDATE notifications")) return { rows: [{ deepLink: `/workspace/projects/${projectId}/overview`, readAt: new Date(), version: 2 }], rowCount: 1 };
      if (sql.includes("FROM delivery_projects")) return { rows: [{ exists: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const { instance } = service({ query, permissions: { "projects.view": true, "projects.manage": false } });

    await expect(instance.open({} as never, workspaceId, notificationId)).resolves.toMatchObject({
      fallback: false,
      destination: { module: "projects", screen: "overview", recordId: projectId },
    });
    expect(query.mock.calls.map(([sql]) => String(sql)).join("\n")).not.toContain("effective_member_permissions");
  });

  it("opens finance and supplier notices on their app screen for people who may see them (FD-6)", async () => {
    const opened = async (deepLink: string, permissions: Record<string, boolean>) => {
      const query = vi.fn(async (sql: string) => sql.includes("UPDATE notifications")
        ? { rows: [{ deepLink, readAt: new Date(), version: 2 }], rowCount: 1 } : { rows: [], rowCount: 0 });
      return service({ query, permissions }).instance.open({} as never, workspaceId, notificationId);
    };
    await expect(opened(`/workspace/finance/bills?bill=${projectId}`, { "payables.view": true })).resolves.toMatchObject({ fallback: false, destination: { module: "finance", screen: "bill", recordId: projectId } });
    await expect(opened(`/workspace/finance/client-invoices?invoice=${projectId}`, { "receivables.view": true })).resolves.toMatchObject({ destination: { module: "finance", screen: "invoice", recordId: projectId } });
    await expect(opened(`/workspace/finance/suppliers/${projectId}`, { "payables.view": true })).resolves.toMatchObject({ destination: { module: "finance", screen: "supplier", recordId: projectId } });
    await expect(opened(`/workspace/purchasing/suppliers?supplier=${projectId}`, { "vendors.view": true })).resolves.toMatchObject({ destination: { module: "purchasing", screen: "supplier", recordId: projectId } });
    await expect(opened(`/workspace/finance/petty-cash?claim=${projectId}`, {})).resolves.toMatchObject({ destination: { module: "approvals" } });
    // Without the permission, the notice stays in the inbox.
    await expect(opened(`/workspace/finance/bills?bill=${projectId}`, {})).resolves.toMatchObject({ fallback: true, destination: { module: "crm", screen: "inbox" } });
  });

  it("falls back to the CRM Inbox when a deep link is invalid or unavailable", async () => {
    const query = vi.fn(async (sql: string) => sql.includes("UPDATE notifications")
      ? { rows: [{ deepLink: "https://outside.example.test/record", readAt: new Date(), version: 2 }], rowCount: 1 }
      : { rows: [], rowCount: 0 });
    const { instance } = service({ query });
    await expect(instance.open({} as never, workspaceId, notificationId)).resolves.toMatchObject({
      fallback: true,
      destination: { module: "crm", screen: "inbox" },
    });
  });

  it("stores the raw Expo token only in the secure token store", async () => {
    const token = "ExpoPushToken[abcdefghijklmnop]";
    const reference = `redis:push:${workspaceId}:${userId}:77777777-7777-4777-8777-777777777777`;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM notification_device_consents")) return { rows: [{ id: "consent", permission_status: "granted" }], rowCount: 1 };
      if (sql.includes("last_request_id=$4")) return { rows: [], rowCount: 0 };
      if (sql.includes("DELETE FROM device_endpoints")) return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT encrypted_token_reference")) return { rows: [], rowCount: 0 };
      if (sql.includes("INSERT INTO device_endpoints")) return { rows: [{ id: endpointId, installationId, status: "active", version: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const tokens = { put: vi.fn().mockResolvedValue(reference), delete: vi.fn().mockResolvedValue(undefined) };
    const { instance } = service({ query, tokens });

    await instance.registerDevice({} as never, workspaceId, {
      requestId: "88888888-8888-4888-8888-888888888888",
      installationId,
      platform: "ios",
      status: "granted",
      tokenType: "expo",
      token,
      locale: "en-AE",
      timezone: "Asia/Dubai",
    });

    expect(tokens.put).toHaveBeenCalledWith(workspaceId, userId, token);
    const databaseArguments = query.mock.calls.flatMap(([, values]) => Array.isArray(values) ? values : []);
    expect(databaseArguments).not.toContain(token);
    expect(databaseArguments).toContain(reference);
  });

  it("revokes an invalid device after a terminal Expo receipt and creates the Inbox fallback", async () => {
    const reference = `redis:push:${workspaceId}:${userId}:99999999-9999-4999-8999-999999999999`;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM notification_delivery_attempts attempt JOIN notifications")) return { rows: [{
        id: "attempt", status: "checking", endpointReference: reference, recipientId: userId,
        eventType: "lead.assigned", subject: "New enquiry", body: "Call the client", deepLink: "/workspace/crm/leads",
        idempotencyKey: "lead:assigned", correlationId: notificationId,
      }], rowCount: 1 };
      if (sql.includes("UPDATE notifications SET status")) return { rows: [{ id: notificationId, status: "failed", version: 4 }], rowCount: 1 };
      if (sql.includes("UPDATE device_endpoints SET status='revoked'")) return { rows: [{ id: endpointId }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const database = { tenantTransaction: vi.fn(async (_workspace, _actor, work) => work({ query })) };
    const tokens = { put: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) };
    const { instance } = service({ query, database, tokens });

    await instance.pushReceiptResult(notificationId, {
      workspaceId,
      attempt: 8,
      providerMessageId: "expo-receipt",
      result: "permanent_failure",
      errorCode: "DeviceNotRegistered",
      errorMessage: "The app was removed",
    });

    expect(tokens.delete).toHaveBeenCalledWith(reference);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO notifications"))).toBe(true);
  });
});
