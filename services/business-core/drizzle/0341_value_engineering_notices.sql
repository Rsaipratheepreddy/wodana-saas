-- PLM-147: who hears what about value engineering, and the reminder for a round left idle.
--
-- 1. The reminder engine's quote.value_engineering_idle kind: a value engineering round that hasn't moved (started,
--    savings agreed, meeting held) reminds its lead after the firm's days (Settings › Reminders; by default 3 and 7
--    working days), then their team lead. Done once the client decides (a new version sent or the price kept) or the
--    round is withdrawn. The kind lists are extended, never rewritten, so kinds another release added stay:
--     -- adds to reminder_rules_kind_check: 'quote.value_engineering_idle'
--     -- adds to reminder_subjects_kind_check: 'quote.value_engineering_idle'
-- 2. The notice templates for every workspace (new workspaces get them from the default templates): the lead designer
--    (over budget, value engineering to lead), the Account Manager when the job has no lead designer, the Account
--    Manager's copy, a chargeable round (Sales), the savings agreed and the meeting booked (the QS), the client's
--    budget changed during a round, and a round closed by a recorded decision.
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
    IF NOT 'quote.value_engineering_idle' = ANY (allowed) THEN
      allowed := allowed || ARRAY['quote.value_engineering_idle'];
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
  ('quotation.value_engineering_lead', 'in_app', 'Over budget · {{clientName}}', '{{why}}. You lead value engineering with {{qs}}: agree the savings, then present the options to the client. {{note}}', '["title","clientName","actor","lead","qs","why","round","when","place","budget","note"]'),
  ('quotation.value_engineering_lead', 'email', 'Over budget: value engineering for {{clientName}}', E'{{why}} ({{title}}).\n\nYou lead value engineering with {{qs}}: agree the savings together, then present the options to {{clientName}}. The client decides.\n\n{{note}}', '["title","clientName","actor","lead","qs","why","round","when","place","budget","note"]'),
  ('quotation.value_engineering_no_designer', 'in_app', 'Over budget · {{clientName}} · no lead designer', '{{why}}. Nobody is the lead designer on this job, so you lead value engineering with {{qs}}. {{note}}', '["title","clientName","actor","lead","qs","why","round","when","place","budget","note"]'),
  ('quotation.value_engineering_no_designer', 'email', 'Over budget: you lead value engineering for {{clientName}}', E'{{why}} ({{title}}).\n\nNobody is the lead designer on this job, so you lead value engineering with {{qs}}: agree the savings, then present the options to {{clientName}}. Allocate a lead designer and it moves to them.\n\n{{note}}', '["title","clientName","actor","lead","qs","why","round","when","place","budget","note"]'),
  ('quotation.value_engineering_copy', 'in_app', 'Value engineering · {{clientName}}', '{{why}}. {{lead}} leads it with {{qs}}. You can attend the meeting; the design choices are theirs.', '["title","clientName","actor","lead","qs","why","round","when","place","budget","note"]'),
  ('quotation.value_engineering_copy', 'email', 'For information: value engineering for {{clientName}}', E'{{why}} ({{title}}).\n\n{{lead}} leads value engineering with {{qs}} and presents the options to the client. You can attend the meeting; the design choices are theirs.', '["title","clientName","actor","lead","qs","why","round","when","place","budget","note"]'),
  ('quotation.value_engineering_chargeable', 'in_app', 'Chargeable value engineering · {{clientName}}', 'Round {{round}} is past the free rounds. Agree the fee with the client before the work starts.', '["title","clientName","actor","lead","qs","why","round","when","place","budget","note"]'),
  ('quotation.value_engineering_chargeable', 'email', 'Chargeable value engineering for {{clientName}}', E'Value engineering round {{round}} on {{title}} is past the free rounds your firm gives.\n\nAgree the fee with {{clientName}} before the work starts.', '["title","clientName","actor","lead","qs","why","round","when","place","budget","note"]'),
  ('quotation.value_engineering_agreed', 'in_app', 'Savings agreed · {{clientName}}', '{{actor}}: {{note}}', '["title","clientName","actor","lead","qs","why","round","when","place","budget","note"]'),
  ('quotation.value_engineering_agreed', 'email', 'Savings agreed for {{clientName}}', E'{{actor}} recorded the savings agreed for {{title}}:\n\n{{note}}\n\nThe options go to the client next.', '["title","clientName","actor","lead","qs","why","round","when","place","budget","note"]'),
  ('quotation.value_engineering_meeting', 'in_app', 'Value engineering meeting · {{clientName}}', '{{actor}} booked it for {{when}}.', '["title","clientName","actor","lead","qs","why","round","when","place","budget","note"]'),
  ('quotation.value_engineering_meeting', 'email', 'Value engineering meeting booked: {{clientName}}', E'{{actor}} booked the value engineering meeting for {{title}} on {{when}}. {{place}}\n\nOpen it to see the savings agreed and, afterwards, the minutes.', '["title","clientName","actor","lead","qs","why","round","when","place","budget","note"]'),
  ('quotation.value_engineering_budget_changed', 'in_app', 'Budget changed · {{clientName}}', '{{actor}} changed the client''s budget to {{budget}} during value engineering. {{note}}', '["title","clientName","actor","lead","qs","why","round","when","place","budget","note"]'),
  ('quotation.value_engineering_closed', 'in_app', 'Value engineering closed · {{clientName}}', '{{note}}', '["title","clientName","actor","lead","qs","why","round","when","place","budget","note"]'),
  ('reminders.quote.value_engineering_idle', 'in_app', '{{title}} · {{due}}', '{{context}}. Agree the savings, present the options or record the client''s decision.', '["title","context","due"]'),
  ('reminders.quote.value_engineering_idle', 'push', '{{title}} · {{due}}', '{{context}}. Agree the savings, present the options or record the client''s decision.', '["title","context","due"]'),
  ('reminders.quote.value_engineering_idle', 'email', '{{title}} · {{due}}', E'{{title}} is {{due}}.\n\n{{context}}. Agree the savings, present the options or record the client''s decision.', '["title","context","due"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
