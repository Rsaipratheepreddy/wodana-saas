-- PLM-153: the reminder engine's meeting.minutes_due kind. A client meeting that ended without minutes reminds its
-- owner (the designer or Account Manager who ran it) after the firm's chosen hours (Settings › Reminders; by default 2
-- and 24 hours after the meeting ended), then their team lead. Done once the minutes are written or the meeting is
-- cancelled.
--   * The kind joins the kind lists. The lists are extended, never rewritten, so kinds another release added stay:
--     -- adds to reminder_rules_kind_check: 'meeting.minutes_due'
--     -- adds to reminder_subjects_kind_check: 'meeting.minutes_due'
--   * Its staff templates (in the app, on the phone and by email) for every workspace.
-- reminder_rules and reminder_subjects keep their forced RLS and tenant_isolation policy (0289). Idempotent.
DO $$
DECLARE
  target record;
  definition text;
  allowed text[];
BEGIN
  FOR target IN SELECT * FROM (VALUES ('reminder_rules', 'reminder_rules_kind_check'), ('reminder_subjects', 'reminder_subjects_kind_check')) AS list (relation, constraint_name) LOOP
    SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conname = target.constraint_name AND conrelid = target.relation::regclass;
    SELECT coalesce(array_agg(match[1] ORDER BY ordinality), '{}') INTO allowed
      FROM regexp_matches(coalesce(definition, ''), '''([a-z_.]+)''', 'g') WITH ORDINALITY AS found (match, ordinality);
    IF NOT 'meeting.minutes_due' = ANY (allowed) THEN
      allowed := allowed || ARRAY['meeting.minutes_due'];
      IF definition IS NOT NULL THEN EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', target.relation, target.constraint_name); END IF;
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (kind IN (%s))', target.relation, target.constraint_name,
        (SELECT string_agg(quote_literal(kind), ', ' ORDER BY position) FROM unnest(allowed) WITH ORDINALITY AS entry (kind, position)));
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('reminders.meeting.minutes_due', 'in_app', '{{title}} · {{due}}', '{{context}}. Write the minutes and share them with the client.', '["title","context","due"]'),
  ('reminders.meeting.minutes_due', 'push', '{{title}} · {{due}}', '{{context}}. Write the minutes and share them with the client.', '["title","context","due"]'),
  ('reminders.meeting.minutes_due', 'email', '{{title}} · {{due}}', E'{{title}} is {{due}}.\n\n{{context}}. Write the minutes and share them with the client.', '["title","context","due"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
