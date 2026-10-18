-- The person who connected WhatsApp hears when Meta limits or blocks the number (its standing lives on the connection).
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'crm.number_health', 'in_app', 'en', 1, 'approved', 'Your WhatsApp number is {{status}}', '{{reason}}', '["status","reason"]'::jsonb, now()
  FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
