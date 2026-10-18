CREATE TABLE pre_project_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  opportunity_id uuid NOT NULL REFERENCES crm_opportunities(id),
  status varchar(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'archived')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, opportunity_id)
);
CREATE INDEX pre_project_cases_workspace_updated_idx ON pre_project_cases(workspace_id, updated_at DESC, id DESC);
--> statement-breakpoint
-- Keep cross-workspace source links impossible, even outside the service.
CREATE FUNCTION guard_pre_project_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM crm_opportunities WHERE id = NEW.opportunity_id AND workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'Pre-project opportunity must belong to the same workspace';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pre_project_source_guard BEFORE INSERT OR UPDATE ON pre_project_cases
FOR EACH ROW EXECUTE FUNCTION guard_pre_project_source();
ALTER TABLE pre_project_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_project_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pre_project_cases
USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
INSERT INTO permissions(code, description) VALUES
 ('pre_projects.view', 'View pre-project cases and their linked CRM context'),
 ('pre_projects.create', 'Start a pre-project from an existing CRM opportunity')
ON CONFLICT (code) DO NOTHING;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
INSERT INTO role_permissions(workspace_id, role_id, permission_id)
SELECT r.workspace_id, r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.is_system = true AND r.code IN ('owner', 'administrator') AND p.code IN ('pre_projects.view', 'pre_projects.create')
ON CONFLICT (role_id, permission_id) DO NOTHING;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
   GRANT SELECT, INSERT, UPDATE, DELETE ON pre_project_cases TO wodana_app;
 END IF;
END $$;
