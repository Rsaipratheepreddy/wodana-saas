-- §0.3 P3 (the firm's own answer, not code): the commission types a deal file offers (e.g. sales, designer fee,
-- referral), named and ordered by the firm. With no rows the kit's three apply. A type in use is kept by retiring it.
-- Workspace-scoped, forced RLS, tenant_isolation. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS setup_commission_types (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  code varchar(40) NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  label varchar(60) NOT NULL CHECK (length(trim(label)) > 0),
  position integer NOT NULL CHECK (position >= 0),
  active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, code)
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE setup_commission_types ENABLE ROW LEVEL SECURITY;
  ALTER TABLE setup_commission_types FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'setup_commission_types' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON setup_commission_types
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON setup_commission_types TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES ('setup_commission_types', 'keep', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition, clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
