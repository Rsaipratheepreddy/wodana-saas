-- AI apps (W-5): when a person connects a new AI app, they hear it in the app and by email (in the workspace's
-- brand), so a connection they did not make is noticed. New workspaces get the templates from
-- DEFAULT_NOTIFICATION_TEMPLATES; existing ones are seeded here. Idempotent.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, '["appName", "access"]'::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('ai.app_connected', 'in_app', '{{appName}} connected to your account', 'It can {{access}} as you. Revoke it in AI apps if this wasn''t you.'),
  ('ai.app_connected', 'email', '{{appName}} connected to your account', E'{{appName}} can now {{access}} as you.\n\nIf this wasn''t you, revoke it in Settings → AI apps and change your password.')
) AS template (code, channel, subject, body)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
