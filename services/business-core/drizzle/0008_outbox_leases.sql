ALTER TABLE outbox_events ADD COLUMN claimed_at timestamptz;
ALTER TABLE outbox_events ADD COLUMN claim_token uuid;
--> statement-breakpoint
CREATE INDEX outbox_events_claim_idx ON outbox_events (status, available_at, claimed_at);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION claim_outbox_events(batch_size integer, lease_token uuid, lease_seconds integer DEFAULT 60)
RETURNS TABLE (
  id uuid, workspace_id uuid, aggregate_type varchar, aggregate_id uuid,
  event_type varchar, payload jsonb, attempts integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH candidates AS (
    SELECT event.id
    FROM outbox_events event
    WHERE event.status IN ('pending', 'failed')
      AND event.available_at <= now()
      AND event.attempts < 20
      AND (event.claimed_at IS NULL OR event.claimed_at < now() - make_interval(secs => greatest(lease_seconds, 10)))
    ORDER BY event.available_at, event.created_at
    FOR UPDATE SKIP LOCKED
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
CREATE OR REPLACE FUNCTION complete_outbox_event(event_id uuid, lease_token uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH updated AS (
    UPDATE outbox_events
       SET status = 'published', published_at = now(), claimed_at = NULL,
           claim_token = NULL, last_error = NULL
     WHERE id = event_id AND claim_token = lease_token AND status <> 'published'
    RETURNING 1
  ) SELECT EXISTS(SELECT 1 FROM updated);
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION fail_outbox_event(event_id uuid, lease_token uuid, failure text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH updated AS (
    UPDATE outbox_events
       SET status = 'failed', available_at = now() + least(interval '1 hour', interval '2 seconds' * power(2, least(attempts, 10))),
           claimed_at = NULL, claim_token = NULL, last_error = left(failure, 2000)
     WHERE id = event_id AND claim_token = lease_token AND status <> 'published'
    RETURNING 1
  ) SELECT EXISTS(SELECT 1 FROM updated);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION claim_outbox_events(integer, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_outbox_event(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION fail_outbox_event(uuid, uuid, text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION claim_outbox_events(integer, uuid, integer) TO wodana_app;
    GRANT EXECUTE ON FUNCTION complete_outbox_event(uuid, uuid) TO wodana_app;
    GRANT EXECUTE ON FUNCTION fail_outbox_event(uuid, uuid, text) TO wodana_app;
  END IF;
END $$;
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
      WHERE notification.status IN ('pending','scheduled') AND notification.scheduled_for <= now()
    UNION ALL
    SELECT wait.workspace_id FROM automation_waits wait
      WHERE wait.status = 'waiting' AND wait.due_at <= now()
  ) due;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION list_crm_workspaces_with_due_work() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION list_crm_workspaces_with_due_work() TO wodana_app;
  END IF;
END $$;
