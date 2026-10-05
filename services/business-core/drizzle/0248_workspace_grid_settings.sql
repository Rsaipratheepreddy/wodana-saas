-- Hide unused columns per firm (plan §0.7 R14): a workspace-level default view for each list.
--   * workspace_grid_settings: one row per (workspace, list), versioned, with the last request id and hash so a
--     replayed save returns the same result instead of changing anything twice.
--   * workspace_grid_hidden_columns: the columns that start hidden for everyone (configuration, never deletion:
--     a person can still show them for themselves, and the data behind them is untouched).
-- Every table has workspace_id, forced RLS and the tenant_isolation policy. Idempotent.
CREATE TABLE IF NOT EXISTS workspace_grid_settings (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  grid_key varchar(80) NOT NULL CHECK (grid_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  last_request_id uuid,
  last_request_hash char(64),
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, grid_key)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workspace_grid_hidden_columns (
  workspace_id uuid NOT NULL,
  grid_key varchar(80) NOT NULL,
  column_id varchar(80) NOT NULL CHECK (column_id ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,79}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, grid_key, column_id),
  FOREIGN KEY (workspace_id, grid_key) REFERENCES workspace_grid_settings (workspace_id, grid_key) ON DELETE CASCADE
);
--> statement-breakpoint
DROP TRIGGER IF EXISTS set_updated_at ON workspace_grid_settings;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON workspace_grid_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['workspace_grid_settings', 'workspace_grid_hidden_columns'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = target AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, target);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    -- A list's default is changed, never deleted; its hidden columns are replaced on each save.
    GRANT SELECT, INSERT, UPDATE ON workspace_grid_settings TO wodana_app;
    GRANT SELECT, INSERT, DELETE ON workspace_grid_hidden_columns TO wodana_app;
  END IF;
END $$;
