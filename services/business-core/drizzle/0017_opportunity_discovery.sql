-- PLM-040: the Account Manager's discovery form on an opportunity. Structured facts that pricing and
-- booking need are columns; the tenant's own intro questions are a qualification form with the
-- "discovery" purpose, answered per opportunity. A pipeline stage can require it (entry_requirements).
ALTER TABLE crm_qualification_forms ADD COLUMN purpose varchar(20) NOT NULL DEFAULT 'qualification'
  CHECK (purpose IN ('qualification', 'discovery'));
--> statement-breakpoint
CREATE TABLE crm_opportunity_discovery (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  area numeric(12, 2) CHECK (area IS NULL OR area > 0),
  area_unit varchar(4) CHECK (area_unit IS NULL OR area_unit IN ('sqft', 'sqm')),
  spaces integer CHECK (spaces IS NULL OR spaces BETWEEN 1 AND 500),
  property_location varchar(240),
  client_email varchar(254),
  floor_plan_asset_id uuid,
  design_package_id uuid,
  design_fee numeric(14, 2) CHECK (design_fee IS NULL OR design_fee >= 0),
  design_fee_currency char(3) CHECK (design_fee_currency IS NULL OR design_fee_currency ~ '^[A-Z]{3}$'),
  version integer NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, opportunity_id),
  FOREIGN KEY (opportunity_id) REFERENCES crm_opportunities (id) ON DELETE CASCADE,
  CHECK ((area IS NULL) = (area_unit IS NULL)),
  CHECK ((design_fee IS NULL) = (design_fee_currency IS NULL))
);
--> statement-breakpoint
CREATE TABLE crm_opportunity_discovery_values (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  question_key varchar(100) NOT NULL,
  value jsonb NOT NULL,
  captured_by uuid,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, opportunity_id, question_key),
  FOREIGN KEY (opportunity_id) REFERENCES crm_opportunities (id) ON DELETE CASCADE
);
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['crm_opportunity_discovery', 'crm_opportunity_discovery_values'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$p$, table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wodana_app', table_name);
    END IF;
  END LOOP;
END $$;
