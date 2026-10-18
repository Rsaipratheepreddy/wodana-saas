-- Ledger posting rules (plan §6.21b, slice B): the in-app notice people who manage the Ledger get once when an
-- event can't post yet (books_posting_issues), for every existing workspace (new ones get it from the defaults).
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'books.posting_blocked', 'in_app', 'en', 1, 'approved', 'Ledger needs attention · {{source}}', '{{note}}', '["source", "note"]'::jsonb, now()
  FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
