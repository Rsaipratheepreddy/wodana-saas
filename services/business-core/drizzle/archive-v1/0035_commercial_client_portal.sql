CREATE TABLE commercial_payment_templates (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),name varchar(160) NOT NULL,
 version integer NOT NULL DEFAULT 1,milestones jsonb NOT NULL,UNIQUE(workspace_id,name)
);
CREATE TABLE commercial_cases (
 workspace_id uuid NOT NULL REFERENCES workspaces(id), case_id uuid PRIMARY KEY,
 revision integer NOT NULL DEFAULT 0, content jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (workspace_id,case_id) REFERENCES pre_project_cases(workspace_id,id)
);
-- This registry contains only deliberately public branding, never customer or OTP data.
CREATE TABLE client_portal_settings (
 workspace_id uuid PRIMARY KEY REFERENCES workspaces(id), slug varchar(80) NOT NULL UNIQUE,
 enabled boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1, brand jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE client_portal_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
 case_id uuid NOT NULL, name varchar(160) NOT NULL, phone varchar(16) NOT NULL,
 role varchar(16) NOT NULL CHECK(role IN ('viewer','approver')), active boolean NOT NULL DEFAULT true,
 test_contact boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,case_id,phone), FOREIGN KEY(workspace_id,case_id) REFERENCES pre_project_cases(workspace_id,id)
);
CREATE TABLE client_portal_challenges (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), phone varchar(16) NOT NULL,
 purpose varchar(200) NOT NULL, code_hash varchar(64) NOT NULL, attempts integer NOT NULL DEFAULT 0,
 expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_portal_challenge_rate_idx ON client_portal_challenges(workspace_id,phone,created_at DESC);
CREATE TABLE client_portal_sessions (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), phone varchar(16) NOT NULL,
 token_hash varchar(64) NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['commercial_payment_templates','commercial_cases','client_portal_grants','client_portal_challenges','client_portal_sessions'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id=NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid) WITH CHECK (workspace_id=NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid)',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO wodana_app',t);END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN GRANT SELECT,INSERT,UPDATE ON client_portal_settings TO wodana_app; END IF;
END $$;
INSERT INTO permissions(code,description) VALUES
 ('commercial.approve','Approve quotation pricing and verify agreement/payment evidence'),
 ('commercial.release','Authorize commercial execution readiness'),
 ('portal.manage','Manage client portal branding and client access') ON CONFLICT(code) DO NOTHING;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
INSERT INTO role_permissions(workspace_id,role_id,permission_id)
 SELECT r.workspace_id,r.id,p.id FROM roles r CROSS JOIN permissions p
 WHERE r.is_system=true AND r.code IN ('owner','administrator') AND p.code IN ('commercial.approve','commercial.release','portal.manage')
 ON CONFLICT(role_id,permission_id) DO NOTHING;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
