import { describe, expect, it, vi } from "vitest";
import { ProjectRemindersService } from "./project-reminders.service";

const result = (rows: unknown[]) => ({ rows, rowCount: rows.length });

describe("ProjectRemindersService smart rules", () => {
  it("runs decision and weekly rules and emails only workspaces that enabled email", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("event_type='project.weekly_progress' AND status='active' AND channels ? 'email'")) return result([{ workspace_id: "workspace-email" }]);
      if (sql.includes("'project.weekly_progress','delivered'")) return result([
        { workspace_id: "workspace-email", project_id: "project-1", recipient_id: "user-1", project_name: "Villa", body: "3 open tasks", deep_link: "/workspace/projects/project-1/overview", idempotency_key: "weekly:1" },
        { workspace_id: "workspace-in-app", project_id: "project-2", recipient_id: "user-2", project_name: "Office", body: "1 open task", deep_link: "/workspace/projects/project-2/overview", idempotency_key: "weekly:2" },
      ]);
      if (sql.includes("'commercial.decision.reminder','delivered'")) return { ...result([]), rowCount: 2 };
      return result([]);
    });
    const queueScheduledEmail = vi.fn().mockResolvedValue({ queued: true });
    const service = new ProjectRemindersService({ query } as never, { queueScheduledEmail } as never);

    await expect(service.send()).resolves.toEqual({ created: 4, dueReminders: 0, decisionReminders: 2, weeklySummaries: 2 });
    expect(queueScheduledEmail).toHaveBeenCalledTimes(1);
    expect(queueScheduledEmail).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace-email", eventType: "project.weekly_progress" }));
    expect(query.mock.calls.some(([sql]) => String(sql).includes("ON CONFLICT(workspace_id,idempotency_key) DO NOTHING"))).toBe(true);
  });

  it("skips the workspace-wide weekly rule for a single-project reminder run", async () => {
    const query = vi.fn(async (sql: string) => sql.includes("commercial.decision.reminder") ? result([]) : result([]));
    const service = new ProjectRemindersService({ query } as never, { queueScheduledEmail: vi.fn() } as never);
    await service.send("8b87894d-f8ea-42ea-9c69-58733e04d2b3");
    expect(query.mock.calls.some(([sql]) => String(sql).includes("project.weekly_progress"))).toBe(false);
  });
});
