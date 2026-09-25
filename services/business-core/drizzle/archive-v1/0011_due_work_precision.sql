CREATE OR REPLACE FUNCTION list_crm_workspaces_with_due_work()
RETURNS TABLE (workspace_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT due.workspace_id
  FROM (
    SELECT notification.workspace_id FROM notifications notification
      WHERE notification.status IN ('pending','scheduled') AND notification.scheduled_for <= now()
    UNION ALL
    SELECT wait.workspace_id FROM automation_waits wait
      WHERE (wait.status = 'waiting' AND wait.due_at <= now())
         OR (wait.status = 'claimed' AND wait.claimed_at < now() - interval '5 minutes')
    UNION ALL
    SELECT sla.workspace_id FROM crm_sla_instances sla
      WHERE (sla.status = 'active' AND (sla.warning_at <= now() OR sla.due_at <= now()))
         OR (sla.status = 'warning' AND sla.due_at <= now())
  ) due;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION list_crm_workspaces_with_due_work() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION list_crm_workspaces_with_due_work() TO wodana_app;
  END IF;
END $$;
