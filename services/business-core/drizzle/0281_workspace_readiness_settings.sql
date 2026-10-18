-- Item readiness (catalogue and project): the firm's choice of which readiness columns it shows and counts, and which
-- catalogue attributes (an imported product sheet's "Materials needed", "Trades required", "Hours needed" columns)
-- count as an item's materials and its trades and hours. Configuration only: every cell is worked out from the
-- records when read, nothing is copied.
--   * workspace_readiness_settings: one row per workspace, version-checked; the last request id and hash make a
--     replayed save return the same result instead of changing anything twice. No row: every column, attributes
--     guessed from their names.
-- Forced RLS with tenant_isolation; never disables RLS. Idempotent.
CREATE TABLE IF NOT EXISTS workspace_readiness_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  columns text[] NOT NULL CHECK (cardinality(columns) BETWEEN 1 AND 20
    AND columns <@ ARRAY['picture', 'size', 'price', 'drawing', 'materials', 'labour', 'selection', 'purchase', 'production', 'delivery']::text[]),
  material_attributes text[] NOT NULL DEFAULT '{}' CHECK (cardinality(material_attributes) <= 50),
  labour_attributes text[] NOT NULL DEFAULT '{}' CHECK (cardinality(labour_attributes) <= 50),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  last_request_id uuid,
  last_request_hash char(64),
  updated_by uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE workspace_readiness_settings ENABLE ROW LEVEL SECURITY;
  ALTER TABLE workspace_readiness_settings FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'workspace_readiness_settings' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON workspace_readiness_settings
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    -- Settings are changed, never deleted.
    GRANT SELECT, INSERT, UPDATE ON workspace_readiness_settings TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- Configuration: a go-live reset keeps it.
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('workspace_readiness_settings', 'keep', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
