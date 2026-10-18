-- The notices of a change on a started project (plan §6.20, §6.24), for the workspaces that exist (new workspaces get them from
-- DEFAULT_NOTIFICATION_TEMPLATES): raised, approved inside the firm, sent to the client, decided (existing), money to bill,
-- what to make or buy, new dates, not applied by itself, and the reminder while the client hasn't decided. In the app and by
-- email (the delivery worker renders every email through renderBrandedEmail with the tenant's brand). Tenants edit the texts
-- like their other templates. Idempotent.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('change_request.project_raised', 'in_app', '{{reference}} raised · {{title}}', '{{actor}} raised a change on {{project}}. {{note}}', '["project","clientName","actor","reference","title","note"]'),
  ('change_request.project_raised', 'email', 'Change raised: {{reference}} {{title}}', E'{{actor}} raised a change on {{project}}.\n\n{{note}}\n\nPrice it and send it for approval.', '["project","clientName","actor","reference","title","note"]'),
  ('change_request.ready', 'in_app', '{{reference}} approved · ready to send', '{{actor}} approved {{title}} ({{impact}}). Send it to the client.', '["project","clientName","actor","reference","title","impact"]'),
  ('change_request.ready', 'email', 'Ready to send: {{reference}} {{title}}', E'{{actor}} approved {{reference}} {{title}} on {{project}}.\n\n{{impact}}\n\nSend it to the client.', '["project","clientName","actor","reference","title","impact"]'),
  ('change_request.sent', 'in_app', '{{reference}} sent to {{clientName}}', '{{title}}: {{impact}}. Waiting for their decision.', '["project","clientName","actor","reference","title","impact"]'),
  ('change_request.sent', 'email', 'Sent to the client: {{reference}} {{title}}', E'{{actor}} sent {{reference}} {{title}} to {{clientName}}.\n\n{{impact}}\n\nYou''ll hear when they decide.', '["project","clientName","actor","reference","title","impact"]'),
  ('change_request.invoice', 'in_app', 'Bill {{variation}} · {{clientName}}', '{{reference}} {{title}} on {{project}}: {{payment}}', '["project","clientName","actor","reference","title","variation","amount","payment"]'),
  ('change_request.invoice', 'email', 'Variation to bill: {{variation}} · {{project}}', E'{{clientName}} approved {{reference}} {{title}}, applied as {{variation}} ({{amount}}).\n\n{{payment}}', '["project","clientName","actor","reference","title","variation","amount","payment"]'),
  ('change_request.materials', 'in_app', '{{variation}} changes what to make or buy', '{{project}}: {{note}}', '["project","clientName","actor","reference","title","variation","note"]'),
  ('change_request.materials', 'email', 'Make or buy changes: {{variation}} · {{project}}', E'{{reference}} {{title}} was approved and applied as {{variation}}.\n\n{{note}}\n\nPlan the work orders and orders, and check the ones listed.', '["project","clientName","actor","reference","title","variation","note"]'),
  ('change_request.schedule_moved', 'in_app', 'New dates · {{project}}', '{{reference}} {{title}}: {{note}}', '["project","clientName","actor","reference","title","variation","note"]'),
  ('change_request.schedule_moved', 'email', 'New dates on {{project}}', E'{{reference}} {{title}} was approved and applied as {{variation}}.\n\n{{note}}', '["project","clientName","actor","reference","title","variation","note"]'),
  ('change_request.apply_blocked', 'in_app', '{{reference}} not applied yet', '{{title}}: {{note}}', '["project","clientName","actor","reference","title","note"]'),
  ('change_request.apply_blocked', 'email', 'Apply {{reference}}: {{title}}', E'The client approved {{reference}} {{title}} on {{project}}, but it couldn''t be applied by itself.\n\n{{note}}\n\nOpen it and apply it.', '["project","clientName","actor","reference","title","note"]'),
  ('change_request.reminder', 'in_app', '{{reference}} waiting for {{clientName}}', '{{title}}: sent {{days}} days ago, not decided yet.', '["project","clientName","actor","reference","title","days"]'),
  ('change_request.reminder', 'email', 'Still waiting: {{reference}} {{title}}', E'{{clientName}} hasn''t decided on {{reference}} {{title}} ({{project}}), sent {{days}} days ago.\n\nThey were reminded too.', '["project","clientName","actor","reference","title","days"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
