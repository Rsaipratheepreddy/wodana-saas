-- AI assistance: off until a workspace admin turns it on (tenant data goes to an AI provider only
-- then). Every AI call is recorded for usage and audit; suggestions stay reviewable (ai_suggestions).
CREATE TABLE workspace_ai_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  feature varchar(60) NOT NULL,
  provider varchar(40) NOT NULL,
  model varchar(80) NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  status varchar(16) NOT NULL CHECK (status IN ('ok', 'invalid_output', 'failed', 'timeout')),
  latency_ms integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX ai_usage_events_workspace_idx ON ai_usage_events (workspace_id, created_at DESC);
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['workspace_ai_settings', 'ai_usage_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$p$, table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO wodana_app', table_name);
    END IF;
  END LOOP;
END $$;
