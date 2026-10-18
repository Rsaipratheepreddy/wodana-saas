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

describe("ProjectRemindersService daily run", () => {
  it("never reads the retired project JSON", async () => {
    const seen: string[] = [];
    const { db } = database(["workspace-1"], async (_workspace, sql) => { seen.push(sql); return result([]); });
    await new ProjectRemindersService(db as never).send();
    expect(seen.some((sql) => sql.includes("project_execution_view"))).toBe(false);
    expect(seen.length).toBeGreaterThan(0);
  });

  it("runs every workspace in its own tenant transaction", async () => {
    const { db, opened } = database(["workspace-a", "workspace-b"], async () => result([]));
    const totals = await new ProjectRemindersService(db as never).send();
    expect(opened).toEqual(["workspace-a", "workspace-b"]);
    expect(db.tenantTransaction).toHaveBeenCalledWith("workspace-a", "00000000-0000-0000-0000-000000000000", expect.any(Function));
    expect(totals).toMatchObject({ failedWorkspaces: 0, weeklySummaries: 0, stagesReady: 0, materialsWaiting: 0, milestonesDue: 0 });
  });

  it("keeps going when one workspace fails and reports it", async () => {
    const { db } = database(["broken", "healthy"], async (workspace, sql) => {
      if (workspace === "broken") throw new Error("invalid timezone");
      if (sql.includes("'commercial.decision.reminder','delivered'")) return { ...result([]), rowCount: 1 };
      return result([]);
    });
    await expect(new ProjectRemindersService(db as never).send()).resolves.toMatchObject({ decisionReminders: 1, failedWorkspaces: 1 });
  });
});
