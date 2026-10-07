-- Ledger settings and manual journals (plan §6.21b, slice A2).
--   * books_commands: one row per Ledger command id (settings, accounts, roles, payment accounts, tax codes, manual
--     and opening journals), so the same command sent twice changes nothing the second time.
--   * The Ledger's notices for workspaces that already exist: the lock date moved (to everyone who sets up the
--     Ledger) and a manual journal decided (to who prepared it). New workspaces get them from the default templates.
-- Never disables RLS.

CREATE TABLE IF NOT EXISTS books_commands (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  action varchar(40) NOT NULL CHECK (action ~ '^[a-z][a-z0-9_]{0,39}$'),
  entity_id varchar(160) NOT NULL DEFAULT '',
  actor_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE books_commands ENABLE ROW LEVEL SECURITY;
  ALTER TABLE books_commands FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'books_commands' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON books_commands
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT ON books_commands TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('books_commands', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('books.lock_date_changed', 'in_app', '{{company}} · books locked up to {{lockDate}}', '{{actor}} changed the lock date. It was {{previous}}.',
    '["company","lockDate","previous","actor"]'),
  ('books.lock_date_changed', 'email', '{{company}} · books locked up to {{lockDate}}',
    E'{{actor}} changed the Ledger lock date for {{company}} to {{lockDate}}. It was {{previous}}.\n\nNothing dated on or before the lock date can be entered by hand.',
    '["company","lockDate","previous","actor"]'),
  ('books.journal_decided', 'in_app', '{{reference}} · {{outcome}}', '{{actor}}: {{note}}', '["reference","company","outcome","note","actor"]'),
  ('books.journal_decided', 'email', '{{reference}} · {{outcome}}', E'{{actor}} {{outcome}} your journal {{reference}} for {{company}}.\n\n{{note}}',
    '["reference","company","outcome","note","actor"]')
) AS template(code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
