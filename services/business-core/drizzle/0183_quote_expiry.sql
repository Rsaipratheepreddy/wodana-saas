-- Quotes expire properly (Q-6, Q-7). A sent quote whose validity ended before the client decided becomes Expired
-- in the daily run; Sales hears it a few days before (3 by default, Settings → Quotations) and when it expires,
-- and "Extend validity" sends the same content again with a new date. The quote table and the settings table
-- already have forced RLS and a tenant_isolation policy; wodana_app keeps its grants. Idempotent.
ALTER TABLE commercial_quotes DROP CONSTRAINT IF EXISTS commercial_quotes_status_check;
--> statement-breakpoint
ALTER TABLE commercial_quotes ADD CONSTRAINT commercial_quotes_status_check
  CHECK (status IN ('draft', 'internal_review', 'internal_approved', 'issued', 'accepted', 'changes_requested', 'declined', 'superseded', 'withdrawn', 'expired'));
--> statement-breakpoint
ALTER TABLE workspace_quotation_settings
  ADD COLUMN IF NOT EXISTS expiry_warning_days smallint NOT NULL DEFAULT 3 CHECK (expiry_warning_days BETWEEN 0 AND 30);
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, '["title", "clientName", "due"]'::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('quotation.expiring', 'in_app', '{{title}} expires {{due}}', '{{clientName}} hasn''t decided yet. Follow up, or extend its validity.'),
  ('quotation.expired', 'in_app', '{{title}} expired', 'It was valid until {{due}} and {{clientName}} didn''t decide. Extend its validity to send it again.'),
  ('quotation.expired', 'email', '{{title}} expired', E'{{title}} for {{clientName}} was valid until {{due}} and the client didn''t decide.\n\nOpen the quote and extend its validity to send it again, or start a new revision.')
) AS template (code, channel, subject, body)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
