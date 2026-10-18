-- Guide steps 18, 22 and 24 (16 Oct 2026), per item of a project: who drafts its technical drawing (a name from a list,
-- no login needed) and by when; how many people the factory needs on it and who does it (names, no login); and whether
-- it is delivered only, or delivered and installed. One row per item; workspace-scoped, forced RLS, tenant_isolation.
CREATE TABLE IF NOT EXISTS project_item_plans (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  line_id uuid NOT NULL,
  drafter_name varchar(120) NOT NULL DEFAULT '',
  drafter_due_on date,
  persons_needed smallint CHECK (persons_needed IS NULL OR (persons_needed >= 1 AND persons_needed <= 99)),
  crew_names text[] NOT NULL DEFAULT '{}' CHECK (cardinality(crew_names) <= 20),
  delivery_mode varchar(20) NOT NULL DEFAULT 'delivery_install' CHECK (delivery_mode IN ('delivery', 'delivery_install')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, line_id)
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE project_item_plans ENABLE ROW LEVEL SECURITY;
  ALTER TABLE project_item_plans FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project_item_plans' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON project_item_plans
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON project_item_plans TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES ('project_item_plans', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition, clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
