-- PLM-161 / PLM-167 / PLM-168: who hears what about the project BOQ, for every workspace (new workspaces get them from
-- the default templates): the technical team when the draft BOQ is ready to verify, the QS when it is verified and
-- waits for their approval, the project manager and procurement when it is approved (BOQ R-n) or locked, the project
-- manager and the technical team when it is returned to draft with the reason, and the people who manage projects
-- when the upfront payment is in but the project could not start by itself. Idempotent.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('project.boq_draft_ready', 'in_app', 'BOQ to verify · {{title}}', 'The draft BOQ for {{clientName}} is ready for the technical check. {{note}}', '["title","clientName","actor","revision","note"]'),
  ('project.boq_draft_ready', 'email', 'BOQ to verify: {{title}}', E'The draft BOQ for {{title}} ({{clientName}}) is ready for the technical check.\n\n{{note}}\n\nOpen the project''s Scope tab and verify it once the quantities and specifications are right.', '["title","clientName","actor","revision","note"]'),
  ('project.boq_verified', 'in_app', 'BOQ for QS approval · {{title}}', '{{actor}} verified the BOQ. It waits for your approval. {{note}}', '["title","clientName","actor","revision","note"]'),
  ('project.boq_verified', 'email', 'BOQ for QS approval: {{title}}', E'{{actor}} verified the BOQ for {{title}} ({{clientName}}).\n\nIt waits for your approval on the project''s Scope tab. {{note}}', '["title","clientName","actor","revision","note"]'),
  ('project.boq_approved', 'in_app', 'BOQ approved {{revision}} · {{title}}', '{{actor}} approved the BOQ as {{revision}}. Ordering can go ahead. {{note}}', '["title","clientName","actor","revision","note"]'),
  ('project.boq_returned', 'in_app', 'BOQ returned to draft · {{title}}', '{{actor}}: {{note}}', '["title","clientName","actor","revision","note"]'),
  ('project.boq_locked', 'in_app', 'BOQ locked {{revision}} · {{title}}', '{{actor}} locked the BOQ. A change is a variation from here.', '["title","clientName","actor","revision","note"]'),
  ('project.ready_to_start', 'in_app', 'Ready to start · {{title}}', 'The upfront payment for {{clientName}} is verified. Start the project: {{note}}', '["title","clientName","actor","revision","note"]'),
  ('purchasing.qs_signed_off', 'in_app', '{{order}} signed off by the QS', '{{actor}} signed off {{order}} to {{supplier}} ({{amount}}). It can be placed.', '["order","supplier","amount","actor","note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
