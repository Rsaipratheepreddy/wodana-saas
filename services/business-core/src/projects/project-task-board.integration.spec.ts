import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyProject } from "./execution.domain";
import type { Task } from "./execution.types";
import { projectRepository } from "./project-repository";
import { readTaskBoard } from "./project-task-board";

// Opt-in with PROJECT_REPOSITORY_TEST_DATABASE_URL (local, migrated, superuser). Each test is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, parentId: "", package: "Kitchen", title: `Task ${id}`, description: "", area: "Kitchen", location: "office",
  ownerId: "", assigneeIds: [], resourceId: "", start: "2026-01-01", end: "2026-01-05", baselineStart: "", baselineEnd: "",
  predecessors: [], quantity: 0, unit: "", weight: 1, approved: 0, status: "planned", priority: "normal",
  inspectionRequired: false, scopeIds: [], drawingId: "", readiness: { scope: true, access: true, materials: true },
  blocker: "", ...extra,
});

integration("task board with PostgreSQL", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  async function scenario(work: (board: (input: Record<string, unknown>, manager?: boolean) => ReturnType<typeof readTaskBoard>, ids: { me: string; other: string; assigned: string; hidden: string }) => Promise<void>) {
    const client: PoolClient = await pool.connect();
    const workspaceId = randomUUID(), me = randomUUID(), other = randomUUID(), assigned = randomUUID(), hidden = randomUUID();
    try {
      await client.query("BEGIN");
      for (const table of ["workspaces", "delivery_projects", "workspace_memberships", "project_assignments", "users"]) {
        await client.query(`ALTER TABLE ${table} DISABLE TRIGGER ALL`);
      }
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by,default_timezone) VALUES($1,'Board',$2,'AED',$3,'Asia/Dubai')", [workspaceId, `board-${workspaceId.slice(0, 8)}`, me]);
      for (const [member, name] of [[me, "Sara"], [other, "Omar"]] as const) {
        const user = randomUUID();
        await client.query("INSERT INTO users(id,primary_email,display_name) VALUES($1,$2,$3)", [user, `${user}@example.com`, name]);
        await client.query("INSERT INTO workspace_memberships(id,workspace_id,user_id,status) VALUES($1,$2,$3,'active')", [member, workspaceId, user]);
      }
      for (const [project, name] of [[assigned, "Villa"], [hidden, "Office tower"]] as const) {
        await client.query("INSERT INTO delivery_projects(id,workspace_id,case_id,name,created_by) VALUES($1,$2,$3,$4,$5)", [project, workspaceId, randomUUID(), name, me]);
      }
      await client.query("INSERT INTO project_assignments(workspace_id,project_id,membership_id,active) VALUES($1,$2,$3,true)", [workspaceId, assigned, me]);
      for (const table of ["workspaces", "delivery_projects", "workspace_memberships", "project_assignments", "users"]) {
        await client.query(`ALTER TABLE ${table} ENABLE TRIGGER ALL`);
      }
      await projectRepository.save(client, workspaceId, assigned, {
        ...emptyProject(), revision: 1, tasks: [
          task("mine-late", { ownerId: me, end: "2026-01-02" }),
          task("mine-waiting", { ownerId: me, end: "2099-01-01", predecessors: ["mine-late"] }),
          task("mine-drawing", { ownerId: other, assigneeIds: [me], location: "site", end: "2099-01-02" }),
          task("blocked", { ownerId: other, status: "blocked", blocker: "Lift not booked", end: "2099-01-03" }),
          task("parent", { ownerId: me, end: "2099-02-01" }),
          task("child", { ownerId: me, parentId: "parent", end: "2099-02-01", status: "completed" }),
          task("nobody", { end: "2099-03-01" }),
        ],
      });
      await projectRepository.save(client, workspaceId, hidden, { ...emptyProject(), revision: 1, tasks: [task("secret", { ownerId: other })] });
      await client.query("SET LOCAL ROLE wodana_app");
      const board = (input: Record<string, unknown>, manager = false) => readTaskBoard({
        client, workspaceId, membershipId: me,
        permissions: new Set(manager ? ["projects.view", "projects.manage"] : ["projects.view"]),
      } as never, input);
      await work(board, { me, other, assigned, hidden });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  it("shows my leaf tasks with the first missing start condition", async () => {
    await scenario(async (board) => {
      const page = await board({ view: "mine" });
      expect(page.rows.map((row) => [row.id, row.waitingFor, row.overdue])).toEqual([
        ["mine-late", "", true],
        ["mine-waiting", "Earlier task", false],
        ["mine-drawing", "Approved drawing", false],
        ["child", "", false],
      ]);
      expect(page.rows[0]).toMatchObject({ projectName: "Villa", ownerName: "Sara", status: "planned" });
    });
  });

  it("limits a non-manager to assigned projects and a manager sees all", async () => {
    await scenario(async (board) => {
      const member = await board({ view: "all" });
      expect(member.rows.map((row) => row.id)).not.toContain("secret");
      expect(member.projects.map((project) => project.name)).toEqual(["Villa"]);
      const manager = await board({ view: "all" }, true);
      expect(manager.rows.map((row) => row.id)).toContain("secret");
    });
  });

  it("filters by status and owner and counts every status", async () => {
    await scenario(async (board, ids) => {
      const blocked = await board({ view: "all", status: "blocked" });
      expect(blocked.rows).toEqual([expect.objectContaining({ id: "blocked", waitingFor: "Lift not booked", ownerName: "Omar" })]);
      expect(blocked.counts).toMatchObject({ planned: 4, blocked: 1, completed: 1 });
      const unassigned = await board({ view: "all", ownerId: "unassigned" });
      expect(unassigned.rows.map((row) => [row.id, row.waitingFor])).toEqual([["nobody", "Owner"]]);
      const other = await board({ view: "all", ownerId: ids.other });
      expect(other.rows.map((row) => row.id)).toEqual(["mine-drawing", "blocked"]);
    });
  });

  it("rejects malformed filters", async () => {
    await scenario(async (board) => {
      await expect(board({ view: "everyone" })).rejects.toThrow("Choose mine, team or all.");
      await expect(board({ status: "done" })).rejects.toThrow("Choose a valid task status.");
      await expect(board({ cursor: "not-a-cursor" })).rejects.toThrow("The page cursor is invalid.");
    });
  });
});
