-- PLM-155 and PLM-137: two reminder kinds.
--   * crm.timeline_check (the engine): a timeline question not answered reminds the person asked two hours before the
--     end of the working day it is due and when it is due (Settings › Reminders), then their team lead.
--     -- adds to reminder_rules_kind_check: 'crm.timeline_check'
--     -- adds to reminder_subjects_kind_check: 'crm.timeline_check'
--   * crm.chat_closing (My day only): a chat whose "Closing the chat" message is due (the client hasn't replied for the
--     firm's quiet working hours) waits in My day for whoever may send it (crm.inbox.close_chats). Never sent by itself.
--     -- adds to reminder_subjects_kind_check: 'crm.chat_closing'
--   * The engine's staff templates for crm.timeline_check (in the app, on the phone and by email) for every workspace.
-- The kind lists are extended, never rewritten, so kinds another release added stay. reminder_rules and
-- reminder_subjects keep their forced RLS and tenant_isolation policy (0289). Idempotent.
DO $$
DECLARE
  target record;
  definition text;
  allowed text[];
  wanted text[];
  value text;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('reminder_rules', 'reminder_rules_kind_check', ARRAY['crm.timeline_check']),
    ('reminder_subjects', 'reminder_subjects_kind_check', ARRAY['crm.timeline_check', 'crm.chat_closing'])
  ) AS list (relation, constraint_name, additions) LOOP
    SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conname = target.constraint_name AND conrelid = target.relation::regclass;
    SELECT coalesce(array_agg(match[1] ORDER BY ordinality), '{}') INTO allowed
      FROM regexp_matches(coalesce(definition, ''), '''([a-z_.]+)''', 'g') WITH ORDINALITY AS found (match, ordinality);
    wanted := allowed;
    FOREACH value IN ARRAY target.additions LOOP
      IF NOT value = ANY (wanted) THEN wanted := wanted || value; END IF;
    END LOOP;
    IF wanted IS DISTINCT FROM allowed THEN
      IF definition IS NOT NULL THEN EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', target.relation, target.constraint_name); END IF;
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (kind IN (%s))', target.relation, target.constraint_name,
        (SELECT string_agg(quote_literal(kind), ', ' ORDER BY position) FROM unnest(wanted) WITH ORDINALITY AS entry (kind, position)));
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('reminders.crm.timeline_check', 'in_app', '{{title}} · {{due}}', '{{context}}. Answer the timeline question so Sales can reply to the client today.', '["title","context","due"]'),
  ('reminders.crm.timeline_check', 'push', '{{title}} · {{due}}', '{{context}}. Answer the timeline question so Sales can reply to the client today.', '["title","context","due"]'),
  ('reminders.crm.timeline_check', 'email', '{{title}} · {{due}}', E'{{title}} is {{due}}.\n\n{{context}}. Answer the timeline question so Sales can reply to the client today.', '["title","context","due"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
