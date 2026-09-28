-- Payment reminders: the automatic schedule (days relative to the due date) lives on the payments.reminder client
-- message; every reminder sent is logged per payment milestone, at most one a day, manual or scheduled.
ALTER TABLE crm_client_message_rules
  ADD COLUMN offsets integer[],
  ADD COLUMN checked_at timestamptz,
  ADD CONSTRAINT crm_client_message_rules_offsets_check CHECK (offsets IS NULL OR (cardinality(offsets) BETWEEN 1 AND 8 AND -30 <= ALL (offsets) AND 60 >= ALL (offsets)));
--> statement-breakpoint
CREATE TABLE crm_payment_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  payment_id text NOT NULL,
  invoice_id uuid,
  sent_on date NOT NULL,
  offset_days integer,
  channel varchar(20) NOT NULL,
  message_id uuid,
  sent_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_payment_reminders_channel_check CHECK (channel IN ('whatsapp', 'email')),
  CONSTRAINT crm_payment_reminders_daily_key UNIQUE (workspace_id, payment_id, sent_on)
);
--> statement-breakpoint
CREATE INDEX crm_payment_reminders_payment_idx ON crm_payment_reminders (workspace_id, case_id, payment_id, sent_on DESC);
--> statement-breakpoint
ALTER TABLE crm_payment_reminders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm_payment_reminders FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON crm_payment_reminders
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT ON crm_payment_reminders TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- The worker checks reminders hourly for a workspace with money due in the reminder window.
CREATE OR REPLACE FUNCTION public.list_crm_workspaces_with_due_work() RETURNS TABLE(workspace_id uuid)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT DISTINCT due.workspace_id
  FROM (
    SELECT notification.workspace_id FROM notifications notification
      WHERE (notification.status IN ('pending','scheduled') AND notification.scheduled_for <= now())
         OR (notification.status = 'processing' AND notification.processing_started_at < now() - interval '5 minutes')
    UNION ALL
    SELECT wait.workspace_id FROM automation_waits wait
      WHERE (wait.status = 'waiting' AND wait.due_at <= now())
         OR (wait.status = 'claimed' AND wait.claimed_at < now() - interval '5 minutes')
    UNION ALL
    SELECT sla.workspace_id FROM crm_sla_instances sla
      WHERE (sla.status = 'active' AND (sla.warning_at <= now() OR sla.due_at <= now()))
         OR (sla.status = 'warning' AND sla.due_at <= now())
    UNION ALL
    SELECT lead.workspace_id FROM crm_leads lead
      WHERE lead.ownership_due_at <= now() AND lead.owner_membership_id IS NOT NULL
        AND lead.status IN ('new','attempting_contact','connected','nurturing')
    UNION ALL
    SELECT lead.workspace_id FROM crm_leads lead
      WHERE lead.escalation_due_at <= now() OR lead.client_review_due_at <= now()
         OR (lead.status = 'paused' AND lead.next_action_at <= now())
    UNION ALL
    SELECT workspace.id FROM workspaces workspace
      CROSS JOIN LATERAL (SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names zone WHERE zone.name = workspace.default_timezone)
        THEN workspace.default_timezone ELSE 'UTC' END AS name) zone
      WHERE workspace.status = 'active'
        AND (now() AT TIME ZONE zone.name)::time >= time '09:00'
        AND NOT EXISTS (SELECT 1 FROM crm_sales_digests digest WHERE digest.workspace_id = workspace.id
          AND digest.digest_date = (now() AT TIME ZONE zone.name)::date)
        AND EXISTS (SELECT 1 FROM crm_leads lead WHERE lead.workspace_id = workspace.id
          AND lead.status IN ('new','attempting_contact','connected','nurturing'))
    UNION ALL
    SELECT enrollment.workspace_id
      FROM crm_sequence_enrollments enrollment
      JOIN crm_sequences sequence
        ON sequence.workspace_id = enrollment.workspace_id
       AND sequence.id = enrollment.sequence_id
      WHERE enrollment.status = 'active'
        AND enrollment.next_run_at <= now()
        AND sequence.status = 'active'
    UNION ALL
    SELECT conversation.workspace_id FROM crm_conversations conversation
      WHERE conversation.status = 'snoozed' AND conversation.snoozed_until <= now()
    UNION ALL
    SELECT template.workspace_id FROM notification_templates template
      WHERE template.channel = 'whatsapp' AND template.provider_status = 'submitting'
        AND (template.provider_submitted_at IS NULL OR template.provider_submitted_at < now() - interval '10 minutes')
    UNION ALL
    SELECT connection.workspace_id FROM integration_connections connection
      WHERE connection.provider = 'whatsapp' AND connection.status = 'connected'
        AND COALESCE((connection.configuration->>'templatesSyncedAt')::timestamptz, '-infinity') < now() - interval '1 day'
        AND COALESCE((connection.configuration->>'templatesSyncAttemptedAt')::timestamptz, '-infinity') < now() - interval '1 hour'
    UNION ALL
    SELECT payment.workspace_id FROM commercial_payments payment
      WHERE payment.status = 'pending' AND payment.due_date BETWEEN current_date - 61 AND current_date + 31
        AND NOT EXISTS (SELECT 1 FROM crm_client_message_rules rule
                         WHERE rule.workspace_id = payment.workspace_id AND rule.event = 'payments.reminder'
                           AND (NOT rule.enabled OR rule.checked_at > now() - interval '1 hour'))
  ) due;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.list_crm_workspaces_with_due_work() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION public.list_crm_workspaces_with_due_work() TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- The email fallback for a reminder, and Finance's notice when a payment is a week overdue.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
  FROM workspaces workspace
 CROSS JOIN (VALUES
   ('portal.payment_due', 'email', 'Payment reminder · {{title}}', E'A reminder from {{company}}: {{title}} for {{project}} is due. {{due}}\n\nOpen your project page to see it and pay.', '["company","project","title","due","note"]'),
   ('receivables.payment_overdue', 'in_app', '{{client}} hasn''t paid {{title}}', 'A week past due. Reminders sent: {{count}}.', '["client","title","count"]')
 ) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
