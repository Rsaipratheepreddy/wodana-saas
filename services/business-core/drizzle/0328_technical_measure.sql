-- PLM-149: the technical site measure before shop drawings, and the designer's check that the drawings match the design.
--
-- 1. project_technical_measures: a project's technical site measure (a new measure after the project manager is
--    named, not the design site visit): the day, notes, who recorded it. Measured again, the latest one counts and
--    the earlier ones stay as history.
-- 2. project_technical_measure_lines: the final site dimensions, one line each (where, what, the value and its unit;
--    the same length units as the pre-project measurement model, with the value in metres for comparison).
-- 3. project_technical_measure_files: the measure's photos and PDFs.
-- 4. project_drawing_revisions.check_kind: which internal check a revision passed before it went to the client:
--    the site check (the technical team, PLM-058) or the design check (the lead designer, PLM-149). Revisions that
--    already hold a site check are marked 'site', so they read as before.
-- 5. workspace_project_settings: the project role whose holder checks the drawings match the design, sends them to
--    the client and records the client's approval (null: the project manager, as before); and the working days
--    the technical measure is due in once its task opens (null: no due date).
-- 6. The go-live reset clears the new records (the files with their stored objects).
-- Workspace-scoped, forced RLS, tenant_isolation. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS project_technical_measures (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  measured_on date NOT NULL,
  note varchar(4000) NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_technical_measures_project_idx ON project_technical_measures (workspace_id, project_id, measured_on DESC, created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_technical_measure_lines (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  measure_id uuid NOT NULL,
  position smallint NOT NULL CHECK (position >= 0 AND position < 200),
  area varchar(120) NOT NULL DEFAULT '',
  label varchar(120) NOT NULL CHECK (length(btrim(label)) > 0),
  value numeric(12, 4) NOT NULL CHECK (value > 0),
  unit varchar(4) NOT NULL CHECK (unit IN ('mm', 'cm', 'm', 'in', 'ft')),
  value_metres numeric(18, 6) NOT NULL CHECK (value_metres > 0),
  PRIMARY KEY (workspace_id, measure_id, position),
  FOREIGN KEY (workspace_id, measure_id) REFERENCES project_technical_measures (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_technical_measure_files (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  measure_id uuid NOT NULL,
  original_name varchar(255) NOT NULL DEFAULT '',
  mime_type varchar(100) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  object_key varchar(500) NOT NULL,
  preview_key varchar(500),
  sha256 char(64) NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, measure_id) REFERENCES project_technical_measures (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_technical_measure_files_measure_idx ON project_technical_measure_files (workspace_id, measure_id, created_at);
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['project_technical_measures', 'project_technical_measure_lines', 'project_technical_measure_files'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = name AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    -- A measure is recorded once (measured again, a new one is added); its files are only added.
    GRANT SELECT, INSERT ON project_technical_measures, project_technical_measure_lines, project_technical_measure_files TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE project_drawing_revisions ADD COLUMN IF NOT EXISTS check_kind varchar(10);
--> statement-breakpoint
UPDATE project_drawing_revisions SET check_kind = 'site' WHERE site_check IS NOT NULL AND check_kind IS NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_drawing_revisions_check_kind_check') THEN
    -- A check recorded without its kind (by an older release) reads as a site check.
    ALTER TABLE project_drawing_revisions ADD CONSTRAINT project_drawing_revisions_check_kind_check
      CHECK (check_kind IS NULL OR (check_kind IN ('site', 'design') AND site_check IS NOT NULL));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE workspace_project_settings
  ADD COLUMN IF NOT EXISTS drawings_client_role varchar(64),
  ADD COLUMN IF NOT EXISTS technical_measure_days smallint;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_project_settings_drawings_client_role_check') THEN
    ALTER TABLE workspace_project_settings ADD CONSTRAINT workspace_project_settings_drawings_client_role_check
      CHECK (drawings_client_role IS NULL OR drawings_client_role ~ '^[a-z][a-z0-9_]{0,63}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_project_settings_technical_measure_days_check') THEN
    ALTER TABLE workspace_project_settings ADD CONSTRAINT workspace_project_settings_technical_measure_days_check
      CHECK (technical_measure_days IS NULL OR technical_measure_days BETWEEN 1 AND 60);
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('project_technical_measures', 'clear', NULL, '{}'),
  ('project_technical_measure_lines', 'clear', NULL, '{}'),
  ('project_technical_measure_files', 'clear', NULL, ARRAY['object_key', 'preview_key'])
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
