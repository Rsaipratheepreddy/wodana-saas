-- v2 P1: project tasks become relational rows instead of an array inside
-- project_execution.content. ProjectRepository writes these rows in the same
-- transaction as the remaining project document. project_execution_view
-- rebuilds the previous JSON shape so existing read queries keep working while
-- they move to the tables.
CREATE TABLE project_tasks (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  id text NOT NULL,
  sort_order integer NOT NULL,
  parent_id text,
  package_id text,
  package text NOT NULL DEFAULT '',
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  area text NOT NULL DEFAULT '',
  location text NOT NULL CHECK (location IN ('site', 'factory', 'office')),
  owner_id text NOT NULL DEFAULT '',
  assignee_ids text[] NOT NULL DEFAULT '{}',
  resource_id text NOT NULL DEFAULT '',
  start_date date,
  end_date date,
  baseline_start date,
  baseline_end date,
  quantity numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit text NOT NULL DEFAULT '',
  weight numeric NOT NULL DEFAULT 0 CHECK (weight >= 0),
  approved numeric NOT NULL DEFAULT 0 CHECK (approved >= 0),
  status text NOT NULL CHECK (status IN ('planned', 'in_progress', 'blocked', 'on_hold', 'awaiting_inspection', 'completed', 'cancelled')),
  priority text NOT NULL CHECK (priority IN ('normal', 'high', 'urgent')),
  inspection_required boolean NOT NULL DEFAULT false,
  scope_ids text[] NOT NULL DEFAULT '{}',
  drawing_id text NOT NULL DEFAULT '',
  ready_scope boolean NOT NULL DEFAULT false,
  ready_access boolean NOT NULL DEFAULT false,
  ready_materials boolean NOT NULL DEFAULT false,
  blocker text NOT NULL DEFAULT '',
  -- Transitional: factory lots, installation batches and inspections move to
  -- their own tables in the factory slice (M10). Keys are omitted when absent.
  production_detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  UNIQUE (workspace_id, project_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, parent_id) REFERENCES project_tasks (project_id, id) DEFERRABLE INITIALLY DEFERRED,
  CHECK (parent_id IS NULL OR parent_id <> id),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
--> statement-breakpoint
CREATE INDEX project_tasks_workspace_owner_idx ON project_tasks (workspace_id, owner_id) WHERE status NOT IN ('completed', 'cancelled');
--> statement-breakpoint
CREATE INDEX project_tasks_workspace_due_idx ON project_tasks (workspace_id, end_date) WHERE status NOT IN ('completed', 'cancelled');
--> statement-breakpoint
CREATE INDEX project_tasks_package_idx ON project_tasks (project_id, package_id);
--> statement-breakpoint
CREATE TABLE project_task_dependencies (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  task_id text NOT NULL,
  predecessor_id text NOT NULL,
  sort_order integer NOT NULL,
  PRIMARY KEY (project_id, task_id, predecessor_id),
  FOREIGN KEY (workspace_id, project_id, task_id) REFERENCES project_tasks (workspace_id, project_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workspace_id, project_id, predecessor_id) REFERENCES project_tasks (workspace_id, project_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  CHECK (task_id <> predecessor_id)
);
--> statement-breakpoint
CREATE INDEX project_task_dependencies_predecessor_idx ON project_task_dependencies (project_id, predecessor_id);
--> statement-breakpoint
ALTER TABLE project_tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_tasks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON project_tasks
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE project_task_dependencies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_task_dependencies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON project_task_dependencies
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE TRIGGER project_tasks_updated_at BEFORE UPDATE ON project_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- The exact Task JSON the TypeScript mapper produces (see project-task-rows.ts).
CREATE FUNCTION project_task_json(task project_tasks)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'id', task.id,
    'parentId', coalesce(task.parent_id, ''),
    'package', task.package,
    'title', task.title,
    'description', task.description,
    'area', task.area,
    'location', task.location,
    'ownerId', task.owner_id,
    'assigneeIds', to_jsonb(task.assignee_ids),
    'resourceId', task.resource_id,
    'start', coalesce(task.start_date::text, ''),
    'end', coalesce(task.end_date::text, ''),
    'baselineStart', coalesce(task.baseline_start::text, ''),
    'baselineEnd', coalesce(task.baseline_end::text, ''),
    'predecessors', coalesce((
      SELECT jsonb_agg(dependency.predecessor_id ORDER BY dependency.sort_order)
      FROM project_task_dependencies dependency
      WHERE dependency.project_id = task.project_id AND dependency.task_id = task.id
    ), '[]'::jsonb),
    'quantity', task.quantity,
    'unit', task.unit,
    'weight', task.weight,
    'approved', task.approved,
    'status', task.status,
    'priority', task.priority,
    'inspectionRequired', task.inspection_required,
    'scopeIds', to_jsonb(task.scope_ids),
    'drawingId', task.drawing_id,
    'readiness', jsonb_build_object('scope', task.ready_scope, 'access', task.ready_access, 'materials', task.ready_materials),
    'blocker', task.blocker
  )
  || CASE WHEN task.package_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('packageId', task.package_id) END
  || coalesce(task.production_detail, '{}'::jsonb);
$$;
--> statement-breakpoint
CREATE VIEW project_execution_view WITH (security_invoker = true) AS
  SELECT execution.project_id, execution.workspace_id, execution.revision, execution.updated_at,
    execution.content || jsonb_build_object('tasks', coalesce((
      SELECT jsonb_agg(project_task_json(task) ORDER BY task.sort_order)
      FROM project_tasks task
      WHERE task.workspace_id = execution.workspace_id AND task.project_id = execution.project_id
    ), '[]'::jsonb)) AS content
  FROM project_execution execution;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON project_tasks, project_task_dependencies TO wodana_app;
    GRANT SELECT ON project_execution_view TO wodana_app;
    GRANT EXECUTE ON FUNCTION project_task_json(project_tasks) TO wodana_app;
  END IF;
END $$;
