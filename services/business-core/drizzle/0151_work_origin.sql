-- Work the system raises from another record (a late order holding tasks up) keeps where it came from,
-- once per project, so the daily run raises it once and closes it when that record is settled.
ALTER TABLE work_items ADD COLUMN origin_key varchar(120);
--> statement-breakpoint
CREATE UNIQUE INDEX work_items_origin_uidx ON work_items (workspace_id, project_id, origin_key) WHERE origin_key IS NOT NULL;
--> statement-breakpoint
-- Buyers hear when an applied variation leaves orders for more than the scope now needs.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'project.over_ordered', 'in_app', 'en', 1, 'approved', 'Ordered more than {{actor}} leaves · {{title}}', '{{note}}', '["title", "clientName", "actor", "note"]'::jsonb, now()
  FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
