CREATE TABLE workspace_configuration_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  resource_type varchar(64) NOT NULL,
  resource_id varchar(160) NOT NULL,
  revision_number integer NOT NULL,
  source_version integer NOT NULL,
  action varchar(32) NOT NULL,
  snapshot jsonb NOT NULL,
  source_revision_id uuid REFERENCES workspace_configuration_revisions(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_configuration_revisions_resource_type_check CHECK (
    resource_type IN (
      'workspace_terminology',
      'project_workflow_template',
      'crm_taxonomy',
      'crm_custom_field',
      'crm_qualification_form',
      'quotation_template',
      'payment_template',
      'workspace_team'
    )
  ),
  CONSTRAINT workspace_configuration_revisions_action_check CHECK (
    action IN ('baseline','created','saved','archived','restored_default','rolled_back')
  ),
  CONSTRAINT workspace_configuration_revisions_numbers_check CHECK (
    revision_number > 0 AND source_version >= 0
  ),
  CONSTRAINT workspace_configuration_revisions_snapshot_check CHECK (
    jsonb_typeof(snapshot) = 'object'
  ),
  CONSTRAINT workspace_configuration_revisions_unique UNIQUE (
    workspace_id, resource_type, resource_id, revision_number
  )
);
CREATE INDEX workspace_configuration_revisions_history_idx
  ON workspace_configuration_revisions(workspace_id, resource_type, resource_id, revision_number DESC);
ALTER TABLE workspace_configuration_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_configuration_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_configuration_revisions
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT ON workspace_configuration_revisions TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE commercial_quotation_templates
  ADD COLUMN status varchar(16) NOT NULL DEFAULT 'active',
  ADD CONSTRAINT commercial_quotation_templates_status_check CHECK (status IN ('active','archived'));
ALTER TABLE commercial_payment_templates
  ADD COLUMN status varchar(16) NOT NULL DEFAULT 'active',
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT commercial_payment_templates_status_check CHECK (status IN ('active','archived'));
