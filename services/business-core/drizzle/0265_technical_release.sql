-- Technical drawings to production release (PLM-056 … PLM-062, PLM-068). All of it is driven by the project's
-- route: a stage that holds the drawing checks or the factory slot check turns these records on.
--
-- 1. project_drawing_revisions: the project's technical drawings, one revision at a time. A revision is uploaded,
--    checked on site (OK, or changes needed), sent to the client, and approved or sent back. Each step keeps who
--    and when; the client's decision keeps the day, the client's name and how it came (recorded by the team with
--    the signed file, or decided in the client portal). Only the latest revision counts.
-- 2. project_drawing_files: the drawing files of a revision, and the signed approval the team records.
-- 3. delivery_projects.factory_slot_*: the factory slot booked for the project (the day, a note, who and when).
-- 4. work_items.stage_check: the stage check a task was opened for, so a stage's record-driven tasks are opened
--    once each and closed by the record (drawings uploaded, the site check, the client's approval, the slot).
-- 5. The notice templates for every workspace.
-- Workspace-scoped, forced RLS, tenant_isolation. Nothing is backfilled. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS project_drawing_revisions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  status varchar(20) NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'checked', 'changes_needed', 'sent', 'approved', 'changes_requested')),
  note varchar(2000) NOT NULL DEFAULT '',
  site_check varchar(10) CHECK (site_check IS NULL OR site_check IN ('ok', 'changes')),
  site_check_note varchar(1000) NOT NULL DEFAULT '',
  site_checked_by uuid REFERENCES users (id),
  site_checked_at timestamptz,
  sent_by uuid REFERENCES users (id),
  sent_at timestamptz,
  decided_on date,
  decided_by_name varchar(200),
  decision_note varchar(1000) NOT NULL DEFAULT '',
  decision_via varchar(10) CHECK (decision_via IS NULL OR decision_via IN ('recorded', 'portal')),
  decision_recorded_by uuid REFERENCES users (id),
  decision_grant_id uuid,
  decided_at timestamptz,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_id, number),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE,
  CHECK ((site_check IS NULL) = (site_checked_at IS NULL)),
  CHECK ((status IN ('approved', 'changes_requested')) = (decided_at IS NOT NULL)),
  CHECK (decided_at IS NULL OR (decided_on IS NOT NULL AND decision_via IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_drawing_files (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  kind varchar(10) NOT NULL CHECK (kind IN ('drawing', 'approval')),
  original_name varchar(255) NOT NULL DEFAULT '',
  mime_type varchar(100) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  object_key varchar(500) NOT NULL,
  preview_key varchar(500),
  sha256 char(64) NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, revision_id) REFERENCES project_drawing_revisions (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_drawing_files_revision_idx ON project_drawing_files (workspace_id, revision_id, kind);
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['project_drawing_revisions', 'project_drawing_files'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = name AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON project_drawing_revisions TO wodana_app;
    GRANT SELECT, INSERT ON project_drawing_files TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE delivery_projects
  ADD COLUMN IF NOT EXISTS factory_slot_on date,
  ADD COLUMN IF NOT EXISTS factory_slot_note varchar(500) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS factory_slot_by uuid REFERENCES users (id),
  ADD COLUMN IF NOT EXISTS factory_slot_at timestamptz;
--> statement-breakpoint
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS stage_check varchar(64) CHECK (stage_check IS NULL OR stage_check ~ '^[a-z][a-z0-9_]{0,63}$');
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS work_items_stage_check_idx ON work_items (workspace_id, stage_id, stage_check) WHERE stage_check IS NOT NULL;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('project.ready_to_start', 'in_app', 'Ready to start · {{title}}', '{{actor}} approved the deal. Name the project manager and start the project.', '["title","clientName","actor","note"]'),
  ('project.ready_to_start', 'email', 'Ready to start: {{title}}', E'{{actor}} approved the deal for {{clientName}}.\n\nName the project manager and start the project.', '["title","clientName","actor","note"]'),
  ('project.drawings_changes', 'in_app', 'Drawings {{revision}} need changes · {{title}}', '{{actor}}: {{note}}', '["title","clientName","actor","revision","note","date"]'),
  ('project.drawings_approved', 'in_app', 'Drawings approved · {{title}}', '{{clientName}} approved drawings {{revision}} on {{date}}. The drawings, material list and BOQ are in the project.', '["title","clientName","actor","revision","note","date"]'),
  ('project.drawings_approved', 'email', 'Drawings approved: {{title}}', E'{{clientName}} approved drawings {{revision}} on {{date}}.\n\nThe approved drawings, the material list and the BOQ are in the project, read-only.', '["title","clientName","actor","revision","note","date"]'),
  ('project.factory_slot_due', 'in_app', 'Book the factory slot · {{title}}', 'The deposit is in and the project is released. Record the slot date on the project.', '["title","clientName","actor","revision","note","date"]'),
  ('project.factory_slot_due', 'email', 'Book the factory slot: {{title}}', E'The deposit for {{clientName}} is in and the project is released.\n\nBook the factory slot and record its date on the project.', '["title","clientName","actor","revision","note","date"]'),
  ('project.factory_slot_booked', 'in_app', 'Factory slot booked · {{title}}', '{{actor}} booked the factory for {{date}}.', '["title","clientName","actor","revision","note","date"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
