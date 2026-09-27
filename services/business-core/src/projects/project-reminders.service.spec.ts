import { describe, expect, it, vi } from "vitest";
import { ProjectRemindersService } from "./project-reminders.service";

const result = (rows: unknown[]) => ({ rows, rowCount: rows.length });

/** The worker enumerates workspaces, then runs every rule inside that workspace's tenant transaction. */
const database = (workspaceIds: string[], tenantQuery: (workspaceId: string, sql: string) => Promise<unknown>) => {
  const opened: string[] = [];
  const db = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("list_reminder_workspaces()")) return result(workspaceIds.map((workspace_id) => ({ workspace_id })));
      throw new Error(`Reminder SQL must run inside a tenant transaction: ${sql.slice(0, 60)}`);
    }),
    tenantTransaction: vi.fn(async (workspaceId: string, _actor: string, work: (client: unknown) => Promise<unknown>) => {
      opened.push(workspaceId);
      return work({ query: (sql: string) => tenantQuery(workspaceId, sql) });
    }),
  };
  return { db, opened };
};

describe("ProjectRemindersService smart rules", () => {
  it("runs decision and weekly rules and emails only workspaces that enabled email", async () => {
    const { db } = database(["workspace-email"], async (_workspace, sql) => {
      if (sql.includes("event_type='project.weekly_progress' AND status='active' AND channels ? 'email'")) return result([{ workspace_id: "workspace-email" }]);
      if (sql.includes("'project.weekly_progress','delivered'")) return result([
        { workspace_id: "workspace-email", project_id: "project-1", recipient_id: "user-1", project_name: "Villa", body: "3 open tasks", deep_link: "/workspace/projects/project-1/overview", idempotency_key: "weekly:1" },
        { workspace_id: "workspace-in-app", project_id: "project-2", recipient_id: "user-2", project_name: "Office", body: "1 open task", deep_link: "/workspace/projects/project-2/overview", idempotency_key: "weekly:2" },
      ]);
      if (sql.includes("'commercial.decision.reminder','delivered'")) return { ...result([]), rowCount: 2 };
      return result([]);
    });
    const queueScheduledEmail = vi.fn().mockResolvedValue({ queued: true });
    const service = new ProjectRemindersService(db as never, { queueScheduledEmail } as never);

    await expect(service.send()).resolves.toEqual({ created: 4, dueReminders: 0, decisionReminders: 2, weeklySummaries: 2, designAlerts: 0, workReminders: 0, lateOrders: 0, supplierDocuments: 0, factoryShortages: 0, siteReports: 0, warrantyEnding: 0, payablesDue: 0, overBudget: 0, failedWorkspaces: 0 });
    expect(queueScheduledEmail).toHaveBeenCalledTimes(1);
    expect(queueScheduledEmail).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace-email", eventType: "project.weekly_progress" }));
  });

  it("skips the workspace-wide weekly rule for a single-project reminder run", async () => {
    const seen: string[] = [];
    const { db } = database(["workspace-1"], async (_workspace, sql) => { seen.push(sql); return result([]); });
    const service = new ProjectRemindersService(db as never, { queueScheduledEmail: vi.fn() } as never);
    await service.send("8b87894d-f8ea-42ea-9c69-58733e04d2b3");
    expect(seen.some((sql) => sql.includes("project.weekly_progress"))).toBe(false);
  });

  it("runs every workspace in its own tenant transaction and queues email after commit", async () => {
    const events: string[] = [];
    const { db, opened } = database(["workspace-a", "workspace-b"], async () => result([]));
    db.tenantTransaction.mockImplementation(async (workspaceId: string, _actor: string, work: (client: unknown) => Promise<unknown>) => {
      opened.push(workspaceId);
      const value = await work({ query: async (sql: string) => {
        if (sql.includes("'project.due','delivered'")) {
          events.push(`insert:${workspaceId}`);
          return result([{ workspace_id: workspaceId, recipient_id: `user-${workspaceId}`, subject: "Due today · Install", body: "Villa · Planned for 2026-09-28", deep_link: `/workspace/projects/p-${workspaceId}/site-work?record=t1`, idempotency_key: `due:${workspaceId}` }]);
        }
        return result([]);
      } });
      events.push(`commit:${workspaceId}`);
      return value;
    });
    const queueScheduledEmail = vi.fn(async (input: { workspaceId: string }) => { events.push(`email:${input.workspaceId}`); return { queued: true }; });
    const service = new ProjectRemindersService(db as never, { queueScheduledEmail } as never);

    const totals = await service.send();

    expect(opened).toEqual(["workspace-a", "workspace-b"]);
    expect(db.tenantTransaction).toHaveBeenCalledWith("workspace-a", "00000000-0000-0000-0000-000000000000", expect.any(Function));
    expect(events).toEqual(["insert:workspace-a", "commit:workspace-a", "email:workspace-a", "insert:workspace-b", "commit:workspace-b", "email:workspace-b"]);
    expect(totals).toMatchObject({ dueReminders: 2, failedWorkspaces: 0 });
  });

  it("keeps going when one workspace fails and reports it", async () => {
    const { db } = database(["broken", "healthy"], async (workspace, sql) => {
      if (workspace === "broken") throw new Error("invalid timezone");
      if (sql.includes("'commercial.decision.reminder','delivered'")) return { ...result([]), rowCount: 1 };
      return result([]);
    });
    const service = new ProjectRemindersService(db as never, { queueScheduledEmail: vi.fn() } as never);

    await expect(service.send()).resolves.toMatchObject({ decisionReminders: 1, failedWorkspaces: 1 });
  });
});
