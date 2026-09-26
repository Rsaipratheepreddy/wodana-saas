-- Sprints: a project's work planned in short, dated rounds (a week or two). Starting a sprint records
-- what the team committed to; closing it records, for each committed item, whether it was done and,
-- when it wasn't, why — so misses are measured, not forgotten. Subtasks travel with their task.
CREATE TABLE work_sprints (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  goal varchar(500) NOT NULL DEFAULT '',
  start_date date NOT NULL,
  end_date date NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'closed')),
  started_at timestamptz,
  started_by uuid REFERENCES users (id),
  closed_at timestamptz,
  closed_by uuid REFERENCES users (id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_id, number),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  CHECK (end_date >= start_date),
  CHECK ((status = 'planned') = (started_at IS NULL)),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX work_sprints_one_active ON work_sprints (workspace_id, project_id) WHERE status = 'active';
--> statement-breakpoint
ALTER TABLE work_items ADD COLUMN sprint_id uuid;
--> statement-breakpoint
ALTER TABLE work_items ADD CONSTRAINT work_items_sprint_fk FOREIGN KEY (workspace_id, sprint_id) REFERENCES work_sprints (workspace_id, id);
--> statement-breakpoint
CREATE INDEX work_items_sprint_idx ON work_items (workspace_id, sprint_id) WHERE sprint_id IS NOT NULL;
--> statement-breakpoint
-- What was committed when the sprint started, and how each commitment ended.
CREATE TABLE work_sprint_commitments (
  workspace_id uuid NOT NULL,
  sprint_id uuid NOT NULL,
  item_id uuid NOT NULL,
  outcome varchar(10) NOT NULL DEFAULT 'open' CHECK (outcome IN ('open', 'done', 'missed', 'removed')),
  reason varchar(20) CHECK (reason IN ('blocked', 'waiting_on_client', 'materials_late', 'underestimated', 'people_unavailable', 'reprioritised', 'other')),
  note varchar(500) NOT NULL DEFAULT '',
  decided_at timestamptz,
  PRIMARY KEY (workspace_id, sprint_id, item_id),
  FOREIGN KEY (workspace_id, sprint_id) REFERENCES work_sprints (workspace_id, id),
  FOREIGN KEY (workspace_id, item_id) REFERENCES work_items (workspace_id, id),
  CHECK ((outcome = 'missed') = (reason IS NOT NULL))
);
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['work_sprints', 'work_sprint_commitments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON work_sprints TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON work_sprint_commitments TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, 'in_app', 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('work.sprint_started', '{{task}} started on {{title}}', '{{actor}} started it: {{note}}', '["title", "clientName", "actor", "task", "note"]'),
  ('work.sprint_closed', '{{task}} closed on {{title}}', '{{note}}', '["title", "clientName", "actor", "task", "note"]')
) AS template (code, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
