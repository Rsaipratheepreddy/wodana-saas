-- Design stage configuration (PLM-041): each workspace's design package price list and the minimum
-- design deposit that must be received before design work starts. Values are tenant configuration.
CREATE TABLE workspace_design_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  minimum_design_deposit numeric(14, 2) CHECK (minimum_design_deposit IS NULL OR minimum_design_deposit >= 0),
  currency char(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  version integer NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((minimum_design_deposit IS NULL) = (currency IS NULL))
);
--> statement-breakpoint
CREATE TABLE design_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  code varchar(40) NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name varchar(120) NOT NULL CHECK (length(trim(name)) > 0),
  pricing_method varchar(12) NOT NULL CHECK (pricing_method IN ('per_space', 'per_area', 'fixed')),
  rate numeric(14, 2) NOT NULL CHECK (rate >= 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  area_unit varchar(4) CHECK (area_unit IS NULL OR area_unit IN ('sqft', 'sqm')),
  included_revisions integer NOT NULL DEFAULT 2 CHECK (included_revisions BETWEEN 0 AND 20),
  includes_space_planning boolean NOT NULL DEFAULT false,
  includes_renders boolean NOT NULL DEFAULT false,
  required_role_code varchar(60),
  inclusions text CHECK (inclusions IS NULL OR length(inclusions) <= 2000),
  position integer NOT NULL DEFAULT 0,
  status varchar(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, code),
  CHECK ((pricing_method = 'per_area') = (area_unit IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX design_packages_workspace_idx ON design_packages (workspace_id, status, position);
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['workspace_design_settings', 'design_packages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$p$, table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO wodana_app', table_name);
    END IF;
  END LOOP;
END $$;
