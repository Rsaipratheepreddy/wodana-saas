-- Finance returns a receipt the team recorded, with a reason: the person who recorded it is told (in the app and by email).
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('commercial.receipt_returned', 'in_app', 'Receipt returned · {{clientName}}', '{{actor}} returned {{amount}} for {{title}}: {{note}}', '["title", "clientName", "actor", "amount", "note"]'),
  ('commercial.receipt_returned', 'email', 'Receipt returned · {{clientName}}', E'{{actor}} returned the receipt of {{amount}} for {{title}} ({{clientName}}): {{note}}\n\nOpen the payment to record it again.', '["title", "clientName", "actor", "amount", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
