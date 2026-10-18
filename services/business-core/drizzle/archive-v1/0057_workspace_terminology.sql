CREATE TABLE workspace_terminology (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key varchar(64) NOT NULL,
  visible_name varchar(60) NOT NULL,
  visible_name_plural varchar(60) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_terminology_pk PRIMARY KEY (workspace_id, key),
  CONSTRAINT workspace_terminology_key_check CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT workspace_terminology_visible_name_check CHECK (
    length(btrim(visible_name)) BETWEEN 1 AND 60
    AND length(btrim(visible_name_plural)) BETWEEN 1 AND 60
  ),
  CONSTRAINT workspace_terminology_version_check CHECK (version > 0)
);
--> statement-breakpoint
ALTER TABLE workspace_terminology ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_terminology FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_terminology
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX workspace_terminology_updated_idx ON workspace_terminology(workspace_id, updated_at DESC);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_terminology TO wodana_app;
  END IF;
END $$;
