CREATE TABLE pre_project_definition_baselines (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  case_id uuid NOT NULL,
  number integer NOT NULL CHECK(number > 0),
  request_id uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  source_hash char(64) NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'),
  snapshot_hash char(64) NOT NULL CHECK(snapshot_hash ~ '^[0-9a-f]{64}$'),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot) = 'object'),
  message varchar(1000) NOT NULL DEFAULT '',
  supersedes_id uuid,
  published_by uuid NOT NULL REFERENCES users(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pre_project_definition_baselines_case_fk
    FOREIGN KEY(workspace_id,case_id) REFERENCES pre_project_cases(workspace_id,id),
  CONSTRAINT pre_project_definition_baselines_supersedes_fk
    FOREIGN KEY(workspace_id,case_id,supersedes_id)
    REFERENCES pre_project_definition_baselines(workspace_id,case_id,id),
  CONSTRAINT pre_project_definition_baselines_identity UNIQUE(workspace_id,case_id,id),
  CONSTRAINT pre_project_definition_baselines_number UNIQUE(workspace_id,case_id,number),
  CONSTRAINT pre_project_definition_baselines_request UNIQUE(workspace_id,request_id)
);
CREATE INDEX pre_project_definition_baselines_case_idx
  ON pre_project_definition_baselines(workspace_id,case_id,number DESC);

ALTER TABLE client_portal_grants
  ADD CONSTRAINT client_portal_grants_workspace_case_id_key
  UNIQUE(workspace_id,case_id,id);

CREATE TABLE pre_project_definition_decisions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  case_id uuid NOT NULL,
  baseline_id uuid NOT NULL,
  request_id uuid,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  decision varchar(24) NOT NULL CHECK(decision IN ('confirmed','changes_requested')),
  decision_by varchar(240) NOT NULL CHECK(length(btrim(decision_by)) > 0),
  channel varchar(24) NOT NULL CHECK(channel IN ('client_portal','meeting','email','phone','whatsapp','signed_document','other')),
  note text NOT NULL DEFAULT '',
  evidence text NOT NULL CHECK(length(btrim(evidence)) > 0),
  decided_at timestamptz NOT NULL,
  recorded_by uuid REFERENCES users(id),
  client_grant_id uuid,
  challenge_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pre_project_definition_decisions_baseline_fk
    FOREIGN KEY(workspace_id,case_id,baseline_id)
    REFERENCES pre_project_definition_baselines(workspace_id,case_id,id),
  CONSTRAINT pre_project_definition_decisions_grant_fk
    FOREIGN KEY(workspace_id,case_id,client_grant_id)
    REFERENCES client_portal_grants(workspace_id,case_id,id),
  CONSTRAINT pre_project_definition_decisions_identity UNIQUE(workspace_id,case_id,id),
  CONSTRAINT pre_project_definition_decisions_one_per_baseline UNIQUE(workspace_id,case_id,baseline_id),
  CONSTRAINT pre_project_definition_decisions_actor CHECK(
    (channel='client_portal' AND request_id IS NULL AND recorded_by IS NULL AND client_grant_id IS NOT NULL AND challenge_id IS NOT NULL)
    OR
    (channel<>'client_portal' AND request_id IS NOT NULL AND recorded_by IS NOT NULL AND client_grant_id IS NULL AND challenge_id IS NULL)
  ),
  CONSTRAINT pre_project_definition_decisions_change_note CHECK(
    decision='confirmed' OR length(btrim(note)) > 0
  )
);
CREATE UNIQUE INDEX pre_project_definition_decisions_challenge_idx
  ON pre_project_definition_decisions(workspace_id,challenge_id)
  WHERE challenge_id IS NOT NULL;
CREATE UNIQUE INDEX pre_project_definition_decisions_request_idx
  ON pre_project_definition_decisions(workspace_id,request_id)
  WHERE request_id IS NOT NULL;
CREATE INDEX pre_project_definition_decisions_case_idx
  ON pre_project_definition_decisions(workspace_id,case_id,decided_at DESC,id);

CREATE TABLE pre_project_definition_commands (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  request_id uuid NOT NULL,
  case_id uuid NOT NULL,
  action varchar(40) NOT NULL CHECK(length(btrim(action)) > 0),
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  response_body jsonb NOT NULL CHECK(jsonb_typeof(response_body) = 'object'),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,request_id),
  FOREIGN KEY(workspace_id,case_id) REFERENCES pre_project_cases(workspace_id,id)
);
CREATE INDEX pre_project_definition_commands_case_idx
  ON pre_project_definition_commands(workspace_id,case_id,created_at DESC);

ALTER TABLE pre_project_definition_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_project_definition_baselines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pre_project_definition_baselines
  USING(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);

ALTER TABLE pre_project_definition_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_project_definition_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pre_project_definition_decisions
  USING(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);

ALTER TABLE pre_project_definition_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_project_definition_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pre_project_definition_commands
  USING(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);

INSERT INTO permissions(code,description) VALUES
  ('pre_projects.publish_definition','Publish an immutable requirements and design definition for client confirmation'),
  ('pre_projects.record_client_definition_decisions','Record attributed client definition decisions received outside the portal')
ON CONFLICT(code) DO NOTHING;

ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
INSERT INTO role_permissions(workspace_id,role_id,permission_id)
SELECT role.workspace_id,role.id,permission.id
FROM roles role CROSS JOIN permissions permission
WHERE role.is_system AND role.code IN ('owner','administrator')
  AND permission.code IN ('pre_projects.publish_definition','pre_projects.record_client_definition_decisions')
ON CONFLICT(role_id,permission_id) DO NOTHING;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
    GRANT SELECT,INSERT ON pre_project_definition_baselines TO wodana_app;
    GRANT SELECT,INSERT ON pre_project_definition_decisions TO wodana_app;
    GRANT SELECT,INSERT ON pre_project_definition_commands TO wodana_app;
  END IF;
END $$;
