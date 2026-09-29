import { describe, expect, it, vi } from "vitest";
import { CrmNotificationsService } from "../crm/notifications/crm-notifications.service";
import { approvalPush, LOCK_SCREEN_KINDS } from "./approval-push";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const order = "22222222-2222-4222-8222-222222222222";
const project = "33333333-3333-4333-8333-333333333333";
const report = "44444444-4444-4444-8444-444444444444";

describe("approve from the lock screen (X-2)", () => {
  it("names the row to decide for approvals that need no note, from the notice's own link", () => {
    expect(approvalPush("purchasing.approval_needed", `/workspace/purchasing/orders?order=${order}`)).toEqual({ pushCategory: "approval", approval: { kind: "order", id: order } });
    expect(approvalPush("payables.run_submitted", `/workspace/finance/runs?run=${order}`)).toEqual({ pushCategory: "approval", approval: { kind: "payment_run", id: order } });
    expect(approvalPush("petty_cash.submitted", `/workspace/projects/${project}/money?view=petty-cash&claim=${order}`)).toEqual({ pushCategory: "approval", approval: { kind: "petty_cash", id: order } });
    expect(approvalPush("quotation.review_requested", `/workspace/pre-projects/cases/${project}/quotations?quote=${order}`)).toEqual({ pushCategory: "approval", approval: { kind: "quote_review", id: order } });
    // A day's report is approved and sent to the client: its button says so.
    expect(approvalPush("site.report_waiting", `/workspace/projects/${project}/site?report=${report}`)).toEqual({ pushCategory: "approval_send", approval: { kind: "site_report", id: report } });
  });

  it("offers nothing for other notices, links without the record, or anything malformed", () => {
    expect(approvalPush("work.assigned", `/workspace/purchasing/orders?order=${order}`)).toBeNull();
    expect(approvalPush("stock.adjustment_needs_approval", "/workspace/inventory")).toBeNull();
    expect(approvalPush("purchasing.approval_needed", "/workspace/purchasing/orders")).toBeNull();
    expect(approvalPush("purchasing.approval_needed", "/workspace/purchasing/orders?order=../../x")).toBeNull();
    expect(approvalPush("purchasing.approval_needed", null)).toBeNull();
    // A bill needs a note to approve, so it is never offered.
    expect([...LOCK_SCREEN_KINDS].sort()).toEqual(["order", "payment_run", "petty_cash", "quote_review", "site_report"]);
  });

  it("puts the category and the row on the claimed push job, and nothing on other channels", async () => {
    const rows = [
      { id: "p1", recipientType: "user", recipientId: "u1", channel: "push", eventType: "purchasing.approval_needed", deepLink: `/workspace/purchasing/orders?order=${order}` },
      { id: "p2", recipientType: "user", recipientId: "u1", channel: "push", eventType: "work.assigned", deepLink: `/workspace/projects/${project}/plan` },
      { id: "e1", recipientType: "user", recipientId: "u1", channel: "email", eventType: "purchasing.approval_needed", deepLink: `/workspace/purchasing/orders?order=${order}` },
    ];
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("WITH due AS")) return { rows };
      if (sql.includes("FROM notification_preferences")) return { rows: [] };
      if (sql.includes("FROM device_endpoints")) return { rows: [{ tokenReference: `redis:push:${workspaceId}:u1:d`, platform: "ios" }] };
      if (sql.includes("FROM users")) return { rows: [{ email: "approver@example.com" }] };
      return { rows: [] };
    });
    const database = { tenantTransaction: vi.fn(async (_w: string, _a: string, work: (client: unknown) => unknown) => work({ query })) };
    const service = new CrmNotificationsService(database as never, {} as never, {} as never);
    const { items } = await service.claimInternal({ workspaceId });
    const byId = Object.fromEntries(items.map((item) => [item.id, item]));
    expect(byId.p1).toMatchObject({ pushCategory: "approval", approval: { kind: "order", id: order } });
    expect(byId.p2).not.toHaveProperty("pushCategory");
    expect(byId.e1).not.toHaveProperty("approval");
  });
});
