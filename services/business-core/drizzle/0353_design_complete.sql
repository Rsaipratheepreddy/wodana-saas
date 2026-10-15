-- A design-only job (Full ID) ends cleanly at the design handover.
--   * design_journeys.design_complete: the client's design approval ended the job ("Design complete"): the deal's path
--     is design without a main quotation, or its enquiry type closes at the design handover. No Proposal 2 estimate is
--     due (estimate_due_at stays empty) and no client updates start. Journeys approved before keep false.
--   * The notice the Account Manager and the Sales Admin get when it happens, for every workspace.
-- RLS untouched. Idempotent.
ALTER TABLE design_journeys ADD COLUMN IF NOT EXISTS design_complete boolean NOT NULL DEFAULT false;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('design.completed', 'in_app', 'Design complete · {{clientName}}', 'Approved {{approvedOn}}. The design job is complete.', '["clientName","approvedOn"]'),
  ('design.completed', 'email', 'Design complete: {{clientName}}', E'{{clientName}} approved the final design on {{approvedOn}}.\n\nThe design job is complete.', '["clientName","approvedOn"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
