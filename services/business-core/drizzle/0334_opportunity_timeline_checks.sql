-- PLM-155: Sales don't promise timelines; they check them the same working day.
--
-- 1. crm_timeline_checks: a timeline question on an opportunity. The Account Manager (asker) asks one person from the
--    teams the firm chose (the designers, Production...) with a due time at the end of the working day; the person
--    answers it (the answer is kept on the opportunity) and the Account Manager is told to reply to the client. It is a
--    task with one owner and a due time, not a module: open → answered, or cancelled. Its version guards concurrent
--    answers.
-- 2. workspace_sales_settings.timeline_check_roles: the team or role codes whose people can be asked (empty: anyone in
--    the workspace).
-- 3. The notices (the person asked, then the Account Manager) for every workspace; new workspaces get them from the
--    default templates.
-- 4. The go-live reset clears the questions with the rest of the sales records.
-- Workspace-scoped, forced RLS, tenant_isolation. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS crm_timeline_checks (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES crm_opportunities (id) ON DELETE CASCADE,
  question varchar(2000) NOT NULL CHECK (length(btrim(question)) > 0),
  asker_membership_id uuid REFERENCES workspace_memberships (id) ON DELETE SET NULL,
  assignee_membership_id uuid NOT NULL REFERENCES workspace_memberships (id),
  team_code varchar(64),
  due_at timestamptz NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'cancelled')),
  answer varchar(4000),
  answered_by uuid REFERENCES users (id),
  answered_at timestamptz,
  request_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, request_id),
  CHECK ((status = 'answered') = (answer IS NOT NULL AND answered_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_timeline_checks_opportunity_idx ON crm_timeline_checks (workspace_id, opportunity_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_timeline_checks_open_idx ON crm_timeline_checks (workspace_id, due_at) WHERE status = 'open';
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE crm_timeline_checks ENABLE ROW LEVEL SECURITY;
  ALTER TABLE crm_timeline_checks FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'crm_timeline_checks' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON crm_timeline_checks
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON crm_timeline_checks TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE workspace_sales_settings ADD COLUMN IF NOT EXISTS timeline_check_roles text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('crm.timeline_question', 'in_app', 'Timeline question · {{client}}', '{{actor}} asks: {{question}} Answer by {{due}}.', '["client","actor","question","due","opportunity"]'),
  ('crm.timeline_question', 'email', 'Timeline question for {{client}}', E'{{actor}} asks about {{opportunity}}:\n\n{{question}}\n\nAnswer in Wodana by {{due}}, so they can reply to the client the same day.', '["client","actor","question","due","opportunity"]'),
  ('crm.timeline_answered', 'in_app', 'Timeline answer · {{client}}', '{{actor}}: {{answer}} Reply to the client today.', '["client","actor","answer","opportunity"]'),
  ('crm.timeline_answered', 'email', 'Timeline answer for {{client}}', E'{{actor}} answered your timeline question on {{opportunity}}:\n\n{{answer}}\n\nReply to the client today.', '["client","actor","answer","opportunity"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('crm_timeline_checks', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
