import type { PoolClient } from "pg";
import type { ProjectData } from "./execution.types";

type Db = Pick<PoolClient, "query">;

/**
 * The only way to read or write a project's execution record.
 *
 * Tasks live in project_tasks / project_task_dependencies; everything else is still the
 * project_execution document until it moves to its own tables. project_execution_save() (migration
 * 0004) is the only write path and project_task_json() (migration 0001) the only read shape.
 */
export const projectRepository = {
  /** Returns the stored record with tasks, or undefined when the project has no execution record yet. */
  async load(db: Db, workspaceId: string, projectId: string, options: { forUpdate?: boolean } = {}) {
    if (options.forUpdate) {
      await db.query(
        "SELECT 1 FROM project_execution WHERE workspace_id=$1 AND project_id=$2 FOR UPDATE",
        [workspaceId, projectId],
      );
    }
    const result = await db.query<{ content: Partial<ProjectData>; revision: number }>(
      "SELECT content, revision FROM project_execution_view WHERE workspace_id=$1 AND project_id=$2",
      [workspaceId, projectId],
    );
    return result.rows[0];
  },

  /** Writes the document and synchronises task rows in the caller's transaction (see project_execution_save). */
  async save(db: Db, workspaceId: string, projectId: string, data: ProjectData, revision = data.revision) {
    await db.query("SELECT project_execution_save($1,$2,$3,$4::jsonb)", [workspaceId, projectId, revision, JSON.stringify(data)]);
  },
};
