-- An archived organization rests: nobody signs in to it, nothing runs for it and nothing leaves it (the operator CLI's
-- `sandbox --retire`, src/ops/ops-sandbox-retire.ts, archives a retired sandbox's organizations; its data is kept).
--   * tenant_login_open(workspace): whether an organization's login address is open (active or suspended), for the
--     public login-address lookups that read tenant_login_branding without a tenant (an archived organization's address
--     answers "not found", as an unknown one does). Reveals nothing else.
--   * Every cross-tenant enumeration a scheduler or worker uses skips archived organizations: the Ledger and accounting
--     sweeps, project and HR reminders, the CRM due-work and inbox timers, linked-import refreshes, the storage cleanup
--     queue and the outbox publisher. (list_reminder_engine_workspaces and list_control_plane_workspaces already did.)
--     Each keeps its definition and adds only the filter. A published company gallery of an archived organization is not
--     public either.
-- No table changes, no data changes, RLS untouched. Idempotent (CREATE OR REPLACE keeps each function's grants).
CREATE OR REPLACE FUNCTION tenant_login_open(target uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM workspaces workspace WHERE workspace.id = target AND workspace.status IN ('active', 'suspended'))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenant_login_open(uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION tenant_login_open(uuid) TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION list_books_workspaces() RETURNS TABLE (workspace_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT settings.workspace_id FROM books_settings settings
   WHERE settings.enabled
     AND NOT EXISTS (SELECT 1 FROM workspaces archived WHERE archived.id = settings.workspace_id AND archived.status = 'archived')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION list_accounting_workspaces() RETURNS TABLE (workspace_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT link.workspace_id FROM accounting_links link
   WHERE link.active
     AND NOT EXISTS (SELECT 1 FROM workspaces archived WHERE archived.id = link.workspace_id AND archived.status = 'archived')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.list_reminder_workspaces() RETURNS TABLE(workspace_id uuid)
  LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $$
  SELECT due.workspace_id FROM (
    SELECT project.workspace_id FROM delivery_projects project
    UNION
    SELECT commercial.workspace_id FROM commercial_cases commercial
    UNION
    SELECT journey.workspace_id FROM design_journeys journey
    UNION
    SELECT session.workspace_id FROM hrms_sessions session WHERE session.ended_at IS NULL
  ) due
  WHERE NOT EXISTS (SELECT 1 FROM workspaces archived WHERE archived.id = due.workspace_id AND archived.status = 'archived');
$$;
--> statement-breakpoint
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
  ) due
  WHERE NOT EXISTS (SELECT 1 FROM workspaces archived WHERE archived.id = due.workspace_id AND archived.status = 'archived');
$$;
--> statement-breakpoint
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
  ) due
  WHERE NOT EXISTS (SELECT 1 FROM workspaces archived WHERE archived.id = due.workspace_id AND archived.status = 'archived');
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.list_import_link_workspaces_due() RETURNS TABLE(workspace_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT DISTINCT link.workspace_id FROM import_links link
   WHERE link.status = 'active' AND link.schedule <> 'off' AND link.source = 'google_sheet'
     AND (link.next_run_at IS NULL OR link.next_run_at <= now())
     AND (link.claimed_until IS NULL OR link.claimed_until < now())
     AND NOT EXISTS (SELECT 1 FROM workspaces archived WHERE archived.id = link.workspace_id AND archived.status = 'archived');
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION workspace_object_cleanup_workspaces() RETURNS TABLE (workspace_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT queue.workspace_id FROM workspace_object_cleanup_queue queue
   WHERE queue.status = 'pending'
     AND NOT EXISTS (SELECT 1 FROM workspaces archived WHERE archived.id = queue.workspace_id AND archived.status = 'archived')
$$;
--> statement-breakpoint
-- The outbox publisher: an archived organization's events stay where they are (the retire marks what was waiting as
-- handled); everything else is claimed exactly as before.
CREATE OR REPLACE FUNCTION public.claim_outbox_events(batch_size integer, lease_token uuid, lease_seconds integer DEFAULT 60)
  RETURNS TABLE(id uuid, workspace_id uuid, aggregate_type character varying, aggregate_id uuid, event_type character varying, payload jsonb, attempts integer)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH candidates AS (
    SELECT event.id
    FROM outbox_events event
    WHERE event.status IN ('pending', 'failed')
      AND event.available_at <= now()
      AND event.attempts < 20
      AND (event.claimed_at IS NULL OR event.claimed_at < now() - make_interval(secs => greatest(lease_seconds, 10)))
      AND NOT EXISTS (SELECT 1 FROM workspaces archived WHERE archived.id = event.workspace_id AND archived.status = 'archived')
    ORDER BY event.available_at, event.created_at
    FOR UPDATE OF event SKIP LOCKED
    LIMIT least(greatest(batch_size, 1), 100)
  )
  UPDATE outbox_events event
     SET claimed_at = now(), claim_token = lease_token, attempts = event.attempts + 1
    FROM candidates
   WHERE event.id = candidates.id
  RETURNING event.id, event.workspace_id, event.aggregate_type, event.aggregate_id,
            event.event_type, event.payload, event.attempts;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public_gallery_workspace(p_slug text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT gallery.workspace_id FROM workspace_galleries gallery
   WHERE gallery.slug = lower(p_slug) AND gallery.status = 'published'
     AND NOT EXISTS (SELECT 1 FROM workspaces archived WHERE archived.id = gallery.workspace_id AND archived.status = 'archived');
$$;
