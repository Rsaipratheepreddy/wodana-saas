-- Changes that reach the factory after a work order is planned. A variation that reduces or removes its
-- scope line stops its work orders until they're brought back within the line; a revised drawing puts a
-- running work order on hold until someone else decides to go on.
ALTER TABLE work_orders ADD COLUMN hold_kind varchar(10) CHECK (hold_kind IS NULL OR hold_kind IN ('manual', 'drawing'));
--> statement-breakpoint
ALTER TABLE work_orders ADD COLUMN drawing_revised_by uuid REFERENCES users (id);
--> statement-breakpoint
UPDATE work_orders SET hold_kind = 'manual' WHERE status = 'on_hold';
--> statement-breakpoint
ALTER TABLE work_orders ADD CONSTRAINT work_orders_held_kind_check CHECK ((status = 'on_hold') = (hold_kind IS NOT NULL));
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('factory.scope_changed', 'in_app', 'A variation changed {{item}}', '{{project}}: {{note}}', '["order", "item", "project", "actor", "note"]'),
  ('factory.drawing_revised', 'in_app', '{{order}} is on hold: the drawing changed', '{{actor}}: {{note}}', '["order", "item", "project", "actor", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
