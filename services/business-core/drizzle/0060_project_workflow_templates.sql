CREATE TABLE project_workflow_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code varchar(64) NOT NULL,
  name varchar(120) NOT NULL,
  description varchar(1000) NOT NULL DEFAULT '',
  status varchar(16) NOT NULL DEFAULT 'active',
  is_default boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  stages jsonb NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_workflow_templates_workspace_id UNIQUE(workspace_id,id),
  CONSTRAINT project_workflow_templates_code_check
    CHECK(code ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT project_workflow_templates_name_check
    CHECK(length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT project_workflow_templates_status_check
    CHECK(status IN ('active','archived')),
  CONSTRAINT project_workflow_templates_version_check CHECK(version > 0),
  CONSTRAINT project_workflow_templates_stages_check CHECK(
    jsonb_typeof(stages) = 'array'
    AND jsonb_array_length(stages) BETWEEN 2 AND 12
  ),
  CONSTRAINT project_workflow_templates_default_check
    CHECK(status = 'active' OR is_default = false)
);
--> statement-breakpoint
CREATE UNIQUE INDEX project_workflow_templates_active_code_uidx
  ON project_workflow_templates(workspace_id,code)
  WHERE status = 'active';
CREATE UNIQUE INDEX project_workflow_templates_default_uidx
  ON project_workflow_templates(workspace_id)
  WHERE status = 'active' AND is_default;
CREATE INDEX project_workflow_templates_list_idx
  ON project_workflow_templates(workspace_id,status,is_default DESC,name);
--> statement-breakpoint
ALTER TABLE project_workflow_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_workflow_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON project_workflow_templates
  USING(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON project_workflow_templates
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON project_workflow_templates TO wodana_app;
  END IF;
END $$;
