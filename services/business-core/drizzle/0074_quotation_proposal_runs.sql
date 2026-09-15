CREATE TABLE quotation_proposal_runs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  case_id uuid NOT NULL,
  quote_id uuid NOT NULL,
  mode varchar(20) NOT NULL CHECK(mode IN ('scope','assistant')),
  status varchar(20) NOT NULL DEFAULT 'proposed'
    CHECK(status IN ('proposed','applied','dismissed')),
  commercial_revision integer NOT NULL CHECK(commercial_revision >= 0),
  quote_draft_hash char(64) NOT NULL CHECK(quote_draft_hash ~ '^[0-9a-f]{64}$'),
  definition_baseline_id uuid NOT NULL,
  definition_snapshot_hash char(64) NOT NULL CHECK(definition_snapshot_hash ~ '^[0-9a-f]{64}$'),
  definition_source_hash char(64) NOT NULL CHECK(definition_source_hash ~ '^[0-9a-f]{64}$'),
  proposal_hash char(64) NOT NULL CHECK(proposal_hash ~ '^[0-9a-f]{64}$'),
  proposal jsonb NOT NULL CHECK(jsonb_typeof(proposal) = 'object'),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_by uuid REFERENCES users(id),
  applied_at timestamptz,
  applied_revision integer CHECK(applied_revision >= 0),
  dismissed_by uuid REFERENCES users(id),
  dismissed_at timestamptz,
  CONSTRAINT quotation_proposal_runs_case_fk
    FOREIGN KEY(workspace_id,case_id) REFERENCES pre_project_cases(workspace_id,id),
  CONSTRAINT quotation_proposal_runs_definition_fk
    FOREIGN KEY(workspace_id,case_id,definition_baseline_id)
    REFERENCES pre_project_definition_baselines(workspace_id,case_id,id),
  CONSTRAINT quotation_proposal_runs_identity UNIQUE(workspace_id,case_id,id),
  CONSTRAINT quotation_proposal_runs_terminal_state CHECK(
    (status='proposed' AND applied_by IS NULL AND applied_at IS NULL AND applied_revision IS NULL AND dismissed_by IS NULL AND dismissed_at IS NULL)
    OR
    (status='applied' AND applied_by IS NOT NULL AND applied_at IS NOT NULL AND applied_revision IS NOT NULL AND dismissed_by IS NULL AND dismissed_at IS NULL)
    OR
    (status='dismissed' AND dismissed_by IS NOT NULL AND dismissed_at IS NOT NULL AND applied_by IS NULL AND applied_at IS NULL AND applied_revision IS NULL)
  )
);
CREATE INDEX quotation_proposal_runs_quote_idx
  ON quotation_proposal_runs(workspace_id,case_id,quote_id,created_at DESC,id);

CREATE TABLE quotation_proposal_commands (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  request_id uuid NOT NULL,
  case_id uuid NOT NULL,
  run_id uuid,
  action varchar(20) NOT NULL CHECK(action IN ('create','apply','dismiss')),
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  response_body jsonb NOT NULL CHECK(jsonb_typeof(response_body) = 'object'),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,request_id),
  CONSTRAINT quotation_proposal_commands_case_fk
    FOREIGN KEY(workspace_id,case_id) REFERENCES pre_project_cases(workspace_id,id),
  CONSTRAINT quotation_proposal_commands_run_fk
    FOREIGN KEY(workspace_id,case_id,run_id)
    REFERENCES quotation_proposal_runs(workspace_id,case_id,id)
);
CREATE INDEX quotation_proposal_commands_case_idx
  ON quotation_proposal_commands(workspace_id,case_id,created_at DESC);

ALTER TABLE quotation_proposal_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_proposal_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quotation_proposal_runs
  USING(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);

ALTER TABLE quotation_proposal_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_proposal_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON quotation_proposal_commands
  USING(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
    GRANT SELECT,INSERT ON quotation_proposal_runs TO wodana_app;
    GRANT UPDATE(status,applied_by,applied_at,applied_revision,dismissed_by,dismissed_at)
      ON quotation_proposal_runs TO wodana_app;
    GRANT SELECT,INSERT ON quotation_proposal_commands TO wodana_app;
  END IF;
END $$;
