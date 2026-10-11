-- Reminder engine (E4) slices B to E and A2 (plan §6.24a): the sweep's planning state, the one-a-day client gate,
-- the channels a step went out on, the change-request client decision kind and its templates.
--   * change_request.client_decision joins the kind lists (the change-request module registers its source).
--   * reminder_subjects.plan_key: the due revision and rule version the subject's steps were planned for; a
--     moved due moment or a changed rule plans again.
--   * reminder_steps.channels: where a sent step went (in_app, push, email, whatsapp), for the record's timeline.
--   * reminder_client_days (clear): at most one reminder per client (party) per local day, across the engine and
--     the module chasers. The first claim of a day wins; a claim with the same key is the same send again.
-- Every new table has workspace_id, forced RLS with tenant_isolation and composite foreign keys. Never disables RLS.

-- 1. The kind lists.
ALTER TABLE reminder_rules DROP CONSTRAINT reminder_rules_kind_check;
--> statement-breakpoint
ALTER TABLE reminder_rules ADD CONSTRAINT reminder_rules_kind_check CHECK (kind IN ('work.due', 'crm.follow_up', 'approval.waiting', 'client.quote_decision',
    'client.design_decision', 'quote.expiring', 'payment.due', 'invoice.overdue', 'payables.due', 'purchase.order_late',
    'design.stage_due', 'permit.expiry', 'finance_request.waiting', 'change_request.client_decision'));
--> statement-breakpoint
ALTER TABLE reminder_subjects DROP CONSTRAINT reminder_subjects_kind_check;
--> statement-breakpoint
ALTER TABLE reminder_subjects ADD CONSTRAINT reminder_subjects_kind_check CHECK (kind IN ('work.due', 'crm.follow_up', 'approval.waiting', 'client.quote_decision',
    'client.design_decision', 'quote.expiring', 'payment.due', 'invoice.overdue', 'payables.due', 'purchase.order_late',
    'design.stage_due', 'permit.expiry', 'finance_request.waiting', 'change_request.client_decision', 'crm.first_response', 'crm.unowned', 'crm.confirm_client',
    'crm.reply_waiting', 'site.daily_report', 'factory.production_due', 'books.posting_issue'));
--> statement-breakpoint
-- 2. Planning state and the channels a step used.
ALTER TABLE reminder_subjects ADD COLUMN plan_key varchar(40);
--> statement-breakpoint
ALTER TABLE reminder_steps ADD COLUMN channels text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT reminder_steps_channels_check CHECK (channels <@ ARRAY['in_app', 'push', 'email', 'whatsapp']::text[]);
--> statement-breakpoint
-- My day reads a person's items by owner (0289's index) and by the people copied in.
CREATE INDEX reminder_subjects_open_cc_idx ON reminder_subjects USING gin (cc_membership_ids) WHERE status IN ('open', 'snoozed');
--> statement-breakpoint
-- 3. The one-a-day client gate.
CREATE TABLE reminder_client_days (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  party_id uuid NOT NULL,
  local_date date NOT NULL,
  priority smallint NOT NULL CHECK (priority BETWEEN 1 AND 3),
  gate_key varchar(200) NOT NULL CHECK (length(btrim(gate_key)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, party_id, local_date),
  FOREIGN KEY (workspace_id, party_id) REFERENCES crm_parties (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE reminder_client_days ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reminder_client_days FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON reminder_client_days
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    -- A claim whose send reached nobody is given back (DELETE), so another reminder may go that day.
    GRANT SELECT, INSERT, DELETE ON reminder_client_days TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('reminder_client_days', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
--> statement-breakpoint
-- 4. The change-request templates (notifications/default-templates.ts; new workspaces get them when created).
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('reminders.change_request.client_decision', 'email', 'Your change {{title}} is waiting for you', E'{{title}} is waiting for your decision.\n\n{{context}}\n\nOpen it to approve it or decline it.', '["title","context","due"]'),
  ('reminders.change_request.client_decision.staff', 'in_app', 'Waiting on the client · {{title}}', '{{context}} has had {{reminders}} reminders about this change and hasn''t decided. Call them.', '["title","context","due","reminders"]'),
  ('reminders.change_request.client_decision.staff', 'push', 'Waiting on the client · {{title}}', '{{context}} has had {{reminders}} reminders about this change and hasn''t decided. Call them.', '["title","context","due","reminders"]'),
  ('reminders.change_request.client_decision.staff', 'email', 'Waiting on the client · {{title}}', E'{{context}} has had {{reminders}} reminders about this change and hasn''t decided. Call them.\n\nOpen it to see what they still have to decide.', '["title","context","due","reminders"]')
) AS template(code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
