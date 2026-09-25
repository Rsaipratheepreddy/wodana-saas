CREATE TABLE commercial_quotation_templates (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 name varchar(160) NOT NULL,
 version integer NOT NULL DEFAULT 1,
 content jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id, name)
);
ALTER TABLE commercial_quotation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_quotation_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON commercial_quotation_templates
 USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
 WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON commercial_quotation_templates TO wodana_app;
 END IF;
END $$;
