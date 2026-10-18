-- Ledger bill capture (plan §6.21b, slice D): the notice an uploader gets when a bill's reading finishes after the
-- upload stopped waiting for it. The table, its row security and the bill lines' tax code and account are in 0282.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'books.capture_read', 'in_app', 'en', 1, 'approved', '{{title}}', '{{note}}', '["title", "note"]'::jsonb, now()
  FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
