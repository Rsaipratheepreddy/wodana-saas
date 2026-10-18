-- Design inspections at the factory (PLM-150): who is told what, and the overdue reminder.
--
-- 1. The reminder kind factory.inspection_due joins the engine's kind lists (an inspection not done by its due day
--    reminds the inspecting designer, then escalates to the project manager). The lists are extended in place, so a
--    kind another migration added stays.
--    Adds reminder kind factory.inspection_due (engine)
-- 2. The notice templates for every workspace (new workspaces get them from the default templates).
-- Idempotent; never disables RLS.
DO $$
DECLARE
  target record;
  definition text;
BEGIN
  FOR target IN SELECT * FROM (VALUES ('reminder_rules', 'reminder_rules_kind_check'), ('reminder_subjects', 'reminder_subjects_kind_check')) AS list (tbl, con) LOOP
    SELECT pg_get_constraintdef(constraint_row.oid) INTO definition FROM pg_constraint constraint_row
     WHERE constraint_row.conname = target.con AND constraint_row.conrelid = target.tbl::regclass;
    IF definition IS NOT NULL AND position('''factory.inspection_due''' IN definition) = 0 THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', target.tbl, target.con);
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', target.tbl, target.con,
        regexp_replace(definition, 'ARRAY\[', 'ARRAY[''factory.inspection_due''::character varying, '));
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('factory.inspection_ready', 'in_app', '{{item}} is ready for {{stage}}', '{{order}} · {{project}}. Inspect it by {{date}}. {{note}}', '["order","item","project","stage","date","actor","note"]'),
  ('factory.inspection_ready', 'email', '{{item}} is ready for {{stage}}: {{project}}', E'{{actor}} marked {{order}} {{item}} for {{project}} ready for {{stage}}.\n\nInspect it at the factory by {{date}}. {{note}}', '["order","item","project","stage","date","actor","note"]'),
  ('factory.reinspection_ready', 'in_app', '{{item}} is ready for re-inspection', '{{order}} · {{project}}: the snags from {{stage}} are fixed. Inspect it by {{date}}. {{note}}', '["order","item","project","stage","date","actor","note"]'),
  ('factory.reinspection_ready', 'email', '{{item}} is ready for re-inspection: {{project}}', E'The factory fixed the snags {{stage}} found on {{order}} {{item}} for {{project}}.\n\nInspect it again by {{date}}. {{note}}', '["order","item","project","stage","date","actor","note"]'),
  ('factory.inspection_snags', 'in_app', 'Snags to fix on {{item}}', '{{actor}} found them at {{stage}} on {{order}} · {{project}}: {{note}}', '["order","item","project","stage","date","actor","note"]'),
  ('factory.inspection_snags', 'email', 'Snags to fix on {{item}}: {{project}}', E'{{actor}} failed {{stage}} on {{order}} {{item}} for {{project}}.\n\nTo fix: {{note}}\n\nMark each one fixed when it is done; the item then goes back for inspection.', '["order","item","project","stage","date","actor","note"]'),
  ('factory.inspection_failed', 'in_app', '{{item}} failed {{stage}}', '{{actor}} on {{order}} · {{project}}: {{note}}', '["order","item","project","stage","date","actor","note"]'),
  ('factory.inspection_failed', 'email', '{{item}} failed {{stage}}: {{project}}', E'{{actor}} failed {{stage}} on {{order}} {{item}} for {{project}}.\n\n{{note}}\n\nThe factory has the snags to fix. It can''t go to site until the last inspection passes.', '["order","item","project","stage","date","actor","note"]'),
  ('factory.inspection_passed', 'in_app', '{{item}} passed {{stage}}', '{{actor}} passed it on {{order}} · {{project}}. Finishing can go ahead.', '["order","item","project","stage","date","actor","note"]'),
  ('factory.dispatch_cleared', 'in_app', '{{item}} can go to site', '{{actor}} passed {{stage}} on {{order}} · {{project}}.', '["order","item","project","stage","date","actor","note"]'),
  ('factory.dispatch_cleared', 'email', '{{item}} can go to site: {{project}}', E'{{actor}} passed {{stage}} on {{order}} {{item}} for {{project}}.\n\nIt can be sent to site.', '["order","item","project","stage","date","actor","note"]'),
  ('factory.inspector_missing', 'in_app', 'Nobody inspects {{item}}', '{{project}} has nobody in the {{note}} role. Add them to the team, or record {{stage}} yourself.', '["order","item","project","stage","date","actor","note"]'),
  ('factory.inspector_missing', 'email', 'Nobody inspects {{item}}: {{project}}', E'{{order}} {{item}} is ready for {{stage}}, but {{project}} has nobody in the {{note}} role.\n\nAdd them to the project team, or record the inspection yourself.', '["order","item","project","stage","date","actor","note"]'),
  ('reminders.factory.inspection_due', 'in_app', '{{title}} · {{due}}', '{{context}}. Inspect it at the factory, or ask someone to cover it.', '["title","context","due"]'),
  ('reminders.factory.inspection_due', 'push', '{{title}} · {{due}}', '{{context}}. Inspect it at the factory, or ask someone to cover it.', '["title","context","due"]'),
  ('reminders.factory.inspection_due', 'email', '{{title}} · {{due}}', E'{{title}} is {{due}}.\n\n{{context}}. Inspect it at the factory, or ask someone to cover it.', '["title","context","due"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
