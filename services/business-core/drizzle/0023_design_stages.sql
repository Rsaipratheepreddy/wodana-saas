-- Design deliverables belong to a design stage (space planning, concepts, materials, renders), so a
-- stage completes when its deliverables are approved. Client rejection is a recorded decision too.
ALTER TABLE pre_project_designs ADD COLUMN stage varchar(30)
  CHECK (stage IS NULL OR stage IN ('space_planning', 'concepts', 'material_selection', 'renders'));
--> statement-breakpoint
CREATE INDEX pre_project_designs_stage_idx ON pre_project_designs (workspace_id, case_id, stage) WHERE archived_at IS NULL;
--> statement-breakpoint
ALTER TABLE pre_project_design_activity DROP CONSTRAINT pre_project_design_activity_action_check;
--> statement-breakpoint
ALTER TABLE pre_project_design_activity ADD CONSTRAINT pre_project_design_activity_action_check
  CHECK (action IN ('comment', 'internal_review', 'internal_approved', 'client_review', 'approved', 'changes_requested', 'rejected'));
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('design.signed_off', 'in_app', 'Design signed off · {{clientName}}', 'The design is approved. It''s ready to quote.', '["clientName"]'),
  ('design.signed_off', 'email', 'Design signed off: {{clientName}}', E'The design for {{clientName}} is signed off and ready to quote.\n\nOpen the case to start the quotation.', '["clientName"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
