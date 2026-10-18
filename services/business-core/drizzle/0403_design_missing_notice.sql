-- Guide L (16 Oct 2026): before the design approval is recorded, whatever is still missing (an open step, a file not yet
-- approved, a blocking comment) is flagged to the lead designer first, in the app and by email.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('design.missing_before_approval', 'in_app', 'Before the design approval · {{clientName}}', 'Still missing: {{note}}', '["clientName", "note"]'),
  ('design.missing_before_approval', 'email', 'Before the design approval · {{clientName}}', E'The design approval for {{clientName}} can''t be recorded yet. Still missing: {{note}}\n\nOpen the design to finish it.', '["clientName", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
