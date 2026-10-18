-- View as (VA-3): after an owner or administrator viewed the workspace as someone, that person gets an in-app
-- notice (a workspace setting, on by default). New workspaces get it from DEFAULT_NOTIFICATION_TEMPLATES;
-- existing ones are seeded here. Idempotent.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('workspace.viewed_as', 'in_app', '{{viewerName}} viewed as you', 'Read-only, {{minutes}} min from {{startedAt}}. Security lists every view.', '["viewerName", "minutes", "startedAt"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
