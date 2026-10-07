import { firstValueFrom, take, toArray } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { LiveEventsController } from "./live-events.controller";
import { LiveEventsService } from "./live-events.service";
import { liveScopes } from "./live-scopes";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const envelope = (data: Record<string, unknown>) => JSON.stringify({ schemaVersion: 1, data });

describe("live events (FD-4)", () => {
  it("maps each domain event to the scopes whose screens refresh, never its data", () => {
    expect(liveScopes({ eventType: "site.report_submitted", aggregateType: "site_report", aggregateId: "r", payload: envelope({ projectId, note: "private" }) }))
      .toEqual(expect.arrayContaining(["workspace", "projects", `project:${projectId}`]));
    expect(liveScopes({ eventType: "crm.message.received.v1", aggregateType: "crm_message", aggregateId: "m", payload: envelope({ conversationId }) }))
      .toEqual(expect.arrayContaining(["conversations", `conversation:${conversationId}`, "sales"]));
    expect(liveScopes({ eventType: "purchasing.approval_needed", aggregateType: "purchase_order", aggregateId: "o" })).toEqual(expect.arrayContaining(["purchasing", "approvals"]));
    expect(liveScopes({ eventType: "notification.delivery_requested.v1", aggregateType: "notification", aggregateId: "n" })).toContain("notifications");
    expect(liveScopes({ eventType: "factory.released", aggregateType: "work_order", aggregateId: "w", payload: "not json" })).toEqual(expect.arrayContaining(["workspace", "factory"]));
    expect(JSON.stringify(liveScopes({ eventType: "site.x", aggregateType: "site_report", aggregateId: "r", payload: envelope({ note: "private" }) }))).not.toContain("private");
  });

  it("tells reminders, cases, leads, Finance and the Ledger what changed (E4)", () => {
    const caseId = "44444444-4444-4444-8444-444444444444";
    const leadId = "55555555-5555-4555-8555-555555555555";
    const scopes = (eventType: string, aggregateType: string, aggregateId = "x", data?: Record<string, unknown>) =>
      liveScopes({ eventType, aggregateType, aggregateId, payload: data ? envelope(data) : null });
    expect(scopes("reminders.subject_snoozed", "reminder_subject")).toEqual(expect.arrayContaining(["workspace", "reminders"]));
    expect(scopes("reminders.step_sent", "reminder_step")).toContain("reminders");
    expect(scopes("commercial.quote_resent.v1", "pre_project_case", caseId)).toEqual(expect.arrayContaining(["planning", "cases", `case:${caseId}`]));
    expect(scopes("design.stage_done", "design_journey", "x", { caseId })).toEqual(expect.arrayContaining(["cases", `case:${caseId}`]));
    expect(scopes("crm.lead.updated", "crm_lead", leadId)).toEqual(expect.arrayContaining(["sales", "leads", `lead:${leadId}`]));
    expect(scopes("crm.activity.logged", "crm_activity", "x", { leadId })).toEqual(expect.arrayContaining(["sales", `lead:${leadId}`]));
    expect(scopes("receivables.payment_received", "receipt")).toContain("finance");
    expect(scopes("finance_request.approved", "finance_request")).toContain("finance");
    expect(scopes("books.manual_journal_approved", "books_manual_journal")).toEqual(expect.arrayContaining(["ledger"]));
    expect(scopes("books.manual_journal_approved", "books_manual_journal")).not.toContain("finance");
    expect(scopes("site.report_submitted", "site_report", "x", { projectId })).not.toEqual(expect.arrayContaining(["reminders"]));
    expect(scopes("crm.lead.updated", "crm_lead", "not-a-uuid")).not.toContain("lead:not-a-uuid");
  });

  it("sends a workspace only its own changes", async () => {
    const live = new LiveEventsService();
    const received = firstValueFrom(live.stream(workspaceId).pipe(take(1), toArray()));
    live.publish({ workspaceId: "99999999-9999-4999-8999-999999999999", eventType: "crm.lead.created", aggregateType: "crm_lead", aggregateId: "x" });
    live.publish({ workspaceId, eventType: "crm.lead.created", aggregateType: "crm_lead", aggregateId: "x" });
    await expect(received).resolves.toEqual([{ workspaceId, scopes: expect.arrayContaining(["workspace", "sales"]) }]);
  });

  it("opens a stream only for members of the workspace", async () => {
    const live = new LiveEventsService();
    const denied = { asMember: vi.fn(async () => { throw new Error("Not a member"); }) };
    await expect(new LiveEventsController(live, denied as never).stream({} as never, workspaceId)).rejects.toThrow("Not a member");
    const member = { asMember: vi.fn(async (_actor: unknown, _workspace: string, work: () => unknown) => work()) };
    const stream = await new LiveEventsController(live, member as never).stream({} as never, workspaceId);
    const first = firstValueFrom(stream.pipe(take(1)));
    live.publish({ workspaceId, eventType: "project.started", aggregateType: "project", aggregateId: projectId });
    await expect(first).resolves.toEqual({ type: "change", data: { scopes: expect.arrayContaining(["projects", `project:${projectId}`]) } });
  });
});
