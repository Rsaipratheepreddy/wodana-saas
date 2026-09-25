CREATE TABLE ai_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  request_hash char(64) NOT NULL,
  entity_type varchar(32) NOT NULL,
  entity_id uuid NOT NULL,
  title varchar(200) NOT NULL,
  suggestion_text text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposed_diff jsonb NOT NULL DEFAULT '[]'::jsonb,
  uncertainty jsonb NOT NULL DEFAULT '[]'::jsonb,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'pending',
  edited_text text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,request_id),
  CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  CHECK(entity_type IN ('lead','opportunity','commercial_case','project')),
  CHECK(status IN ('pending','accepted','edited','rejected')),
  CHECK(length(trim(title)) > 0),
  CHECK(length(trim(suggestion_text)) > 0),
  CHECK(jsonb_typeof(evidence)='array' AND jsonb_array_length(evidence)<=40),
  CHECK(jsonb_typeof(proposed_diff)='array' AND jsonb_array_length(proposed_diff)<=30),
  CHECK(jsonb_typeof(uncertainty)='array' AND jsonb_array_length(uncertainty)<=30),
  CHECK(jsonb_typeof(provenance)='object'),
  CHECK((status='pending' AND decided_by IS NULL AND decided_at IS NULL) OR (status<>'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK(version > 0)
);
CREATE INDEX ai_suggestions_entity_idx ON ai_suggestions(workspace_id,entity_type,entity_id,created_at DESC);

CREATE TABLE ai_suggestion_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  suggestion_id uuid NOT NULL,
  request_id uuid NOT NULL,
  request_hash char(64) NOT NULL,
  action varchar(16) NOT NULL,
  edited_text text,
  reason varchar(1000),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,request_id),
  FOREIGN KEY(workspace_id,suggestion_id) REFERENCES ai_suggestions(workspace_id,id) ON DELETE CASCADE,
  CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  CHECK(action IN ('accepted','edited','rejected')),
  CHECK((action='edited' AND length(trim(edited_text)) > 0) OR (action<>'edited' AND edited_text IS NULL))
);

ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_suggestions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_suggestions
  USING (workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);
ALTER TABLE ai_suggestion_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_suggestion_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_suggestion_decisions
  USING (workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
    GRANT SELECT,INSERT,UPDATE ON ai_suggestions TO wodana_app;
    GRANT SELECT,INSERT ON ai_suggestion_decisions TO wodana_app;
  END IF;
END $$;

INSERT INTO permissions(code,description)
VALUES('ai.suggestions.use','Create and review evidence-backed AI suggestions without applying source-record changes')
ON CONFLICT(code) DO NOTHING;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
INSERT INTO role_permissions(workspace_id,role_id,permission_id)
SELECT role.workspace_id,role.id,permission.id
FROM roles role CROSS JOIN permissions permission
WHERE role.is_system=true AND role.code IN ('owner','administrator','member')
  AND permission.code='ai.suggestions.use'
ON CONFLICT(role_id,permission_id) DO NOTHING;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
