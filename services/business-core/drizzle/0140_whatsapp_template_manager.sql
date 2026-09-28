-- WhatsApp template manager: each provider template keeps Meta's own status (submitting, pending, approved,
-- rejected with a reason, paused, disabled), its category and quality; starter-pack templates remember which pack
-- item they came from. A template can be sent only while Meta approves it.
ALTER TABLE notification_templates
  ADD COLUMN provider_status varchar(20),
  ADD COLUMN provider_reason varchar(500),
  ADD COLUMN provider_category varchar(20),
  ADD COLUMN provider_quality varchar(20),
  ADD COLUMN provider_submitted_at timestamptz,
  ADD COLUMN provider_synced_at timestamptz,
  ADD COLUMN starter_key varchar(60);
--> statement-breakpoint
ALTER TABLE notification_templates
  ADD CONSTRAINT notification_templates_provider_status_check CHECK (provider_status IS NULL OR provider_status IN ('submitting', 'pending', 'approved', 'rejected', 'paused', 'disabled')),
  ADD CONSTRAINT notification_templates_provider_category_check CHECK (provider_category IS NULL OR provider_category IN ('utility', 'marketing', 'authentication'));
--> statement-breakpoint
-- Templates already imported were approved at Meta when they were imported.
UPDATE notification_templates SET provider_status = 'approved', provider_synced_at = approved_at
 WHERE channel = 'whatsapp' AND status = 'approved' AND provider_template_id IS NOT NULL AND provider_status IS NULL;
--> statement-breakpoint
CREATE INDEX notification_templates_provider_work_idx ON notification_templates (workspace_id, provider_status) WHERE channel = 'whatsapp';
--> statement-breakpoint
-- Event messages need the event's own values: the payment's amount, the invoice's due date, the stage that started.
ALTER TABLE crm_template_variables DROP CONSTRAINT crm_template_variables_source_check;
--> statement-breakpoint
ALTER TABLE crm_template_variables ADD CONSTRAINT crm_template_variables_source_check CHECK (source IN (
  'contact.first_name', 'contact.name', 'enquiry.reference', 'opportunity.reference', 'project.name', 'project.stage',
  'quote.number', 'invoice.number', 'invoice.total', 'invoice.due_date', 'payment.amount', 'portal.link',
  'staff.first_name', 'business.name', 'today.date'));
--> statement-breakpoint
-- The worker also submits starter templates and syncs statuses from Meta once a day (retrying at most hourly).
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
-- The person who connected WhatsApp hears when Meta rejects or pauses a template.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'crm.template_status', 'in_app', 'en', 1, 'approved', 'Template {{name}} is {{status}}', '{{reason}}', '["name","status","reason"]'::jsonb, now()
  FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
