-- The owners and administrators hear when AI credits run low and when they run out (in the app and by
-- email, in the workspace's brand). Tenants edit their copies; the balance is the only variable.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, '["balance"]'::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('ai.credits_low', 'in_app', 'AI credits are running low', '{{balance}} credits left. Contact support to top up.'),
  ('ai.credits_low', 'email', 'AI credits are running low', E'Your workspace has {{balance}} AI credits left.\n\nContact support to top up before they run out. Woddy and AI suggestions pause when credits are used up.'),
  ('ai.credits_exhausted', 'in_app', 'AI credits are used up', 'Woddy and AI suggestions are paused. Contact support to top up.'),
  ('ai.credits_exhausted', 'email', 'AI credits are used up', E'Your workspace has used all of its AI credits.\n\nWoddy and AI suggestions are paused until credits are topped up. Contact support to top up.')
) AS template (code, channel, subject, body)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
