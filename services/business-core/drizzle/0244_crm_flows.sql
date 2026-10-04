-- Flows as configuration (plan §5a, phase F2).
--   * crm_flows: one row per flow a workspace runs (furniture, design, fit_out, basic, …), chosen by the enquiry
--     type through its `flow` code (crm_taxonomy_options.flow maps to crm_flows.code in the same workspace).
--   * crm_flow_versions: the published, immutable definitions. The definition JSON is configuration (steps, branches,
--     columns); edits publish a new version. Rows are never updated (no UPDATE grant, and a trigger refuses it).
--   * crm_opportunities.flow_version_id: the version a job runs, pinned the first time the job needs its flow.
-- Starter flows are seeded per workspace lazily, inside the tenant transaction, on first read.
-- Runs as the migration owner, so forced RLS is never disabled. Both new tables get forced RLS and the
-- tenant_isolation policy. Idempotent.
CREATE TABLE IF NOT EXISTS crm_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  code varchar(40) NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name varchar(120) NOT NULL CHECK (length(trim(name)) > 0),
  status varchar(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, code),
  UNIQUE (workspace_id, id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_flow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  flow_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  source varchar(10) NOT NULL DEFAULT 'published' CHECK (source IN ('starter', 'published')),
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES users (id),
  UNIQUE (workspace_id, flow_id, version),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, flow_id) REFERENCES crm_flows (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_flow_versions_latest_idx ON crm_flow_versions (workspace_id, flow_id, version DESC);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION crm_flow_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A published flow version cannot be changed; publish a new version';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS crm_flow_versions_immutable ON crm_flow_versions;
--> statement-breakpoint
CREATE TRIGGER crm_flow_versions_immutable BEFORE UPDATE ON crm_flow_versions FOR EACH ROW EXECUTE FUNCTION crm_flow_versions_immutable();
--> statement-breakpoint
DROP TRIGGER IF EXISTS set_updated_at ON crm_flows;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON crm_flows FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['crm_flows', 'crm_flow_versions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = target AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, target);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON crm_flows TO wodana_app;
    -- Versions are append-only: no UPDATE or DELETE for the app role.
    GRANT SELECT, INSERT ON crm_flow_versions TO wodana_app;
    GRANT EXECUTE ON FUNCTION crm_flow_versions_immutable() TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE crm_opportunities ADD COLUMN IF NOT EXISTS flow_version_id uuid;
--> statement-breakpoint
ALTER TABLE crm_opportunities DROP CONSTRAINT IF EXISTS crm_opportunities_flow_version_fkey;
--> statement-breakpoint
ALTER TABLE crm_opportunities ADD CONSTRAINT crm_opportunities_flow_version_fkey
  FOREIGN KEY (workspace_id, flow_version_id) REFERENCES crm_flow_versions (workspace_id, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_opportunities_flow_version_idx ON crm_opportunities (workspace_id, flow_version_id) WHERE flow_version_id IS NOT NULL;
--> statement-breakpoint
-- An enquiry type may point at any flow the workspace has, not only the four starters.
ALTER TABLE crm_taxonomy_options ALTER COLUMN flow TYPE varchar(40);
--> statement-breakpoint
ALTER TABLE crm_taxonomy_options DROP CONSTRAINT IF EXISTS crm_taxonomy_options_flow_check;
--> statement-breakpoint
ALTER TABLE crm_taxonomy_options ADD CONSTRAINT crm_taxonomy_options_flow_check CHECK (flow IS NULL OR flow ~ '^[a-z][a-z0-9_]{1,39}$');
