-- Woddy's tools (W-1). A run is one question to Woddy: its model rounds and tokens are capped, and recorded
-- here. Read tools run at once under the person's own permissions. A write tool never changes anything by
-- itself: it stores a proposed action (the preview the person sees, the exact command input, the record's
-- version and an idempotency key). The person who asked confirms or cancels it; confirming runs the module's
-- own command as that person. A proposal expires 15 minutes after it is made.
--
-- preview, command and result are immutable snapshots of one proposal; the state lives in columns.
CREATE TABLE ai_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users (id),
  surface varchar(20) NOT NULL CHECK (surface IN ('panel', 'inbox', 'comment', 'search')),
  context_type varchar(40),
  context_id varchar(80),
  status varchar(20) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'answered', 'stopped', 'failed')),
  rounds integer NOT NULL DEFAULT 0 CHECK (rounds >= 0),
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  stop_reason varchar(40),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (workspace_id, id),
  CHECK (status = 'running' OR finished_at IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX ai_agent_runs_recent_idx ON ai_agent_runs (workspace_id, requested_by, created_at DESC);
--> statement-breakpoint
CREATE TABLE ai_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  tool varchar(60) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'confirmed', 'executed', 'rejected', 'failed', 'expired')),
  requested_by uuid NOT NULL REFERENCES users (id),
  target_type varchar(40),
  target_id varchar(80),
  target_version integer CHECK (target_version IS NULL OR target_version > 0),
  summary varchar(500) NOT NULL,
  preview jsonb NOT NULL,
  command jsonb NOT NULL,
  -- The items the person kept ticked when a proposal lists several (assign).
  selection jsonb,
  idempotency_key varchar(160) NOT NULL,
  result jsonb,
  error_code varchar(80),
  error_message varchar(1000),
  expires_at timestamptz NOT NULL,
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz,
  executed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, run_id) REFERENCES ai_agent_runs (workspace_id, id) ON DELETE CASCADE,
  UNIQUE (workspace_id, idempotency_key),
  CONSTRAINT ai_tool_calls_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT ai_tool_calls_decision_check CHECK (status IN ('proposed', 'expired') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT ai_tool_calls_executed_check CHECK (status <> 'executed' OR executed_at IS NOT NULL),
  CONSTRAINT ai_tool_calls_failure_check CHECK (status <> 'failed' OR error_message IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX ai_tool_calls_run_idx ON ai_tool_calls (workspace_id, run_id, created_at);
--> statement-breakpoint
CREATE INDEX ai_tool_calls_open_idx ON ai_tool_calls (workspace_id, expires_at) WHERE status = 'proposed';
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['ai_agent_runs', 'ai_tool_calls'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$p$, table_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    -- Runs and proposals are kept: they change state, they are never deleted by the app.
    GRANT SELECT, INSERT, UPDATE ON ai_agent_runs TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON ai_tool_calls TO wodana_app;
  END IF;
END $$;
