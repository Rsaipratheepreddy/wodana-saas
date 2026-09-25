-- P01.1: stable navigation identity only. Business facts remain in their source tables.
-- No source rows are changed and no automatic backfill runs in this migration.
CREATE TABLE job_reference_counters (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  last_number bigint NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE job_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  reference varchar(32) NOT NULL,
  root_type varchar(20) NOT NULL CHECK (root_type IN ('enquiry', 'opportunity')),
  root_id uuid NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, reference),
  UNIQUE (workspace_id, root_type, root_id),
  CHECK (reference ~ '^J-[0-9]{6,}$')
);

CREATE TABLE job_identity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  job_id uuid NOT NULL,
  record_type varchar(20) NOT NULL CHECK (record_type IN ('enquiry', 'lead', 'opportunity', 'case', 'quote', 'project')),
  record_id varchar(160) NOT NULL CHECK (length(record_id) > 0),
  case_id uuid,
  source_key text GENERATED ALWAYS AS (
    record_type || ':' || CASE WHEN record_type = 'quote' THEN case_id::text || ':' ELSE '' END || record_id
  ) STORED,
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'detached')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  attached_at timestamptz NOT NULL DEFAULT now(),
  detached_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, source_key),
  FOREIGN KEY (workspace_id, job_id) REFERENCES job_identities(workspace_id, id) ON DELETE CASCADE,
  CHECK ((record_type = 'quote' AND case_id IS NOT NULL) OR (record_type <> 'quote' AND case_id IS NULL)),
  CHECK ((status = 'active' AND detached_at IS NULL) OR (status = 'detached' AND detached_at IS NOT NULL))
);
CREATE INDEX job_identity_links_job_idx ON job_identity_links(workspace_id, job_id, attached_at, id) WHERE status = 'active';

CREATE TABLE job_identity_link_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  link_id uuid NOT NULL,
  job_id uuid NOT NULL,
  event_type varchar(16) NOT NULL CHECK (event_type IN ('attached', 'detached', 'reattached')),
  link_version integer NOT NULL CHECK (link_version > 0),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason varchar(80) NOT NULL,
  request_key varchar(160),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, link_id) REFERENCES job_identity_links(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, job_id) REFERENCES job_identities(workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, link_id, link_version)
);
CREATE INDEX job_identity_link_events_job_idx ON job_identity_link_events(workspace_id, job_id, occurred_at, id);

ALTER TABLE job_reference_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_reference_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON job_reference_counters
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
ALTER TABLE job_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_identities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON job_identities
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
ALTER TABLE job_identity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_identity_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON job_identity_links
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
ALTER TABLE job_identity_link_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_identity_link_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON job_identity_link_events
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    -- Earlier CRM migrations enable RLS but a fresh install may not yet have
    -- these runtime grants. The adapter needs read-only source traversal.
    GRANT SELECT ON workspace_memberships, crm_enquiries, crm_leads, crm_opportunities,
      crm_parties, project_assignments TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON job_reference_counters TO wodana_app;
    GRANT SELECT, INSERT ON job_identities TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON job_identity_links TO wodana_app;
    GRANT SELECT, INSERT ON job_identity_link_events TO wodana_app;
  END IF;
END $$;

INSERT INTO permissions(code,description)
VALUES('jobs.repair','Review and restore a missing or detached Job source link')
ON CONFLICT(code) DO NOTHING;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
INSERT INTO role_permissions(workspace_id,role_id,permission_id)
SELECT role.workspace_id,role.id,permission.id
FROM roles role CROSS JOIN permissions permission
WHERE role.is_system=true AND role.code IN ('owner','administrator') AND permission.code='jobs.repair'
ON CONFLICT(role_id,permission_id) DO NOTHING;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
