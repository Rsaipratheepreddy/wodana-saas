-- §0.3 P0 (guide C/F): someone tagged on an enquiry's team (the designer, for one) is told in the app and by email.
-- The default English templates for every workspace (new workspaces get them from the defaults). Idempotent.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('crm.enquiry_team_tagged', 'in_app', 'You''re on {{reference}} as {{role}} · {{clientName}}', '{{actor}} added you to the enquiry''s team.', '["role","reference","clientName","actor"]'),
  ('crm.enquiry_team_tagged', 'email', 'You''re on {{reference}} for {{clientName}} as {{role}}', E'{{actor}} added you to {{reference}} for {{clientName}} as {{role}}.\n\nOpen the enquiry to see the client''s details and what happens next.', '["role","reference","clientName","actor"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
