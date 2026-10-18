-- §0.3 Push like a delivery app: the firm's own push for each moment of a job (title, text, one action button), with the
-- kit's wording until it changes it; and each job's step last seen, so a step change sends one progress push.
-- Workspace-scoped, forced RLS, tenant_isolation. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS setup_push_templates (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  event_key varchar(40) NOT NULL CHECK (event_key ~ '^[a-z][a-z_]{2,39}$'),
  title varchar(80) NOT NULL CHECK (length(trim(title)) > 0),
  body varchar(240) NOT NULL CHECK (length(trim(body)) > 0),
  action varchar(10) NOT NULL CHECK (action IN ('open', 'review', 'reply', 'pay')),
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, event_key)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS job_journey_marks (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  step_key varchar(80),
  chapter varchar(20),
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, job_id),
  FOREIGN KEY (workspace_id, job_id) REFERENCES job_identities (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['setup_push_templates', 'job_journey_marks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = table_name AND policyname = 'tenant_isolation') THEN
      EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$p$, table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wodana_app', table_name);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('setup_push_templates', 'keep', NULL, '{}'),
  ('job_journey_marks', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition, clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
