-- §0.3, the job's team thread: one conversation per job for the people working it (never the client), where the
-- job's own events appear as lines (a document sent, a signature, a payment verified) and @mentions tell a person.
--
-- 1. job_messages: a message (author, words, who it mentions) or an event line (no author, its code and record).
-- 2. job_message_reads: when each person last read the job's thread (unread counts).
-- 3. The in-app notice a mention sends, for every workspace.
-- Workspace-scoped, forced RLS, tenant_isolation. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS job_messages (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  job_id uuid NOT NULL,
  kind varchar(10) NOT NULL CHECK (kind IN ('message', 'event')),
  author_user_id uuid REFERENCES users (id),
  body varchar(4000) NOT NULL CHECK (length(btrim(body)) > 0),
  mentions uuid[] NOT NULL DEFAULT '{}',
  event_code varchar(60),
  event_ref varchar(160),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, id),
  CHECK ((kind = 'message') = (author_user_id IS NOT NULL)),
  CHECK ((kind = 'event') = (event_code IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS job_messages_job_idx ON job_messages (workspace_id, job_id, created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS job_messages_event_once ON job_messages (workspace_id, job_id, event_code, event_ref) WHERE kind = 'event' AND event_ref IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS job_message_reads (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, job_id, user_id)
);
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['job_messages', 'job_message_reads'] LOOP
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
  ('job_messages', 'clear', NULL, '{}'), ('job_message_reads', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition, clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'job.mentioned', 'in_app', 'en', 1, 'approved', '{{author}} mentioned you on {{job}}', '{{author}}: {{text}}', '["author","job","text"]'::jsonb, now()
  FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
