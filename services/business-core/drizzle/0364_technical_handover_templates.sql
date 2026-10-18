-- Notice templates for the technical handover and factory requirements (PLM-165, PLM-166), for every workspace that
-- exists already (new workspaces get them from the default templates). Idempotent; never disables RLS.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('project.technical_handover', 'in_app', 'Technical handover · {{title}}', '{{actor}} handed the technical pack over to you. {{note}}', '["title","clientName","actor","item","note"]'),
  ('project.technical_handover', 'email', 'Technical handover: {{title}}', E'{{actor}} handed the technical pack for {{clientName}} over to the technical team.\n\n{{note}}\n\nOpen the project''s Scope › Technical handover to check it and accept it.', '["title","clientName","actor","item","note"]'),
  ('project.technical_handover_accepted', 'in_app', 'Technical handover accepted · {{title}}', '{{actor}} accepted the technical handover.', '["title","clientName","actor","item","note"]'),
  ('project.factory_requirements_confirmed', 'in_app', 'Factory requirements confirmed for {{item}} · {{title}}', '{{actor}} confirmed the materials and labour for {{item}}.', '["title","clientName","actor","item","note"]'),
  ('project.factory_requirements_reopened', 'in_app', 'Factory requirements for {{item}} need confirming again · {{title}}', '{{actor}} changed them after they were confirmed. {{note}}', '["title","clientName","actor","item","note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
