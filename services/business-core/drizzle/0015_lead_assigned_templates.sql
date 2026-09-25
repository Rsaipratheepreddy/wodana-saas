-- PLM-032: the new owner of an enquiry is told in the app and by email (reference, client, source, link).
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'crm.lead_assigned', 'in_app', 'en', 1, 'approved',
  '{{reference}} · {{clientName}} is yours',
  'New enquiry from {{source}}. Log your first contact within the response time.',
  '["reference","clientName","source"]'::jsonb, now()
FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'crm.lead_assigned', 'email', 'en', 1, 'approved',
  'New enquiry {{reference}}: {{clientName}}',
  E'You have a new enquiry.\n\nReference: {{reference}}\nClient: {{clientName}}\nSource: {{source}}\n\nOpen it and log your first contact within the response time.',
  '["reference","clientName","source"]'::jsonb, now()
FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
