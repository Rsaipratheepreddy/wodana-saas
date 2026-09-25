import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyProject } from "./execution.domain";
import type { ProjectData, Task } from "./execution.types";
import { projectRepository } from "./project-repository";

// Opt-in: PROJECT_REPOSITORY_TEST_DATABASE_URL must point at a local, migrated database with a
// superuser role. Every test runs in a transaction that is rolled back.
const databaseUrl = process.env.PROJECT_REPOSITORY_TEST_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, parentId: "", package: "Kitchen", title: `Task ${id}`, description: "", area: "Kitchen",
  location: "site", ownerId: "member-1", assigneeIds: ["member-1", "member-2"], resourceId: "",
  start: "2026-10-01", end: "2026-10-05", baselineStart: "2026-10-01", baselineEnd: "2026-10-05",
  predecessors: [], quantity: 12.5, unit: "rft", weight: 1, approved: 0, status: "planned",
  priority: "normal", inspectionRequired: false, scopeIds: [], drawingId: "",
  readiness: { scope: true, access: false, materials: false }, blocker: "", ...extra,
});

integration("project repository with PostgreSQL", () => {
  let pool: Pool;
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Tests require a local database");
    pool = new Pool({ connectionString: url.toString() });
  });
  afterAll(() => pool.end());

  /** Minimal workspace + project inside a rolled-back transaction; parent FK checks are off for fixture rows only. */
  async function withProject(work: (client: PoolClient, workspaceId: string, projectId: string) => Promise<void>) {
    const client = await pool.connect();
    const workspaceId = randomUUID(), projectId = randomUUID(), actor = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE workspaces DISABLE TRIGGER ALL");
      await client.query("ALTER TABLE delivery_projects DISABLE TRIGGER ALL");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [workspaceId]);
      await client.query("INSERT INTO workspaces(id,name,slug,default_currency,created_by) VALUES($1,'Repo test',$2,'AED',$3)", [workspaceId, `repo-${workspaceId.slice(0, 8)}`, actor]);
      await client.query("INSERT INTO delivery_projects(id,workspace_id,case_id,name,created_by) VALUES($1,$2,$3,'Villa',$4)", [projectId, workspaceId, randomUUID(), actor]);
      await client.query("ALTER TABLE workspaces ENABLE TRIGGER ALL");
      await client.query("ALTER TABLE delivery_projects ENABLE TRIGGER ALL");
      await work(client, workspaceId, projectId);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  const project = (tasks: Task[]): ProjectData => ({ ...emptyProject(), revision: 1, tasks });

  it("round-trips every task field, order and dependency exactly", async () => {
    await withProject(async (client, workspaceId, projectId) => {
      const parent = task("t1");
      const child = task("t2", {
        parentId: "t1", packageId: "pkg-1", predecessors: ["t3", "t1"], start: "", end: "",
        location: "factory", status: "in_progress", priority: "urgent", inspectionRequired: true,
        scopeIds: ["scope-9"], drawingId: "dwg-4", blocker: "Waiting for veneer", approved: 3.25,
        inspections: [{ id: "i1", by: "qc", at: "2026-10-02T10:00:00.000Z", passed: true, quantity: 2, unit: "rft", evidence: "photo" }],
      });
      const sibling = task("t3", { assigneeIds: [], quantity: 0 });
      const saved = project([parent, child, sibling]);
      saved.snags = [];

      await projectRepository.save(client, workspaceId, projectId, saved);
      const loaded = await projectRepository.load(client, workspaceId, projectId, { forUpdate: true });

      expect(loaded?.content.tasks).toEqual([parent, child, sibling]);
      expect(loaded?.content).toEqual(saved);
      const stored = await client.query("SELECT content ? 'tasks' AS embedded FROM project_execution WHERE project_id=$1", [projectId]);
      expect(stored.rows[0].embedded).toBe(false);
    });
  });

  it("updates, reorders and removes tasks and their dependencies", async () => {
    await withProject(async (client, workspaceId, projectId) => {
      await projectRepository.save(client, workspaceId, projectId, project([task("a"), task("b", { predecessors: ["a"] }), task("c")]));
      await projectRepository.save(client, workspaceId, projectId, project([task("c", { title: "Renamed" }), task("a")]));

      const loaded = await projectRepository.load(client, workspaceId, projectId);
      expect(loaded?.content.tasks?.map((item) => [item.id, item.title])).toEqual([["c", "Renamed"], ["a", "Task a"]]);
      const dependencies = await client.query("SELECT count(*)::int AS count FROM project_task_dependencies WHERE project_id=$1", [projectId]);
      expect(dependencies.rows[0].count).toBe(0);
    });
  });

  it("rejects a dependency on a task that does not exist", async () => {
    await withProject(async (client, workspaceId, projectId) => {
      await projectRepository.save(client, workspaceId, projectId, project([task("a", { predecessors: ["ghost"] })]));
      await expect(client.query("SET CONSTRAINTS ALL IMMEDIATE")).rejects.toThrow(/foreign key/);
    });
  });

  it("hides another workspace's tasks", async () => {
    await withProject(async (client, workspaceId, projectId) => {
      await projectRepository.save(client, workspaceId, projectId, project([task("a")]));
      await client.query("SET LOCAL ROLE wodana_app");
      await client.query("SELECT set_config('app.current_workspace_id',$1,true)", [randomUUID()]);
      const visible = await client.query("SELECT count(*)::int AS count FROM project_tasks WHERE project_id=$1", [projectId]);
      expect(visible.rows[0].count).toBe(0);
    });
  });
});
