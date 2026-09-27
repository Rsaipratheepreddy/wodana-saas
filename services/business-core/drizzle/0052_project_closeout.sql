-- Closing a project. It completes when its last stage finishes and cancels with why; either way the
-- open ends are settled first (orders still owed, deliveries waiting for inspection, moves on the way,
-- stock at its site, and for completion its open work). Who closed it and when is kept, and a
-- completed project can be reopened with why.
ALTER TABLE delivery_projects
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN completed_by uuid REFERENCES users (id),
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by uuid REFERENCES users (id),
  ADD COLUMN cancel_reason varchar(500);
--> statement-breakpoint
UPDATE delivery_projects SET completed_at = updated_at WHERE status = 'completed';
--> statement-breakpoint
UPDATE delivery_projects SET cancelled_at = updated_at, cancel_reason = 'Cancelled' WHERE status = 'cancelled';
--> statement-breakpoint
ALTER TABLE delivery_projects
  ADD CONSTRAINT delivery_projects_completed_check CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  ADD CONSTRAINT delivery_projects_cancelled_check CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  ADD CONSTRAINT delivery_projects_cancel_reason_check CHECK (cancelled_at IS NULL OR length(btrim(coalesce(cancel_reason, ''))) > 0);
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('project.cancelled', 'in_app', '{{title}} is cancelled', '{{actor}}: {{note}}', '["title", "clientName", "actor", "note"]'),
  ('project.cancelled', 'email', '{{title}} is cancelled', E'{{actor}} cancelled {{title}} for {{clientName}}.\n\n{{note}}', '["title", "clientName", "actor", "note"]'),
  ('project.completed', 'in_app', '{{title}} is complete', '{{actor}} finished the last stage.', '["title", "clientName", "actor", "note"]'),
  ('project.reopened', 'in_app', '{{title}} is open again', '{{actor}}: {{note}}', '["title", "clientName", "actor", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
