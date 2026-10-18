-- PLM-146, PLM-148, PLM-156: who is told what about the finishes, and the reminder for the client's signatures.
--
-- 1. The reminder engine's finishes.signature_due kind: a started project whose finishes in the categories the client
--    signs (e.g. sanitary ware, whitegoods) still miss the signed sample or data sheet. The case's lead designer hears
--    after the firm's days (by default 1, 3 and 7 days after the project started), then their team lead and the owner.
--    Done once every one is signed. The kind joins the kind lists, extended, never rewritten:
--    -- adds to reminder_rules_kind_check: 'finishes.signature_due'
--    -- adds to reminder_subjects_kind_check: 'finishes.signature_due'
-- 2. The notice templates for every workspace (new workspaces get them from the default templates):
--    the QS hears the finishes to price and a finish changed after pricing; the designer hears the finishes to mark
--    and a missing client signature when procurement tries to order; the factory lead hears the sample log is shared;
--    procurement hears a project's gate cleared.
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
    IF NOT 'finishes.signature_due' = ANY (allowed) THEN
      allowed := allowed || ARRAY['finishes.signature_due'];
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
  ('finishes.to_mark', 'in_app', 'Mark the finishes · {{clientName}}', 'The samples are approved. Mark the finishes on the render snapshots and send them to QS by {{due}}.', '["clientName","project","actor","title","count","items","due","note"]'),
  ('finishes.to_mark', 'email', 'Mark the finishes: {{clientName}}', E'The samples for {{clientName}} are approved.\n\nMark the exact finishes on the render snapshots and send them to QS by {{due}}.', '["clientName","project","actor","title","count","items","due","note"]'),
  ('finishes.sent_to_qs', 'in_app', 'Finishes to price · {{clientName}}', '{{actor}} sent {{count}} finishes. Price the quotation from them. {{note}}', '["clientName","project","actor","title","count","items","due","note"]'),
  ('finishes.sent_to_qs', 'email', 'Finishes to price: {{clientName}}', E'{{actor}} marked the finishes for {{clientName}} and sent them to you ({{count}}).\n\nPrice the quotation from the designer''s specification. {{note}}', '["clientName","project","actor","title","count","items","due","note"]'),
  ('finishes.changed', 'in_app', '{{title}} changed after pricing · {{clientName}}', '{{actor}}: {{note}} The old price is flagged on the quotation.', '["clientName","project","actor","title","count","items","due","note"]'),
  ('finishes.changed', 'email', '{{title}} changed after pricing: {{clientName}}', E'{{actor}} changed {{title}} for {{clientName}} after it was sent to you.\n\n{{note}}\n\nThe old price is flagged on the quotation. Price it again from the new specification.', '["clientName","project","actor","title","count","items","due","note"]'),
  ('finishes.factory_shared', 'in_app', 'Sample log shared · {{project}}', '{{actor}} shared the samples and finishes for {{clientName}}. {{note}}', '["clientName","project","actor","title","count","items","due","note"]'),
  ('finishes.factory_shared', 'email', 'Sample log shared: {{project}}', E'{{actor}} shared the sample log and photos for {{project}} ({{clientName}}) with the factory.\n\nOpen it in the Factory. {{note}}', '["clientName","project","actor","title","count","items","due","note"]'),
  ('procurement.gate_cleared', 'in_app', '{{project}} can be ordered', 'The client''s payment, the material list and the signed samples are in for {{clientName}}.', '["clientName","project","actor","title","count","items","due","note"]'),
  ('procurement.gate_cleared', 'email', '{{project}} can be ordered', E'The client''s payment, the confirmed material list and the client''s signed samples and data sheets are all in for {{project}} ({{clientName}}).\n\nThe materials can be ordered.', '["clientName","project","actor","title","count","items","due","note"]'),
  ('procurement.signature_missing', 'in_app', 'Client signature missing · {{project}}', '{{actor}} tried to order. The client still signs: {{items}}.', '["clientName","project","actor","title","count","items","due","note"]'),
  ('procurement.signature_missing', 'email', 'Client signature missing: {{project}}', E'{{actor}} tried to order materials for {{project}} ({{clientName}}), but the client hasn''t signed these samples or data sheets yet:\n\n{{items}}\n\nRecord each signed sample or sheet (a photo and the date) on the finishes schedule.', '["clientName","project","actor","title","count","items","due","note"]'),
  ('reminders.finishes.signature_due', 'in_app', '{{title}} · {{due}}', '{{context}}. Get the client to sign the samples and data sheets, then record them.', '["title","context","due"]'),
  ('reminders.finishes.signature_due', 'push', '{{title}} · {{due}}', '{{context}}. Get the client to sign the samples and data sheets, then record them.', '["title","context","due"]'),
  ('reminders.finishes.signature_due', 'email', '{{title}} · {{due}}', E'{{title}} is {{due}}.\n\n{{context}}. Get the client to sign the samples and data sheets, then record them.', '["title","context","due"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
