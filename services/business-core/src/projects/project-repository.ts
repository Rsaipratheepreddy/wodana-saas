import type { PoolClient } from "pg";
import type { ProjectData } from "./execution.types";

type Db = Pick<PoolClient, "query">;

/** Task keys stored in typed columns; any other key is kept verbatim in production_detail. */
const TYPED_TASK_KEYS = [
  "id", "parentId", "packageId", "package", "title", "description", "area", "location", "ownerId",
  "assigneeIds", "resourceId", "start", "end", "baselineStart", "baselineEnd", "predecessors",
  "quantity", "unit", "weight", "approved", "status", "priority", "inspectionRequired", "scopeIds",
  "drawingId", "readiness", "blocker",
];

/**
 * The only way to read or write a project's execution record.
 *
 * Tasks live in project_tasks / project_task_dependencies; everything else is still the
 * project_execution document until it moves to its own tables. project_task_json() in
 * migration 0001 is the single definition of the task shape for loads and the
 * project_execution_view compatibility view.
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

  /** Writes the document and synchronises task rows in the caller's transaction. */
  async save(db: Db, workspaceId: string, projectId: string, data: ProjectData, revision = data.revision) {
    const { tasks = [], ...document } = data;
    await db.query(
      `INSERT INTO project_execution(project_id,workspace_id,revision,content) VALUES($1,$2,$3,$4)
       ON CONFLICT(project_id) DO UPDATE SET revision=$3,content=$4,updated_at=now()
       WHERE project_execution.workspace_id=$2`,
      [projectId, workspaceId, revision, JSON.stringify(document)],
    );
    const payload = JSON.stringify(tasks);
    await db.query(
      `DELETE FROM project_tasks task WHERE task.workspace_id=$1 AND task.project_id=$2
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements($3::jsonb) item WHERE item->>'id'=task.id)`,
      [workspaceId, projectId, payload],
    );
    await db.query(
      `INSERT INTO project_tasks(
         workspace_id,project_id,id,sort_order,parent_id,package_id,package,title,description,area,location,
         owner_id,assignee_ids,resource_id,start_date,end_date,baseline_start,baseline_end,quantity,unit,weight,
         approved,status,priority,inspection_required,scope_ids,drawing_id,ready_scope,ready_access,ready_materials,
         blocker,production_detail)
       SELECT $1,$2,task->>'id',(ordinal-1)::int,nullif(task->>'parentId',''),task->>'packageId',
         coalesce(task->>'package',''),task->>'title',coalesce(task->>'description',''),coalesce(task->>'area',''),
         task->>'location',coalesce(task->>'ownerId',''),
         coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(task->'assigneeIds','[]'::jsonb))),'{}'),
         coalesce(task->>'resourceId',''),
         nullif(task->>'start','')::date,nullif(task->>'end','')::date,
         nullif(task->>'baselineStart','')::date,nullif(task->>'baselineEnd','')::date,
         coalesce((task->>'quantity')::numeric,0),coalesce(task->>'unit',''),
         coalesce((task->>'weight')::numeric,0),coalesce((task->>'approved')::numeric,0),
         task->>'status',task->>'priority',coalesce((task->>'inspectionRequired')::boolean,false),
         coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(task->'scopeIds','[]'::jsonb))),'{}'),
         coalesce(task->>'drawingId',''),
         coalesce((task->'readiness'->>'scope')::boolean,false),
         coalesce((task->'readiness'->>'access')::boolean,false),
         coalesce((task->'readiness'->>'materials')::boolean,false),
         coalesce(task->>'blocker',''),
         nullif(task - $4::text[],'{}'::jsonb)
       FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS item(task, ordinal)
       ON CONFLICT (project_id,id) DO UPDATE SET
         sort_order=excluded.sort_order,parent_id=excluded.parent_id,package_id=excluded.package_id,
         package=excluded.package,title=excluded.title,description=excluded.description,area=excluded.area,
         location=excluded.location,owner_id=excluded.owner_id,assignee_ids=excluded.assignee_ids,
         resource_id=excluded.resource_id,start_date=excluded.start_date,end_date=excluded.end_date,
         baseline_start=excluded.baseline_start,baseline_end=excluded.baseline_end,quantity=excluded.quantity,
         unit=excluded.unit,weight=excluded.weight,approved=excluded.approved,status=excluded.status,
         priority=excluded.priority,inspection_required=excluded.inspection_required,scope_ids=excluded.scope_ids,
         drawing_id=excluded.drawing_id,ready_scope=excluded.ready_scope,ready_access=excluded.ready_access,
         ready_materials=excluded.ready_materials,blocker=excluded.blocker,production_detail=excluded.production_detail
       WHERE project_tasks.workspace_id=$1`,
      [workspaceId, projectId, payload, TYPED_TASK_KEYS],
    );
    await db.query("DELETE FROM project_task_dependencies WHERE workspace_id=$1 AND project_id=$2", [workspaceId, projectId]);
    await db.query(
      `INSERT INTO project_task_dependencies(workspace_id,project_id,task_id,predecessor_id,sort_order)
       SELECT DISTINCT ON (item.task->>'id', predecessor.value) $1,$2,item.task->>'id',predecessor.value,(predecessor.ordinal-1)::int
       FROM jsonb_array_elements($3::jsonb) AS item(task)
       CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(item.task->'predecessors','[]'::jsonb)) WITH ORDINALITY AS predecessor(value, ordinal)
       ORDER BY item.task->>'id', predecessor.value, predecessor.ordinal`,
      [workspaceId, projectId, payload],
    );
  },
};
