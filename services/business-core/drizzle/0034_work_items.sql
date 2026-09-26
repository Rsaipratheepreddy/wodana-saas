-- Project work: one table for every piece of work on a project — tasks, their subtasks and issues
-- (blockers, client requests, snags). Each item may belong to a package, a scope line and a stage.
-- Items are never deleted (cancel instead), so the history of who was asked to do what stays whole.
-- Dependencies say what must finish (or start) first; an item is blocked while one isn't met.
CREATE TABLE work_items (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  type varchar(20) NOT NULL CHECK (type IN ('task', 'blocker', 'client_request', 'snag')),
  parent_id uuid,
  package_id uuid,
  boq_line_id uuid,
  stage_id uuid,
  title varchar(300) NOT NULL CHECK (length(btrim(title)) > 0),
  description varchar(10000) NOT NULL DEFAULT '',
  status varchar(20) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'in_review', 'done', 'cancelled')),
  priority varchar(10) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assignee_membership_id uuid,
  start_date date,
  due_date date,
  started_at timestamptz,
  completed_at timestamptz,
  completed_by uuid REFERENCES users (id),
  created_by uuid NOT NULL REFERENCES users (id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_id, number),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, parent_id) REFERENCES work_items (workspace_id, id),
  FOREIGN KEY (workspace_id, package_id) REFERENCES project_packages (workspace_id, id) ON DELETE SET NULL (package_id),
  FOREIGN KEY (workspace_id, boq_line_id) REFERENCES project_boq_lines (workspace_id, id),
  FOREIGN KEY (workspace_id, stage_id) REFERENCES project_stages (workspace_id, id),
  FOREIGN KEY (workspace_id, assignee_membership_id) REFERENCES workspace_memberships (workspace_id, id),
  CHECK (parent_id IS NULL OR parent_id <> id),
  CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date),
  CHECK ((status = 'done') = (completed_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX work_items_project_idx ON work_items (workspace_id, project_id, status);
--> statement-breakpoint
CREATE INDEX work_items_assignee_idx ON work_items (workspace_id, assignee_membership_id, due_date) WHERE status NOT IN ('done', 'cancelled');
--> statement-breakpoint
CREATE INDEX work_items_parent_idx ON work_items (workspace_id, parent_id) WHERE parent_id IS NOT NULL;
--> statement-breakpoint
-- What must happen first: finish-to-start (the successor starts after the predecessor finishes) or
-- start-to-start, with a lag in working days used when the plan is scheduled.
CREATE TABLE work_item_links (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  predecessor_id uuid NOT NULL,
  successor_id uuid NOT NULL,
  kind varchar(2) NOT NULL DEFAULT 'fs' CHECK (kind IN ('fs', 'ss')),
  lag_days integer NOT NULL DEFAULT 0 CHECK (lag_days BETWEEN -365 AND 365),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, predecessor_id, successor_id),
  FOREIGN KEY (workspace_id, predecessor_id) REFERENCES work_items (workspace_id, id),
  FOREIGN KEY (workspace_id, successor_id) REFERENCES work_items (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  CHECK (predecessor_id <> successor_id)
);
--> statement-breakpoint
CREATE INDEX work_item_links_successor_idx ON work_item_links (workspace_id, successor_id);
--> statement-breakpoint
CREATE TABLE work_item_comments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  work_item_id uuid NOT NULL,
  body varchar(4000) NOT NULL CHECK (length(btrim(body)) > 0),
  author_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, work_item_id) REFERENCES work_items (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX work_item_comments_item_idx ON work_item_comments (workspace_id, work_item_id, created_at);
--> statement-breakpoint
-- Every change to an item, in order: created, status, assignee, dates, links… Never edited.
CREATE TABLE work_item_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  work_item_id uuid NOT NULL,
  kind varchar(30) NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  actor_id uuid NOT NULL REFERENCES users (id),
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (workspace_id, work_item_id) REFERENCES work_items (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX work_item_events_item_idx ON work_item_events (workspace_id, work_item_id, at);
--> statement-breakpoint
CREATE FUNCTION work_item_history_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Work history and comments cannot be changed.';
END $$;
--> statement-breakpoint
CREATE TRIGGER work_item_events_frozen BEFORE UPDATE OR DELETE ON work_item_events
FOR EACH ROW EXECUTE FUNCTION work_item_history_immutable();
--> statement-breakpoint
CREATE TRIGGER work_item_comments_frozen BEFORE UPDATE OR DELETE ON work_item_comments
FOR EACH ROW EXECUTE FUNCTION work_item_history_immutable();
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['work_items', 'work_item_links', 'work_item_comments', 'work_item_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON work_items TO wodana_app;
    GRANT SELECT, INSERT, DELETE ON work_item_links TO wodana_app;
    GRANT SELECT, INSERT ON work_item_comments, work_item_events TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('work.assigned', 'in_app', '{{task}} is yours', '{{actor}} gave you {{task}} on {{title}}.', '["title", "clientName", "actor", "task", "due"]'),
  ('work.assigned', 'email', '{{task}} is yours · {{title}}', '{{actor}} gave you {{task}} on {{title}} for {{clientName}}. {{due}}', '["title", "clientName", "actor", "task", "due"]'),
  ('work.commented', 'in_app', '{{actor}} on {{task}}', '{{note}}', '["title", "clientName", "actor", "task", "note"]'),
  ('work.blocked', 'in_app', '{{task}} is blocked', '{{actor}} reported a blocker on {{title}}: {{note}}', '["title", "clientName", "actor", "task", "note"]'),
  ('work.done', 'in_app', '{{task}} is done', '{{actor}} finished {{task}} on {{title}}.', '["title", "clientName", "actor", "task"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
