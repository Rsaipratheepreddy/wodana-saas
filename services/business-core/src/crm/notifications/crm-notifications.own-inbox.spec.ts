import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { CrmNotificationsService } from "./crm-notifications.service";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const qsUserId = "22222222-2222-4222-8222-222222222222";
const notificationId = "33333333-3333-4333-8333-333333333333";
const actor = { subject: "omar", provider: "local", email: "omar.qs@example.com", displayName: "Omar" } as never;

/**
 * A member with no notification permission (a QS or Finance reviewer): membership opens the work,
 * anything guarded by a permission is refused, as the real WorkspaceAccessService would.
 */
function memberWithoutPermissions(query: ReturnType<typeof vi.fn>) {
  const client = { query };
  const access = {
    asMember: vi.fn(async (_actor: unknown, _workspace: string, work: (c: unknown, u: { userId: string }) => unknown) => work(client, { userId: qsUserId })),
    withPermission: vi.fn(async (_actor: unknown, _workspace: string, permission: string) => { throw new ForbiddenException(`Permissions required: ${permission}`); }),
    hasPermission: vi.fn(async () => false),
  };
  const service = new CrmNotificationsService({ tenantTransaction: vi.fn() } as never, access as never, { record: vi.fn() } as never, { record: vi.fn() } as never);
  return { service, access };
}

describe("your own notifications need only membership", () => {
  it("lists only the signed-in member's in-app notices", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: notificationId, subject: "Quote ready for QS review" }], rowCount: 1 }));
    const { service, access } = memberWithoutPermissions(query);
    await expect(service.inbox(actor, workspaceId)).resolves.toEqual([{ id: notificationId, subject: "Quote ready for QS review", webUrl: null }]);
    expect(access.asMember).toHaveBeenCalledTimes(1);
    expect(access.withPermission).not.toHaveBeenCalled();
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/recipient_type='user' AND recipient_id=\$2 AND channel='in_app'/);
    expect(values).toEqual([workspaceId, qsUserId]);
  });

  it("gives the phone the web address of each notice, for the ones it has no screen for", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: notificationId, deepLink: "/workspace/finance/runs?run=1" }, { id: "b", deepLink: null }], rowCount: 2 }));
    const client = { query };
    const access = { asMember: vi.fn(async (_actor: unknown, _workspace: string, work: (c: unknown, u: { userId: string }) => unknown) => work(client, { userId: qsUserId })) };
    const config = { get: (_key: string) => "https://app.example.com,https://other.example.com" };
    const service = new CrmNotificationsService({} as never, access as never, { record: vi.fn() } as never, { record: vi.fn() } as never, undefined, undefined, config as never);
    await expect(service.inbox(actor, workspaceId)).resolves.toEqual([
      { id: notificationId, deepLink: "/workspace/finance/runs?run=1", webUrl: "https://app.example.com/workspace/finance/runs?run=1" },
      { id: "b", deepLink: null, webUrl: null },
    ]);
  });

  it("marks one of your notices read, and never someone else's", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const { service } = memberWithoutPermissions(query);
    await expect(service.read(actor, workspaceId, notificationId)).rejects.toThrow("Notification not found");
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/recipient_type='user' AND recipient_id=\$3/);
    expect(values).toEqual([workspaceId, notificationId, qsUserId]);

    query.mockResolvedValueOnce({ rows: [{ id: notificationId, readAt: new Date(), version: 2 }], rowCount: 1 });
    await expect(service.read(actor, workspaceId, notificationId)).resolves.toMatchObject({ id: notificationId, version: 2 });
  });

  it("marks all of your notices read", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: "a" }, { id: "b" }], rowCount: 2 }));
    const { service, access } = memberWithoutPermissions(query);
    await expect(service.readAll(actor, workspaceId)).resolves.toEqual({ updated: 2 });
    expect(access.withPermission).not.toHaveBeenCalled();
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/UPDATE notifications SET read_at=now\(\).*recipient_id=\$2 .*read_at IS NULL/);
    expect(values).toEqual([workspaceId, qsUserId]);
  });

  it("sets and reads your own preferences with membership alone (FD-5)", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: "p", eventType: "site.*", channel: "push", enabled: false, version: 1 }], rowCount: 1 }));
    const { service, access } = memberWithoutPermissions(query);
    await expect(service.preference(actor, workspaceId, { recipientType: "user", recipientId: qsUserId, eventType: "site.*", channel: "push", enabled: false })).resolves.toMatchObject({ enabled: false });
    expect(access.withPermission).not.toHaveBeenCalled();
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/INSERT INTO notification_preferences/);
    expect(values.slice(0, 5)).toEqual([workspaceId, "user", qsUserId, "site.*", "push"]);
    await expect(service.myPreferences(actor, workspaceId)).resolves.toHaveLength(1);
  });

  it("refuses to mute a critical reminder (R13), and allows turning it back on", async () => {
    const query = vi.fn(async () => ({ rows: [{ id: "p", eventType: "receivables.overdue", channel: "email", enabled: true, version: 1 }], rowCount: 1 }));
    const { service } = memberWithoutPermissions(query);
    for (const eventType of ["receivables.overdue", "approvals.waiting", "receivables.payment_due", "payables.due", "site.permit_expiry"]) {
      await expect(service.preference(actor, workspaceId, { recipientType: "user", recipientId: qsUserId, eventType, channel: "email", enabled: false })).rejects.toThrow(/critical/);
    }
    expect(query).not.toHaveBeenCalled();
    await expect(service.preference(actor, workspaceId, { recipientType: "user", recipientId: qsUserId, eventType: "receivables.overdue", channel: "email", enabled: true })).resolves.toMatchObject({ enabled: true });
  });

  it("still needs the permission to change anyone else's preference", async () => {
    const query = vi.fn();
    const { service } = memberWithoutPermissions(query);
    await expect(service.preference(actor, workspaceId, { recipientType: "user", recipientId: notificationId, eventType: "*", channel: "email", enabled: false })).rejects.toThrow("crm.communications.view");
    await expect(service.preference(actor, workspaceId, { recipientType: "party", recipientId: notificationId, eventType: "*", channel: "email", enabled: false })).rejects.toThrow("crm.communications.view");
    expect(query).not.toHaveBeenCalled();
  });

  it("keeps templates and policies (everyone's notices) behind their permissions", async () => {
    const query = vi.fn();
    const { service } = memberWithoutPermissions(query);
    await expect(service.templates(actor, workspaceId)).rejects.toThrow("crm.notifications.view");
    await expect(service.policies(actor, workspaceId)).rejects.toThrow("crm.notifications.view");
    expect(query).not.toHaveBeenCalled();
  });
});
