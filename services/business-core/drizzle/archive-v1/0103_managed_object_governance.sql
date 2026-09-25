CREATE TABLE workspace_stored_objects (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE cascade,
  object_key text NOT NULL,
  byte_size bigint NOT NULL,
  content_type varchar(160) NOT NULL,
  sha256 char(64),
  status varchar(20) NOT NULL DEFAULT 'pending',
  scanner_status varchar(24) NOT NULL DEFAULT 'pending',
  reservation_expires_at timestamptz,
  retention_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  CONSTRAINT workspace_stored_objects_pk PRIMARY KEY (workspace_id,object_key),
  CONSTRAINT workspace_stored_objects_size_check CHECK (byte_size >= 0),
  CONSTRAINT workspace_stored_objects_status_check CHECK (status IN ('pending','active','failed','removed')),
  CONSTRAINT workspace_stored_objects_scan_check CHECK (scanner_status IN ('pending','baseline_passed','failed')),
  CONSTRAINT workspace_stored_objects_hash_check CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX workspace_stored_objects_usage_idx
  ON workspace_stored_objects(workspace_id,status,reservation_expires_at) WHERE removed_at IS NULL;
--> statement-breakpoint
ALTER TABLE workspace_stored_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_stored_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_stored_objects
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON workspace_stored_objects
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON workspace_stored_objects TO wodana_app;
  END IF;
END $$;
