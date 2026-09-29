-- Approvals that wait get chased (AU-3). Whoever may decide an item in "Waiting for you" is reminded once it has
-- waited the workspace's hours (24 by default), and the owners hear once it has waited longer (48 by default).
-- The hours and channels are the "Approval reminders" rule in Settings → Reminders (a notification policy's
-- conditions); with no policy saved the rule is on with the defaults. Idempotent.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, '["title", "hours", "approvers"]'::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('approvals.reminder', 'in_app', 'Still waiting for you · {{title}}', 'It has waited {{hours}} hours.'),
  ('approvals.reminder', 'email', 'Still waiting for you · {{title}}', E'{{title}} has waited {{hours}} hours for your decision.\n\nOpen it to approve or send it back.'),
  ('approvals.escalated', 'in_app', 'Waiting {{hours}} hours · {{title}}', 'Still with {{approvers}}.'),
  ('approvals.escalated', 'email', 'Waiting {{hours}} hours · {{title}}', E'{{title}} has waited {{hours}} hours. It is still with {{approvers}}.\n\nOpen it to decide it or chase them.')
) AS template (code, channel, subject, body)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
