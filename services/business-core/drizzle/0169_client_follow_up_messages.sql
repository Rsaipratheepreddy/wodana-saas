-- More client messages: a visit or meeting confirmation and its day-before reminder, a nudge on an enquiry that
-- went quiet, a quotation follow-up, thanks for a won deal, and thanks after handover (with the firm's review link
-- when it has one). Each is a WhatsApp starter template the firm submits to Meta and switches on or off in
-- Settings → Inbox → Client messages; the timing and the review link live with the inbox settings.
ALTER TABLE crm_client_message_rules DROP CONSTRAINT crm_client_message_rules_event_check;
--> statement-breakpoint
ALTER TABLE crm_client_message_rules ADD CONSTRAINT crm_client_message_rules_event_check CHECK (event IN (
  'crm.enquiry.created', 'portal.quote_issued', 'portal.invoice_issued', 'receivables.payment_received',
  'portal.decision_waiting', 'portal.update_published', 'project.stage_started', 'payments.reminder',
  'crm.meeting.booked', 'crm.meeting.reminder', 'crm.enquiry.quiet', 'commercial.quote_follow_up', 'crm.opportunity.won', 'project.handover_thanks'));
--> statement-breakpoint
ALTER TABLE crm_template_variables DROP CONSTRAINT crm_template_variables_source_check;
--> statement-breakpoint
ALTER TABLE crm_template_variables ADD CONSTRAINT crm_template_variables_source_check CHECK (source IN (
  'contact.first_name', 'contact.name', 'enquiry.reference', 'opportunity.reference', 'project.name', 'project.stage',
  'quote.number', 'invoice.number', 'invoice.total', 'invoice.due_date', 'payment.amount', 'portal.link',
  'staff.first_name', 'business.name', 'today.date', 'meeting.time', 'meeting.place', 'review.link'));
--> statement-breakpoint
ALTER TABLE crm_inbox_settings
  ADD COLUMN quiet_followup_days smallint NOT NULL DEFAULT 3,
  ADD COLUMN quiet_followup_second_days smallint,
  ADD COLUMN quote_followup_days smallint NOT NULL DEFAULT 3,
  ADD COLUMN review_url varchar(500),
  ADD COLUMN followups_version integer NOT NULL DEFAULT 1,
  ADD COLUMN followups_checked_at timestamptz,
  ADD CONSTRAINT crm_inbox_settings_quiet_days_check CHECK (quiet_followup_days BETWEEN 1 AND 30),
  ADD CONSTRAINT crm_inbox_settings_quiet_second_check CHECK (quiet_followup_second_days IS NULL OR quiet_followup_second_days BETWEEN quiet_followup_days + 1 AND 60),
  ADD CONSTRAINT crm_inbox_settings_quote_days_check CHECK (quote_followup_days BETWEEN 1 AND 30),
  ADD CONSTRAINT crm_inbox_settings_review_url_check CHECK (review_url IS NULL OR review_url ~ '^https://[^[:space:]]{3,}$'),
  ADD CONSTRAINT crm_inbox_settings_followups_version_check CHECK (followups_version > 0);
--> statement-breakpoint
-- The time-based ones (visit reminders, quiet enquiries, quotation follow-ups) are checked at most every two
-- minutes for a workspace with a connected WhatsApp number, in the same inbox due-work pass.
CREATE OR REPLACE FUNCTION public.list_crm_workspaces_with_due_inbox_work() RETURNS TABLE(workspace_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT DISTINCT due.workspace_id FROM (
    SELECT attachment.workspace_id FROM crm_message_attachments attachment
     WHERE attachment.status = 'pending' AND attachment.next_attempt_at <= now()
    UNION ALL
    SELECT scheduled.workspace_id FROM crm_scheduled_messages scheduled
     WHERE scheduled.status = 'scheduled' AND scheduled.send_at <= now()
    UNION ALL
    SELECT connection.workspace_id FROM integration_connections connection
     WHERE connection.provider = 'whatsapp' AND connection.status = 'connected'
       AND NOT EXISTS (SELECT 1 FROM crm_inbox_settings settings WHERE settings.workspace_id = connection.workspace_id
                        AND settings.followups_checked_at > now() - interval '2 minutes')
  ) due;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.list_crm_workspaces_with_due_inbox_work() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION public.list_crm_workspaces_with_due_inbox_work() TO wodana_app;
  END IF;
END $$;
