-- P2 enquiry (plan §6.5a). Three pieces of configuration and truth, all tenant tables with forced RLS:
--   * crm_lead_team (PLM-100): the team tagged on an enquiry, one row per role: a member, or "not applicable" for
--     this enquiry type. Carried into the opportunity on conversion. Which roles a type asks for comes from its steps.
--   * crm_enquiry_requirements (PLM-096): the fields an enquiry type requires, and from which gate on:
--     create < convert < book_intro; 'never' records that the firm switched a product default off. A type with no
--     rows uses the product defaults (today's rules); its first save stores the whole set for that type.
--   * workspace_sales_settings.internal_notes_visibility (PLM-024): who reads an enquiry's internal notes,
--     the enquiry team (default) or everyone with Sales access. Never the portal.
-- Runs as the migration owner, so forced RLS is never disabled. Idempotent.
CREATE TABLE IF NOT EXISTS crm_lead_team (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm_leads (id) ON DELETE CASCADE,
  role_code varchar(40) NOT NULL,
  membership_id uuid REFERENCES workspace_memberships (id),
  not_applicable boolean NOT NULL DEFAULT false,
  set_by uuid,
  set_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (workspace_id, lead_id, role_code),
  CONSTRAINT crm_lead_team_choice_check CHECK ((membership_id IS NOT NULL) <> not_applicable)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_lead_team_member_idx ON crm_lead_team (workspace_id, membership_id) WHERE membership_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_enquiry_requirements (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  enquiry_type varchar(100) NOT NULL,
  field_key varchar(80) NOT NULL,
  required_at varchar(20) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, enquiry_type, field_key),
  CONSTRAINT crm_enquiry_requirements_when_check CHECK (required_at IN ('create', 'convert', 'book_intro', 'never'))
);
--> statement-breakpoint
ALTER TABLE workspace_sales_settings ADD COLUMN IF NOT EXISTS internal_notes_visibility varchar(20) NOT NULL DEFAULT 'team';
--> statement-breakpoint
ALTER TABLE workspace_sales_settings DROP CONSTRAINT IF EXISTS workspace_sales_settings_notes_visibility_check;
--> statement-breakpoint
ALTER TABLE workspace_sales_settings ADD CONSTRAINT workspace_sales_settings_notes_visibility_check CHECK (internal_notes_visibility IN ('team', 'sales'));
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['crm_lead_team', 'crm_enquiry_requirements'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = table_name AND policyname = 'tenant_isolation') THEN
      EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$p$, table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wodana_app', table_name);
    END IF;
  END LOOP;
END $$;
