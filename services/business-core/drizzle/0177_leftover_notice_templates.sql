-- The notices added with the leftovers (a deal won or lost, a project that finished by itself, a client update sent by
-- itself, and site access for deliveries). New workspaces get them from DEFAULT_NOTIFICATION_TEMPLATES; existing ones
-- are seeded here. Idempotent.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('crm.deal_won', 'in_app', 'Won: {{title}}', '{{clientName}} {{amount}} · {{reason}}', '["title", "clientName", "amount", "reason"]'),
  ('crm.deal_lost', 'in_app', 'Lost: {{title}}', '{{clientName}} · Why: {{reason}}', '["title", "clientName", "amount", "reason"]'),
  ('project.finished_automatically', 'in_app', '{{title}} is complete', '{{clientName}} accepted the handover, so {{note}} and the project finished by themselves.', '["title", "clientName", "actor", "note"]'),
  ('project.client_update_auto_sent', 'in_app', '{{title}}: the client update went out', 'Nobody sent or discarded it within {{note}}, so it went to the client by itself.', '["title", "clientName", "actor", "note"]'),
  ('site.access_confirmed', 'in_app', '{{actor}} confirmed site access · {{title}}', '{{note}}', '["title", "clientName", "actor", "note"]'),
  ('site.access_move_asked', 'in_app', '{{actor}} asked to move a delivery · {{title}}', '{{note}}', '["title", "clientName", "actor", "note"]'),
  ('site.access_move_asked', 'email', '{{actor}} asked to move a delivery · {{title}}', E'{{actor}} asked in the client portal to move a delivery:\n\n{{note}}\n\nReschedule it with the supplier, or confirm the day with the client.', '["title", "clientName", "actor", "note"]'),
  ('site.delivery_moved', 'in_app', 'Delivery moved · {{title}}', '{{note}}', '["title", "clientName", "actor", "note"]'),
  ('portal.site_access', 'email', 'Confirm site access for {{title}}', E'{{company}} has a delivery for {{project}} on {{title}}: {{note}}\n\nOpen your project page to confirm someone can let the team in, or ask to move it.', '["company", "project", "title", "due", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
