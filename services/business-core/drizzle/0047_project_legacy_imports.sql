CREATE TABLE project_legacy_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),project_id uuid NOT NULL,
 source_org uuid NOT NULL,source_project uuid NOT NULL,source_hash varchar(64) NOT NULL,imported_by uuid NOT NULL,
 content jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(workspace_id,source_org,source_project),
 FOREIGN KEY(workspace_id,project_id) REFERENCES delivery_projects(workspace_id,id)
);
ALTER TABLE project_legacy_imports ENABLE ROW LEVEL SECURITY;ALTER TABLE project_legacy_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_legacy_imports USING(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid) WITH CHECK(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN GRANT SELECT,INSERT ON project_legacy_imports TO wodana_app; END IF; END $$;
