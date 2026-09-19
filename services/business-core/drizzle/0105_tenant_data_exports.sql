CREATE TABLE tenant_data_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE cascade,
  operation_id uuid NOT NULL UNIQUE REFERENCES tenant_operation_runs(id) ON DELETE cascade,
  object_key text NOT NULL,
  sha256 char(64) NOT NULL,
  byte_size bigint NOT NULL,
  table_count integer NOT NULL,
  record_count integer NOT NULL,
  file_count integer NOT NULL,
  file_bytes bigint NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'verified',
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE restrict,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  downloaded_at timestamptz,
  CONSTRAINT tenant_data_exports_hash_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tenant_data_exports_size_check CHECK (byte_size >= 0 AND table_count >= 0 AND record_count >= 0 AND file_count >= 0 AND file_bytes >= 0),
  CONSTRAINT tenant_data_exports_status_check CHECK (status IN ('verified','expired','removed'))
);
CREATE INDEX tenant_data_exports_history_idx ON tenant_data_exports(workspace_id,created_at DESC,id DESC);
--> statement-breakpoint
ALTER TABLE tenant_data_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_data_exports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_data_exports
USING (workspace_id = NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT,INSERT,UPDATE ON tenant_data_exports TO wodana_app;
  END IF;
END $$;
