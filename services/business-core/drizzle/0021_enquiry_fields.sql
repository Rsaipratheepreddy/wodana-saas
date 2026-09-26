-- Enquiry fields: the fixed fields an enquiry always has, plus the workspace's own custom fields
-- (crm_custom_field_definitions, entity 'enquiry'). Each can be shown or hidden across the
-- enquiry list, record and capture forms; hiding never deletes stored values.
ALTER TABLE crm_custom_field_definitions
  ADD COLUMN visible boolean NOT NULL DEFAULT true,
  ADD COLUMN position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 10000);
--> statement-breakpoint
CREATE TABLE crm_enquiry_field_settings (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  field_key varchar(40) NOT NULL CHECK (field_key IN ('email', 'customerType', 'area', 'budgetRange', 'summary')),
  visible boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, field_key)
);
--> statement-breakpoint
ALTER TABLE crm_enquiry_field_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm_enquiry_field_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON crm_enquiry_field_settings
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm_enquiry_field_settings TO wodana_app;
  END IF;
END $$;
