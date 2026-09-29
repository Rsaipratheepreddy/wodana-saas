-- D-29: before a supplier delivers to a site, the client confirms the team can get in on that day. A confirmed
-- order to the site asks the client in the portal ("Confirm site access for 3 Oct") and gives the site supervisor
-- a task to meet it. The client confirms, or asks to move it with why and a better day; the team reschedules with a
-- reason, and may mark the redelivery chargeable. One open request per order and project; a new day replaces it.
CREATE TABLE site_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  project_id uuid NOT NULL,
  order_id uuid NOT NULL,
  delivery_date date NOT NULL,
  items varchar(1000) NOT NULL DEFAULT '',
  status varchar(20) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'confirmed', 'move_asked', 'rescheduled', 'cancelled')),
  task_id uuid,
  answered_by_grant uuid REFERENCES client_portal_grants (id),
  answered_by_user uuid REFERENCES users (id),
  answered_at timestamptz,
  client_reason varchar(500),
  client_date date,
  rescheduled_by uuid REFERENCES users (id),
  reschedule_reason varchar(500),
  chargeable boolean NOT NULL DEFAULT false,
  replaced_by uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, order_id) REFERENCES purchase_orders (workspace_id, id),
  FOREIGN KEY (workspace_id, task_id) REFERENCES work_items (workspace_id, id),
  FOREIGN KEY (workspace_id, replaced_by) REFERENCES site_access_requests (workspace_id, id),
  CHECK (status NOT IN ('confirmed', 'move_asked') OR answered_at IS NOT NULL),
  CHECK (status <> 'move_asked' OR length(btrim(coalesce(client_reason, ''))) > 0),
  CHECK (status <> 'rescheduled' OR length(btrim(coalesce(reschedule_reason, ''))) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX site_access_requests_open_key ON site_access_requests (workspace_id, order_id, project_id) WHERE status IN ('waiting', 'confirmed', 'move_asked');
--> statement-breakpoint
CREATE INDEX site_access_requests_project_idx ON site_access_requests (workspace_id, project_id, delivery_date);
--> statement-breakpoint
ALTER TABLE site_access_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE site_access_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON site_access_requests
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON site_access_requests TO wodana_app;
  END IF;
END $$;
