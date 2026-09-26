-- Design review notifications: review requested, approved, sent back, client decisions, @mentions.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('design.review_requested', 'in_app', 'Review {{title}} · {{clientName}}', '{{actor}} sent it for your review.', '["title", "clientName", "actor", "note"]'),
  ('design.review_requested', 'email', 'Please review: {{title}} ({{clientName}})', E'{{actor}} sent {{title}} for {{clientName}} for your review.\n\nOpen it to approve or send it back.', '["title", "clientName", "actor", "note"]'),
  ('design.review_approved', 'in_app', 'Approved: {{title}}', '{{actor}} approved it. It''s ready to present to {{clientName}}.', '["title", "clientName", "actor", "note"]'),
  ('design.sent_back', 'in_app', 'Changes needed: {{title}}', '{{actor}}: {{note}}', '["title", "clientName", "actor", "note"]'),
  ('design.client_approved', 'in_app', '{{clientName}} approved {{title}}', '{{note}}', '["title", "clientName", "actor", "note"]'),
  ('design.client_approved', 'email', '{{clientName}} approved {{title}}', E'{{clientName}} approved {{title}}.\n\n{{note}}', '["title", "clientName", "actor", "note"]'),
  ('design.client_changes', 'in_app', '{{clientName}} wants changes to {{title}}', '{{note}}', '["title", "clientName", "actor", "note"]'),
  ('design.client_changes', 'email', '{{clientName}} wants changes to {{title}}', E'{{clientName}} asked for changes to {{title}}:\n\n{{note}}', '["title", "clientName", "actor", "note"]'),
  ('design.mentioned', 'in_app', '{{actor}} mentioned you · {{title}}', '{{note}}', '["title", "actor", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
