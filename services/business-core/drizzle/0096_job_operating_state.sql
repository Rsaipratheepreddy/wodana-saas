-- P01.2: a Job stage is the only operator-owned Job fact. Phase, flags and
-- Next Action remain read projections from the authoritative source domains.
CREATE TABLE job_manual_stages (
  workspace_id uuid NOT NULL,
  job_id uuid NOT NULL,
  phase varchar(32) NOT NULL,
  stage varchar(120) NOT NULL,
  reason varchar(500) NOT NULL,
  set_by uuid NOT NULL REFERENCES users(id),
  set_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (workspace_id, job_id),
  FOREIGN KEY (workspace_id, job_id)
    REFERENCES job_identities(workspace_id, id) ON DELETE CASCADE,
  CHECK (phase IN ('intake','qualify','discover','design_scope','price','agree','release','deliver','handover','aftercare')),
  CHECK (length(trim(stage)) > 0),
  CHECK (length(trim(reason)) >= 8)
);

CREATE TABLE job_manual_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  job_id uuid NOT NULL,
  request_id uuid NOT NULL,
  request_hash char(64) NOT NULL,
  stage_version integer NOT NULL CHECK (stage_version > 0),
  phase varchar(32) NOT NULL,
  stage varchar(120) NOT NULL,
  reason varchar(500) NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, job_id)
    REFERENCES job_identities(workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, request_id),
  UNIQUE (workspace_id, job_id, stage_version),
  CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CHECK (phase IN ('intake','qualify','discover','design_scope','price','agree','release','deliver','handover','aftercare')),
  CHECK (length(trim(stage)) > 0),
  CHECK (length(trim(reason)) >= 8)
);
CREATE INDEX job_manual_stage_events_job_idx
  ON job_manual_stage_events(workspace_id, job_id, occurred_at, id);

ALTER TABLE job_manual_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_manual_stages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON job_manual_stages
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
ALTER TABLE job_manual_stage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_manual_stage_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON job_manual_stage_events
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON job_manual_stages TO wodana_app;
    GRANT SELECT, INSERT ON job_manual_stage_events TO wodana_app;
    GRANT SELECT ON audit_events TO wodana_app;
  END IF;
END $$;

INSERT INTO permissions(code,description)
VALUES('jobs.stage.manage','Set an audited operating stage within the Job derived phase')
ON CONFLICT(code) DO NOTHING;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
INSERT INTO role_permissions(workspace_id,role_id,permission_id)
SELECT role.workspace_id,role.id,permission.id
FROM roles role CROSS JOIN permissions permission
WHERE role.is_system=true
  AND role.code IN ('owner','administrator')
  AND permission.code='jobs.stage.manage'
ON CONFLICT(role_id,permission_id) DO NOTHING;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
