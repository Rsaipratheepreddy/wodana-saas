CREATE TABLE project_vendor_access (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), project_id uuid NOT NULL,
 order_id varchar(80) NOT NULL, token_hash varchar(64) NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
 revoked_at timestamptz, attempts integer NOT NULL DEFAULT 0, window_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(workspace_id,project_id) REFERENCES delivery_projects(workspace_id,id)
);
-- Capability lookup returns only tenant identity. Tenant records remain under RLS.
GRANT SELECT,INSERT,UPDATE ON project_vendor_access TO wodana_app;
