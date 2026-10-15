-- Factory requirements per custom BOQ line (PLM-166).
--
-- A bespoke or made-to-order line without a verified catalogue recipe gets its own requirement record: the materials
-- and quantities by kind, the labour hours and notes, written by the factory or the project team and confirmed by the
-- Factory Lead (who and when). Editing a confirmed record reopens it. One record per line; its items are rows.
-- Both tables are business records of the project: workspace-scoped, forced RLS, tenant_isolation. Idempotent; never
-- disables RLS.
CREATE TABLE IF NOT EXISTS project_factory_requirements (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  boq_line_id uuid NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed')),
  labour_hours numeric(18, 4) CHECK (labour_hours IS NULL OR labour_hours >= 0),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  confirmed_by uuid REFERENCES users (id),
  confirmed_at timestamptz,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, boq_line_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, boq_line_id) REFERENCES project_boq_lines (workspace_id, id) ON DELETE CASCADE,
  CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_factory_requirement_items (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  requirement_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  component_type varchar(10) NOT NULL CHECK (component_type IN ('board', 'fabric', 'foam', 'hardware', 'other')),
  name varchar(300) NOT NULL CHECK (length(btrim(name)) > 0),
  quantity numeric(18, 4) NOT NULL CHECK (quantity >= 0),
  unit varchar(40) NOT NULL DEFAULT '',
  catalog_item_id uuid,
  note varchar(500) NOT NULL DEFAULT '',
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, requirement_id) REFERENCES project_factory_requirements (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, catalog_item_id) REFERENCES catalog_items (workspace_id, id) ON DELETE SET NULL (catalog_item_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_factory_requirements_project_idx ON project_factory_requirements (workspace_id, project_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_factory_requirement_items_requirement_idx ON project_factory_requirement_items (workspace_id, requirement_id, position);
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['project_factory_requirements', 'project_factory_requirement_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = table_name AND policyname = 'tenant_isolation') THEN
      EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$p$, table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wodana_app', table_name);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('project_factory_requirements', 'clear', NULL, '{}'),
  ('project_factory_requirement_items', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
