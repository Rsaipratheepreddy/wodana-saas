-- Quote comments (Figma-style): a thread pinned to a line, one of its cells, an area or trade group,
-- or the totals, with replies, @mentions and resolve. Presence: who has the quote open and which
-- line they're on, kept for a short while and refreshed by the builder.
CREATE TABLE commercial_quote_threads (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  case_id uuid NOT NULL,
  quote_id text NOT NULL,
  anchor_kind varchar(8) NOT NULL CHECK (anchor_kind IN ('line', 'area', 'trade', 'total')),
  anchor_key varchar(80) NOT NULL DEFAULT '',
  anchor_field varchar(24),
  status varchar(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid,
  resolved_at timestamptz,
  UNIQUE (workspace_id, id),
  CHECK (anchor_field IS NULL OR anchor_kind = 'line'),
  FOREIGN KEY (workspace_id, case_id, quote_id) REFERENCES commercial_quotes (workspace_id, case_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE INDEX commercial_quote_threads_quote_idx ON commercial_quote_threads (workspace_id, case_id, quote_id, status);
--> statement-breakpoint
CREATE TABLE commercial_quote_messages (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  mentions uuid[] NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, thread_id) REFERENCES commercial_quote_threads (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX commercial_quote_messages_thread_idx ON commercial_quote_messages (workspace_id, thread_id, created_at);
--> statement-breakpoint
CREATE TABLE commercial_quote_presence (
  workspace_id uuid NOT NULL,
  case_id uuid NOT NULL,
  quote_id text NOT NULL,
  user_id uuid NOT NULL,
  line_id text,
  field varchar(24),
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, case_id, quote_id, user_id)
);
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['commercial_quote_threads', 'commercial_quote_messages', 'commercial_quote_presence'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON commercial_quote_threads, commercial_quote_messages, commercial_quote_presence TO wodana_app;
  END IF;
END $$;
