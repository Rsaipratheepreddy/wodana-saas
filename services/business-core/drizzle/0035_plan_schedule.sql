-- The plan's baseline: the dates the project manager committed to, kept on each item so the plan shows
-- how far work has slipped since. Setting a new baseline replaces them and is audited.
ALTER TABLE work_items ADD COLUMN baseline_start date, ADD COLUMN baseline_due date;
--> statement-breakpoint
ALTER TABLE delivery_projects ADD COLUMN plan_baseline_at timestamptz, ADD COLUMN plan_baseline_by uuid REFERENCES users (id);
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'work.moved', 'in_app', 'en', 1, 'approved', '{{task}} moved to {{due}}', '{{actor}} pushed it later because {{note}} moved.', '["title", "clientName", "actor", "task", "due", "note"]'::jsonb, now()
FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
