ALTER TABLE tenant_operation_runs
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT tenant_operation_runs_version_check CHECK (version > 0);
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tenant_operation_runs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT DELETE ON workspace_entitlement_sets TO wodana_app;
    GRANT DELETE ON workspace_data_policies TO wodana_app;
  END IF;
END $$;
