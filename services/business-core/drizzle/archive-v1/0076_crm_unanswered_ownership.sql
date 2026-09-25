ALTER TABLE crm_queues
  ADD COLUMN takeover_after_minutes integer,
  ADD CONSTRAINT crm_queues_takeover_after_minutes_check
    CHECK (takeover_after_minutes IS NULL OR takeover_after_minutes BETWEEN 1 AND 10080);
--> statement-breakpoint
ALTER TABLE crm_leads ADD COLUMN ownership_due_at timestamp with time zone;
CREATE INDEX crm_leads_ownership_due_idx
  ON crm_leads(workspace_id, ownership_due_at)
  WHERE ownership_due_at IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION list_crm_workspaces_with_due_work()
RETURNS TABLE (workspace_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  ) due;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION list_crm_workspaces_with_due_work() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION list_crm_workspaces_with_due_work() TO wodana_app;
  END IF;
END $$;
