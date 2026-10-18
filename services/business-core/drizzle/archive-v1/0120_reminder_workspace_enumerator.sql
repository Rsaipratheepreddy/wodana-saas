-- Scheduled project and decision reminders read tenant tables protected by
-- forced RLS. The worker has no tenant context, so it first enumerates the
-- workspaces that can have reminders and then runs each workspace's rules in
-- its own tenant transaction. This function returns identifiers only.
CREATE OR REPLACE FUNCTION list_reminder_workspaces()
RETURNS TABLE (workspace_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT project.workspace_id FROM delivery_projects project
  UNION
  SELECT commercial.workspace_id FROM commercial_cases commercial;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION list_reminder_workspaces() FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION list_reminder_workspaces() TO wodana_app;
  END IF;
END $$;
