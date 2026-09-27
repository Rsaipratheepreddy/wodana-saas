-- When materials are needed. A piece of work can say its materials must be there when it starts (the
-- standard tasks do: production for made items, fitting for bought ones). A material, or a bought
-- scope line, is needed by the earliest start of such open work in its package, and should be ordered
-- its lead time before that: the supplier's when known, else the workspace's own. Needs not ordered by
-- then are chased.
ALTER TABLE work_items ADD COLUMN needs_materials boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE workspace_purchasing_settings ADD COLUMN order_ahead_days integer NOT NULL DEFAULT 14 CHECK (order_ahead_days BETWEEN 0 AND 365);
--> statement-breakpoint
-- The standard tasks that need the materials, in templates made from the defaults.
UPDATE work_templates template SET tasks = (
  SELECT jsonb_agg(CASE WHEN (template.supply, step.task->>'title') IN (('make', 'Production'), ('buy', 'Fit on site'), ('ready_made', 'Place and check'), ('client', 'Install'), ('site_work', 'Work done'))
                        THEN step.task || '{"needsMaterials": true}'::jsonb ELSE step.task END ORDER BY step.position)
    FROM jsonb_array_elements(template.tasks) WITH ORDINALITY AS step (task, position))
 WHERE jsonb_array_length(template.tasks) > 0;
--> statement-breakpoint
-- Work already planned from them.
UPDATE work_items item SET needs_materials = true
  FROM work_templates template
 WHERE template.workspace_id = item.workspace_id AND item.template_key IS NOT NULL
   AND template.supply = split_part(item.template_key, ':', 1)
   AND coalesce((template.tasks -> split_part(item.template_key, ':', 2)::int ->> 'needsMaterials')::boolean, false);
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('purchasing.order_late', 'in_app', 'Order now for {{project}}', '{{note}}', '["project", "note"]'),
  ('purchasing.order_late', 'email', 'Order now for {{project}}', E'These should have been ordered by now to arrive when they''re needed:\n\n{{note}}', '["project", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
