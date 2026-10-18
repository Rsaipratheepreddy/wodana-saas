-- Daily reminders for project work: the assignee the day before an item is due, and the assignee and
-- the project manager once when it becomes late.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('work.due_soon', 'in_app', '{{task}} is due tomorrow', '{{title}}', '["title", "task", "due"]'),
  ('work.overdue', 'in_app', '{{task}} is late', 'It was due {{due}} on {{title}}.', '["title", "task", "due"]'),
  ('work.overdue', 'email', '{{task}} is late · {{title}}', E'{{task}} on {{title}} was due {{due}}.\n\nOpen it to update its status or dates.', '["title", "task", "due"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
