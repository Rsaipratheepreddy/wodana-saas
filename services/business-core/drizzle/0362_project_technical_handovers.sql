-- The technical handover pack (PLM-165).
--
-- 1. project_technical_handovers: one record per project. Sales or design hands the pack over (who, when, a note); the
--    technical team accepts it (who, when). The pack's lines and their missing-information checklist are read live from
--    the project's records (item readiness, drawing needs, recipes and factory requirements), never stored here.
-- 2. project_technical_handover_waivers: a checklist item marked "Not applicable" on one line, with the reason, who and
--    when. A waived item no longer counts as missing.
-- Both are business records of the project: workspace-scoped, forced RLS, tenant_isolation. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS project_technical_handovers (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'handed_over', 'accepted')),
  handed_over_by uuid REFERENCES users (id),
  handed_over_at timestamptz,
  handed_over_note varchar(2000) NOT NULL DEFAULT '',
  accepted_by uuid REFERENCES users (id),
  accepted_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE,
  CHECK ((status <> 'draft') = (handed_over_at IS NOT NULL)),
  CHECK ((status = 'accepted') = (accepted_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_technical_handover_waivers (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  boq_line_id uuid NOT NULL,
  item varchar(30) NOT NULL CHECK (item ~ '^[a-z][a-z0-9_]{0,29}$'),
  reason varchar(500) NOT NULL CHECK (length(btrim(reason)) > 0),
  set_by uuid NOT NULL REFERENCES users (id),
  set_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, boq_line_id, item),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, boq_line_id) REFERENCES project_boq_lines (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_technical_handover_waivers_project_idx ON project_technical_handover_waivers (workspace_id, project_id);
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['project_technical_handovers', 'project_technical_handover_waivers'] LOOP
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
  ('project_technical_handovers', 'clear', NULL, '{}'),
  ('project_technical_handover_waivers', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
